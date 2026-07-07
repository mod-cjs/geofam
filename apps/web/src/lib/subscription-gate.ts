/**
 * Prédicats purs de gating entitlement/quota/expiration côté tenant (galerie
 * logiciels + pages logiciel). Aucune logique de calcul, aucun import moteur —
 * uniquement l'interprétation de EntitlementsResponse (cf. lib/api/types.ts).
 *
 * DoD §9 : exporté et testé en isolation ; si on casse une condition ici, la
 * page (qui l'utilise) ET le test doivent virer rouge ensemble.
 */

import type { EntitlementsResponse } from './api/types';

export type GateReason = 'NOT_INCLUDED' | 'EXPIRED' | 'QUOTA_EXHAUSTED';

export interface GateStatus {
  /** true si le module peut être utilisé (inclus, abo actif, quota restant). */
  allowed: boolean;
  /** Raisons de blocage, dans l'ordre de gravité (expiration priorité sur quota). */
  reasons: GateReason[];
  /** Message court prêt à afficher, ou null si allowed. */
  message: string | null;
}

const MESSAGES: Record<GateReason, string> = {
  NOT_INCLUDED: "Module non inclus dans votre abonnement.",
  EXPIRED: 'Abonnement expiré — calcul impossible.',
  QUOTA_EXHAUSTED: 'Quota de calculs épuisé.',
};

/**
 * Évalue l'accès à un module (engineId = slug de gate) à partir de la réponse
 * d'entitlements. Fail-closed : sans entitlements (null = pas encore chargé /
 * erreur réseau), le module est considéré NON inclus — jamais de fail-open.
 */
export function evaluateGate(
  ent: EntitlementsResponse | null,
  engineId: string,
): GateStatus {
  if (!ent) {
    return { allowed: false, reasons: ['NOT_INCLUDED'], message: MESSAGES.NOT_INCLUDED };
  }

  const reasons: GateReason[] = [];
  if (!ent.modules.includes(engineId)) reasons.push('NOT_INCLUDED');
  if (ent.expired) reasons.push('EXPIRED');
  if (ent.quota.remaining <= 0) reasons.push('QUOTA_EXHAUSTED');

  if (reasons.length === 0) {
    return { allowed: true, reasons: [], message: null };
  }
  // Priorité d'affichage : expiration > quota > non inclus (l'expiration bloque tout,
  // même un module par ailleurs inclus).
  const ordered: GateReason[] = ['EXPIRED', 'QUOTA_EXHAUSTED', 'NOT_INCLUDED'].filter((r) =>
    reasons.includes(r as GateReason),
  ) as GateReason[];
  return { allowed: false, reasons: ordered, message: MESSAGES[ordered[0]] };
}

/** true si le quota restant est sous le seuil d'alerte (par défaut 10 %). */
export function isQuotaLow(
  ent: Pick<EntitlementsResponse, 'quota'>,
  thresholdPct = 10,
): boolean {
  if (ent.quota.limit <= 0) return false;
  return (ent.quota.remaining / ent.quota.limit) * 100 < thresholdPct;
}
