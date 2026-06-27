'use client';

/**
 * B-28 — Bibliothèque de moteurs
 * Catalogue 6 moteurs / 3 domaines · Lecture seule · Entitlement-gated
 */

import { use, useEffect, useState } from 'react';
import { Lock, Calculator } from 'lucide-react';
import { getEntitlements } from '@/lib/api/client';
import type { EntitlementsResponse } from '@/lib/api/types';
import { ENGINE_DESCRIPTORS } from '@/lib/engine-descriptors';
import { DomainTag } from '@/components/ui/DomainTag';
import type { Domain } from '@/components/ui/DomainTag';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useOrgId } from '@/lib/org-context';

// Ces clés sont des valeurs de type Domain (non ProjectDomain) : aucun cast nécessaire.
const GROUPS: Array<{ domain: Domain; label: string; ids: string[] }> = [
  { domain: 'road', label: 'Chaussées', ids: ['burmister'] },
  { domain: 'foundation', label: 'Fondations', ids: ['terzaghi', 'casagrande', 'geoplaque'] },
  { domain: 'lab', label: 'Sol & Labo', ids: ['pressiometre', 'fastlab'] },
];

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default function BibliothequeePage({ params }: Props) {
  const { orgSlug } = use(params);
  const orgId = useOrgId(orgSlug);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    getEntitlements(orgId).then((e) => { setEntitlements(e); setLoading(false); });
  }, [orgId]);

  const modules = entitlements?.modules ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Bibliothèque de moteurs
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>
          Catalogue des 6 moteurs de calcul disponibles sur la plateforme.
          {entitlements && (
            <span> Pack actif : <strong>{entitlements.pack}</strong>.</span>
          )}
        </p>
      </div>

      {loading && (
        <div aria-busy="true" aria-label="Chargement de la bibliothèque">
          {[1, 2, 3].map((i) => <Skeleton key={i} variant="card-projet" style={{ marginBottom: 8 }} />)}
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {GROUPS.map((group) => (
            <section key={group.domain} aria-labelledby={`group-${group.domain}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <DomainTag domain={group.domain} />
                <h2
                  id={`group-${group.domain}`}
                  style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}
                >
                  {group.label}
                </h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {group.ids.map((id) => {
                  const desc = ENGINE_DESCRIPTORS.find((d) => d.id === id);
                  if (!desc) return null;
                  const unlocked = modules.includes(id) || modules.length === 0;
                  return (
                    <div
                      key={id}
                      style={{
                        padding: '14px 16px',
                        background: 'var(--surface-base)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: 'var(--elevation-card)',
                        opacity: unlocked ? 1 : 0.55,
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Calculator
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden="true"
                          style={{ color: 'var(--struct-petrole)', flexShrink: 0, marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
                              {desc.label}
                            </span>
                            {!unlocked && (
                              <Lock
                                size={12}
                                strokeWidth={1.5}
                                aria-label="Non inclus dans votre abonnement"
                                style={{ color: 'var(--text-muted)' }}
                              />
                            )}
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                            {desc.norme}
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                            {desc.fields.filter((f) => f.type !== 'section').length} champs de saisie
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
