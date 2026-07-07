'use client';

/**
 * AdminTopbar — back-office SUPERADMIN.
 * Fond --struct-petrole · libellé "BACK-OFFICE" · avatar utilisateur.
 */

import { LogOut, Shield } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { getStoredUser, logout } from '@/lib/api/client';

export function AdminTopbar() {
  // Valeur hydratée après montage (sessionStorage inaccessible côté serveur).
  const [user, setUser] = useState<{ name: string }>({ name: 'A' });
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUser(u);
  }, []);

  // Déconnexion : révoque le refresh + purge les cookies/session (logout), puis
  // renvoie vers /login (rechargement dur pour vider tout état client).
  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        left: 0,
        height: 48,
        background: 'var(--struct-petrole)',
        boxShadow: 'var(--elevation-sticky)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        zIndex: 20,
      } as React.CSSProperties}
    >
      {/* Décalage sidebar desktop */}
      <div
        className="admin-topbar-offset"
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      />

      {/* Libellé contexte */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          minWidth: 0,
        }}
      >
        <Shield
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: 'var(--struct-petrole-fg)', opacity: 0.7, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--struct-petrole-fg)',
          }}
        >
          Back-office
        </span>
      </div>

      {/* Lien vers l'app tenant (si besoin de revenir) */}
      <Link
        href="/app"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'rgba(255,255,255,0.65)',
          textDecoration: 'none',
          flexShrink: 0,
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.95)';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)';
        }}
      >
        Retour à l&apos;app
      </Link>

      {/* Avatar */}
      <div style={{ flexShrink: 0 }}>
        <Avatar name={user.name} size="sm" />
      </div>

      {/* Déconnexion */}
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={signingOut}
        aria-label="Se déconnecter"
        title="Se déconnecter"
        data-testid="admin-logout"
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 'var(--radius-base)',
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.8)',
          cursor: signingOut ? 'wait' : 'pointer',
          opacity: signingOut ? 0.6 : 1,
        }}
      >
        <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>

      <style>{`
        @media (min-width: 1024px) {
          .admin-topbar-offset { width: 240px; }
        }
        @media (max-width: 1023px) {
          .admin-topbar-offset { width: 0; }
        }
      `}</style>
    </header>
  );
}
