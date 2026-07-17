'use client';

/**
 * ToolFrame — hôte React d'un clone d'outil client (ADR 0015).
 *
 * Charge le HTML du clone via le route handler authentifié
 * (`GET /api/tools/:toolId`), l'injecte en `<iframe srcdoc sandbox>` SANS
 * `allow-same-origin` (origine opaque : l'iframe n'a accès ni aux cookies, ni
 * au JWT, ni au DOM parent), puis tient la boucle postMessage du protocole v1
 * (`./protocol.ts`).
 *
 * Confidentialité DoD §8 : le calcul reste 100 % serveur. Ce composant ne fait
 * que PROXIFIER `calc:request` vers `runCalc` (@/lib/api/client) — aucun
 * import @roadsen/engines, aucune formule, aucun coefficient.
 *
 * Sécurité :
 *  - Le JWT ne PÉNÈTRE JAMAIS l'iframe (ni dans `init`, ni ailleurs).
 *  - `targetOrigin: '*'` sur postMessage est acceptable UNIQUEMENT parce que
 *    la sandbox sans `allow-same-origin` donne à l'iframe une origine opaque
 *    (`null`) : on ne peut pas cibler par origine, donc on valide côté RÉCEPTION
 *    en comparant `event.source` à la fenêtre attendue (contentWindow côté
 *    hôte, `window.parent` côté iframe) — jamais `event.origin`.
 *
 * Multi-engine (GEOPLAQUE, ADR 0015) : un clone peut émettre `calc:request`
 * avec un `engineId` DIFFÉRENT par mode interne (ex. radier / plane-strain /
 * axi / tri-raft — tous groupés sous le MÊME gate d'abonnement, cf.
 * `software-catalog.ts`). Par défaut (rétrocompatible, `engineAllowlist`
 * absent), l'`engineId` FACTURABLE reste TOUJOURS celui configuré par l'hôte
 * (prop `engineId`) — celui déclaré par l'iframe est ignoré (frontière de
 * confiance inchangée, terzaghi/roadsens). Si `engineAllowlist` est fourni,
 * un `calc:request.engineId` membre de la liste est accepté TEL QUEL ; un
 * `engineId` hors liste est REJETÉ (`calc:response.error`), jamais transmis à
 * `runCalc`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isToolBridgeMessage,
  toolStoreKey,
  TOOL_BRIDGE_PROTOCOL_VERSION,
  type CalcResponsePayload,
  type ToolBridgeMessage,
} from './protocol';

import { emitPv, runCalc } from '@/lib/api/client';

export interface ToolFrameProps {
  /** Identifiant de route du clone (ex. 'terzaghi') — sert au fetch + au namespace store. */
  toolId: string;
  /** engineId de calcul attendu (généralement = toolId, cf. software-catalog.ts). */
  engineId: string;
  /**
   * Liste fermée des engineId qu'un `calc:request` de CE clone peut déclarer
   * TEL QUEL (multi-engine, ex. GEOPLAQUE : radier/plane-strain/axi/tri-raft).
   * Absente = comportement historique (l'engineId de l'hôte prime toujours,
   * celui de l'iframe est ignoré). Présente = accepte un membre de la liste,
   * REJETTE (calc:response.error) tout engineId hors liste sans appeler l'API.
   */
  engineAllowlist?: string[];
  orgId: string | null;
  orgSlug: string;
  /**
   * Correction UX/fidélité (17/07) : l'outil s'affiche désormais AVANT toute
   * sélection de projet (fidélité UI — le placeholder du shell a disparu,
   * cf. les 5 pages logiciels). `null` = aucun projet choisi. Le CHARGEMENT
   * du clone (fetch `/api/tools/:toolId`) ne dépend que d'`orgId` ; seuls le
   * calcul (`calc:request`) et l'émission de PV (`pv:request`) restent
   * bloqués tant qu'aucun projet n'est sélectionné (contrôle porté ici, le
   * clone lui-même l'ignore).
   */
  projectId: string | null;
  projectLabel: string;
  readOnly?: boolean;
  /** Dernier calcResultId connu — pour le bouton « Émettre PV » du shell. */
  onCalcResultId?: (calcResultId: string | null) => void;
  /** Notifié après une émission de PV déclenchée DEPUIS l'iframe (pv:request). */
  onPvEmitted?: (pv: unknown) => void;
  /** Jeton d'accès à joindre en Authorization au fetch du clone (getStoredToken()). */
  accessToken: string | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function apiErrorFrom(err: unknown): CalcResponsePayload['error'] {
  const e = err as Partial<{ statusCode: number; reason: string; message: string }>;
  return {
    statusCode: e?.statusCode ?? 500,
    reason: e?.reason ?? 'SERVER_ERROR',
    message: e?.message ?? 'Erreur lors du calcul. Réessayez.',
  };
}

