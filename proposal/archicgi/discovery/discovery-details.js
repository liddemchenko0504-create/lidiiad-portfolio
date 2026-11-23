/*
 * ArchiCGI Discovery Lab — find similar facade details
 * Full-size render viewer; the user draws a rectangle (mouse, finger or keyboard) on a facade and
 * the region is compared with fragments of the other projects in a prebuilt index
 * (details/, built by tools/build_detail_index.py — DINOv2 ViT-S/14 patch embeddings + CIELAB colour).
 *
 * Query = mean of the source image's patch vectors under the rectangle (weighted by overlap) and their
 * mean colour, exactly as the index fragments were built. score = cosine - lambda * DeltaE.
 * No model runs in the browser; only catalogue images are used (no uploads in this version).
 *
 * Needs discovery-i18n.js, discovery-graph.js (window.discoveryGraph) and discovery-brief.js
 * (window.discoveryBrief.addDetail). Text only: never innerHTML with data.
 */
(() => {
  'use strict';
  const BASE = 'details/';
  const SHOW = 9;                    // results shown per search
  const MIN_SIDE = 0.02;             // smallest selection side (fraction of the image)
  const I = window.discoveryI18n || { lang: 'fr', t: k => k, quote: x => '« ' + x + ' »' };
  const t = (k, v) => I.t(k, v);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && el.append(c.nodeType ? c : document.createTextNode(c)));
    return el;
  };
  const safeUrl = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = n => n.toLocaleString(I.lang === 'en' ? 'en-GB' : 'fr-FR');

  /* =====================================================================
   * 1. INDEX (lazy)
   * ===================================================================== */
  let idx = null, idxPromise = null, frags = null, fragPromise = null;
  const maps = new Map();
  const projK = new Map();

  function loadIndex() {
    if (!idxPromise) {
      idxPromise = fetch(BASE + 'index.json', { cache: 'no-cache' })
        .then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
        .then(j => { idx = j; j.projects.forEach((p, k) => projK.set(p.id, k)); if (graph()) graph().refreshPanel(); return j; });
    }
    return idxPromise;
  }
  const bin = f => fetch(BASE + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.arrayBuffer(); });
  function loadFragments() {
    if (!fragPromise) {
      fragPromise = loadIndex().then(() => Promise.all([bin(idx.files.embeddings), bin(idx.files.color), bin(idx.files.meta)]))
        .then(([e, c, m]) => {
          const dims = idx.dims, emb = new Int8Array(e), n = emb.length / dims;
          const norm = new Float32Array(n);
          for (let i = 0; i < n; i++) { let s = 0; for (let d = 0; d < dims; d++) { const v = emb[i * dims + d]; s += v * v; } norm[i] = Math.sqrt(s) || 1; }
          const cb = new Uint8Array(c), lab = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { lab[i * 3] = cb[i * 3] / 2.55; lab[i * 3 + 1] = (cb[i * 3 + 1] << 24) >> 24; lab[i * 3 + 2] = (cb[i * 3 + 2] << 24) >> 24; }
          frags = { n, emb, norm, lab, meta: new Uint16Array(m) };
          return frags;
        });
    }
    return fragPromise;
  }
  function loadMap(id) {
    if (!maps.has(id)) {
      maps.set(id, loadIndex().then(() => {
        const p = idx.projects[projK.get(id)];
        return bin('maps/' + encodeURIComponent(id) + '.bin').then(buf => {
          const n = p.gw * p.gh, dims = idx.dims;
          const q = new Int8Array(buf, 0, n * dims), emb = new Float32Array(n * dims);
          for (let i = 0; i < q.length; i++) emb[i] = q[i] * p.scale;
          const cb = new Uint8Array(buf, n * dims, n * 3), lab = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { lab[i * 3] = cb[i * 3] / 2.55; lab[i * 3 + 1] = (cb[i * 3 + 1] << 24) >> 24; lab[i * 3 + 2] = (cb[i * 3 + 2] << 24) >> 24; }
          return { p, emb, lab };
        });
      }));
    }
    return maps.get(id);
  }

  /* =====================================================================
   * 2. SEARCH — the selected region against every fragment of the other projects
   * ===================================================================== */
  async function searchRegion(id, r) {
    const [m, F] = await Promise.all([loadMap(id), loadFragments()]);
    const { p, emb, lab } = m, dims = idx.dims, k0 = projK.get(id);
    const q = new Float32Array(dims), c = [0, 0, 0];
    let tot = 0;
    for (let j = 0; j < p.gh; j++) {
      const oy = Math.min(r.y + r.h, (j + 1) / p.gh) - Math.max(r.y, j / p.gh);
      if (oy <= 0) continue;
      for (let i = 0; i < p.gw; i++) {
        const ox = Math.min(r.x + r.w, (i + 1) / p.gw) - Math.max(r.x, i / p.gw);
        if (ox <= 0) continue;
        const w = ox * oy, b = (j * p.gw + i) * dims, l = (j * p.gw + i) * 3;
        for (let d = 0; d < dims; d++) q[d] += emb[b + d] * w;
        c[0] += lab[l] * w; c[1] += lab[l + 1] * w; c[2] += lab[l + 2] * w;
        tot += w;
      }
    }
    let qn = 0; for (let d = 0; d < dims; d++) qn += q[d] * q[d]; qn = Math.sqrt(qn) || 1;
    c[0] /= tot; c[1] /= tot; c[2] /= tot;
    const lambda = idx.scoring.lambda, best = new Map();
    for (let f = 0; f < F.n; f++) {
      const owner = F.meta[f * 5];
      if (owner === k0) continue;                       // other projects only
      let dot = 0; const b = f * dims;
      for (let d = 0; d < dims; d++) dot += F.emb[b + d] * q[d];
      const cos = dot / (F.norm[f] * qn);
      const dl = F.lab[f * 3] - c[0], da = F.lab[f * 3 + 1] - c[1], db = F.lab[f * 3 + 2] - c[2];
      const score = cos - lambda * Math.sqrt(dl * dl + da * da + db * db);
      const cur = best.get(owner);
      if (!cur || score > cur.score) best.set(owner, { score, cos, f });
    }
    const list = [...best.entries()].map(([owner, v]) => {
      const pr = idx.projects[owner], mm = F.meta.subarray(v.f * 5, v.f * 5 + 5);
      return { id: pr.id, score: v.score, cos: v.cos,
        region: { x: mm[1] / pr.gw, y: mm[2] / pr.gh, w: mm[3] / pr.gw, h: mm[4] / pr.gh } };
    }).sort((a, b) => b.score - a.score);
    const lv = idx.scoring.levels;
    list.forEach(x => { x.level = x.score >= lv.close ? 'close' : x.score >= lv.related ? 'related' : 'far'; });
    return { list, near: list.filter(x => x.level !== 'far').length };
  }

  /* =====================================================================
   * 3. VIEWER — render on the left (+ strip of similar details under it after a selection),
   *    actions, why it matched and the chosen detail on the right
   * ===================================================================== */
  const graph = () => window.discoveryGraph;
  const project = id => graph() && graph().projects.find(p => p.id === id);
  let view = null;                 // { id, select, selection, highlight, result, active, back, explain }

  const title = h('h2', { id: 'dl-v-title' });
  const kicker = h('p', { class: 'dl-v-kicker' });
  const extLink = h('a', { class: 'dl-btn dl-btn--ghost dl-ext', target: '_blank', rel: 'noopener noreferrer' });
  const closeBtn = h('button', { type: 'button', class: 'dl-v-close', onclick: () => close() }, '×');
  const img = h('img', { class: 'dl-v-img', alt: '', decoding: 'async', draggable: 'false' });
  const selBox = h('div', { class: 'dl-v-box dl-v-sel', hidden: '' });
  const markBox = h('div', { class: 'dl-v-box dl-v-mark', hidden: '' });
  const overlay = h('div', { class: 'dl-v-overlay' }, selBox, markBox);
  const frame = h('div', { class: 'dl-v-frame' }, img, overlay);
  const findBtn = h('button', { type: 'button', class: 'dl-btn dl-btn--primary dl-v-find', onclick: () => setSelect(!view.select) });
  const clearBtn = h('button', { type: 'button', class: 'dl-btn dl-v-clear', onclick: () => { view.selection = null; view.result = null; paint(); } });
  const backBtn = h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-v-back', onclick: () => goBack() });
  const addMarkBtn = h('button', { type: 'button', class: 'dl-btn dl-v-addmark', onclick: () => addToBrief(view.id, view.highlight) });
  const addFrameBtn = h('button', { type: 'button', class: 'dl-btn dl-v-addframe', onclick: () => { if (window.discoveryBrief) window.discoveryBrief.toggle(view.id); } });
  const graphBtn = h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-v-graph', onclick: () => showInGraph(view.id) });
  const hint = h('p', { class: 'dl-v-hint', id: 'dl-v-hint' });
  const explainBox = h('div', { class: 'dl-v-explain' });
  const status = h('p', { class: 'dl-v-status', role: 'status', 'aria-live': 'polite' });
  const notice = h('div', { class: 'dl-v-notice' });
  const hitInfo = h('div', { class: 'dl-v-hitinfo', 'aria-live': 'polite' });
  const stripTitle = h('h3', { class: 'dl-v-rtitle', id: 'dl-v-strip-title' });
  const strip = h('ol', { class: 'dl-v-strip', 'aria-labelledby': 'dl-v-strip-title' });
  const stripBox = h('section', { class: 'dl-v-stripbox', hidden: '' }, stripTitle, strip);
  const dialog = h('dialog', { class: 'dlx dl-viewer', 'aria-labelledby': 'dl-v-title' },
    h('div', { class: 'dl-v-head' }, h('div', { class: 'dl-v-titles' }, kicker, title), extLink, closeBtn),
    h('div', { class: 'dl-v-main' },
      h('div', { class: 'dl-v-left' }, h('div', { class: 'dl-v-stage' }, frame), stripBox),
      h('div', { class: 'dl-v-side' },
        h('div', { class: 'dl-v-tools' }, backBtn, findBtn, clearBtn, addMarkBtn),
        hint, status, notice, hitInfo, explainBox,
        h('div', { class: 'dl-v-tools dl-v-tools--quiet' }, addFrameBtn, graphBtn))));
  document.body.append(dialog);
  dialog.addEventListener('close', () => { view = null; restoreHash(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });   // backdrop

  // opts: select (start drawing), highlight (region to mark), from (view to go back to),
  //       explain (function returning a node: why this render matched the text search)
  function open(id, opts) {
    const p = project(id);
    if (!p || !p.image) return false;
    opts = opts || {};
    view = { id, select: !!opts.select, selection: null, highlight: opts.highlight || null, result: null, active: 0,
      back: opts.from || null, explain: opts.explain || null };
    loadIndex().catch(() => {}).then(() => { if (view && view.id === id) paint(); });
    if (!dialog.open) { lastFocus = document.activeElement; dialog.showModal(); }
    paint();
    if (opts.select) overlay.focus({ preventScroll: true });
    else closeBtn.focus({ preventScroll: true });
    return true;
  }
  let lastFocus = null;
  function close() {
    if (dialog.open) dialog.close();
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
  }
  function goBack() {
    const b = view && view.back;
    if (!b) return;
    view = b;
    paint();
  }
  function showInGraph(id) {
    close();
    const g = graph();
    if (!g || !g.showProject(id)) return;
    g.stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  const isIndexed = id => (idx ? projK.has(id) : undefined);

  function setSelect(on) {
    if (!view) return;
    if (on && isIndexed(view.id) === false) return;
    view.select = on;
    if (on) {
      view.highlight = null;
      overlay.focus({ preventScroll: true });
      // on a phone the render may be scrolled away (results above the tools): bring it back to draw on it
      frame.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    paint();
  }

  function place(box, r) {
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    box.style.left = (r.x * 100) + '%'; box.style.top = (r.y * 100) + '%';
    box.style.width = (r.w * 100) + '%'; box.style.height = (r.h * 100) + '%';
  }

  function paint() {
    if (!view) return;
    const p = project(view.id), pub = p.published || {};
    const indexed = isIndexed(view.id);
    const B = window.discoveryBrief;
    title.textContent = p.label;
    kicker.textContent = 'ArchiCGI' + (pub.categories && pub.categories.length ? ' · ' + pub.categories.join(', ') : '');
    if (safeUrl(p.url)) { extLink.href = safeUrl(p.url); extLink.hidden = false; } else extLink.hidden = true;
    extLink.textContent = t('s.viewArchi');
    closeBtn.setAttribute('aria-label', t('d.close'));
    if (img.getAttribute('src') !== p.image) img.src = p.image;
    img.alt = p.imageAlt || p.label;
    overlay.classList.toggle('is-selecting', !!view.select);
    overlay.setAttribute('tabindex', view.select ? '0' : '-1');
    overlay.setAttribute('role', view.select ? 'application' : 'presentation');
    overlay.setAttribute('aria-label', view.select ? t('d.overlay') : '');
    overlay.setAttribute('aria-describedby', 'dl-v-hint');
    place(selBox, view.selection);
    place(markBox, view.highlight);
    markBox.setAttribute('aria-label', view.highlight ? t('d.marked') : '');

    backBtn.hidden = !view.back;
    backBtn.textContent = t('d.back');
    findBtn.disabled = indexed === false;
    findBtn.setAttribute('aria-pressed', String(!!view.select));
    findBtn.textContent = view.select ? t('d.stopSelect') : t('d.find');
    clearBtn.hidden = !view.selection;
    clearBtn.textContent = t('d.clear');
    addMarkBtn.hidden = !view.highlight;
    const markIn = view.highlight && B && B.hasDetail(view.id, view.highlight);
    addMarkBtn.textContent = markIn ? t('d.inBrief') : t('d.addMark');
    addMarkBtn.setAttribute('aria-pressed', String(!!markIn));
    const frameIn = B && B.has(view.id);
    addFrameBtn.hidden = !B;
    addFrameBtn.textContent = frameIn ? t('d.frameInBrief') : t('d.addFrame');
    addFrameBtn.setAttribute('aria-pressed', String(!!frameIn));
    graphBtn.textContent = t('s.showGraph');

    hint.textContent = indexed === false ? t('d.notIndexed', { n: idx ? idx.projects.length : '' })
      : view.select ? t('d.hint') : view.highlight ? t('d.markedHint') : view.result ? '' : t('d.intro');
    explainBox.replaceChildren();
    if (view.explain && !view.result) {
      const node = view.explain();
      if (node) explainBox.append(h('h3', { class: 'dl-v-rtitle' }, t('s.why')), node);
    }
    paintResults();
  }

  function paintResults() {
    strip.replaceChildren(); hitInfo.replaceChildren(); notice.replaceChildren();
    const r = view.result;
    stripBox.hidden = !(r && r.list);
    dialog.classList.toggle('has-strip', !stripBox.hidden);
    if (!r) { status.textContent = ''; return; }
    if (r.error) { status.textContent = t('d.error'); return; }
    status.textContent = t('d.summary', { projects: fmt(idx.projects.length), fragments: fmt(idx.fragments) });
    if (r.near < idx.scoring.minClose) notice.append(h('p', { class: 'dl-nomatch dl-v-weak' }, t('d.weak', { k: r.near })));
    stripTitle.textContent = t('d.resultsTitle');
    r.list.slice(0, SHOW).forEach((x, i) => {
      const p = project(x.id);
      const crop = window.discoveryBrief ? window.discoveryBrief.cropBox(p.image, x.region, 'dl-v-crop') : h('div', { class: 'dl-v-crop' });
      const on = i === view.active;
      strip.append(h('li', { class: 'dl-v-hit is-' + x.level + (on ? ' is-active' : ''), 'data-id': x.id, 'data-score': x.score.toFixed(4) },
        h('button', { type: 'button', class: 'dl-v-pick', 'aria-pressed': String(on),
          'aria-label': t('d.pick', { n: i + 1, title: p.label, level: t('d.level.' + x.level) }),
          onclick: () => { view.active = i; paintResults(); } },
          crop,
          h('span', { class: 'dl-v-cap' }, h('span', { class: 'dl-v-rank' }, String(i + 1).padStart(2, '0')),
            h('span', { class: 'dl-mono' }, x.id.replace('acgi-', '')), h('span', { class: 'dl-v-band' }, t('d.level.' + x.level))))));
    });
    const x = r.list[view.active];
    if (!x) return;
    const p = project(x.id), pub = p.published || {};
    const inBrief = window.discoveryBrief && window.discoveryBrief.hasDetail(x.id, x.region);
    hitInfo.append(
      h('p', { class: 'dl-badge' + (x.level === 'close' ? ' is-full' : '') }, t('d.level.' + x.level) + ' · ', h('span', { class: 'dl-mono' }, x.score.toFixed(2))),
      h('h4', {}, p.label),
      pub.categories && pub.categories.length ? h('p', { class: 'dl-note' }, 'ArchiCGI · ' + pub.categories.join(', ')) : null,
      h('div', { class: 'dl-v-hitactions' },
        h('button', { type: 'button', class: 'dl-btn dl-btn--primary dl-add dl-v-add', 'aria-pressed': String(!!inBrief),
          onclick: () => addToBrief(x.id, x.region) }, inBrief ? t('d.inBrief') : t('d.add')),
        h('button', { type: 'button', class: 'dl-btn dl-v-open', onclick: () => open(x.id, { highlight: x.region, from: view }) }, t('d.viewFrame')),
        safeUrl(p.url) ? h('a', { class: 'dl-btn dl-btn--ghost dl-ext', href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' }, t('s.viewArchi')) : null));
  }

  function addToBrief(id, region) {
    const B = window.discoveryBrief;
    if (!B || !region) return;
    const k = B.addDetail(id, region);
    if (k < 0) return;
    paint();
    notice.append(h('div', { class: 'dl-v-added', role: 'status' }, t('d.added'), ' ',
      h('button', { type: 'button', class: 'dl-btn dl-v-gobrief', onclick: () => goToBrief(k) }, t('d.writeNote'))));
  }
  function goToBrief(k) {
    close();
    const li = document.querySelectorAll('.dl-brief-item')[k];
    if (!li) return;
    li.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const ta = li.querySelector('textarea');
    if (ta) ta.focus({ preventScroll: true });
  }

  async function run() {
    if (!view || !view.selection) return;
    const v = view, sel = view.selection;
    status.textContent = t('d.searching');
    strip.replaceChildren(); hitInfo.replaceChildren(); notice.replaceChildren();
    try { v.result = await searchRegion(v.id, sel); } catch (e) { console.error('[discovery details]', e); v.result = { error: true }; }
    if (view === v) { v.select = false; v.active = 0; paint(); }
  }

  /* ---------- drawing a rectangle: mouse, pen or finger ---------- */
  let drag = null;
  const pointAt = e => {
    const b = overlay.getBoundingClientRect();
    return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  overlay.addEventListener('pointerdown', e => {
    if (!view || !view.select || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, a: pointAt(e) };
    view.selection = null; view.result = null;
    place(selBox, { x: drag.a.x, y: drag.a.y, w: 0, h: 0 });
  });
  overlay.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    place(selBox, rectOf(drag.a, pointAt(e)));
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = rectOf(drag.a, pointAt(e));
    drag = null;
    if (r.w < MIN_SIDE || r.h < MIN_SIDE) { place(selBox, null); hint.textContent = t('d.tooSmall'); return; }
    view.selection = r;
    run();
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; place(selBox, view.selection); } });

  // keyboard: Enter creates a centred selection, arrows move it, Shift+arrows resize, Enter searches
  overlay.addEventListener('keydown', e => {
    if (!view || !view.select) return;
    const step = 0.02;
    let s = view.selection;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!s) { view.selection = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }; place(selBox, view.selection); hint.textContent = t('d.kbd'); }
      else run();
      return;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || !s) return;
    e.preventDefault();
    s = Object.assign({}, s);
    if (e.shiftKey) { s.w = clamp(s.w + dir[0] * step, MIN_SIDE, 1 - s.x); s.h = clamp(s.h + dir[1] * step, MIN_SIDE, 1 - s.y); }
    else { s.x = clamp(s.x + dir[0] * step, 0, 1 - s.w); s.y = clamp(s.y + dir[1] * step, 0, 1 - s.h); }
    view.selection = s; view.result = null; place(selBox, s); paintResults();
  });

  /* ---------- deep link: #detail=<id>:x,y,w,h ---------- */
  let openedFromHash = false;
  function fromHash() {
    const m = /^#detail=([\w-]+):([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(decodeURIComponent(location.hash));
    if (!m) return;
    const r = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
    if ([r.x, r.y, r.w, r.h].some(v => !(v >= 0 && v <= 1))) return;
    openedFromHash = open(m[1], { highlight: r });
  }
  function restoreHash() {
    if (!openedFromHash) return;
    openedFromHash = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* file:// */ }
  }

  /* ---------- language / brief changes ---------- */
  document.addEventListener('discovery:lang', () => { if (view) paint(); });
  document.addEventListener('discovery:brief', () => { if (view) paint(); });

  window.discoveryDetails = {
    open, close, isIndexed,
    count: () => (idx ? idx.projects.length : ''),
    loadIndex, searchRegion,
    get state() { return view ? { id: view.id, select: view.select, selection: view.selection, highlight: view.highlight,
      results: view.result && view.result.list ? view.result.list.slice(0, SHOW) : null } : null; }
  };
  const boot = () => { loadIndex().catch(e => console.error('[discovery details]', e)); fromHash(); };
  if (graph() && graph().projects) boot(); else document.addEventListener('discovery:ready', boot, { once: true });
})();
