/**
 * Module terzaghi (fondation superficielle) — point d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeTerzaghi) -> PROJECTION du
 * resultat brut sur la sortie whitelistee (contract.ts) -> enveloppe de resultat
 * (meta + output). Aucun DOM, aucune horloge, aucun hasard : deterministe.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les
 * TYPES du contrat via @roadsen/shared, jamais ce module (garde-fou ESLint +
 * controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#45) ---
 * Equivalence-PORTAGE prouvee (module == HTML d'origine, tolerance rel 1e-9).
 * La JUSTESSE scientifique reste NON validee tant que le kit cas-tests STARFIRE
 * n'est pas disponible (PR-1/#36) : sortie tag @science-unsigned. MJ-6 : pas de
 * mise en production sans conformite.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  TERZAGHI_ENGINE_ID,
  TerzaghiInputSchema,
  TerzaghiOutputSchema,
  terzaghiContract,
  type TerzaghiInput,
  type TerzaghiOutput,
} from './contract.js';
import { computeTerzaghi } from './engine.js';

export {
  TERZAGHI_ENGINE_ID,
  TerzaghiInputSchema,
  TerzaghiOutputSchema,
  terzaghiContract,
  type TerzaghiInput,
  type TerzaghiOutput,
};
export { TERZAGHI_CONFIDENTIAL_MARKER } from './engine.js';
// Jeux d'ENTREES canoniques (donnees pures, sans science ni sortie figee) :
// reutilises par l'equivalence-portage ET l'e2e API (meme entree des deux cotes).
export { TERZAGHI_FIXTURES, type TerzaghiFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * ETIQUETTES d'INTERMEDIAIRES CONFIDENTIELS susceptibles d'apparaitre dans le
 * TEXTE LIBRE des warnings du moteur (DoD §8, correctif MAJEUR-1).
 *
 * --- Le probleme ---
 * La whitelist de sortie protege les CLES structurees (un champ `ple`/`qce` ne
 * peut pas etre expose). Mais les `warnings[]` sont du TEXTE LIBRE : le moteur y
 * interpole des VALEURS d'intermediaires confidentiels, ex.
 *   « q_ce = 1,23 MPa faible (< 1,5 MPa) : ... »
 *   « p_le* = 0,15 MPa faible (< 0,3 MPa) : ... »
 * `ple` et `qce` sont dans FUITES_INTERDITES : leur VALEUR ne doit pas plus fuir
 * par le texte que par une cle. La whitelist ne couvrait pas ce canal.
 *
 * --- La regle ---
 * On NE TOUCHE PAS au moteur (science figee, equivalence-portage preservee : le
 * brut `R` garde ses warnings complets). On REDACTE a la PROJECTION : on retire
 * la VALEUR confidentielle (`= <nombre> MPa`) accolee a une etiquette confidentielle,
 * en gardant le SENS (l'etiquette, le seuil normatif, la citation NF P94-261).
 *
 * Les etiquettes couvrent les formes HTML (`q<sub>ce</sub>`, `p<sub>le</sub>*`)
 * ET les formes brutes (`qce`, `ple`) pour rester robuste si un moteur futur
 * formule autrement. Le SEUIL (« < 1,5 MPa ») n'est PAS un intermediaire calcule
 * (c'est une constante normative) : on le conserve.
 */
/**
 * ALLOWLIST fail-closed (revue adverse — parite radier #54 / pieux #48). On masque
 * TOUTE valeur `<token> = <nombre> [unite]` SAUF si `<token>` (dernier symbole avant
 * le `=`) est dans une allowlist BENIGNE explicite. Inconnu => masque. Remplace la
 * BLACKLIST fail-open qui ne couvrait que ple* / qce : une etiquette confidentielle non
 * prevue (ex. discriminant de famille) fuitait. Seuls les libelles GEOMETRIE (deja
 * exposes / entrees utilisateur) gardent leur valeur ; les prose (« NF P94-261 »,
 * « Sondage limite a X m ») n'ont pas de motif `= <nombre>` et sont preserves.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  'b', 'l', 'd', 'lb', // semelle : largeur B, longueur L, encastrement D, ratio L/B
]);

/** Normalise une etiquette : minuscule + non-alphanumeriques retires. Les labels
 * BENINS (geometrie B/L/D) sont ASCII ; toute etiquette confidentielle (ple/qce/formes
 * HTML/discriminant) normalise vers autre chose que benin => masquee (fail-closed). */
