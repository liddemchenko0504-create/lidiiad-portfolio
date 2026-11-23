/*
 * ArchiCGI Discovery Lab — real media
 * Uses only footage published by ArchiCGI (see media.json for the source page of every clip).
 *   - start screen: the studio showreel as a muted, looping backdrop that plays on its own (poster first, video after load;
 *     poster only for reduced motion / Save-Data)
 *   - "Films et animations" section: animations, before/after, virtual tours, interactive platform (poster until played)
 *   - project links: result cards and the graph panel get a "Watch the animation" button when ArchiCGI published one
 * Nothing is downloaded before the user presses play, except the showreel backdrop (skipped on reduced motion / Save-Data).
 */
(() => {
  'use strict';
  const I = window.discoveryI18n;
  if (!I) return;
  const t = (k, v) => I.t(k, v);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection || {};
  const lowData = Boolean(conn.saveData) || /(^|-)2g$/.test(conn.effectiveType || '');
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
  const https = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
  let data = null;
  const byProject = new Map();
  const byId = new Map();

  /* ---------------- start-screen showreel backdrop ---------------- */
  let heroVideo = null, heroWanted = !reduce && !lowData;
  function startHero() {
    if (!heroVideo || document.body.classList.contains('lab-has-query') || document.body.classList.contains('lab-has-project-link')) return;
    if (!heroVideo.getAttribute('src')) heroVideo.src = https(innerWidth < 768 ? data.hero.mobile : data.hero.desktop);
    heroVideo.play().catch(() => { heroWanted = false; });
  }
  function buildHero() {
    const hero = data.hero;
    heroVideo = h('video', { class: 'lab-hero-video', muted: '', loop: '', playsinline: '', preload: 'none', tabindex: '-1', 'aria-hidden': 'true',
      poster: https(hero.poster) });
    heroVideo.muted = true;
    heroVideo.addEventListener('playing', () => heroVideo.classList.add('is-on'));
    heroVideo.addEventListener('error', () => { heroVideo.classList.remove('is-on'); heroWanted = false; });
    const stage = h('div', { class: 'lab-hero', 'aria-hidden': 'true', style: 'background-image:url("' + https(hero.poster) + '")' }, heroVideo);
    document.body.prepend(stage);
    // stop decoding once the work area is open
    new MutationObserver(() => {
      const entry = !document.body.classList.contains('lab-has-query') && !document.body.classList.contains('lab-has-project-link');
      if (!entry) heroVideo.pause(); else if (heroWanted) startHero();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const go = () => { if (heroWanted) startHero(); };
    if (document.readyState === 'complete') (window.requestIdleCallback || setTimeout)(go);
    else addEventListener('load', () => (window.requestIdleCallback || setTimeout)(go), { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) heroVideo.pause(); else if (heroWanted) startHero(); });
  }

  /* ---------------- player dialog ---------------- */
  const dlg = h('dialog', { class: 'dl-media-dialog' });
  const dlgTitle = h('h2', { class: 'dl-m-title' });
  const dlgBody = h('div', { class: 'dl-m-body' });
  const dlgSrc = h('a', { class: 'dl-m-src', target: '_blank', rel: 'noopener noreferrer' });
  const dlgClose = h('button', { type: 'button', class: 'dl-m-close', onclick: () => dlg.close() }, '×');
  dlg.append(h('div', { class: 'dl-m-head' }, dlgTitle, dlgClose), dlgBody, h('div', { class: 'dl-m-foot' }, dlgSrc));
  dlg.addEventListener('close', () => dlgBody.replaceChildren());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  function open(id) {
    const it = byId.get(id);
    if (!it) return false;
    if (heroVideo) heroVideo.pause();
    dlgTitle.textContent = it.title;
    dlgClose.setAttribute('aria-label', t('m.close'));
    dlgSrc.textContent = t('m.source'); dlgSrc.href = https(it.page);
    if (it.yt) {
      const go = h('button', { type: 'button', class: 'dl-m-yt', 'aria-label': t('m.ytPlay', { title: it.title }), onclick: () => {
        dlgBody.replaceChildren(h('iframe', { class: 'dl-m-frame', title: it.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: '',
          referrerpolicy: 'strict-origin-when-cross-origin', src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(it.yt) + '?rel=0&autoplay=1' }));
      } }, h('img', { src: https(it.poster), alt: '' }), h('span', { class: 'dl-m-playmark', 'aria-hidden': 'true' }), h('span', { class: 'dl-m-ytnote' }, t('m.ytNote')));
      dlgBody.replaceChildren(go);
    } else {
      const v = h('video', { class: 'dl-m-video', controls: '', playsinline: '', preload: 'metadata', poster: https(it.poster), src: https(it.src) });
      const fail = () => dlgBody.replaceChildren(h('p', { class: 'dl-m-err' }, t('m.err')));
      v.addEventListener('error', fail);
      dlgBody.replaceChildren(v);
      v.play().catch(() => {});
    }
    if (!dlg.open) dlg.showModal();
    return true;
  }

  /* ---------------- section: films and animations ---------------- */
  const TABS = ['animation', 'compare', 'tour', 'platform'];
  let tab = 'animation';
  const tablist = h('div', { class: 'dl-m-tabs', role: 'tablist' });
  const panel = h('div', { class: 'dl-m-panel', role: 'tabpanel', tabindex: '0' });
  let compareState = null;
  function tile(it) {
    return h('li', {}, h('button', { type: 'button', class: 'dl-m-tile', 'aria-label': t('m.playItem', { title: it.title }), onclick: () => open(it.id) },
      h('span', { class: 'dl-m-thumb' }, h('img', { src: https(it.poster), alt: '', loading: 'lazy', decoding: 'async', width: 960, height: 540 }), h('span', { class: 'dl-m-playmark', 'aria-hidden': 'true' })),
      h('span', { class: 'dl-m-name' }, it.title)));
  }
  function compare() {
    const c = data.compare;
    const before = h('video', { class: 'dl-c-v dl-c-before', muted: '', loop: '', playsinline: '', preload: 'none', poster: https(c.beforePoster), 'aria-label': t('m.before') });
    const after = h('video', { class: 'dl-c-v dl-c-after', muted: '', loop: '', playsinline: '', preload: 'none', poster: https(c.afterPoster), 'aria-label': t('m.after') });
    before.muted = after.muted = true;
    const range = h('input', { type: 'range', min: '0', max: '100', value: '50', class: 'dl-c-range', 'aria-label': t('m.cmpLabel'), 'aria-valuetext': '' });
    const box = h('div', { class: 'dl-c-stage' }, before, after, h('span', { class: 'dl-c-tag dl-c-tag--l' }, t('m.before')), h('span', { class: 'dl-c-tag dl-c-tag--r' }, t('m.after')),
      h('span', { class: 'dl-c-line', 'aria-hidden': 'true' }));
    const setPos = () => {
      const p = +range.value; box.style.setProperty('--pos', p + '%');
      range.setAttribute('aria-valuetext', t('m.cmpValue', { p }));
    };
    range.addEventListener('input', setPos); setPos();
    let timer = 0;
    const sync = () => { if (Math.abs(after.currentTime - before.currentTime) > .15) after.currentTime = before.currentTime; };
    const btn = h('button', { type: 'button', class: 'dl-btn dl-btn--primary dl-c-play', onclick: async () => {
      if (before.paused) {
        if (!before.getAttribute('src')) { before.src = https(c.before); after.src = https(c.after); }
        try { await Promise.all([before.play(), after.play()]); timer = setInterval(sync, 400); btn.textContent = t('m.cmpPause'); }
        catch (_) { box.replaceWith(h('p', { class: 'dl-m-err' }, t('m.err'))); }
      } else { before.pause(); after.pause(); clearInterval(timer); btn.textContent = t('m.cmpPlay'); }
    } }, t('m.cmpPlay'));
    compareState = { before, after, timer: () => clearInterval(timer) };
    return h('div', { class: 'dl-compare' }, h('p', { class: 'dl-m-cap' }, c.title), box, h('div', { class: 'dl-c-ctl' }, btn, range),
      h('p', { class: 'dl-note' }, t('m.cmpHint')), h('a', { class: 'dl-m-src', href: https(c.page), target: '_blank', rel: 'noopener noreferrer' }, t('m.source')));
  }
  function paintPanel() {
    if (compareState) { compareState.before.pause(); compareState.after.pause(); compareState.timer(); compareState = null; }
    tablist.querySelectorAll('[role=tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', 'dl-tab-' + tab);
    if (tab === 'compare') panel.replaceChildren(compare());
    else panel.replaceChildren(h('ul', { class: 'dl-m-grid' }, data.items.filter(i => i.kind === tab).map(tile)));
  }
  function paintTabs() {
    tablist.replaceChildren(...TABS.map(k => h('button', { type: 'button', role: 'tab', id: 'dl-tab-' + k, 'data-tab': k, class: 'dl-m-tab',
      onclick: () => { tab = k; paintPanel(); },
      onkeydown: e => {
        const i = TABS.indexOf(k); let n = -1;
        if (e.key === 'ArrowRight') n = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
        else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = TABS.length - 1;
        if (n >= 0) { e.preventDefault(); tab = TABS[n]; paintPanel(); tablist.querySelector('[data-tab="' + tab + '"]').focus(); }
      } }, t('m.tab.' + k))));
  }
  function repaint() {
    paintTabs(); paintPanel();
  }

  /* ---------------- public API (result cards, graph panel) ---------------- */
  window.discoveryMedia = {
    ready: false,
    forProject: id => byProject.get(id) || null,
    open,
    // "Watch the animation" button for a project, or null when ArchiCGI published none
    button(id, cls) {
      const it = byProject.get(id);
      return it ? h('button', { type: 'button', class: cls || 'dl-btn dl-btn--ghost dl-watch', onclick: () => open(it.id) }, t('m.watch')) : null;
    }
  };

  fetch('media.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
    data = d;
    d.items.forEach(i => { byId.set(i.id, i); if (i.project) byProject.set(i.project, i); });
    const host = document.getElementById('dl-media');
    if (host) { host.append(h('h2', { class: 'lab-h2', id: 'lab-media-title', 'data-i18n': 'sec.media' }, t('sec.media')),
      h('p', { class: 'lab-lead lab-lead--small', 'data-i18n': 'm.lead' }, t('m.lead')), tablist, panel); paintTabs(); paintPanel(); }
    document.body.append(dlg);
    buildHero();
    window.discoveryMedia.ready = true;
    document.addEventListener('discovery:lang', repaint);
    document.dispatchEvent(new CustomEvent('discovery:media'));
  }).catch(e => console.warn('[discovery] media unavailable', e));
})();
