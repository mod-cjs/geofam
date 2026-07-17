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

/** Espace de noms de la clé localStorage parent pour `store:get`/`store:set`. */
export function toolStoreKey(
  orgId: string,
  projectId: string,
  toolId: string,
  key: string,
): string {
  return `tool-store:${orgId}:${projectId}:${toolId}:${key}`;
}
