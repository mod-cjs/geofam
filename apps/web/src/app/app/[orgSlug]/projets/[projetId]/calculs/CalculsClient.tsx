'use client';

/**
 * B-13/B-14/B-15 — Onglet Calculs — master-detail
 * Colonne gauche 280px : liste des calculs
 * Colonne droite : sélecteur de moteur → formulaire → résultats → émission PV
 *
 * États gérés :
 * - Chargement liste
 * - Liste vide
 * - Panneau vide (rien sélectionné)
 * - Nouveau calcul (sélecteur moteur → formulaire)
 * - Calcul en cours (feedback 400ms)
 * - Résultats (OutputTable + VerdictBanner + CTA Émettre PV)
 * - Modale émission PV (C-02)
 * - Gating d'abonnement (expiré / quota épuisé / module verrouillé)
 */

import {
  Plus,
  Calculator,
  ChevronLeft,
  Lock,
  AlertCircle,
  Loader2,
  FileCheck2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DomainTag } from '@/components/ui/DomainTag';
import type { Domain } from '@/components/ui/DomainTag';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { VerdictBanner } from '@/components/ui/VerdictBanner';
import { listCalcResults, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { CalcResult, EntitlementsResponse } from '@/lib/api/types';
import { findDescriptor } from '@/lib/engine-descriptors';
import type { EngineDescriptor } from '@/lib/engine-descriptors';

import { useOrgId } from '@/lib/org-context';

// Formatage numérique fr-FR
const fmt = (n: number, decimals = 4) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals }).format(n);

function relDate(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'auj.';
  if (d === 1) return 'hier';
  return `${d}j`;
}

const STATUS_LABELS: Record<string, string> = {
  DONE: 'Calculé',
  DRAFT: 'Brouillon',
  PENDING: 'En cours',
  ERROR: 'Erreur',
};

// Mapping engineId → Domain
const ENGINE_DOMAIN: Record<string, Domain> = {
  burmister: 'road',
  pressiometre: 'lab',
  fastlab: 'lab',
  terzaghi: 'foundation',
  casagrande: 'foundation',
  geoplaque: 'foundation',
};

interface CalculsClientProps {
  orgSlug: string;
  projetId: string;
}

type PanelState =
  | { mode: 'empty' }
  | { mode: 'select-engine' }
  | { mode: 'form'; engineId: string; descriptor: EngineDescriptor }
  | { mode: 'running'; engineId: string; label: string }
  | { mode: 'result'; calc: CalcResult }
  | { mode: 'view'; calc: CalcResult };

