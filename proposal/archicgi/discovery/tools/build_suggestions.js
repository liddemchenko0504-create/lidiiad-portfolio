#!/usr/bin/env node
/*
 * Discovery Lab — homepage search suggestions, built from the portfolio data.
 *
 * Every candidate in suggestion-candidates.json (one request in French and English) is run through the page's own
 * search engine (window.discoveryBrief.search, the same code the search box uses), in a headless browser.
 * Kept: requests that
 *   - are fully understood (no unknown words, no stray free-text word),
 *   - return the same projects in French and in English,
 *   - return at least MIN_FULL projects that meet every criterion, but no more than MAX_SHARE of the catalogue,
 *   - are backed by the editorial tags for at least MIN_TAGGED of those projects (not only by a word in a title).
 * A suggestion must name something to look at (a building type, inside/outside, a camera view, a space or an
 * animation); style, material, setting and light only qualify it.
 * Selection: first the best request for each of the SEED_TYPES most frequent building types in graph-data.json
 * (so the portfolio's real distribution shows), then the remaining slots by number of matching projects. Each
 * criterion family is used once (building types up to TYPE_CAP times), and no two suggestions share more than
 * MAX_JACCARD of their projects.
 *
 * Usage (from the repository root; needs Node and Playwright with Chromium):
 *   node proposal/archicgi/discovery/tools/build_suggestions.js            # writes ../suggestions.json
 *   node proposal/archicgi/discovery/tools/build_suggestions.js --check    # re-runs the saved suggestions, fails on drift
 *   options: --cytoscape <file>  serve Cytoscape from a local file instead of unpkg (offline machines)
 *            --report <file>     also write every candidate's measures as JSON
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const HERE = __dirname, LAB = path.dirname(HERE), ROOT = path.resolve(LAB, '../../..');
const OUT = path.join(LAB, 'suggestions.json');
const MIN_FULL = 20, MAX_SHARE = 0.25, MIN_TAGGED = 0.85, MAX_JACCARD = 0.35, MIN_PICK = 6, MAX_PICK = 8;
const SEED_TYPES = 3, TYPE_CAP = 4, SUBJECT_DIMS = ['typology', 'inout', 'camera', 'space', 'media'];

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CHECK = args.includes('--check');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2',
  '.png': 'image/png', '.bin': 'application/octet-stream' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function measure(pairs) {
  const { chromium } = require('playwright');
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/proposal/archicgi/discovery/`;
  const browser = await chromium.launch(); const page = await browser.newPage();
  const cy = opt('--cytoscape');
  if (cy) await page.route('https://unpkg.com/**', r => r.fulfill({ path: cy, contentType: 'text/javascript' }));
  await page.route(/archicgi\.com/, r => r.abort());                    // images are not needed to search
  await page.goto(base);
  await page.waitForFunction(() => window.discoveryBrief && window.discoveryBrief.search && window.discoveryGraph && window.discoveryGraph.projects,
    null, { timeout: 60000 });
  const rows = await page.evaluate(pairs => pairs.map(c => {
    const one = q => {
      const o = window.discoveryBrief.search(q), full = o.results.filter(r => r.full);
      return { q, concepts: o.concepts.map(x => x.id), dims: o.concepts.map(x => x.dim), tags: o.concepts.flatMap(x => x.tags || []), unknown: o.unknown, full: full.length, results: o.results.length,
        tagged: full.filter(r => r.crit.every(x => x.ev.some(e => e.kind !== 'text'))).length,
        top10Full: o.results.slice(0, 10).filter(r => r.full).length, ids: full.map(r => r.p.id).sort() };
    };
    return { id: c.id, fr: one(c.fr), en: one(c.en), total: window.discoveryGraph.projects.length };
  }), pairs);
  await browser.close(); srv.close();
  return rows;
}

const jaccard = (a, b) => { const s = new Set(a); const i = b.filter(x => s.has(x)).length; return i / (a.length + b.length - i || 1); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function verdict(r) {
  const why = [];
  const both = [r.fr, r.en];
  if (both.some(x => x.unknown.length)) why.push('unknown words: ' + both.flatMap(x => x.unknown).join(', '));
  if (both.some(x => x.concepts.some(c => c.startsWith('free:')))) why.push('stray free-text word');
  if (r.fr.ids.join() !== r.en.ids.join()) why.push(`French and English differ (${r.fr.full} vs ${r.en.full})`);
  if (r.fr.full < MIN_FULL) why.push(`only ${r.fr.full} full matches`);
  if (r.fr.full > r.total * MAX_SHARE) why.push(`too broad (${r.fr.full} of ${r.total})`);
  if (r.fr.full && r.fr.tagged / r.fr.full < MIN_TAGGED) why.push(`only ${Math.round(100 * r.fr.tagged / r.fr.full)}% backed by tags`);
  if (r.fr.top10Full < Math.min(10, r.fr.full)) why.push('partial matches ranked above full ones');
  if (!r.fr.dims.some(d => SUBJECT_DIMS.includes(d))) why.push('names no subject (only a style, material, setting or light)');
  return why;
}

(async () => {
  if (CHECK) {
    const cfg = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const rows = await measure(cfg.items.map(i => ({ id: i.id, fr: i.fr.q, en: i.en.q })));
    let bad = 0;
    rows.forEach(r => {
      const it = cfg.items.find(i => i.id === r.id), why = verdict(r);
      if (r.fr.full !== it.results || r.en.full !== it.results) why.push(`count changed: saved ${it.results}, now ${r.fr.full} / ${r.en.full}`);
      console.log((why.length ? 'FAIL ' : 'ok   ') + r.id.padEnd(18) + String(r.fr.full).padStart(4) + '  ' + it.fr.q + ' / ' + it.en.q + (why.length ? '  — ' + why.join('; ') : ''));
      bad += why.length ? 1 : 0;
    });
    if (sha(path.join(LAB, 'graph-data.json')) !== cfg.dataset.sha256) console.log('note: graph-data.json changed since the suggestions were built');
    process.exit(bad ? 1 : 0);
  }
  const cand = JSON.parse(fs.readFileSync(path.join(HERE, 'suggestion-candidates.json'), 'utf8')).candidates;
  const rows = await measure(cand);
  rows.forEach(r => { r.why = verdict(r); });
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(rows, null, 1));
  const ok = rows.filter(r => !r.why.length).sort((a, b) => b.fr.full - a.fr.full);
  const data = JSON.parse(fs.readFileSync(path.join(LAB, 'graph-data.json'), 'utf8'));
  const typeFreq = {};
  data.projects.forEach(p => ((p.facets || {}).typology || []).forEach(t => { typeFreq[t] = (typeFreq[t] || 0) + 1; }));
  const seeds = Object.entries(typeFreq).sort((a, b) => b[1] - a[1]).slice(0, SEED_TYPES).map(([t]) => 'typology:' + t);
  const pick = [];
  const fits = r => {
    if (pick.includes(r) || pick.length >= MAX_PICK) return false;
    const used = pick.flatMap(p => [...new Set(p.fr.dims)]);
    for (const d of new Set(r.fr.dims)) {
      const n = used.filter(x => x === d).length;
      if (n >= (d === 'typology' ? TYPE_CAP : 1)) return false;
    }
    return !pick.some(p => jaccard(p.fr.ids, r.fr.ids) > MAX_JACCARD);
  };
  seeds.forEach(tag => { const r = ok.find(x => x.fr.tags.includes(tag) && x.fr.tags.filter(t => t.startsWith('typology:')).length === 1 && fits(x)); if (r) pick.push(r); });
  ok.forEach(r => { if (fits(r)) pick.push(r); });
  rows.forEach(r => console.log((pick.includes(r) ? 'PICK ' : r.why.length ? '  -  ' : '  ok ') + r.id.padEnd(22) +
    String(r.fr.full).padStart(4) + '  ' + (r.why.join('; ') || '')));
  if (pick.length < MIN_PICK) { console.error(`only ${pick.length} suggestions pass; add candidates or relax the rules`); process.exit(1); }
  const out = {
    note: 'Generated by tools/build_suggestions.js from tools/suggestion-candidates.json. Do not edit by hand; run the script with --check after changing the data or the search engine.',
    built: new Date().toISOString().slice(0, 10),
    dataset: { file: 'graph-data.json', projects: rows[0].total, sha256: sha(path.join(LAB, 'graph-data.json')) },
    rules: { minFull: MIN_FULL, maxShare: MAX_SHARE, minTagged: MIN_TAGGED, maxJaccard: MAX_JACCARD },
    items: pick.map(r => ({ id: r.id, results: r.fr.full, tagged: r.fr.tagged, criteria: r.fr.concepts,
      fr: { q: r.fr.q }, en: { q: r.en.q },
      maxOverlap: +Math.max(0, ...pick.filter(p => p !== r).map(p => jaccard(p.fr.ids, r.fr.ids))).toFixed(2) }))
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`\n${pick.length} suggestions -> ${path.relative(ROOT, OUT)}`);
})().catch(e => { console.error(e); process.exit(2); });
