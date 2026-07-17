/**
 * Module PIEUX — fondations profondes (NF P 94-262, EC7) — point d'entree PUR &
 * client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computePieux) -> PROJECTION du
 * resultat brut `R` sur la sortie whitelistee (contract.ts) -> enveloppe de resultat
 * (meta + output). Aucun DOM, aucune horloge, aucun hasard : deterministe.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES
 * du contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de
 * bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#48) ---
 * Equivalence-PORTAGE prouvee (module == HTML d'origine, tolerance rel 1e-9).
 * JUSTESSE scientifique NON validee tant que le kit cas-tests STARFIRE n'est pas
 * disponible (PR-1/#36) : sortie tag @science-unsigned. MJ-6 : pas de mise en
 * production sans conformite.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  PIEUX_ENGINE_ID,
  PIEUX_DEFAULT_COEFFS,
  PieuxInputSchema,
  PieuxOutputSchema,
  pieuxContract,
  type PieuxInput,
  type PieuxOutput,
} from './contract.js';
import {
  computePieux,
  computeDowndrag,
  computeBeton,
  computePortanceCurve,
} from './engine.js';

export {
  PIEUX_ENGINE_ID,
  PIEUX_DEFAULT_COEFFS,
  PieuxInputSchema,
  PieuxOutputSchema,
  pieuxContract,
  type PieuxInput,
  type PieuxOutput,
};
export { PIEUX_CONFIDENTIAL_MARKER } from './engine.js';
// Jeux d'ENTREES canoniques (donnees pures, sans science ni sortie figee) :
// reutilises par l'equivalence-portage ET l'e2e API (meme entree des deux cotes).
export {
  PIEUX_FIXTURES,
  PIEUX_DOWNDRAG_FIXTURES,
  PIEUX_BETON_FIXTURES,
  type PieuxFixture,
} from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * SENTINEL fini pour un taux de travail NON FINI (Rd=0 : resistance nulle, charge non
 * reprise — ex. micropieu sans frottement couvert). Le moteur represente ce cas par
 * +Infinity (Fd/0) ; le contrat de sortie exige des nombres FINIS. On le remplace par
 * ce sentinel >> 1 (la verification est de toute facon `ok=false`). Valeur choisie
 * grande mais finie et stable pour rester deterministe et serialisable JSON.
 */
const TAUX_NON_REPRIS = 1e9;

