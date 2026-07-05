'use client';

/**
 * OrgSuspendModal — modal forte de suspension/réactivation d'une organisation.
 *
 * Suspension : l'opérateur doit recopier le slug de l'org pour confirmer.
 * Avertissement explicite : l'effet est réel au PROCHAIN APPEL des membres
 * (sessions JWT actives expirent naturellement).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { OrgStatusBadge } from './OrgStatusBadge';
import { clientSetOrgStatus } from '@/lib/api/admin-mutations-client';
import type { AdminOrgDetail, OrgStatus } from '@/lib/api/admin-server';

interface OrgSuspendModalProps {
  open: boolean;
  orgId: string;
  orgSlug: string;
  currentStatus: OrgStatus;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}

export function OrgSuspendModal({
  open,
  orgId,
  orgSlug,
  currentStatus,
  onClose,
  onMutated,
}: OrgSuspendModalProps) {
  const intentionKeyRef = useRef<string | null>(null);

  const [slugInput, setSlugInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const slugId = useId();

  const isSuspension = currentStatus === 'ACTIVE';
  const nextStatus: OrgStatus = isSuspension ? 'SUSPENDED' : 'ACTIVE';

  useEffect(() => {
    if (open) {
      if (!intentionKeyRef.current) {
        intentionKeyRef.current = crypto.randomUUID();
      }
      setSlugInput('');
      setError(undefined);
    } else {
      intentionKeyRef.current = null;
    }
  }, [open]);

  const slugConfirmed = canConfirmSuspend(slugInput, orgSlug);
  const canSubmit = (isSuspension ? slugConfirmed : true) && !loading;

  async function handleConfirm() {
    if (!canSubmit || !intentionKeyRef.current) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientSetOrgStatus(
        orgId,
        { status: nextStatus },
        intentionKeyRef.current,
      );
      onMutated(detail);
      onClose();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isSuspension ? 'Suspendre l\'organisation' : 'Réactiver l\'organisation'}
      size="sm"
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant={isSuspension ? 'danger' : 'action'}
            size="sm"
            onClick={handleConfirm}
            disabled={!canSubmit}
            loading={loading}
          >
            {isSuspension ? 'Suspendre' : 'Réactiver'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Statut actuel → suivant */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OrgStatusBadge status={currentStatus} />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
          <OrgStatusBadge status={nextStatus} />
        </div>

        {isSuspension ? (
          <>
            {/* Avertissement fort */}
            <div
              role="alert"
              style={{
                background: 'var(--status-fail-bg)',
                border: '1px solid rgba(220,38,38,0.25)',
                borderRadius: 'var(--radius-base)',
                padding: '10px 12px',
                fontSize: 13,
                color: 'var(--status-fail-tx)',
                lineHeight: 1.5,
              }}
            >
              <strong>Tous les membres perdent l&apos;accès au PROCHAIN APPEL.</strong>
              <br />
              Les sessions JWT actives expirent naturellement (aucune révocation immédiate).
              Les calculs en cours peuvent se terminer.
            </div>

            {/* Recopie du slug */}
            <div>
              <label
                htmlFor={slugId}
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: 4,
                }}
              >
                Pour confirmer, saisissez le slug de l&apos;organisation :{' '}
                <code
                  style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'rgba(0,0,0,0.06)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                  }}
                >
                  {orgSlug}
                </code>
              </label>
              <input
                id={slugId}
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder={orgSlug}
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-base)',
                  border: `1px solid ${
                    slugInput.length > 0 && !slugConfirmed
                      ? 'var(--status-fail-tx)'
                      : 'var(--border-default)'
                  }`,
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--surface-canvas)',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box' as const,
                }}
                aria-invalid={slugInput.length > 0 && !slugConfirmed ? 'true' : 'false'}
                aria-describedby={`${slugId}-hint`}
              />
              {slugInput.length > 0 && !slugConfirmed && (
                <p
                  id={`${slugId}-hint`}
                  role="alert"
                  style={{ fontSize: 12, color: 'var(--status-fail-tx)', marginTop: 3 }}
                >
                  Le slug ne correspond pas.
                </p>
              )}
            </div>
          </>
        ) : (
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Réactiver l&apos;organisation{' '}
            <strong>
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(0,0,0,0.06)',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                {orgSlug}
              </code>
            </strong>{' '}
            ? Les membres retrouvent l&apos;accès au prochain appel.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Prédicat de validation exporté (testable en isolation — DoD §9)
// ---------------------------------------------------------------------------

/**
 * Vérifie que l'opérateur a recopié exactement le slug pour confirmer une suspension.
 * Exporté pour que les tests couvrent le VRAI prédicat utilisé dans le composant.
 */
export function canConfirmSuspend(slugInput: string, orgSlug: string): boolean {
  return slugInput.trim() === orgSlug;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function extractMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return 'Une erreur inattendue est survenue.';
}
