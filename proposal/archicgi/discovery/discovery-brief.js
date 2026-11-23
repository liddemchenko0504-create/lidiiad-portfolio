/*
 * ArchiCGI Discovery Lab — from a request to a brief
 * 1. Plain-language search (French or English) over published titles, image descriptions,
 *    ArchiCGI categories and the editorial tags.
 * 2. Explained results: what matched, where it comes from, what the data does not say.
 * 3. Card -> graph (window.discoveryGraph.showProject).
 * 4. A selection of frames annotated for a brief, copied with source links.
 *
 * Needs discovery-graph.js (it dispatches `discovery:ready` and exposes window.discoveryGraph).
 * Required DOM: #dl-search, #dl-brief. Text only: never innerHTML with data.
 */
(() => {
  'use strict';

  const els = { search: document.getElementById('dl-search'), brief: document.getElementById('dl-brief') };
  if (!els.search || !els.brief) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RESULTS_STEP = 9;
  const STORE_KEY = 'dl-brief-v1';

  /* ---------- helpers ---------- */
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
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`\-_/]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // one regex for a list of terms; the last word may take a plural / feminine ending
  const termRx = terms => new RegExp('\\b(?:' + terms.map(t => norm(t).split(' ').map(esc).join(' ') + '(?:s|es|x|e)?')
    .join('|') + ')\\b', 'g');
  const plural = (k, one, many) => k + ' ' + (k > 1 ? many : one);

  /* =====================================================================
   * 1. LEXICON — what a phrase means in the catalogue
   *    q: words recognised in the request (French and English)
   *    t: words looked for in ArchiCGI's published text (titles and image descriptions are in English)
   *    tags: editorial tags (group:label) that satisfy the criterion
   *    near: tags that come close (partial match)
   *    cat: ArchiCGI portfolio category that satisfies it
   * ===================================================================== */
  const DIM = {
    typology: 'type de bâtiment', inout: 'intérieur / extérieur', camera: 'angle de vue', context: 'environnement',
    lighting: 'lumière', style: 'style', material: 'matériau', space: 'espace', media: 'média', place: 'lieu', text: 'texte'
  };
  // how much each kind of criterion weighs in the ranking: the subject first, then its setting
  const DIM_WEIGHT = { typology: 1.6, inout: 1.2, context: 1.2, place: 1.2, camera: 1, lighting: 1, space: 1, media: 1, text: 1, style: 0.8, material: 0.8 };
  const EXCLUSIVE = new Set(['typology', 'inout', 'camera', 'lighting', 'media']);
  const CAMERA_TAGS = ['Vue aérienne', 'Vue rapprochée', 'Vue de rue', 'Façade', 'Vue arrière ou latérale'];
  const C = (id, dim, label, tags, q, t, extra) => Object.assign({ id, dim, label, tags, q, t }, extra || {});
  const LEXICON = [
    // building type
    C('house', 'typology', 'Maison', ['typology:Maison & villa'],
      ['maison', 'villa', 'demeure', 'residence', 'manoir', 'pavillon', 'maison individuelle', 'house', 'home', 'mansion', 'cottage', 'estate'],
      ['house', 'home', 'villa', 'mansion', 'residence', 'cottage', 'barndominium', 'farm house']),
    C('cabin', 'typology', 'Cabane ou chalet', ['typology:Cabane & chalet'],
      ['cabane', 'chalet', 'refuge', 'lodge', 'glamping', 'cabin'], ['cabin', 'lodge', 'chalet', 'glamping']),
    C('townhouse', 'typology', 'Maison de ville', ['typology:Maison de ville'],
      ['maison de ville', 'maisons de ville', 'maison mitoyenne', 'maisons en bande', 'townhouse', 'townhome', 'row house'],
      ['townhouse', 'townhome']),
    C('apartment', 'typology', 'Immeuble de logements', ['typology:Immeuble résidentiel'],
      ['immeuble', 'appartement', 'logement collectif', 'logements collectifs', 'residence collective', 'copropriete', 'condo',
        'apartment', 'apartment building', 'condominium', 'multifamily', 'mid rise', 'penthouse'],
      ['apartment', 'condominium', 'condo', 'multifamily', 'mid rise', 'penthouse', 'residential building']),
    C('district', 'typology', 'Quartier ou lotissement', ['typology:Quartier & lotissement'],
      ['quartier', 'lotissement', 'ensemble residentiel', 'communaute', 'community', 'neighborhood', 'subdivision', 'development'],
      ['community', 'communities', 'neighborhood', 'subdivision', 'development']),
    C('hotel', 'typology', 'Hôtel ou resort', ['typology:Hôtel & resort'],
      ['hotel', 'resort', 'hotellerie', 'complexe hotelier', 'hospitality'], ['hotel', 'resort', 'hospitality']),
    C('restaurant', 'typology', 'Restaurant ou bar', ['typology:Restaurant & bar'],
      ['restaurant', 'bar', 'cafe', 'brasserie', 'bistrot', 'glacier'], ['restaurant', 'bar', 'gastrobar', 'cafe', 'ice cream']),
    C('office', 'typology', 'Bureaux ou commerce', ['typology:Bureaux & commerce'],
      ['bureau', 'bureaux', 'commerce', 'commercial', 'boutique', 'magasin', 'mixte', 'office', 'retail', 'shop', 'mixed use'],
      ['office', 'commercial', 'business center', 'mixed use', 'storefront', 'shop']),
    C('public', 'typology', 'Équipement ou loisirs', ['typology:Équipement & loisirs'],
      ['equipement', 'eglise', 'musee', 'bibliotheque', 'theatre', 'salle de sport', 'gymnase', 'stade', 'golf', 'gare', 'pont',
        'centre medical', 'salle de reception', 'church', 'museum', 'library', 'theater', 'gym', 'stadium', 'station', 'bridge'],
      ['church', 'museum', 'library', 'theater', 'theatre', 'gym', 'fitness', 'sports', 'golf', 'station', 'bridge', 'venue', 'clubhouse']),
    C('industrial', 'typology', 'Bâtiment industriel', ['typology:Industriel'],
      ['usine', 'entrepot', 'industriel', 'industrielle', 'factory', 'warehouse', 'industrial'], ['factory', 'warehouse', 'industrial', 'plant']),
    C('tower', 'typology', 'Tour ou gratte-ciel', ['typology:Tour & gratte-ciel'],
      ['gratte ciel', 'tour', 'tours', 'grande hauteur', 'skyscraper', 'high rise', 'tower'], ['skyscraper', 'high rise', 'tower']),
    // inside / outside
    C('exterior', 'inout', 'Vue extérieure', ['view:Extérieur'], ['exterieur', 'exterieure', 'dehors', 'exterior', 'outdoor'], ['exterior'],
      { cat: 'Exterior Rendering' }),
    C('interior', 'inout', 'Vue intérieure', ['view:Intérieur'], ['interieur', 'interieure', 'dedans', 'interior', 'indoor'], ['interior'],
      { cat: 'Interior Rendering' }),
    // camera
    C('aerial', 'camera', 'Vue aérienne', ['view:Vue aérienne'],
      ['vue aerienne', 'aerienne', 'vue du ciel', 'vue d oiseau', 'vol d oiseau', 'vue plongeante', 'vue de dessus', 'drone', 'aerial', 'bird eye', 'birds eye', 'top view'],
      ['aerial', 'bird eye', 'bird view', 'top view', 'drone', 'from above']),
    C('eye', 'camera', 'Vue à hauteur d’homme', ['view:Vue de rue', 'view:Façade'],
      ['vue depuis le sol', 'depuis le sol', 'au niveau du sol', 'niveau du sol', 'hauteur d homme', 'hauteur des yeux', 'vue a hauteur',
        'vue pieton', 'vue pietonne', 'point de vue pieton', 'vue de rue', 'vue frontale', 'eye level', 'street level', 'ground level',
        'street view', 'pedestrian view', 'front view'],
      ['eye level', 'street view', 'front view', 'pedestrian']),   // not 'ground level': it describes garages, not the camera
    C('closeup', 'camera', 'Gros plan', ['view:Vue rapprochée'], ['gros plan', 'vue rapprochee', 'plan rapproche', 'close up', 'closeup'], ['close up']),
    // surroundings
    C('water', 'context', 'Au bord de l’eau', ['context:Bord de mer', 'context:Lac & rivière', 'context:Front d’eau'],
      ['bord de l eau', 'au bord de l eau', 'pres de l eau', 'face a l eau', 'les pieds dans l eau', 'front d eau', 'waterfront', 'waterside', 'by the water'],
      ['waterfront', 'waterside', 'lakeside', 'lake', 'seaside', 'seafront', 'oceanfront', 'ocean', 'sea', 'beach', 'beachfront', 'coastal', 'river']),
    C('sea', 'context', 'Bord de mer', ['context:Bord de mer'],
      ['bord de mer', 'mer', 'ocean', 'plage', 'littoral', 'front de mer', 'seaside', 'beach', 'sea', 'oceanfront', 'coastal'],
      ['seaside', 'seafront', 'oceanfront', 'ocean', 'sea', 'beach', 'beachfront', 'coastal', 'coastline']),
    C('lake', 'context', 'Lac ou rivière', ['context:Lac & rivière'],
      ['lac', 'riviere', 'fleuve', 'canal', 'lake', 'lakeside', 'river'], ['lake', 'lakeside', 'river', 'waterway']),
    C('mountain', 'context', 'Montagne', ['context:Montagne'], ['montagne', 'alpin', 'alpine', 'mountain'], ['mountain', 'alpine', 'chalet']),
    C('forest', 'context', 'Forêt ou nature', ['context:Forêt & nature'],
      ['foret', 'sous bois', 'dans les bois', 'au milieu des bois', 'nature', 'campagne', 'rural', 'forest', 'woods', 'countryside'], ['forest', 'woods', 'wooded', 'rural', 'wilderness']),
    C('city', 'context', 'En ville', ['context:Ville'], ['ville', 'urbain', 'urbaine', 'rue', 'centre ville', 'city', 'urban', 'street', 'downtown'],
      ['city', 'urban', 'street', 'downtown', 'skyline']),
    C('suburb', 'context', 'Banlieue', ['context:Banlieue'], ['banlieue', 'periurbain', 'suburb', 'suburban'], ['suburb', 'suburban', 'neighborhood']),
    C('tropical', 'context', 'Tropical', ['context:Tropical'], ['tropical', 'tropicale', 'tropiques', 'caraibes'], ['tropical', 'caribbean', 'thatched']),
    C('snow', 'context', 'Neige ou hiver', ['context:Hiver & neige'], ['neige', 'enneige', 'hiver', 'hivernal', 'snow', 'snowy', 'winter'], ['snow', 'snowy', 'winter']),
    C('autumn', 'context', 'Automne', ['context:Automne'], ['automne', 'automnal', 'autumn', 'fall'], ['autumn']),
    // light
    C('dusk', 'lighting', 'Crépuscule', ['lighting:Crépuscule & soir'],
      ['crepuscule', 'coucher de soleil', 'soleil couchant', 'fin de journee', 'heure bleue', 'heure doree', 'soir', 'soiree', 'tombee de la nuit',
        'dusk', 'sunset', 'twilight', 'evening', 'golden hour', 'blue hour'],
      ['dusk', 'sunset', 'twilight', 'evening'], { near: ['lighting:Nuit'] }),
    C('night', 'lighting', 'Nuit', ['lighting:Nuit'], ['nuit', 'nocturne', 'de nuit', 'night', 'nighttime'], ['night', 'nighttime'],
      { near: ['lighting:Crépuscule & soir'] }),
    C('day', 'lighting', 'Lumière du jour', ['lighting:Lumière du jour'],
      ['jour', 'journee', 'plein jour', 'ensoleille', 'ensoleillee', 'soleil', 'lumiere naturelle', 'daylight', 'sunlit', 'sunny', 'daytime'],
      ['daylight', 'sunlit', 'sunny']),
    // style
    C('modern', 'style', 'Contemporain', ['style:Moderne & contemporain'],
      ['contemporain', 'contemporaine', 'moderne', 'minimaliste', 'epure', 'epuree', 'modern', 'contemporary', 'minimalist', 'sleek'],
      ['modern', 'contemporary', 'minimalist', 'sleek']),
    C('mediterranean', 'style', 'Méditerranéen', ['style:Méditerranéen'], ['mediterraneen', 'mediterraneenne', 'mediterranean'], ['mediterranean']),
    C('classic', 'style', 'Classique', ['style:Classique & traditionnel'],
      ['classique', 'traditionnel', 'traditionnelle', 'colonial', 'victorien', 'victorienne', 'neoclassique', 'classic', 'traditional', 'victorian', 'neoclassical', 'tudor'],
      ['classic', 'traditional', 'colonial', 'victorian', 'neoclassical', 'tudor']),
    C('rustic', 'style', 'Rustique', ['style:Rustique'], ['rustique', 'ferme', 'grange', 'rustic', 'farmhouse', 'barn'], ['rustic', 'barndominium', 'farm house', 'farmhouse']),
    C('luxury', 'style', 'Haut de gamme', ['style:Haut de gamme'],
      ['luxe', 'luxueux', 'luxueuse', 'haut de gamme', 'prestige', 'chic', 'elegant', 'elegante', 'luxury', 'luxurious', 'upscale', 'high end'],
      ['luxury', 'luxurious', 'upscale', 'high end', 'elegant', 'chic']),
    // material
    C('brick', 'material', 'Brique', ['material:Brique'], ['brique', 'brick'], ['brick']),
    C('wood', 'material', 'Bois', ['material:Bois'], ['bois', 'bardage bois', 'charpente', 'wood', 'wooden', 'timber'], ['wood', 'wooden', 'timber', 'oak', 'walnut']),
    C('stone', 'material', 'Pierre', ['material:Pierre'], ['pierre', 'stone'], ['stone']),
    C('glass', 'material', 'Verre', ['material:Verre'], ['verre', 'vitre', 'vitree', 'baie vitree', 'baies vitrees', 'facade vitree', 'glass', 'glazed'], ['glass', 'glazed', 'floor to ceiling']),
    C('stucco', 'material', 'Enduit', ['material:Enduit & stuc'], ['enduit', 'stuc', 'crepi', 'stucco'], ['stucco']),
    C('siding', 'material', 'Bardage', ['material:Bardeaux & bardage'], ['bardage', 'bardeau', 'bardeaux', 'siding', 'shingle'], ['siding', 'shingle']),
    C('marble', 'material', 'Marbre', ['material:Marbre'], ['marbre', 'marble'], ['marble']),
    C('metal', 'material', 'Métal', ['material:Métal'], ['metal', 'acier', 'zinc', 'steel'], ['metal', 'steel', 'standing seam']),
    C('concrete', 'material', 'Béton', ['material:Béton'], ['beton', 'concrete'], ['concrete']),
    // spaces
    C('pool', 'space', 'Piscine', ['space:Piscine'], ['piscine', 'bassin', 'pool'], ['pool']),
    C('terrace', 'space', 'Terrasse', ['space:Terrasse & rooftop'], ['terrasse', 'toit terrasse', 'rooftop', 'balcon', 'deck', 'terrace', 'balcony', 'patio'], ['terrace', 'rooftop', 'deck', 'balcony', 'patio']),
    C('garden', 'space', 'Jardin', ['space:Jardin & paysage'], ['jardin', 'paysage', 'parc', 'pelouse', 'cour', 'garden', 'landscape', 'lawn', 'courtyard', 'park'], ['garden', 'landscape', 'landscaped', 'lawn', 'courtyard', 'park']),
    C('living', 'space', 'Salon', ['space:Séjour'], ['salon', 'sejour', 'piece de vie', 'living', 'living room', 'lounge'], ['living room', 'drawing room', 'lounge']),
    C('bedroom', 'space', 'Chambre', ['space:Chambre'], ['chambre', 'suite', 'bedroom'], ['bedroom', 'suite']),
    C('kitchen', 'space', 'Cuisine', ['space:Cuisine'], ['cuisine', 'kitchen'], ['kitchen']),
    C('dining', 'space', 'Salle à manger', ['space:Salle à manger'], ['salle a manger', 'dining', 'dining room'], ['dining']),
    C('bathroom', 'space', 'Salle de bains', ['space:Salle de bains'], ['salle de bain', 'salle de bains', 'salle d eau', 'bathroom'], ['bathroom']),
    C('lobby', 'space', 'Hall d’accueil', ['space:Hall & lobby'], ['hall', 'lobby', 'accueil', 'reception', 'entree'], ['lobby', 'hall']),
    // media
    C('animation', 'media', 'Animation 3D', ['view:Animation 3D'], ['animation', 'video', 'film', 'walkthrough', 'flythrough'], ['animation', 'walkthrough', 'flythrough'],
      { cat: '3D animation' }),
    // places named in the published titles (French name -> English title text)
    ...[['Malte', 'malte', 'malta'], ['Grèce', 'grece', 'greece'], ['Japon', 'japon', 'japan'], ['Tokyo', 'tokyo', 'tokyo'],
      ['Londres', 'londres', 'london'], ['Royaume-Uni', 'royaume uni', 'uk'], ['Angleterre', 'angleterre', 'england'],
      ['Norvège', 'norvege', 'norway'], ['Suède', 'suede', 'sweden'], ['Autriche', 'autriche', 'austria'], ['Vienne', 'vienne', 'vienna'],
      ['Italie', 'italie', 'italy'], ['Lac de Côme', 'lac de come', 'lake como'], ['Espagne', 'espagne', 'spain'], ['Berlin', 'berlin', 'berlin'],
      ['Ukraine', 'ukraine', 'ukraine'], ['Luxembourg', 'luxembourg', 'luxembourg'], ['France', 'france', 'france'],
      ['Dubaï', 'dubai', 'dubai'], ['Moyen-Orient', 'moyen orient', 'middle east'], ['Australie', 'australie', 'australia'],
      ['Mexique', 'mexique', 'mexico'], ['Canada', 'canada', 'canada'], ['Toronto', 'toronto', 'toronto'], ['Vancouver', 'vancouver', 'vancouver'],
      ['États-Unis', 'etats unis', 'usa'], ['New York', 'new york', 'new york|nyc'], ['Californie', 'californie', 'california'],
      ['Los Angeles', 'los angeles', 'los angeles'], ['Floride', 'floride', 'florida'], ['Miami', 'miami', 'miami'],
      ['Caroline du Nord', 'caroline du nord', 'north carolina'], ['Caroline du Sud', 'caroline du sud', 'south carolina'],
      ['Texas', 'texas', 'texas'], ['Arizona', 'arizona', 'arizona'], ['Colorado', 'colorado', 'colorado'], ['Aspen', 'aspen', 'aspen'],
      ['Pittsburgh', 'pittsburgh', 'pittsburgh'], ['Philadelphie', 'philadelphie', 'philadelphia'], ['Brooklyn', 'brooklyn', 'brooklyn'],
      ['New Jersey', 'new jersey', 'new jersey'], ['Chicago', 'chicago', 'chicago'], ['Massachusetts', 'massachusetts', 'massachusetts'],
      ['Turks-et-Caïcos', 'turks et caicos', 'turks and caicos'], ['Zanzibar', 'zanzibar', 'zanzibar']]
      .map(([label, fr, en]) => C('place:' + fr, 'place', label, [], [fr, ...en.split('|')], en.split('|'))),
  ];
  // "sea" and "lake" are more specific than "water"; "bois" alone is wood, "en bois" too
  const STOP = new Set(norm('le la les l un une des de du d au aux a à en et ou avec sans sur sous dans pour par vers depuis tres plutot ' +
    'qui que avec style type vue vues image images rendu rendus visuel visuels perspective perspectives projet projets reference references ' +
    'photo cgi 3d je cherche voudrais veux besoin quelque chose comme genre ' +
    'the an of in on at with and or for by from to near some like view render rendering image visualization project').split(' '));
  LEXICON.forEach(c => { c.qRx = termRx(c.q); c.tRx = termRx(c.t); });

  /* =====================================================================
   * 2. PARSE + MATCH
   * ===================================================================== */
  function parse(query, projects) {
    const qn = ' ' + norm(query) + ' ';
    const hits = [];
    LEXICON.forEach(c => {
      c.qRx.lastIndex = 0;
      let m;
      while ((m = c.qRx.exec(qn))) hits.push({ s: m.index, e: m.index + m[0].length, c, text: m[0] });
    });
    hits.sort((a, b) => (b.e - b.s) - (a.e - a.s) || a.s - b.s);      // longest phrase wins
    const taken = [], concepts = [];
    hits.forEach(x => {
      if (taken.some(t => x.s < t.e && t.s < x.e)) return;
      taken.push(x);
      if (!concepts.includes(x.c)) concepts.push(x.c);
    });
    // "water" is implied by "sea"/"lake": keep the most specific one
    if (concepts.some(c => c.id === 'sea' || c.id === 'lake')) {
      const i = concepts.findIndex(c => c.id === 'water'); if (i >= 0) concepts.splice(i, 1);
    }
    // words not in the lexicon: looked up as-is in the published text, else reported
    let rest = qn;
    taken.sort((a, b) => b.s - a.s).forEach(t => { rest = rest.slice(0, t.s) + ' ' + rest.slice(t.e); });
    const unknown = [];
    rest.split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).forEach(w => {
      const rx = termRx([w]);
      const n = projects.filter(p => textOf(p).some(([, s]) => { rx.lastIndex = 0; return rx.test(s); })).length;
      if (n) concepts.push({ id: 'free:' + w, dim: 'text', label: '« ' + w + ' »', tags: [], tRx: rx, free: true });
      else unknown.push(w);
    });
    concepts.sort((a, b) => Object.keys(DIM).indexOf(a.dim) - Object.keys(DIM).indexOf(b.dim));
    return { concepts, unknown };
  }

  const textCache = new Map();
  function textOf(p) {
    if (!textCache.has(p.id)) {
      const pub = p.published || {};
      textCache.set(p.id, [['title', norm(p.label)], ['alt', norm(pub.imageAlt || '')], ['fr', norm(pub.frCaption || '')]]
        .filter(([, s]) => s));
    }
    return textCache.get(p.id);
  }
  const hasTag = (p, key) => { const i = key.indexOf(':'); return ((p.facets || {})[key.slice(0, i)] || []).includes(key.slice(i + 1)); };

  function dimValues(p, dim) {
    const f = p.facets || {};
    switch (dim) {
      case 'inout': return (f.view || []).filter(v => v === 'Extérieur' || v === 'Intérieur');
      case 'camera': return (f.view || []).filter(v => CAMERA_TAGS.includes(v));
      case 'media': return (f.view || []).includes('Animation 3D') ? ['Animation 3D'] : ['image fixe'];
      case 'text': case 'place': return [];
      default: return f[dim] || [];
    }
  }

  function evaluate(p, c) {
    const ev = [];
    textOf(p).forEach(([field, s]) => {
      c.tRx.lastIndex = 0;
      const m = c.tRx.exec(s);
      if (m) ev.push({ kind: 'text', field, text: m[0] });
    });
    if (c.cat && ((p.published || {}).categories || []).includes(c.cat)) ev.push({ kind: 'cat', text: c.cat });
    c.tags.forEach(k => { if (hasTag(p, k)) ev.push({ kind: 'tag', key: k, text: k.slice(k.indexOf(':') + 1), why: (p.why || {})[k] }); });
    if (ev.length) return { c, status: 'match', ev };
    const near = (c.near || []).filter(k => hasTag(p, k));
    if (near.length) return { c, status: 'near', ev: near.map(k => ({ kind: 'tag', key: k, text: k.slice(k.indexOf(':') + 1), why: (p.why || {})[k] })) };
    const vals = dimValues(p, c.dim);
    if (!vals.length) return { c, status: c.dim === 'text' || c.dim === 'place' ? 'absent' : 'unknown', ev: [] };
    return { c, status: EXCLUSIVE.has(c.dim) ? 'other' : 'absent', ev: [], vals };
  }
  const WEIGHT = { match: 1, near: 0.6, unknown: 0.4, absent: 0.15, other: 0 };

  function search(query, projects) {
    const { concepts, unknown } = parse(query, projects);
    if (!concepts.length) return { concepts, unknown, results: [], full: 0 };
    const results = projects.map(p => {
      const crit = concepts.map(c => evaluate(p, c));
      const matched = crit.filter(x => x.status === 'match').length;
      const score = crit.reduce((s, x) => s + WEIGHT[x.status] * (DIM_WEIGHT[x.c.dim] || 1), 0);
      const textEv = crit.reduce((s, x) => s + x.ev.filter(e => e.kind !== 'tag').length, 0);
      return { p, crit, matched, score, textEv, full: matched === concepts.length };
    }).filter(r => r.matched > 0 || r.crit.some(x => x.status === 'near'))
      .sort((a, b) => b.full - a.full || b.score - a.score || b.matched - a.matched || b.textEv - a.textEv || a.p.label.localeCompare(b.p.label));
    const perConcept = concepts.map(c => ({ c, n: projects.filter(p => evaluate(p, c).status === 'match').length }));
    return { concepts, unknown, results, full: results.filter(r => r.full).length, perConcept };
  }

  /* =====================================================================
   * 3. BRIEF STATE (per browser; never required for the page to work)
   * ===================================================================== */
  const TAKES = [
    { id: 'lumiere', label: 'Lumière' }, { id: 'angle', label: 'Angle de vue' },
    { id: 'materiau', label: 'Matériau' }, { id: 'facade', label: 'Détail de façade' }
  ];
  let brief = { query: '', items: [] };
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (s && Array.isArray(s.items)) brief = s; } catch (_) { /* private mode */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(brief)); } catch (_) { /* ignore */ } };

  /* =====================================================================
   * 4. UI
   * ===================================================================== */
  let api = null, byId = new Map(), lastQuery = '';
  const EXAMPLES = [
    'Maison contemporaine au bord de l’eau, au crépuscule, vue depuis le sol',
    'Modern cabin in the forest at night',
    'Hall d’hôtel en marbre',
    'Gratte-ciel en bois sous la neige'
  ];

  // ---- search form ----
  const input = h('input', { type: 'search', id: 'dl-q', name: 'q', autocomplete: 'off', enterkeyhint: 'search',
    placeholder: 'Ex. : maison contemporaine au bord de l’eau, au crépuscule', 'aria-describedby': 'dl-q-help' });
  const submit = h('button', { type: 'submit', class: 'dl-link dl-search-go' }, 'Rechercher');
  const status = h('p', { class: 'dl-search-status', role: 'status', 'aria-live': 'polite' }, 'Chargement du catalogue…');
  const results = h('div', { class: 'dl-results', id: 'dl-results' });
  const form = h('form', { class: 'dl-search-form', role: 'search', onsubmit: e => { e.preventDefault(); run(input.value); } },
    h('label', { for: 'dl-q', class: 'dl-search-label' }, 'Décrivez la référence recherchée'),
    h('div', { class: 'dl-search-row' }, input, submit),
    h('p', { id: 'dl-q-help', class: 'dl-note' },
      'En français ou en anglais. La recherche lit les titres et les descriptions d’images publiés par ArchiCGI, ses catégories et les tags éditoriaux du prototype.'),
    h('div', { class: 'dl-examples' }, h('span', { class: 'dl-note' }, 'Essayer :'),
      EXAMPLES.map(x => h('button', { type: 'button', class: 'dl-tag dl-example', onclick: () => { input.value = x; run(x); } }, x))));
  els.search.replaceChildren(form, status, results);

  function evidenceChip(e) {
    if (e.kind === 'tag') {
      const w = e.why;
      return h('span', { class: 'dl-src dl-src--ed', title: w ? 'Tag déduit de « ' + w[1] + ' »' : null },
        'Éditorial · ' + e.text);
    }
    const where = e.kind === 'cat' ? 'catégorie' : e.field === 'title' ? 'titre' : e.field === 'alt' ? 'description d’image' : 'légende française';
    return h('span', { class: 'dl-src dl-src--pub' }, 'ArchiCGI · ' + where + ' : ' + (e.kind === 'cat' ? e.text : '« ' + e.text + ' »'));
  }

  function critLine(x) {
    const icon = { match: '✓', near: '≈', unknown: '?', absent: '–', other: '✗' }[x.status];
    const dim = DIM[x.c.dim];
    let detail;
    if (x.status === 'match') {
      // one published source is enough (title first), then ArchiCGI's category and the editorial tags
      const shown = [x.ev.find(e => e.kind === 'text'), ...x.ev.filter(e => e.kind === 'cat'), ...x.ev.filter(e => e.kind === 'tag')].filter(Boolean);
      detail = h('span', { class: 'dl-srcs' }, shown.map(evidenceChip));
    }
    else if (x.status === 'near') detail = h('span', { class: 'dl-srcs' }, h('span', { class: 'dl-crit-msg' }, 'proche : '), x.ev.map(evidenceChip));
    else if (x.status === 'unknown') detail = h('span', { class: 'dl-crit-msg' }, dim.charAt(0).toUpperCase() + dim.slice(1) + ' non renseigné dans les données');
    else if (x.status === 'other') detail = h('span', { class: 'dl-crit-msg' }, 'les données indiquent : ' + x.vals.join(', '));
    else detail = h('span', { class: 'dl-crit-msg' }, x.vals && x.vals.length ? 'non mentionné (données : ' + x.vals.join(', ') + ')' : 'non mentionné');
    return h('li', { class: 'dl-crit is-' + x.status },
      h('span', { class: 'dl-crit-icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'dl-crit-label' }, x.c.label, h('span', { class: 'dl-visually-hidden' }, ' — ' + {
        match: 'correspond', near: 'correspondance approchée', unknown: 'non renseigné', absent: 'non mentionné', other: 'ne correspond pas' }[x.status])),
      detail);
  }

  function briefButton(id) {
    const on = brief.items.some(i => i.id === id);
    return h('button', { type: 'button', class: 'dl-tag dl-add', 'data-brief-id': id, 'aria-pressed': String(on),
      onclick: () => toggle(id) }, on ? 'Dans le brief ✓' : 'Ajouter au brief');
  }

  function card(r) {
    const p = r.p, pub = p.published || {};
    const n = r.crit.length;
    const badge = r.full ? 'Correspond à tous les critères' : 'Correspondance partielle · ' + r.matched + '/' + n;
    return h('article', { class: 'dl-card' + (r.full ? ' is-full' : ''), 'data-id': p.id },
      p.thumb || p.image
        ? h('img', { class: 'dl-card-img', src: p.thumb || p.image, alt: p.imageAlt || p.label, loading: 'lazy', decoding: 'async', width: 96, height: 96,
            onerror: e => e.target.replaceWith(h('div', { class: 'dl-card-img dl-card-noimg' }, 'Image indisponible')) })
        : h('div', { class: 'dl-card-img dl-card-noimg' }, 'Pas d’image'),
      h('div', { class: 'dl-card-body' },
        h('p', { class: 'dl-badge' + (r.full ? ' is-full' : '') }, badge),
        h('h3', {}, p.label),
        pub.categories && pub.categories.length ? h('p', { class: 'dl-note' }, 'ArchiCGI · ' + pub.categories.join(', ')) : null,
        h('ul', { class: 'dl-crits' }, r.crit.map(critLine)),
        h('div', { class: 'dl-card-actions' },
          h('button', { type: 'button', class: 'dl-tag dl-show', onclick: () => showInGraph(p.id) }, 'Voir dans le graphe'),
          briefButton(p.id),
          safeUrl(p.url) ? h('a', { class: 'dl-tag dl-ext', href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' },
            pub.pageRedirectsTo ? 'Portfolio ArchiCGI ↗' : 'Voir sur ArchiCGI ↗') : null)));
  }

  function run(query) {
    query = String(query || '').trim();
    lastQuery = query;
    if (!api) return;
    try { const u = new URL(location.href); if (query) u.searchParams.set('q', query); else u.searchParams.delete('q'); history.replaceState(null, '', u); } catch (_) { /* file:// */ }
    if (!query) { results.replaceChildren(); status.textContent = ''; api.setHits([]); return; }
    const out = search(query, api.projects);
    if (!brief.query || brief.query === brief.autoQuery) { brief.query = query; brief.autoQuery = query; save(); renderBrief(); }
    results.replaceChildren();
    if (!out.concepts.length) {
      status.textContent = 'Aucun critère reconnu' + (out.unknown.length ? ' (« ' + out.unknown.join(' », « ') + ' » introuvable dans le catalogue)' : '') + '. Reformulez ou essayez un exemple.';
      api.setHits([]);
      return;
    }
    const partial = out.results.length - out.full;
    status.textContent = out.full
      ? plural(out.full, 'projet réunit', 'projets réunissent') + ' tous les critères' + (partial ? ', ' + plural(partial, 'autre correspondance partielle', 'autres correspondances partielles') : '') + '.'
      : 'Aucun projet ne réunit tous les critères. ' + plural(partial, 'correspondance partielle', 'correspondances partielles') + ', de la plus proche à la plus éloignée.';
    results.append(h('div', { class: 'dl-understood' },
      h('span', { class: 'dl-note' }, 'Critères compris :'),
      out.concepts.map(c => {
        const pc = out.perConcept.find(x => x.c === c);
        return h('span', { class: 'dl-concept' }, c.label, h('small', {}, ' ' + DIM[c.dim] + ' · ' + plural(pc ? pc.n : 0, 'projet', 'projets')));
      }),
      out.unknown.length ? h('span', { class: 'dl-concept is-unknown' }, 'Non trouvé : « ' + out.unknown.join(' », « ') + ' »') : null));
    if (!out.full && out.concepts.length > 1) {
      const missing = out.perConcept.filter(x => x.n === 0).map(x => x.c.label);
      results.append(h('p', { class: 'dl-nomatch' }, missing.length
        ? 'Le catalogue ne contient aucun projet pour : ' + missing.join(', ') + '. Les résultats ci-dessous réunissent une partie des critères.'
        : 'Chaque critère existe dans le catalogue, mais jamais tous ensemble. Les résultats ci-dessous en réunissent une partie.'));
    }
    results.append(h('p', { class: 'dl-note dl-legend-line' },
      '✓ correspond · ≈ approché · ? non renseigné dans les données · – non mentionné · ✗ les données indiquent autre chose. ',
      h('span', { class: 'dl-src dl-src--pub' }, 'ArchiCGI'), ' donnée publiée · ',
      h('span', { class: 'dl-src dl-src--ed' }, 'Éditorial'), ' tag du prototype'));
    const grid = h('div', { class: 'dl-cards' });
    results.append(grid);
    let shown = 0;
    const more = h('button', { type: 'button', class: 'dl-more', onclick: () => step() });
    function step() {
      out.results.slice(shown, shown + RESULTS_STEP).forEach(r => grid.append(card(r)));
      shown = Math.min(out.results.length, shown + RESULTS_STEP);
      const rest = out.results.length - shown;
      if (rest > 0) more.textContent = 'Afficher ' + Math.min(rest, RESULTS_STEP) + ' résultats de plus (' + rest + ' restants)';
      else more.remove();
    }
    step();
    if (out.results.length > RESULTS_STEP) results.append(more);
    // halo in the graph: full matches, or the closest partial ones
    api.setHits((out.full ? out.results.filter(r => r.full) : out.results.slice(0, 20)).map(r => r.p.id));
  }

  function showInGraph(id) {
    if (!api || !api.showProject(id)) return;
    els.search.querySelectorAll('.dl-card.is-active').forEach(c => c.classList.remove('is-active'));
    const c = els.search.querySelector('.dl-card[data-id="' + CSS.escape(id) + '"]');
    if (c) c.classList.add('is-active');
    api.stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  // ---- brief ----
  function toggle(id) {
    const i = brief.items.findIndex(x => x.id === id);
    if (i >= 0) brief.items.splice(i, 1);
    else if (byId.has(id)) brief.items.push({ id, takes: [], note: '' });
    save(); renderBrief(); syncButtons();
    if (api) api.refreshPanel();
  }
  function syncButtons() {
    document.querySelectorAll('.dl-add[data-brief-id]').forEach(b => {
      const on = brief.items.some(i => i.id === b.dataset.briefId);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Dans le brief ✓' : 'Ajouter au brief';
    });
  }

  const briefQuery = h('textarea', { id: 'dl-brief-query', rows: '2', placeholder: 'Ce que le visuel doit montrer' });
  briefQuery.addEventListener('input', () => { brief.query = briefQuery.value; brief.autoQuery = ''; save(); renderPreview(); });
  const briefList = h('ol', { class: 'dl-brief-list' });
  const copyBtn = h('button', { type: 'button', class: 'dl-link', id: 'dl-copy', onclick: () => copyBrief() }, 'Copier le brief');
  const clearBtn = h('button', { type: 'button', class: 'dl-link dl-link--alt', onclick: () => {
    if (!brief.items.length) return;
    brief.items = []; save(); renderBrief(); syncButtons(); if (api) api.refreshPanel();
  } }, 'Vider la sélection');
  const copyStatus = h('p', { class: 'dl-copy-status', role: 'status', 'aria-live': 'polite' });
  const preview = h('pre', { class: 'dl-preview', id: 'dl-brief-preview' });
  const previewBox = h('details', { class: 'dl-preview-box' }, h('summary', {}, 'Aperçu du texte copié'), preview);
  const briefCount = h('span', { class: 'dl-brief-count' });
  els.brief.replaceChildren(
    h('div', { class: 'dl-brief-head' },
      h('h2', { id: 'dl-brief-title' }, 'Sélection pour le brief ', briefCount),
      h('p', {}, 'Ajoutez des images depuis les résultats ou le graphe, puis indiquez ce qu’il faut reprendre de chacune : la lumière, l’angle de vue, un matériau ou un détail de façade.')),
    h('label', { for: 'dl-brief-query', class: 'dl-search-label' }, 'Demande'), briefQuery,
    briefList,
    h('div', { class: 'dl-brief-actions' }, copyBtn, clearBtn),
    copyStatus, previewBox);
  els.brief.setAttribute('aria-labelledby', 'dl-brief-title');

  function renderBrief() {
    if (document.activeElement !== briefQuery) briefQuery.value = brief.query || '';
    briefCount.textContent = '(' + brief.items.length + ')';
    briefList.replaceChildren();
    if (!brief.items.length) {
      briefList.append(h('li', { class: 'dl-brief-empty' }, 'La sélection est vide. Utilisez « Ajouter au brief » sur une carte de résultat ou dans le panneau du graphe.'));
    }
    brief.items.forEach((it, idx) => {
      const p = byId.get(it.id); if (!p) return;
      const pub = p.published || {};
      const note = h('textarea', { rows: '2', class: 'dl-brief-note', id: 'dl-note-' + idx,
        placeholder: 'Ex. : reflets du ciel au crépuscule sur la façade vitrée' });
      note.value = it.note || '';
      note.addEventListener('input', () => { it.note = note.value; save(); renderPreview(); });
      briefList.append(h('li', { class: 'dl-brief-item', 'data-id': p.id },
        p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy', width: 72, height: 72 }) : h('div', { class: 'dl-card-noimg' }, 'Pas d’image'),
        h('div', { class: 'dl-brief-body' },
          h('h3', {}, (idx + 1) + '. ', safeUrl(p.url) ? h('a', { href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' }, p.label) : p.label),
          h('p', { class: 'dl-note' }, 'Source ArchiCGI' + (pub.categories && pub.categories.length ? ' · ' + pub.categories.join(', ') : '')),
          h('div', { class: 'dl-takes', role: 'group', 'aria-label': 'À reprendre de cette image' },
            h('span', { class: 'dl-note' }, 'À reprendre :'),
            TAKES.map(t => h('button', { type: 'button', class: 'dl-tag dl-take', 'data-take': t.id, 'aria-pressed': String(it.takes.includes(t.id)),
              onclick: e => {
                const k = it.takes.indexOf(t.id);
                if (k >= 0) it.takes.splice(k, 1); else it.takes.push(t.id);
                e.currentTarget.setAttribute('aria-pressed', String(k < 0));
                save(); renderPreview();
              } }, t.label))),
          h('label', { for: 'dl-note-' + idx, class: 'dl-visually-hidden' }, 'Note pour ' + p.label), note,
          h('div', { class: 'dl-card-actions' },
            h('button', { type: 'button', class: 'dl-tag', onclick: () => showInGraph(p.id) }, 'Voir dans le graphe'),
            h('button', { type: 'button', class: 'dl-tag', onclick: () => toggle(p.id) }, 'Retirer')))));
    });
    copyBtn.disabled = !brief.items.length;
    renderPreview();
  }

  function briefText() {
    const L = [];
    L.push('BRIEF — RÉFÉRENCES VISUELLES');
    if ((brief.query || '').trim()) L.push('Demande : ' + brief.query.trim());
    L.push('Sélection : ' + plural(brief.items.length, 'image', 'images') + ' du portfolio public d’ArchiCGI (Discovery Lab).');
    brief.items.forEach((it, i) => {
      const p = byId.get(it.id); if (!p) return;
      const pub = p.published || {};
      const takes = TAKES.filter(t => it.takes.includes(t.id)).map(t => t.label.toLowerCase());
      L.push('');
      L.push((i + 1) + '. ' + p.label);
      L.push('   À reprendre : ' + (takes.length ? takes.join(', ') : 'non précisé'));
      if ((it.note || '').trim()) L.push('   Note : ' + it.note.trim().replace(/\s*\n\s*/g, ' '));
      L.push('   Source : ' + (p.url || ''));
      if (pub.pageRedirectsTo) L.push('   (la page du projet renvoie vers le portfolio ArchiCGI)');
      if (pub.categories && pub.categories.length) L.push('   Donnée ArchiCGI : catégorie ' + pub.categories.join(', '));
      const tags = Object.values(p.facets || {}).flat().filter(t => t !== 'Extérieur' && t !== 'Intérieur');
      if (tags.length) L.push('   Tags éditoriaux : ' + tags.join(' · '));
    });
    L.push('');
    L.push('Tags éditoriaux : classification du prototype Discovery Lab, déduite des titres et descriptions publiés ; ce ne sont pas des données ArchiCGI. Images © ArchiCGI.');
    return L.join('\n');
  }
  function renderPreview() { preview.textContent = brief.items.length ? briefText() : ''; }

  async function copyBrief() {
    if (!brief.items.length) { copyStatus.textContent = 'La sélection est vide.'; return; }
    const text = briefText();
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { /* fall back */ }
    if (!ok) {
      const ta = h('textarea', { readonly: '', 'aria-hidden': 'true', class: 'dl-offscreen' });
      ta.value = text; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
    }
    if (ok) {
      copyStatus.textContent = 'Brief copié : ' + plural(brief.items.length, 'référence', 'références') + ' avec leurs liens vers ArchiCGI.';
    } else {
      previewBox.open = true;
      const range = document.createRange(); range.selectNodeContents(preview);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      copyStatus.textContent = 'Copie automatique impossible dans ce navigateur : le texte est sélectionné ci-dessous, copiez-le manuellement.';
    }
  }

  /* ---------- boot ---------- */
  function ready() {
    if (api || !window.discoveryGraph || !window.discoveryGraph.projects) return;
    api = window.discoveryGraph;
    byId = new Map(api.projects.map(p => [p.id, p]));
    brief.items = brief.items.filter(i => byId.has(i.id) && Array.isArray(i.takes));
    status.textContent = '';
    renderBrief();
    api.refreshPanel();
    let q = '';
    try { q = new URL(location.href).searchParams.get('q') || ''; } catch (_) { /* ignore */ }
    if (q || lastQuery) { input.value = q || lastQuery; run(input.value); }
  }
  window.discoveryBrief = {
    has: id => brief.items.some(i => i.id === id),
    toggle,
    search: q => (api ? search(q, api.projects) : null),
    text: briefText
  };
  document.addEventListener('discovery:ready', ready);
  ready();
})();
