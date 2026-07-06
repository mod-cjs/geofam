/**
 * /admin/users/[userId] — fiche détaillée d'un utilisateur (SUPERADMIN-only).
 * Identité + liste de ses appartenances (org + rôle + statut). Lecture seule.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrgStatusBadge } from '@/components/admin/OrgStatusBadge';
import { adminGetUser } from '@/lib/api/admin-server';

interface UserDetailPageProps {
  params: Promise<{ userId: string }>;
}

export const metadata = { title: 'Utilisateur — Back-office' };

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { userId } = await params;
  const user = await adminGetUser(userId);
  if (!user) notFound();

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
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
      </div>

      {/* Appartenances */}
      <div style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elevation-card)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          Organisations ({user.orgs.length})
        </div>
        {user.orgs.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Cet utilisateur n&apos;est membre d&apos;aucune organisation.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ background: 'rgba(31,78,74,0.04)', borderBottom: '1px solid var(--border-subtle)' }}>
                {['Organisation', 'Rôle', 'Statut membre', 'Statut org'].map((h) => (
                  <th key={h} scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {user.orgs.map((o) => (
                <tr key={o.orgId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <Link href={`/admin/orgs/${o.orgId}`} className="admin-breadcrumb-link" style={{ color: 'var(--text-link)', textDecoration: 'none' }}>
                      {o.orgName}
                    </Link>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{o.orgSlug}</div>
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>{o.role}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--radius-base)', color: o.active ? 'var(--status-pass-tx)' : 'var(--text-muted)', background: o.active ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)' }}>
                      {o.active ? 'Actif' : 'Suspendu'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <OrgStatusBadge status={o.orgStatus as 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