/**
 * REDACTION FAIL-CLOSED des valeurs dans le TEXTE LIBRE d'un message
 * (`warnings`/`erreur`) — DoD §8, leçon MAJEUR-1 de #45, durcie au challenge #48
 * (MAJEUR-2 : passage d'une BLACKLIST fail-OPEN a une ALLOWLIST fail-CLOSED).
 *
 * --- Le probleme ---
 * La whitelist de sortie protege les CLES structurees (un champ `qb`/`ple`/`kfac`/
 * `fric` ne peut PAS etre expose). Mais un TEXTE LIBRE pourrait interpoler la VALEUR
 * d'un intermediaire confidentiel propre a la methode NF P 94-262.
 *
 * --- ETAT REEL DU MOTEUR (honnetete — DIFFERENT de pressiometre) ---
 * Contrairement au moteur pressiometre (ou `warn` etait STRUCTURELLEMENT VIDE), ce
 * moteur POSE bien un tableau `warn` dans son resultat `R`, et nous l'EXPOSONS via
 * `warnings`. La redaction est donc une barriere ACTIVE. J'ai LU dans engine.ts les
 * chaines EXACTES de TOUS les `warn.push(...)` ; etiquettes REELLEMENT EMISES suivies
 * d'un `= <nombre>` : `D = <n> m` (#1, profil), `h = <n> m` + `3·B = <n> m` (#2,
 * geometrie/litteral), `Cₑ = <n>` (#7, **intermediaire de groupe J.2, confidentiel**).
 * Les autres warnings n'interpolent pas de `=` (categorie, « ÷ 2 », « 0,15·Rₛ »).
 *
 * --- LA STRATEGIE : FAIL-CLOSED PAR ALLOWLIST (MAJEUR-2) ---
 * L'ancienne version listait des etiquettes CONFIDENTIELLES a redacter (blacklist).
 * C'etait fail-OPEN : un intermediaire NU non liste (ex. un futur `Xyz = 42 kN`)
 * aurait FUI. On inverse : on redacte TOUTE valeur `<token> = <nombre> [unite]` SAUF
 * si `<token>` est dans une ALLOWLIST BENIGNE explicite. Inconnu => masque (defaut sur).
 *
 * L'ALLOWLIST BENIGNE (cf. `BENIGN_VALUE_LABELS`) ne contient QUE :
 *   - les grandeurs DEJA EXPOSEES au PV (leur valeur figure dans la sortie
 *     whitelistee, la masquer dans un message n'aurait pas de sens) : RbK/RsK/RcK/
 *     RcD, fluages RcrK/RcrCar/RcrQp, charges FduELU/FdCar/FdQp, diametre B,
 *     profondeur de base D, taux/tassement ;
 *   - la GEOMETRIE/PROFONDEUR legitime non confidentielle : h (encastrement dans la
 *     couche), Hsol (epaisseur de profil), z0 (tete), z (cote) ;
 *   - les coefficients NORMATIFS LITTERAUX qui apparaissent sous forme `n·X` (ex.
 *     `3·B`, `0,15·Rₛ`) : l'etiquette a gauche du `=` est alors `B`/`Rₛ` precede d'un
 *     facteur litteral — couverts par B (expose) et Rₛ (symbole, pas une valeur
 *     calculee de methode). Voir le test « NE touche PAS ».
 *
 * --- CEINTURE + BRETELLES ---
 * On CONSERVE en complement la liste d'intermediaires de METHODE connus
 * (`KNOWN_CONFIDENTIAL_LABELS`) — purement redondante avec le fail-closed, mais elle
 * documente les cibles et sert de filet si l'allowlist devait un jour s'elargir par
 * erreur. La barriere PRIMAIRE reste l'allowlist fail-closed.
 *
 * --- HARMONISATION (suivi) ---
 * Les 3 autres moteurs (terzaghi/burmister/pressiometre) partagent encore l'ANCIEN
 * patron BLACKLIST. Les aligner sur ce fail-closed est un SUIVI a part (ne PAS les
 * toucher dans #48) — a tracer au backlog.
 */

/**
 * ALLOWLIST des etiquettes dont la valeur `= <nombre>` est BENIGNE (jamais redactee).
 * Tout le reste est redacte (fail-closed). Compare en INSENSIBLE A LA CASSE et
 * tolerant aux indices Unicode (Rₛ -> rs, σ'v -> ...) via normalisation.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Grandeurs de RESULTAT exposees au PV (deja dans la sortie whitelistee).
  'rbk',
  'rsk',
  'rck',
  'rcd',
  'rtd',
  'rcrk',
  'rcrcar',
  'rcrqp',
  'fduelu',
  'fdcar',
  'fdqp',
  'fd',
  'rd',
  'b',
  'd',
  'taux',
  'tassement',
  's', // tassement (mm)
  // Frottement negatif (#94) : resultats DESORMAIS EXPOSES au PV (Gsn/Nmax).
  'gsn',
  'nmax',
  // Geometrie / profondeurs legitimes (non confidentielles).
  'h',
  'hsol',
  'z0',
  'z',
  // NB : on N'ALLOWLISTE PAS les formes NUES rb/rc/rs. Ce sont precisement les
  // resistances BRUTES confidentielles (terme de pointe Rb, total Rc, frottement Rs ;
  // FUITES_INTERDITES) ; seules leurs formes EXPOSEES suffixees (RbK/RsK/RcK/RcD/Rcr*)
  // sont benignes et figurent ci-dessus. Le coefficient normatif litteral « 0,15·Rₛ »
  // n'a PAS de `= <nombre>` accole : la regex `valued` ne le matche jamais, il est
  // donc preserve naturellement sans entree d'allowlist (cf. revue #48, MAJEUR-2).
]);

/**
 * CEINTURE + BRETELLES : intermediaires de METHODE connus (redondant avec le
 * fail-closed ci-dessus, conserve a titre documentaire/filet). NE constitue PAS la
 * barriere primaire.
 */