export function ToolFrame({
  toolId,
  engineId,
  engineAllowlist,
  orgId,
  orgSlug,
  projectId,
  projectLabel,
  readOnly,
  onCalcResultId,
  onPvEmitted,
  accessToken,
}: ToolFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // Chargement du clone (fetch authentifié côté client, cf. route handler)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    const url = `/api/tools/${encodeURIComponent(toolId)}?orgId=${encodeURIComponent(orgId)}`;
    const headers: Record<string, string> = {};
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    fetch(url, { headers })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) throw new Error('Session expirée — reconnectez-vous.');
          if (res.status === 403)
            throw new Error("Ce module n'est pas inclus dans votre abonnement.");
          if (res.status === 404)
            throw new Error('Outil indisponible (clone non déployé).');
          throw new Error(`Erreur de chargement (${res.status}).`);
        }
        const html = await res.text();
        if (cancelled) return;
        setSrcDoc(html);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState('error');
        setError(err instanceof Error ? err.message : 'Erreur de chargement.');
      });

    return () => {
      cancelled = true;
    };
  }, [toolId, orgId, accessToken]);

  // ---------------------------------------------------------------------
  // Boucle postMessage
  // ---------------------------------------------------------------------
  const post = useCallback((message: ToolBridgeMessage) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // targetOrigin '*' : voir en-tête du fichier — validation par event.source, pas par origine.
    win.postMessage(message, '*');
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Barrière n°1 : n'accepter que les messages EMIS PAR NOTRE iframe.
      // (origine opaque en sandbox sans allow-same-origin → event.origin === 'null',
      // on ne peut donc pas filtrer sur l'origine ; event.source est fiable.)
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isToolBridgeMessage(event.data)) return;

      const msg = event.data;

      switch (msg.type) {
        case 'ready': {
          post({
            v: TOOL_BRIDGE_PROTOCOL_VERSION,
            type: 'init',
            payload: { engineId, orgSlug, projectLabel, readOnly },
          });
          break;
        }

        case 'calc:request': {
          const payload = msg.payload;
          // projectId absent (aucun projet sélectionné) : l'outil reste
          // affiché (fidélité UI) mais le calcul est bloqué — message
          // explicite affiché dans la zone d'erreur NATIVE du clone.
          if (!payload || !orgId || !projectId) {
            post({
              v: TOOL_BRIDGE_PROTOCOL_VERSION,
              type: 'calc:response',
              id: msg.id,
              payload: {
                ok: false,
                error: apiErrorFrom({
                  message:
                    "Sélectionnez un projet (bandeau au-dessus de l'outil) avant de lancer le calcul.",
                }),
              },
            });
            break;
          }
          // Frontière de confiance : par défaut, l'engineId FACTURABLE est celui
          // configuré par l'hôte (slug URL attendu par l'API tenant et le gate
          // d'abonnement), jamais celui déclaré par l'iframe (le clone émet l'id
          // registre « fondation-superficielle », inconnu du dispatch tenant →
          // 403). Multi-engine (GEOPLAQUE) : si `engineAllowlist` est fourni, un
          // engineId MEMBRE de la liste est accepté tel quel (chaque mode reste
          // sous le même gate — cf. software-catalog.ts) ; un engineId hors
          // liste est rejeté SANS appeler l'API.
          let effectiveEngineId = engineId;
          if (engineAllowlist) {
            if (engineAllowlist.includes(payload.engineId)) {
              effectiveEngineId = payload.engineId;
            } else {
              post({
                v: TOOL_BRIDGE_PROTOCOL_VERSION,
                type: 'calc:response',
                id: msg.id,
                payload: {
                  ok: false,
                  error: {
                    statusCode: 400,
                    reason: 'ENGINE_NOT_ALLOWED',
                    message: `Mode de calcul non autorisé : ${payload.engineId}.`,
                  },
                },
              });
              break;
            }
          }
          runCalc(orgId, projectId, {
            engineId: effectiveEngineId,
            label: payload.label,
            params: payload.params,
          })
            .then((result) => {
              onCalcResultId?.(result.id);
              // ADR 0015 §4 : le clone (`mapOutputToR`) consomme la sortie serveur
              // WHITELISTÉE BRUTE (`output.cas`/`capaciteReference`/`contraintesBase`),
              // pas la forme normalisée UI (`{verdict, rows}`) que lit la page roadsens.
              // On livre donc `rawOutput` (barrière §8 = contrat serveur) ; repli sur
              // `output` pour les modes sans sortie whitelistée (mock/legacy).
              post({
                v: TOOL_BRIDGE_PROTOCOL_VERSION,
                type: 'calc:response',
                id: msg.id,
                payload: {
                  ok: true,
                  calcResultId: result.id,
                  output: result.rawOutput ?? result.output ?? undefined,
                  meta: {
                    engineId: result.engineId,
                    domain: result.domain,
                    status: result.status,
                  },
                },
              });
            })
            .catch((err: unknown) => {
              post({
                v: TOOL_BRIDGE_PROTOCOL_VERSION,
                type: 'calc:response',
                id: msg.id,
                payload: { ok: false, error: apiErrorFrom(err) },
              });
            });
          break;
        }

        case 'store:get': {
          if (!orgId) break;
          const key = msg.payload?.key;
          if (!key) break;
          let value: unknown = null;
          try {
            const raw = window.localStorage.getItem(
              toolStoreKey(orgId, projectId, toolId, key),
            );
            value = raw !== null ? JSON.parse(raw) : null;
          } catch {
            value = null;
          }
          post({
            v: TOOL_BRIDGE_PROTOCOL_VERSION,
            type: 'store:value',
            payload: { key, value },
          });
          break;
        }

        case 'store:set': {
          if (!orgId) break;
          const key = msg.payload?.key;
          if (!key) break;
          const value = msg.payload?.value ?? null;
          try {
            window.localStorage.setItem(
              toolStoreKey(orgId, projectId, toolId, key),
              JSON.stringify(value),
            );
          } catch {
            /* stockage indisponible — best-effort, pas de blocage */
          }
          // Ack en écho — permet à l'iframe de traiter get/set de façon uniforme.
          post({
            v: TOOL_BRIDGE_PROTOCOL_VERSION,
            type: 'store:value',
            payload: { key, value },
          });
          break;
        }

        case 'pv:request': {
          const calcResultId = msg.payload?.calcResultId;
          if (!calcResultId) break; // requête malformée — rien à corréler, ignorée
          if (!orgId || !projectId) {
            // Même règle que calc:request : pas de projet sélectionné → pas
            // d'émission de PV (le calcResultId ne peut de toute façon pas
            // exister sans avoir d'abord réussi un calcul, mais on couvre le
            // cas d'un clone qui invoquerait pv:request de façon autonome).
            post({
              v: TOOL_BRIDGE_PROTOCOL_VERSION,
              type: 'error',
              payload: {
                message:
                  "Sélectionnez un projet (bandeau au-dessus de l'outil) avant d'émettre le PV.",
              },
            });
            break;
          }
          emitPv(orgId, projectId, { calcResultId })
            .then((pv) => onPvEmitted?.(pv))
            .catch((err: unknown) => {
              const e = err as { message?: string };
              post({
                v: TOOL_BRIDGE_PROTOCOL_VERSION,
                type: 'error',
                payload: { message: e?.message ?? "Erreur lors de l'émission du PV." },
              });
            });
          break;
        }

        case 'error':
        case 'init':
        case 'calc:response':
        case 'store:value':
          // Messages hôte→iframe reçus par erreur (boucle mal formée côté clone) — ignorés.
          break;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    post,
    engineId,
    engineAllowlist,
    orgSlug,
    projectLabel,
    readOnly,
    orgId,
    projectId,
    toolId,
    onCalcResultId,
    onPvEmitted,
  ]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {state === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          style={{ padding: 24, textAlign: 'center', color: '#71767a' }}
        >
          Chargement de l&apos;outil…
        </div>
      )}
      {state === 'error' && (
        <div role="alert" style={{ padding: 24, textAlign: 'center', color: '#8f2a1f' }}>
          {error}
        </div>
      )}
      {state === 'ready' && srcDoc !== null && (
        <iframe
          ref={iframeRef}
          title={`Outil ${toolId}`}
          data-testid="tool-frame-iframe"
          srcDoc={srcDoc}
          // Pas de allow-same-origin : origine opaque, aucun accès cookies/JWT/DOM parent.
          sandbox="allow-scripts allow-forms allow-modals allow-downloads"
          style={{ width: '100%', flex: 1, border: 'none', minHeight: 0 }}
        />
      )}
    </div>
  );
}
