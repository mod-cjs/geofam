/**
 * Module RADIER / PLAQUE sur sol multicouche elastique (EF) — point d'entree PUR &
 * client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeRadier) -> PROJECTION du
 * resultat brut `R` sur la sortie whitelistee (contract.ts : DIAGNOSTICS uniquement)
 * -> enveloppe de resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES
 * du contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de
 * bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#54) ---
 * Equivalence-PORTAGE prouvee (module == HTML d'origine). JUSTESSE scientifique NON
 * validee tant que le kit cas-tests STARFIRE n'est pas disponible (PR-1/#36) : sortie
 * tag @science-unsigned. MJ-6 : pas de mise en production sans conformite.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  RADIER_ENGINE_ID,
  RadierInputSchema,
  RadierOutputSchema,
  radierContract,
  type RadierInput,
  type RadierOutput,
} from './contract.js';
import { computeRadier } from './engine.js';

export {
  RADIER_ENGINE_ID,
  RadierInputSchema,
  RadierOutputSchema,
  radierContract,
  type RadierInput,
  type RadierOutput,
};
export { RADIER_CONFIDENTIAL_MARKER } from './engine.js';
// Jeux d'ENTREES canoniques (donnees pures, sans science ni sortie figee) :
// reutilises par l'equivalence-portage ET l'e2e API (meme entree des deux cotes).
export { RADIER_FIXTURES, type RadierFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * REDACTION FAIL-CLOSED des valeurs dans le TEXTE LIBRE d'un message
 * (`warnings`/`erreur`) — DoD §8, patron durci de #48 (allowlist fail-closed
 * d'emblee, jamais une blacklist).
 *
 * --- Le probleme ---
 * La whitelist de sortie protege les CLES structurees (un champ nodal `w`/`Mx`/`kr`,
 * la topologie `blocks`, ne peut pas etre expose). Mais un TEXTE LIBRE pourrait
 * interpoler la VALEUR d'un intermediaire EF confidentiel.
 *
 * --- ETAT REEL DU MOTEUR (honnetete) ---
 * Le moteur radier NE POSE AUCUN champ `warn` dans son resultat `R` : ses messages
 * sont des `console.warn` d'auto-verification ACM (residu de modes rigides) et des
 * `toast('Calcul impossible : '+e.message)` cote UI — aucun n'atteint le resultat
 * structure. `warnings` ressort donc STRUCTURELLEMENT VIDE (`[]`) en fonctionnement
 * normal ; seul `erreur` (message de garde, ex. « Aucune plaque a calculer ») peut
 * etre non vide, et il ne contient pas d'intermediaire. La redaction est donc une
 * defense en profondeur fail-closed pour une evolution future, pas le correctif d'une
 * fuite averee.
 *
 * --- LA STRATEGIE : FAIL-CLOSED PAR ALLOWLIST (patron #48) ---
 * On masque TOUTE valeur `<token> = <nombre> [unite]` SAUF si `<token>` (dernier
 * symbole avant le `=`) est dans une ALLOWLIST BENIGNE explicite. Inconnu => masque.
 * L'allowlist ne contient QUE les grandeurs DEJA EXPOSEES au PV (diagnostics) + des
 * libelles geometriques/normatifs legitimes :
 *   - diagnostics exposes : wmax/wmin/diff/slopemax/tiltmax/betaintra/betainter/
 *     interdiff/betagov/beta/ds + nrafts ;
 *   - geometrie/identite legitime : x/y/L (longueur), e (epaisseur), nu, mesh, D, z ;
 *   - module/contrainte cites en libelle : e (module E ou epaisseur), sigv0, qlim,
 *     plimwink, kwink (formes normalisees minuscules).
 * Les INTERMEDIAIRES EF (champs nodaux, residu ACM, kr local...) ne sont PAS dans
 * l'allowlist -> masques par defaut. Normalisation casse + indices Unicode.
 *
 * --- HARMONISATION (suivi) ---
 * Les moteurs anterieurs (terzaghi/burmister/pressiometre) utilisent encore l'ancien
 * patron blacklist ; pieux (#48) et radier (#54) sont fail-closed. Aligner les trois
 * premiers est un SUIVI separe (ne pas les toucher ici).
 */