function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function redactConfidentialWarning(text: string): string {
  // TOKEN = tout symbole NON espace / NON `=` (couvre etiquettes non-ASCII).
  const valued = new RegExp(
    '([^\\s=]+)\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|%|\\u00b0)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) return whole;
    return `${token} (valeur confidentielle masquee)`;
  });
}

/**
 * Applique la redaction a TOUS les warnings. Point de passage oblige avant
 * d'exposer `warnings[]` au client (correctif MAJEUR-1).
 */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

/**
 * Re-FORME le resultat brut du moteur (`R`) en la SORTIE whitelistee. On
 * CONSTRUIT un objet propre champ a champ (jamais de copie brute) : seuls les
 * champs de RESULTAT destines a l'affichage/PV sont repris. Tout intermediaire
 * (kp, ple, De, facteurs, A'...) est ECARTE ici, puis re-strippe par
 * projectEngineOutput (defense en profondeur).
 *
 * On n'ajoute un champ numerique optionnel que s'il est FINI (exactOptional :
 * une cle absente plutot qu'un NaN/undefined, conforme a SafeNumber.finite()).
 */
function shapeOutput(
  R: {
    warn?: unknown[];
    err?: unknown;
    cases?: unknown[];
    ctx?: { regime?: unknown } | null;
    refCap?: Record<string, unknown>;
  },
  /** true si methode c–φ labo : le bloc cphi complementaire n'est alors PAS reproduit
   * (c–φ est la portance PRINCIPALE, deja dans Rtot/qRvd/taux) — fidele au HTML d'origine
   * (`C.cphi && !X.labo`). */
  labo: boolean,
): unknown {
  // MAJEUR-1 : on REDACTE les valeurs d'intermediaires confidentiels de TOUT
  // canal texte libre (erreur globale ET warnings) AVANT exposition. La whitelist
  // couvre les cles structurees ; ce canal texte etait la faille. `erreur` ne
  // porte aujourd'hui aucune valeur, mais on l'assainit aussi (defense en
  // profondeur, fail-closed — patron des 6 moteurs).
  const erreur = typeof R.err === 'string' ? redactConfidentialWarning(R.err) : null;
  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );

  const out: Record<string, unknown> = { erreur, warnings, cas: [] };

  const regime = R.ctx?.regime;
  if (regime === 'superficielle' || regime === 'semi-profonde') {
    out.regime = regime;
  }

  // --- Capacite portante de reference (charge centree) ---
  const rc = R.refCap;
  if (rc && rc.ok === true && fin(rc.A) && fin(rc.R0) && Array.isArray(rc.states)) {
    const states = rc.states
      .filter(
        (s): s is { etat: string; gRv: number; Rvd: number; qRvd: number } =>
          typeof s === 'object' &&
          s !== null &&
          fin((s as { gRv?: unknown }).gRv) &&
          fin((s as { Rvd?: unknown }).Rvd) &&
          fin((s as { qRvd?: unknown }).qRvd),
      )
      .map((s) => ({ etat: s.etat, gRv: s.gRv, Rvd: s.Rvd, qRvd: s.qRvd }));
    out.capaciteReference = { ok: true, A: rc.A, R0: rc.R0, states };
  }

  // --- Verdict par cas de charge ---
  const cas: unknown[] = [];
  const rawCases = Array.isArray(R.cases) ? R.cases : [];
  for (const raw of rawCases) {
    const c = raw as Record<string, unknown>;
    const item: Record<string, unknown> = {
      idx: fin(c.idx) ? c.idx : 0,
      etat: c.etat,
      invalide: c.invalid != null,
    };
    if (fin(c.Rtot)) item.Rtot = c.Rtot;
    if (fin(c.qRvd)) item.qRvd = c.qRvd;
    if (fin(c.taux)) item.taux = c.taux;
    if (typeof c.portOk === 'boolean') item.portanceOk = c.portOk;

    if (fin(c.Rhd)) item.Rhd = c.Rhd;
    if (fin(c.tauxH)) item.tauxH = c.tauxH;
    if (typeof c.glisOk === 'boolean') item.glissementOk = c.glisOk;

    // --- Excentrement (tab. 5.5) — MAJEUR-1 : ces grandeurs PUBLIQUES etaient
    // strippees, l'excentrement disparaissait de l'affichage ET du verdict (faux
    // PASS). excOk === null => non requis (ELU accidentel) : on n'attache RIEN et le
    // front affiche « non requis ». Sinon on projette verdict + valeur + limite. La
    // VALEUR affichee est le taux de surface comprimee `geom.exc` (l'objet `geom`
    // lui-meme reste SERVEUR : on n'en lit qu'`exc`, on n'expose pas A'/Ap/Bp/Lp).
    if (typeof c.excOk === 'boolean') {
      item.excOk = c.excOk;
      const geom = c.geom as { exc?: unknown } | undefined;
      if (geom && fin(geom.exc)) item.exc = geom.exc;
      if (fin(c.excLim)) item.excLim = c.excLim;
      if (typeof c.excLimLib === 'string') item.excLimLib = c.excLimLib.slice(0, 16);
    }

    // --- Portance complementaire c–φ (annexe F) — MAJEUR-2 : bloc ASSAINI (verdict +
    // resistances de RESULTAT uniquement). Les facteurs Nq/Nc/Ng/sq/sc/bq/… restent
    // SERVEUR (on ne recopie JAMAIS l'objet brut `c.cphi`, on construit un objet propre).
    // En labo, c–φ EST la portance principale (deja dans Rtot/qRvd/taux) : pas de bloc
    // complementaire redondant, comme le HTML (`C.cphi && !X.labo`).
    if (!labo && c.cphi != null && typeof c.cphi === 'object') {
      const f = c.cphi as Record<string, unknown>;
      const cphi: Record<string, unknown> = {};
      if (typeof f.ok === 'boolean') cphi.ok = f.ok;
      if (fin(f.taux)) cphi.taux = f.taux;
      if (fin(f.qRvd)) cphi.qRvd = f.qRvd;
      if (fin(f.Rtot)) cphi.Rtot = f.Rtot;
      // `err` = message normatif borne (sans valeur interpolee) ; assaini par defense
      // en profondeur (redaction fail-closed) avant exposition.
      if (typeof f.err === 'string') {
        cphi.err = redactConfidentialWarning(f.err).slice(0, 300);
      }
      if (Object.keys(cphi).length > 0) item.cphi = cphi;
    }

    const tass = c.tass as { sf?: unknown } | undefined;
    if (tass && fin(tass.sf)) item.tassement = tass.sf;
    const schm = c.schm as { s?: unknown } | undefined;
    if (schm && fin(schm.s)) item.tassementSchmertmann = schm.s;
    const oed = c.oed as { s?: unknown } | undefined;
    if (oed && fin(oed.s)) item.tassementOed = oed.s;
    const elast = c.elast as { s?: unknown } | undefined;
    if (elast && fin(elast.s)) item.tassementElastique = elast.s;
    if (fin(c.dv)) item.deplacementVertical = c.dv;

    cas.push(item);
  }
  out.cas = cas;

  return out;
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof TERZAGHI_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(TERZAGHI_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${TERZAGHI_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: TERZAGHI_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul terzaghi client-safe : valide l'entree, recalcule cote serveur, projette
 * la sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 * @returns enveloppe de succes (le moteur encode lui-meme les cas/erreurs de
 *   saisie dans `output.erreur` ; une exception inattendue remonte a l'appelant
 *   qui la mappe en SafeEngineError).
 */
export function runTerzaghi(rawInput: unknown): EngineResultEnvelope<TerzaghiOutput> {
  const input: TerzaghiInput = TerzaghiInputSchema.parse(rawInput);
  const rawResult = computeTerzaghi(input);
  const shaped = shapeOutput(
    rawResult as Parameters<typeof shapeOutput>[0],
    input.essai === 'labo',
  );
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(TerzaghiOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void terzaghiContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
