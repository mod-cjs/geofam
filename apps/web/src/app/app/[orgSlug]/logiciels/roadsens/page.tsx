'use client';

/**
 * ROADSENS — Dimensionnement des chaussées (Burmister exact / AGEROUTE 2015).
 *
 * Clone UI client (ADR 0015) : l'écran de saisie/résultats n'est PLUS
 * reconstruit en React — c'est le clone fidèle de l'outil client
 * (`apps/web/src/tools-cloned/roadsens.html`, calcul excisé) chargé en
 * iframe sandboxée via `ToolFrame`. Ce fichier ne porte plus que le SHELL
 * GEOFAM : sélection de projet, bandeau d'abonnement/quota, bouton « Émettre
 * le PV » (le calcul lui-même reste 100 % serveur, DoD §8 — `ToolFrame`
 * proxifie `calc:request` vers `runCalc`, jamais de formule côté navigateur).
 *
 * Historique : la reconstruction React précédente (~5675 lignes, formulaire +
 * onglets + coupe SVG + tableau de résultats dupliqués) est retirée avec ce
 * pilote de généralisation (ROADSENS était le 6e/dernier logiciel divergent,
 * cf. ADR 0015 §Décision — « pilote terzaghi, puis geoplaque, fastlab,
 * casagrande, pressiopro » ; roadsens suit le même mouvement une fois le
 * pilote validé). Les anciens tests de page (`computeNE`, `buildBurmisterPayload`,
 * sélection de preset pilotant le calcul, extraction de KPIs...) décrivaient
 * cette implémentation retirée ; ils sont remplacés par `roadsens-page.test.tsx`
 * (shell) + les tests du bridge (`lib/tool-bridge/__tests__/ToolFrame.test.tsx`)
 * + la spec de fidélité clone↔source gelée (à charge de qa-test).
 *
 * M3 — chemin PRIMAIRE (revue adverse) : le bouton « Émettre le PV scellé » ne
 * s'active plus dès `onCalcResultId` seul — il ATTEND la confirmation de
 * capture du document (`onSnapshotStatus`, cf. ToolFrame) avant de s'activer.
 * Sans cette garde, une course entre « calcul terminé » et « POST snapshot
 * best-effort encore en vol » pouvait faire sceller un PV SANS document — et
 * comme l'émission est idempotente, c'est DÉFINITIF pour ce calcul (aucun
 * re-scellement possible). Si la capture échoue définitivement (y compris via
 * le watchdog anti soft-lock de `ToolFrame`, cf. `SNAPSHOT_WATCHDOG_MS`), le
 * même patron que `CalculsClient` s'applique : avertissement explicite +
 * second clic de confirmation avant d'émettre quand même (au format standard).
 *
 * Wording honnête (décision titulaire M2 + revue adverse) : la bannière de
 * succès reflète `pv.documentFormat`, mais reste FACTUELLE dans les deux cas —
 * la portée réelle du sceau est l'intégrité post-scellement + la sortie
 * moteur recalculée/vérifiée, PAS une preuve infalsifiable des valeurs
 * affichées à l'écran. Ni « garanti », ni « au mm près » : cohérent avec la
 * note légale de l'onglet PV (sceau HMAC ≠ signature électronique qualifiée).
 */

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PvEmittedActions } from '@/components/pv/PvEmittedActions';
import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { emitPv, getEntitlements, getStoredToken, listProjects } from '@/lib/api/client';
import { matchesDomain } from '@/lib/api/project-domain';
import type { EntitlementsResponse, OfficialPv, Project } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { evaluateGate, isQuotaLow } from '@/lib/subscription-gate';
import { ToolFrame, type SnapshotStatusEvent } from '@/lib/tool-bridge/ToolFrame';

const TOOL_ID = 'roadsens';
const ENGINE_ID = 'burmister';