export default function CalculsClient({ orgSlug, projetId }: CalculsClientProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const orgId = useOrgId(orgSlug);
  const resultRef = useRef<HTMLDivElement>(null);

  const [calculs, setCalculs] = useState<CalcResult[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [panel, setPanel] = useState<PanelState>({ mode: 'empty' });
  const [pvModalOpen, setPvModalOpen] = useState(false);
  const [emittingPv, setEmittingPv] = useState(false);

  // Formulaire dynamique
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [calcLabel, setCalcLabel] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Skeleton delayed
  const [showSkeleton, setShowSkeleton] = useState(false);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drill-down mobile
  const [mobileDrillDown, setMobileDrillDown] = useState(false);

  const loadData = useCallback(async () => {
    if (!orgId) {
      setListError('Organisation introuvable.');
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    setListError(null);
    try {
      const [data, ent] = await Promise.all([
        listCalcResults(orgId, projetId),
        getEntitlements(orgId),
      ]);
      setCalculs(data);
      setEntitlements(ent);
    } catch {
      setListError('Impossible de charger les calculs.');
    } finally {
      setLoadingList(false);
    }
  }, [orgId, projetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Initialiser les valeurs du formulaire depuis le descripteur
  function initFormValues(desc: EngineDescriptor): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of desc.fields) {
      if (f.type === 'section') continue;
      out[f.key] = f.example !== undefined ? String(f.example) : '';
    }
    return out;
  }

  function handleSelectEngine(engineId: string) {
    const desc = findDescriptor(engineId);
    if (!desc) return;
    setPanel({ mode: 'form', engineId, descriptor: desc });
    setFormValues(initFormValues(desc));
    setCalcLabel('');
    setFormErrors({});
  }

  async function handleRunCalc(e?: FormEvent) {
    e?.preventDefault();

    if (panel.mode !== 'form') return;
    const { engineId, descriptor } = panel;

    // Validation basique des champs requis
    const errors: Record<string, string> = {};
    for (const f of descriptor.fields) {
      if (f.type === 'section' || f.optional) continue;
      const v = formValues[f.key];
      if (v === undefined || v === '') {
        errors[f.key] = 'Champ requis';
      }
      if (f.type === 'number' && v !== '' && isNaN(Number(v))) {
        errors[f.key] = 'Valeur numérique attendue';
      }
    }
    if (!calcLabel.trim()) {
      errors['_label'] = 'Libellé requis';
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    // Construire le payload via buildPayload du descripteur
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(formValues)) {
      const fieldDesc = descriptor.fields.find((f) => f.key === k);
      if (fieldDesc?.type === 'number') {
        flat[k] = parseFloat(v);
      } else if (fieldDesc?.type === 'boolean') {
        flat[k] = v === 'true';
      } else {
        flat[k] = v;
      }
    }
    const payload = descriptor.buildPayload(flat);

    setPanel({ mode: 'running', engineId, label: calcLabel });

    // Skeleton après 400ms
    skeletonTimerRef.current = setTimeout(() => setShowSkeleton(true), 400);

    try {
      const result = await runCalc(orgId ?? '', projetId, {
        engineId,
        label: calcLabel.trim() || descriptor.label,
        params: payload as Record<string, unknown>,
      });
      setCalculs((prev) => [...prev, result]);
      setPanel({ mode: 'result', calc: result });

      // Focus sur les résultats (excellence-v1 §D)
      setTimeout(() => {
        const prefersReduced = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        resultRef.current?.focus();
        resultRef.current?.scrollIntoView({
          behavior: prefersReduced ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }, 50);
    } catch (err: unknown) {
      const apiErr = err as { reason?: string; message?: string };
      const msg =
        apiErr?.reason === 'EXPIRED'
          ? 'Abonnement expiré — calcul impossible.'
          : apiErr?.reason === 'QUOTA'
            ? 'Quota épuisé — calcul impossible.'
            : apiErr?.reason === 'MODULE_NOT_IN_PACK'
              ? "Ce module n'est pas inclus dans votre abonnement."
              : (apiErr?.message ?? 'Erreur lors du calcul. Réessayez.');
      addToast({ type: 'error', message: msg });
      setPanel({ mode: 'form', engineId, descriptor: descriptor });
    } finally {
      if (skeletonTimerRef.current) {
        clearTimeout(skeletonTimerRef.current);
        skeletonTimerRef.current = null;
      }
      setShowSkeleton(false);
    }
  }

  async function handleEmitPv() {
    if (panel.mode !== 'result' && panel.mode !== 'view') return;
    const calcId = panel.calc.id;

    setEmittingPv(true);
    try {
      const pv = await emitPv(orgId ?? '', projetId, { calcResultId: calcId });
      setPvModalOpen(false);
      addToast({
        type: 'success',
        message: `PV ${pv.number} émis et scellé.`,
      });
      // Rafraîchir la liste (le calcul a maintenant un pvId)
      await loadData();
      router.push(`/app/${orgSlug}/projets/${projetId}/pv`);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      addToast({ type: 'error', message: apiErr?.message ?? "Erreur d'émission du PV." });
    } finally {
      setEmittingPv(false);
    }
  }

  const currentCalc =
    panel.mode === 'result' || panel.mode === 'view' ? panel.calc : null;
  const isExpired = entitlements?.expired ?? false;
  const isQuotaExhausted = !isExpired && (entitlements?.quota.remaining ?? 1) <= 0;

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 48px - 44px)',
        overflow: 'hidden',
      }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Colonne gauche — liste des calculs                               */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="calculs-list-col"
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--surface-canvas)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* En-tête colonne */}
        <div
          style={{
            padding: '12px 12px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Plus size={14} strokeWidth={1.5} aria-hidden="true" />}
            onClick={() => {
              setPanel({ mode: 'select-engine' });
              setMobileDrillDown(true);
            }}
            disabled={isExpired || isQuotaExhausted}
            style={{ width: '100%' }}
          >
            Nouveau calcul
          </Button>

          {/* Bandeau quota */}
          {entitlements &&
            !isExpired &&
            entitlements.quota.remaining <= 10 &&
            entitlements.quota.remaining > 0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  background: '#fff8e7',
                  borderRadius: 'var(--radius-base)',
                  fontSize: 'var(--text-xs)',
                  color: '#8b6000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <AlertCircle size={12} strokeWidth={1.5} aria-hidden="true" />
                {entitlements.quota.remaining} calcul(s) restant(s)
              </div>
            )}

          {/* Bandeau expiré */}
          {isExpired && (
            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: '6px 8px',
                background: 'var(--status-fail-bg)',
                borderRadius: 'var(--radius-base)',
                fontSize: 'var(--text-xs)',
                color: 'var(--status-fail-tx)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertCircle size={12} strokeWidth={1.5} aria-hidden="true" />
              Abonnement expiré — lecture seule
            </div>
          )}

          {/* Bandeau quota épuisé */}
          {isQuotaExhausted && (
            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: '6px 8px',
                background: 'var(--status-fail-bg)',
                borderRadius: 'var(--radius-base)',
                fontSize: 'var(--text-xs)',
                color: 'var(--status-fail-tx)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertCircle size={12} strokeWidth={1.5} aria-hidden="true" />
              Quota épuisé ({entitlements?.quota.remaining} restant)
            </div>
          )}
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px' }}>
          {loadingList && (
            <div aria-busy="true" aria-label="Chargement des calculs">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="row" style={{ marginBottom: 8 }} />
              ))}
            </div>
          )}

          {!loadingList && listError && (
            <EmptyState
              variant="network-err"
              title="Impossible de charger"
              description={listError}
              ctaLabel="Réessayer"
              onCta={loadData}
            />
          )}

          {!loadingList && !listError && calculs.length === 0 && (
            <EmptyState
              variant="blank"
              title="Aucun calcul"
              description="Créez un premier calcul pour ce projet."
              ctaLabel="Nouveau calcul"
              onCta={() => {
                setPanel({ mode: 'select-engine' });
                setMobileDrillDown(true);
              }}
            />
          )}

          {!loadingList && !listError && calculs.length > 0 && (
            <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {calculs.map((calc) => {
                const isSelected =
                  (panel.mode === 'result' || panel.mode === 'view') &&
                  panel.calc.id === calc.id;
                return (
                  <li key={calc.id}>
                    <button
                      data-testid={`calc-row-${calc.id}`}
                      onClick={() => {
                        setPanel({ mode: 'view', calc });
                        setMobileDrillDown(true);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        width: '100%',
                        padding: '10px 10px',
                        background: isSelected
                          ? 'var(--state-selected-bg)'
                          : 'transparent',
                        border: 'none',
                        borderLeft: isSelected
                          ? '3px solid var(--struct-petrole)'
                          : '3px solid transparent',
                        borderRadius: 'var(--radius-base)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: 4,
                        transition: `background var(--dur-fast) var(--ease-state)`,
                      }}
                      onMouseOver={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background =
                            'var(--row-hover-bg)';
                      }}
                      onMouseOut={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background =
                            'transparent';
                      }}
                      aria-pressed={isSelected}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <DomainTag
                          domain={ENGINE_DOMAIN[calc.engineId] ?? 'road'}
                          size="compact"
                        />
                        <Badge
                          variant={
                            calc.status === 'DONE'
                              ? 'recalculable'
                              : calc.status === 'ERROR'
                                ? 'erreur'
                                : 'neutre'
                          }
                          label={STATUS_LABELS[calc.status] ?? calc.status}
                        />
                        {calc.pvId && (
                          <FileCheck2
                            size={12}
                            strokeWidth={1.5}
                            aria-label="PV émis"
                            style={{ color: 'var(--struct-petrole)', flexShrink: 0 }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-primary)',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {calc.label}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{calc.engineId}</span>
                        <span>{relDate(calc.updatedAt)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Panneau droit                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="calculs-panel"
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--surface-base)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Bouton retour mobile */}
        {mobileDrillDown && (
          <button
            className="mobile-back-btn"
            onClick={() => setMobileDrillDown(false)}
            style={{
              display: 'none',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            Retour à la liste
          </button>
        )}

        {/* Panneau vide */}
        {panel.mode === 'empty' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
              minHeight: 300,
            }}
          >
            <EmptyState
              variant="pre-calc"
              title="Sélectionnez ou créez un calcul"
              description="Choisissez un calcul existant dans la liste ou créez-en un nouveau."
            />
          </div>
        )}

        {/* Sélecteur de moteur */}
        {panel.mode === 'select-engine' && (
          <EngineSelector
            entitlements={entitlements}
            onSelect={handleSelectEngine}
            onCancel={() => setPanel({ mode: 'empty' })}
          />
        )}

        {/* Formulaire */}
        {panel.mode === 'form' && (
          <CalcForm
            descriptor={panel.descriptor}
            formValues={formValues}
            formErrors={formErrors}
            calcLabel={calcLabel}
            onLabelChange={setCalcLabel}
            onFieldChange={(key, val) => {
              setFormValues((prev) => ({ ...prev, [key]: val }));
              if (formErrors[key]) {
                setFormErrors((prev) => {
                  const n = { ...prev };
                  delete n[key];
                  return n;
                });
              }
            }}
            onSubmit={handleRunCalc}
            onBack={() => setPanel({ mode: 'select-engine' })}
          />
        )}

        {/* En cours */}
        {panel.mode === 'running' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 48,
              gap: 16,
            }}
          >
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              Calcul en cours
            </div>
            {showSkeleton && (
              <>
                <Loader2
                  size={24}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{
                    animation: 'spin 1s linear infinite',
                    color: 'var(--struct-petrole)',
                  }}
                />
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  Calcul en cours — {panel.label}
                </p>
                <Skeleton
                  variant="output-table"
                  style={{ width: '100%', maxWidth: 600 }}
                />
              </>
            )}
          </div>
        )}

        {/* Résultats — succès ou vue d'un ancien calcul */}
        {(panel.mode === 'result' || panel.mode === 'view') && (
          <CalcResults
            calc={panel.calc}
            entitlements={entitlements}
            resultRef={resultRef}
            onEmitPv={() => setPvModalOpen(true)}
            isExpired={isExpired}
            isQuotaExhausted={isQuotaExhausted}
          />
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Modale émission PV (C-02)                                       */}
      {/* ---------------------------------------------------------------- */}
      {currentCalc && (
        <Modal
          open={pvModalOpen}
          onClose={() => {
            if (!emittingPv) setPvModalOpen(false);
          }}
          title="Émettre et sceller un PV"
          size="md"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setPvModalOpen(false)}
                disabled={emittingPv}
              >
                Annuler
              </Button>
              <Button
                variant="action"
                size="md"
                loading={emittingPv}
                onClick={handleEmitPv}
              >
                {emittingPv ? 'Scellement en cours…' : 'Émettre et sceller le PV'}
              </Button>
            </div>
          }
        >
          <PvRecap calc={currentCalc} />
        </Modal>
      )}

      {/* Styles responsive */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 1279px) {
          .calculs-list-col {
            position: absolute;
            left: 0; top: 0; bottom: 0;
            z-index: 5;
            display: ${mobileDrillDown ? 'none' : 'flex'} !important;
            width: 100% !important;
            border-right: none !important;
          }
          .calculs-panel {
            display: ${mobileDrillDown ? 'flex' : 'none'} !important;
          }
          .mobile-back-btn { display: flex !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sélecteur de moteur (C-01)
// ---------------------------------------------------------------------------

const ENGINE_GROUPS: Array<{ id: Domain; label: string; engines: string[] }> = [
  {
    id: 'road',
    label: 'Chaussées',
    engines: ['burmister'],
  },
  {
    id: 'foundation',
    label: 'Fondations',
    engines: ['terzaghi', 'casagrande', 'geoplaque'],
  },
  {
    id: 'lab',
    label: 'Sol & Labo',
    engines: ['pressiometre', 'fastlab'],
  },
];

function EngineSelector({
  entitlements,
  onSelect,
  onCancel,
}: {
  entitlements: EntitlementsResponse | null;
  onSelect: (id: string) => void;
  onCancel: () => void;
}) {
  const modules = entitlements?.modules ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <h2
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          Sélectionner un moteur
        </h2>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
      </div>

      {ENGINE_GROUPS.map((group) => (
        <div key={group.id} style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <DomainTag domain={group.id} size="compact" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.engines.map((engineId) => {
              const desc = findDescriptor(engineId);
              if (!desc) return null;
              const unlocked = modules.includes(engineId) || modules.length === 0;
              return (
                <button
                  key={engineId}
                  data-testid={`engine-item-${engineId}`}
                  data-locked={unlocked ? 'false' : 'true'}
                  onClick={() => unlocked && onSelect(engineId)}
                  disabled={!unlocked}
                  aria-disabled={!unlocked}
                  title={!unlocked ? 'Non inclus dans votre abonnement' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '12px 14px',
                    background: 'var(--surface-base)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--elevation-card)',
                    border: 'none',
                    cursor: unlocked ? 'pointer' : 'not-allowed',
                    textAlign: 'left',
                    opacity: unlocked ? 1 : 0.55,
                    transition: `background var(--dur-fast) var(--ease-state)`,
                  }}
                  onMouseOver={(e) => {
                    if (unlocked)
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--row-hover-bg)';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'var(--surface-base)';
                  }}
                >
                  <Calculator
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    style={{
                      color: 'var(--struct-petrole)',
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {desc.label}
                      </span>
                      {!unlocked && (
                        <span
                          data-testid={`engine-lock-${engineId}`}
                          style={{ display: 'inline-flex' }}
                        >
                          <Lock
                            size={12}
                            strokeWidth={1.5}
                            aria-hidden="true"
                            style={{ color: 'var(--text-muted)' }}
                          />
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-secondary)',
                        marginTop: 2,
                      }}
                    >
                      {desc.norme}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaire de saisie dynamique (Lot 3 — depuis engine-descriptors)
// ---------------------------------------------------------------------------

function CalcForm({
  descriptor,
  formValues,
  formErrors,
  calcLabel,
  onLabelChange,
  onFieldChange,
  onSubmit,
  onBack,
}: {
  descriptor: EngineDescriptor;
  formValues: Record<string, string>;
  formErrors: Record<string, string>;
  calcLabel: string;
  onLabelChange: (v: string) => void;
  onFieldChange: (key: string, value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto', width: '100%' }}>
      {/* Fil d'Ariane interne */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 0,
          }}
        >
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          Moteurs
        </button>
        <span style={{ color: 'var(--text-muted)' }}>/</span>
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {descriptor.label}
        </span>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Libellé du calcul */}
          <Input
            id="calc-label"
            label="Libellé du calcul"
            value={calcLabel}
            onChange={(e) => onLabelChange(e.target.value)}
            error={formErrors['_label']}
            placeholder={`ex. ${descriptor.label} — variante A`}
            required
            autoFocus
          />

          {/* Champs du descripteur */}
          {descriptor.fields.map((field) => {
            if (field.type === 'section') {
              return (
                <div
                  key={field.key}
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: 'var(--struct-petrole)',
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--border-subtle)',
                    marginTop: 8,
                  }}
                >
                  {field.label}
                </div>
              );
            }

            if (field.type === 'select' && field.options) {
              return (
                <Select
                  key={field.key}
                  id={`field-${field.key}`}
                  label={
                    field.label +
                    (field.unit ? ` (${field.unit})` : '') +
                    (field.optional ? '' : ' *')
                  }
                  value={formValues[field.key] ?? ''}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                  error={formErrors[field.key]}
                  hint={field.hint}
                >
                  <option value="">— Choisir —</option>
                  {field.options!.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              );
            }

            return (
              <Input
                key={field.key}
                id={`field-${field.key}`}
                label={
                  field.label +
                  (field.unit ? ` (${field.unit})` : '') +
                  (field.optional ? '' : ' *')
                }
                type={field.type === 'number' ? 'number' : 'text'}
                value={formValues[field.key] ?? ''}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                error={formErrors[field.key]}
                hint={field.hint}
                min={field.min}
                max={field.max}
                step={field.step ?? (field.type === 'number' ? 'any' : undefined)}
                required={!field.optional}
              />
            );
          })}

          {/* Bouton calcul */}
          <Button
            type="submit"
            variant="action"
            size="lg"
            style={{ width: '100%', marginTop: 8 }}
          >
            Lancer le calcul
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Résultats de calcul (B-17)
// ---------------------------------------------------------------------------

interface CalcOutputRow {
  label: string;
  value: number;
  unit: string;
}

function CalcResults({
  calc,
  entitlements: _entitlements, // reçu en prop — câblage du gating affichage résultat prévu en P2
  resultRef,
  onEmitPv,
  isExpired,
  isQuotaExhausted,
}: {
  calc: CalcResult;
  entitlements: EntitlementsResponse | null;
  resultRef: React.RefObject<HTMLDivElement | null>;
  onEmitPv: () => void;
  isExpired: boolean;
  isQuotaExhausted: boolean;
}) {
  const output = calc.output as { verdict?: string; rows?: CalcOutputRow[] } | null;
  const isDone = calc.status === 'DONE';
  const hasOutput = isDone && output != null;

  // CTA Émettre PV : présent SEULEMENT si statut=DONE et pas déjà un PV
  const showEmitPv = isDone && !calc.pvId && !isExpired && !isQuotaExhausted;

  return (
    <div
      ref={resultRef}
      tabIndex={-1}
      style={{
        padding: 24,
        maxWidth: 720,
        margin: '0 auto',
        width: '100%',
        outline: 'none',
        animation: 'fadeIn var(--dur-base) var(--ease-entrance)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            {calc.label}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <DomainTag domain={ENGINE_DOMAIN[calc.engineId] ?? 'road'} />
            <Badge
              variant={
                isDone ? 'recalculable' : calc.status === 'ERROR' ? 'erreur' : 'neutre'
              }
              label={STATUS_LABELS[calc.status]}
            />
            {calc.pvId && <Badge variant="scelle" label="PV émis" />}
          </div>
        </div>

        {/* CTA Émettre PV — conditionnel (absent si pas DONE) */}
        {showEmitPv && (
          <Button
            variant="action"
            size="md"
            iconLeft={<FileCheck2 size={16} strokeWidth={1.5} aria-hidden="true" />}
            onClick={onEmitPv}
          >
            Émettre un PV
          </Button>
        )}
      </div>

      {/* Verdict */}
      {hasOutput && output?.verdict && (
        <div style={{ marginBottom: 16 }}>
          <VerdictBanner verdict={output.verdict === 'PASS' ? 'pass' : 'fail'} />
        </div>
      )}

      {/* Résultats */}
      {hasOutput && output?.rows && (
        <div
          style={{
            background: 'var(--surface-base)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-card)',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'var(--text-sm)',
            }}
            aria-label="Résultats de calcul"
          >
            <thead>
              <tr
                style={{
                  background: 'var(--surface-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <th
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    width: '55%',
                  }}
                >
                  Paramètre
                </th>
                <th
                  style={{
                    padding: '10px 14px',
                    textAlign: 'right',
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                  }}
                >
                  Valeur
                </th>
                <th
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    width: 80,
                  }}
                >
                  Unité
                </th>
              </tr>
            </thead>
            <tbody>
              {output.rows.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom:
                      i < output.rows!.length - 1
                        ? '1px solid var(--border-subtle)'
                        : 'none',
                    transition: `background var(--dur-fast) var(--ease-state)`,
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'var(--row-hover-bg)';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '';
                  }}
                >
                  <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>
                    {row.label}
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {fmt(row.value)}
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {row.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Calcul brouillon ou erreur */}
      {!hasOutput && (
        <EmptyState
          variant="pre-calc"
          title={calc.status === 'ERROR' ? 'Calcul en erreur' : 'Calcul non encore lancé'}
          description={
            calc.status === 'ERROR'
              ? 'Ce calcul a rencontré une erreur. Vérifiez les paramètres et relancez.'
              : 'Remplissez le formulaire et lancez le calcul pour voir les résultats.'
          }
          minHeight={200}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fadeIn { from { opacity: 1; } to { opacity: 1; } }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Récapitulatif PV (C-02)
// ---------------------------------------------------------------------------

function PvRecap({ calc }: { calc: CalcResult }) {
  const output = calc.output as { verdict?: string; rows?: CalcOutputRow[] } | null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--surface-canvas)',
          borderRadius: 'var(--radius-base)',
          fontSize: 'var(--text-sm)',
        }}
      >
        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
          Calcul source
        </div>
        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{calc.label}</div>
        <div
          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}
        >
          Moteur : {calc.engineId} · Statut : {STATUS_LABELS[calc.status]}
        </div>
      </div>

      {output?.rows && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <strong>{output.rows.length} résultat(s)</strong> seront scellés dans ce PV.
        </div>
      )}

      {/* Note d'intégrité honnête (wording validé — mémoire roadsen-pv-seal-legal-wording) */}
      <div
        style={{
          padding: '10px 12px',
          background: '#f0ede9',
          borderRadius: 'var(--radius-base)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          borderLeft: '3px solid var(--accent-brand)',
        }}
      >
        <strong>{"Note d'intégrité :"}</strong>
        {
          " Ce PV sera scellé par un code HMAC calculé côté serveur. Le sceau atteste que les paramètres et résultats n'ont pas été modifiés après émission. Il ne constitue pas une signature électronique qualifiée au sens de la loi 2008-08."
        }
      </div>
    </div>
  );
}
