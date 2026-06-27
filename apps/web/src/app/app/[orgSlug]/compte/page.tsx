'use client';

/**
 * B-31 — Mon compte (profil + mot de passe) — minimal P1
 */

import { getStoredUser } from '@/lib/api/client';

export default function ComptePage() {
  const user = getStoredUser() ?? { name: 'Utilisateur', email: 'demo@starfire.sn' };

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0, marginBottom: 24 }}>
        Mon compte
      </h1>
      <div style={{ padding: 16, background: 'var(--surface-canvas)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>Nom</div>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 16 }}>
          {user.name}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>E-mail</div>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{user.email}</div>
      </div>
    </div>
  );
}
