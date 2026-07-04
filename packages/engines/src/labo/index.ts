/**
 * Module FASTLAB — essais de labo & classification GTR (NF P 11-300) — point d'entree
 * PUR & client-safe.
 *
 * Chaine : entree validee -> moteur (computeLabo) -> PROJECTION du resultat brut
 * { D, cls } sur la sortie whitelistee (contract.ts) -> enveloppe { ok, meta, output }.
 * Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur, DoD §8).
 *
 * --- CONFIDENTIALITE (honnetete) ---
 * Les resultats de labo + la classe GTR sont le LIVRABLE de l'essai, PAS une methode
 * confidentielle (contrairement aux moteurs de dimensionnement). Tout est client-safe.
 * On whiteliste neanmoins la sortie (`.strict()`) + redaction fail-closed des messages
 * par COHERENCE avec les 5 autres moteurs (defense en profondeur, pas une fuite averee).
 *
 * --- ETAT SCIENTIFIQUE (#49-53) ---
 * Equivalence-PORTAGE prouvee (module == HTML d'origine). JUSTESSE scientifique NON
 * validee tant que le kit cas-tests STARFIRE manque (PR-1/#36) : @science-unsigned.
 * MJ-6 : pas de prod sans conformite.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  LABO_ENGINE_ID,
  LaboInputSchema,
  LaboOutputSchema,
  laboContract,
  type LaboInput,
  type LaboOutput,
} from './contract.js';
import { computeLabo } from './engine.js';

export {
  LABO_ENGINE_ID,
  LaboInputSchema,
  LaboOutputSchema,
  laboContract,
  type LaboInput,
  type LaboOutput,
};
export { LABO_CONFIDENTIAL_MARKER } from './engine.js';
export { LABO_FIXTURES, type LaboFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * REDACTION FAIL-CLOSED des messages (`warnings`/`erreur`) — patron #48/#54 (allowlist
 * fail-closed, jamais une blacklist). Defense en profondeur : ici les valeurs de labo
 * sont client-safe (livrable), donc l'allowlist benigne est LARGE (tous les resultats
 * de labo exposes + grandeurs geometriques) ; cette barriere ne sert qu'a fermer une
 * fuite future d'un intermediaire NON expose (par coherence avec les autres moteurs).
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Resultats de labo exposes (tous client-safe).
  'wn',
  'dmax',
  'p80',
  'p2',
  'cu',
  'cc',
  'mf',
  'wl',
  'wp',
  'ip',
  'ic',
  'vbs',
  'rhos',
  'wopn',
  'rdmax',
  'cbr',
  'gonfl',
  'rhoapp',
  'rhodapp',
  'es',
  'la',
  'sz',
  'mde',
  'wa',
  'so3',
  'so4',
  'qu',
  'cu',
  'c',
  'phi',
  'phir',
  'e0',
  'cs',
  'k',
  'larb',
  'mds',
  // Grandeurs geometriques / d'essai legitimes.
  'n',
  'w',
  'v',
  'm',
  'd',
  'h',
  'l',
  'a',
  't',
  'e',
  'r',
  'mt',
  'sr',
]);

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
 * Redacte FAIL-CLOSED toute valeur `<token> = <nombre> [unite]` dont le `<token>` n'est
 * PAS dans l'ALLOWLIST benigne. Remplace par `<token> (valeur confidentielle masquee)`.
 * Inconnu => masque. Espace fin insecable FR gere via escape (no-irregular-whitespace).
 */
