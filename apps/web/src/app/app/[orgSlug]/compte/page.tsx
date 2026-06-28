'use client';

/**
 * B-31 — Mon compte (profil + mot de passe) — minimal P1
 */

import { useEffect, useState } from 'react';

import { getStoredUser } from '@/lib/api/client';

// Valeur SSR stable → identique au premier rendu client → pas de #418.
// useEffect lit sessionStorage après montage et bascule vers le vrai utilisateur.
const FALLBACK_USER = { name: 'Utilisateur', email: 'demo@starfire.sn' };

export default function ComptePage() {
  const [user, setUser] = useState(FALLBACK_USER);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) setUser(stored as { name: string; email: string });
  }, []);

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
