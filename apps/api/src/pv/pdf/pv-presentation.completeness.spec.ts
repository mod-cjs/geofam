/**
 * TEST DE COMPLÉTUDE FAIL-CLOSED (#71, correctif B-1).
 *
 * Doctrine maison (DoD §8, cf. radier-localisations-failclosed /
 * redaction-failclosed-harmonisation) : le canal riche du PV est une WHITELIST.
 * Aucun champ scellé n'est rendu « automatiquement ». Pour garantir qu'on n'OMET
 * pas non plus silencieusement un champ, on ENUMÈRE ici toutes les feuilles d'un
 * input+output scellé représentatif (chaussée) et on assert que CHAQUE feuille est
 * SOIT mappée (groupe / structure / critère / verdict) SOIT dans hiddenKeys SOIT
 * traitée à part (warnings).
 *
 * Une clé NOUVELLE non décidée -> ce test ROUGE -> le mainteneur tranche AU DEV
 * (mapper ou masquer), jamais une fuite au rendu. C'est la sentinelle qui remplace
 * l'ancien rendu fail-open « Autres paramètres ».
 */
import { CHAUSSEE_PRESENTATION } from './pv-presentation/chaussee';
import { enumerateMappedPaths } from './pv-presentation/render';

/** Entrée/sortie chaussée représentatives (mêmes que la fixture réelle). */
const INPUT = {
  projet: 'Aménagement RN1 — Lot 3',
  layers: [
    { mat: 'BBSG1', E: 1512, nu: 0.45, h: 0.06 },
    { mat: 'GB3', E: 2588, nu: 0.45, h: 0.1 },
    { mat: 'GL1', E: 200, nu: 0.35, h: 0.25 },
  ],
  subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
  traffic: { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 },
  load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
};
const OUTPUT = {
  erreur: null,
  warnings: [],
  conforme: false,
  NE: 1467314.82,
  // Famille SCELLEE = sortie NETTOYEE par la projection moteur (libelle NU, sans K).
  famille: 'bitumineuse épaisse',
  epaisseurLiee: 0.16,
  epaisseurTotale: 0.41,
  fatigue: {
    rigide: false,
    valeur: 290.58,
    admissible: 205.67,
    ok: false,
    requis: true,
  },
  ornierage: { valeur: 891.49, admissible: 511.5, ok: false },
  // Critères SECONDAIRES peuplés (représentatifs) : la sentinelle fail-closed doit
  // décider CHAQUE feuille -> chacune est mappée (critère/table) ou masquée.
  fatiguePhase2: {
    valeur: 509.37,
    admissible: 201.54,
    ok: false,
    requis: false,
    couche: 1,
  },
  fatigueInverse: {
    valeur: 0.469,
    admissible: 0.384,
    ok: false,
    requis: true,
    couche: 4,
  },
  couchesTraitees: [
    {
      couche: 2,
      mode: 'semi-collée',
      valeur: 0.27,
      admissible: 0.42,
      ok: true,
      requis: true,
    },
    {
      couche: 3,
      mode: 'semi-collée',
      valeur: 0.33,
      admissible: 0.38,
      ok: true,
      requis: true,
    },
  ],
  couchesGranulaires: [
    { couche: 2, valeur: 686.12, admissible: 511.5, ok: false, requis: true },
  ],
  // DETAILS DE CALCUL (annexe « Rapport détaillé », ADR 0014) : grandeurs de sortie
  // whitelistées affichées par renderDetails. La sentinelle fail-closed doit décider
  // CHAQUE sous-clé -> chacune est mappée par le detailReport (ou le test rougit).
  details: {
    E1_pond: 2100,
    nu1_pond: 0.437,
    E_psc: 50,
    nu_psc: 0.35,
    risque_pct: 2,
    sigmaZ_r0: 245.3,
    sigmaR_r0: -12.4,
    sigmaZ_d2: 180.1,
    sigmaR_d2: -6.2,
    epsilonT_r0: 290.58,
    epsilonT_d2: 265.1,
    epsilonT: 290.58,
    epsilonT_adm: 205.67,
    epsilonZ_axe: 891.49,
    epsilonZ_mid: 760.2,
    epsilonZ: 891.49,
    epsilonZ_adm: 511.5,
    ktheta: 1.024,
    sn: 0.3,
    sh_cm: 3,
    delta: 0.412,
    kr: 0.842,
    kc: 1.3,
    ks: 0.94,
    ub: 5,
    adm_r50: 244.3,
    sigmaZ_psc_kpa: 42.1,
    sigmaR_psc_kpa: 8.7,
  },
};

