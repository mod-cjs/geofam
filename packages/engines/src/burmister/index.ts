/**
 * Module burmister (chaussees, AGEROUTE Senegal 2015) — point d'entree PUR &
 * client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeBurmister) -> PROJECTION du
 * resultat brut `_D` sur la sortie whitelistee (contract.ts) -> enveloppe de
 * resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard : deterministe.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les
 * TYPES du contrat via @roadsen/shared, jamais ce module (garde-fou ESLint +
 * controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#46) ---
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
  BURMISTER_ENGINE_ID,
  BurmisterInputSchema,
  BurmisterOutputSchema,
  burmisterContract,
  type BurmisterInput,
  type BurmisterOutput,
} from './contract.js';
import { computeBurmister } from './engine.js';

export {
  BURMISTER_ENGINE_ID,
  BurmisterInputSchema,
  BurmisterOutputSchema,
  burmisterContract,
  type BurmisterInput,
  type BurmisterOutput,
};
export { BURMISTER_CONFIDENTIAL_MARKER, AGEROUTE_MATERIALS } from './engine.js';
// Jeux d'ENTREES canoniques (donnees pures, sans science ni sortie figee) :
// reutilises par l'equivalence-portage ET l'e2e API (meme entree des deux cotes).
export { BURMISTER_FIXTURES, type BurmisterFixture } from './test-fixtures.js';

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
 * La whitelist de sortie protege les CLES structurees (un champ `sz`/`kr`/`et0`
 * ne peut pas etre expose). Mais un TEXTE LIBRE pourrait interpoler la VALEUR
 * d'un intermediaire confidentiel propre a burmister :
 *   - contraintes brutes du tenseur : σ_z, σ_r, σ_θ (sz/sr/sth/srT/sthT) ;
 *   - deformations sollicitantes intermediaires aux positions r=0 / r=d/2
 *     (et0/etM) — distinctes des ε_t/ε_z FINALS exposes ;
 *   - coefficients de CALAGE des lois de fatigue : kr, ks, kc, kθ (kth), Sh, ε₆/σ₆ ;
 *   - module pondere du paquet lie E₁ (E1) — intermediaire de structure.
 *
 * --- La regle ---
 * On NE TOUCHE PAS au moteur (science figee). On REDACTE a la PROJECTION : on
 * retire la VALEUR confidentielle (`= <nombre> [unite]`) accolee a une etiquette
 * confidentielle, en gardant le SENS. Aujourd'hui le moteur ne produit qu'un
 * `err` (sur exception) sans valeur de ce type ; la redaction est donc une
 * defense en profondeur fail-closed (parite avec le patron des 6 moteurs), pas
 * un correctif d'une fuite avere ici.
 *
 * Le SEUIL/la classe normative (ex. « < 0,15 m », « NE < 3·10⁶ ») n'est PAS un
 * intermediaire calcule : on ne le vise pas (pas d'etiquette confidentielle a sa
 * gauche).
 */
const CONFIDENTIAL_WARNING_LABELS: readonly RegExp[] = [
  // Contraintes brutes du tenseur (formes HTML balisees et brutes).
  /σ_?z/g,
  /σ_?r/g,
  /σ_?θ/g,
  /σ<sub>[zrθ]<\/sub>/g,
  // Coefficients de calage de fatigue.
  /\bkr\b/g,
  /\bks\b/g,
  /\bkc\b/g,
  /kθ/g,
  /\bkth\b/g,
  /\bSh\b/g,
  /ε₆/g,
  /σ₆/g,
  // Deformations sollicitantes intermediaires par position (et0/etM) — DISTINCTES
  // des ε_t/ε_z FINALS exposes : on masque la valeur si elle est interpolee dans
  // un texte. On vise les formes HTML (ε_t(r=0)) et brutes (et0/etM).
  /ε_?t\s*\(\s*r\s*=\s*0\s*\)/g,
  /ε_?t\s*\(\s*r\s*=\s*d\/2\s*\)/g,
  /\bet0\b/g,
  /\betM\b/g,
  // Module pondere du paquet lie E₁ (E1) — intermediaire de structure, distinct
  // des epaisseurs/classes affichables.
  /E₁/g,
  /\bE1\b/g,
];

