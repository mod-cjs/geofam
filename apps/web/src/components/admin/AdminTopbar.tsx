'use client';

/**
 * AdminTopbar — back-office SUPERADMIN.
 * Fond --struct-petrole · libellé "BACK-OFFICE" · avatar utilisateur.
 */

import { Shield } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { getStoredUser } from '@/lib/api/client';

export function AdminTopbar() {
  // Valeur hydratée après montage (sessionStorage inaccessible côté serveur).
  const [user, setUser] = useState<{ name: string }>({ name: 'A' });
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUser(u);
  }, []);

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
