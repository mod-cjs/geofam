/**
 * REGISTRE VERSIONNE DES MOTEURS (incrément #37).
 *
 * Les moteurs sont FOURNIS par le client (STARFIRE) sous forme de HTML
 * mono-fichier, et sont en EVOLUTION CONSTANTE. Ce registre rend chaque
 * version TRACABLE et RE-VERIFIABLE :
 *
 *   - une evolution d un moteur = nouveau contenu source => nouveau SHA-256
 *     => bump de la version du module extrait => golden rejoue (cf. methode
 *     golden-master, packages/engines/README.md) ;
 *   - un PV doit pouvoir etre RECALCULE avec la version EXACTE qui l a produit :
 *     la sortie moteur porte `meta.engineVersion` (+ `meta.engineSourceHash`,
 *     cf. @roadsen/shared) qui pointe vers une entree de CE registre.
 *
 * --- CE QUE CE FICHIER NE CONTIENT JAMAIS (DoD §8) ---
 * Aucune formule, aucun symbole, aucun code de calcul moteur. UNIQUEMENT des
 * METADONNEES : nom logique, fonction reelle, chemin source, empreinte, version,
 * normes. C est de la PAPERASSE de tracabilite, pas de la propriete
 * intellectuelle. Il reste donc cote depot et n a aucune raison d etre importe
 * par le front (le garde-fou ESLint engines->web s applique de toute facon a
 * tout @roadsen/engines).
 *
 * --- IMPORTANT : nom de fichier != fonction (piege connu) ---
 * Les noms de fichiers GeoSuite sont TROMPEURS. La `fonction` ci-dessous a ete
 * CONFIRMEE par lecture du contenu (titre + termes metier), PAS deduite du nom.
 * Cf. champ `confirmePar` de chaque entree et la mémoire `geosuite-engine-mapping`.
 */

import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Une entree du registre : tout ce qu il faut pour RE-VERIFIER un calcul, sans
 * jamais embarquer le calcul lui-meme.
 */
export interface EngineRegistryEntry {
  /** Identifiant logique stable (= cle de registre, kebab-case, cf. EngineId). */
  readonly id: string;
  /** Fonction REELLE du moteur (confirmee par lecture du contenu, pas le nom). */
  readonly fonction: string;
  /** Norme(s) de reference declaree(s) par le moteur (tracabilite, indicatif). */
  readonly normes: readonly string[];
  /** Nom du fichier source TEL QU IL EST (volontairement trompeur). */
  readonly fichierSource: string;
  /**
   * Chemin source EXACT, relatif a la racine du repo monorepo
   * (`05-Plateforme/`). Les sources vivent HORS du sous-arbre versionne, dans
   * `03-Moteurs-client/` : ce chemin remonte donc d un niveau. C est la SOURCE
   * DE REFERENCE (GeoSuite/source/tools = 6 moteurs A JOUR).
   */
  readonly cheminSource: string;
  /** SHA-256 (hex minuscule, 64 car.) du HTML source a la version `version`. */
  readonly sha256: string;
  /**
   * Version SEMVER du MODULE extrait (pas du HTML). Demarre a 0.0.0 tant
   * qu aucun module TS n a ete extrait (extraction = incrément ulterieur) ;
   * passera a 1.0.0 a la premiere extraction equivalente validee par golden.
   */
  readonly version: string;
  /**
   * Comment la fonction reelle a ete CONFIRMEE (anti-erreur d extraction).
   * Trace de la verification de contenu — exigee par la consigne #37.
   */
  readonly confirmePar: string;
}

/**
 * Racine des sources moteur (HORS dépôt git), relative à `05-Plateforme/`.
 * Sert au test de cohérence hash pour localiser les fichiers en LOCAL.
 */
export const ENGINE_SOURCES_ROOT = '../03-Moteurs-client';

/**
 * Sous-dossier CANONIQUE : les 6 moteurs A JOUR (source de reference). Les
 * copies a la racine de `03-Moteurs-client/` sont des versions ANTERIEURES
 * (cf. ENGINE_SOURCE_DUPLICATES) et NE doivent PAS etre extraites.
 */
export const ENGINE_SOURCES_CANONICAL_DIR = `${ENGINE_SOURCES_ROOT}/GeoSuite/source/tools`;

/**
 * LE REGISTRE. 6 moteurs canoniques GeoSuite. Hashs calcules le 2026-06-23 sur
 * `03-Moteurs-client/GeoSuite/source/tools/*.html`. Toute evolution d un moteur
 * met a jour `sha256` (+ bump `version`) ICI, et le test de coherence mord.
 */
