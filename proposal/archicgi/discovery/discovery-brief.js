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
  // Interface language (discovery-i18n.js); search itself understands French and English whatever the interface
  const I = window.discoveryI18n || { lang: 'fr', t: k => k, tag: x => x, group: (k, f) => f || k, filter: (i, f) => f || i,
    quote: x => '\u00ab\u00a0' + x + '\u00a0\u00bb' };

  /* =====================================================================
   * 1. LEXICON — what a phrase means in the catalogue
   *    q: words recognised in the request (French and English)
   *    t: words looked for in ArchiCGI's published text (titles and image descriptions are in English)
   *    tags: editorial tags (group:label) that satisfy the criterion
   *    near: tags that come close (partial match)
   *    cat: ArchiCGI portfolio category that satisfies it
   * ===================================================================== */
  // kinds of criteria (keys are stable; names are shown in the interface language)
  const DIM = {
    typology: 'type de bâtiment', inout: 'intérieur / extérieur', camera: 'angle de vue', context: 'environnement',
    lighting: 'lumière', style: 'style', material: 'matériau', space: 'espace', media: 'média', place: 'lieu', text: 'texte'
  };
  const DIM_EN = {
    typology: 'building type', inout: 'interior / exterior', camera: 'camera angle', context: 'surroundings',
    lighting: 'light', style: 'style', material: 'material', space: 'space', media: 'media', place: 'place', text: 'text'
  };
  const DIM_FEM = new Set(['lighting']);                 // French agreement: « lumière non renseignée »
  const dimName = d => (I.lang === 'en' ? DIM_EN : DIM)[d] || d;
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
      .map(([label, fr, en]) => C('place:' + fr, 'place', label, [], [fr, ...en.split('|')], en.split('|'), { en: placeEn(en) })),
  ];
  // English names of the criteria (French names are the `label` above)
  const CONCEPT_EN = {
    house: 'House', cabin: 'Cabin or chalet', townhouse: 'Townhouse', apartment: 'Apartment building', district: 'Neighbourhood or development',
    hotel: 'Hotel or resort', restaurant: 'Restaurant or bar', office: 'Office or retail', public: 'Public or leisure building',
    industrial: 'Industrial building', tower: 'Tower or skyscraper', exterior: 'Exterior view', interior: 'Interior view',
    aerial: 'Aerial view', eye: 'Eye-level view', closeup: 'Close-up', water: 'By the water', sea: 'Seaside', lake: 'Lake or river',
    mountain: 'Mountains', forest: 'Forest or nature', city: 'In the city', suburb: 'Suburb', tropical: 'Tropical',
    snow: 'Snow or winter', autumn: 'Autumn', dusk: 'Dusk', night: 'Night', day: 'Daylight', modern: 'Contemporary',
    mediterranean: 'Mediterranean', classic: 'Classic', rustic: 'Rustic', luxury: 'High-end', brick: 'Brick', wood: 'Wood',
    stone: 'Stone', glass: 'Glass', stucco: 'Render', siding: 'Siding', marble: 'Marble', metal: 'Metal', concrete: 'Concrete',
    pool: 'Pool', terrace: 'Terrace', garden: 'Garden', living: 'Living room', bedroom: 'Bedroom', kitchen: 'Kitchen',
    dining: 'Dining room', bathroom: 'Bathroom', lobby: 'Lobby', animation: '3D animation'
  };
  function placeEn(en) {
    const w = en.split('|')[0];
    return w.length <= 3 ? w.toUpperCase() : w.replace(/\b[a-z]/g, m => m.toUpperCase()).replace(/\b(And|Of)\b/g, m => m.toLowerCase());
  }
  // a criterion's name in the interface language; free words are quoted as typed
  const cLabel = c => (c.free ? I.quote(c.word) : I.lang === 'en' ? (c.en || CONCEPT_EN[c.id] || c.label) : c.label);
  // "sea" and "lake" are more specific than "water"; "bois" alone is wood, "en bois" too
  const STOP = new Set(norm('le la les l un une des de du d au aux a à en et ou avec sans sur sous dans pour par vers depuis tres plutot ' +
    'qui que avec style type vue vues image images rendu rendus visuel visuels perspective perspectives projet projets reference references ' +
    'photo cgi 3d je cherche voudrais veux besoin quelque chose comme genre ' +
    'the an of in on at with and or for by from to near some like view render rendering image visualization project ' +
    'looking want need something picture shot please show me').split(' '));
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
      if (n) concepts.push({ id: 'free:' + w, dim: 'text', word: w, label: w, tags: [], tRx: rx, free: true });
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
   *    Items keep project ids and take ids only, so they survive language changes.
   * ===================================================================== */
  const TAKES = ['lumiere', 'angle', 'materiau', 'facade'];
  let brief = { query: '', items: [] };
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (s && Array.isArray(s.items)) brief = s; } catch (_) { /* private mode */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(brief)); } catch (_) { /* ignore */ } };
  const t = (k, v) => I.t(k, v);

  /* =====================================================================
   * 4. UI
   * ===================================================================== */
  let api = null, byId = new Map(), lastQuery = '';
  let pendingUserSearch = false;
  let view = null;            // current results: { out, shown, active } — re-rendered as is on language change

  // ---- search form (persistent elements; texts set by paintSearch) ----
  const input = h('input', { type: 'search', id: 'dl-q', name: 'q', autocomplete: 'off', enterkeyhint: 'search', 'aria-describedby': 'dl-q-help' });
  const submit = h('button', { type: 'submit', class: 'dl-btn dl-btn--primary dl-search-go' });
  const status = h('p', { class: 'dl-search-status', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'dl-results', id: 'dl-results' });
  const label = h('label', { for: 'dl-q', class: 'dl-search-label' });
  const help = h('p', { id: 'dl-q-help', class: 'dl-note' });
  const examples = h('div', { class: 'dl-examples' });
  const form = h('form', { class: 'dl-search-form', role: 'search', onsubmit: e => { e.preventDefault(); run(input.value, true); } },
    label, h('div', { class: 'dl-search-row' }, input, submit), help, examples);
  // the query bar may live in its own full-width slot (#dl-query); results stay in #dl-search
  const queryHost = document.getElementById('dl-query');
  if (queryHost) { queryHost.replaceChildren(form); els.search.replaceChildren(status, results); }
  else els.search.replaceChildren(form, status, results);
  status.textContent = t('s.loading');

  function paintSearch() {
    label.textContent = t('s.label');
    input.setAttribute('placeholder', t('s.placeholder'));
    submit.textContent = t('s.go');
    help.textContent = t('s.help');
    examples.replaceChildren(h('span', { class: 'dl-note' }, t('s.try')),
      ...t('s.examples').map(x => h('button', { type: 'button', class: 'dl-example', onclick: () => { input.value = x; run(x, true); } }, x)));
  }

  function evidenceChip(e) {
    if (e.kind === 'tag') {
      const w = e.why;
      return h('span', { class: 'dl-src dl-src--ed', title: w ? t('s.tagFrom', { q: I.quote(w[1]) }) : null },
        t('s.edShort') + ' · ' + I.tag(e.text));
    }
    const where = e.kind === 'cat' ? t('s.srcCat') : e.field === 'title' ? t('s.srcTitle') : e.field === 'alt' ? t('s.srcAlt') : t('s.srcFr');
    // the matched words are quoted as published, never translated
    return h('span', { class: 'dl-src dl-src--pub' }, 'ArchiCGI · ' + where + (I.lang === 'en' ? ': ' : ' : ') + (e.kind === 'cat' ? e.text : I.quote(e.text)));
  }

  const valName = v => (v === 'image fixe' ? t('s.stillImage') : I.tag(v));
  function critLine(x) {
    const icon = { match: '✓', near: '≈', unknown: '?', absent: '–', other: '✗' }[x.status];
    let detail;
    if (x.status === 'match') {
      // one published source is enough (title first), then ArchiCGI's category and the editorial tags
      const shown = [x.ev.find(e => e.kind === 'text'), ...x.ev.filter(e => e.kind === 'cat'), ...x.ev.filter(e => e.kind === 'tag')].filter(Boolean);
      detail = h('span', { class: 'dl-srcs' }, shown.map(evidenceChip));
    } else if (x.status === 'near') detail = h('span', { class: 'dl-srcs' }, h('span', { class: 'dl-crit-msg' }, t('s.near')), x.ev.map(evidenceChip));
    else if (x.status === 'unknown') {
      const d = dimName(x.c.dim);
      detail = h('span', { class: 'dl-crit-msg' }, t('s.unknown', { Dim: d.charAt(0).toUpperCase() + d.slice(1), fem: DIM_FEM.has(x.c.dim) }));
    } else if (x.status === 'other') detail = h('span', { class: 'dl-crit-msg' }, t('s.other', { list: x.vals.map(valName).join(', ') }));
    else detail = h('span', { class: 'dl-crit-msg' }, x.vals && x.vals.length ? t('s.absentVals', { list: x.vals.map(valName).join(', ') }) : t('s.absent'));
    return h('li', { class: 'dl-crit is-' + x.status },
      h('span', { class: 'dl-crit-icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'dl-crit-label' }, cLabel(x.c), h('span', { class: 'dl-visually-hidden' }, ' — ' + t('s.sr.' + x.status))),
      detail);
  }

  // whole-frame items (no region) vs. detail items (a region of the render, added from the detail search)
  const isWhole = it => !it.region;
  const validRegion = r => r && [r.x, r.y, r.w, r.h].every(v => typeof v === 'number' && v >= 0 && v <= 1) && r.w > 0 && r.h > 0;
  const sameRegion = (a, b) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) < 1e-4);
  const pct = v => Math.round(v * 100);
  const zoneText = r => t('b.zone', { x0: pct(r.x), x1: pct(r.x + r.w), y0: pct(r.y), y1: pct(r.y + r.h) });
  function detailLink(it) {
    try {
      const u = new URL(location.href);
      if (!/^https?:$/.test(u.protocol)) return '';
      u.search = ''; u.hash = 'detail=' + it.id + ':' + ['x', 'y', 'w', 'h'].map(k => it.region[k].toFixed(4)).join(',');
      return u.toString();
    } catch (_) { return ''; }
  }
  // crop of a render shown with CSS only (no canvas, works with images served without CORS)
  function cropBox(src, r, cls) {
    const el = h('div', { class: cls, role: 'img' });
    el.style.backgroundImage = 'url("' + String(src).replace(/["\\]/g, '') + '")';
    el.style.backgroundSize = (100 / r.w) + '% ' + (100 / r.h) + '%';
    el.style.backgroundPosition = (r.w < 1 ? (r.x / (1 - r.w)) * 100 : 0) + '% ' + (r.h < 1 ? (r.y / (1 - r.h)) * 100 : 0) + '%';
    return el;
  }

  function briefButton(id) {
    const on = brief.items.some(i => i.id === id && isWhole(i));
    return h('button', { type: 'button', class: 'dl-btn dl-add', 'data-brief-id': id, 'aria-pressed': String(on),
      onclick: () => toggle(id) }, t(on ? 's.inBrief' : 's.addBrief'));
  }

  // one line under the image: what the data does not say / what differs
  function gapsText(r) {
    const unknown = r.crit.filter(x => x.status === 'unknown').map(x => dimName(x.c.dim));
    const missing = r.crit.filter(x => x.status === 'other' || x.status === 'absent').map(x => cLabel(x.c));
    return [unknown.length ? t('s.gapUnknown', { list: unknown.join(', ') }) : '',
      missing.length ? t('s.gapMissing', { list: missing.join(', ') }) : ''].filter(Boolean).join(' · ');
  }
  // why a result matched: criteria with their sources (shown folded in the tile and in the render viewer)
  const explanation = r => h('ul', { class: 'dl-crits' }, r.crit.map(critLine));
  function openRender(r) {
    if (!window.discoveryDetails) return;
    if (view) view.active = r.p.id;
    window.discoveryDetails.open(r.p.id, { explain: () => explanation(r) });
  }

  // Result tile: large render, title, one line of gaps; details folded; few actions
  function card(r, eagerImage) {
    const p = r.p, pub = p.published || {};
    const badge = r.full ? t('s.badgeFull') : t('s.badgePartial', { m: r.matched, n: r.crit.length });
    const gaps = gapsText(r);
    const src = p.image || p.thumb;
    const media = src
      ? h('img', { class: 'dl-card-img', src, alt: p.imageAlt || p.label, loading: eagerImage ? 'eager' : 'lazy', decoding: 'async',
          onerror: e => e.target.replaceWith(h('span', { class: 'dl-card-img dl-card-noimg' }, t('s.imgError'))) })
      : h('span', { class: 'dl-card-img dl-card-noimg' }, t('s.noImage'));
    return h('article', { class: 'dl-card' + (r.full ? ' is-full' : '') + (view && view.active === p.id ? ' is-active' : ''), 'data-id': p.id },
      h('button', { type: 'button', class: 'dl-card-media', 'aria-label': t('s.openRender', { title: p.label }),
        onclick: () => openRender(r), disabled: src && window.discoveryDetails ? null : '' },
        media),
      h('div', { class: 'dl-card-body' },
        h('p', { class: 'dl-badge' + (r.full ? ' is-full' : '') }, badge),
        h('h3', {}, p.label),
        gaps ? h('p', { class: 'dl-card-gaps' }, gaps) : null,
        h('details', { class: 'dl-card-why' },
          h('summary', {}, t('s.why')),
          pub.categories && pub.categories.length ? h('p', { class: 'dl-note' }, 'ArchiCGI · ' + pub.categories.join(', ')) : null,
          explanation(r)),
        h('div', { class: 'dl-card-actions' },
          briefButton(p.id),
          window.discoveryDetails && src ? h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-enlarge', onclick: () => openRender(r) }, t('d.enlarge')) : null,
          h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-show', onclick: () => showInGraph(p.id) }, t('s.showGraph')),
          safeUrl(p.url) ? h('a', { class: 'dl-btn dl-btn--ghost dl-ext', href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' },
            t(pub.pageRedirectsTo ? 's.viewPortfolio' : 's.viewArchi')) : null)));
  }

  function run(query, userInitiated = false) {
    query = String(query || '').trim();
    lastQuery = query;
    if (!api) { pendingUserSearch = userInitiated; return; }
    document.body.classList.toggle('lab-has-query', Boolean(query));
    try { const u = new URL(location.href); if (query) u.searchParams.set('q', query); else u.searchParams.delete('q'); history.replaceState(null, '', u); } catch (_) { /* file:// */ }
    if (!query) { view = null; results.replaceChildren(); status.textContent = ''; api.setHits([]); return; }
    const out = search(query, api.projects);
    if (!brief.query || brief.query === brief.autoQuery) { brief.query = query; brief.autoQuery = query; save(); renderBrief(); }
    view = { out, shown: Math.min(RESULTS_STEP, out.results.length), active: null };
    paintResults();
    // halo in the graph: full matches, or the closest partial ones
    api.setHits(out.concepts.length ? (out.full ? out.results.filter(r => r.full) : out.results.slice(0, 20)).map(r => r.p.id) : []);
    if (userInitiated) {
      const heading = document.getElementById('lab-results-title');
      if (heading) {
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    }
  }

  // Draws the current results in the interface language (also used on language change: same results, same count)
  function paintResults() {
    results.replaceChildren();
    if (!view) { status.textContent = ''; return; }
    const out = view.out;
    const unknownList = out.unknown.map(w => I.quote(w)).join(', ');
    if (!out.concepts.length) {
      status.textContent = t('s.noCriteria', { unknown: unknownList });
      return;
    }
    const partial = out.results.length - out.full;
    status.textContent = out.full ? t('s.full', { n: out.full, partial }) : t('s.none', { partial });
    results.append(h('div', { class: 'dl-understood' },
      h('span', { class: 'dl-note' }, t('s.understood')),
      out.concepts.map(c => {
        const pc = out.perConcept.find(x => x.c === c);
        return h('span', { class: 'dl-concept' }, cLabel(c), h('small', {}, ' ' + dimName(c.dim) + ' · ' + t('s.projects', { n: pc ? pc.n : 0 })));
      }),
      out.unknown.length ? h('span', { class: 'dl-concept is-unknown' }, t('s.notFound', { list: unknownList })) : null));
    if (!out.full && out.concepts.length > 1) {
      const missing = out.perConcept.filter(x => x.n === 0).map(x => cLabel(x.c));
      results.append(h('p', { class: 'dl-nomatch' }, missing.length ? t('s.missing', { list: missing.join(', ') }) : t('s.neverTogether')));
    }
    const grid = h('div', { class: 'dl-cards' });
    results.append(grid);
    const more = h('button', { type: 'button', class: 'dl-more', onclick: () => step() });
    let drawn = 0;
    function draw(upto) {
      out.results.slice(drawn, upto).forEach((r, i) => grid.append(card(r, drawn + i < 4)));
      drawn = upto;
      view.shown = drawn;
      const rest = out.results.length - drawn;
      if (rest > 0) more.textContent = t('s.moreResults', { k: Math.min(rest, RESULTS_STEP), rest });
      else more.remove();
    }
    function step() { draw(Math.min(out.results.length, drawn + RESULTS_STEP)); }
    draw(Math.min(out.results.length, Math.max(view.shown, RESULTS_STEP)));
    if (out.results.length > drawn) results.append(more);
  }

  function showInGraph(id) {
    if (!api || !api.showProject(id)) return;
    if (view) view.active = id;
    els.search.querySelectorAll('.dl-card.is-active').forEach(c => c.classList.remove('is-active'));
    const c = els.search.querySelector('.dl-card[data-id="' + CSS.escape(id) + '"]');
    if (c) c.classList.add('is-active');
    api.stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  // ---- brief ----
  function changed() {
    save(); renderBrief(); syncButtons();
    if (api) api.refreshPanel();
    document.dispatchEvent(new CustomEvent('discovery:brief'));
  }
  function toggle(id) {
    const i = brief.items.findIndex(x => x.id === id && isWhole(x));
    if (i >= 0) brief.items.splice(i, 1);
    else if (byId.has(id)) brief.items.push({ id, takes: [], note: '' });
    changed();
  }
  // a found fragment: project id + region in [0, 1] image coordinates
  function addDetail(id, region) {
    if (!byId.has(id) || !validRegion(region)) return -1;
    const r = { x: +region.x.toFixed(4), y: +region.y.toFixed(4), w: +region.w.toFixed(4), h: +region.h.toFixed(4) };
    let k = brief.items.findIndex(x => x.id === id && x.region && sameRegion(x.region, r));
    if (k < 0) { brief.items.push({ id, region: r, takes: [], note: '' }); k = brief.items.length - 1; }
    changed();
    return k;
  }
  const hasDetail = (id, region) => brief.items.some(x => x.id === id && x.region && sameRegion(x.region, region));
  function removeAt(k) { brief.items.splice(k, 1); changed(); }
  function syncButtons() {
    document.querySelectorAll('.dl-add[data-brief-id]').forEach(b => {
      const on = brief.items.some(i => i.id === b.dataset.briefId && isWhole(i));
      b.setAttribute('aria-pressed', String(on));
      b.textContent = t(on ? 's.inBrief' : 's.addBrief');
    });
  }

  const briefQuery = h('textarea', { id: 'dl-brief-query', rows: '2' });
  briefQuery.addEventListener('input', () => { brief.query = briefQuery.value; brief.autoQuery = ''; save(); renderPreview(); });
  const briefList = h('ol', { class: 'dl-brief-list' });
  const copyBtn = h('button', { type: 'button', class: 'dl-btn dl-btn--primary', id: 'dl-copy', onclick: () => copyBrief() });
  const clearBtn = h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-clear', onclick: () => {
    if (!brief.items.length) return;
    brief.items = []; changed();
  } });
  const copyStatus = h('p', { class: 'dl-copy-status', role: 'status', 'aria-live': 'polite' });
  const preview = h('pre', { class: 'dl-preview', id: 'dl-brief-preview' });
  const previewTitle = h('h3', { id: 'dl-brief-preview-title' });
  const previewBox = h('section', { class: 'dl-preview-box', hidden: '', 'aria-labelledby': 'dl-brief-preview-title' }, previewTitle, preview);
  const briefCount = h('span', { class: 'dl-brief-count' });
  const briefTitleText = document.createTextNode('');
  const briefIntro = h('p', {});
  const requestLabel = h('label', { for: 'dl-brief-query', class: 'dl-search-label' });
  els.brief.replaceChildren(
    h('div', { class: 'dl-brief-head' }, h('h2', { id: 'dl-brief-title' }, briefTitleText, ' ', briefCount), briefIntro),
    requestLabel, briefQuery, briefList,
    h('div', { class: 'dl-brief-actions' }, copyBtn, clearBtn),
    copyStatus, previewBox);
  els.brief.setAttribute('aria-labelledby', 'dl-brief-title');

  function paintBriefStatic() {
    briefTitleText.textContent = t('b.title');
    briefIntro.textContent = t('b.intro');
    requestLabel.textContent = t('b.request');
    briefQuery.setAttribute('placeholder', t('b.requestPh'));
    copyBtn.textContent = t('b.copy');
    clearBtn.textContent = t('b.clear');
    previewTitle.textContent = t('b.preview');
  }

  function renderBrief() {
    if (document.activeElement !== briefQuery) briefQuery.value = brief.query || '';
    briefCount.textContent = '(' + brief.items.length + ')';
    briefList.replaceChildren();
    if (!brief.items.length) briefList.append(h('li', { class: 'dl-brief-empty' }, t('b.empty')));
    brief.items.forEach((it, idx) => {
      const p = byId.get(it.id); if (!p) return;
      const pub = p.published || {};
      const note = h('textarea', { rows: '2', class: 'dl-brief-note', id: 'dl-note-' + idx, placeholder: t('b.notePh') });
      note.value = it.note || '';
      note.addEventListener('input', () => { it.note = note.value; save(); renderPreview(); });
      const det = it.region ? it.region : null;
      const thumb = det && p.image ? cropBox(p.image, det, 'dl-brief-crop')
        : p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy', width: 72, height: 72 }) : h('div', { class: 'dl-card-noimg' }, t('s.noImage'));
      if (det) thumb.setAttribute('aria-label', t('b.detailOf', { title: p.label }));
      briefList.append(h('li', { class: 'dl-brief-item' + (det ? ' is-detail' : ''), 'data-id': p.id,
        'data-region': det ? [det.x, det.y, det.w, det.h].join(',') : null },
        thumb,
        h('div', { class: 'dl-brief-body' },
          det ? h('p', { class: 'dl-badge' }, t('b.detailBadge')) : null,
          h('h3', {}, (idx + 1) + '. ', safeUrl(p.url) ? h('a', { href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer' }, p.label) : p.label),
          h('p', { class: 'dl-note' }, t('b.source') + (pub.categories && pub.categories.length ? ' · ' + pub.categories.join(', ') : '') +
            (det ? ' · ' + zoneText(det) : '')),
          h('div', { class: 'dl-takes', role: 'group', 'aria-label': t('b.takesGroup') },
            h('span', { class: 'dl-note' }, t('b.takes')),
            TAKES.map(id => h('button', { type: 'button', class: 'dl-take', 'data-take': id, 'aria-pressed': String(it.takes.includes(id)),
              onclick: e => {
                const k = it.takes.indexOf(id);
                if (k >= 0) it.takes.splice(k, 1); else it.takes.push(id);
                e.currentTarget.setAttribute('aria-pressed', String(k < 0));
                save(); renderPreview();
              } }, t('take.' + id)))),
          h('label', { for: 'dl-note-' + idx, class: 'dl-visually-hidden' }, t('b.noteFor', { title: p.label })), note,
          h('div', { class: 'dl-card-actions' },
            det && window.discoveryDetails ? h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-open-detail',
              onclick: () => window.discoveryDetails.open(p.id, { highlight: det }) }, t('b.viewDetail')) : null,
            h('button', { type: 'button', class: 'dl-btn dl-btn--ghost', onclick: () => showInGraph(p.id) }, t('s.showGraph')),
            h('button', { type: 'button', class: 'dl-btn dl-btn--ghost dl-remove', onclick: () => removeAt(idx) }, t('b.remove'))))));
    });
    copyBtn.disabled = !brief.items.length;
    renderPreview();
  }

  // The copied text: labels in the interface language; request, notes, titles and links exactly as entered / published
  function briefText() {
    const L = [];
    L.push(t('bt.head'));
    if ((brief.query || '').trim()) L.push(t('bt.request') + brief.query.trim());
    L.push(t('bt.selection', { n: brief.items.length }));
    brief.items.forEach((it, i) => {
      const p = byId.get(it.id); if (!p) return;
      const pub = p.published || {};
      const takes = TAKES.filter(id => it.takes.includes(id)).map(id => t('take.' + id).toLowerCase());
      L.push('');
      L.push((i + 1) + '. ' + p.label);
      if (it.region) {
        L.push(t('bt.detail') + zoneText(it.region));
        const link = detailLink(it);
        if (link) L.push(t('bt.detailLink') + link);
      }
      L.push(t('bt.takes') + (takes.length ? takes.join(', ') : t('bt.unspecified')));
      if ((it.note || '').trim()) L.push(t('bt.note') + it.note.trim().replace(/\s*\n\s*/g, ' '));
      L.push(t('bt.source') + (p.url || ''));
      if (pub.pageRedirectsTo) L.push(t('bt.redirect'));
      if (pub.categories && pub.categories.length) L.push(t('bt.category') + pub.categories.join(', '));
      const tags = Object.values(p.facets || {}).flat().filter(x => x !== 'Extérieur' && x !== 'Intérieur').map(I.tag);
      if (tags.length) L.push(t('bt.tags') + tags.join(' · '));
    });
    L.push('');
    L.push(t('bt.footer'));
    return L.join('\n');
  }
  function renderPreview() {
    previewBox.hidden = !brief.items.length;
    preview.textContent = previewBox.hidden ? '' : briefText();
  }

  async function copyBrief() {
    if (!brief.items.length) { copyStatus.textContent = t('b.emptyCopy'); return; }
    const text = briefText();
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { /* fall back */ }
    if (!ok) {
      const ta = h('textarea', { readonly: '', 'aria-hidden': 'true', class: 'dl-offscreen' });
      ta.value = text; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
    }
    if (ok) copyStatus.textContent = t('b.copied', { n: brief.items.length });
    else {
      const range = document.createRange(); range.selectNodeContents(preview);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      copyStatus.textContent = t('b.copyFail');
    }
  }

  /* ---------- language change: repaint in place, state untouched ---------- */
  document.addEventListener('discovery:lang', () => {
    paintSearch();
    if (!api) status.textContent = t('s.loading');
    else paintResults();
    paintBriefStatic();
    renderBrief();
    copyStatus.textContent = '';
  });

  /* ---------- boot ---------- */
  paintSearch();
  paintBriefStatic();
  function ready() {
    if (api || !window.discoveryGraph || !window.discoveryGraph.projects) return;
    api = window.discoveryGraph;
    byId = new Map(api.projects.map(p => [p.id, p]));
    brief.items = brief.items.filter(i => byId.has(i.id) && Array.isArray(i.takes) && (!i.region || validRegion(i.region)));
    status.textContent = '';
    renderBrief();
    api.refreshPanel();
    // A direct graph project link opens the workspace even without a query.
    const projectId = location.hash.slice(1);
    if (byId.has(projectId)) document.body.classList.add('lab-has-project-link');
    let q = '';
    try { q = new URL(location.href).searchParams.get('q') || ''; } catch (_) { /* ignore */ }
    if (q || lastQuery) { input.value = lastQuery || q; run(input.value, pendingUserSearch); }
  }
  window.discoveryBrief = {
    has: id => brief.items.some(i => i.id === id && isWhole(i)),
    toggle, addDetail, hasDetail, cropBox, zoneText,
    get items() { return brief.items.map(x => Object.assign({}, x)); },
    search: q => (api ? search(q, api.projects) : null),
    text: briefText
  };
  document.addEventListener('discovery:ready', ready);
  ready();
})();
