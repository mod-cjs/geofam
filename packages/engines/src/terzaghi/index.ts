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
import { computeTerzaghi, terzaghiKpCurveCoeffs } from './engine.js';

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
  'b',
  'l',
  'd',
  'lb', // semelle : largeur B, longueur L, encastrement D, ratio L/B
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

/** Copie SELECTIVE de champs numeriques finis d'une source vers une cible. */
function pickFinite(
  src: Record<string, unknown> | undefined | null,
  target: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (src == null || typeof src !== 'object') return;
  for (const k of keys) {
    if (fin(src[k])) target[k] = src[k];
  }
}

/** Copie SELECTIVE de champs chaine (bornes) d'une source vers une cible. */
function pickStr(
  src: Record<string, unknown> | undefined | null,
  target: Record<string, unknown>,
  keys: readonly string[],
  max = 120,
): void {
  if (src == null || typeof src !== 'object') return;
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'string') target[k] = v.slice(0, max);
  }
}

/**
 * Projette le sous-objet de tassement DETAILLE (Ménard / elastique / Schmertmann /
 * oedometrique) sur l'allowlist reco A. Clés NOMMEES uniquement (fail-closed §8) :
 * aucune copie brute. Renvoie undefined si rien de whiteliste (cle omise).
 */
function shapeTass(raw: unknown, kind: 'tass' | 'elast' | 'schm' | 'oed'): unknown {
  if (raw == null || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (kind === 'tass') {
    pickFinite(s, out, ['Ec', 'Ed', 'alc', 'ald', 'lc', 'ld', 'dq', 'sc', 'sd', 'sf']);
    pickStr(s, out, ['lamLib'], 40);
    pickStr(s, out, ['mode'], 80);
  } else if (kind === 'elast') {
    pickFinite(s, out, ['cf', 'E', 'nu', 'dq', 's']);
    pickStr(s, out, ['cfLib'], 40);
    pickStr(s, out, ['err'], 300);
  } else if (kind === 'schm') {
    pickFinite(s, out, [
      'C1',
      'C2',
      'C3',
      'Izp',
      'Efac',
      'Emin',
      'Emax',
      'zfac',
      'zI',
      's',
    ]);
    pickStr(s, out, ['err'], 300);
  } else {
    pickFinite(s, out, ['alphaSang', 'Mmin', 'Mmax', 'depth', 's']);
    pickStr(s, out, ['zlbl'], 60);
    pickStr(s, out, ['err'], 300);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coefficients de courbe [a,b,c,d] finis, sinon undefined (cle omise). */
function curve4(a: unknown): number[] | undefined {
  if (!Array.isArray(a) || a.length !== 4) return undefined;
  return a.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (a as number[]).slice()
    : undefined;
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
    ctx?: {
      regime?: unknown;
      u?: unknown;
      q0?: unknown;
      sv0?: unknown;
      raid?: Record<string, unknown> | null;
    } | null;
    refCap?: Record<string, unknown>;
  },
  /** Type d'essai in situ : 'pressio' | 'penetro' | 'labo'. Sert au choix de la table
   * de coefficients de courbe (KP pressio / KC penetro) et au drapeau labo (le bloc cphi
   * complementaire n'est alors PAS reproduit — c–φ est la portance PRINCIPALE, fidele au
   * HTML d'origine `C.cphi && !X.labo`). */
  essai: string,
): unknown {
  const labo = essai === 'labo';
  const curveCat = (cat: unknown): { f?: number[]; c?: number[] } => {
    const co = terzaghiKpCurveCoeffs(cat, essai);
    if (!co) return {};
    const out: { f?: number[]; c?: number[] } = {};
    const f = curve4(co.f);
    if (f) out.f = f;
    const c = curve4(co.c);
    if (c) out.c = c;
    return out;
  };
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

  // --- Contraintes de base (overburden affiche par la note §2) ---
  // Grandeurs elementaires (u, q0, sv0) — client-safe (cf. contract.ts). On
  // n'expose QUE ces trois champs, jamais l'objet ctx (FUITES_INTERDITES).
  const ctx = R.ctx;
  if (ctx && fin(ctx.u) && fin(ctx.q0) && fin(ctx.sv0)) {
    out.contraintesBase = { u: ctx.u, q0: ctx.q0, sv0: ctx.sv0 };
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
    const refOut: Record<string, unknown> = { ok: true, A: rc.A, R0: rc.R0, states };
    // Detail pas-a-pas refCap (in situ) — allowlist reco A, clés nommées.
    pickFinite(rc, refOut, [
      'q0',
      'hr',
      'ple',
      'De',
      'DeB',
      'kpx',
      'kf',
      'kc',
      'kp',
      'ib',
      'qnet',
      'gRdv',
      'qTass',
    ]);
    if (typeof rc.method === 'string') refOut.method = rc.method.slice(0, 40);
    if (typeof rc.perML === 'boolean') refOut.perML = rc.perML;
    // Coefficients de courbe (categorie du calcul) — table publiee (reco A).
    if (typeof rc.method === 'string' && rc.method.indexOf('c–φ') < 0) {
      const cc = curveCat(rc.cat);
      if (cc.f) refOut.coefCourbeF = cc.f;
      if (cc.c) refOut.coefCourbeC = cc.c;
    }
    const rct = shapeTass(rc.tass, 'tass');
    if (rct) refOut.tass = rct;
    const rce = shapeTass(rc.elast, 'elast');
    if (rce) refOut.elast = rce;
    const rcs = shapeTass(rc.schm, 'schm');
    if (rcs) refOut.schm = rcs;
    const rco = shapeTass(rc.oed, 'oed');
    if (rco) refOut.oed = rco;
    out.capaciteReference = refOut;
  }

  // --- Raideurs equivalentes du sol support (annexe J.3 / Gazetas) — reco A ---
  // K_v/K_h/K_θ : grandeurs de dimensionnement affichees ; le CODE (ratios) reste serveur.
  const raid = R.ctx?.raid;
  if (raid && typeof raid === 'object' && fin(raid.Kv)) {
    const rOut: Record<string, unknown> = { Kv: raid.Kv };
    pickFinite(raid, rOut, ['KhB', 'KhL', 'KtB', 'KtL']);
    pickStr(raid, rOut, ['methodLib'], 60);
    if (typeof raid.perML === 'boolean') rOut.perML = raid.perML;
    out.raideurs = rOut;
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
    // Grandeurs de DEMANDE affichees (verdict + synthese, clone UI) : q_ref et
    // H_d se re-derivent des efforts SAISIS (cf. contract.ts) — pas de methode.
    if (fin(c.qref)) item.qref = c.qref;
    if (fin(c.H)) item.Hd = c.H;

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

    // --- DETAIL PAS-A-PAS du cas (ADR 0015 reco A) — grandeurs d'affichage ---
    // Geometrie effective (Meyerhof) + coefficients de portance/reduction (annexes D/E) +
    // resistances : re-derivables des saisies / tables publiees. Clés NOMMEES (fail-closed §8).
    pickFinite(c, item, [
      'A',
      'Ap',
      'eB',
      'eL',
      'delta',
      'hr',
      'ple',
      'De',
      'DeB',
      'kpx',
      'kf',
      'kc',
      'kp',
      'idel',
      'ibet',
      'idb',
      'qnet',
      'R0',
      'gRv',
      'gRdv',
      'da',
      'gRh',
      'gRdh',
    ]);
    if (typeof c.hrRed === 'boolean') item.hrRed = c.hrRed;
    if (typeof c.glisMode === 'string') item.glisMode = c.glisMode.slice(0, 120);
    // Largeur/longueur effectives B'/L' (objet geom brut — on ne lit que Bp/Lp).
    const geomBp = c.geom as { Bp?: unknown; Lp?: unknown } | undefined;
    if (geomBp && fin(geomBp.Bp)) item.Bp = geomBp.Bp;
    if (geomBp && fin(geomBp.Lp)) item.Lp = geomBp.Lp;
    // Coefficients de courbe k_p/k_c (categorie du calcul) — in situ uniquement (table
    // publiee annexe D/E, reco A). En labo, la portance est analytique (pas de courbe).
    if (!labo && c.ple != null) {
      const cc = curveCat(c.cat);
      if (cc.f) item.coefCourbeF = cc.f;
      if (cc.c) item.coefCourbeC = cc.c;
    }
    // Tassements DETAILLES (un seul present selon la methode).
    const tassD = shapeTass(c.tass, 'tass');
    if (tassD) item.tass = tassD;
    const elastD = shapeTass(c.elast, 'elast');
    if (elastD) item.elast = elastD;
    const schmD = shapeTass(c.schm, 'schm');
    if (schmD) item.schm = schmD;
    const oedD = shapeTass(c.oed, 'oed');
    if (oedD) item.oed = oedD;

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
  const shaped = shapeOutput(rawResult as Parameters<typeof shapeOutput>[0], input.essai);
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(TerzaghiOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void terzaghiContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