export const ENGINE_REGISTRY: readonly EngineRegistryEntry[] = [
  {
    id: 'chaussee-burmister',
    fonction:
      'Dimensionnement rationnel des chaussées (Burmister / AGEROUTE Sénégal 2015)',
    normes: ['AGEROUTE Sénégal 2015', 'Méthode rationnelle (Burmister)'],
    fichierSource: 'roadsens_burmister_LCPC_VF_moderne.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/roadsens_burmister_LCPC_VF_moderne.html`,
    sha256: '259a58a8ac0881b20657a34a119de6e603a0ed2895fb4fca21527f2d8cfeb8ba',
    // 1.0.0 : 1ere extraction equivalente (module TS, #46). engineSourceHash =
    // ce sha256, lie a chaque sortie via meta (@roadsen/shared) -> un PV reste
    // re-verifiable contre la version source EXACTE qui l a produit, meme apres
    // evolution du moteur. Equivalence-PORTAGE prouvee (rel 1e-9) ; justesse
    // scientifique NON validee tant que le kit cas-tests STARFIRE manque
    // (@science-unsigned, MJ-6 : pas de prod sans conformite).
    version: '1.0.0',
    confirmePar:
      'title="ROADSENS — Dimensionnement rationnel des chaussées · AGEROUTE Sénégal 2015"',
  },
  {
    id: 'radier-plaque',
    fonction: 'Plaques / radiers sur sol multicouche élastique',
    normes: ['Modèle multicouche élastique'],
    fichierSource: 'GEOPLAQUE_V10.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/GEOPLAQUE_V10.html`,
    sha256: '45e3e24c405c35c21c0ae8e1d92f214036390f36f7215b96d97ac61feed9bbab',
    version: '0.0.0',
    confirmePar: 'title="GEOPLAQUE — plaques sur sol multicouche élastique"',
  },
  {
    id: 'fondation-profonde-pieux',
    fonction: 'Fondations profondes — pieux (portance, frottement latéral)',
    normes: ['NF P 94-262'],
    fichierSource: 'casagrande_V5.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/casagrande_V5.html`,
    sha256: '54c5d7d4cfd0d88998b26010335c888b9361163e0eb2825814f0c6430e4d86b0',
    // 1.0.0 : 1ere extraction equivalente (module TS, #48). engineSourceHash =
    // ce sha256, lie a chaque sortie via meta (@roadsen/shared) -> un PV reste
    // re-verifiable contre la version source EXACTE qui l a produit, meme apres
    // evolution du moteur. Equivalence-PORTAGE prouvee (rel 1e-9) ; justesse
    // scientifique NON validee tant que le kit cas-tests STARFIRE manque
    // (@science-unsigned, MJ-6 : pas de prod sans conformite).
    version: '1.0.0',
    confirmePar:
      'title="CASAGRANDE — Calcul de fondations profondes (NF P 94-262)" + 69 occurrences "pieu"',
  },
  {
    id: 'fondation-superficielle',
    fonction: 'Fondations superficielles (capacité portante, EC7)',
    normes: ['NF P 94-261', 'Eurocode 7'],
    fichierSource: 'terzaghi_V13.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/terzaghi_V13.html`,
    sha256: '43214960a014d64e76c8d06e8d9c9746157ba0f75220afc425d6e87fd102c291',
    // 1.0.0 : 1ere extraction equivalente (module TS, #45). engineSourceHash =
    // ce sha256, lie a chaque sortie via meta (@roadsen/shared) -> un PV reste
    // re-verifiable contre la version source EXACTE qui l a produit, meme apres
    // evolution du moteur. Equivalence-PORTAGE prouvee (rel 1e-9) ; justesse
    // scientifique NON validee tant que le kit cas-tests STARFIRE manque
    // (@science-unsigned, MJ-6 : pas de prod sans conformite).
    version: '1.0.0',
    confirmePar: 'title="Terzaghi — Fondations superficielles · NF P 94-261"',
  },
  {
    id: 'pressiometre-menard',
    fonction: 'Essai pressiométrique Ménard (pression limite, module pressiométrique)',
    normes: ['NF EN ISO 22476-4', 'Ménard'],
    fichierSource: 'pressiometre__1_.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/pressiometre__1_.html`,
    sha256: 'b5a06e1c34e1928b06a3e9dcd5628d516ba7d0d2818a67c62bdb43e93c65e4dc',
    // 1.0.0 : 1ere extraction equivalente (module TS, #47). engineSourceHash =
    // ce sha256, lie a chaque sortie via meta (@roadsen/shared) -> un PV reste
    // re-verifiable contre la version source EXACTE qui l a produit, meme apres
    // evolution du moteur. Equivalence-PORTAGE prouvee (rel 1e-9) ; justesse
    // scientifique NON validee tant que le kit cas-tests STARFIRE manque
    // (@science-unsigned, MJ-6 : pas de prod sans conformite).
    version: '1.0.0',
    confirmePar: 'title="PressioPro — Ménard NF EN ISO 22476-4"',
  },
  {
    id: 'labo-classification-gtr',
    fonction:
      'Traitement des essais de laboratoire & classification GTR (Proctor, Atterberg, granulométrie, indices de compression Cc/Cs)',
    normes: ['NF P 11-300', 'GTR'],
    fichierSource: 'FASTLAB7.html',
    cheminSource: `${ENGINE_SOURCES_CANONICAL_DIR}/FASTLAB7.html`,
    sha256: '3271287e551448ea5ce8396a2e9687e38c7245a3c49259a02a5f4f393f48599a',
    version: '0.0.0',
    confirmePar:
      'title="FASTLAB — Traitement des essais & classification GTR (NF P 11-300)" + termes Proctor/Atterberg/Cc/Cs',
  },
];

