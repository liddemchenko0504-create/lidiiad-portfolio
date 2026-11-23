/*
 * ArchiCGI Discovery Lab — interface language (French default, English)
 * - t(key, vars): interface strings. Values may be functions of vars (plurals).
 * - tag(label) / group(key) / filter(id): display names for editorial data. The data keeps its
 *   canonical (French) labels and ids, so graph links, search and saved selections never change.
 * - Published ArchiCGI text (titles, quotes), links and user notes are never translated.
 * Load before discovery-graph.js and discovery-brief.js. The choice is kept in localStorage.
 */
(() => {
  'use strict';
  const STORE_KEY = 'dl-lang';
  const LANGS = ['fr', 'en'];
  const pl = (n, one, many) => n + ' ' + (n > 1 ? many : one);      // French: 0 and 1 are singular
  const plEn = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* ---------- editorial vocabulary (canonical label -> English) ---------- */
  const TAGS_EN = {
    // building type
    'Maison & villa': 'House & villa', 'Cabane & chalet': 'Cabin & chalet', 'Maison de ville': 'Townhouse',
    'Immeuble résidentiel': 'Apartment building', 'Quartier & lotissement': 'Neighbourhood & development',
    'Hôtel & resort': 'Hotel & resort', 'Restaurant & bar': 'Restaurant & bar', 'Bureaux & commerce': 'Office & retail',
    'Équipement & loisirs': 'Public & leisure', 'Industriel': 'Industrial', 'Tour & gratte-ciel': 'Tower & skyscraper',
    // view
    'Extérieur': 'Exterior', 'Intérieur': 'Interior', 'Vue aérienne': 'Aerial view', 'Vue rapprochée': 'Close-up',
    'Vue de rue': 'Street view', 'Façade': 'Facade', 'Vue arrière ou latérale': 'Rear or side view',
    'Animation 3D': '3D animation', 'Scène de vie': 'Lifestyle scene',
    // space
    'Séjour': 'Living room', 'Chambre': 'Bedroom', 'Cuisine': 'Kitchen', 'Salle à manger': 'Dining room',
    'Salle de bains': 'Bathroom', 'Hall & lobby': 'Hall & lobby', 'Piscine': 'Pool', 'Terrasse & rooftop': 'Terrace & rooftop',
    'Jardin & paysage': 'Garden & landscape',
    // style
    'Moderne & contemporain': 'Modern & contemporary', 'Méditerranéen': 'Mediterranean',
    'Classique & traditionnel': 'Classic & traditional', 'Rustique': 'Rustic', 'Haut de gamme': 'High-end',
    // material
    'Brique': 'Brick', 'Bois': 'Wood', 'Pierre': 'Stone', 'Verre': 'Glass', 'Enduit & stuc': 'Render & stucco',
    'Bardeaux & bardage': 'Shingles & siding', 'Marbre': 'Marble', 'Métal': 'Metal', 'Béton': 'Concrete',
    // light
    'Nuit': 'Night', 'Crépuscule & soir': 'Dusk & evening', 'Lumière du jour': 'Daylight',
    // surroundings
    'Bord de mer': 'Seaside', 'Lac & rivière': 'Lake & river', 'Front d’eau': 'Waterfront', 'Montagne': 'Mountain',
    'Forêt & nature': 'Forest & nature', 'Ville': 'City', 'Banlieue': 'Suburb', 'Tropical': 'Tropical',
    'Hiver & neige': 'Winter & snow', 'Automne': 'Autumn', 'Décor de fête': 'Holiday decor'
  };
  const GROUPS_EN = { project: 'Projects', typology: 'Building type', view: 'View', space: 'Space', style: 'Style',
    material: 'Materials', lighting: 'Light', context: 'Surroundings' };
  const FILTERS_EN = { all: 'All', residentiel: 'Residential', collectif: 'Multifamily housing', hospitalite: 'Hospitality',
    commercial: 'Commercial & public', interieur: 'Interior', exterieur: 'Exterior', aerien: 'Aerial view',
    nuit: 'Night & dusk', eau: 'By the water', animation: '3D animation' };

  /* ---------- interface strings ---------- */
  const STR = {
    fr: {
      'lang.switch': 'Langue de l’interface', 'lang.fr': 'Français', 'lang.en': 'English',
      'page.title': 'ArchiCGI — Discovery Lab',
      'page.kicker': 'REFERENCE GRAPH — 434 PROJETS',
      'page.intro': 'Trouvez des références visuelles pour un brief parmi les 434 projets du portfolio public d’ArchiCGI. Décrivez l’image recherchée avec vos mots, comparez les projets qui y répondent, explorez leurs liens dans le graphe, puis composez une sélection annotée à copier dans votre brief.',
      'steps.label': 'Étapes', 'steps.1': '1. Décrire', 'steps.2': '2. Comparer', 'steps.3': '3. Explorer les liens', 'steps.4': '4. Composer le brief',
      'step.search': '1. Décrire la référence', 'step.graph': '3. Explorer les liens',
      'graph.section': 'Explorateur de références architecturales', 'graph.filters': 'Filtres de projets',
      'graph.canvas': 'Graphe interactif de projets et de caractéristiques',
      'footer.text': 'Prototype indépendant · 434 projets du portfolio public d’ArchiCGI · Images © ArchiCGI · Relevé du 23\u00a0novembre\u00a02026',
      'footer.source': 'Page française', 'footer.portfolio': 'Portfolio complet',
      'footer.about': 'À propos des données',
      'footer.notes': 'Titres, images, liens et catégories viennent d’ArchiCGI, tels que publiés : 438 entrées, dont 4 paires d’images identiques regroupées. Les filtres, le graphe et la recherche reposent sur un classement éditorial du prototype. La recherche de détails compare votre sélection à 181\u00a0369 fragments de 434 projets (DINOv2, tools/build_detail_index.py).',

      // graph
      'g.error': 'Impossible d’afficher le graphe. Consultez la console du navigateur pour le détail.',
      'g.hint': 'Glissez pour déplacer. Pincez ou faites défiler pour zoomer.',
      'g.controls': 'Contrôles de la vue', 'g.zoomIn': 'Zoom avant', 'g.zoomOut': 'Zoom arrière',
      'g.reset': 'Réinitialiser la vue', 'g.resetText': 'Tout',
      'g.fsOn': 'Plein écran', 'g.fsOff': 'Quitter le plein écran', 'g.fsExit': 'Quitter', 'g.legend': 'Légende',
      'g.listTitle': 'Sélectionnez un projet',
      'g.listIntro': v => pl(v.n, 'projet', 'projets') + (v.filter ? ' · ' + v.filter : '') +
        ' du portfolio public d’ArchiCGI. Les connexions relient chaque projet aux catégories éditoriales de ce prototype.',
      'g.bSearch': 'Rechercher un projet par titre', 'g.bPlaceholder': 'Titre du projet…', 'g.bAll': 'Tout', 'g.bCategory': 'Catégorie du portfolio',
      'g.bStart': v => 'Saisissez un titre ou choisissez un filtre pour parcourir les ' + v.n + ' projets.',
      'g.bCount': v => pl(v.n, 'projet correspond', 'projets correspondent') + '.', 'g.bNone': 'Aucun projet ne correspond.',
      'g.bReset': 'Effacer', 'g.bPrev': 'Précédent', 'g.bNext': 'Suivant', 'g.bPage': v => 'Page ' + v.i + ' sur ' + v.n,
      'nav.media': 'Films', 'sec.media': 'Films et animations',
      'm.lead': 'Séquences réelles publiées par ArchiCGI. Aucun film de cette section ne se télécharge avant que vous appuyiez sur lecture.',
      'm.tab.animation': 'Animations', 'm.tab.compare': 'Avant / après', 'm.tab.tour': 'Visites 3D', 'm.tab.platform': 'Plateforme interactive',
      'm.watch': 'Voir l’animation', 'm.playItem': v => 'Lire : ' + v.title, 'm.close': 'Fermer', 'm.source': 'Voir sur archicgi.com',
      'm.ytPlay': v => 'Lire la vidéo : ' + v.title, 'm.ytNote': 'Vidéo hébergée sur YouTube (mode sans cookies). Elle ne se charge qu’au clic.',
      'm.err': 'Lecture impossible dans ce navigateur. Ouvrez la vidéo sur archicgi.com.',
      'm.before': 'Avant', 'm.after': 'Après', 'm.cmpLabel': 'Position du curseur avant / après', 'm.cmpValue': v => v.p + ' % : après à droite',
      'm.cmpPlay': 'Lire la comparaison', 'm.cmpPause': 'Pause', 'm.cmpHint': 'Glissez le curseur ou utilisez les flèches du clavier. Même plan, avant et après l’intégration en images de synthèse.',
      'g.more': v => 'Afficher ' + v.k + ' de plus (' + v.rest + ' restants)',
      'g.back': 'Retour à la liste', 'g.published': 'Publié par ArchiCGI',
      'g.category': v => 'Catégorie du portfolio : ' + v.list,
      'g.frCaption': v => 'Sur la page française : ' + v.q,
      'g.alsoPublished': 'Même image aussi publiée sous :',
      'g.redirect': 'La page du projet renvoie vers le portfolio, où l’image est publiée.',
      'g.editorialNote': 'Classification éditoriale — déduite du titre et de la description publiés, pas une donnée ArchiCGI. Choisissez une catégorie pour voir les autres projets qui la partagent.',
      'g.near': 'Projets proches', 'g.nearNote': 'Reliés par des catégories éditoriales communes ; les plus rares comptent davantage.',
      'g.shared': v => 'En commun : ' + v.list,
      'g.viewProject': 'Voir le projet sur ArchiCGI', 'g.viewPortfolio': 'Voir dans le portfolio ArchiCGI',
      'g.viewFr': 'Voir sur la page française', 'g.briefAdd': 'Ajouter au brief', 'g.briefRemove': 'Retirer du brief',
      'g.facetKind': v => v.group + ' · catégorie éditoriale',
      'g.facetCount': v => pl(v.n, 'projet lié', 'projets liés') + '. Sous chaque projet : le mot publié par ArchiCGI d’où vient ce lien.',
      'field.title': 'titre ArchiCGI', 'field.alt': 'description d’image ArchiCGI', 'field.category': 'catégorie ArchiCGI',
      'why.fallback': 'déduit des données publiées',

      // search
      's.loading': 'Chargement du catalogue…',
      's.label': 'Décrivez la référence recherchée',
      's.placeholder': 'Ex. : maison moderne',
      's.go': 'Rechercher',
      's.help': 'En français ou en anglais. La recherche lit les titres et les descriptions d’images publiés par ArchiCGI, ses catégories et les tags éditoriaux du prototype.',
      's.filters': 'Filtres', 's.filterAll': 'Tout', 's.clearFilters': 'Effacer les filtres',
      's.filterPresets': 'Filtres du graphe', 's.filterPortfolio': 'Catégorie du portfolio', 's.filterMaterial': 'Matériau',
      's.filtered': v => pl(v.n, 'projet correspond', 'projets correspondent') + ' aux filtres.',
      's.noFilterResults': 'Aucun projet ne correspond aux filtres.',
      's.filterQueryUnknown': v => 'Les résultats correspondent aux filtres sélectionnés. ' +
        (v.unknown ? 'Le catalogue ne contient aucun résultat pour ' + v.unknown + '.' : 'Aucun critère de recherche reconnu.'),
      's.try': 'Essayer :',
      's.examples': ['Maison contemporaine au bord de l’eau, au crépuscule, vue depuis le sol', 'Cabane moderne en forêt, la nuit',
        'Hall d’hôtel en marbre', 'Gratte-ciel en bois sous la neige'],
      's.noCriteria': v => 'Aucun critère reconnu' + (v.unknown ? ' (' + v.unknown + ' introuvable dans le catalogue)' : '') + '. Reformulez ou essayez un exemple.',
      's.full': v => pl(v.n, 'projet réunit', 'projets réunissent') + ' tous les critères' +
        (v.partial ? ', ' + pl(v.partial, 'autre correspondance partielle', 'autres correspondances partielles') : '') + '.',
      's.none': v => 'Aucun projet ne réunit tous les critères. ' + pl(v.partial, 'correspondance partielle', 'correspondances partielles') + ', de la plus proche à la plus éloignée.',
      's.understood': 'Critères compris :',
      's.notFound': v => 'Non trouvé : ' + v.list,
      's.missing': v => 'Le catalogue ne contient aucun projet pour : ' + v.list + '. Les résultats ci-dessous réunissent une partie des critères.',
      's.neverTogether': 'Chaque critère existe dans le catalogue, mais jamais tous ensemble. Les résultats ci-dessous en réunissent une partie.',
      's.edShort': 'Éditorial',
      's.moreResults': v => 'Afficher ' + v.k + ' résultats de plus (' + v.rest + ' restants)',
      's.badgeFull': 'Correspond à tous les critères', 's.badgePartial': v => 'Correspondance partielle · ' + v.m + '/' + v.n,
      's.noImage': 'Pas d’image', 's.imgError': 'Image indisponible',
      's.showGraph': 'Voir dans le graphe', 's.inBrief': 'Dans le brief ✓', 's.addBrief': 'Ajouter au brief',
      's.viewArchi': 'Voir sur ArchiCGI', 's.viewPortfolio': 'Portfolio ArchiCGI',
      's.srcTitle': 'titre', 's.srcAlt': 'description d’image', 's.srcFr': 'légende française', 's.srcCat': 'catégorie',
      's.tagFrom': v => 'Tag déduit de ' + v.q,
      's.near': 'proche : ',
      's.unknown': v => v.Dim + ' non renseigné' + (v.fem ? 'e' : '') + ' dans les données',
      's.other': v => 'les données indiquent : ' + v.list,
      's.absentVals': v => 'non mentionné (données : ' + v.list + ')', 's.absent': 'non mentionné',
      's.sr.match': 'correspond', 's.sr.near': 'correspondance approchée', 's.sr.unknown': 'non renseigné',
      's.sr.absent': 'non mentionné', 's.sr.other': 'ne correspond pas', 's.stillImage': 'image fixe',

      // brief
      'b.title': 'Brief',
      'b.intro': 'Ajoutez des images depuis les résultats ou le graphe, puis indiquez ce qu’il faut reprendre de chacune : la lumière, l’angle de vue, un matériau ou un détail de façade.',
      'b.request': 'Demande', 'b.requestPh': 'Ce que le visuel doit montrer',
      'b.empty': 'La sélection est vide. Utilisez « Ajouter au brief » sur une carte de résultat ou dans le panneau du graphe.',
      'b.storageNote': 'Votre sélection pour le brief est enregistrée uniquement dans ce navigateur.',
      'b.notePh': 'Ex. : reflets du ciel au crépuscule sur la façade vitrée',
      'b.source': 'Source ArchiCGI',
      'b.noteFor': v => 'Note pour ' + v.title, 'b.remove': 'Retirer',
      'b.copy': 'Copier le brief', 'b.clear': 'Vider la sélection', 'b.preview': 'Aperçu du brief',
      'b.emptyCopy': 'La sélection est vide.',
      'b.copied': v => 'Brief copié : ' + pl(v.n, 'référence', 'références') + ' avec leurs liens vers ArchiCGI.',
      'b.copyFail': 'Copie automatique impossible dans ce navigateur : le texte est sélectionné ci-dessous, copiez-le manuellement.',
      // copied text
      'bt.head': 'BRIEF — RÉFÉRENCES VISUELLES', 'bt.request': 'Demande : ',
      'bt.selection': v => 'Sélection : ' + pl(v.n, 'image', 'images') + ' du portfolio public d’ArchiCGI (Discovery Lab).',
      'bt.note': '   Note : ', 'bt.source': '   Source : ',
      'bt.redirect': '   (la page du projet renvoie vers le portfolio ArchiCGI)',
      'bt.category': '   Donnée ArchiCGI : catégorie ', 'bt.tags': '   Tags éditoriaux : ',
      // main screen (redesign)
      'nav.label': 'Sections', 'nav.results': 'Références', 'nav.brief': 'Brief', 'nav.graph': 'Graphe des liens',
      'page.h1': 'Trouvez des références',
      'page.lead': 'Décrivez l’image recherchée, ouvrez un rendu, cherchez un détail de façade similaire et composez votre brief. 434 projets du portfolio public d’ArchiCGI.',
      'sec.results': 'Références', 'sec.graph': 'Graphe des liens', 'sec.gen': 'Variantes générées',
      'sec.graphLead': 'Chaque projet relié à ses catégories éditoriales : choisissez un projet ou une catégorie pour voir ce qui les relie.',
      's.gapUnknown': v => 'Non renseigné : ' + v.list, 's.gapMissing': v => 'Absent : ' + v.list,
      's.why': 'Pourquoi ce résultat', 's.openRender': v => 'Ouvrir le rendu « ' + v.title + ' »',
      'd.addFrame': 'Ajouter le rendu au brief', 'd.frameInBrief': 'Rendu dans le brief ✓',
      'd.pick': v => 'Détail ' + v.n + ' : ' + v.title + ' — ' + v.level,
      // facade details (discovery-details.js)
      'd.enlarge': 'Voir le rendu', 'd.find': 'Rechercher des détails similaires', 'd.stopSelect': 'Annuler la sélection',
      'd.notIndexed': v => 'Ce rendu ne fait pas encore partie de l’index des façades (' + v.n + ' projets). La recherche de détails n’y est pas disponible.',
      'd.close': 'Fermer', 'd.back': '← Retour aux résultats', 'd.clear': 'Effacer la sélection',
      'd.intro': 'Rendu en taille réelle. Choisissez « Rechercher des détails similaires », puis tracez un rectangle sur une partie de la façade.',
      'd.hint': 'Tracez un rectangle sur la façade à la souris ou au doigt. Au clavier : Entrée crée une sélection, les flèches la déplacent, Maj + flèches la redimensionnent, Entrée lance la recherche.',
      'd.kbd': 'Déplacez la sélection avec les flèches, redimensionnez avec Maj + flèches, puis appuyez sur Entrée.',
      'd.tooSmall': 'Sélection trop petite : tracez un rectangle plus grand.',
      'd.overlay': 'Zone de sélection sur le rendu',
      'd.marked': 'Zone du détail trouvé', 'd.markedHint': 'La zone encadrée est le fragment trouvé dans ce rendu.',
      'd.searching': 'Recherche des détails similaires…',
      'd.error': 'La recherche de détails n’a pas pu se charger. Réessayez plus tard.',
      'd.summary': v => 'Comparaison avec ' + v.fragments + ' fragments de façades issus de ' + v.projects + ' projets du catalogue (les autres projets uniquement).',
      'd.weak': v => 'Peu de détails proches dans l’index : ' + (v.k === 0 ? 'aucun fragment n’est assez proche' : v.k > 1 ? 'seulement ' + v.k + ' fragments sont assez proches' : 'un seul fragment est assez proche') + '. Les autres résultats ne sont que des pistes éloignées.',
      'd.resultsTitle': 'Détails les plus proches',
      'd.level.close': 'Très proche', 'd.level.related': 'Proche', 'd.level.far': 'Éloigné',
      'd.viewFrame': 'Voir le cadre', 'd.add': 'Ajouter au brief', 'd.inBrief': 'Dans le brief ✓', 'd.addMark': 'Ajouter ce détail au brief',
      'd.added': 'Détail ajouté au brief.', 'd.writeNote': 'Écrire ce qu’il faut en reprendre',
      'd.cropOf': v => 'Fragment de «\u00a0' + v.title + '\u00a0»',
      'b.zone': v => 'zone x ' + v.x0 + '–' + v.x1 + ' %, y ' + v.y0 + '–' + v.y1 + ' % du rendu',
      'b.detailOf': v => 'Détail de «\u00a0' + v.title + '\u00a0»', 'b.detailBadge': 'Détail', 'b.viewDetail': 'Voir le détail',
      'bt.detail': '   Détail : ', 'bt.detailLink': '   Voir le détail : ',
      'bt.footer': 'Tags éditoriaux : classification du prototype Discovery Lab, déduite des titres et descriptions publiés ; ce ne sont pas des données ArchiCGI. Images © ArchiCGI.'
    },
    en: {
      'lang.switch': 'Interface language', 'lang.fr': 'Français', 'lang.en': 'English',
      'page.title': 'ArchiCGI — Discovery Lab',
      'page.kicker': 'REFERENCE GRAPH — 434 PROJECTS',
      'page.intro': 'Find visual references for a brief among the 434 projects in ArchiCGI’s public portfolio. Describe the image you are looking for in your own words, compare the projects that answer it, explore how they connect in the graph, then build an annotated selection to copy into your brief.',
      'steps.label': 'Steps', 'steps.1': '1. Describe', 'steps.2': '2. Compare', 'steps.3': '3. Explore the links', 'steps.4': '4. Build the brief',
      'step.search': '1. Describe the reference', 'step.graph': '3. Explore the links',
      'graph.section': 'Architectural reference explorer', 'graph.filters': 'Project filters',
      'graph.canvas': 'Interactive graph of projects and features',
      'footer.text': 'Independent prototype · 434 projects from ArchiCGI’s public portfolio · Images © ArchiCGI · Snapshot of 23 November 2026',
      'footer.source': 'French portfolio page', 'footer.portfolio': 'Full portfolio',
      'footer.about': 'About the data',
      'footer.notes': 'Titles, images, links and categories come from ArchiCGI, as published: 438 entries, with 4 pairs of identical images merged. Filters, graph and search use this prototype’s own editorial classification. Detail search compares your selection with 181,369 fragments from 434 projects (DINOv2, tools/build_detail_index.py).',

      'g.error': 'The graph could not be displayed. See the browser console for details.',
      'g.hint': 'Drag to move. Pinch or scroll to zoom.',
      'g.controls': 'View controls', 'g.zoomIn': 'Zoom in', 'g.zoomOut': 'Zoom out',
      'g.reset': 'Reset view', 'g.resetText': 'Fit',
      'g.fsOn': 'Full screen', 'g.fsOff': 'Exit full screen', 'g.fsExit': 'Exit', 'g.legend': 'Legend',
      'g.listTitle': 'Select a project',
      'g.listIntro': v => plEn(v.n, 'project', 'projects') + (v.filter ? ' · ' + v.filter : '') +
        ' from ArchiCGI’s public portfolio. Links connect each project to this prototype’s editorial categories.',
      'g.bSearch': 'Search projects by title', 'g.bPlaceholder': 'Project title…', 'g.bAll': 'All', 'g.bCategory': 'Portfolio category',
      'g.bStart': v => 'Type a title or pick a filter to browse the ' + v.n + ' projects.',
      'g.bCount': v => plEn(v.n, 'project matches', 'projects match') + '.', 'g.bNone': 'No project matches.',
      'g.bReset': 'Clear', 'g.bPrev': 'Previous', 'g.bNext': 'Next', 'g.bPage': v => 'Page ' + v.i + ' of ' + v.n,
      'nav.media': 'Films', 'sec.media': 'Films and animations',
      'm.lead': 'Real footage published by ArchiCGI. No film in this section downloads until you press play.',
      'm.tab.animation': 'Animations', 'm.tab.compare': 'Before / after', 'm.tab.tour': '3D tours', 'm.tab.platform': 'Interactive platform',
      'm.watch': 'Watch the animation', 'm.playItem': v => 'Play: ' + v.title, 'm.close': 'Close', 'm.source': 'View on archicgi.com',
      'm.ytPlay': v => 'Play video: ' + v.title, 'm.ytNote': 'Video hosted on YouTube (no-cookie mode). It only loads when you click.',
      'm.err': 'This browser cannot play the video. Open it on archicgi.com.',
      'm.before': 'Before', 'm.after': 'After', 'm.cmpLabel': 'Before / after slider position', 'm.cmpValue': v => v.p + '%: after on the right',
      'm.cmpPlay': 'Play the comparison', 'm.cmpPause': 'Pause', 'm.cmpHint': 'Drag the slider or use the arrow keys. Same shot, before and after the CG is blended in.',
      'g.more': v => 'Show ' + v.k + ' more (' + v.rest + ' left)',
      'g.back': 'Back to the list', 'g.published': 'Published by ArchiCGI',
      'g.category': v => 'Portfolio category: ' + v.list,
      'g.frCaption': v => 'On the French page: ' + v.q,
      'g.alsoPublished': 'Same image also published as:',
      'g.redirect': 'The project page redirects to the portfolio, where the image is published.',
      'g.editorialNote': 'Editorial classification — derived from the published title and description, not ArchiCGI data. Choose a category to see the other projects that share it.',
      'g.near': 'Related projects', 'g.nearNote': 'Linked by shared editorial categories; rarer ones count more.',
      'g.shared': v => 'Shared: ' + v.list,
      'g.viewProject': 'View the project on ArchiCGI', 'g.viewPortfolio': 'View in the ArchiCGI portfolio',
      'g.viewFr': 'View on the French page', 'g.briefAdd': 'Add to brief', 'g.briefRemove': 'Remove from brief',
      'g.facetKind': v => v.group + ' · editorial category',
      'g.facetCount': v => plEn(v.n, 'linked project', 'linked projects') + '. Under each project: the word published by ArchiCGI that this link comes from.',
      'field.title': 'ArchiCGI title', 'field.alt': 'ArchiCGI image description', 'field.category': 'ArchiCGI category',
      'why.fallback': 'derived from the published data',

      's.loading': 'Loading the catalogue…',
      's.label': 'Describe the reference you need',
      's.placeholder': 'E.g. contemporary waterfront house at dusk',
      's.go': 'Search',
      's.help': 'In French or English. Search reads the titles and image descriptions published by ArchiCGI, its categories and the prototype’s editorial tags.',
      's.filters': 'Filters', 's.filterAll': 'All', 's.clearFilters': 'Clear filters',
      's.filterPresets': 'Graph filters', 's.filterPortfolio': 'Portfolio category', 's.filterMaterial': 'Material',
      's.filtered': v => plEn(v.n, 'project matches', 'projects match') + ' the filters.',
      's.noFilterResults': 'No projects match these filters.',
      's.filterQueryUnknown': v => 'Showing projects that match the filters. ' +
        (v.unknown ? 'The catalogue has no match for ' + v.unknown + '.' : 'No search criteria recognised.'),
      's.try': 'Try:',
      's.examples': ['Contemporary waterfront house at dusk, eye-level view', 'Modern cabin in the forest at night',
        'Marble hotel lobby', 'Timber skyscraper in the snow'],
      's.noCriteria': v => 'No criteria recognised' + (v.unknown ? ' (' + v.unknown + ' not found in the catalogue)' : '') + '. Rephrase or try an example.',
      's.full': v => plEn(v.n, 'project meets', 'projects meet') + ' every criterion' +
        (v.partial ? ', ' + plEn(v.partial, 'other partial match', 'other partial matches') : '') + '.',
      's.none': v => 'No project meets every criterion. ' + plEn(v.partial, 'partial match', 'partial matches') + ', closest first.',
      's.understood': 'Criteria understood:',
      's.notFound': v => 'Not found: ' + v.list,
      's.missing': v => 'The catalogue has no project for: ' + v.list + '. The results below meet some of the criteria.',
      's.neverTogether': 'Each criterion exists in the catalogue, but never all together. The results below meet some of them.',
      's.edShort': 'Editorial',
      's.moreResults': v => 'Show ' + v.k + ' more results (' + v.rest + ' left)',
      's.badgeFull': 'Meets every criterion', 's.badgePartial': v => 'Partial match · ' + v.m + '/' + v.n,
      's.noImage': 'No image', 's.imgError': 'Image unavailable',
      's.showGraph': 'Show in the graph', 's.inBrief': 'In the brief ✓', 's.addBrief': 'Add to brief',
      's.viewArchi': 'View on ArchiCGI', 's.viewPortfolio': 'ArchiCGI portfolio',
      's.srcTitle': 'title', 's.srcAlt': 'image description', 's.srcFr': 'French caption', 's.srcCat': 'category',
      's.tagFrom': v => 'Tag derived from ' + v.q,
      's.near': 'close: ',
      's.unknown': v => v.Dim + ' not stated in the data',
      's.other': v => 'the data says: ' + v.list,
      's.absentVals': v => 'not mentioned (data: ' + v.list + ')', 's.absent': 'not mentioned',
      's.sr.match': 'matches', 's.sr.near': 'close match', 's.sr.unknown': 'not stated',
      's.sr.absent': 'not mentioned', 's.sr.other': 'does not match', 's.stillImage': 'still image',

      'b.title': 'Brief',
      'b.intro': 'Add images from the results or the graph, then write a short note on what you want to remember about each one.',
      'b.request': 'Request', 'b.requestPh': 'What the visual should show',
      'b.empty': 'The selection is empty. Use “Add to brief” on a result card or in the graph panel.',
      'b.storageNote': 'Your brief selection is saved only in this browser.',
      'b.notePh': 'E.g. sky reflections at dusk on the glazed facade',
      'b.source': 'ArchiCGI source',
      'b.noteFor': v => 'Note for ' + v.title, 'b.remove': 'Remove',
      'b.copy': 'Copy brief', 'b.clear': 'Clear selection', 'b.preview': 'Brief preview',
      'b.emptyCopy': 'The selection is empty.',
      'b.copied': v => 'Brief copied: ' + plEn(v.n, 'reference', 'references') + ' with their ArchiCGI links.',
      'b.copyFail': 'Automatic copy is not available in this browser: the text is selected below, copy it manually.',
      'bt.head': 'BRIEF — VISUAL REFERENCES', 'bt.request': 'Request: ',
      'bt.selection': v => 'Selection: ' + plEn(v.n, 'image', 'images') + ' from ArchiCGI’s public portfolio (Discovery Lab).',
      'bt.note': '   Note: ', 'bt.source': '   Source: ',
      'bt.redirect': '   (the project page redirects to the ArchiCGI portfolio)',
      'bt.category': '   ArchiCGI data: category ', 'bt.tags': '   Editorial tags: ',
      'nav.label': 'Sections', 'nav.results': 'References', 'nav.brief': 'Brief', 'nav.graph': 'Link graph',
      'page.h1': 'Find references',
      'page.lead': 'Describe the image you need, open a render, search for a similar facade detail and build your brief. 434 projects from ArchiCGI’s public portfolio.',
      'sec.results': 'References', 'sec.graph': 'Link graph', 'sec.gen': 'Generated variants',
      'sec.graphLead': 'Each project linked to its editorial categories: choose a project or a category to see what connects them.',
      's.gapUnknown': v => 'Not stated: ' + v.list, 's.gapMissing': v => 'Missing: ' + v.list,
      's.why': 'Why this result', 's.openRender': v => 'Open the render “' + v.title + '”',
      'd.addFrame': 'Add the render to the brief', 'd.frameInBrief': 'Render in the brief ✓',
      'd.pick': v => 'Detail ' + v.n + ': ' + v.title + ' — ' + v.level,
      'd.enlarge': 'View render', 'd.find': 'Find similar details', 'd.stopSelect': 'Cancel selection',
      'd.notIndexed': v => 'This render is not in the facade index yet (' + v.n + ' projects). Detail search is not available for it.',
      'd.close': 'Close', 'd.back': '← Back to results', 'd.clear': 'Clear selection',
      'd.intro': 'Full-size render. Choose “Find similar details”, then draw a rectangle on part of the facade.',
      'd.hint': 'Draw a rectangle on the facade with the mouse or your finger. Keyboard: Enter creates a selection, arrows move it, Shift + arrows resize it, Enter runs the search.',
      'd.kbd': 'Move the selection with the arrows, resize with Shift + arrows, then press Enter.',
      'd.tooSmall': 'Selection too small: draw a larger rectangle.',
      'd.overlay': 'Selection area on the render',
      'd.marked': 'Area of the detail found', 'd.markedHint': 'The framed area is the fragment found in this render.',
      'd.searching': 'Searching for similar details…',
      'd.error': 'The detail search could not load. Please try again later.',
      'd.summary': v => 'Compared with ' + v.fragments + ' facade fragments from ' + v.projects + ' catalogue projects (other projects only).',
      'd.weak': v => 'Few close details in the index: ' + (v.k === 0 ? 'no fragment is close enough' : v.k > 1 ? 'only ' + v.k + ' fragments are close enough' : 'only one fragment is close enough') + '. The other results are only distant leads.',
      'd.resultsTitle': 'Closest details',
      'd.level.close': 'Very close', 'd.level.related': 'Close', 'd.level.far': 'Distant',
      'd.viewFrame': 'View the frame', 'd.add': 'Add to brief', 'd.inBrief': 'In the brief ✓', 'd.addMark': 'Add this detail to the brief',
      'd.added': 'Detail added to the brief.', 'd.writeNote': 'Write what to take from it',
      'd.cropOf': v => 'Fragment of “' + v.title + '”',
      'b.zone': v => 'area x ' + v.x0 + '–' + v.x1 + '%, y ' + v.y0 + '–' + v.y1 + '% of the render',
      'b.detailOf': v => 'Detail of “' + v.title + '”', 'b.detailBadge': 'Detail', 'b.viewDetail': 'View the detail',
      'bt.detail': '   Detail: ', 'bt.detailLink': '   View the detail: ',
      'bt.footer': 'Editorial tags: Discovery Lab prototype classification, derived from published titles and descriptions; they are not ArchiCGI data. Images © ArchiCGI.'
    }
  };

  /* ---------- state ---------- */
  let lang = 'fr';
  try { const s = localStorage.getItem(STORE_KEY); if (LANGS.includes(s)) lang = s; } catch (_) { /* private mode */ }

  function t(key, vars) {
    const v = (STR[lang] && key in STR[lang]) ? STR[lang][key] : STR.fr[key];
    if (v === undefined) { console.warn('[discovery i18n] missing key', key); return key; }
    return typeof v === 'function' ? v(vars || {}) : v;
  }
  const tag = label => (lang === 'en' && TAGS_EN[label]) || label;
  const group = (key, fallback) => (lang === 'en' && GROUPS_EN[key]) || fallback || key;
  const filter = (id, fallback) => (lang === 'en' && FILTERS_EN[id]) || fallback || id;
  // quoted published text: French guillemets or English quotes; the quoted words stay as published
  const quote = s => (lang === 'en' ? '“' + s + '”' : '« ' + s + ' »');

  /* ---------- static page text ---------- */
  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = t('page.title');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.dataset.i18nAttr.split(';').forEach(pair => {
        const [attr, key] = pair.split(':').map(x => x.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
    document.querySelectorAll('.dl-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    const sw = document.querySelector('.dl-lang');
    if (sw) sw.setAttribute('aria-label', t('lang.switch'));
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE_KEY, lang); } catch (_) { /* ignore */ }
    applyStatic();
    document.dispatchEvent(new CustomEvent('discovery:lang', { detail: { lang } }));
  }

  // FR / EN switch (built here so the page works without it if scripts fail)
  function mountSwitch() {
    const host = document.getElementById('dl-lang');
    if (!host) return;
    host.classList.add('dl-lang');
    host.setAttribute('role', 'group');
    host.replaceChildren(...LANGS.map(l => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.lang = l; b.textContent = l.toUpperCase();
      b.setAttribute('lang', l);
      b.setAttribute('aria-label', STR[l]['lang.' + l]);
      b.addEventListener('click', () => setLang(l));
      return b;
    }));
  }

  window.discoveryI18n = { get lang() { return lang; }, t, tag, group, filter, quote, setLang, pl, plEn };
  mountSwitch();
  applyStatic();
})();
