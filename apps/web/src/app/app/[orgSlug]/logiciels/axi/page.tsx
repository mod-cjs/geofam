'use client';

/**
 * Axisymétrique — plaque annulaire / radier circulaire sur sol multicouche
 * (variante « axisymétrique » de GEOPLAQUE, §2.4.1). Saisie du modèle ; le
 * CALCUL est SERVEUR (moteur `axi` → registryId `axi-plaque`). §8 : aucun
 * champ nodal radial (r/w/p/Mr/Mt), aucune discrétisation côté navigateur.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Layer { zBase: string; E: string; nu: string }

const num = (s: string, d = 0): number => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d; };
const numU = (s: string): number | undefined => { const t = String(s).trim(); if (t === '') return undefined; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : undefined; };

export interface AxiForm {
  projet?: string;
  layers: Layer[];
  R: string; e: string; E: string; nu: string;
  q: string; Pc: string; ne: string; foundD: string;
}

/** Payload API PUR (DoD §8 : entrée bornée uniquement, aucun résultat/champ nodal). */
export function buildAxiPayload(f: AxiForm): Record<string, unknown> {
  const o: Record<string, unknown> = {
    R: num(f.R, 6), e: num(f.e, 0.4), E: num(f.E, 30000), nu: num(f.nu, 0.2),
  };
  const q = numU(f.q); if (q !== undefined) o.q = q;
  const Pc = numU(f.Pc); if (Pc !== undefined) o.Pc = Pc;
  const ne = numU(f.ne); if (ne !== undefined) o.ne = ne;
  const foundD = numU(f.foundD); if (foundD !== undefined) o.foundD = foundD;
  return {
    projet: f.projet,
    layers: f.layers.map((l) => ({ zBase: num(l.zBase), E: num(l.E), nu: num(l.nu) })),
    o,
  };
}

const ACCENT = '#8a5a1e', INK = '#241f2e', MUTED = '#6e6779', LINE = '#e4d9c6', PANEL = '#fdfbf7';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: `1px solid #d2c2a2`, borderRadius: 7, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', color: MUTED, padding: '0 4px 5px', fontWeight: 700 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const addBtn: React.CSSProperties = { marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#f5ecdc', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 };
const delBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: '#8a2d55', fontSize: 11 };

export default function AxiPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [layers, setLayers] = useState<Layer[]>([{ zBase: '-10', E: '15', nu: '0.33' }]);
  const [R, setR] = useState('6'); const [e, setE] = useState('0.4');
  const [E, setEBeton] = useState('30000'); const [nu, setNu] = useState('0.2');
  const [q, setQ] = useState('120'); const [Pc, setPc] = useState('0');
  const [ne, setNe] = useState('50'); const [foundD, setFoundD] = useState('');

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'modele' | 'resultats'>('modele');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const fd = projs.filter((p) => p.domain === 'FD'); setProjects(fd); setEnt(ent); if (fd.length === 1) setProjectId(fd[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildAxiPayload({
    projet: projects.find((p) => p.id === projectId)?.name, layers, R, e, E, nu, q, Pc, ne, foundD,
  }), [projects, projectId, layers, R, e, E, nu, q, Pc, ne, foundD]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    const label = `Axisymétrique — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'axi', label, params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setTab('resultats');
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : x?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : x?.reason === 'MODULE_NOT_IN_PACK' ? "Ce module n'est pas inclus dans votre abonnement." : (x?.message ?? 'Erreur lors du calcul. Réessayez.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement" />;

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const calcDisabled = calculating || !projectId || !orgId;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Axisymétrique</div>
          <div style={{ fontSize: 12, color: MUTED }}>Radier / dallage circulaire sur sol multicouche · éléments finis · §2.4.1</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="ax-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="FD" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={230} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#d4c8b1' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Calculer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f8e6ee', borderColor: '#e0b3c8', color: '#8a2d55' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['modele', 'Dallage & sol'], ['resultats', 'Résultats']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'modele' && (
        <>
          <div style={card}>
            <div style={secH}>Dallage circulaire</div>
            <div style={grid3}>
              <div><label style={lbl}>Rayon R (m)</label><input style={inp} value={R} onChange={(ev) => setR(ev.target.value)} /></div>
              <div><label style={lbl}>Épaisseur e (m)</label><input style={inp} value={e} onChange={(ev) => setE(ev.target.value)} /></div>
              <div><label style={lbl}>Nb d&apos;éléments annulaires</label><input style={inp} value={ne} onChange={(ev) => setNe(ev.target.value)} /></div>
            </div>
            <div style={{ ...grid3, marginTop: 10 }}>
              <div><label style={lbl}>Module béton E (MPa)</label><input style={inp} value={E} onChange={(ev) => setEBeton(ev.target.value)} /></div>
              <div><label style={lbl}>ν béton</label><input style={inp} value={nu} onChange={(ev) => setNu(ev.target.value)} /></div>
              <div><label style={lbl}>Profondeur d&apos;assise D (m)</label><input style={inp} value={foundD} onChange={(ev) => setFoundD(ev.target.value)} placeholder="0" /></div>
            </div>
            <div style={{ ...grid3, marginTop: 10 }}>
              <div><label style={lbl}>Charge répartie q (kPa)</label><input style={inp} value={q} onChange={(ev) => setQ(ev.target.value)} /></div>
              <div><label style={lbl}>Charge centrale P (kN)</label><input style={inp} value={Pc} onChange={(ev) => setPc(ev.target.value)} /></div>
            </div>
          </div>

          <div style={card}>
            <div style={secH}>Profil de sol (couches)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Base z (m)', 'E (MPa)', 'ν', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{layers.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}><input style={inp} value={l.zBase} onChange={(ev) => setLayers((a) => a.map((q2, j) => j === i ? { ...q2, zBase: ev.target.value } : q2))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={l.E} onChange={(ev) => setLayers((a) => a.map((q2, j) => j === i ? { ...q2, E: ev.target.value } : q2))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={l.nu} onChange={(ev) => setLayers((a) => a.map((q2, j) => j === i ? { ...q2, nu: ev.target.value } : q2))} /></td>
                  <td style={{ padding: 2 }}><button onClick={() => setLayers((a) => a.length <= 1 ? a : a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setLayers((a) => [...a, { zBase: '', E: '', nu: '0.33' }])} style={addBtn}>+ Ajouter une couche</button>
          </div>
        </>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Calculer</strong> pour lancer l&apos;analyse du dallage circulaire.</div>
          ) : (
            <>
              <div style={secH}>Diagnostics</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>{output.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : row.value}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Calcul éléments finis côté serveur ; la discrétisation radiale reste serveur (§8).</div>

              <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button data-testid="btn-imprimer" onClick={handleEmitPv} disabled={emittingPv} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontWeight: 600, cursor: emittingPv ? 'wait' : 'pointer', fontSize: 13 }}>{emittingPv ? 'Émission…' : 'Émettre le PV scellé'}</button>
                {pvResult && <span data-testid="pv-success" style={{ fontSize: 12.5, color: '#2e7d4f', fontWeight: 600 }}>PV scellé émis (n° {pvResult.number ?? pvResult.id}).</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
