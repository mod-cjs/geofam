'use client';

/**
 * Accueil GEOFAM — galerie des logiciels géotechniques.
 * L'utilisateur choisit un logiciel et y entre. Chaque logiciel a sa
 * pastille-logo (accent propre) ; statut réel INCLUS/VERROUILLÉ dérivé des
 * entitlements de l'organisation (jamais de fail-open sur modules non chargés,
 * cf. lib/subscription-gate.ts) — « bientôt » réservé aux logiciels sans UI.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

import { QuotaBar } from '@/components/admin/QuotaBar';
import { getEntitlements } from '@/lib/api/client';
import type { EntitlementsResponse } from '@/lib/api/types';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';
import { evaluateGate, isQuotaLow } from '@/lib/subscription-gate';
import { useOrgId } from '@/lib/org-context';

export default function LogicielsGallery() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);

  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getEntitlements(orgId)
      .then((e) => {
        if (!cancelled) {
          setEnt(e);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Fail-closed : entitlements non chargés -> tout reste verrouillé
          // (evaluateGate(null, …) renvoie déjà « non inclus »).
          setError("Impossible de charger votre abonnement — modules affichés comme verrouillés.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 56px' }}>
      <header style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary, #6b7178)' }}>Suite géotechnique</div>
          <h1 style={{ fontSize: 24, margin: '4px 0 6px', color: 'var(--text-primary, #16212e)' }}>GEOFAM</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #6b7178)', margin: 0, maxWidth: 620 }}>
            Choisissez un logiciel pour lancer un calcul et produire un PV scellé. Chaque module reprend fidèlement l&apos;outil de calcul, avec exécution côté serveur.
          </p>
        </div>

        {!loading && ent && (
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7178)', marginBottom: 4 }}>
              Pack <strong>{ent.pack}</strong> · quota
            </div>
            <QuotaBar consommation={ent.quota.used} quota={ent.quota.limit} width={200} />
          </div>
        )}
      </header>

      {loading && (
        <div aria-busy="true" aria-label="Chargement des modules" style={{ fontSize: 13, color: 'var(--text-secondary, #6b7178)', marginBottom: 16 }}>
          Chargement de votre abonnement…
        </div>
      )}

      {!loading && error && (
        <div role="alert" style={{ background: '#f6e5e1', border: '1px solid #e0b3aa', color: '#8f2a1f', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && ent?.expired && (
        <div role="alert" style={{ background: '#f6e5e1', border: '1px solid #e0b3aa', color: '#8f2a1f', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          Abonnement expiré — aucun calcul possible tant qu&apos;il n&apos;est pas renouvelé.
        </div>
      )}

      {!loading && ent && !ent.expired && isQuotaLow(ent) && (
        <div role="status" style={{ background: '#f4edd8', border: '1px solid #e6cf9c', color: '#96701a', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          Quota bientôt épuisé — {ent.quota.remaining} calcul(s) restant(s) sur {ent.quota.limit}.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {SOFTWARE_CATALOG.map((l) => {
          const gate = l.hasUi ? evaluateGate(ent, l.engineId) : { allowed: false, reasons: [], message: null };
          // Fail-closed pendant le chargement : pas de flash « disponible » avant
          // la vérité serveur (evaluateGate(null, …) renvoie déjà NOT_INCLUDED).
          const clickable = l.hasUi && !loading && gate.allowed;
          const inner = (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
                <div aria-hidden="true" style={{
                  width: 46, height: 46, borderRadius: 12, flex: 'none', display: 'grid', placeItems: 'center',
                  color: '#fff', fontWeight: 800, fontSize: 19, letterSpacing: 0.5,
                  background: `linear-gradient(150deg, ${l.accent}, ${shade(l.accent)})`,
                  boxShadow: `0 6px 16px -8px ${l.accent}`,
                  opacity: clickable ? 1 : 0.6,
                }}>{l.nom[0]}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #16212e)' }}>{l.nom}</span>
                    {!loading && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20,
                        background: !l.hasUi ? '#efece3' : gate.allowed ? '#e4efe6' : '#efe3e3',
                        color: !l.hasUi ? '#8a8474' : gate.allowed ? '#2e7d4f' : '#8a4a4a',
                      }}>
                        {!l.hasUi ? 'Bientôt' : gate.allowed ? 'Disponible' : (
                          <>
                            <Lock size={9} strokeWidth={2} aria-hidden="true" /> Non inclus
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #6b7178)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.tagline}</div>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #6b7178)', borderTop: '1px solid var(--border-tertiary, #e6eaef)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{l.domaine}</span>
                {clickable && <span style={{ color: l.accent, fontWeight: 700 }}>Ouvrir →</span>}
                {!loading && !clickable && l.hasUi && (
                  <span style={{ color: '#8a4a4a', fontWeight: 600 }}>{gate.message}</span>
                )}
              </div>
            </>
          );
          const cardStyle: React.CSSProperties = {
            display: 'block', background: 'var(--surface-panel, #fff)', border: '1px solid var(--border-tertiary, #e6eaef)',
            borderRadius: 14, padding: '16px 18px', textDecoration: 'none',
            opacity: clickable ? 1 : 0.72,
            cursor: clickable ? 'pointer' : 'default',
            boxShadow: '0 1px 2px rgba(22,33,46,.04)',
          };
          return clickable ? (
            <Link key={l.id} href={`/app/${orgSlug}/logiciels/${l.id}`} style={cardStyle} className="geofam-card">{inner}</Link>
          ) : (
            <div key={l.id} style={cardStyle} aria-disabled="true">{inner}</div>
          );
        })}
      </div>

      <style>{`.geofam-card{transition:box-shadow .15s,transform .15s}.geofam-card:hover{box-shadow:0 10px 28px -14px rgba(22,33,46,.28);transform:translateY(-1px)}`}</style>
    </div>
  );
}

/** Assombrit une couleur hex pour le dégradé de la pastille. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
