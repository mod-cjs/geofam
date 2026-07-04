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
const CONFIDENTIAL_WARNING_LABELS: readonly RegExp[] = [
  // Decomposition de la contrainte au repos (formes HTML balisees et brutes).
  /σ_?h0/g,
  /σ_?v0/g,
  /σ'_?v0/g,
  /σ<sub>h0<\/sub>/g,
  /σ<sub>v0<\/sub>/g,
  /\bsigH0\b/g,
  /\bsigV0\b/g,
  /\bu0\b/g,
  // Pressions/volumes de calage bruts de la plage pseudo-elastique.
  /\bpE\b/g,
  /\bp0\b/g,
  /\bPf\b/g,
  /\bVE\b/g,
  /\bV0c\b/g,
  /\bVf\b/g,
  /\bpS\b/g,
  // Analyse de pente de la plage pseudo-elastique (§D.5.1).
  /\bmE\b/g,
  /\bbeta\b/g,
  /β/g,
  // --- ETIQUETTES REELLEMENT EMISES par les 2 console.warn du moteur (MINEUR-4/1) ---
  // Warn « a trop grand » : `a=<n> trop grand (a×Pmax=<n> > 0.5×V60_moy=<n>) ...`
  // (le piege \b : `\ba\b` matche le `a=` initial ; `a×Pmax`/`V60_moy` ne sont pas
  //  bornables par \b a droite — on les cible litteralement.)
  /\ba\b/g,
  /a×Pmax/g,
  /\bPmax\b/g,
  /0\.5×V60_moy/g,
  /\bV60_moy\b/g,
  // Warn « EM=0 » : `calcDepth: _dV=<n> _dP=<n> ... Vérifiez p0I=<n> pfI=<n>`
  // (indices internes de seuils — `\bp0\b`/`\bpfI?\b` NE matchent PAS `p0I`/`pfI` :
  //  on cible les formes EXACTES emises.)
  /_dV/g,
  /_dP/g,
  /\bp0I\b/g,
  /\bpfI\b/g,
];

/**
 * Redacte la VALEUR confidentielle accolee a une etiquette confidentielle dans
 * un texte. Remplace `<label> = <nombre> [unite]` par `<label> (valeur
 * confidentielle masquee)`. Fail-closed. Ne touche QUE la valeur LIEE a
 * l'etiquette : les autres nombres (profondeurs en m, classes, seuils) sont
 * preserves.
 */
export function redactConfidentialWarning(text: string): string {
  let out = text;
  for (const label of CONFIDENTIAL_WARNING_LABELS) {
    const src = label.source;
    const valued = new RegExp(
      `(${src})\\s*=\\s*-?[0-9][0-9.,\\u202f\\s]*(?:MPa|kPa|bar|cm³|cm3|cm|m)?`,
      'g',
    );
    out = out.replace(valued, '$1 (valeur confidentielle masquee)');
  }
  return out;
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
      pLDirect: false,
      categorie: '',
      categorieLibelle: '',
      consolidation: '',
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
    // pL_direct est null si la pL a ete extrapolee (§D.4.3) ; non-null = mesure directe.
    pLDirect: R.pL_direct !== null && R.pL_direct !== undefined,
    categorie: typeof R.cat === 'string' ? R.cat : '',
    categorieLibelle: typeof R.catName === 'string' ? R.catName : '',
    consolidation: typeof R.consol === 'string' ? R.consol : '',
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
