'use client';

/**
 * MemberActionsRow — actions inline sur un membre (Lot 2).
 *
 * - Changer le rôle (OWNER non proposé, anti-lockout → 409 affiché).
 * - Suspendre / Réactiver (toggle is_active) — action RÉVERSIBLE.
 * - Retirer un membre — action DÉFINITIVE (DELETE = hard delete, migration 0020) :
 *   l'appartenance à l'org est supprimée, pas juste désactivée. Le compte
 *   utilisateur global, lui, est conservé (peut être rattaché à une org plus
 *   tard). Confirmation dédiée pour ne pas confondre avec Suspendre.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  clientRemoveMember,
  clientSetMemberActive,
  clientSetMemberRole,
} from '@/lib/api/admin-mutations-client';
import type { AdminOrgDetail, OrgMemberView } from '@/lib/api/admin-server';

// Rôles attribuables (OWNER exclu, cf. backend)
const ASSIGNABLE_ROLES = ['ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

interface MemberActionsRowProps {
  orgId: string;
  member: OrgMemberView;
  onMutated: (detail: AdminOrgDetail) => void;
  /** Met à jour localement isActive d'un membre (setMemberActive renvoie {} pas le détail). */
  onActiveToggled: (userId: string, isActive: boolean) => void;
}

export function MemberActionsRow({
  orgId,
  member,
  onMutated,
  onActiveToggled,
}: MemberActionsRowProps) {
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const [activeLoading, setActiveLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);

  const isOwner = member.role === 'OWNER';

  // ---------------------------------------------------------------------------
  // Changement de rôle
  // ---------------------------------------------------------------------------

  async function handleRoleChange(newRole: AssignableRole) {
    if (roleLoading) return;
    setRoleLoading(true);
    setRoleError(null);
    const idempotencyKey = crypto.randomUUID(); // clé par tentative (action inline)
    try {
      const detail = await clientSetMemberRole(orgId, member.userId, { role: newRole }, idempotencyKey);
      onMutated(detail);
    } catch (err) {
      setRoleError(extractMessage(err));
    } finally {
      setRoleLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Suspend / Réactive
  // ---------------------------------------------------------------------------

  async function handleToggleActive() {
    if (activeLoading) return;
    setActiveLoading(true);
    setActiveError(null);
    try {
      const result = await clientSetMemberActive(orgId, member.userId, !member.isActive);
      onActiveToggled(result.userId, result.isActive);
    } catch (err) {
      setActiveError(extractMessage(err));
    } finally {
      setActiveLoading(false);
    }
  }

  return (
    <>
      {/* Cellule actions — inline dans la ligne du tableau */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Changement de rôle — OWNER non proposé */}
        {isOwner ? (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              padding: '0 4px',
            }}
          >
            OWNER (non modifiable)
          </span>
        ) : (
          <div style={{ position: 'relative' }}>
            <select
              value={member.role}
              disabled={roleLoading}
              aria-label={`Rôle de ${member.fullName}`}
              onChange={(e) => handleRoleChange(e.target.value as AssignableRole)}
              style={{
                fontSize: 12,
                padding: '3px 6px',
                borderRadius: 'var(--radius-base)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-canvas)',
                color: 'var(--text-primary)',
                cursor: roleLoading ? 'not-allowed' : 'pointer',
                opacity: roleLoading ? 0.6 : 1,
              }}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Suspend / Réactiver — réversible, accès désactivé temporairement */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleActive}
          loading={activeLoading}
          disabled={activeLoading}
          title={
            member.isActive
              ? 'Suspendre : désactive temporairement l’accès (réversible)'
              : 'Réactiver : restaure l’accès'
          }
          aria-label={
            member.isActive
              ? `Suspendre ${member.fullName}`
              : `Réactiver ${member.fullName}`
          }
        >
          {member.isActive ? 'Suspendre' : 'Réactiver'}
        </Button>

        {/* Retirer — DÉFINITIF, distinct visuellement (danger) et par le libellé */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setShowRemoveModal(true)}
          title="Retirer : suppression définitive de l’appartenance à l’organisation"
          aria-label={`Retirer définitivement ${member.fullName}`}
        >
          Retirer définitivement
        </Button>
      </div>

      {/* Erreurs inline */}
      {roleError && (
        <p
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--status-fail-tx)',
            margin: '2px 0 0',
          }}
        >
          {roleError}
        </p>
      )}
      {activeError && (
        <p
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--status-fail-tx)',
            margin: '2px 0 0',
          }}
        >
          {activeError}
        </p>
      )}

      {/* Modal confirmation retrait */}
      <RemoveMemberModal
        open={showRemoveModal}
        orgId={orgId}
        member={member}
        onClose={() => setShowRemoveModal(false)}
        onMutated={onMutated}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal de confirmation de retrait
// ---------------------------------------------------------------------------

function RemoveMemberModal({
  open,
  orgId,
  member,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  member: OrgMemberView;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  const intentionKeyRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      if (!intentionKeyRef.current) {
        intentionKeyRef.current = crypto.randomUUID();
      }
      setError(undefined);
    } else {
      intentionKeyRef.current = null;
    }
  }, [open]);

  async function handleConfirm() {
    if (loading || !intentionKeyRef.current) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientRemoveMember(orgId, member.userId, intentionKeyRef.current);
      onMutated(detail);
      onClose();
    } catch (err) {
      const msg = extractMessage(err);
      // 409 = anti-lockout dernier OWNER
      if (isConflict(err)) {
        setError(`Impossible de retirer ce membre : ${msg}`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Retirer définitivement ce membre de l'organisation ?"
      size="sm"
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            loading={loading}
            disabled={loading}
          >
            Confirmer le retrait définitif
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}>
        Retirer <strong>{member.fullName}</strong> ({member.email}) de l&apos;organisation ?
      </p>
      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          margin: '8px 0 0',
        }}
      >
        Action <strong>définitive</strong> : l&apos;appartenance à cette organisation est
        supprimée (pas une suspension). Le membre perd l&apos;accès immédiatement. Le
        compte utilisateur global est conservé et pourra être rattaché à une organisation
        plus tard si besoin — via « Ajouter un membre » ou la fiche utilisateur.
      </p>
      {member.role === 'OWNER' && (
        <p
          role="alert"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--status-fail-tx)',
            marginTop: 10,
            fontWeight: 500,
          }}
        >
          Ce membre est OWNER. Retirer le dernier OWNER actif est refusé (409).
        </p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers
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

function isConflict(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === 409
  );
}