/**
 * Doublons / versions ANTERIEURES presentes a la racine de `03-Moteurs-client/`.
 * Ne PAS extraire : ce sont des copies plus anciennes que les canoniques
 * GeoSuite (versions de fichier inferieures, contenu different => hash different).
 * Listees ici UNIQUEMENT pour tracer la recommandation d archivage (#37 critère 5).
 * On NE deplace RIEN (deplacement d un fichier client = accord humain).
 */
export interface EngineSourceDuplicate {
  readonly fichier: string;
  readonly cheminSource: string;
  readonly sha256: string;
  /** Entree canonique qui le remplace (id du registre). */
  readonly remplacePar: string;
  readonly recommandation: string;
}

export const ENGINE_SOURCE_DUPLICATES: readonly EngineSourceDuplicate[] = [
  {
    fichier: 'casagrande_V1.html',
    cheminSource: `${ENGINE_SOURCES_ROOT}/casagrande_V1.html`,
    sha256: '1b272e5f991a79bfbf80f1694a74abe7aa7d1f49f88fd3445628df1768f7dbc0',
    remplacePar: 'fondation-profonde-pieux',
    recommandation:
      'Version anterieure (V1) du moteur pieux ; la canonique est casagrande_V5. Archiver vers _archive/ ou marquer « ne pas extraire ».',
  },
  {
    fichier: 'terzaghi V9.html',
    cheminSource: `${ENGINE_SOURCES_ROOT}/terzaghi V9.html`,
    sha256: 'b0c6bfb1230078e138c890033ba21dda730a4e1435bc78704d15bebe7f1ecabe',
    remplacePar: 'fondation-superficielle',
    recommandation:
      'Version anterieure (V9) du moteur fondation superficielle ; la canonique est terzaghi_V13. Archiver vers _archive/ ou marquer « ne pas extraire ».',
  },
  {
    fichier: 'roadsen_burmister_LCPC_VF.html',
    cheminSource: `${ENGINE_SOURCES_ROOT}/roadsen_burmister_LCPC_VF.html`,
    sha256: '64d1297bbd9f98aca1c3edc9e9a8a8e907f91e064a8b8f66a9495bfe35c313f6',
    remplacePar: 'chaussee-burmister',
    recommandation:
      'Version anterieure (non « moderne ») du moteur chaussées ; la canonique est roadsens_burmister_LCPC_VF_moderne. Archiver vers _archive/ ou marquer « ne pas extraire ».',
  },
];

/** Recherche une entree de registre par id logique. */
export function findEngine(id: string): EngineRegistryEntry | undefined {
  return ENGINE_REGISTRY.find((e) => e.id === id);
}

/**
 * Reference du marqueur de confidentialite (DoD §8). Bien que le registre ne
 * contienne aucune science, il appartient a @roadsen/engines : on embarque la
 * chaine litterale stable pour que, si ce module fuyait dans un bundle front,
 * le controle de confidentialite CI le detecte (defense en profondeur).
 */
export const REGISTRY_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;
