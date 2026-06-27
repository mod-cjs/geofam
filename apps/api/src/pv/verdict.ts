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
export function resolveVerdict(engineId: string, output: unknown): PvVerdict {
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