export function redactConfidentialWarning(text: string): string {
  const TOKEN = "([A-Za-z0-9\\u2090-\\u209c'\\u2019,/*_\\[\\]]+)";
  const valued = new RegExp(
    TOKEN + '\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|%|t|Mg)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) return whole;
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les messages (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

// Signatures d'EXCEPTION JS interne. Defense en profondeur (parite avec pressiometre,
// ou la meme classe de fuite etait CONFIRMEE) : on n'expose jamais un message
// d'exception technique brut au client. Les messages de DOMAINE (FR) ne matchent pas
// et restent visibles (redactes des valeurs sensibles).
const INTERNAL_JS_ERROR =
  /cannot read|cannot access|is not a function|is not defined|is not iterable|reading '|of undefined|of null|type\s?error|reference\s?error|undefined is|null is/i;

/**
 * Nettoie le message d'erreur expose au client : une exception JS interne devient un
 * message generique ; une erreur de domaine passe (redactee des valeurs confidentielles).
 */
export function sanitizeEngineError(text: string): string {
  if (INTERNAL_JS_ERROR.test(text)) {
    return 'Donnees d essai non exploitables : mesures incoherentes ou insuffisantes.';
  }
  return redactConfidentialWarning(text);
}

/** Nombre fini ou null (la plupart des resultats sont null si l'essai n'est pas saisi). */
function nn(x: unknown): number | null {
  return fin(x) ? x : null;
}
/** Chaine ou null. */
function sn(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

/**
 * Re-FORME le resultat brut { D, cls } en la SORTIE whitelistee. On CONSTRUIT un objet
 * propre champ a champ : les grandeurs de labo (D) + la classe GTR. Les libelles de la
 * classe (path/warn) sont REDACTES (defense en profondeur — ici sans cible reelle, les
 * valeurs etant client-safe).
 */
function shapeOutput(R: Record<string, unknown>): unknown {
  const D = (R.D ?? {}) as Record<string, unknown>;
  const cls = (R.cls ?? null) as Record<string, unknown> | null;

  const emptyClasse = {
    fam: null,
    code: null,
    full: null,
    desc: '',
    path: [] as string[],
    etat: null,
    stApplies: false,
    rNote: null,
  };

  // Cas d'erreur de calcul (science levee).
  if (typeof R.err === 'string') {
    return {
      erreur: sanitizeEngineError(R.err),
      warnings: [],
      wn: null,
      dmax: null,
      p80: null,
      p2: null,
      Cu: null,
      Cc: null,
      mf: null,
      mfq: null,
      wl: null,
      wp: null,
      ip: null,
      ic: null,
      vbs: null,
      rhos: null,
      wopn: null,
      rdmax: null,
      cbr: null,
      cbrType: null,
      gonfl: null,
      rho_app: null,
      rhod_app: null,
      es: null,
      la: null,
      sz: null,
      mde: null,
      wa: null,
      so3: null,
      qu: null,
      c_cis: null,
      phi_cis: null,
      phiR_cis: null,
      c: null,
      phi: null,
      cu_uu: null,
      e0_oedo: null,
      Cc_oedo: null,
      Cs_oedo: null,
      k: null,
      classe: emptyClasse,
    };
  }

  // NB : `classe.path`/`rNote` sont des LIBELLES NORMATIFS d'explication du classement
  // GTR — le LIVRABLE meme de l'outil (ex. « Passant 80µm = 52 % > 35 % → famille A »),
  // CLIENT-SAFE (les etiquettes portent des valeurs deja exposees) ; l'AFFICHAGE les
  // passe par une allowlist fail-closed. En revanche `classe.warn` (caveats de maturite,
  // ex. « distinction C1/C2 heuristique provisoire ») est INTERNE : il n'est PAS reporte
  // dans la sortie client-facing (decision confidentialite/credibilite — avis
  // ingenieur-securite + titulaire) → jamais scelle ni envoye au navigateur.
  const strArr = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : [];
  const classe = cls
    ? {
        fam: sn(cls.fam),
        code: sn(cls.code),
        full: sn(cls.full),
        desc: typeof cls.desc === 'string' ? cls.desc : '',
        path: strArr(cls.path),
        etat: sn(cls.etat),
        stApplies: cls.stApplies === true,
        rNote: Array.isArray(cls.rNote) ? strArr(cls.rNote) : null,
      }
    : emptyClasse;

  return {
    erreur: null,
    warnings: [],
    wn: nn(D.wn),
    dmax: nn(D.dmax),
    p80: nn(D.p80),
    p2: nn(D.p2),
    Cu: nn(D.Cu),
    Cc: nn(D.Cc),
    mf: nn(D.mf),
    mfq: sn(D.mfq),
    wl: nn(D.wl),
    wp: nn(D.wp),
    ip: nn(D.ip),
    ic: nn(D.ic),
    vbs: nn(D.vbs),
    rhos: nn(D.rhos),
    wopn: nn(D.wopn),
    rdmax: nn(D.rdmax),
    cbr: nn(D.cbr),
    cbrType: sn(D.cbrType),
    gonfl: nn(D.gonfl),
    rho_app: nn(D.rho_app),
    rhod_app: nn(D.rhod_app),
    es: nn(D.es),
    la: nn(D.la),
    sz: nn(D.sz),
    mde: nn(D.mde),
    wa: nn(D.wa),
    so3: nn(D.so3),
    qu: nn(D.qu),
    c_cis: nn(D.c_cis),
    phi_cis: nn(D.phi_cis),
    phiR_cis: nn(D.phiR_cis),
    c: nn(D.c),
    phi: nn(D.phi),
    cu_uu: nn(D.cu_uu),
    e0_oedo: nn(D.e0_oedo),
    Cc_oedo: nn(D.Cc_oedo),
    Cs_oedo: nn(D.Cs_oedo),
    k: nn(D.k),
    classe,
  };
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof LABO_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(LABO_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${LABO_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: LABO_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul FASTLAB client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 */
export function runLabo(rawInput: unknown): EngineResultEnvelope<LaboOutput> {
  const input: LaboInput = LaboInputSchema.parse(rawInput);
  const rawResult = computeLabo(input) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  const output = projectEngineOutput(LaboOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void laboContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
