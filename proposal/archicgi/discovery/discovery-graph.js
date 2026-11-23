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
    ringGap: 240,           // distance between project ring and facet ring
    sectorGap: 0.14,        // radians between facet sectors
    staggerBelowArc: 84     // px of arc per facet below which labels alternate radius
  };

  const root = document.getElementById('discovery-graph');
  const els = {
    filters: document.getElementById('dl-filters'),
    stage: document.getElementById('dl-stage'),
    graph: document.getElementById('dl-graph'),
    panel: document.getElementById('dl-panel')
  };
  if (!root || !els.graph || !els.panel || !els.stage || typeof cytoscape === 'undefined') return;

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
    .then(init)
    .catch(err => {
      console.error('[discovery]', err);
      els.graph.replaceChildren(h('p', { class: 'dl-error' },
        'Impossible de charger les données du graphe.'));
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
    const Rp = Math.max(CONFIG.ringProjectMin, n * CONFIG.ringProjectPerNode);
    const Rf = Rp + CONFIG.ringGap;
    const pos = {};
    const polar = (a, r) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
    const wrap = a => { while (a > Math.PI) a -= TAU; while (a <= -Math.PI) a += TAU; return a; };

    const pAngle = new Map();
    model.projects.forEach((p, i) => {
      const a = -Math.PI / 2 + (TAU * i) / n;
      pAngle.set(p.id, a);
      pos[p.id] = n === 1 ? { x: 0, y: 0 } : polar(a, Rp);
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

    return { pos, sectors };
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
      elements.push({
        group: 'nodes', classes: 'project',
        data: { id: p.id, label: p.label, kind: 'project', image: p.thumb || p.image || '' },
        position: layout.pos[p.id]
      });
    });
    model.facets.forEach(f => {
      elements.push({
        group: 'nodes', classes: 'facet ' + f.group,
        data: { id: f.id, label: f.label, kind: f.group },
        position: layout.pos[f.id]
      });
    });
    layout.sectors.forEach(s => {
      elements.push({
        group: 'nodes', classes: 'sector',
        data: { id: 'sector:' + s.group, label: s.label, kind: 'sector' },
        position: s.pos, selectable: false, grabbable: false
      });
    });
    model.edges.forEach(e => elements.push({ group: 'edges', classes: e.group, data: e }));

    /* ----- style ----- */
    const gs = g => model.groups[g] || {};
    const style = [
      { selector: 'node', style: {
          'font-family': font, 'font-size': 10, color: INK, 'text-wrap': 'wrap',
          'text-max-width': 96, 'text-valign': 'bottom', 'text-halign': 'center',
          'text-margin-y': 6, 'min-zoomed-font-size': 8, label: 'data(label)',
          'border-color': INK, 'border-width': 1.5, 'background-color': PAPER,
          'transition-property': 'opacity, border-width', 'transition-duration': reduceMotion ? 0 : 120
      } },
      { selector: 'node.project', style: {
          shape: gs('project').shape || 'ellipse',
          width: gs('project').size || 76, height: gs('project').size || 76,
          'border-width': 2, 'font-size': 12, 'font-weight': 600, 'text-max-width': 130,
          'text-background-color': PAPER, 'text-background-opacity': 0.9, 'text-background-padding': 3,
          'z-index': 20
      } },
      { selector: 'node.project[image]', style: {
          'background-image': 'data(image)', 'background-fit': 'cover', 'background-clip': 'node'
      } },
      { selector: 'node.sector', style: {
          width: 1, height: 1, 'background-opacity': 0, 'border-width': 0, color: MUTE,
          'font-size': 11, 'text-valign': 'center', 'text-margin-y': 0, 'min-zoomed-font-size': 6,
          events: 'no', 'z-index': 1
      } },
      { selector: 'edge', style: {
          'curve-style': 'straight', width: 0.75, 'line-color': INK, opacity: 0.3,
          events: 'no', 'z-index': 2,
          'transition-property': 'opacity, width', 'transition-duration': reduceMotion ? 0 : 120
      } }
    ];
    model.facetGroups.forEach(g => {
      const d = gs(g);
      style.push({ selector: 'node.' + g, style: {
        shape: d.shape || 'ellipse', width: d.size || 20, height: d.size || 20,
        'background-color': FILL[d.fill] || PAPER, 'z-index': 10
      } });
      style.push({ selector: 'edge.' + g, style: { 'line-style': d.line || 'solid' } });
    });
    style.push(
      { selector: 'node.dim', style: { opacity: 0.14 } },
      { selector: 'edge.dim', style: { opacity: 0.05 } },
      { selector: 'edge.hl',  style: { opacity: 1, width: 1.75, 'z-index': 15 } },
      { selector: 'node.sel', style: { 'border-width': 4 } },
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
    const hint = h('p', { class: 'dl-hint' },
      'Glissez pour déplacer. Pincez ou faites défiler pour zoomer.');
    const controls = h('div', { class: 'dl-controls', role: 'group', 'aria-label': 'Contrôles de la vue' },
      h('button', { type: 'button', 'aria-label': 'Zoom avant', onclick: () => zoomBy(1.3) }, '+'),
      h('button', { type: 'button', 'aria-label': 'Zoom arrière', onclick: () => zoomBy(1 / 1.3) }, '\u2212'),
      h('button', { type: 'button', 'aria-label': 'Réinitialiser la vue', onclick: fitView }, 'Tout'));
    els.stage.append(hint, controls, buildLegend());
    const dropHint = () => { hint.remove(); cy.off('viewport', dropHint); };
    cy.on('viewport', dropHint);

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
        h('summary', {}, 'Légende'),
        h('ul', {}, groups.map(g => h('li', {}, glyph(g), gs(g).label || g))));
      el.open = window.matchMedia('(min-width: 640px)').matches;
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
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && selectedId) clearSelection(); });

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
          'aria-pressed': String(c.id === 'all'), onclick: () => applyFilter(c.id) }, c.label)));
    }

    /* =================================================================
     * 6. PANEL
     * ================================================================= */
    const nodeButton = n => h('button', { type: 'button', class: 'dl-tag', onclick: () => select(n.id()) }, n.data('label'));

    function renderPanel(node) {
      els.panel.replaceChildren();
      if (!node) {
        const visible = model.projects.filter(p => activeFilter === 'all' || (p.filters || []).includes(activeFilter));
        els.panel.append(
          h('h2', {}, 'Sélectionnez un projet.'),
          h('p', {}, 'Les connexions relient les exemples de la page française aux catégories éditoriales de ce prototype.'),
          h('ul', {}, visible.map(p => h('li', {}, nodeButton(cy.getElementById(p.id))))));
        return;
      }
      const back = h('button', { type: 'button', class: 'dl-back', onclick: clearSelection }, 'Retour à la liste');
      if (node.hasClass('project')) {
        const p = model.projectById.get(node.id());
        const parts = [back];
        if (p.image) {
          parts.push(h('figure', {},
            h('img', { src: p.image, alt: p.imageAlt || p.label, loading: 'lazy', decoding: 'async' }),
            p.credit ? h('figcaption', {}, p.credit) : null));
        }
        parts.push(h('h2', {}, p.label));
        model.activeGroups.forEach(g => {
          const items = node.neighborhood('node.' + g).toArray().sort((a, b) => a.data('label').localeCompare(b.data('label'), 'fr'));
          if (items.length) parts.push(h('h3', {}, model.groups[g].label), h('ul', {}, items.map(n => h('li', {}, nodeButton(n)))));
        });
        if (safeUrl(p.url)) parts.push(h('a', { class: 'dl-link', href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur ArchiCGI'));
        els.panel.append(...parts);
      } else {
        const items = node.neighborhood('node.project').toArray();
        els.panel.append(back,
          h('h3', {}, model.groups[node.data('kind')].label),
          h('h2', {}, node.data('label')),
          h('p', {}, items.length + (items.length > 1 ? ' projets liés' : ' projet lié')),
          h('ul', {}, items.map(n => h('li', {}, nodeButton(n)))));
      }
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

    // Debug / future hooks
    window.discoveryGraph = { cy, select, clearSelection, fit: fitView };
  }
})();