/*
 * ArchiCGI Discovery Lab — knowledge graph
 * Requires: Cytoscape.js >= 3.26 (global `cytoscape`). No other dependencies.
 *
 * Required DOM (see integration notes):
 *   #discovery-graph  root (class="dl")
 *   #dl-filters       filter chips container
 *   #dl-stage         stage wrapper (position: relative)
 *   #dl-graph         canvas container (inside #dl-stage)
 *   #dl-panel         details panel
 */
(() => {
  'use strict';

  const CONFIG = {
    dataUrl: 'graph-data.json',
    allowNodeDrag: false,   // true = nodes draggable; positions are never recomputed either way
    minZoomFactor: 0.8,     // × fit zoom
    maxZoomFactor: 5,       // × fit zoom (never below 1.6 absolute)
    fitPadding: 48,
    ringProjectMin: 170,    // px (model space)
    ringProjectPerNode: 38,
    projectsPerRing: 72,    // above this, projects are spread over concentric rings
    ringMinArc: 96,         // px of arc between neighbours on one ring (node is 76)
    ringStep: 120,          // px between concentric project rings
    ringGap: 240,           // distance between project ring and facet ring
    sectorGap: 0.14,        // radians between facet sectors
    staggerBelowArc: 84,    // px of arc per facet below which labels alternate radius
    listStep: 40,           // panel lists show this many items, then "show more"
    denseEdges: 300         // above this many edges, edges are drawn fainter
  };

  const root = document.getElementById('discovery-graph');
  const els = {
    filters: document.getElementById('dl-filters'),
    stage: document.getElementById('dl-stage'),
    graph: document.getElementById('dl-graph'),
    panel: document.getElementById('dl-panel')
  };
  if (!root || !els.graph || !els.panel || !els.stage || typeof cytoscape === 'undefined') return;

  // Interface language (discovery-i18n.js). Data keeps canonical labels; only display text changes.
  const I = window.discoveryI18n || { lang: 'fr', t: k => k, tag: x => x, group: (k, f) => f || k, filter: (i, f) => f || i,
    quote: x => '\u00ab\u00a0' + x + '\u00a0\u00bb' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  /* ---------- tiny DOM helper (text only, never innerHTML with data) ---------- */
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
  const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /* ---------- load ---------- */
  fetch(CONFIG.dataUrl, { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => { try { init(data); } catch (e) { console.error('[discovery] init failed', e); throw e; } })
    .catch(err => {
      console.error('[discovery]', err);
      els.graph.replaceChildren(h('p', { class: 'dl-error' }, I.t('g.error')));
    });

  /* =====================================================================
   * 1. MODEL — derive facet nodes and edges from project records
   * ===================================================================== */
  function buildModel(data) {
    const groups = data.groups;
    const facetGroups = Object.keys(groups).filter(g => g !== 'project');
    const projects = data.projects || [];
    const facets = new Map();   // id -> {id, group, label}
    const edges = [];

    projects.forEach(p => {
      facetGroups.forEach(g => {
        ((p.facets && p.facets[g]) || []).forEach(label => {
          const id = g + ':' + slug(label);
          if (!facets.has(id)) facets.set(id, { id, group: g, label });
          edges.push({ id: 'e:' + p.id + '>' + id, source: p.id, target: id, group: g });
        });
      });
    });

    const activeGroups = facetGroups.filter(g => [...facets.values()].some(f => f.group === g));
    return {
      groups, facetGroups, activeGroups, projects, edges,
      facets: [...facets.values()],
      projectById: new Map(projects.map(p => [p.id, p])),
      filters: data.filters || []
    };
  }

  /* =====================================================================
   * 2. LAYOUT — deterministic grouped radial layout
   *    inner ring: projects (input order)
   *    outer ring: facets in one angular sector per group, ordered by the
   *    circular mean angle of their connected projects (barycentre), which
   *    removes most edge crossings without any physics simulation.
   * ===================================================================== */
  function computeLayout(model) {
    const TAU = Math.PI * 2;
    const n = Math.max(1, model.projects.length);
    // Small sets: one ring, as before. Large sets: the same angular order, alternated over
    // K concentric rings so the graph stays compact enough to read at the fit zoom.
    const K = Math.max(1, Math.ceil(n / CONFIG.projectsPerRing));
    const Rp = K === 1
      ? Math.max(CONFIG.ringProjectMin, n * CONFIG.ringProjectPerNode)
      : Math.max(CONFIG.ringProjectMin, (Math.ceil(n / K) * CONFIG.ringMinArc) / TAU);
    const RpOuter = Rp + (K - 1) * CONFIG.ringStep;
    const Rf = RpOuter + CONFIG.ringGap;
    const pos = {};
    const polar = (a, r) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
    const wrap = a => { while (a > Math.PI) a -= TAU; while (a <= -Math.PI) a += TAU; return a; };

    const pAngle = new Map();
    model.projects.forEach((p, i) => {
      const a = -Math.PI / 2 + (TAU * i) / n;
      pAngle.set(p.id, a);
      pos[p.id] = n === 1 ? { x: 0, y: 0 } : polar(a, Rp + (i % K) * CONFIG.ringStep);
    });

    const neighborsOf = new Map();
    model.edges.forEach(e => {
      if (!neighborsOf.has(e.target)) neighborsOf.set(e.target, []);
      neighborsOf.get(e.target).push(e.source);
    });

    const active = model.activeGroups;
    const weights = active.map(g => model.facets.filter(f => f.group === g).length + 1);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const usable = TAU - CONFIG.sectorGap * active.length;
    const sectors = [];
    let cursor = -Math.PI / 2;

    active.forEach((g, gi) => {
      const span = (usable * weights[gi]) / totalW;
      const center = cursor + span / 2;
      const list = model.facets.filter(f => f.group === g).map(f => {
        const as = (neighborsOf.get(f.id) || []).map(id => pAngle.get(id));
        const mean = as.length
          ? Math.atan2(as.reduce((s, a) => s + Math.sin(a), 0), as.reduce((s, a) => s + Math.cos(a), 0))
          : center;
        return { f, key: wrap(mean - center) };
      }).sort((a, b) => a.key - b.key || a.f.label.localeCompare(b.f.label, 'fr'));

      const arc = (Rf * span) / list.length;
      list.forEach((it, i) => {
        const a = cursor + (span * (i + 0.5)) / list.length;
        const stagger = arc < CONFIG.staggerBelowArc && i % 2 ? 72 : 0;
        pos[it.f.id] = polar(a, Rf + stagger);
      });
      sectors.push({ group: g, label: model.groups[g].label, pos: polar(center, Rf + 150) });
      cursor += span + CONFIG.sectorGap;
    });

    // >1 when the graph is larger than the original single-ring prototype: labels scale with it
    const scale = Math.max(1, Rf / 900);
    return { pos, sectors, scale, dense: K > 1 };
  }

  /* =====================================================================
   * 3. INIT
   * ===================================================================== */
  function init(data) {
    const model = buildModel(data);
    const layout = computeLayout(model);
    const css = getComputedStyle(root);
    const tok = (name, fb) => css.getPropertyValue(name).trim() || fb;
    const INK = tok('--dl-ink', '#000'), PAPER = tok('--dl-paper', '#fff'),
      MUTE = tok('--dl-mute', '#8c8c8c');
    const FILL = { ink: INK, paper: PAPER, mute: MUTE };
    const font = css.fontFamily || 'Helvetica, Arial, sans-serif';

    /* ----- elements ----- */
    const elements = [];
    model.projects.forEach(p => {
      const img = p.thumb || p.image || '';
      const d = { id: p.id, label: p.label, kind: 'project' };
      if (img) d.image = img;            // never set an empty image: Cytoscape cannot parse background-image: ""
      elements.push({
        group: 'nodes', classes: img ? 'project has-image' : 'project',
        data: d, position: layout.pos[p.id]
      });
    });
    model.facets.forEach(f => {
      elements.push({
        group: 'nodes', classes: 'facet ' + f.group,
        data: { id: f.id, name: f.label, label: I.tag(f.label), kind: f.group },
        position: layout.pos[f.id]
      });
    });
    layout.sectors.forEach(s => {
      elements.push({
        group: 'nodes', classes: 'sector',
        data: { id: 'sector:' + s.group, group: s.group, name: s.label, label: I.group(s.group, s.label), kind: 'sector' },
        position: s.pos, selectable: false, grabbable: false
      });
    });
    model.edges.forEach(e => elements.push({ group: 'edges', classes: e.group, data: e }));

    /* ----- style ----- */
    const gs = g => model.groups[g] || {};
    const S = layout.scale;                       // 1 for the original small graph
    const edgeOpacity = model.edges.length > CONFIG.denseEdges ? 0.14 : 0.3;
    const style = [
      { selector: 'node', style: {
          'font-family': font, 'font-size': 10 * S, color: INK, 'text-wrap': 'wrap',
          'text-max-width': 96 * S, 'text-valign': 'bottom', 'text-halign': 'center',
          'text-margin-y': 6 * S, 'min-zoomed-font-size': 8, label: 'data(label)',
          'border-color': INK, 'border-width': 1.5 * S, 'background-color': PAPER,
          'transition-property': 'opacity, border-width', 'transition-duration': reduceMotion ? 0 : 120
      } },
      { selector: 'node.project', style: {
          shape: gs('project').shape || 'ellipse',
          width: gs('project').size || 76, height: gs('project').size || 76,
          'border-width': 2, 'font-size': 12, 'font-weight': 600,
          'text-max-width': layout.dense ? 104 : 130, 'text-margin-y': 6,
          // dense graphs: project titles appear once zoomed in enough for them not to collide
          'min-zoomed-font-size': layout.dense ? 12 : 8,
          'text-background-color': PAPER, 'text-background-opacity': 0.9, 'text-background-padding': 3,
          'z-index': 20
      } },
      { selector: 'node.project.has-image', style: {
          'background-image': 'data(image)', 'background-fit': 'cover', 'background-clip': 'node',
          // ArchiCGI images are served without CORS headers; load them as plain images
          // (the canvas is never read back, so a tainted canvas is fine)
          'background-image-crossorigin': 'null'
      } },
      { selector: 'node.sector', style: {
          width: 1, height: 1, 'background-opacity': 0, 'border-width': 0, color: MUTE,
          'font-size': 11 * (S > 1 ? S * 2.4 : 1), 'text-valign': 'center', 'text-margin-y': 0,
          'min-zoomed-font-size': 6, events: 'no', 'z-index': 1
      } },
      { selector: 'edge', style: {
          'curve-style': 'straight', width: 0.75 * S, 'line-color': INK, opacity: edgeOpacity,
          events: 'no', 'z-index': 2,
          'transition-property': 'opacity, width', 'transition-duration': reduceMotion ? 0 : 120
      } }
    ];
    model.facetGroups.forEach(g => {
      const d = gs(g);
      style.push({ selector: 'node.' + g, style: {
        shape: d.shape || 'ellipse', width: (d.size || 20) * S, height: (d.size || 20) * S,
        'background-color': FILL[d.fill] || PAPER, 'z-index': 10
      } });
      style.push({ selector: 'edge.' + g, style: { 'line-style': d.line || 'solid' } });
    });
    style.push(
      { selector: 'node.dim', style: { opacity: 0.14 } },
      { selector: 'edge.dim', style: { opacity: 0.05 } },
      { selector: 'edge.hl',  style: { opacity: 1, width: 1.75 * S, 'z-index': 15 } },
      { selector: 'node.sel', style: { 'border-width': 4 } },
      // search results: a halo around matching projects (does not interfere with dim/highlight states)
      { selector: 'node.project.hit', style: { 'underlay-color': INK, 'underlay-opacity': 0.28, 'underlay-padding': 9, 'underlay-shape': 'ellipse' } },
      { selector: 'node.out', style: { opacity: 0.07, events: 'no' } },
      { selector: 'edge.out', style: { opacity: 0.03 } }
    );

    /* ----- instance ----- */
    const cy = cytoscape({
      container: els.graph,
      elements, style,
      layout: { name: 'preset' },
      minZoom: 0.05, maxZoom: 4,
      userZoomingEnabled: true,     // kept for touch pinch; wheel is intercepted below
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      autounselectify: true,
      autoungrabify: !CONFIG.allowNodeDrag,
      selectionType: 'single'
    });
    const modelBB = cy.elements().boundingBox({ includeLabels: false });

    /* =================================================================
     * 4. VIEWPORT — bounded zoom, clamped pan, trackpad-aware wheel
     * ================================================================= */
    let clamping = false;
    function fitView() {
      cy.fit(cy.elements(), Math.min(CONFIG.fitPadding, els.graph.clientWidth * 0.06));
    }
    function updateLimits() {
      // zoom limits are derived from the fit zoom so they are sensible at any viewport size
      const prevZoom = cy.zoom(), prevPan = cy.pan();
      fitView();
      const fit = cy.zoom();
      cy.minZoom(fit * CONFIG.minZoomFactor);
      cy.maxZoom(Math.max(1.6, fit * CONFIG.maxZoomFactor));
      return { fit, prevZoom, prevPan };
    }
    function clampPan() {
      if (clamping) return;
      const z = cy.zoom(), w = cy.width(), hh = cy.height();
      const mx = Math.min(120, w * 0.25), my = Math.min(120, hh * 0.25);
      const p = cy.pan();
      const x = Math.min(w - mx - modelBB.x1 * z, Math.max(mx - modelBB.x2 * z, p.x));
      const y = Math.min(hh - my - modelBB.y1 * z, Math.max(my - modelBB.y2 * z, p.y));
      if (x !== p.x || y !== p.y) { clamping = true; cy.pan({ x, y }); clamping = false; }
    }
    cy.on('pan zoom', clampPan);

    function zoomBy(factor, pt) {
      const z = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
      cy.zoom({ level: z, renderedPosition: pt || { x: cy.width() / 2, y: cy.height() / 2 } });
    }

    // Capture on the parent so it runs before Cytoscape's own wheel handler and can stop it.
    // pinch (ctrlKey) or mouse wheel => zoom at cursor; two-finger trackpad scroll => pan.
    els.stage.addEventListener('wheel', e => {
      if (e.target.closest('.dl-controls, .dl-legend')) return;
      e.preventDefault(); e.stopPropagation();
      const r = els.graph.getBoundingClientRect();
      const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        zoomBy(Math.exp(-dy * (e.ctrlKey && !mouseWheel ? 0.01 : 0.0012)), pt);
      } else {
        cy.panBy({ x: -dx, y: -dy });
      }
    }, { passive: false, capture: true });

    // Safari desktop pinch
    let gestureStart = 1;
    els.stage.addEventListener('gesturestart', e => { e.preventDefault(); gestureStart = cy.zoom(); });
    els.stage.addEventListener('gesturechange', e => {
      e.preventDefault();
      const r = els.graph.getBoundingClientRect();
      const pt = e.clientX != null ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      zoomBy((gestureStart * e.scale) / cy.zoom(), pt);
    });

    /* ----- controls & hint ----- */
    const hint = h('p', { class: 'dl-hint' }, I.t('g.hint'));
    const fsBtn = h('button', { type: 'button', class: 'dl-fs', onclick: () => (isFull() ? exitFull() : enterFull()) });
    const zoomIn = h('button', { type: 'button', onclick: () => zoomBy(1.3) }, '+');
    const zoomOut = h('button', { type: 'button', onclick: () => zoomBy(1 / 1.3) }, '\u2212');
    const resetBtn = h('button', { type: 'button', onclick: fitView });
    const controls = h('div', { class: 'dl-controls', role: 'group' }, fsBtn, zoomIn, zoomOut, resetBtn);
    function labelControls() {
      controls.setAttribute('aria-label', I.t('g.controls'));
      zoomIn.setAttribute('aria-label', I.t('g.zoomIn'));
      zoomOut.setAttribute('aria-label', I.t('g.zoomOut'));
      resetBtn.setAttribute('aria-label', I.t('g.reset'));
      resetBtn.textContent = I.t('g.resetText');
      hint.textContent = I.t('g.hint');
    }
    labelControls();
    let legend = null;
    legend = buildLegend();
    els.stage.append(hint, controls, legend);

    /* ----- full screen: the whole lab (filters + graph + panel) -----
     * Native Fullscreen API where the browser allows it on an element; otherwise
     * (iPhone Safari, embedded frames) a fixed overlay covering the viewport. */
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const canNativeFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
      !!(root.requestFullscreen || root.webkitRequestFullscreen);
    const isFull = () => root.classList.contains('is-full');
    function setFull(on, pseudo) {
      root.classList.toggle('is-full', on);
      root.classList.toggle('is-pseudo-full', on && !!pseudo);
      document.documentElement.classList.toggle('dl-noscroll', on && !!pseudo);
      const label = I.t(on ? 'g.fsOff' : 'g.fsOn');
      fsBtn.setAttribute('aria-label', label);
      fsBtn.setAttribute('title', label);
      fsBtn.setAttribute('aria-pressed', String(on));
      const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', on ? 'M6 2v4H2M10 2v4h4M10 14v-4h4M6 14v-4H2' : 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4');
      svg.append(path);
      fsBtn.replaceChildren(svg);
    }
    function enterFull() {
      if (canNativeFs) {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        const r = req.call(root);
        if (r && typeof r.catch === 'function') r.catch(() => setFull(true, true));   // refused: overlay instead
        return;
      }
      setFull(true, true);
    }
    function exitFull() {
      if (fsEl() === root) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else setFull(false);
    }
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, () => {
      if (fsEl() === root) setFull(true, false);
      else if (!root.classList.contains('is-pseudo-full')) setFull(false);
    }));
    // Escape closes the overlay (native full screen handles Escape itself); a selection is cleared first
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !e.defaultPrevented && root.classList.contains('is-pseudo-full')) setFull(false);
    });
    setFull(false);
    // Remove the hint on the first real user interaction (not on the programmatic initial fit)
    const dropHint = () => {
      hint.remove();
      ['pointerdown', 'wheel'].forEach(t => els.stage.removeEventListener(t, dropHint, true));
    };
    ['pointerdown', 'wheel'].forEach(t => els.stage.addEventListener(t, dropHint, { capture: true, passive: true }));

    /* ----- legend ----- */
    function buildLegend() {
      const NS = 'http://www.w3.org/2000/svg';
      const shapes = {
        ellipse: '<circle cx="8" cy="8" r="6"/>', rectangle: '<rect x="2" y="2" width="12" height="12"/>',
        'round-rectangle': '<rect x="2" y="3" width="12" height="10" rx="3"/>',
        diamond: '<polygon points="8,1 15,8 8,15 1,8"/>',
        hexagon: '<polygon points="4,2 12,2 15,8 12,14 4,14 1,8"/>',
        triangle: '<polygon points="8,2 15,14 1,14"/>'
      };
      const glyph = g => {
        const d = gs(g), svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = shapes[d.shape] || shapes.ellipse;      // static strings only
        svg.firstChild.setAttribute('fill', FILL[d.fill] || PAPER);
        svg.firstChild.setAttribute('stroke', INK); svg.firstChild.setAttribute('stroke-width', '1.5');
        return svg;
      };
      const groups = ['project', ...model.activeGroups];
      const el = h('details', { class: 'dl-legend' },
        h('summary', {}, I.t('g.legend')),
        h('ul', {}, groups.map(g => h('li', {}, glyph(g), I.group(g, gs(g).label || g)))));
      el.open = legend ? legend.open : window.matchMedia('(min-width: 640px)').matches;
      return el;
    }

    /* =================================================================
     * 5. STATES — hover / selection / filter. None of them move the camera.
     * ================================================================= */
    let selectedId = null;
    let activeFilter = 'all';

    function clearHighlight() { cy.elements().removeClass('dim hl sel'); }
    function highlight(node, selected) {
      clearHighlight();
      const nb = node.closedNeighborhood();
      cy.elements().not('.sector').addClass('dim');
      nb.removeClass('dim').addClass('hl');
      if (selected) node.addClass('sel');
    }
    function select(id) {
      const node = cy.getElementById(id);
      if (!node.nonempty() || node.hasClass('out') || node.hasClass('sector')) return;
      selectedId = id;
      highlight(node, true);
      renderPanel(node);
      try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (_) { /* file:// */ }
    }
    function clearSelection() {
      selectedId = null;
      clearHighlight();
      renderPanel(null);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* noop */ }
    }

    cy.on('tap', 'node.project, node.facet', e => select(e.target.id()));
    cy.on('tap', e => { if (e.target === cy) clearSelection(); });
    cy.on('mouseover', 'node.project, node.facet', e => {
      els.graph.style.cursor = 'pointer';
      if (canHover && !selectedId) highlight(e.target, false);
    });
    cy.on('mouseout', 'node.project, node.facet', () => {
      els.graph.style.cursor = '';
      if (canHover && !selectedId) clearHighlight();
    });
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && selectedId) { clearSelection(); e.preventDefault(); } });

    function applyFilter(id) {
      activeFilter = id;
      selectedId = null;
      cy.batch(() => {
        cy.elements().removeClass('dim hl sel out');
        if (id !== 'all') {
          const keep = cy.nodes('.project').filter(n => (model.projectById.get(n.id()).filters || []).includes(id));
          cy.nodes('.project').not(keep).addClass('out');
          cy.nodes('.facet').forEach(f => { if (f.neighborhood('node.project').intersection(keep).empty()) f.addClass('out'); });
          cy.edges().forEach(e => { if (e.source().hasClass('out') || e.target().hasClass('out')) e.addClass('out'); });
        }
      });
      [...els.filters.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
      renderPanel(null);
    }

    /* ----- filter chips ----- */
    if (els.filters) {
      const chips = [{ id: 'all', label: 'Tout' }, ...model.filters];
      els.filters.replaceChildren(...chips.map(c =>
        h('button', { type: 'button', class: 'dl-chip', 'data-id': c.id,
          'aria-pressed': String(c.id === 'all'), onclick: () => applyFilter(c.id) }, I.filter(c.id, c.label))));
    }

    /* =================================================================
     * 6. PANEL
     * ================================================================= */
    const nodeButton = n => h('button', { type: 'button', class: 'dl-tag', onclick: () => select(n.id()) }, n.data('label'));
    const extLink = (url, text, cls) => safeUrl(url)
      ? h('a', { class: cls, href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer' }, text) : null;
    // Why a project carries an editorial tag: the published word it was derived from (quoted as published)
    function whyText(p, key) {
      const w = p && p.why && p.why[key];
      return w ? I.quote(w[1]) + ' \u00b7 ' + I.t('field.' + w[0]) : I.t('why.fallback');
    }
    const facetKey = f => f.data('kind') + ':' + f.data('name');   // canonical key, independent of language
    const byLabel = (a, b) => a.data('label').localeCompare(b.data('label'), I.lang);

    // Long lists (hundreds of projects) are revealed in steps instead of all at once.
    // reason(node) optionally adds a short line explaining the link.
    function nodeList(nodes, reason) {
      const ul = h('ul', { class: reason ? 'dl-reasons' : null });
      let shown = 0;
      const more = h('button', { type: 'button', class: 'dl-more', onclick: () => step() });
      function step() {
        nodes.slice(shown, shown + CONFIG.listStep).forEach(n => ul.append(
          h('li', {}, nodeButton(n), reason ? h('span', { class: 'dl-why' }, reason(n)) : null)));
        shown = Math.min(nodes.length, shown + CONFIG.listStep);
        const rest = nodes.length - shown;
        if (rest > 0) more.textContent = I.t('g.more', { k: Math.min(rest, CONFIG.listStep), rest });
        else more.remove();
      }
      step();
      return nodes.length > CONFIG.listStep ? [ul, more] : [ul];
    }

    function renderPanel(node) {
      els.panel.replaceChildren();
      if (!node) {
        const visible = model.projects.filter(p => activeFilter === 'all' || (p.filters || []).includes(activeFilter));
        const f = model.filters.find(x => x.id === activeFilter);
        els.panel.append(
          h('h2', {}, I.t('g.listTitle')),
          h('p', {}, I.t('g.listIntro', { n: visible.length, filter: f ? I.filter(f.id, f.label) : '' })),
          ...nodeList(visible.map(p => cy.getElementById(p.id))));
        return;
      }
      const back = h('button', { type: 'button', class: 'dl-back', onclick: clearSelection }, I.t('g.back'));
      if (node.hasClass('project')) {
        const p = model.projectById.get(node.id());
        const pub = p.published || {};
        const parts = [back];
        if (p.image) {
          parts.push(h('figure', {},
            h('img', { src: p.image, alt: p.imageAlt || p.label, loading: 'lazy', decoding: 'async',
              onerror: e => { const f = e.target.closest('figure'); if (f) f.remove(); } }),   // unreachable image: show no figure
            p.credit ? h('figcaption', {}, p.credit) : null));
        }
        parts.push(h('h2', {}, p.label));

        // Published by ArchiCGI (verbatim)
        const src = h('div', { class: 'dl-published' }, h('h3', {}, I.t('g.published')));
        if (pub.categories && pub.categories.length) {
          src.append(h('p', {}, I.t('g.category', { list: pub.categories.join(', ') })));
        }
        if (pub.frCaption) {
          src.append(h('p', {}, I.t('g.frCaption', { q: I.quote(pub.frCaption) })));
        }
        if (pub.alsoPublishedAs && pub.alsoPublishedAs.length) {
          src.append(h('p', {}, I.t('g.alsoPublished')),
            h('ul', {}, pub.alsoPublishedAs.map(d => h('li', {}, extLink(d.pageUrl, d.title, 'dl-tag') || d.title))));
        }
        if (pub.pageRedirectsTo) {
          src.append(h('p', {}, I.t('g.redirect')));
        }
        if (src.children.length > 1) parts.push(src);     // only when the record carries published details

        // Editorial classification (this prototype), each tag with the published word it comes from
        const ed = model.activeGroups.map(g => {
          const items = node.neighborhood('node.' + g).toArray().sort(byLabel);
          return items.length ? [h('h3', {}, I.group(g, model.groups[g].label)),
            h('ul', { class: 'dl-reasons' }, items.map(n => h('li', {}, nodeButton(n), h('span', { class: 'dl-why' }, whyText(p, facetKey(n))))))] : [];
        }).flat();
        if (ed.length) {
          parts.push(h('div', { class: 'dl-editorial' },
            h('p', { class: 'dl-note' }, I.t('g.editorialNote')),
            ...ed));
        }

        // Nearest projects: the ones sharing the most (and rarest) editorial tags
        const near = related(node, 6);
        if (near.length) {
          parts.push(h('div', { class: 'dl-near' },
            h('h3', {}, I.t('g.near')),
            h('p', { class: 'dl-note' }, I.t('g.nearNote')),
            h('ul', { class: 'dl-reasons' }, near.map(r => h('li', {}, nodeButton(r.node),
              h('span', { class: 'dl-why' }, I.t('g.shared', { list: r.shared.join(' \u00b7 ') })))))));
        }
        parts.push(extLink(p.url, I.t(pub.pageRedirectsTo ? 'g.viewPortfolio' : 'g.viewProject'), 'dl-link'));
        if (pub.frPage) parts.push(extLink(pub.frPage, I.t('g.viewFr'), 'dl-link dl-link--alt'));
        if (window.discoveryBrief) {
          const inBrief = window.discoveryBrief.has(p.id);
          parts.push(h('button', { type: 'button', class: 'dl-link dl-link--alt dl-brief-toggle', 'aria-pressed': String(inBrief),
            onclick: () => { window.discoveryBrief.toggle(p.id); renderPanel(node); } },
            I.t(inBrief ? 'g.briefRemove' : 'g.briefAdd')));
        }
        els.panel.append(...parts.filter(Boolean));
      } else {
        const items = node.neighborhood('node.project').not('.out').toArray();
        const key = facetKey(node);
        els.panel.append(back,
          h('h3', {}, I.t('g.facetKind', { group: I.group(node.data('kind'), model.groups[node.data('kind')].label) })),
          h('h2', {}, node.data('label')),
          h('p', {}, I.t('g.facetCount', { n: items.length })),
          ...nodeList(items, n => whyText(model.projectById.get(n.id()), key)));
      }
    }

    function related(node, k) {
      const N = model.projects.length, score = new Map(), shared = new Map();
      node.neighborhood('node.facet').forEach(f => {
        const ps = f.neighborhood('node.project').not(node).not('.out');
        const w = Math.log((N + 1) / (ps.length + 1));
        ps.forEach(q => {
          const id = q.id();
          score.set(id, (score.get(id) || 0) + w);
          if (!shared.has(id)) shared.set(id, []);
          shared.get(id).push(f.data('label'));
        });
      });
      return [...score].filter(([id]) => shared.get(id).length >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k)
        .map(([id]) => ({ node: cy.getElementById(id), shared: shared.get(id) }));
    }

    /* =================================================================
     * 7. RESPONSIVE — never re-fit on selection; only on real size changes
     * ================================================================= */
    let lastW = 0, lastH = 0, raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = els.graph.clientWidth, hh = els.graph.clientHeight;
        if (!w || !hh || (w === lastW && hh === lastH)) return;
        const first = lastW === 0;
        const wasFit = first || Math.abs(cy.zoom() - cy.minZoom() / CONFIG.minZoomFactor) < 1e-3;
        lastW = w; lastH = hh;
        cy.resize();
        const { prevZoom, prevPan } = updateLimits();
        if (!wasFit) { cy.viewport({ zoom: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), prevZoom)), pan: prevPan }); }
        clampPan();
      });
    });
    ro.observe(els.graph);

    /* ----- boot ----- */
    renderPanel(null);
    const initial = decodeURIComponent(location.hash.slice(1));
    if (initial) select(initial);

    /* ----- language change: relabel in place (filter, selection and viewport are kept) ----- */
    document.addEventListener('discovery:lang', () => {
      cy.batch(() => {
        cy.nodes('.facet').forEach(n => { n.data('label', I.tag(n.data('name'))); });
        cy.nodes('.sector').forEach(n => { n.data('label', I.group(n.data('group'), n.data('name'))); });
      });
      [...els.filters.children].forEach(b => {
        const f = model.filters.find(x => x.id === b.dataset.id);
        b.textContent = I.filter(b.dataset.id, f ? f.label : 'Tout');
      });
      labelControls();
      setFull(isFull(), root.classList.contains('is-pseudo-full'));
      const fresh = buildLegend();
      legend.replaceWith(fresh); legend = fresh;
      refreshPanel();
    });

    // Public hooks (search & brief module, debugging)
    function showProject(id) {
      const n = cy.getElementById(id);
      if (!n.nonempty()) return false;
      if (n.hasClass('out')) applyFilter('all');
      select(id);
      return true;
    }
    function setHits(ids) {
      const set = new Set(ids || []);
      cy.batch(() => { cy.nodes('.project').forEach(n => { n.toggleClass('hit', set.has(n.id())); }); });
    }
    const refreshPanel = () => renderPanel(selectedId ? cy.getElementById(selectedId) : null);
    window.discoveryGraph = { cy, select, clearSelection, fit: fitView, showProject, setHits, refreshPanel,
      projects: model.projects, groups: model.groups, stage: els.stage };
    document.dispatchEvent(new CustomEvent('discovery:ready'));
  }
})();