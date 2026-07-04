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
  sanitizeFamille,
  type BurmisterInput,
  type BurmisterOutput,
} from './contract.js';
import { computeBurmister } from './engine.js';

export {
  BURMISTER_ENGINE_ID,
  BurmisterInputSchema,
  BurmisterOutputSchema,
  burmisterContract,
  sanitizeFamille,
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
 * --- CANAL WARNINGS : ALLOWLIST fail-closed (FUITE #2 / issue #82, DoD §8) ---
 *
 * L'ancienne barriere sur `warnings` etait une BLACKLIST fail-OPEN : elle masquait
 * la VALEUR (`kc=1.3` → masque) mais LAISSAIT passer l'etiquette `kc` ET le texte
 * `(§ confidentiel)` (section d'un doc PRIVE STARFIRE). Structurellement
 * insuffisante : tout intermediaire NON liste, toute reference de section privee
 * fuyait. On inverse en ALLOWLIST : on n'expose au client QUE des warnings
 * RECONNUS (ensemble FERME de messages cures) — jamais un texte moteur libre. Un
 * warning non reconnu est ECARTE (voir `curateWarnings`).
 *
 * ETAT REEL DU MOTEUR (honnetete) : `computeBurmister` ne pose AUCUN warning en
 * fonctionnement normal (l'objet `_D` n'a pas de champ `warn`) ; l'ensemble cure
 * (`WARNINGS_CURES`) est donc VIDE a ce jour → tout warning est ECARTE. Toute
 * evolution du moteur qui emettrait un warning DEVRA y ajouter le message CURE
 * exact (texte fige, sans intermediaire), sinon il n'atteindra pas le client.
 *
 * --- CANAL ERREUR : redaction (defense en profondeur, inchangee) ---
 * Le message d'erreur (`_D.err` = `e.message` d'une exception, parite HTML) reste
 * un texte libre destine a etre lu. On lui applique la redaction ci-dessous
 * (retrait de `<etiquette confidentielle> = <valeur>`) — barriere dormante
 * (le moteur ne pose pas de valeur de ce type dans `err`), conservee par parite
 * avec les 6 moteurs. Le passage de ce canal a un code d'erreur ferme
 * (SafeEngineError) est un SUIVI hors de #82.
 *
 * ETIQUETTES d'INTERMEDIAIRES CONFIDENTIELS (canal erreur) :
 *   - contraintes brutes du tenseur : σ_z, σ_r, σ_θ (sz/sr/sth/srT/sthT) ;
 *   - deformations sollicitantes intermediaires (et0/etM) — distinctes des
 *     ε_t/ε_z FINALS exposes ;
 *   - coefficients de CALAGE des lois de fatigue : kr, ks, kc, kθ (kth), Sh, ε₆/σ₆ ;
 *   - module pondere du paquet lie E₁ (E1) — intermediaire de structure.
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

/** Applique la redaction a TOUS les messages (canal erreur — defense en profondeur). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

/**
 * ALLOWLIST des warnings RECONNUS (messages cures, texte fige sans intermediaire).
 * FERMEE et VIDE a ce jour : le moteur burmister n'emet aucun warning en
 * fonctionnement normal. Ajouter une entree = decision de CURATION tracee (le
 * message doit etre un texte STATIQUE, sans valeur d'intermediaire de methode).
 */
const WARNINGS_CURES: ReadonlySet<string> = new Set<string>([
  // (aucun message cure a ce jour — cf. en-tete : `_D` n'a pas de champ `warn`)
]);

/**
 * FAIL-CLOSED par ALLOWLIST : ne laisse traverser au client QUE les warnings
 * EXACTEMENT reconnus (`cures`). Tout texte moteur libre non reconnu (etiquette
 * `kc`, reference `(§ confidentiel)`, intermediaire arbitraire `foo=2.5`...) est
 * ECARTE — jamais redacte-mais-expose. `cures` est parametre (defaut
 * `WARNINGS_CURES`) UNIQUEMENT pour permettre a un test de prouver le mecanisme de
 * lookup (reconnu → garde, inconnu → ecarte), pas pour un usage en production.
 */
export function curateWarnings(
  warnings: readonly string[],
  cures: ReadonlySet<string> = WARNINGS_CURES,
): string[] {
  const out: string[] = [];
  for (const w of warnings) {
    if (typeof w === 'string' && cures.has(w)) out.push(w);
    // sinon : ECARTE (fail-closed) — aucun texte moteur libre non reconnu ne sort.
  }
  return out;
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

  // Canal WARNINGS : ALLOWLIST fail-closed — seuls les messages cures reconnus
  // traversent ; tout texte moteur libre non reconnu est ECARTE (FUITE #2 / #82).
  const warnings = curateWarnings(
    Array.isArray(D.warn) ? D.warn.filter((w): w is string => typeof w === 'string') : [],
  );

  const out: Record<string, unknown> = {
    erreur: null,
    warnings,
    conforme: D.PASS === true,
    NE: fin(D.NE) ? D.NE : 0,
    // Libelle de famille NETTOYE en allowlist NU (sans discriminant Kmix) — FUITE #1.
    famille: sanitizeFamille(D.fam),
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

  // --- DETAILS DE CALCUL — intermediaires de METHODE PUBLICS (rescope §8) ---
  // Grandeurs calculees de la methode Burmister/LCPC. On n'y met JAMAIS de
  // coefficient de calage (e6/kr/ks/kc/sh/ukth) : ceux-ci restent serveur.
  {
    const kpa = (v: unknown): number | null => (fin(v) ? v * 1000 : null); // MPa -> kPa
    const mdef = (v: unknown): number | null => (fin(v) ? v : null);
    const s0 = (D.s0 ?? {}) as Record<string, unknown>;
    const sd2 = (D.sd2 ?? {}) as Record<string, unknown>;
    out.details = {
      E1_pond: fin(D.E1) ? D.E1 : 0,
      nu1_pond: fin(D.nu1) ? D.nu1 : 0,
      E_psc: fin(D.Eref) ? D.Eref : 0,
      nu_psc: fin(D.nuRef) ? D.nuRef : 0,
      risque_pct: fin(D.rEff) ? D.rEff : 0,
      sigmaZ_r0: kpa(s0.sz),
      sigmaR_r0: kpa(s0.sr),
      sigmaZ_d2: kpa(sd2.sz),
      sigmaR_d2: kpa(sd2.sr),
      epsilonT_r0: mdef(D.et0),
      epsilonT_d2: mdef(D.etM),
      epsilonT: mdef(D.et),
      epsilonT_adm: mdef(D.etA),
      epsilonZ_axe: mdef(D.ez0),
      epsilonZ_mid: mdef(D.ezM),
      epsilonZ: fin(D.ez) ? D.ez : 0,
      epsilonZ_adm: fin(D.ezA) ? D.ezA : 0,
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
