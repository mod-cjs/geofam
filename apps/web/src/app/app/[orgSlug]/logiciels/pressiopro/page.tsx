'use client';

/**
 * PressioPro — Dépouillement d'essai pressiométrique Ménard.
 * Saisie de l'essai (appareillage, paliers P/v15/v30/v60) ; le CALCUL est SERVEUR
 * (moteur `pressiometre` → registryId `pressiometre-menard`). §8 : aucun intermédiaire
 * confidentiel côté navigateur ; la courbe trace les LECTURES saisies + le résultat pL.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Row { p: string; v15: string; v30: string; v60: string }

const num = (s: string, d = 0): number => { const t = String(s).trim(); if (t === '') return d; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : d; };

export interface PressioProForm {
  projet?: string; label: string;
  a: string; Ph: string; Pe: string; V0: string; k0: string;
  gamma: string; nappe: string;
  rows: Row[];
}

/** Payload API PUR (DoD §8 : essai borné, nombres ; ≥ 4 paliers valides requis serveur). */
export function buildPressioProPayload(f: PressioProForm): Record<string, unknown> {
  return {
    projet: f.projet,
    label: (f.label || 'Essai').slice(0, 40),
    params: { a: num(f.a), Ph: num(f.Ph), Pe: num(f.Pe), V0: num(f.V0, 535), k0: num(f.k0, 0.5) },
    gamma: num(f.gamma, 19),
    nappe: num(f.nappe),
    rows: f.rows.map((r) => ({ p: num(r.p), v15: num(r.v15), v30: num(r.v30), v60: num(r.v60) })),
  };
}

const ACCENT = '#963b28', INK = '#2b1c18', MUTED = '#7a655e', LINE = '#e2d4cf', PANEL = '#fffdfc';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: `1px solid #d8c4bd`, borderRadius: 7, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', color: MUTED, padding: '0 4px 5px', fontWeight: 700 };
const grid5: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 9 };
const addBtn: React.CSSProperties = { marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#f7ece9', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 };
const delBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: '#8a2d20', fontSize: 11 };

// Courbe pressiométrique (P en abscisse, volume en ordonnée) — trace les LECTURES saisies.
function PressioCurve({ rows, pL }: { rows: Row[]; pL: number | null }) {
  const pts = rows.map((r) => ({ p: num(r.p), v: num(r.v30), c: num(r.v60) - num(r.v15) })).filter((q) => q.p > 0 && q.v > 0);
  if (pts.length < 2) return <div style={{ padding: '1.5rem', color: MUTED, fontSize: 12.5 }}>Saisissez au moins deux paliers pour tracer la courbe.</div>;
  const W = 460, H = 300, mL = 46, mB = 34, mT = 12, mR = 12;
  const pMax = Math.max(...pts.map((q) => q.p), pL ?? 0) * 1.08;
  const vMax = Math.max(...pts.map((q) => q.v)) * 1.08;
  const cMax = Math.max(...pts.map((q) => q.c), 1) * 1.08;
  const X = (p: number) => mL + (p / pMax) * (W - mL - mR);
  const Yv = (v: number) => H - mB - (v / vMax) * (H - mB - mT);
  const Yc = (c: number) => H - mB - (c / cMax) * (H - mB - mT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff' }} role="img" aria-label="Courbe pressiométrique (volume à 30 s et fluage vs pression)">
      <line x1={mL} y1={mT} x2={mL} y2={H - mB} stroke="#bbb" /><line x1={mL} y1={H - mB} x2={W - mR} y2={H - mB} stroke="#bbb" />
      {pL != null && pL > 0 && pL < pMax && <><line x1={X(pL)} y1={mT} x2={X(pL)} y2={H - mB} stroke={ACCENT} strokeDasharray="4 3" /><text x={X(pL)} y={mT + 9} fontSize={9.5} fill={ACCENT} textAnchor="middle">p_L</text></>}
      <polyline points={pts.map((q) => `${X(q.p)},${Yv(q.v)}`).join(' ')} fill="none" stroke={ACCENT} strokeWidth={2} />
      {pts.map((q, i) => <circle key={i} cx={X(q.p)} cy={Yv(q.v)} r={3} fill={ACCENT} />)}
      <polyline points={pts.map((q) => `${X(q.p)},${Yc(q.c)}`).join(' ')} fill="none" stroke="#4a7a8a" strokeWidth={1.4} strokeDasharray="5 3" />
      <text x={mL - 6} y={mT + 4} fontSize={9} fill={MUTED} textAnchor="end">V₃₀</text>
      <text x={(W) / 2} y={H - 6} fontSize={10} fill={MUTED} textAnchor="middle">Pression P (bar)</text>
      <text x={W - mR} y={H - mB + 16} fontSize={9} fill="#4a7a8a" textAnchor="end">— — fluage V₆₀−V₁₅</text>
    </svg>
  );
}

