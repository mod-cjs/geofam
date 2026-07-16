/**
 * Module pressiometre Menard (essai pressiometrique, NF EN ISO 22476-4) — point
 * d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computePressiometre) -> PROJECTION
 * du resultat brut `_res` sur la sortie whitelistee (contract.ts) -> enveloppe de
 * resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard : deterministe.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les
 * TYPES du contrat via @roadsen/shared, jamais ce module (garde-fou ESLint +
 * controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#47) ---
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
  PRESSIOMETRE_ENGINE_ID,
  PressiometreInputSchema,
  PressiometreOutputSchema,
  pressiometreContract,
  type PressiometreInput,
  type PressiometreOutput,
} from './contract.js';
import { computePressiometre } from './engine.js';

export {
  PRESSIOMETRE_ENGINE_ID,
  PressiometreInputSchema,
  PressiometreOutputSchema,
  pressiometreContract,
  type PressiometreInput,
  type PressiometreOutput,
};
export { PRESSIOMETRE_CONFIDENTIAL_MARKER } from './engine.js';
// Jeux d'ENTREES canoniques (donnees pures, sans science ni sortie figee) :
// reutilises par l'equivalence-portage ET l'e2e API (meme entree des deux cotes).
export { PRESSIOMETRE_FIXTURES, type PressiometreFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
/** Valeur finie sinon 0 (grandeur toujours presente). */
function n0(x: unknown): number {
  return fin(x) ? x : 0;
}
/** Valeur finie sinon null (grandeur optionnelle — ex. errV = Infinity -> « — »). */
function nOrNull(x: unknown): number | null {
  return fin(x) ? x : null;
}
/** Indice entier >= 0 sinon 0. */
function idx0(x: unknown): number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0;
}

type CourbePoint = {
  p: number;
  pCorr: number;
  v60: number;
  d6030: number;
  phase: 'Recompression' | 'Pseudo-élast.' | 'Plastique';
};

/**
 * COURBE CORRIGEE client-safe : colonnes EXACTES de la table « Mesures corrigees »
 * (P brut, P corr., V60 corr., Δ60/30, Phase — cf. HTML L.1247-1262). On ne lit QUE
 * ces 5 grandeurs de chaque palier `c` : la pression nette pS et les volumes corriges
 * v15/v30 (non affiches par le client) ne sont JAMAIS repris. La PHASE est derivee
 * verbatim des indices de plage (`R.pfI`=p0, `R.plmI`=pf — cf. engine `_res`).
 */
function buildCourbe(R: Record<string, unknown>): CourbePoint[] {
  const C = Array.isArray(R.C) ? R.C : [];
  const p0Idx = idx0(R.pfI); // _res.pfI porte l'indice de p0 (debut pseudo-elastique)
  const pfIdx = idx0(R.plmI); // _res.plmI porte l'indice de pf (fin zone plate)
  const out: CourbePoint[] = [];
  for (let i = 0; i < C.length; i++) {
    const c = C[i] as Record<string, unknown>;
    if (!c || typeof c !== 'object') continue;
    // Parite HTML L.1255-1258 : i<p0 -> Recompression ; i<=pf -> Pseudo-elast. ; sinon Plastique.
    const phase: CourbePoint['phase'] =
      i < p0Idx ? 'Recompression' : i <= pfIdx ? 'Pseudo-élast.' : 'Plastique';
    out.push({
      p: n0(c.pRaw),
      pCorr: n0(c.p),
      v60: n0(c.v60),
      d6030: n0(c.dv),
      phase,
    });
  }
  return out;
}

