'use client';

/**
 * UserDetailClient — fiche utilisateur ACTIONNABLE (SUPERADMIN-only).
 *
 * Extrait de app/admin/users/[userId]/page.tsx (Server Component) pour porter
 * les gestionnaires d'événements (crash SSR sinon — cf. patron OrgDetailClient).
 *
 * Actions :
 * - Éditer l'identité (email + nom) — PATCH /admin/users/:id (409 email dupliqué)
 * - Reset mot de passe / Activer-Désactiver — endpoints Vague 2 existants
 * - Rôle plateforme (SUPERADMIN/SUPPORT/aucun) — PATCH /admin/users/:id/platform-role
 *   (409 dernier SUPERADMIN, 400 auto-rétrogradation)
 * - Appartenances : retirer d'une org (DELETE .../members/:userId) ; ajouter à
 *   une org (recherche org + rôle → POST .../members)
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { OrgStatusBadge } from './OrgStatusBadge';
import { clientSearchOrgs } from '@/lib/api/admin-client';
import {
  clientAddMember,
  clientRemoveMember,
  clientResetPassword,
  clientSetPlatformRole,
  clientSetUserActive,
  clientUpdateUserIdentity,
  type PlatformRoleValue,
} from '@/lib/api/admin-mutations-client';
import type { AdminOrgListItem, AdminUserDetailView, AdminUserOrgView } from '@/lib/api/admin-server';

interface UserDetailClientProps {
  user: AdminUserDetailView;
}

export function UserDetailClient({ user: initialUser }: UserDetailClientProps) {
  const [user, setUser] = useState<AdminUserDetailView>(initialUser);
  const [resetOpen, setResetOpen] = useState(false);
  const [addOrgOpen, setAddOrgOpen] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);

  async function toggleActive() {
    const next = !user.isActive;
    if (!window.confirm(`${next ? 'Réactiver' : 'Désactiver'} le compte ${user.email} ?`)) return;
    setActiveError(null);
    setActiveLoading(true);
    try {
      await clientSetUserActive(user.userId, next, crypto.randomUUID());
      setUser((u) => ({ ...u, isActive: next }));
    } catch (err) {
      setActiveError(extractMessage(err));
    } finally {
      setActiveLoading(false);
    }
  }

  function handleRemoved(orgId: string) {
    setUser((u) => ({ ...u, orgs: u.orgs.filter((o) => o.orgId !== orgId) }));
  }

  function handleAdded(newOrg: AdminUserOrgView) {
    setUser((u) => ({ ...u, orgs: [...u.orgs, newOrg] }));
  }

  function handleIdentityUpdated(email: string, fullName: string) {
    setUser((u) => ({ ...u, email, fullName }));
  }

  function handleRoleUpdated(platformRole: PlatformRoleValue) {
    setUser((u) => ({ ...u, platformRole }));
  }

  return (
    <div style={{ padding: '16px 24px 32px' }}>
      {/* Fil d'Ariane */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 16 }}>
        <Link href="/admin/users" className="admin-breadcrumb-link" style={{ color: 'var(--text-link)', textDecoration: 'none' }}>
          Utilisateurs
        </Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: 'var(--text-primary)' }}>{user.fullName}</span>
      </div>

      {/* En-tête identité */}
      <div style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elevation-card)', padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{user.fullName}</h1>
          {user.platformRole && (
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-base)', background: 'var(--struct-petrole, #1f4e4a)', color: '#fff' }}>
              {user.platformRole}
            </span>
          )}
          <span
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              padding: '2px 7px',
              borderRadius: 'var(--radius-base)',
              color: user.isActive ? 'var(--status-pass-tx)' : 'var(--text-muted)',
              background: user.isActive ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)',
            }}
          >
            {user.isActive ? 'Actif' : 'Inactif'}
          </span>
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{user.email}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          ID : {user.userId}
        </div>

        {/* Actions globales */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)}>
            Reset mot de passe
          </Button>
          <Button
            variant={user.isActive ? 'danger' : 'secondary'}
            size="sm"
            onClick={toggleActive}
            loading={activeLoading}
            disabled={activeLoading}
          >
            {user.isActive ? 'Désactiver' : 'Réactiver'}
          </Button>
        </div>
        {activeError && (
          <p role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--status-fail-tx)', marginTop: 8 }}>
            {activeError}
          </p>
        )}
      </div>

      {/* Éditer l'identité */}
      <IdentityEditor user={user} onUpdated={handleIdentityUpdated} />

      {/* Rôle plateforme */}
      <PlatformRoleEditor user={user} onUpdated={handleRoleUpdated} />

      {/* Appartenances */}
      <div style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elevation-card)', overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Organisations ({user.orgs.length})
          </span>
          <Button variant="action" size="sm" onClick={() => setAddOrgOpen(true)}>
            Ajouter à une org
          </Button>
        </div>
        {user.orgs.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Cet utilisateur n&apos;est membre d&apos;aucune organisation.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ background: 'rgba(31,78,74,0.04)', borderBottom: '1px solid var(--border-subtle)' }}>
                {['Organisation', 'Rôle', 'Statut membre', 'Statut org', 'Actions'].map((h) => (
                  <th key={h} scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {user.orgs.map((o) => (
                <OrgMembershipRow key={o.orgId} userId={user.userId} org={o} onRemoved={handleRemoved} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal reset mot de passe */}
      <ResetPasswordModal open={resetOpen} userId={user.userId} email={user.email} onClose={() => setResetOpen(false)} />

      {/* Modal ajout à une org */}
      <AddToOrgModal
        open={addOrgOpen}
        userId={user.userId}
        existingOrgIds={user.orgs.map((o) => o.orgId)}
        onClose={() => setAddOrgOpen(false)}
        onAdded={handleAdded}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Éditeur d'identité (email + nom)
// ---------------------------------------------------------------------------

function IdentityEditor({
  user,
  onUpdated,
}: {
  user: AdminUserDetailView;
  onUpdated: (email: string, fullName: string) => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.fullName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const original = { email: user.email, fullName: user.fullName };
  const canSubmit = canSubmitIdentityEdit({ email, fullName, original }) && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await clientUpdateUserIdentity(
        user.userId,
        { email: email.trim(), fullName: fullName.trim() },
        crypto.randomUUID(),
      );
      onUpdated(email.trim(), fullName.trim());
      setSaved(true);
    } catch (err) {
      if (isConflict(err)) {
        setError('Cet email est déjà utilisé par un autre compte.');
      } else {
        setError(extractMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elevation-card)', padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 14px' }}>
        Éditer l&apos;identité
      </h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label htmlFor="ue-email" style={labelStyle}>
            Email
          </label>
          <input
            id="ue-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
            style={fieldStyle}
          />
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label htmlFor="ue-fullname" style={labelStyle}>
            Nom complet
          </label>
          <input
            id="ue-fullname"
            type="text"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setSaved(false);
            }}
            style={fieldStyle}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Button variant="action" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={loading}>
          Enregistrer
        </Button>
        {saved && !error && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-pass-tx)' }}>✓ Identité mise à jour.</span>
        )}
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--status-fail-tx)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Prédicat de soumission de l'édition d'identité — exporté pour les tests (DoD §9).
 * Valide la forme (email/nom) ET exige un changement réel (anti no-op).
 */
export function canSubmitIdentityEdit({
  email,
  fullName,
  original,
}: {
  email: string;
  fullName: string;
  original: { email: string; fullName: string };
}): boolean {
  const emailValid = EMAIL_RE.test(email.trim());
  const nameValid = fullName.trim().length > 0;
  const changed = email.trim() !== original.email.trim() || fullName.trim() !== original.fullName.trim();
  return emailValid && nameValid && changed;
}

// ---------------------------------------------------------------------------
// Éditeur de rôle plateforme
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: { value: PlatformRoleValue; label: string }[] = [
  { value: null, label: 'Aucun (révoquer)' },
  { value: 'SUPERADMIN', label: 'SUPERADMIN' },
  { value: 'SUPPORT', label: 'SUPPORT' },
];

function PlatformRoleEditor({
  user,
  onUpdated,
}: {
  user: AdminUserDetailView;
  onUpdated: (role: PlatformRoleValue) => void;
}) {
  const current = (user.platformRole ?? null) as PlatformRoleValue;
  const [selected, setSelected] = useState<PlatformRoleValue>(current);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = canSubmitPlatformRole({ selected, current }) && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const result = await clientSetPlatformRole(user.userId, { role: selected }, crypto.randomUUID());
      onUpdated(result.platformRole);
    } catch (err) {
      if (isConflict(err)) {
        setError(`Impossible de retirer ce rôle : il doit rester au moins un SUPERADMIN actif. (${extractMessage(err)})`);
      } else if (isBadRequest(err)) {
        setError(`Impossible de retirer ton propre accès. (${extractMessage(err)})`);
      } else {
        setError(extractMessage(err));
      }
      // Revenir à la valeur courante en cas d'échec
      setSelected(current);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elevation-card)', padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 14px' }}>
        Rôle plateforme
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <select
          aria-label="Rôle plateforme"
          value={selected ?? ''}
          disabled={loading}
          onChange={(e) => setSelected((e.target.value || null) as PlatformRoleValue)}
          style={{ ...fieldStyle, width: 'auto', minWidth: 220 }}
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value ?? ''}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button variant="action" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={loading}>
          Enregistrer
        </Button>
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--status-fail-tx)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Prédicat de soumission du rôle plateforme — exporté pour les tests (DoD §9).
 * Anti no-op : n'autorise que si la sélection diffère du rôle actuel (les
 * invariants anti-lockout réels sont gravés côté base — R0013/R0014).
 */