const KNOWN_CONFIDENTIAL_LABELS: readonly string[] = [
  'Cₑ',
  'Ce',
  'qb',
  'ple',
  'p*le',
  'qce',
  'kp',
  'kc',
  'kfac',
  'kmax',
  'Def',
  'qs',
  'qsm',
  'alpha',
  'α',
];

// Reference inerte : conserve la liste documentaire (ceinture+bretelles) sans
// declencher no-unused-vars. La barriere primaire est l'allowlist fail-closed.
void KNOWN_CONFIDENTIAL_LABELS;

/**
 * Normalise une etiquette pour comparaison a l'allowlist : minuscules + retrait des
 * indices/exposants/apostrophes/separateurs courants (Rₛ -> rs, σ'v -> v...). On
 * garde uniquement les lettres ASCII et chiffres ; les indices Unicode sont mappes
 * sur leur lettre de base usuelle.
 */
function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ₐ|ₑ|ₒ|ₓ|ₔ|ₕ|ₖ|ₗ|ₘ|ₙ|ₚ|ₛ|ₜ/g, (m) => {
      const map: Record<string, string> = {
        ['ₐ']: 'a',
        ['ₑ']: 'e',
        ['ₒ']: 'o',
        ['ₓ']: 'x',
        ['ₕ']: 'h',
        ['ₖ']: 'k',
        ['ₗ']: 'l',
        ['ₘ']: 'm',
        ['ₙ']: 'n',
        ['ₚ']: 'p',
        ['ₛ']: 's',
        ['ₜ']: 't',
      };
      return map[m] ?? '';
    })
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Redacte FAIL-CLOSED toute valeur `<token> = <nombre> [unite]` dont le `<token>`
 * (dernier symbole avant le `=`) n'est PAS dans l'ALLOWLIST benigne. Remplace par
 * `<token> (valeur confidentielle masquee)`. Inconnu => masque. Tolere les espaces
 * fins insecables FR (U+202F) de toLocaleString. Les nombres NON precedes d'une
 * etiquette `=` (profondeur « (20 m) », « catégorie 17 », « ÷ 2 ») sont intacts.
 */
