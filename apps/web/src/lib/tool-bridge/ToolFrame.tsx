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

import { emitPv, runCalc, saveCalcSnapshot } from '@/lib/api/client';

/**
 * Statut de capture du document (option 3) pour un calcResultId donné —
 * revue adverse M3/chemin primaire : ferme la COURSE entre « calcul terminé »
 * (bouton PV activable) et « capture persistée » (POST snapshot best-effort,
 * asynchrone). Sans ce statut, un hôte (page logiciel) pourrait appeler
 * `emitPv` avant que le document ne soit réellement enregistré → PV scellé
 * SANS document, définitif (émission idempotente, pas de re-scellement).
 *
 *  - 'awaiting'   : calcul terminé, aucun `snapshot:capture` reçu pour l'instant.
 *  - 'capturing'  : `snapshot:capture` reçu, `saveCalcSnapshot` en vol.
 *  - 'confirmed'  : persistance confirmée (200) — le document EST capturé.
 *  - 'failed'     : persistance en échec — aucun document ne sera capturé
 *    pour ce calcul (l'hôte doit avertir + exiger confirmation avant scellement).
 */
export type SnapshotCaptureStatus = 'awaiting' | 'capturing' | 'confirmed' | 'failed';

export interface SnapshotStatusEvent {
  calcResultId: string;
  status: SnapshotCaptureStatus;
}

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
  /**
   * Statut de capture du document pour le calcResultId courant (option 3,
   * revue adverse M3/chemin primaire). Le shell doit s'en servir pour GATER
   * le bouton d'émission de PV — jamais sceller tant que le statut n'est pas
   * 'confirmed' (ou 'failed' avec confirmation explicite de l'ingénieur).
   */
  onSnapshotStatus?: (event: SnapshotStatusEvent) => void;
  /** Notifié après une émission de PV déclenchée DEPUIS l'iframe (pv:request). */
  onPvEmitted?: (pv: unknown) => void;
  /** Jeton d'accès à joindre en Authorization au fetch du clone (getStoredToken()). */
  accessToken: string | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Watchdog anti soft-lock (revue adverse, finition avant merge) : si un clone
 * lève au rendu (ou omet d'appeler son bridge de capture) APRÈS un calcul
 * réussi, `snapshot:capture` n'arrive jamais et le statut resterait bloqué en
 * dur sur 'awaiting' — l'hôte (page logiciel) attendrait indéfiniment une
 * capture qui ne viendra jamais, bouton d'émission de PV gelé sans recours.
 * Passé ce délai sans résolution ('confirmed'/'failed'), le statut bascule
 * lui-même en 'failed' : l'ingénieur retombe sur le chemin avertir+confirmer
 * (scellement conscient, au format standard) plutôt qu'un blocage silencieux.
 */
export const SNAPSHOT_WATCHDOG_MS = 7000;

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
  onSnapshotStatus,
  onPvEmitted,
  accessToken,
}: ToolFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  // PLEIN ÉCRAN (demande client) : l'outil est rogné par la coquille GEOFAM
  // (barre latérale + en-tête). Le plein écran détache le conteneur en overlay
  // couvrant tout le viewport. Overlay CSS (position:fixed) et NON l'API
  // Fullscreen native : basculer une classe/style sur le MÊME élément ne
  // remonte pas l'iframe — l'outil ne se recharge pas et la saisie en cours est
  // préservée (un remount rechargerait le srcDoc et effacerait le formulaire).
  const [fullscreen, setFullscreen] = useState(false);
  // Garde anti-course (audit adverse #9, BQ-2) : compteur monotone incrémenté
  // à CHAQUE calc:request reçu (y compris les rejets synchrones — no-project,
  // engineId hors allowlist — pour qu'une réponse async qui résoudrait après
  // eux soit, elle aussi, considérée périmée). Le `.then`/`.catch` de
  // `runCalc` ne remonte le résultat (onCalcResultId + calc:response au
  // clone) QUE si son seq est toujours le plus récent au moment où il résout
  // — une résolution hors-ordre (rafale/clics rapprochés) est silencieusement
  // ignorée plutôt que d'écraser le shell avec un résultat plus ancien.
  const requestSeqRef = useRef(0);
  // Dernier calcResultId serveur COURANT (dernier calc:response ok), miroir de ce
  // qui est remonté au shell via onCalcResultId. Sert à sceller un `snapshot:capture`
  // sur le BON calcul — JAMAIS sur un id venu de l'iframe (frontière de confiance).
  // Invalidé (null) par `input:dirty` : plus de calcul courant → snapshot ignoré.
  const currentCalcResultIdRef = useRef<string | null>(null);
  // Watchdog anti soft-lock : calcResultId déjà résolus ('confirmed'/'failed')
  // — un watchdog qui se déclenche APRÈS résolution est un no-op silencieux.
  const snapshotResolvedRef = useRef<Set<string>>(new Set());
  // Minuteurs en vol, par calcResultId — permet de les annuler dès résolution
  // (succès/échec réel de la capture) ou au démontage du composant.
  const snapshotTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const clearSnapshotWatchdog = useCallback((calcResultId: string) => {
    const timeoutId = snapshotTimeoutsRef.current.get(calcResultId);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      snapshotTimeoutsRef.current.delete(calcResultId);
    }
  }, []);

  // Marque un calcResultId comme résolu (confirmed/failed) et annule son
  // watchdog — évite qu'un timeout déjà écoulé ne bascule le statut en
  // 'failed' APRÈS une confirmation réelle (ordre inverse improbable mais
  // couvert : le check `snapshotResolvedRef.has(...)` dans le watchdog protège
  // aussi le sens inverse).
  const resolveSnapshotStatus = useCallback(
    (calcResultId: string, status: 'confirmed' | 'failed') => {
      snapshotResolvedRef.current.add(calcResultId);
      clearSnapshotWatchdog(calcResultId);
      onSnapshotStatus?.({ calcResultId, status });
    },
    [clearSnapshotWatchdog, onSnapshotStatus],
  );

  // Démonte : annule tous les watchdogs en vol (composant retiré avant
  // résolution — ex. navigation hors de la page logiciel). La map elle-même
  // (référence stable, créée une fois via useRef) est capturée dans une
  // variable locale à l'effet — lint react-hooks/exhaustive-deps satisfait
  // sans changer le comportement (même objet Map tout du long du cycle de vie).
  useEffect(() => {
    const timeouts = snapshotTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeouts.values()) {
        clearTimeout(timeoutId);
      }
      timeouts.clear();
    };
  }, []);

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
          const seq = ++requestSeqRef.current;
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
              // Réponse PÉRIMÉE (une requête plus récente a déjà été émise
              // pendant que celle-ci était en vol) : ignorée SILENCIEUSEMENT —
              // ni remontée au shell (onCalcResultId), ni renvoyée au clone.
              if (seq !== requestSeqRef.current) return;
              currentCalcResultIdRef.current = result.id;
              onCalcResultId?.(result.id);
              // Course M3 (revue adverse) : le calcul est connu du serveur mais
              // AUCUN document n'est encore capturé — le shell ne doit pas
              // encore autoriser le scellement. `snapshot:capture` (ci-dessous)
              // fera transiter ce statut vers 'capturing' puis 'confirmed'/'failed'.
              snapshotResolvedRef.current.delete(result.id);
              onSnapshotStatus?.({ calcResultId: result.id, status: 'awaiting' });
              // Watchdog anti soft-lock (revue adverse) : si `snapshot:capture`
              // n'arrive JAMAIS (clone qui lève au rendu, bridge non appelé…),
              // le statut ne doit pas rester bloqué en dur sur 'awaiting' — il
              // bascule lui-même en 'failed' après SNAPSHOT_WATCHDOG_MS, sans
              // attendre un événement qui ne viendra pas.
              clearSnapshotWatchdog(result.id);
              snapshotTimeoutsRef.current.set(
                result.id,
                setTimeout(() => {
                  snapshotTimeoutsRef.current.delete(result.id);
                  if (snapshotResolvedRef.current.has(result.id)) return;
                  console.warn(
                    `[ToolFrame] snapshot:capture jamais résolu pour ${result.id} après ${SNAPSHOT_WATCHDOG_MS}ms — statut basculé en 'failed' (watchdog anti soft-lock).`,
                  );
                  resolveSnapshotStatus(result.id, 'failed');
                }, SNAPSHOT_WATCHDOG_MS),
              );
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
              // Même garde côté erreur : une erreur périmée ne doit pas non
              // plus atterrir sur le shell/le clone après une requête plus
              // récente.
              if (seq !== requestSeqRef.current) return;
              post({
                v: TOOL_BRIDGE_PROTOCOL_VERSION,
                type: 'calc:response',
                id: msg.id,
                payload: { ok: false, error: apiErrorFrom(err) },
              });
            });
          break;
        }

        case 'input:dirty': {
          // BQ-1 (audit adverse #9) : la saisie a changé APRÈS un calcul (ou
          // l'utilisateur a changé d'onglet/mode) — le dernier calcResultId
          // ne correspond plus à ce qui est affiché à l'écran. On l'invalide
          // en remontant `null` au shell (même callback que le calcul lui-
          // même : idempotent si aucun calcul n'était en cours). Rétrocompat :
          // un clone qui n'émet JAMAIS ce message ne déclenche jamais cette
          // branche — comportement inchangé.
          // Le calcul précédent est abandonné (saisie modifiée) : son watchdog
          // devenu sans objet est annulé (évite un 'failed' fantôme plus tard
          // pour un calcul que l'ingénieur ne regarde de toute façon plus).
          if (currentCalcResultIdRef.current) {
            snapshotResolvedRef.current.add(currentCalcResultIdRef.current);
            clearSnapshotWatchdog(currentCalcResultIdRef.current);
          }
          currentCalcResultIdRef.current = null;
          onCalcResultId?.(null);
          break;
        }

        case 'snapshot:capture': {
          // Option 3 « sceller le document imprimé » : le clone remonte le HTML
          // qu'il vient de rendre (affichage + document imprimable auto-contenu).
          // On le persiste sur le calcResultId COURANT connu du SERVEUR (dernier
          // calc:response ok) — jamais un id venu de l'iframe. Sans projet réel
          // ou sans calcul courant → no-op (même règle que pv:request).
          const calcResultId = currentCalcResultIdRef.current;
          const capture = msg.payload;
          if (!capture || !orgId || !projectId || !calcResultId) break;
          const displayHtml =
            typeof capture.displayHtml === 'string' ? capture.displayHtml : '';
          const printHtml =
            typeof capture.printHtml === 'string' ? capture.printHtml : '';
          // M3 (revue adverse) : la persistance est en vol — le shell ne doit
          // toujours pas autoriser le scellement tant qu'elle n'a pas abouti.
          onSnapshotStatus?.({ calcResultId, status: 'capturing' });
          // Best-effort pour L'OUTIL : un échec de persistance ne casse PAS
          // l'iframe et ne lui remonte AUCUNE erreur (pas de throw). Le shell,
          // lui, EST informé via onSnapshotStatus('failed') — c'est LUI qui
          // gate le bouton d'émission de PV, jamais un simple log avalé.
          saveCalcSnapshot(orgId, projectId, calcResultId, { displayHtml, printHtml })
            .then(() => {
              resolveSnapshotStatus(calcResultId, 'confirmed');
            })
            .catch((err: unknown) => {
              console.warn('[ToolFrame] snapshot:capture non persisté', err);
              resolveSnapshotStatus(calcResultId, 'failed');
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
    onSnapshotStatus,
    onPvEmitted,
    clearSnapshotWatchdog,
    resolveSnapshotStatus,
  ]);
  // `saveCalcSnapshot` est un import de module (référence stable) — pas de dép.

  // Échap sort du plein écran (attaché seulement quand il est actif). Sans
  // `allow-same-origin`, un focus DANS l'iframe capte ses propres touches ;
  // le listener au niveau `window` couvre le cas où le focus est côté hôte.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  return (
    <div
      data-testid="tool-frame-root"
      style={
        fullscreen
          ? {
              // Overlay plein viewport, AU-DESSUS de la coquille GEOFAM.
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'var(--surface-canvas, #0b0e13)',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }
          : {
              width: '100%',
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }
      }
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
        // Conteneur RELATIF : porte le bouton flottant sans changer le flux.
        // L'iframe garde le MÊME nœud dans les deux modes -> jamais de remount
        // (l'outil ne se recharge pas, la saisie en cours est préservée).
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
          <button
            type="button"
            data-testid="tool-frame-fullscreen"
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? 'Quitter le plein écran' : 'Afficher en plein écran'}
            title={
              fullscreen ? 'Quitter le plein écran (Échap)' : 'Afficher en plein écran'
            }
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: 8,
              border: '1px solid var(--border-subtle, #d9d3c2)',
              background: 'var(--surface-base, #ffffff)',
              color: 'var(--text-secondary, #55606a)',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,.18)',
            }}
          >
            {fullscreen ? (
              // Icône « réduire » (flèches vers le centre).
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M9 3v4a2 2 0 0 1-2 2H3M21 9h-4a2 2 0 0 1-2-2V3M3 15h4a2 2 0 0 1 2 2v4M15 21v-4a2 2 0 0 1 2-2h4" />
              </svg>
            ) : (
              // Icône « agrandir » (flèches vers les coins).
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
          <iframe
            ref={iframeRef}
            title={`Outil ${toolId}`}
            data-testid="tool-frame-iframe"
            srcDoc={srcDoc}
            // Pas de allow-same-origin : origine opaque, aucun accès cookies/JWT/DOM parent.
            sandbox="allow-scripts allow-forms allow-modals allow-downloads"
            style={{ width: '100%', flex: 1, border: 'none', minHeight: 0 }}
          />
        </div>
      )}
    </div>
  );
}
