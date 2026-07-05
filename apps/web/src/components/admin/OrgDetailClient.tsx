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
import { OrgStatusBadge } from './OrgStatusBadge';
import { SubscriptionEditor } from './SubscriptionEditor';
import { MemberActionsRow } from './MemberActionsRow';
import { OrgSuspendModal } from './OrgSuspendModal';
import { AuditTab } from './AuditTab';
import type { AdminOrgDetail } from '@/lib/api/admin-server';

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
  if (members.length === 0) {
    return (
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
    );
  }

  return (
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