/**
 * ETIQUETTES d'INTERMEDIAIRES CONFIDENTIELS susceptibles d'apparaitre dans le
 * TEXTE LIBRE d'un message (erreur globale, ou warning futur) — DoD §8, leçon
 * MAJEUR-1 de #45.
 *
 * --- Le probleme (meme nature que terzaghi) ---
 * La whitelist de sortie protege les CLES structurees (un champ `sigH0`/`mE`/`A`
 * ne peut pas etre expose). Mais un TEXTE LIBRE pourrait interpoler la VALEUR
 * d'un intermediaire confidentiel propre au depouillement pressiometrique :
 *   - decomposition de la contrainte au repos : sigH0, sigV0, sig'v0, u0 ;
 *   - pressions/volumes de CALAGE bruts de la plage pseudo-elastique : pE, p0,
 *     Pf (avant nette), VE/V0c/Vf, pression nette par palier pS ;
 *   - analyse de pente de la plage : mE (pente minimale), beta (coefficient
 *     d'extension §D.5.1).
 * (Les coefficients A/B de la regression courbe inverse §D.4.3.2 ne portent pas
 * d'etiquette litterale stable mono-lettre — leur redaction par `A=`/`B=` ferait
 * de faux positifs sur les libelles de categorie "A"/"B" ; ils restent proteges
 * par la whitelist de cles, jamais exposes en clair.)
 *
 * --- La regle ---
 * On NE TOUCHE PAS au moteur (science figee). On REDACTE a la PROJECTION : on
 * retire la VALEUR confidentielle (`= <nombre> [unite]`) accolee a une etiquette
 * confidentielle, en gardant le SENS.
 *
 * --- ETAT REEL : `warnings` est STRUCTURELLEMENT VIDE aujourd'hui (MINEUR-4/1) ---
 * Le moteur emet des `console.warn` (cas « a trop grand » et garde « _dV/_dP <= 0
 * -> EM=0 ») MAIS ne pose AUCUN champ `warn` dans son `_res` (cf. engine.ts).
 * `shapeOutput` lit `R.warn` (absent) -> `warnings` ressort donc TOUJOURS `[]` en
 * fonctionnement normal. Cette redaction n'est PAS le correctif d'une fuite averee :
 * c'est une defense en profondeur fail-closed (parite avec le patron des 6
 * moteurs). Si une evolution future PIPAIT ces `console.warn` (ou tout autre texte
 * d'intermediaire) dans un champ `warn`, la redaction MORDRAIT — d'ou la couverture
 * ci-dessous des ETIQUETTES REELLEMENT EMISES par ces deux `console.warn`.
 *
 * --- Ce que l'on NE redacte PAS ---
 * Les GRANDEURS EXPOSEES du PV (pL, pL*, pf*, EM, EM/pL*, alpha) sont les
 * RESULTATS d'ingenierie : leur valeur figure deja dans la sortie whitelistee,
 * la masquer dans un message n'aurait pas de sens. Idem les SEUILS/classes
 * normatifs (« pL < 0,2 MPa », « ratio < 5 ») : ce ne sont pas des intermediaires
 * calcules.
 *
 * NB sur l'echappement : chaque `source` ci-dessous est injectee dans une regex
 * `valued` ; les metacaracteres litteraux des etiquettes REELLES (`.`, `×`) y sont
 * deja echappes (`0\\.5`, `×` n'est pas un metacaractere). `\b` ne borne PAS sur
 * `_` ni `×` : on n'utilise donc PAS `\b` pour `_dV`/`a×Pmax` (cf. piege challenger).
 */
// ALLOWLIST fail-closed (revue adverse — parite radier #54 / pieux #48). On masque
// TOUTE valeur `<token> = <nombre> [unite]` SAUF si `<token>` est BENIN. Remplace la
// BLACKLIST (fail-open) : une etiquette confidentielle NON prevue (contrainte au repos,
// calage pseudo-elastique, pente, intermediaires _dV/_dP, seuils p0I/pfI...) est
// desormais masquee par DEFAUT, plus besoin de les enumerer. Benins = uniquement les
// RESULTATS DEJA EXPOSES (sortie whitelistee) susceptibles d'apparaitre en `= <nombre>`
// dans un warning : pL/pL*/pf*/EM/ratio. Distinguables apres normalisation : 'pl'
// (expose) vs 'pe'/'p0'/'pf' (calage) ; 'em' (expose) vs 'me' (pente).
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set<string>([
  'pl',
  'plnette',
  'pfnette',
  'em',
  'ratioempl',
]);