export function redactConfidentialWarning(text: string): string {
  // Capture : (1) le TOKEN-etiquette = derniere "unite lexicale" avant le `=`
  // (lettres/chiffres/indices Unicode/apostrophe/virgule, ex. `Cₑ`, `kp,max`, `RsK`,
  // `Rₛ`, `Def/B`), puis `=`, puis (2) un nombre eventuellement suivi d'une unite.
  const valued =
    /([A-Za-z0-9ₐ-ₜ'’,/*_]+)\s*=\s*(-?[0-9][0-9.,\u202f\s]*(?:MPa|kPa|kN|MN|bar|cm³|cm3|cm|mm|m)?)/g;
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    // Fail-closed : si l'etiquette normalisee est dans l'allowlist benigne, on garde
    // la valeur ; SINON (inconnue OU intermediaire connu) on masque.
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) {
      return whole;
    }
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les warnings (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

/**
 * Re-FORME le resultat brut `R` du moteur en la SORTIE whitelistee. On CONSTRUIT un
 * objet propre champ a champ (jamais de copie brute) : seuls les champs de RESULTAT
 * destines au PV sont repris. Tout intermediaire (qb/ple/qce/kfac/kmax/Def/debR,
 * detail de frottement `fric`, chaine `qbDetail`, courbe `settle.pts`, facteurs
 * xi3/xi4/grd, facteurs partiels par combinaison `Rbf/Rsf/comb`...) est ECARTE ici,
 * puis re-strippe par projectEngineOutput (defense en profondeur).
 */
/**
 * Warning STATIQUE (aucun nombre interpole) rappelant le statut du frottement negatif
 * calcule (#94). FIDELITE : le HTML AFFICHE que Gsn est « une action permanente a
 * ajouter a la charge en tete pour les verifications (ch. 11 du guide) » mais son
 * compute() ne l'ajoute PAS au Fd. On reproduit ce DECOUPLAGE (Gsn expose, verdict
 * ELU/ELS INCHANGE) ; coupler Gsn dans Fd serait ajouter de la science absente du
 * source (avenant STARFIRE + expert-genie-civil). Aucune interpolation => passe la
 * redaction fail-closed trivialement (§8).
 */
const DOWNDRAG_STATIC_WARNING =
  'Frottement négatif Gsn calculé : action permanente à ajouter à la charge en tête ' +
  'pour les vérifications (ch. 11 du guide) — non couplé automatiquement au verdict.';

/**
 * Projette le resultat BRUT du downdrag sur les 3 champs client-safe (Gsn/Nmax/
 * pointNeutre), champ a champ (jamais de copie brute). `prof`, les qsN par segment,
 * les rigidites t-z et wHead/wTip restent SERVEUR (DoD §8). null si downdrag non
 * demande ou garde du moteur (err).
 */
function downdragFields(dd: Record<string, unknown> | null): {
  Gsn: number | null;
  Nmax: number | null;
  pointNeutre: number | null;
} {
  if (!dd || typeof dd.err === 'string') {
    return { Gsn: null, Nmax: null, pointNeutre: null };
  }
  return {
    Gsn: fin(dd.Gsn) ? dd.Gsn : null,
    Nmax: fin(dd.Nmax) ? dd.Nmax : null,
    // zN peut valoir null (mode auto sans point neutre trouve) -> pointNeutre null.
    pointNeutre: fin(dd.zN) ? dd.zN : null,
  };
}

/**
 * Projette le resultat BRUT de la verification structurale du beton (§4.4, #95) sur
 * les seuls champs client-safe (applicable + verdict ELU/ELS + taux + f_cd), champ a
 * champ (jamais de copie brute). Les FACTEURS DE CALAGE de la methode (Cmax/k1/k2/
 * fckStar/acc/k3/gc, et les contraintes NUES sELU/sELS/limELS) restent SERVEUR (DoD
 * §8). null partout si la verification n'a pas ete demandee ou si la portance a
 * rejete l'entree (err). Cas `na` (traction / categorie non couverte) : applicable
 * = false, verdicts/taux/fcd = null (aucun calcul de section n'a eu lieu).
 *
 * NB CONFIDENTIALITE : f_cd est la resistance de CALCUL du beton au sens EC2 — une
 * grandeur de dimensionnement PUBLIQUE (elle figure sur toute note de calcul). Elle
 * est de toute facon deductible du couple (tauxELU, FduELU, Ab) deja expose
 * (σ_ELU = FduELU/Ab/1000 ; f_cd = σ_ELU/tauxELU). L'exposer n'ajoute donc pas de
 * surface de fuite au-dela de l'existant. NUANCE D'HONNETETE (revue qa-challenger) :
 * la non-inversibilite n'est PAS totale — acc (arme/non), k3, gc=1,5 et fck sont
 * connus/normatifs cote client ; dans la branche ou acc·k3·fckStar/gc gouverne le
 * min, il peut isoler fckStar puis k1·k2 = min(Cmax,fck)/fckStar (k2 calculable via
 * B/D publics). Mais ces valeurs sont celles du Tableau 12 NF P 94-262 (norme
 * PUBLIEE, faible entropie) : la fuite pratique est negligeable, pas nulle.
 */
function betonFields(bt: Record<string, unknown> | null): {
  betonApplicable: boolean | null;
  betonOkELU: boolean | null;
  betonOkELS: boolean | null;
  betonTauxELU: number | null;
  betonTauxELS: number | null;
  betonFcd: number | null;
} {
  const NULLS = {
    betonApplicable: null,
    betonOkELU: null,
    betonOkELS: null,
    betonTauxELU: null,
    betonTauxELS: null,
    betonFcd: null,
  };
  if (!bt || typeof bt.err === 'string') return NULLS;
  if (bt.na === true) {
    // Verification NON APPLICABLE (traction / categorie non couverte) : on signale
    // l'inapplicabilite, sans aucun verdict ni valeur (betonCheck n'a rien calcule).
    // Le `reason` (texte explicatif benin) n'est PAS structure ici : le front derive
    // le message du drapeau `betonApplicable=false` (aucune valeur de methode a exposer).
    return { ...NULLS, betonApplicable: false };
  }
  return {
    betonApplicable: true,
    betonOkELU: typeof bt.okELU === 'boolean' ? bt.okELU : null,
    betonOkELS: typeof bt.okELS === 'boolean' ? bt.okELS : null,
    betonTauxELU: fin(bt.tauxELU) ? bt.tauxELU : null,
    betonTauxELS: fin(bt.tauxELS) ? bt.tauxELS : null,
    betonFcd: fin(bt.fcd) ? bt.fcd : null,
  };
}

/**
 * NOMBRE DE POINTS d'affichage des courbes re-echantillonnees (display-only). FIXE et
 * DECOUPLE de la resolution interne (balayage de portance ~110 pts, discretisation t-z
 * 61 pts, marche de frottement negatif variable). Meme intention que la grille FIXE
 * 48×48 des cartes radier/geoplaque : on montre le RESULTAT (la forme de la courbe),
 * pas la METHODE (le pas/segmentation interne). 48 points suffisent a un rendu lisse.
 */
const CURVE_SAMPLES = 48;

/**
 * RE-ECHANTILLONNE une serie de points (triee par `xKey` croissant, comme l'engine les
 * produit) sur une grille UNIFORME de `n` points de l'abscisse, par interpolation
 * LINEAIRE de chaque champ. Fail-closed : si < 2 points, si le domaine est degenere, ou
 * si une valeur utilisee n'est pas finie, on renvoie null (aucune courbe affichee) plutot
 * que de risquer un NaN. Decouple la grille d'affichage de la resolution interne.
 */
function resampleSeries(
  pts: unknown,
  xKey: string,
  valueKeys: readonly string[],
  n: number,
): Array<Record<string, number>> | null {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const rows = pts as Array<Record<string, unknown>>;
  const xAt = (i: number): number =>
    fin(rows[i]![xKey]) ? (rows[i]![xKey] as number) : NaN;
  const x0 = xAt(0),
    x1 = xAt(rows.length - 1);
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !(x1 > x0)) return null;
  // Verifie que TOUTES les valeurs interpolees sont finies (sinon fail-closed).
  for (const r of rows) {
    if (!fin(r[xKey])) return null;
    for (const k of valueKeys) if (!fin(r[k])) return null;
  }
  const out: Array<Record<string, number>> = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    while (j < rows.length - 2 && (rows[j + 1]![xKey] as number) < x) j++;
    const A = rows[j]!,
      Bp = rows[j + 1]!;
    const dx = (Bp[xKey] as number) - (A[xKey] as number);
    const t = dx > 0 ? (x - (A[xKey] as number)) / dx : 0;
    const row: Record<string, number> = { [xKey]: x };
    for (const k of valueKeys) {
      row[k] = (A[k] as number) + ((Bp[k] as number) - (A[k] as number)) * t;
    }
    out.push(row);
  }
  return out;
}

/**
 * Projette les SCALAIRES d'affichage (display-only, RECLASSIFICATION §8) depuis le
 * resultat brut `R`. Aucune autorite : ce sont des sorties, jamais reinjectees. null
 * quand la grandeur n'a pas de sens pour le jeu (ex. p*le hors methode pressiometrique,
 * kmax hors des methodes a facteur de portance tabule).
 */
function displayScalars(R: Record<string, unknown>): {
  Rb: number | null;
  Rs: number | null;
  ple: number | null;
  qce: number | null;
  kfac: number | null;
  kmax: number | null;
  Def: number | null;
  debR: number | null;
  xi3: number | null;
  xi4: number | null;
  gammaRd1: number | null;
  Ce: number | null;
  fric: Array<{
    soil: string;
    top: number;
    bot: number;
    dz: number;
    qs: number;
    dRs: number;
    qsm: number | null;
    deg: boolean;
  }> | null;
} {
  const meth = typeof R.meth === 'string' ? R.meth : '';
  const fricRaw = Array.isArray(R.fric)
    ? (R.fric as Array<Record<string, unknown>>)
    : null;
  const fric =
    fricRaw && fricRaw.length
      ? fricRaw.map((f) => ({
          soil: typeof f.soil === 'string' ? f.soil : '',
          top: fin(f.top) ? f.top : 0,
          bot: fin(f.bot) ? f.bot : 0,
          dz: fin(f.dz) ? f.dz : 0,
          qs: fin(f.qs) ? f.qs : 0,
          dRs: fin(f.dRs) ? f.dRs : 0,
          qsm: fin(f.qsm) ? f.qsm : null,
          deg: f.deg === true,
        }))
      : null;
  return {
    Rb: fin(R.Rb) ? R.Rb : null,
    Rs: fin(R.Rs) ? R.Rs : null,
    // p*le : methode pressiometrique uniquement ; qce : penetrometrique uniquement.
    ple: meth === 'pmt' && fin(R.ple) ? R.ple : null,
    qce: meth === 'cpt' && fin(R.qce) ? R.qce : null,
    kfac: fin(R.kfac) ? R.kfac : null,
    // kmax (kp,max/kc,max) : pas de plafond tabule en c-φ (Nq), donc null.
    kmax: meth !== 'cphi' && fin(R.kmax) && (R.kmax as number) > 0 ? R.kmax : null,
    Def: fin(R.Def) ? R.Def : null,
    debR: fin(R.debR) ? R.debR : null,
    xi3: fin(R.xi3) ? R.xi3 : null,
    xi4: fin(R.xi4) ? R.xi4 : null,
    gammaRd1: fin(R.grd) ? R.grd : null,
    Ce: fin(R.Ce) ? R.Ce : null,
    fric,
  };
}

/** Bloc de champs d'affichage tous NULS (branche erreur / non calculable). */
const DISPLAY_NULLS = {
  Rb: null,
  Rs: null,
  ple: null,
  qce: null,
  kfac: null,
  kmax: null,
  Def: null,
  debR: null,
  xi3: null,
  xi4: null,
  gammaRd1: null,
  Ce: null,
  fric: null,
  courbePortance: null,
  courbeTassement: null,
  profilsDowndrag: null,
} as const;

/** courbeTassement (charge-tassement) re-echantillonnee depuis R.settle. null si absente. */
function courbeTassementField(
  R: Record<string, unknown>,
): { pts: Array<{ F: number; s: number }>; Fmax: number } | null {
  const settle = (R.settle ?? null) as Record<string, unknown> | null;
  if (!settle) return null;
  const sampled = resampleSeries(settle.pts, 'F', ['s'], CURVE_SAMPLES);
  if (!sampled) return null;
  const pts = sampled as Array<{ F: number; s: number }>;
  const Fmax = fin(settle.Fmax) ? (settle.Fmax as number) : pts[pts.length - 1]!.F;
  if (!Number.isFinite(Fmax)) return null;
  return { pts, Fmax };
}

/** profilsDowndrag re-echantillonnes depuis le resultat brut downdrag. null si absent. */
function profilsDowndragField(dd: Record<string, unknown> | null): {
  wHead: number;
  prof: Array<{
    z: number;
    w: number;
    g: number;
    f: number;
    qsP: number;
    qsN: number;
    N: number;
  }>;
} | null {
  if (!dd || typeof dd.err === 'string') return null;
  const prof = resampleSeries(
    dd.prof,
    'z',
    ['w', 'g', 'f', 'qsP', 'qsN', 'N'],
    CURVE_SAMPLES,
  );
  if (!prof) return null;
  if (!fin(dd.wHead)) return null;
  return {
    wHead: dd.wHead as number,
    prof: prof as Array<{
      z: number;
      w: number;
      g: number;
      f: number;
      qsP: number;
      qsN: number;
      N: number;
    }>,
  };
}

/** courbePortance re-echantillonnee depuis le balayage brut. null si non traçable. */
function courbePortanceField(
  portanceRaw: Record<string, unknown> | null,
): {
  rows: Array<{
    D: number;
    elufond: number;
    eluacc: number;
    elscar: number;
    elsqp: number;
  }>;
} | null {
  if (!portanceRaw) return null;
  const rows = resampleSeries(
    portanceRaw.rows,
    'D',
    ['elufond', 'eluacc', 'elscar', 'elsqp'],
    CURVE_SAMPLES,
  );
  if (!rows) return null;
  return {
    rows: rows as Array<{
      D: number;
      elufond: number;
      eluacc: number;
      elscar: number;
      elsqp: number;
    }>,
  };
}

function shapeOutput(
  R: Record<string, unknown>,
  downdrag: Record<string, unknown> | null,
  beton: Record<string, unknown> | null,
  portanceRaw: Record<string, unknown> | null,
): unknown {
  const dd = downdragFields(downdrag);
  const bt = betonFields(beton);
  const ddComputed = downdrag != null && typeof downdrag.err !== 'string';
  // Cas d'erreur de calcul / garde du moteur : on n'expose que le message redacte.
  if (typeof R.err === 'string') {
    return {
      erreur: redactConfidentialWarning(R.err),
      warnings: [],
      B: 0,
      D: 0,
      categorie: 0,
      methode: '',
      sens: '',
      RbK: 0,
      RsK: 0,
      RcK: 0,
      RcD: 0,
      RcrK: 0,
      RcrCar: 0,
      RcrQp: 0,
      FduELU: 0,
      FdCar: 0,
      FdQp: 0,
      verifications: [],
      allOk: false,
      tauxGouvernant: 0,
      tassementELS: null,
      ...DISPLAY_NULLS,
      Gsn: dd.Gsn,
      Nmax: dd.Nmax,
      pointNeutre: dd.pointNeutre,
      ...bt,
    };
  }

  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );
  // Frottement negatif calcule : rappel STATIQUE du decouplage au verdict (fidelite,
  // #94). Texte sans nombre => sur pour la redaction ; ajoute apres les warnings moteur.
  if (ddComputed) warnings.push(DOWNDRAG_STATIC_WARNING);

  // --- VERIFICATIONS : SOURCE DE VERITE UNIQUE (MINEUR-3 #48) ---
  // Le moteur calcule son verdict GLOBAL par `govern = max(Fd/Rd)` et
  // `allOk = every(Fd<=Rd)` (engine.ts), MAIS ne stocke PAS de taux/ok PAR check.
  // Pour ne pas creer une double verite, on DERIVE le taux par check avec EXACTEMENT
  // la formule du moteur (`Fd/Rd`, qui vaut +Infinity si Rd=0) et `ok = Fd<=Rd`, puis
  // on RECONSTRUIT `tauxGouvernant`/`allOk` A PARTIR de ces memes valeurs. Un test
  // (contract.test.ts) prouve que ces valeurs derivees EGALENT le verdict du moteur
  // (`R.govern`/`R.allOk`) sur tout le jeu de fixtures : pas de divergence non testee.
  // On ne reprend QUE nom + Fd/Rd + taux + verdict ; on ECARTE `comb`/`Rbf`/`Rsf`/`crit`.
  const checksRaw = Array.isArray(R.checks)
    ? (R.checks as Record<string, unknown>[])
    : [];
  const rawChecks = checksRaw.map((c) => {
    const Fd = fin(c.Fd) ? c.Fd : 0;
    const Rd = fin(c.Rd) ? c.Rd : 0;
    return {
      nom: typeof c.nom === 'string' ? c.nom : '',
      Fd,
      Rd,
      rawTaux: Fd / Rd, // formule MOTEUR (Infinity si Rd=0) — base du verdict
      ok: Fd <= Rd, // identique au terme de `allOk` du moteur
    };
  });
  // Verdict DERIVE des memes rawTaux/ok (jamais une 2e formule).
  const derivedGovern = rawChecks.reduce((a, c) => Math.max(a, c.rawTaux), 0);
  const derivedAllOk = rawChecks.every((c) => c.ok);
  // Pour la SORTIE (schema .finite()), on convertit un taux non-fini (Rd=0, charge
  // non reprise) en un SENTINEL fini explicite : la verification est de toute facon
  // `ok=false`. On applique la MEME conversion au taux gouvernant (coherence).
  const finiteTaux = (t: number): number => (Number.isFinite(t) ? t : TAUX_NON_REPRIS);
  const verifications = rawChecks.map((c) => ({
    nom: c.nom,
    Fd: c.Fd,
    Rd: c.Rd,
    taux: finiteTaux(c.rawTaux),
    ok: c.ok,
  }));

  const settle = (R.settle ?? null) as Record<string, unknown> | null;
  const tassementELS = settle && fin(settle.sEls) ? (settle.sEls as number) : null;

  return {
    erreur: null,
    warnings,
    B: fin(R.B) ? R.B : 0,
    D: fin(R.D) ? R.D : 0,
    categorie: fin(R.cat) ? R.cat : 0,
    methode: typeof R.meth === 'string' ? R.meth : '',
    sens: typeof R.sens === 'string' ? R.sens : '',
    RbK: fin(R.RbK) ? R.RbK : 0,
    RsK: fin(R.RsK) ? R.RsK : 0,
    RcK: fin(R.RcK) ? R.RcK : 0,
    RcD: fin(R.RcD) ? R.RcD : 0,
    RcrK: fin(R.RcrK) ? R.RcrK : 0,
    RcrCar: fin(R.RcrCar) ? R.RcrCar : 0,
    RcrQp: fin(R.RcrQp) ? R.RcrQp : 0,
    FduELU: fin(R.FduELU) ? R.FduELU : 0,
    FdCar: fin(R.FdCar) ? R.FdCar : 0,
    FdQp: fin(R.FdQp) ? R.FdQp : 0,
    verifications,
    // DERIVE des per-check (source unique) — un test prouve l'egalite avec R.allOk/R.govern.
    allOk: derivedAllOk,
    tauxGouvernant: finiteTaux(derivedGovern),
    tassementELS,
    // --- AFFICHAGE DETAILLE (display-only, §8) : scalaires + tableau frottement + courbes ---
    ...displayScalars(R),
    courbePortance: courbePortanceField(portanceRaw),
    courbeTassement: courbeTassementField(R),
    profilsDowndrag: profilsDowndragField(downdrag),
    Gsn: dd.Gsn,
    Nmax: dd.Nmax,
    pointNeutre: dd.pointNeutre,
    ...bt,
  };
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof PIEUX_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(PIEUX_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${PIEUX_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: PIEUX_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul pieux client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 * @returns enveloppe de succes (le moteur encode lui-meme une eventuelle erreur de
 *   garde dans `output.erreur` ; une exception inattendue remonte a l'appelant qui
 *   la mappe en SafeEngineError).
 */
export function runPieux(rawInput: unknown): EngineResultEnvelope<PieuxOutput> {
  // SECURITE (audit adverse) : les coefficients partiels de securite EC7 sont
  // AUTORITATIFS SERVEUR. Le REJET du non-normatif est desormais porte par le SCHEMA
  // (PieuxInputSchema : coeffs.refine == PIEUX_DEFAULT_COEFFS -> 400), ce qui garantit
  // aussi que l'input scelle == l'input qui a calcule. Ici on parse simplement : coeffs
  // ne peut deja etre que normatif. (Avant : override silencieux dans runPieux, qui
  // laissait fuiter des coeffs client non normatifs dans l'input scelle.)
  const input: PieuxInput = PieuxInputSchema.parse(rawInput);
  const rawResult = computePieux(input) as Record<string, unknown>;
  // Frottement negatif : calcul SEPARE (comme l'onglet dedie du HTML), uniquement si
  // le groupe est fourni. Decouple du verdict ELU/ELS (fidelite, #94).
  const downdrag = input.frottementNegatif
    ? (computeDowndrag(input) as Record<string, unknown>)
    : null;
  // Verification structurale du beton : calcul SEPARE (comme betonCheck dans compute()),
  // uniquement si le groupe `beton` est fourni. Facteurs de calage confidentiels ecartes.
  const beton = input.beton ? (computeBeton(input) as Record<string, unknown>) : null;
  // Courbe de portance en profondeur (display-only) : balayage SEPARE (comme drawPortance
  // du HTML), re-echantillonne en aval. Pur/garde : null si non traçable.
  const portanceRaw = computePortanceCurve(input) as Record<string, unknown> | null;
  const shaped = shapeOutput(rawResult, downdrag, beton, portanceRaw);
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(PieuxOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void pieuxContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
