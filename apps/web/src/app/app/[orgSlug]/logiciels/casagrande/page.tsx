'use client';

/**
 * CASAGRANDE — Fondations profondes / pieux (NF P 94-262 / EC7).
 *
 * Clone UI client (ADR 0015) : l'écran de saisie/résultats n'est PLUS
 * reconstruit en React — c'est le clone fidèle de l'outil client
 * (`apps/web/src/tools-cloned/casagrande.html`, calcul excisé) chargé en
 * iframe sandboxée via `ToolFrame`. Ce fichier ne porte plus que le SHELL
 * GEOFAM : sélection de projet, bandeau d'abonnement/quota, bouton « Émettre
 * le PV » (le calcul lui-même reste 100 % serveur, DoD §8 — `ToolFrame`
 * proxifie `calc:request` vers `runCalc`, jamais de formule/coefficient de
 * calage côté navigateur).
 *
 * Un seul engineId ('pieux') — pas de multi-engine ici (contrairement à
 * GEOPLAQUE) : pas d'`engineAllowlist`.
 *
 * Historique : la reconstruction React précédente (~656 lignes, formulaire
 * onglets pieu/frottement négatif/sol/options/résultats + payload pur +
 * garde section quelconque + aperçu CPT) est retirée avec cette
 * généralisation du pilote terzaghi (cf. ADR 0015 §Décision — « pilote
 * terzaghi, puis geoplaque, fastlab, casagrande, pressiopro »). Les anciens
 * tests de page (`buildCasaPayload`, `parseCptPaste`, `CptPreview`,
 * `casaBlockingError`, `downdragMissing`) décrivaient cette implémentation
 * retirée ; ils sont remplacés par `casagrande-page.test.tsx` (shell) + les
 * tests du bridge (`lib/tool-bridge/__tests__/ToolFrame.test.tsx`) + la spec
 * de fidélité clone↔source gelée (à charge de qa-test).
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
import { ToolFrame } from '@/lib/tool-bridge/ToolFrame';

const TOOL_ID = 'casagrande';
const ENGINE_ID = 'pieux';

// ── Design (accent pétrole — identique à l'ancienne page / au catalogue GEOFAM) ──
const ACCENT = '#1f4e4a';
const MUTED = '#6b7570';
const LINE = '#d7ded9';
const PANEL = '#fbfcfb';
const PANEL2 = '#e7efed';
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: MUTED,
  marginBottom: 4,
  fontWeight: 600,
};

export default function CasagrandePage() {
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

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, entResp]) => {
        const fd = projs.filter((p) => matchesDomain(p, 'FD'));
        setProjects(fd);
        setEnt(entResp);
        if (fd.length === 1) setProjectId(fd[0].id);
      })
      .catch(() => {});
  }, [orgId]);

  // Changer de projet périme le calcul/PV en cours — même règle que les
  // autres logiciels (le résultat affiché ne doit jamais porter sur un autre projet).
  useEffect(() => {
    setCalcResultId(null);
    setPvResult(null);
    setPvError(null);
  }, [projectId]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResultId || !orgId || !projectId) return;
    setEmittingPv(true);
    setPvError(null);
    try {
      const pv = await emitPv(orgId, projectId, { calcResultId });
      setPvResult(pv);
    } catch (err: unknown) {
      setPvError(
        (err as { message?: string })?.message ?? "Erreur lors de l'émission du PV.",
      );
    } finally {
      setEmittingPv(false);
    }
  }, [calcResultId, orgId, projectId]);

  const handleNouveauCalcul = useCallback(() => {
    setCalcResultId(null);
    setPvResult(null);
    setPvError(null);
  }, []);

  if (!mounted) {
    return (
      <div
        style={{ padding: 24 }}
        aria-busy="true"
        aria-label="Chargement de CASAGRANDE"
      />
    );
  }

  const gate = evaluateGate(ent, ENGINE_ID);
  const project = projects.find((p) => p.id === projectId);
  const quotaLow = ent ? isQuotaLow(ent) : false;
  const canEmitPv = !!calcResultId && !emittingPv && !pvResult;

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
          <div style={{ fontSize: 19, fontWeight: 700 }}>CASAGRANDE</div>
          <div style={{ fontSize: 12, color: MUTED }}>
            Fondations profondes — pieux · NF P 94-262 / Eurocode 7
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
            <label style={lbl} htmlFor="cg-projet">
              Projet
            </label>
            <ProjectPicker
              orgId={orgId}
              domain="FD"
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
            onClick={handleEmitPv}
            disabled={!canEmitPv}
            aria-busy={emittingPv}
            title={
              !calcResultId
                ? 'Lancez un calcul dans l’outil avant d’émettre le PV'
                : undefined
            }
            style={{
              background: canEmitPv ? ACCENT : '#b7c2bd',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: canEmitPv ? 'pointer' : 'not-allowed',
            }}
          >
            {emittingPv ? 'Émission…' : 'Émettre le PV scellé'}
          </button>
        </div>
      </div>

      {!gate.allowed && (
        <div
          role="alert"
          data-testid="gate-banner"
          style={{
            background: 'var(--status-warn-bg)',
            border: '1px solid var(--warn-line, var(--status-warn-tx))',
            color: 'var(--status-warn-tx)',
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
            background: 'var(--status-warn-bg)',
            border: '1px solid var(--warn-line, var(--status-warn-tx))',
            color: 'var(--status-warn-tx)',
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
          <div style={{ fontWeight: 700, color: '#2e7d4f', marginBottom: 10 }}>
            PV scellé n° {pvResult.number ?? pvResult.id} — intégrité + horodatage
            garantis.
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
          onCalcResultId={setCalcResultId}
        />
      </div>
    </div>
  );
}
