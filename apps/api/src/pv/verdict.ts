/**
 * Resolution du VERDICT scelle dans le PV (ADR 0012).
 *
 * Le verdict est un CHAMP DE PREMIER NIVEAU, dans le perimetre du sceau HMAC :
 * on ne peut alterer le statut sans casser le sceau. **Aucun PV sans verdict
 * explicite (fail-closed).** Le verdict atteste le RESULTAT de verification du
 * calcul (y compris NON CONFORME : un PV documente un resultat, il ne valide pas
 * l'ouvrage — cf. ADR 0012 §3).
 *
 * HONNETETE D'INGENIEUR — le verdict n'est PAS uniforme entre moteurs :
 *  - moteurs de DIMENSIONNEMENT a verdict global booleen : burmister (`conforme`)
 *    et pieux (`allOk`) -> CONFORME / NON_CONFORME.
 *  - moteurs SANS verdict global de conformite (extraction de parametres,
 *    classification GTR, verifications multi-cas sans booleen unique) : terzaghi,
 *    radier, pressiometre, labo -> NON_APPLICABLE. Ce n'est PAS un trou
 *    fail-open : NON_APPLICABLE est un verdict EXPLICITE, present et SCELLE comme
 *    les autres (le champ existe toujours). Forcer un PASS/FAIL artificiel sur un
 *    moteur qui n'en produit pas serait MENTIR sur le resultat.
 *
 * FAIL-CLOSED : si un moteur a verdict booleen attendu (burmister/pieux) ne
 * porte PAS son drapeau (sortie malformee), on LEVE -> pas de PV (on refuse de
 * sceller un verdict indetermine). C'est le sens du « aucun PV sans verdict ».
 *
 * On lit `engineId` = id de REGISTRE scelle (registryId, cf. engine-dispatch),
 * pas le slug d'URL : c'est la cle stable et c'est ce qui est scelle.
 */
export type PvVerdict = 'CONFORME' | 'NON_CONFORME' | 'NON_APPLICABLE';

/** Erreur fail-closed : verdict attendu mais indeterminable (sortie malformee). */
export class VerdictIndeterminableError extends Error {
  constructor(engineId: string) {
    super(`Verdict indeterminable pour le moteur « ${engineId} ».`);
    this.name = 'VerdictIndeterminableError';
  }
}

/**
 * Moteurs a verdict global booleen : engineId (registryId) -> nom du champ
 * booleen de conformite dans `output`. Tout autre moteur -> NON_APPLICABLE.
 */
const BOOLEAN_VERDICT_FIELD: Readonly<Record<string, string>> = {
  'chaussee-burmister': 'conforme',
  'fondation-profonde-pieux': 'allOk',
};

/**
 * Resout le verdict a sceller a partir de l'engineId (registry) et de la sortie
 * PROJETEE/whitelistee (la meme qui sera scellee).
 *
 * @throws VerdictIndeterminableError si un moteur a verdict booleen attendu ne
 *         porte pas un booleen exploitable (fail-closed : pas de PV sans verdict).
 */
/**
 * Moteurs a verdict AGREGE PAR CAS (verifications multi-etats-limites) : le verdict
 * global est CONFORME si TOUS les cas valides passent la portance (et le glissement
 * quand il est evalue), sinon NON_CONFORME. Conclusion de conformite standard
 * (NF P 94-261 / EC7 : une fondation est conforme si toutes ses verifications
 * ELU/ELS passent). Decision titulaire (01/07/2026) : terzaghi porte un verdict
 * global (front + PV coherents) au lieu de NON_APPLICABLE.
 */
const CASES_VERDICT_ENGINES: ReadonlySet<string> = new Set([
  'fondation-superficielle',
  // Defense en profondeur (revue closeout) : le slug d'URL 'terzaghi' en plus du registryId
  // canonique. En prod le backend scelle le registryId (engine-dispatch), mais si un chemin
  // scellait le slug, on eviterait une divergence web (duck-type sur cas[]) <-> PV (NON_APPLICABLE).
  'terzaghi',
]);

export function resolveVerdict(engineId: string, output: unknown): PvVerdict {
  if (CASES_VERDICT_ENGINES.has(engineId)) {
    return resolveCasesVerdict(engineId, output);
  }
  const field = BOOLEAN_VERDICT_FIELD[engineId];
  if (field === undefined) {
    // Moteur sans verdict global de conformite : NON_APPLICABLE (explicite, scelle).
    return 'NON_APPLICABLE';
  }
  // Moteur a verdict booleen : le champ DOIT etre un booleen (fail-closed sinon).
  if (
    typeof output !== 'object' ||
    output === null ||
    !(field in (output as Record<string, unknown>))
  ) {
    throw new VerdictIndeterminableError(engineId);
  }
  const value = (output as Record<string, unknown>)[field];
  if (typeof value !== 'boolean') {
    throw new VerdictIndeterminableError(engineId);
  }
  return value ? 'CONFORME' : 'NON_CONFORME';
}

/**
 * Verdict agrege par cas (terzaghi). FAIL-CLOSED : si `cas` absent, vide, ou un cas
 * valide ne porte pas un `portanceOk` booleen exploitable, on LEVE (pas de PV sans
 * verdict determine). CONFORME ssi tous les cas valides passent portance, glissement
 * (quand evalue) ET excentrement (quand requis) ; sinon NON_CONFORME.
 */
function resolveCasesVerdict(engineId: string, output: unknown): PvVerdict {
  if (typeof output !== 'object' || output === null) {
    throw new VerdictIndeterminableError(engineId);
  }
  const cas = (output as Record<string, unknown>).cas;
  if (!Array.isArray(cas)) {
    throw new VerdictIndeterminableError(engineId);
  }
  const valid = cas.filter(
    (c): c is Record<string, unknown> =>
      c !== null &&
      typeof c === 'object' &&
      (c as Record<string, unknown>).invalide !== true,
  );
  if (valid.length === 0) {
    throw new VerdictIndeterminableError(engineId);
  }
  for (const c of valid) {
    if (typeof c.portanceOk !== 'boolean') {
      throw new VerdictIndeterminableError(engineId);
    }
  }
  // MAJEUR-1 : l'excentrement (tab. 5.5) pese dans le verdict scelle. `excOk === false`
  // (excentrement non verifie) -> NON_CONFORME ; `excOk` absent = non requis (ELU
  // accidentel) -> n'echoue pas. Sans cette clause, un PV scellait CONFORME sur un cas
  // excentre non verifie (faux PASS scelle).
  const allOk = valid.every(
    (c) =>
      c.portanceOk === true &&
      (c.glissementOk === undefined || c.glissementOk === true) &&
      (c.excOk === undefined || c.excOk === true),
  );
  return allOk ? 'CONFORME' : 'NON_CONFORME';
}
