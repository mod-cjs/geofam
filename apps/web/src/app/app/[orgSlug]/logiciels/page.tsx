'use client';

/**
 * Accueil GEOFAM — galerie des logiciels géotechniques.
 * L'utilisateur choisit un logiciel et y entre. Chaque logiciel a sa
 * pastille-logo (accent propre) ; statut réel INCLUS/VERROUILLÉ dérivé des
 * entitlements de l'organisation (jamais de fail-open sur modules non chargés,
 * cf. lib/subscription-gate.ts) — « bientôt » réservé aux logiciels sans UI.
 */

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { QuotaBar } from '@/components/admin/QuotaBar';
import { getEntitlements } from '@/lib/api/client';
import type { EntitlementsResponse } from '@/lib/api/types';
import {
  readEntitlementsSnapshot,
  writeEntitlementsSnapshot,
} from '@/lib/entitlements-snapshot';
import { useOrgIdReady } from '@/lib/org-context';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';
import { evaluateGate, isQuotaLow } from '@/lib/subscription-gate';

export default function LogicielsGallery() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const { orgId, ready } = useOrgIdReady(orgSlug);

  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  // true = "rien à montrer encore" (ni squelette, ni amorçage) -> squelettes de
  // cartes affichés à la place du catalogue. Ne repasse JAMAIS à true une fois
  // passé à false pour une revalidation en arrière-plan (pas de re-flash).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Miroir de `ent` en ref : lu par l'effet de fetch pour savoir si un amorçage
  // (snapshot) est déjà affiché, sans dépendre de `ent` dans le tableau de deps
  // de cet effet (ce qui redéclencherait un fetch à chaque mise à jour de `ent`).
  const entRef = useRef<EntitlementsResponse | null>(null);
  useEffect(() => {
    entRef.current = ent;
  }, [ent]);

  // Amorçage stale-while-revalidate : affiche instantanément le dernier
  // EntitlementsResponse connu pour cet org (localStorage), le temps que la
  // résolution orgId + le fetch réseau (tous deux post-montage) aboutissent.
  // Snapshot absent -> on reste en squelette (fail-closed, cf. lib/entitlements-snapshot).
  useEffect(() => {
    if (!orgSlug) return;
    const snapshot = readEntitlementsSnapshot(orgSlug);
    if (snapshot) {
      setEnt(snapshot);
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    let cancelled = false;
    // Résolution orgId pas encore terminée (post-montage) : ne PAS basculer
    // loading à false ici, sinon on retombe sur le bug diagnostiqué
    // (evaluateGate(null, …) => "Non inclus" affiché avant la vérité serveur).
    if (!ready) return;
    if (!orgId) {
      setLoading(false);
      return;
    }
    // Ne remontre le squelette que si rien n'est déjà affiché (pas d'amorçage) —
    // une revalidation en arrière-plan ne doit pas faire disparaître le contenu.
    if (entRef.current === null) setLoading(true);
    setError(null);
    getEntitlements(orgId)
      .then((e) => {
        if (!cancelled) {
          setEnt(e);
          setLoading(false);
          writeEntitlementsSnapshot(orgSlug, e);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Fail-closed : sans données fraîches, on retombe sur le dernier
          // amorçage connu (déjà dans `ent`) ou, à défaut, tout reste
          // verrouillé (evaluateGate(null, …) renvoie déjà « non inclus »).
          setError(
            entRef.current
              ? 'Impossible de vérifier votre abonnement — affichage basé sur la dernière vérification connue.'
              : 'Impossible de charger votre abonnement — modules affichés comme verrouillés.',
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, orgId, orgSlug]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 56px' }}>
      <header
        style={{
          marginBottom: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--text-secondary, #6b7178)',
            }}
          >
            Suite géotechnique
          </div>
          <h1
            style={{
              fontSize: 24,
              margin: '4px 0 6px',
              color: 'var(--text-primary, #16212e)',
            }}
          >
            GEOFAM
          </h1>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--text-secondary, #6b7178)',
              margin: 0,
              maxWidth: 620,
            }}
          >
            Choisissez un logiciel pour lancer un calcul et produire un PV scellé. Chaque
            module reprend fidèlement l&apos;outil de calcul, avec exécution côté serveur.
          </p>
        </div>

        {!loading && ent && (
          <div style={{ minWidth: 200 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary, #6b7178)',
                marginBottom: 4,
              }}
            >
              Pack <strong>{ent.pack}</strong> · quota
            </div>
            <QuotaBar consommation={ent.quota.used} quota={ent.quota.limit} width={200} />
          </div>
        )}
      </header>

      {loading && (
        <div
          aria-busy="true"
          aria-label="Chargement des modules"
          style={{
            fontSize: 13,
            color: 'var(--text-secondary, #6b7178)',
            marginBottom: 16,
          }}
        >
          Chargement de votre abonnement…
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          style={{
            background: 'var(--status-fail-bg)',
            border: '1px solid var(--status-fail-tx)',
            color: 'var(--status-fail-tx)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!loading && ent?.expired && (
        <div
          role="alert"
          style={{
            background: 'var(--status-fail-bg)',
            border: '1px solid var(--status-fail-tx)',
            color: 'var(--status-fail-tx)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Abonnement expiré — aucun calcul possible tant qu&apos;il n&apos;est pas
          renouvelé.
        </div>
      )}

      {!loading && ent && !ent.expired && isQuotaLow(ent) && (
        <div
          role="status"
          style={{
            background: 'var(--status-warn-bg)',
            border: '1px solid var(--warn-line, var(--status-warn-tx))',
            color: 'var(--status-warn-tx)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Quota bientôt épuisé — {ent.quota.remaining} calcul(s) restant(s) sur{' '}
          {ent.quota.limit}.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}
        aria-busy={loading || undefined}
      >
        {loading
          ? SOFTWARE_CATALOG.map((l) => <SoftwareCardSkeleton key={l.id} />)
          : SOFTWARE_CATALOG.map((l) => {
              const gate = l.hasUi
                ? evaluateGate(ent, l.engineId)
                : { allowed: false, reasons: [], message: null };
              // Vérité serveur déjà chargée dans cette branche (loading === false) —
              // jamais de flash « disponible » avant chargement réel des entitlements
              // (évité en amont : cf. squelette ci-dessus tant que loading === true).
              const clickable = l.hasUi && gate.allowed;
              const inner = (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 13,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 12,
                        flex: 'none',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 19,
                        letterSpacing: 0.5,
                        background: `linear-gradient(150deg, ${l.accent}, ${shade(l.accent)})`,
                        boxShadow: `0 6px 16px -8px ${l.accent}`,
                        opacity: clickable ? 1 : 0.6,
                      }}
                    >
                      {l.nom[0]}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: 'var(--text-primary, #16212e)',
                          }}
                        >
                          {l.nom}
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 9.5,
                            fontWeight: 800,
                            letterSpacing: 0.4,
                            textTransform: 'uppercase',
                            padding: '2px 7px',
                            borderRadius: 20,
                            background: !l.hasUi
                              ? 'var(--color-alt)'
                              : gate.allowed
                                ? 'var(--status-pass-bg)'
                                : 'var(--status-fail-bg)',
                            color: !l.hasUi
                              ? 'var(--text-muted)'
                              : gate.allowed
                                ? 'var(--status-pass-tx)'
                                : 'var(--status-fail-tx)',
                          }}
                        >
                          {!l.hasUi ? (
                            'Bientôt'
                          ) : gate.allowed ? (
                            'Disponible'
                          ) : (
                            <>
                              <Lock size={9} strokeWidth={2} aria-hidden="true" /> Non
                              inclus
                            </>
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: 'var(--text-secondary, #6b7178)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {l.tagline}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-secondary, #6b7178)',
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{l.domaine}</span>
                    {clickable && (
                      <span style={{ color: l.accent, fontWeight: 700 }}>Ouvrir →</span>
                    )}
                    {!clickable && l.hasUi && (
                      <span style={{ color: 'var(--status-fail-tx)', fontWeight: 600 }}>
                        {gate.message}
                      </span>
                    )}
                  </div>
                </>
              );
              const cardStyle: React.CSSProperties = {
                display: 'block',
                background: 'var(--surface-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: '16px 18px',
                textDecoration: 'none',
                opacity: clickable ? 1 : 0.72,
                cursor: clickable ? 'pointer' : 'default',
                boxShadow: '0 1px 2px rgba(22,33,46,.04)',
              };
              return clickable ? (
                <Link
                  key={l.id}
                  href={`/app/${orgSlug}/logiciels/${l.id}`}
                  style={cardStyle}
                  className="geofam-card"
                >
                  {inner}
                </Link>
              ) : (
                <div key={l.id} style={cardStyle} aria-disabled="true">
                  {inner}
                </div>
              );
            })}
      </div>

      <style>{`
        .geofam-card{transition:box-shadow .15s,transform .15s}
        .geofam-card:hover{box-shadow:0 10px 28px -14px rgba(22,33,46,.28);transform:translateY(-1px)}
        .geofam-skel{position:relative;overflow:hidden;background:var(--surface-inset,var(--surface-alt,#eceae4))}
        .geofam-skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);
          background:linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent);
          animation:geofam-shimmer 1.4s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.geofam-skel::after{animation:none}}
        @keyframes geofam-shimmer{100%{transform:translateX(100%)}}
      `}</style>
    </div>
  );
}

/**
 * Carte squelette — affichée tant que l'org/les entitlements ne sont pas
 * résolus (orgId post-montage + fetch réseau). Neutre : aucun badge
 * « Disponible »/« Non inclus » ne doit jamais apparaître ici (cf. bug F5
 * diagnostiqué — flash de mauvais contenu avant la vérité serveur).
 */
function SoftwareCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: 'var(--surface-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
        <div
          className="geofam-skel"
          style={{ width: 46, height: 46, borderRadius: 12, flex: 'none' }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="geofam-skel"
            style={{ width: '60%', height: 14, borderRadius: 4 }}
          />
          <div
            className="geofam-skel"
            style={{ width: '80%', height: 11, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 10,
        }}
      >
        <div
          className="geofam-skel"
          style={{ width: '40%', height: 11, borderRadius: 4 }}
        />
      </div>
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