/**
 * ALLOWLIST des etiquettes dont la valeur `= <nombre>` est BENIGNE (jamais redactee).
 * Tout le reste est redacte (fail-closed). Comparaison insensible a la casse, indices
 * Unicode normalises.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Diagnostics exposes au PV (deja dans la sortie whitelistee).
  'wmax',
  'wmin',
  'diff',
  'slopemax',
  'tiltmax',
  'betaintra',
  'betainter',
  'interdiff',
  'betagov',
  'beta',
  'ds',
  'nrafts',
  // Geometrie / identite legitime (saisie utilisateur, non confidentielle).
  'x',
  'y',
  'l',
  'e',
  'nu',
  'mesh',
  'd',
  'z',
  'zbase',
  // Module / contraintes cites en libelle (entrees, pas des intermediaires calcules).
  // NB : `normalizeLabel` force le minuscule -> on liste les formes EN MINUSCULES.
  // (le module E est deja couvert par 'e' ci-dessus, commun avec l'epaisseur.)
  'sigv0',
  'qlim',
  'plimwink',
  'kwink',
  'krec',
  'foundd',
]);

/**
 * Normalise une etiquette pour comparaison a l'allowlist : minuscules + retrait des
 * indices/exposants/apostrophes/separateurs (σ'v -> v, indices Unicode -> lettre de
 * base). Garde uniquement lettres ASCII + chiffres.
 */
