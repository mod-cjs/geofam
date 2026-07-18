/**
 * Protocole bridge iframe ↔ hôte — v1 (ADR 0015 §Protocole bridge).
 *
 * Enveloppe commune `{ v: 1, type, id?, payload? }` échangée par postMessage
 * entre le clone d'outil (chargé en iframe sandboxée, origine opaque) et le
 * shell GEOFAM (hôte React, `ToolFrame`).
 *
 * Handshake origine opaque : la vérification d'authenticité porte sur
 * `event.source` (jamais sur `event.origin`, qui vaut `null` en sandbox sans
 * `allow-same-origin`) — voir ADR 0015.
 *
 * Confidentialité DoD §8 : ce fichier ne décrit que la FORME des messages —
 * aucun calcul, aucun symbole moteur. Le payload `calc:request/response` ne
 * transporte que des entrées bornées / sorties déjà whitelistées côté serveur.
 */

export const TOOL_BRIDGE_PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Payloads par type de message
// ---------------------------------------------------------------------------

/** iframe→hôte, émis au chargement de l'outil cloné. */
export interface ReadyPayload {
  toolId: string;
}

/** hôte→iframe, réponse au `ready` — contexte projet, JAMAIS de token/JWT. */
export interface InitPayload {
  engineId: string;
  orgSlug: string;
  projectLabel: string;
  readOnly?: boolean;
}

/** iframe→hôte — demande de calcul (corrélée par `id`). */
export interface CalcRequestPayload {
  engineId: string;
  label: string;
  params: Record<string, unknown>;
}

/** Erreur métier transmise par le serveur (402 EXPIRED/QUOTA, 403 MODULE_NOT_IN_PACK…). */
export interface CalcResponseError {
  statusCode: number;
  reason: string;
  message: string;
}

/** hôte→iframe — résultat du calcul serveur (whitelisté, forme PersistedCalcResult). */
export interface CalcResponsePayload {
  ok: boolean;
  calcResultId?: string;
  output?: unknown;
  meta?: Record<string, unknown>;
  error?: CalcResponseError;
}

/** iframe→hôte — lecture d'une clé de stockage namespacée. */
export interface StoreGetPayload {
  key: string;
}

/** iframe→hôte — écriture d'une clé de stockage namespacée. */
export interface StoreSetPayload {
  key: string;
  value?: unknown;
}

/** hôte→iframe — valeur de stockage (réponse à `store:get` ou `store:set`). */
export interface StoreValuePayload {
  key: string;
  value: unknown;
}

/** iframe→hôte — demande d'émission de PV pour un calcul déjà exécuté. */
export interface PvRequestPayload {
  calcResultId: string;
}

/**
 * iframe→hôte — signale qu'une saisie ou un changement d'onglet/mode vient
 * de se produire dans le clone (audit adverse #9, BQ-1 : un calcul scellé
 * doit toujours correspondre à ce que l'ingénieur voit à l'écran).
 *
 * CONTRAT que le clone (généré par `scripts/clone-tool.mjs`, hors périmètre
 * de ce fichier) doit respecter :
 *  - Émettre `input:dirty` dès qu'un handler oninput/onchange existant du
 *    clone se déclenche sur un champ de saisie, OU dès qu'un changement
 *    d'onglet/mode interne survient (ex. les onglets GEOPLAQUE) — sur
 *    TOUT changement, sans essayer de savoir si un calcul a déjà eu lieu
 *    (l'hôte est idempotent : recevoir `input:dirty` sans calcul en cours
 *    est un no-op sans effet).
 *  - Émission immédiate, NON débouncée (à la différence de `calc:request`
 *    qui peut être débouncé ~300 ms côté clone, cf. FASTLAB) : le bouton
 *    « Émettre le PV » doit se désactiver dès le premier caractère tapé,
 *    pas seulement après le débounce du recalcul.
 *  - `payload.toolId` = même valeur que celle envoyée dans `ready`.
 */
export interface InputDirtyPayload {
  toolId: string;
}

/** Les deux sens — erreur de PROTOCOLE (pas une erreur métier de calcul). */
export interface ErrorPayload {
  message: string;
}

// ---------------------------------------------------------------------------
// Enveloppe générique + union discriminée par `type`
// ---------------------------------------------------------------------------

interface Envelope<Type extends string, Payload> {
  v: 1;
  type: Type;
  /** Corrèle une requête à sa réponse (ex. calc:request ↔ calc:response). */
  id?: string;
  payload?: Payload;
}

export type ReadyMessage = Envelope<'ready', ReadyPayload>;
export type InitMessage = Envelope<'init', InitPayload>;
export type CalcRequestMessage = Envelope<'calc:request', CalcRequestPayload>;
export type CalcResponseMessage = Envelope<'calc:response', CalcResponsePayload>;
export type StoreGetMessage = Envelope<'store:get', StoreGetPayload>;
export type StoreSetMessage = Envelope<'store:set', StoreSetPayload>;
export type StoreValueMessage = Envelope<'store:value', StoreValuePayload>;
export type PvRequestMessage = Envelope<'pv:request', PvRequestPayload>;
export type InputDirtyMessage = Envelope<'input:dirty', InputDirtyPayload>;
export type ProtocolErrorMessage = Envelope<'error', ErrorPayload>;

export type ToolBridgeMessage =
  | ReadyMessage
  | InitMessage
  | CalcRequestMessage
  | CalcResponseMessage
  | StoreGetMessage
  | StoreSetMessage
  | StoreValueMessage
  | PvRequestMessage
  | InputDirtyMessage
  | ProtocolErrorMessage;

const KNOWN_TYPES: ReadonlySet<ToolBridgeMessage['type']> = new Set([
  'ready',
  'init',
  'calc:request',
  'calc:response',
  'store:get',
  'store:set',
  'store:value',
  'pv:request',
  'input:dirty',
  'error',
]);

/**
 * Garde de type — valide la FORME de l'enveloppe reçue par postMessage.
 * `event.data` est untrusted par construction (message cross-frame) : on ne
 * fait jamais confiance à sa forme avant de l'avoir vérifiée ici.
 */
export function isToolBridgeMessage(data: unknown): data is ToolBridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.v !== TOOL_BRIDGE_PROTOCOL_VERSION) return false;
  if (
    typeof d.type !== 'string' ||
    !KNOWN_TYPES.has(d.type as ToolBridgeMessage['type'])
  ) {
    return false;
  }
  if (d.id !== undefined && typeof d.id !== 'string') return false;
  return true;
}

/**
 * Espace de noms de la clé localStorage parent pour `store:get`/`store:set`.
 *
 * Repli `_noproject` (correction UX/fidélité 17/07) : l'outil s'affiche
 * désormais AVANT toute sélection de projet (`projectId: null`) — la
 * saisie/les brouillons de cette phase ne doivent pas être perdus le temps
 * que l'utilisateur choisisse un projet. On les range donc sous un segment
 * de repli FIXE, scopé à l'org (jamais cross-tenant) mais PAS au projet —
 * `_noproject` ne peut pas collisionner avec un vrai `projectId` (identifiants
 * serveur, jamais cette chaîne littérale). Ce repli couvre uniquement le
 * stockage : le calcul (`calc:request`) et l'émission de PV (`pv:request`),
 * eux, restent bloqués tant qu'aucun projet réel n'est sélectionné (cf.
 * `ToolFrame.tsx`).
 */
export function toolStoreKey(
  orgId: string,
  projectId: string | null,
  toolId: string,
  key: string,
): string {
  const projectSegment = projectId ?? '_noproject';
  return `tool-store:${orgId}:${projectSegment}:${toolId}:${key}`;
}