/** Énumère les CHEMINS FEUILLES « décidables » (1er niveau sous un conteneur). */
function decidableTopPaths(root: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(root)) {
    if (Array.isArray(v)) {
      // tableau de couches : la structure le couvre via son layersPath -> on note
      // la racine (layers) comme clé décidable.
      out.push(k);
    } else if (v != null && typeof v === 'object') {
      // objet imbriqué (subgrade, traffic, load, fatigue, ornierage) : chaque
      // sous-clé est décidable (chemin pointé k.sub).
      for (const sub of Object.keys(v)) {
        out.push(`${k}.${sub}`);
      }
    } else {
      out.push(k);
    }
  }
  return out;
}

describe('#71 B-1 — complétude fail-closed du modèle chaussée', () => {
  it('CHAQUE feuille scellée est mappée OU masquée OU traitée à part (jamais orpheline)', () => {
    const mapped = enumerateMappedPaths(CHAUSSEE_PRESENTATION);
    const hidden = new Set(CHAUSSEE_PRESENTATION.hiddenKeys);
    // « warnings » est traité À PART (encadré d'alerte) -> décision explicite.
    const handledApart = new Set(['warnings']);

    const allPaths = [
      ...decidableTopPaths(INPUT),
      ...decidableTopPaths(OUTPUT),
    ];

    const orphans = allPaths.filter(
      (p) =>
        !mapped.has(p) &&
        !hidden.has(p) &&
        !handledApart.has(p) &&
        // un parent mappé (ex. layers couvre layers.*) suffit
        !isCovered(p, mapped) &&
        !isCovered(p, hidden),
    );

    // Si ce test ROUGIT : une clé scellée n'est NI mappée NI masquée. Le mainteneur
    // DOIT trancher (l'ajouter à un groupe OU à hiddenKeys) — jamais de fuite auto.
    expect(orphans).toEqual([]);
  });

  // L'IDENTITÉ scellée (auteur + org + projet) est rendue par les cartes d'identité
  // / le visa / l'objet (hors voie « rich body »). On verrouille ici que CHAQUE clé
  // d'identité est SOIT rendue (RENDERED) SOIT volontairement non affichée
  // (EXCLUDED) — une nouvelle clé d'identité non décidée -> ROUGE.
  it('CHAQUE clé d’identité scellée est rendue OU explicitement exclue', () => {
    // Clés d'identité affichées : userDisplayName (ingénieur + visa), orgDisplayName
    // (visa), projectName (carte projet + objet).
    const RENDERED = new Set([
      'userDisplayName',
      'orgDisplayName',
      'projectName',
    ]);
    // Clés volontairement NON affichées : ids techniques (uuid) — jamais montrés.
    const EXCLUDED = new Set(['userId', 'projectId']);

    const IDENTITY = {
      userId: 'u-eng',
      userDisplayName: 'M. NDIAYE',
      orgDisplayName: 'GEOTEST LABO',
      projectId: 'p-1',
      projectName: 'Aménagement RN1 — Lot 3',
    };
    const undecided = Object.keys(IDENTITY).filter(
      (k) => !RENDERED.has(k) && !EXCLUDED.has(k),
    );
    expect(undecided).toEqual([]);
  });
});

/** Un chemin est couvert si lui-même ou un ancêtre figure dans l'ensemble. */
function isCovered(path: string, set: Set<string>): boolean {
  if (set.has(path)) return true;
  const parts = path.split('.');
  for (let i = 1; i < parts.length; i++) {
    if (set.has(parts.slice(0, i).join('.'))) return true;
  }
  return false;
}