// ── Design (accent navy — identique à l'ancienne page / au catalogue GEOFAM) ──
const ACCENT = '#1b3a5b';
const MUTED = '#71767a';
const LINE = '#d5dde6';
const PANEL = '#f7fafd';
const PANEL2 = '#eaf1f9';
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: MUTED,
  marginBottom: 4,
  fontWeight: 600,
};

export default function RoadsensPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);

  const [calcResultId, setCalcResultId] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  // M3 (revue adverse, chemin primaire) : statut de capture du document pour
  // le DERNIER calcResultId connu (cf. ToolFrame.onSnapshotStatus). `null` ou
  // 'awaiting'/'capturing' = on ATTEND encore — le bouton ne s'active pas.
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatusEvent | null>(null);
  // Avertissement affiché AVANT d'émettre un PV sans document capturé (capture
  // 'failed') — même patron que `CalculsClient` : 1er clic = avertissement,
  // 2e clic = confirmation explicite.
  const [emitConfirmOpen, setEmitConfirmOpen] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, entResp]) => {
        const ch = projs.filter((p) => matchesDomain(p, 'CH'));
        setProjects(ch);
        setEnt(entResp);
        if (ch.length === 1) setProjectId(ch[0].id);
      })
      .catch(() => {});
  }, [orgId]);

  // Changer de projet périme le calcul/PV en cours — même règle que les
  // autres logiciels (le résultat affiché ne doit jamais porter sur un autre projet).
  useEffect(() => {
    setCalcResultId(null);
    setPvResult(null);
    setPvError(null);
    setSnapshotStatus(null);
    setEmitConfirmOpen(false);
  }, [projectId]);

  // Miroir de `onCalcResultId`, mais réinitialise aussi la confirmation
  // d'émission-sans-document : un NOUVEAU calcul remet tout à zéro, jamais de
  // confirmation « héritée » d'un calcul précédent.
  const handleCalcResultId = useCallback((id: string | null) => {
    setCalcResultId(id);
    setEmitConfirmOpen(false);
  }, []);

  const handleSnapshotStatus = useCallback((event: SnapshotStatusEvent) => {
    setSnapshotStatus(event);
  }, []);

  // Statut de capture APPLICABLE au calcul COURANT uniquement (garde anti-
  // staleness : un événement pour un calcResultId différent — calcul précédent
  // — est ignoré, `captureStatus` retombe alors à `null`, donc au repli « en
  // attente », jamais à un faux 'confirmed' hérité).
  const captureStatus =
    snapshotStatus && snapshotStatus.calcResultId === calcResultId
      ? snapshotStatus.status
      : null;
  const captureReady = captureStatus === 'confirmed' || captureStatus === 'failed';

  const handleEmitPv = useCallback(async () => {
    if (!calcResultId || !orgId || !projectId) return;
    setEmittingPv(true);
    setPvError(null);
    try {
      const pv = await emitPv(orgId, projectId, { calcResultId });
      setPvResult(pv);
      setEmitConfirmOpen(false);
    } catch (err: unknown) {
      setPvError(
        (err as { message?: string })?.message ?? "Erreur lors de l'émission du PV.",
      );
    } finally {
      setEmittingPv(false);
    }
  }, [calcResultId, orgId, projectId]);

  // M3 : sur capture 'confirmed' → émission directe (comportement inchangé).
  // Sur capture 'failed' → 1er clic affiche l'avertissement, seul le 2e clic
  // (« Confirmer… ») appelle réellement emitPv. Tant que la capture n'est ni
  // confirmée ni en échec (en cours), le bouton est désactivé — cf. `canEmitPv`.
  const handleEmitClick = useCallback(() => {
    if (captureStatus === 'failed' && !emitConfirmOpen) {
      setEmitConfirmOpen(true);
      return;
    }
    handleEmitPv();
  }, [captureStatus, emitConfirmOpen, handleEmitPv]);

  const handleNouveauCalcul = useCallback(() => {
    setCalcResultId(null);
    setPvResult(null);
    setPvError(null);
    setSnapshotStatus(null);
    setEmitConfirmOpen(false);
  }, []);

  if (!mounted) {
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de ROADSENS" />
    );
  }

  const gate = evaluateGate(ent, ENGINE_ID);
  const project = projects.find((p) => p.id === projectId);
  const quotaLow = ent ? isQuotaLow(ent) : false;
  // M3 (revue adverse) : n'active JAMAIS le scellement tant que la capture du
  // document n'est pas résolue (confirmée OU en échec confirmé) — ferme la
  // course « calcul terminé » vs « POST snapshot encore en vol ».
  const canEmitPv = !!calcResultId && !emittingPv && !pvResult && captureReady;
  const emitLabel = emittingPv
    ? 'Émission…'
    : !calcResultId
      ? 'Émettre le PV scellé'
      : !captureReady
        ? 'Capture du document…'
        : captureStatus === 'failed' && emitConfirmOpen
          ? "Confirmer l'émission sans document"
          : 'Émettre le PV scellé';
  const emitTitle = !calcResultId
    ? 'Lancez un calcul dans l’outil avant d’émettre le PV'
    : !captureReady
      ? 'Capture du document en cours — patientez quelques secondes.'
      : undefined;

  return (
    <div
      style={{
        padding: '18px 20px 32px',
        fontFamily: 'inherit',
        maxWidth: 1600,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        // Hauteur DÉFINIE (pas seulement min) : donne une hauteur réelle au
        // conteneur de l'outil → l'iframe remplit l'écran et l'outil défile
        // À L'INTÉRIEUR (comportement du shell GeoSuite du client).
        height: 'calc(100vh - 32px)',
      }}
    >
      {/* Bandeau outil — shell GEOFAM (sélection projet, gate, PV) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          padding: '13px 16px',
          marginBottom: 14,
          background: PANEL,
          border: `1px solid ${LINE}`,
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>ROADSENS</div>
          <div style={{ fontSize: 12, color: MUTED }}>
            Dimensionnement des chaussées · Burmister exact · AGEROUTE 2015
          </div>
          {/* L'outil est affiché dès l'ouverture (fidélité UI) — la sélection
              de projet ne conditionne que le calcul/PV, pas l'affichage. */}
          {!projectId && (
            <div
              data-testid="no-project-hint"
              style={{ fontSize: 11, color: MUTED, marginTop: 3 }}
            >
              Sélectionnez un projet pour calculer et émettre un PV.
            </div>
          )}
        </div>
        <div
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}
        >
          <div>
            <label style={lbl} htmlFor="rs-projet">
              Projet
            </label>
            <ProjectPicker
              orgId={orgId}
              domain="CH"
              projects={projects}
              setProjects={setProjects}
              value={projectId}
              onChange={setProjectId}
              accent={ACCENT}
              width={220}
            />
          </div>
          <button
            type="button"
            data-testid="btn-emettre-pv"
            onClick={handleEmitClick}
            disabled={!canEmitPv}
            aria-busy={emittingPv}
            title={emitTitle}
            style={{
              background: canEmitPv ? ACCENT : '#b7c2cd',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: canEmitPv ? 'pointer' : 'not-allowed',
            }}
          >
            {emitLabel}
          </button>
        </div>
      </div>

      {/* M3 (revue adverse) : capture définitivement en échec pour ce calcul —
          avertissement explicite AVANT tout scellement sans document (même
          patron que CalculsClient). */}
      {captureStatus === 'failed' && emitConfirmOpen && !pvResult && (
        <div
          role="alert"
          data-testid="capture-failed-warning"
          style={{
            background: '#f4edd8',
            border: '1px solid #e6cf9c',
            color: '#96701a',
            borderRadius: 12,
            padding: '11px 15px',
            marginBottom: 14,
          }}
        >
          Le document de l&apos;outil n&apos;a pas pu être capturé pour ce calcul — le PV
          sera émis au format standard, pas le document de l&apos;outil. Relancez le
          calcul pour retenter la capture.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setEmitConfirmOpen(false)}
              style={{
                background: 'transparent',
                border: '1px solid #96701a',
                color: '#96701a',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!gate.allowed && (
        <div
          role="alert"
          data-testid="gate-banner"
          style={{
            background: '#f4edd8',
            border: '1px solid #e6cf9c',
            color: '#96701a',
            borderRadius: 12,
            padding: '11px 15px',
            marginBottom: 14,
          }}
        >
          {gate.message}
        </div>
      )}
      {gate.allowed && quotaLow && (
        <div
          role="status"
          style={{
            background: '#f4edd8',
            border: '1px solid #e6cf9c',
            color: '#96701a',
            borderRadius: 12,
            padding: '11px 15px',
            marginBottom: 14,
          }}
        >
          Quota de calculs bientôt épuisé ({ent?.quota.remaining} restants sur{' '}
          {ent?.quota.limit}).
        </div>
      )}
      {pvError && (
        <div
          role="alert"
          style={{
            background: '#f6e5e1',
            border: '1px solid #e0b3aa',
            color: '#8f2a1f',
            borderRadius: 12,
            padding: '11px 15px',
            marginBottom: 14,
          }}
        >
          {pvError}
        </div>
      )}

      {pvResult && (
        <div
          style={{
            background: PANEL2,
            border: `1px solid ${LINE}`,
            borderRadius: 12,
            padding: '13px 16px',
            marginBottom: 14,
          }}
        >
          <div
            data-testid="pv-success-banner"
            style={{ fontWeight: 700, color: '#2e7d4f', marginBottom: 10 }}
          >
            {/* B1 (revue adverse) + wording honnête (décision titulaire M2) :
                bannière FACTUELLE — n'annonce le document de l'outil que si le
                backend confirme documentFormat==='html', et ne survend jamais
                sa portée. La portée réelle du sceau = intégrité post-scellement
                + sortie moteur recalculée/vérifiée, PAS une preuve infalsifiable
                des valeurs affichées à l'écran — donc jamais « garanti » ni
                « au mm près » accolés au document, dans AUCUN des deux cas. */}
            {pvResult.documentFormat === 'html' ? (
              <>
                PV scellé n° {pvResult.number ?? pvResult.id} — document de l&apos;outil
                scellé (intégrité + horodatage serveur).
              </>
            ) : (
              <>
                PV scellé n° {pvResult.number ?? pvResult.id} — émis au format standard.
                Document de l&apos;outil non capturé pour ce calcul.
              </>
            )}
          </div>
          <PvEmittedActions
            pv={pvResult}
            orgId={orgId}
            orgSlug={orgSlug}
            projetId={projectId}
            accent={ACCENT}
            onNewCalcul={handleNouveauCalcul}
          />
        </div>
      )}

      {/* L'outil client cloné occupe l'essentiel du viewport — c'est LUI le
          produit. Affiché dès que l'org est connue (fidélité UI, cf. bandeau
          ci-dessus) : la sélection de projet ne conditionne QUE le calcul/PV
          (ToolFrame bloque calc:request/pv:request tant que projectId est
          null), jamais l'affichage de l'outil lui-même. */}
      <div
        style={{
          flex: 1,
          // minHeight 0 : lève le plancher min-content du flexbox — sans lui,
          // le conteneur ne rétrécit jamais et l'iframe déborde de l'écran.
          minHeight: 0,
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${LINE}`,
        }}
      >
        <ToolFrame
          toolId={TOOL_ID}
          engineId={ENGINE_ID}
          orgId={orgId}
          orgSlug={orgSlug}
          projectId={projectId || null}
          projectLabel={project?.name ?? ''}
          accessToken={getStoredToken()}
          onCalcResultId={handleCalcResultId}
          onSnapshotStatus={handleSnapshotStatus}
        />
      </div>
    </div>
  );
}
