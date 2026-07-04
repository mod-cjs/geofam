'use client';

/**
 * Calculs d'un projet — HISTORIQUE EN LECTURE SEULE.
 *
 * Décision titulaire (alignement workflow) : les calculs se lancent UNIQUEMENT
 * depuis les logiciels (galerie GEOFAM), pas ici. Cet écran affiche l'historique
 * des calculs du projet, permet d'en relire un (verdict + résultats normalisés),
 * et renvoie vers le logiciel pour (re)lancer ou vers la liste des PV scellés.
 * Aucun sélecteur de moteur, aucun formulaire, aucune émission de PV ici.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { VerdictBanner } from '@/components/ui/VerdictBanner';
import { listCalcResults } from '@/lib/api/client';
import type { CalcResult, NormalizedCalcOutput } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

// registryId (persisté backend) → slug métier court (route logiciel + libellé).
const ENGINE_ID_ALIAS: Record<string, string> = {
  'chaussee-burmister': 'burmister',
  'fondation-superficielle': 'terzaghi',
  'pressiometre-menard': 'pressiometre',
  'fondation-profonde-pieux': 'pieux',
  'radier-plaque': 'radier',
  'labo-classification-gtr': 'labo',
  'fondation-terzaghi': 'terzaghi',
};
// slug → (nom logiciel, route). Les slugs sans page front restent listables (historique).
const ENGINE_META: Record<string, { nom: string; route?: string }> = {
  burmister: { nom: 'ROADSENS — Chaussées', route: 'roadsens' },
  terzaghi: { nom: 'Terzaghi — Fondations superficielles', route: 'terzaghi' },
  pieux: { nom: 'CASAGRANDE — Pieux', route: 'casagrande' },
  radier: { nom: 'GEOPLAQUE — Radier', route: 'geoplaque' },
  pressiometre: { nom: 'PressioPro — Pressiomètre', route: 'pressiopro' },
  labo: { nom: 'FASTLAB — Laboratoire', route: 'fastlab' },
};
function slugOf(engineId: string): string {
  return ENGINE_ID_ALIAS[engineId] ?? engineId;
}
function metaOf(engineId: string): { nom: string; route?: string } {
  return ENGINE_META[slugOf(engineId)] ?? { nom: engineId };
}

interface CalculsClientProps {
  orgSlug: string;
  projetId: string;
}

export default function CalculsClient({ orgSlug, projetId }: CalculsClientProps) {
  const router = useRouter();
  const orgId = useOrgId(orgSlug);

  const [calculs, setCalculs] = useState<CalcResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    if (orgId === null) return; // orgId en cours de résolution
    setLoading(true);
    setError(null);
    try {
      const data = await listCalcResults(orgId, projetId);
      setCalculs(data);
      setSelectedId((cur) => cur ?? data[0]?.id ?? null);
    } catch {
      setError('Impossible de charger les calculs.');
    } finally {
      setLoading(false);
    }
  }, [orgId, projetId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement des calculs" />;

  const selected = calculs.find((c) => c.id === selectedId) ?? null;
  const output = (selected?.output ?? null) as NormalizedCalcOutput | null;
  const goGallery = () => router.push(`/app/${orgSlug}/logiciels`);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 20, padding: '24px 20px 56px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Colonne gauche — historique */}
      <aside className="calculs-list-col">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ fontSize: 17, margin: 0, color: 'var(--text-primary, #16212e)' }}>Calculs</h1>
          <div style={{ marginLeft: 'auto' }}>
            <Button size="sm" onClick={goGallery}>Nouveau calcul</Button>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-secondary, #6b7178)', margin: '0 0 12px' }}>
          Historique en lecture. Les calculs se lancent depuis les logiciels.
        </p>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7178)' }}>Chargement…</div>
        ) : error ? (
          <div style={{ fontSize: 13, color: '#b23a2e' }} role="alert">{error}</div>
        ) : calculs.length === 0 ? (
          <EmptyState
            variant="blank"
            title="Aucun calcul"
            description="Lancez un calcul depuis un logiciel ; il apparaîtra ici."
            ctaLabel="Ouvrir un logiciel"
            onCta={goGallery}
          />
        ) : (
          <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {calculs.map((c) => {
              const active = c.id === selectedId;
              const out = c.output as NormalizedCalcOutput | null;
              const verdict = out?.verdict;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    aria-current={active ? 'true' : undefined}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      background: active ? 'var(--surface-panel, #fff)' : 'transparent',
                      border: `1px solid ${active ? 'var(--border-secondary, #d2d8e1)' : 'var(--border-tertiary, #e6eaef)'}`,
                      borderRadius: 10, padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #16212e)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                      {verdict && verdict !== 'NA' && (
                        <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: verdict === 'PASS' ? '#e4efe6' : '#f6e5e1', color: verdict === 'PASS' ? '#2e7d4f' : '#b23a2e' }}>
                          {verdict === 'PASS' ? 'CONFORME' : 'NON CONF.'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7178)', marginTop: 2 }}>
                      {metaOf(c.engineId).nom}
                      {c.pvId ? ' · PV émis' : ''}
                    </div>
                    <div suppressHydrationWarning style={{ fontSize: 10.5, color: 'var(--text-tertiary, #96a0ab)', marginTop: 1 }}>
                      {new Date(c.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Colonne droite — lecture d'un calcul */}
      <section className="calculs-panel">
        {!selected ? (
          <EmptyState variant="pre-calc" title="Sélectionnez un calcul" description="Choisissez un calcul dans l'historique pour en relire les résultats." />
        ) : (
          <div style={{ background: 'var(--surface-panel, #fff)', border: '1px solid var(--border-tertiary, #e6eaef)', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary, #16212e)' }}>{selected.label}</h2>
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7178)' }}>{metaOf(selected.engineId).nom}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {selected.pvId ? (
                  <Link href={`/app/${orgSlug}/projets/${projetId}/pv`} style={{ textDecoration: 'none' }}><Button size="sm" variant="secondary">Voir le PV scellé</Button></Link>
                ) : metaOf(selected.engineId).route ? (
                  <Link href={`/app/${orgSlug}/logiciels/${metaOf(selected.engineId).route}`} style={{ textDecoration: 'none' }}><Button size="sm" variant="secondary">Ouvrir le logiciel</Button></Link>
                ) : null}
              </div>
            </div>

            {output && output.verdict !== 'NA' && (
              <div style={{ marginBottom: 14 }}>
                <VerdictBanner verdict={output.verdict === 'PASS' ? 'pass' : 'fail'} />
              </div>
            )}

            {output ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Grandeur', 'Valeur', 'Unité', 'Statut'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-secondary, #6b7178)', padding: '6px 8px', fontWeight: 700, borderBottom: '1px solid var(--border-tertiary, #e6eaef)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {output.rows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-tertiary, #e6eaef)' }}>{row.label}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-tertiary, #e6eaef)', fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : row.value}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-tertiary, #e6eaef)', color: 'var(--text-secondary, #6b7178)' }}>{row.unit}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-tertiary, #e6eaef)' }}>
                        {row.status && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: row.status === 'ok' ? '#e4efe6' : '#f6e5e1', color: row.status === 'ok' ? '#2e7d4f' : '#b23a2e' }}>{row.status === 'ok' ? 'OK' : 'NON'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7178)' }}>
                {selected.status === 'ERROR' ? 'Ce calcul est en erreur.' : 'Résultats indisponibles pour ce calcul.'}
              </div>
            )}

            <div style={{ marginTop: 14, fontSize: 10.5, color: 'var(--text-tertiary, #96a0ab)', fontStyle: 'italic' }}>
              Lecture seule. Formules et coefficients appliqués côté serveur ; pour (re)lancer un calcul, ouvrez le logiciel.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
