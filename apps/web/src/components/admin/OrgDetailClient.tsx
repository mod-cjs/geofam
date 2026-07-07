'use client';

import React, { useState } from 'react';

/**
 * Contenu interactif du détail d'une organisation : onglets Membres / Abonnement / Usage / Audit.
 *
 * Lot 1 : lecture seule.
 * Lot 2 : mutations (suspension org, top-up quota, renouvellement, entitlements,
 *         changement de rôle, suspension/retrait membre, journal d'audit).
 *
 * L'état `detail` est local : initialisé depuis les props serveur, puis mis à jour
 * après chaque mutation (les endpoints Lot 2 renvoient le détail frais).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { OrgStatusBadge } from './OrgStatusBadge';
import { SubscriptionEditor } from './SubscriptionEditor';
import { MemberActionsRow } from './MemberActionsRow';
import { OrgSuspendModal } from './OrgSuspendModal';
import { AuditTab } from './AuditTab';
import { clientSearchUsers } from '@/lib/api/admin-client';
import { clientAddMember, clientTransferOwner } from '@/lib/api/admin-mutations-client';
import type { AdminOrgDetail, AdminUserView } from '@/lib/api/admin-server';

interface OrgDetailClientProps {
  detail: AdminOrgDetail;
}

export function OrgDetailClient({ detail: initialDetail }: OrgDetailClientProps) {
  // Détail local : mis à jour après chaque mutation Lot 2
  const [detail, setDetail] = useState<AdminOrgDetail>(initialDetail);
  const [suspendOpen, setSuspendOpen] = useState(false);

  const { org, members, subscription, usage } = detail;

  function handleMutated(newDetail: AdminOrgDetail) {
    setDetail(newDetail);
  }

  /** Mise à jour locale après setMemberActive (endpoint retourne { userId, isActive }). */
  function handleActiveToggled(userId: string, isActive: boolean) {
    setDetail((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.userId === userId ? { ...m, isActive } : m,
      ),
    }));
  }

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* En-tête de l'org */}
      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          padding: '20px 24px',
          marginBottom: 'var(--sp-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <h2
              style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                margin: 0,
                color: 'var(--text-primary)',
              }}
            >
              {org.name}
            </h2>
            <OrgStatusBadge status={org.status} />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 16,
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              Slug :{' '}
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(0,0,0,0.04)',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                {org.slug}
              </code>
            </span>
            <span>
              ID :{' '}
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(0,0,0,0.04)',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                {org.id}
              </code>
            </span>
            <span>Créé le {formatDate(org.createdAt)}</span>
          </div>
        </div>

        {/* Action suspension */}
        <Button
          variant={org.status === 'ACTIVE' ? 'danger' : 'secondary'}
          size="sm"
          onClick={() => setSuspendOpen(true)}
        >
          {org.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
        </Button>
      </div>

      {/* Onglets */}
      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          overflow: 'hidden',
        }}
      >
        <Tabs
          tabs={[
            {
              id: 'membres',
              label: `Membres (${members.length})`,
              content: (
                <MembresTab
                  orgId={org.id}
                  members={members}
                  onMutated={handleMutated}
                  onActiveToggled={handleActiveToggled}
                />
              ),
            },
            {
              id: 'abonnement',
              label: 'Abonnement',
              content: (
                <SubscriptionEditor
                  orgId={org.id}
                  subscription={subscription}
                  onMutated={handleMutated}
                />
              ),
            },
            {
              id: 'usage',
              label: 'Usage',
              content: <UsageTab usage={usage} members={members} />,
            },
            {
              id: 'audit',
              label: 'Audit',
              content: <AuditTab orgId={org.id} />,
            },
          ]}
          defaultActiveId="membres"
        />
      </div>

      {/* Modal suspension/réactivation d'org */}
      <OrgSuspendModal
        open={suspendOpen}
        orgId={org.id}
        orgSlug={org.slug}
        currentStatus={org.status}
        onClose={() => setSuspendOpen(false)}
        onMutated={handleMutated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Membres (avec actions Lot 2)
// ---------------------------------------------------------------------------

function MembresTab({
  orgId,
  members,
  onMutated,
  onActiveToggled,
}: {
  orgId: string;
  members: AdminOrgDetail['members'];
  onMutated: (detail: AdminOrgDetail) => void;
  onActiveToggled: (userId: string, isActive: boolean) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transferOwner(m: AdminOrgDetail['members'][number]) {
    if (!window.confirm(`Définir ${m.email} comme OWNER ? L'OWNER actuel sera rétrogradé.`)) return;
    setError(null);
    setBusyId(m.userId);
    try {
      const detail = await clientTransferOwner(orgId, { newOwnerUserId: m.userId }, crypto.randomUUID());
      onMutated(detail);
    } catch (e) {
      setError((e as { message?: string }).message ?? 'Échec du transfert.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {members.length} membre{members.length > 1 ? 's' : ''}
        </span>
        <Button variant="action" size="sm" onClick={() => setShowAdd(true)}>
          Ajouter un membre
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            margin: '8px 16px',
            padding: '6px 10px',
            borderRadius: 'var(--radius-base)',
            background: 'var(--status-fail-bg)',
            color: 'var(--status-fail-tx)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {error}
        </div>
      )}
      {members.length === 0 ? (
        <div
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Aucun membre.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {['Utilisateur', 'Rôle / Actions', 'Statut', 'Calculs (mois)'].map((h) => (
            <th
              key={h}
              scope="col"
              style={{
                padding: '10px 16px',
                textAlign: 'left',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {/* Identité */}
            <td style={{ padding: '10px 16px' }}>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                {m.fullName}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {m.email}
              </div>
            </td>

            {/* Rôle + actions inline */}
            <td style={{ padding: '10px 16px' }}>
              <MemberActionsRow
                orgId={orgId}
                member={m}
                onMutated={onMutated}
                onActiveToggled={onActiveToggled}
              />
              {m.role !== 'OWNER' && m.isActive && (
                <button
                  type="button"
                  disabled={busyId === m.userId}
                  onClick={() => transferOwner(m)}
                  style={{
                    marginTop: 6,
                    fontSize: 'var(--text-xs)',
                    padding: '3px 9px',
                    borderRadius: 'var(--radius-base)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--surface-base)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Définir OWNER
                </button>
              )}
            </td>

            {/* Statut is_active */}
            <td style={{ padding: '10px 16px' }}>
              {m.isActive ? (
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--status-pass-tx)',
                    background: 'var(--status-pass-bg)',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-base)',
                    fontWeight: 500,
                  }}
                >
                  Actif
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    background: 'rgba(0,0,0,0.05)',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-base)',
                    fontWeight: 500,
                  }}
                >
                  Suspendu
                </span>
              )}
            </td>

            {/* Calculs */}
            <td
              style={{
                padding: '10px 16px',
                color: 'var(--text-secondary)',
                textAlign: 'right',
                paddingRight: 24,
              }}
            >
              {m.calculsMois}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
      )}
      <AddMemberModal
        open={showAdd}
        orgId={orgId}
        existingIds={members.map((m) => m.userId)}
        onClose={() => setShowAdd(false)}
        onMutated={onMutated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Ajouter un membre (recherche user existant + rôle) — Vague 2
// ---------------------------------------------------------------------------

function AddMemberModal({
  open,
  orgId,
  existingIds,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  existingIds: string[];
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminUserView[]>([]);
  const [picked, setPicked] = useState<AdminUserView | null>(null);
  const [role, setRole] = useState<'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER'>('ENGINEER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function search(value: string) {
    setQ(value);
    setPicked(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const users = await clientSearchUsers(value.trim());
      setResults(users.filter((u) => !existingIds.includes(u.userId)).slice(0, 8));
    } catch {
      setResults([]);
    }
  }

  async function handleSubmit() {
    if (!picked) return;
    setError(undefined);
    setLoading(true);
    try {
      const detail = await clientAddMember(orgId, { userId: picked.userId, role }, crypto.randomUUID());
      onMutated(detail);
      onClose();
      setQ('');
      setResults([]);
      setPicked(null);
    } catch (e) {
      setError(describeAddMemberError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter un membre"
      description="Recherche un compte existant (≥ 2 caractères) puis attribue-lui un rôle dans cette organisation."
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
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
          placeholder="Email ou nom…"
          aria-label="Rechercher un utilisateur"
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 'var(--radius-base)',
            border: '1px solid var(--border-default)',
            fontSize: 'var(--text-sm)',
            background: 'var(--surface-canvas)',
            color: 'var(--text-primary)',
            boxSizing: 'border-box',
          }}
        />
        {results.length > 0 && !picked && (
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-base)', maxHeight: 180, overflowY: 'auto' }}>
            {results.map((u) => {
              // Un user = une org (migration 0020) : nbOrgs > 0 signifie déjà membre
              // ACTIF d'une autre org (existingIds a déjà exclu ceux de CETTE org) ->
              // l'ajout échouerait à coup sûr (409 R0015). On désactive plutôt que
              // laisser tenter puis échouer.
              const alreadyElsewhere = u.nbOrgs > 0;
              return (
                <button
                  key={u.userId}
                  type="button"
                  disabled={alreadyElsewhere}
                  aria-disabled={alreadyElsewhere}
                  title={
                    alreadyElsewhere
                      ? 'Cet utilisateur appartient déjà à une organisation.'
                      : undefined
                  }
                  onClick={() => {
                    if (alreadyElsewhere) return;
                    setPicked(u);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: alreadyElsewhere ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--text-sm)',
                    color: alreadyElsewhere ? 'var(--text-muted)' : 'var(--text-primary)',
                    opacity: alreadyElsewhere ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{u.fullName}</span>{' '}
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{u.email}</span>
                  {alreadyElsewhere && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 'var(--text-xs)',
                        color: 'var(--status-fail-tx)',
                        fontStyle: 'italic',
                      }}
                    >
                      déjà dans une organisation
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {picked && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
            Sélectionné : <strong>{picked.email}</strong>{' '}
            <button type="button" onClick={() => setPicked(null)} style={{ marginLeft: 6, fontSize: 'var(--text-xs)', color: 'var(--text-link)', background: 'none', border: 'none', cursor: 'pointer' }}>
              changer
            </button>
          </div>
        )}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>Rôle</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER')}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-base)',
              border: '1px solid var(--border-default)',
              fontSize: 'var(--text-sm)',
              background: 'var(--surface-canvas)',
              color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
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
// Onglet Usage (inchangé depuis Lot 1)
// ---------------------------------------------------------------------------

function UsageTab({
  usage,
  members,
}: {
  usage: AdminOrgDetail['usage'];
  members: AdminOrgDetail['members'];
}) {
  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Résumé */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="Calculs (mois)" value={String(usage.byKind.CALC)} />
        <MetricCard label="PV (mois)" value={String(usage.byKind.PV)} />
        {usage.consommation !== null && usage.quota !== null && (
          <MetricCard
            label="Consommation globale"
            value={`${usage.consommation} / ${usage.quota}`}
          />
        )}
      </div>

      {/* Détail par membre */}
      {usage.byMember.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              margin: '0 0 10px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Par membre (mois courant)
          </h3>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th
                  scope="col"
                  style={{
                    padding: '8px 0',
                    textAlign: 'left',
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  Membre
                </th>
                <th
                  scope="col"
                  style={{
                    padding: '8px 0',
                    textAlign: 'right',
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  Unités
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.byMember.map((row) => {
                const member = members.find((m) => m.userId === row.userId);
                return (
                  <tr
                    key={row.userId}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td style={{ padding: '8px 0', color: 'var(--text-primary)' }}>
                      {member ? member.fullName : `${row.userId.slice(0, 8)}…`}
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        textAlign: 'right',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {row.count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {usage.byMember.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
          Aucune activité ce mois-ci.
        </p>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--surface-canvas)',
        borderRadius: 'var(--radius-base)',
        padding: '14px 18px',
        minWidth: 120,
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Message d'erreur pour l'ajout d'un membre — normalise le 409 « un user = une
 * org » (R0015, migration 0020) en un message stable, indépendant du texte
 * backend exact (provision_member vs provision_org peuvent différer). Tout
 * autre statut affiche le message serveur tel quel.
 */
function describeAddMemberError(e: unknown): string {
  if (e && typeof e === 'object' && 'statusCode' in e && (e as { statusCode: number }).statusCode === 409) {
    return 'Cet utilisateur appartient déjà à une organisation.';
  }
  return (e as { message?: string })?.message ?? "Échec de l'ajout.";
}