/**
 * Redacte la VALEUR confidentielle accolee a une etiquette confidentielle dans
 * un texte. Remplace `<label> = <nombre> [unite]` par `<label> (valeur
 * confidentielle masquee)`. Fail-closed. Ne touche QUE la valeur LIEE a
 * l'etiquette : les autres nombres (epaisseurs en cm/m, classes, NE) sont
 * preserves.
 */
export function redactConfidentialWarning(text: string): string {
  let out = text;
  for (const label of CONFIDENTIAL_WARNING_LABELS) {
    const src = label.source;
    const valued = new RegExp(
      `(${src})\\s*=\\s*-?[0-9][0-9.,\\u202f\\s]*(?:MPa|kPa|μdef|µdef|cm|m)?`,
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

/**
 * Re-FORME le resultat brut `_D` du moteur en la SORTIE whitelistee. On CONSTRUIT
 * un objet propre champ a champ (jamais de copie brute) : seuls les champs de
 * RESULTAT destines a l'affichage/PV sont repris. Tout intermediaire (contraintes
 * sz/sr/sth, coefficients kr/ks/kc/sh, et0/etM, bz, ezL, rigL, lys...) est ECARTE
 * ici, puis re-strippe par projectEngineOutput (defense en profondeur).
 */
function shapeOutput(D: Record<string, unknown>): unknown {
  // Cas d'erreur de calcul (science levee) : on n'expose que le message redacte.
  if (typeof D.err === 'string') {
    return {
      erreur: redactConfidentialWarning(D.err),
      warnings: [],
      conforme: false,
      NE: 0,
      famille: '',
      epaisseurLiee: 0,
      epaisseurTotale: 0,
      ornierage: { valeur: 0, admissible: 0, ok: false },
    };
  }

  const warnings = redactConfidentialWarnings(
    Array.isArray(D.warn) ? D.warn.filter((w): w is string => typeof w === 'string') : [],
  );

  const out: Record<string, unknown> = {
    erreur: null,
    warnings,
    conforme: D.PASS === true,
    NE: fin(D.NE) ? D.NE : 0,
    famille: typeof D.fam === 'string' ? D.fam : '',
    epaisseurLiee: fin(D.H_bit) ? D.H_bit : 0,
    epaisseurTotale: fin(D.H_tot) ? D.H_tot : 0,
    ornierage: {
      valeur: fin(D.ez) ? D.ez : 0,
      admissible: fin(D.ezA) ? D.ezA : 0,
      ok: D.passZ === true,
    },
  };

  // --- Critere de fatigue (couche liee), si une couche liee existe ---
  // On expose la valeur sollicitante et l'admissible FINALES + verdict. Les
  // contraintes brutes (s0/sd2/bz) et coefficients (kr/ks/kc/sh/e6) restent serveur.
  if (D.hasBit === true) {
    const et = D.et;
    const etA = D.etA;
    out.fatigue = {
      rigide: D.sig === 1 || D.sig === true,
      valeur: fin(et) ? et : null,
      admissible: fin(etA) ? etA : null,
      ok: D.passT === true,
      requis: D.etReq === true,
    };
  }

  return out;
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof BURMISTER_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(BURMISTER_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${BURMISTER_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: BURMISTER_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul burmister client-safe : valide l'entree, recalcule cote serveur, projette
 * la sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 * @returns enveloppe de succes (le moteur encode lui-meme une eventuelle erreur
 *   de calcul dans `output.erreur` ; une exception inattendue remonte a
 *   l'appelant qui la mappe en SafeEngineError).
 */
export function runBurmister(rawInput: unknown): EngineResultEnvelope<BurmisterOutput> {
  const input: BurmisterInput = BurmisterInputSchema.parse(rawInput);
  const rawResult = computeBurmister(input) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  // Re-strip a travers le schema declare : tout champ non whiteliste qui aurait
  // survecu a shapeOutput est retire ici (defense en profondeur, anti-fuite).
  const output = projectEngineOutput(BurmisterOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void burmisterContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