function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ₐ|ₑ|ₒ|ₓ|ₕ|ₖ|ₗ|ₘ|ₙ|ₚ|ₛ|ₜ/g, (m) => {
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
 * fins insecables FR ( ) de toLocaleString.
 */
export function redactConfidentialWarning(text: string): string {
  // Token-etiquette (groupe 1) + forme indexee w[12] ; nombre (groupe 2) tolerant
  // aux exposants et a l espace fin insecable FR. Regex CONSTRUITE via escapes :
  // aucun whitespace irregulier en clair (ESLint no-irregular-whitespace).
  const TOKEN = "([A-Za-z0-9\\u2090-\\u209c'\\u2019,/*_\\[\\]]+)";
  const valued = new RegExp(
    TOKEN + '\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|rad)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
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

/** Localisation (x,y) exposable, ou null. Construit champ a champ (jamais de copie brute). */
function loc(o: unknown): { x: number; y: number } | null {
  if (o === null || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (fin(r.x) && fin(r.y)) return { x: r.x, y: r.y };
  return null;
}

/**
 * Re-FORME le resultat brut `R` du moteur en la SORTIE whitelistee : VALEURS de
 * DIAGNOSTIC uniquement. On CONSTRUIT un objet propre champ a champ (jamais de copie
 * brute) : tous les champs NODAUX (w/p/Mx/My/Mxy/tx/ty/slope/kr/active), la TOPOLOGIE
 * (nodeX/nodeY/blocks/N), les sommes de ressorts, ET TOUTES LES LOCALISATIONS `*At`
 * (wMaxAt/wMinAt/slopeMaxAt/tiltAt/betaGovAt — coordonnees de NŒUDS de maillage ou
 * centroides derives du maillage : la METHODE EF, cf. MAJEUR-1 #54) sont ECARTES ici,
 * puis re-strippes par projectEngineOutput (defense en profondeur). On n'expose QUE
 * les VALEURS scalaires + worstLoadPair (coords de charges SAISIES, verifiees verbatim).
 */
/**
 * HEATMAP D'AFFICHAGE — re-echantillonne le champ nodal `w` sur une grille FIXE
 * (~48×48) DECOUPLEE du maillage EF (ponderation inverse-distance lissee) + masque
 * hors radier. On lit `R.nodeX/nodeY/w` en interne mais on N'EXPOSE QUE la grille
 * d'affichage (vals) : jamais les valeurs nodales, les indices, ni la topologie du
 * maillage. Le RESULTAT (motif de deflexion), pas la METHODE. Cf. §8 / STARFIRE.
 */
function buildHeatmap(R: Record<string, unknown>): unknown {
  const nodeX = R.nodeX,
    nodeY = R.nodeY,
    wv = R.w;
  if (!Array.isArray(nodeX) || !Array.isArray(nodeY) || !Array.isArray(wv)) return undefined;
  const xs = nodeX as number[],
    ys = nodeY as number[],
    ws = wv as number[];
  const N = Math.min(xs.length, ys.length, ws.length);
  if (N < 3) return undefined;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const xi = xs[i],
      yi = ys[i];
    if (xi === undefined || yi === undefined || !fin(xi) || !fin(yi)) continue;
    if (xi < x0) x0 = xi;
    if (xi > x1) x1 = xi;
    if (yi < y0) y0 = yi;
    if (yi > y1) y1 = yi;
  }
  if (!fin(x0) || x1 <= x0 || y1 <= y0) return undefined;
  const G = 48; // resolution d'affichage FIXE, DECOUPLEE du maillage
  const cw = (x1 - x0) / (G - 1),
    ch = (y1 - y0) / (G - 1);
  const eps2 = Math.pow(Math.max(cw, ch) * 0.9, 2); // lissage ~ cellule d'affichage
  const maxD2 = Math.pow(Math.max(cw, ch) * 1.6, 2); // masque hors radier
  const vals: (number | null)[] = new Array(G * G).fill(null);
  let vMin = Infinity,
    vMax = -Infinity;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const px = x0 + gx * cw,
        py = y0 + gy * ch;
      let sw = 0,
        swv = 0,
        nd = Infinity;
      for (let i = 0; i < N; i++) {
        const xi = xs[i],
          yi = ys[i],
          wi = ws[i];
        if (xi === undefined || yi === undefined) continue;
        const d2 = (px - xi) ** 2 + (py - yi) ** 2;
        if (d2 < nd) nd = d2;
        const wgt = 1 / (d2 + eps2);
        sw += wgt;
        swv += wgt * (wi !== undefined && fin(wi) ? wi : 0);
      }
      if (nd > maxD2 || sw === 0) continue; // hors radier -> null
      const val = swv / sw;
      vals[gy * G + gx] = val;
      if (val < vMin) vMin = val;
      if (val > vMax) vMax = val;
    }
  }
  if (!fin(vMin) || !fin(vMax)) return undefined;
  return { x0, y0, x1, y1, cols: G, rows: G, vals, vMin, vMax };
}

function shapeOutput(R: Record<string, unknown>): unknown {
  const empty = {
    wMax: 0,
    wMin: 0,
    diff: 0,
    slopeMax: 0,
    tiltMax: 0,
    betaIntra: 0,
    betaInter: 0,
    interDiff: 0,
    betaGov: 0,
    nRafts: 0,
    worstLoadPair: null,
  };

  // Cas d'erreur de calcul / garde du moteur : on n'expose que le message redacte.
  if (typeof R.err === 'string') {
    return { erreur: redactConfidentialWarning(R.err), warnings: [], ...empty };
  }

  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );

  const diag = (R.diag ?? null) as Record<string, unknown> | null;
  if (!diag) {
    return { erreur: null, warnings, ...empty };
  }

  // Pire distorsion entre charges (loadPairs.worst). VERIFIE (cf. contract.ts) : p1/p2
  // = coordonnees de charges SAISIES (echo verbatim de l'entree, PAS snappees sur un
  // nœud) -> exposables. On ne reprend QUE les champs d'ingenierie de l'arete.
  const lp = (diag.loadPairs ?? null) as Record<string, unknown> | null;
  const worst = (lp?.worst ?? null) as Record<string, unknown> | null;
  const worstLoadPair = worst
    ? {
        beta: fin(worst.beta) ? worst.beta : 0,
        ds: fin(worst.ds) ? worst.ds : 0,
        L: fin(worst.L) ? worst.L : 0,
        ki: fin(worst.ki) ? worst.ki : 0,
        kj: fin(worst.kj) ? worst.kj : 0,
        p1: loc(worst.p1),
        p2: loc(worst.p2),
      }
    : null;

  // NB : on NE lit MEME PAS diag.wMaxAt / diag.tiltAt / diag.betaGovAt : ces
  // localisations derivees du maillage ne franchissent jamais la projection.
  const hm = buildHeatmap(R);
  return {
    erreur: null,
    warnings,
    wMax: fin(diag.wMax) ? diag.wMax : 0,
    wMin: fin(diag.wMin) ? diag.wMin : 0,
    diff: fin(diag.diff) ? diag.diff : 0,
    slopeMax: fin(diag.slopeMax) ? diag.slopeMax : 0,
    tiltMax: fin(diag.tiltMax) ? diag.tiltMax : 0,
    betaIntra: fin(diag.betaIntra) ? diag.betaIntra : 0,
    betaInter: fin(diag.interBeta) ? diag.interBeta : 0,
    interDiff: fin(diag.interDiff) ? diag.interDiff : 0,
    betaGov: fin(diag.betaGov) ? diag.betaGov : 0,
    nRafts: fin(diag.nRafts) ? diag.nRafts : 0,
    worstLoadPair,
    // Heatmap RE-ECHANTILLONNEE (decouplee du maillage) — le motif, pas la methode.
    ...(hm ? { champDeflexion: hm } : {}),
  };
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof RADIER_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(RADIER_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${RADIER_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: RADIER_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul radier client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist (diagnostics), renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 * @returns enveloppe de succes (le moteur encode lui-meme une eventuelle erreur de
 *   garde dans `output.erreur` ; une exception inattendue remonte a l'appelant qui la
 *   mappe en SafeEngineError).
 */
export function runRadier(rawInput: unknown): EngineResultEnvelope<RadierOutput> {
  const input: RadierInput = RadierInputSchema.parse(rawInput);
  const rawResult = computeRadier(input, input.opts) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(RadierOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void radierContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