export function canSubmitPlatformRole({
  selected,
  current,
}: {
  selected: PlatformRoleValue;
  current: PlatformRoleValue;
}): boolean {
  return selected !== current;
}

// ---------------------------------------------------------------------------
// Ligne d'appartenance à une org (retrait)
// ---------------------------------------------------------------------------

function OrgMembershipRow({
  userId,
  org,
  onRemoved,
}: {
  userId: string;
  org: AdminUserOrgView;
  onRemoved: (orgId: string) => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleRemove() {
    setLoading(true);
    setError(undefined);
    try {
      await clientRemoveMember(org.orgId, userId, crypto.randomUUID());
      onRemoved(org.orgId);
      setShowConfirm(false);
    } catch (err) {
      setError(isConflict(err) ? `Retrait refusé : ${extractMessage(err)}` : extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <td style={{ padding: '10px 16px' }}>
          <Link href={`/admin/orgs/${org.orgId}`} className="admin-breadcrumb-link" style={{ color: 'var(--text-link)', textDecoration: 'none' }}>
            {org.orgName}
          </Link>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{org.orgSlug}</div>
        </td>
        <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>{org.role}</td>
        <td style={{ padding: '10px 16px' }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--radius-base)', color: org.active ? 'var(--status-pass-tx)' : 'var(--text-muted)', background: org.active ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)' }}>
            {org.active ? 'Actif' : 'Suspendu'}
          </span>
        </td>
        <td style={{ padding: '10px 16px' }}>
          <OrgStatusBadge status={org.orgStatus as 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'} />
        </td>
        <td style={{ padding: '10px 16px' }}>
          <Button variant="danger" size="sm" onClick={() => setShowConfirm(true)} aria-label={`Retirer de ${org.orgName}`}>
            Retirer
          </Button>
        </td>
      </tr>
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Retirer de l'organisation"
        size="sm"
        error={error}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)} disabled={loading}>
              Annuler
            </Button>
            <Button variant="danger" size="sm" onClick={handleRemove} loading={loading} disabled={loading}>
              Confirmer le retrait
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}>
          Retirer cet utilisateur de <strong>{org.orgName}</strong> ?
        </p>
        {org.role === 'OWNER' && (
          <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-fail-tx)', marginTop: 10, fontWeight: 500 }}>
            Ce membre est OWNER. Retirer le dernier OWNER actif est refusé (409).
          </p>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal reset mot de passe (fiche utilisateur)
// ---------------------------------------------------------------------------

function ResetPasswordModal({
  open,
  userId,
  email,
  onClose,
}: {
  open: boolean;
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  function handleClose() {
    setNewPassword('');
    setError(undefined);
    setDone(false);
    onClose();
  }

  async function handleSubmit() {
    setLoading(true);
    setError(undefined);
    try {
      await clientResetPassword(userId, { newPassword }, crypto.randomUUID());
      setDone(true);
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Réinitialiser le mot de passe"
      description={`Compte : ${email}`}
      size="sm"
      error={error}
      footer={
        done ? (
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Fermer
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={loading}>
              Annuler
            </Button>
            <Button
              variant="action"
              size="sm"
              onClick={handleSubmit}
              disabled={newPassword.length < 12 || loading}
              loading={loading}
            >
              Réinitialiser
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-pass-tx)', margin: 0 }}>
          ✓ Mot de passe réinitialisé. Communique-le par un canal sûr — il n&apos;est stocké nulle part.
        </p>
      ) : (
        <div>
          <label htmlFor="ud-reset-pw" style={labelStyle}>
            Nouveau mot de passe (≥ 12 caractères)
          </label>
          <input
            id="ud-reset-pw"
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="off"
            style={fieldStyle}
          />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal « Ajouter à une org » — recherche org + rôle
// ---------------------------------------------------------------------------

function AddToOrgModal({
  open,
  userId,
  existingOrgIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  userId: string;
  existingOrgIds: string[];
  onClose: () => void;
  onAdded: (org: AdminUserOrgView) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminOrgListItem[]>([]);
  const [picked, setPicked] = useState<AdminOrgListItem | null>(null);
  const [role, setRole] = useState<'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER'>('ENGINEER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleClose() {
    setQ('');
    setResults([]);
    setPicked(null);
    setError(undefined);
    onClose();
  }

  async function search(value: string) {
    setQ(value);
    setPicked(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const orgs = await clientSearchOrgs(value.trim());
      setResults(orgs.filter((o) => !existingOrgIds.includes(o.id)).slice(0, 8));
    } catch {
      setResults([]);
    }
  }

  async function handleSubmit() {
    if (!picked) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientAddMember(picked.id, { userId, role }, crypto.randomUUID());
      onAdded({
        orgId: detail.org.id,
        orgName: detail.org.name,
        orgSlug: detail.org.slug,
        orgStatus: detail.org.status,
        role,
        active: true,
      });
      handleClose();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Ajouter à une organisation"
      description="Recherche une org (≥ 2 caractères) puis attribue un rôle."
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={loading}>
            Annuler
          </Button>
          <Button variant="action" size="sm" onClick={handleSubmit} disabled={!picked || loading} loading={loading}>
            Ajouter
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="Nom ou slug…"
          aria-label="Rechercher une organisation"
          style={fieldStyle}
        />
        {results.length > 0 && !picked && (
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-base)', maxHeight: 180, overflowY: 'auto' }}>
            {results.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPicked(o)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{ fontWeight: 500 }}>{o.name}</span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{o.slug}</span>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
            Sélectionné : <strong>{picked.name}</strong>{' '}
            <button type="button" onClick={() => setPicked(null)} style={{ marginLeft: 6, fontSize: 'var(--text-xs)', color: 'var(--text-link)', background: 'none', border: 'none', cursor: 'pointer' }}>
              changer
            </button>
          </div>
        )}
        <div>
          <label style={labelStyle}>Rôle</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER')}
            style={fieldStyle}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="ENGINEER">ENGINEER (ingénieur)</option>
            <option value="TECHNICIAN">TECHNICIAN (labo)</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles + helpers partagés
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--radius-base)',
  border: '1px solid var(--border-default)',
  fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-sans)',
  background: 'var(--surface-canvas)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

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
  return err !== null && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 409;
}

function isBadRequest(err: unknown): boolean {
  return err !== null && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400;
}
