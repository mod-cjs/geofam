'use client';

/**
 * B-30 — Paramètres — Général org (item PRODUIT #4).
 *
 * Choix retenu (vs. stub « prochaine version ») : remplir un minimum RÉEL et
 * utile avec les données déjà disponibles côté client — aucun nouveau
 * backend. Pas d'endpoint tenant-facing pour lister les membres de
 * l'organisation ni pour le changement de mot de passe self-service
 * (uniquement disponible côté back-office SUPERADMIN) : on ne les invente
 * pas. Ce qui EST réel et affiché :
 *  - identité du bureau (nom, rôle de l'utilisateur courant) — déjà résolue
 *    côté client (getStoredOrgs, sans appel réseau) ;
 *  - pack d'abonnement + échéance + quota — déjà exposés par
 *    getEntitlements (ADR 0011), réutilisés tels quels ;
 *  - lien vers "Mon compte" (profil) — seul écran de gestion de compte qui
 *    existe réellement dans l'app.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { QuotaBar } from '@/components/admin/QuotaBar';
import { NetworkErrorEmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { getEntitlements, getStoredOrgs } from '@/lib/api/client';
import type { EntitlementsResponse, OrgClaim } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

const PACK_LABELS: Record<EntitlementsResponse['pack'], string> = {
  ROUTES: 'Pack Routes',
  FONDATIONS: 'Pack Fondations',
  COMPLETE: 'Plateforme complète',
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function ParametresGeneralPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);

  const [orgs, setOrgs] = useState<OrgClaim[]>([]);
  useEffect(() => {
    setOrgs(getStoredOrgs());
  }, []);
  const currentOrg = orgs.find((o) => o.slug === orgSlug);
  const orgLabel = orgSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    getEntitlements(orgId)
      .then((e) => {
        if (!cancelled) {
          setEnt(e);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, reloadToken]);

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <h1
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: 0,
          marginBottom: 16,
        }}
      >
        Paramètres
      </h1>

      {/* Bureau */}
      <section
        style={{
          padding: 16,
          background: 'var(--surface-canvas)',
          borderRadius: 'var(--radius-lg)',
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          Bureau
        </h2>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>Nom</div>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 16 }}>
          {orgLabel}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>Votre rôle</div>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>
          {currentOrg?.role ?? '—'}
        </div>
      </section>

      {/* Abonnement */}
      <section
        style={{
          padding: 16,
          background: 'var(--surface-canvas)',
          borderRadius: 'var(--radius-lg)',
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          Abonnement
        </h2>

        {loading && (
          <div aria-busy="true" aria-label="Chargement de l'abonnement">
            <Skeleton variant="text" style={{ width: 160, height: 18, marginBottom: 8 }} />
            <Skeleton variant="text" style={{ width: 220, height: 18 }} />
          </div>
        )}

        {!loading && error && <NetworkErrorEmptyState onRetry={() => setReloadToken((n) => n + 1)} />}

        {!loading && !error && ent && (
          <>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>Pack</div>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 16 }}>
              {PACK_LABELS[ent.pack]}
              {ent.expired && (
                <span style={{ marginLeft: 8, fontSize: 'var(--text-xs)', color: 'var(--status-fail-tx)', fontWeight: 600 }}>
                  Expiré
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>Échéance</div>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: 16 }}>
              {formatDate(ent.expiresAt)}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>Quota de calculs</div>
            <QuotaBar consommation={ent.quota.used} quota={ent.quota.limit} width="100%" />
          </>
        )}
      </section>

      {/* Compte */}
      <section
        style={{
          padding: 16,
          background: 'var(--surface-canvas)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          Votre compte
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Profil et informations de connexion.
        </p>
        <Link
          href={`/app/${orgSlug}/compte`}
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-link)', fontWeight: 600 }}
        >
          Ouvrir mon compte →
        </Link>
      </section>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 16 }}>
        Pour ajouter ou retirer un membre du bureau, ou pour toute question sur votre
        abonnement, adressez votre demande à votre interlocuteur habituel.
      </p>
    </div>
  );
}