export default function PressioProPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [label, setLabel] = useState('');
  // Appareillage (constantes de sonde/calibrage) conservees comme gabarit ; les MESURES
  // (paliers, nappe) sont vides par defaut (revue adverse : pas de PV sur donnees fictives).
  const [a, setA] = useState('0.5'); const [Ph, setPh] = useState('0'); const [Pe, setPe] = useState('0');
  const [V0, setV0] = useState('535'); const [k0, setK0] = useState('0.5');
  const [gamma, setGamma] = useState(''); const [nappe, setNappe] = useState('');
  const [rows, setRows] = useState<Row[]>([
    { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' },
    { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' },
  ]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'essai' | 'mesures' | 'resultats'>('essai');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const lb = projs.filter((p) => p.domain === 'LB'); setProjects(lb); setEnt(ent); if (lb.length === 1) setProjectId(lb[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildPressioProPayload({
    projet: projects.find((p) => p.id === projectId)?.name, label, a, Ph, Pe, V0, k0, gamma, nappe, rows,
  }), [projects, projectId, label, a, Ph, Pe, V0, k0, gamma, nappe, rows]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'pressiometre', label: `PressioPro — ${label}`.slice(0, 60), params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setTab('resultats');
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : x?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : x?.reason === 'MODULE_NOT_IN_PACK' ? "Le module PressioPro n'est pas inclus dans votre abonnement." : (x?.message ?? 'Erreur lors du calcul. Vérifiez qu’il y a au moins 4 paliers cohérents.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, label, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const pLBar = useMemo(() => {
    const r = output?.rows?.find((x) => /p_L\b/.test(x.label) && !/nette/i.test(x.label));
    return r && typeof r.value === 'number' ? r.value : null;
  }, [output]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de PressioPro" />;
  const calcDisabled = calculating || !projectId || !orgId;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>PressioPro</div>
          <div style={{ fontSize: 12, color: MUTED }}>Dépouillement d&apos;essai pressiométrique · Ménard</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="pp-projet">Sondage (projet)</label>
            <ProjectPicker orgId={orgId} domain="LB" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={230} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#cbb8b2' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Dépouiller →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f8e7e2', borderColor: '#e0bdb3', color: '#8a2d20' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['essai', 'Essai & appareillage'], ['mesures', 'Paliers de mesure'], ['resultats', 'Courbe & résultats']] as const).map(([id, t]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'essai' && (
        <>
          <div style={card}>
            <div style={secH}>Identification</div>
            <label style={lbl}>Repère (sondage / profondeur)</label>
            <input style={{ ...inp, maxWidth: 320 }} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div style={card}>
            <div style={secH}>Appareillage (calibrage)</div>
            <div style={grid5}>
              <div><label style={lbl}>Inertie a</label><input style={inp} value={a} onChange={(e) => setA(e.target.value)} /></div>
              <div><label style={lbl}>P_h (bar)</label><input style={inp} value={Ph} onChange={(e) => setPh(e.target.value)} /></div>
              <div><label style={lbl}>P_e (bar)</label><input style={inp} value={Pe} onChange={(e) => setPe(e.target.value)} /></div>
              <div><label style={lbl}>V₀ (cm³)</label><input style={inp} value={V0} onChange={(e) => setV0(e.target.value)} /></div>
              <div><label style={lbl}>K₀</label><input style={inp} value={k0} onChange={(e) => setK0(e.target.value)} /></div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Sol &amp; nappe</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 320 }}>
              <div><label style={lbl}>Poids volumique γ (kN/m³)</label><input style={inp} value={gamma} onChange={(e) => setGamma(e.target.value)} /></div>
              <div><label style={lbl}>Nappe Z_w (m) — 0 si absente</label><input style={inp} value={nappe} onChange={(e) => setNappe(e.target.value)} /></div>
            </div>
          </div>
        </>
      )}

      {tab === 'mesures' && (
        <div style={card}>
          <div style={secH}>Paliers de mesure (≥ 4 valides)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['P (bar)', 'V à 15 s', 'V à 30 s', 'V à 60 s', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                {(['p', 'v15', 'v30', 'v60'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setRows((a2) => a2.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                <td style={{ padding: 2 }}><button onClick={() => setRows((a2) => a2.length <= 1 ? a2 : a2.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
          <button onClick={() => setRows((a2) => [...a2, { p: '', v15: '', v30: '', v60: '' }])} style={addBtn}>+ Ajouter un palier</button>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>V₁₅/V₃₀/V₆₀ = volumes lus à 15, 30 et 60 s. Le fluage (V₆₀−V₁₅ ou V₆₀−V₃₀) sert à repérer la pression de fluage p_f.</div>
        </div>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un sondage et cliquez sur <strong>Dépouiller</strong> pour obtenir p_L, E_M et la classification.</div>
          ) : (
            <>
              <div style={secH}>Courbe pressiométrique</div>
              <PressioCurve rows={rows} pL={pLBar} />
              <div style={{ ...secH, marginTop: 18 }}>Résultats du dépouillement</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>{output.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : row.value}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Dépouillement Ménard côté serveur. La courbe trace les lectures saisies ; les corrections (inertie, résistance propre) et le calage restent serveur (§8).</div>
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