/** Normalise une etiquette : minuscule + non-alphanumeriques retires (fail-closed). */
function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Redacte la VALEUR confidentielle accolee a une etiquette confidentielle dans
 * un texte. Remplace `<label> = <nombre> [unite]` par `<label> (valeur
 * confidentielle masquee)`. Fail-closed. Ne touche QUE la valeur LIEE a
 * l'etiquette : les autres nombres (profondeurs en m, classes, seuils) sont
 * preserves.
 */
export function redactConfidentialWarning(text: string): string {
  // TOKEN = tout symbole NON espace / NON `=` (couvre lettres grecques β/σ, indices,
  // `_dV`, `a×Pmax`... — sinon une etiquette non-ASCII echapperait au masque).
  const valued = new RegExp(
    '([^\\s=]+)\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|bar|cm\\u00b3|cm3|cm|mm|m|%)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) return whole;
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les warnings (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

// Signatures d'EXCEPTION JS interne (moteur leve sur donnees aberrantes : volumes
// decroissants, courbe plate). On ne laisse JAMAIS un tel message brut atteindre le
// client (hygiene + anti-divulgation d'implementation). Les messages de DOMAINE (FR)
// ne matchent pas ces signatures et restent visibles (redactes des valeurs sensibles).
const INTERNAL_JS_ERROR =
  /cannot read|cannot access|is not a function|is not defined|is not iterable|reading '|of undefined|of null|type\s?error|reference\s?error|undefined is|null is/i;

/**
 * Nettoie le message d'erreur expose au client : une exception JS interne devient un
 * message generique ; une erreur de domaine passe (redactee des valeurs confidentielles).
 */
export function sanitizeEngineError(text: string): string {
  if (INTERNAL_JS_ERROR.test(text)) {
    return 'Courbe pressiometrique non exploitable : paliers de mesure incoherents ou insuffisants.';
  }
  return redactConfidentialWarning(text);
}

/**
 * Re-FORME le resultat brut `_res` du moteur en la SORTIE whitelistee. On
 * CONSTRUIT un objet propre champ a champ (jamais de copie brute) : seuls les
 * champs de RESULTAT destines a l'affichage/PV sont repris. Tout intermediaire
 * (courbe corrigee C, sigH0/sigV0/u0, mE/beta/iE, coefficients A/B de `ext`,
 * fluage, pE/p0/Pf/VE/V0c/Vf...) est ECARTE ici, puis re-strippe par
 * projectEngineOutput (defense en profondeur).
 */
function shapeOutput(R: Record<string, unknown>): unknown {
  // Cas d'erreur de calcul / donnees insuffisantes : on n'expose que le message redacte.
  if (typeof R.err === 'string') {
    return {
      erreur: sanitizeEngineError(R.err),
      warnings: [],
      pL: 0,
      pLNette: 0,
      pfNette: 0,
      EM: 0,
      ratioEMpL: 0,
      alpha: 0,
      Ey: 0,
      pLDirect: false,
      categorie: '',
      categorieLibelle: '',
      consolidation: '',
      pf: 0,
      pE: 0,
      p0: 0,
      sigmaH0: 0,
      z: 0,
      categorieDescription: '',
      volumes: { vE: 0, v0: 0, vf: 0, vLim: 0 },
      extrapolation: { a: 0, b: 0, plmVLim: 0, plmAsymptote: 0, errV: null },
      synthese: { beta: 0, mE: 0, plageAutoDebut: 0, plageAutoFin: 0 },
      courbe: [],
    };
  }

  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );

  return {
    erreur: null,
    warnings,
    pL: fin(R.pL) ? R.pL : 0,
    pLNette: fin(R.pLS) ? R.pLS : 0,
    pfNette: fin(R.PfS) ? R.PfS : 0,
    EM: fin(R.EM) ? R.EM : 0,
    ratioEMpL: fin(R.ratio) ? R.ratio : 0,
    alpha: fin(R.alpha) ? R.alpha : 0,
    // Ey = EM/alpha (module d'Young derive, MPa) — parite HTML `r.EM / r.alpha`.
    // alpha (getAlpha) est toujours dans {0.25, 0.33, 0.5, 0.67, 1.0} sur un cas
    // valide (jamais 0) ; garde defensive si intermediaire absent/degrade.
    Ey: fin(R.EM) && fin(R.alpha) && R.alpha !== 0 ? R.EM / R.alpha : 0,
    // pL_direct est null si la pL a ete extrapolee (§D.4.3) ; non-null = mesure directe.
    pLDirect: R.pL_direct !== null && R.pL_direct !== undefined,
    categorie: typeof R.cat === 'string' ? R.cat : '',
    categorieLibelle: typeof R.catName === 'string' ? R.catName : '',
    consolidation: typeof R.consol === 'string' ? R.consol : '',
    // --- SORTIE ELARGIE « zero ecart » — valeurs AFFICHEES par renderResults, en
    //     UNITES INTERNES (bar/cm³/coeff bruts). Construction champ a champ (aucun
    //     spread) : sigV0/sig'v0/u0, pS/v15/v30 par palier, _slopes/iE, `gen` ne sont
    //     JAMAIS lus -> jamais exposes (cf. test negatif §8). ---
    pf: n0(R.Pf),
    pE: n0(R.pE),
    p0: n0(R.p0),
    sigmaH0: n0(R.sigH0),
    z: n0(R.z),
    categorieDescription: typeof R.catDesc === 'string' ? R.catDesc : '',
    volumes: {
      vE: n0(R.VE),
      v0: n0(R.V0c),
      vf: n0(R.Vf),
      vLim: n0(R.VsP2V1),
    },
    extrapolation: readExtrapolation(R.ext),
    synthese: {
      beta: n0(R.beta),
      mE: n0(R.mE),
      plageAutoDebut: idx0(R.auto_p0I),
      plageAutoFin: idx0(R.auto_pfI),
    },
    courbe: buildCourbe(R),
  };
}

/**
 * Lit UNIQUEMENT les 5 grandeurs AFFICHEES de l'extrapolation par courbe inverse
 * (A, B, pLM au V conventionnel, pLM asymptote, ecart errV — encart client
 * L.1199-1203). La fonction `gen` (closure de regression) et le reste de `ext` ne
 * sont PAS lus. errV non fini -> null (le client affiche « — »).
 */
function readExtrapolation(ext: unknown): {
  a: number;
  b: number;
  plmVLim: number;
  plmAsymptote: number;
  errV: number | null;
} {
  const recip =
    ext && typeof ext === 'object' && 'recip' in ext
      ? ((ext as Record<string, unknown>).recip as Record<string, unknown>)
      : undefined;
  return {
    a: n0(recip?.A),
    b: n0(recip?.B),
    plmVLim: n0(recip?.PLM),
    plmAsymptote: n0(recip?.PLMasym),
    errV: nOrNull(recip?.errV),
  };
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof PRESSIOMETRE_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(PRESSIOMETRE_ENGINE_ID);
  if (!entry) {
    throw new Error(
      `Moteur "${PRESSIOMETRE_ENGINE_ID}" absent du registre des versions.`,
    );
  }
  return {
    engineId: PRESSIOMETRE_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul pressiometre client-safe : valide l'entree, recalcule cote serveur,
 * projette la sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 * @returns enveloppe de succes (le moteur encode lui-meme une eventuelle erreur
 *   de calcul / donnees insuffisantes dans `output.erreur` ; une exception
 *   inattendue remonte a l'appelant qui la mappe en SafeEngineError).
 */
export function runPressiometre(
  rawInput: unknown,
): EngineResultEnvelope<PressiometreOutput> {
  const input: PressiometreInput = PressiometreInputSchema.parse(rawInput);
  const rawResult = computePressiometre(input) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(PressiometreOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void pressiometreContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
