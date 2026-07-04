'use client';

/**
 * FASTLAB — Classification GTR des sols (NF P11-300 / GTR).
 * Saisie des essais d'identification (teneur en eau, granulométrie, limites
 * d'Atterberg) ; la CLASSIFICATION est SERVEUR (moteur `labo` → registryId
 * `labo-classification-gtr`). §8 : la méthode de classement reste serveur ; seuls
 * la classe et le cheminement (client-safe) sont affichés.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface WaterS { t: string; h: string; s: string }
interface LLPoint { x: string; t: string; h: string; s: string }
interface PLPoint { t: string; h: string; s: string }
interface PrPoint { mh: string; t: string; h: string; s: string }
interface CbPoint { N: string; P: string; rho: string; w: string }

const SIEVES: Array<{ key: string; label: string }> = [
  { key: 'gr_20', label: '20 mm' }, { key: 'gr_16', label: '16 mm' }, { key: 'gr_10', label: '10 mm' },
  { key: 'gr_8', label: '8 mm' }, { key: 'gr_6_3', label: '6,3 mm' }, { key: 'gr_5', label: '5 mm' },
  { key: 'gr_4', label: '4 mm' }, { key: 'gr_2', label: '2 mm' }, { key: 'gr_1', label: '1 mm' },
  { key: 'gr_0_5', label: '0,5 mm' }, { key: 'gr_0_2', label: '0,2 mm' }, { key: 'gr_0_08', label: '80 µm' },
];

export interface FastlabForm {
  ident: Record<string, string>;
  water: WaterS[];
  gr_M: string; sieves: Record<string, string>;
  ll: LLPoint[]; pl: PLPoint[];
  vbs: Record<string, string>;
  prMould: string; prType: string; prPoints: PrPoint[];
  cbMethod: string; cbShape: string; cbDim: string; cbRs: string; cbPoints: CbPoint[];
}

/** Payload API PUR (DoD §8 : mesures brutes de labo, chaînes ; classification serveur). */
export function buildFastlabPayload(f: FastlabForm): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.ident)) if (v.trim() !== '') p[`m_${k}`] = v;
  f.water.forEach((w, i) => { const n = i + 1; if (w.t) p[`w_t${n}`] = w.t; if (w.h) p[`w_h${n}`] = w.h; if (w.s) p[`w_s${n}`] = w.s; });
  if (f.gr_M) p.gr_M = f.gr_M;
  for (const [k, v] of Object.entries(f.sieves)) if (v.trim() !== '') p[k] = v;
  f.ll.forEach((r, i) => { const n = i + 1; if (r.x) p[`ll_x${n}`] = r.x; if (r.t) p[`ll_t${n}`] = r.t; if (r.h) p[`ll_h${n}`] = r.h; if (r.s) p[`ll_s${n}`] = r.s; });
  f.pl.forEach((r, i) => { const n = i + 1; if (r.t) p[`pl_t${n}`] = r.t; if (r.h) p[`pl_h${n}`] = r.h; if (r.s) p[`pl_s${n}`] = r.s; });
  // VBS (bleu de méthylène) — NF P94-068
  for (const [k, v] of Object.entries(f.vbs)) if (v.trim() !== '') p[`v_${k}`] = v;
  // Proctor — moule + type + points de compactage (mh = masse humide + moule)
  if (f.prMould) p.pr_mould = f.prMould;
  if (f.prType) p.prType = f.prType;
  f.prPoints.forEach((r, i) => { const n = i + 1; if (r.mh) p[`pr_mh${n}`] = r.mh; if (r.t) p[`pr_t${n}`] = r.t; if (r.h) p[`pr_h${n}`] = r.h; if (r.s) p[`pr_s${n}`] = r.s; });
  // CBR/IPI — méthode + géométrie + points (enfoncement N, force P, ρ, w par énergie)
  if (f.cbMethod) p.ciMethod = f.cbMethod;
  if (f.cbShape) p.ci_shape = f.cbShape;
  if (f.cbDim) p.ci_dim = f.cbDim;
  if (f.cbRs) p.ci_rs = f.cbRs;
  f.cbPoints.forEach((r, i) => { const n = i + 1; if (r.N) p[`ci_N${n}`] = r.N; if (r.P) p[`ci_P${n}`] = r.P; if (r.rho) p[`ci_rho${n}`] = r.rho; if (r.w) p[`ci_w${n}`] = r.w; });
  return p;
}

const ACCENT = '#6b7a2e', INK = '#22260f', MUTED = '#6f7355', LINE = '#dde0cc', PANEL = '#fdfef8';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, color: MUTED, marginBottom: 3, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: `1px solid #cdd0b8`, borderRadius: 7, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', color: MUTED, padding: '0 4px 5px', fontWeight: 700 };

const IDENT: Array<{ k: string; l: string }> = [
  { k: 'ref', l: 'Référence échantillon' }, { k: 'chantier', l: 'Chantier' }, { k: 'client', l: 'Client' },
  { k: 'dossier', l: 'Dossier' }, { k: 'pk', l: 'PK / localisation' }, { k: 'prof', l: 'Profondeur' },
  { k: 'date', l: 'Date prélèvement' }, { k: 'dessai', l: 'Date essai' }, { k: 'op', l: 'Opérateur' },
  { k: 'ing', l: 'Ingénieur' }, { k: 'labo', l: 'Laboratoire' }, { k: 'nature', l: 'Nature du sol' },
];

export default function FastlabPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [ident, setIdent] = useState<Record<string, string>>({ ref: 'SC2 — 1,20 m', nature: 'Limon argileux brun' });
  const [water, setWater] = useState<WaterS[]>([
    { t: '20.00', h: '138.00', s: '120.00' }, { t: '21.50', h: '149.50', s: '130.00' }, { t: '19.80', h: '126.60', s: '110.30' },
  ]);
  const [gr_M, setGrM] = useState('1000');
  const [sieves, setSieves] = useState<Record<string, string>>({ gr_20: '5', gr_16: '15', gr_10: '30', gr_8: '25', gr_6_3: '30', gr_5: '35', gr_4: '40', gr_2: '90', gr_1: '80', gr_0_5: '60', gr_0_2: '40', gr_0_08: '30' });
  const [ll, setLl] = useState<LLPoint[]>([
    { x: '15', t: '15.00', h: '29.05', s: '25.00' }, { x: '22', t: '15.00', h: '28.88', s: '25.00' },
    { x: '28', t: '15.00', h: '28.70', s: '25.00' }, { x: '34', t: '15.00', h: '28.55', s: '25.00' },
  ]);
  const [pl, setPl] = useState<PLPoint[]>([{ t: '10.00', h: '16.00', s: '15.00' }, { t: '10.00', h: '16.05', s: '15.04' }]);
  const [vbs, setVbs] = useState<Record<string, string>>({ conc: '10', prise1: '30', frac1: '100', w1: '4.0', V1: '101', prise2: '30', frac2: '100', w2: '4.0', V2: '101' });
  const [prMould, setPrMould] = useState('A');
  const [prType, setPrType] = useState('n');
  const [prPoints, setPrPoints] = useState<PrPoint[]>([
    { mh: '1836.6', t: '18.0', h: '74.0', s: '68.0' }, { mh: '1944.8', t: '18.0', h: '75.0', s: '68.0' },
    { mh: '2022.6', t: '18.0', h: '76.0', s: '68.0' }, { mh: '2024.1', t: '18.0', h: '77.0', s: '68.0' }, { mh: '1990.6', t: '18.0', h: '78.0', s: '68.0' },
  ]);
  const [cbMethod, setCbMethod] = useState('box');
  const [cbShape, setCbShape] = useState('sq');
  const [cbDim, setCbDim] = useState('60');
  const [cbRs, setCbRs] = useState('2.65');
  const [cbPoints, setCbPoints] = useState<CbPoint[]>([
    { N: '0.36', P: '0.197', rho: '1950', w: '18.5' }, { N: '0.72', P: '0.365', rho: '1965', w: '18.0' },
    { N: '1.08', P: '0.533', rho: '1940', w: '18.8' }, { N: '1.44', P: '0.700', rho: '1970', w: '17.6' },
  ]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'ident' | 'eau' | 'atterberg' | 'vbs' | 'proctor' | 'cbr' | 'resultat'>('ident');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const lb = projs.filter((p) => p.domain === 'LB'); setProjects(lb); setEnt(ent); if (lb.length === 1) setProjectId(lb[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildFastlabPayload({
    ident: { ...ident, geo: ident.geo ?? '' }, water, gr_M, sieves, ll, pl,
    vbs, prMould, prType, prPoints, cbMethod, cbShape, cbDim, cbRs, cbPoints,
  }), [ident, water, gr_M, sieves, ll, pl, vbs, prMould, prType, prPoints, cbMethod, cbShape, cbDim, cbRs, cbPoints]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'labo', label: `FASTLAB — ${ident.ref || 'Échantillon'}`.slice(0, 60), params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setTab('resultat');
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : x?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : x?.reason === 'MODULE_NOT_IN_PACK' ? "Le module FASTLAB n'est pas inclus dans votre abonnement." : (x?.message ?? 'Erreur lors de la classification.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, ident, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de FASTLAB" />;

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const rows = output?.rows ?? [];
  // La classe GTR + le cheminement sont DÉJÀ dans `rows` (allowlist §8 appliquée
  // serveur) — on les en dérive plutôt que d'exposer des clés brutes (desc/path/…).
  const classeFull = String(rows.find((r) => r.label === 'Classe GTR')?.value ?? '');
  const classeDesc = String(rows.find((r) => r.label === 'Description')?.value ?? '');
  const cheminement = rows.filter((r) => /Justification du classement/i.test(r.label)).map((r) => String(r.value));
  // Paramètres = tout SAUF classe/description/justification (déjà dans la carte + cheminement).
  const paramRows = rows.filter((r) => !/^(Classe GTR|Description|Justification du classement)/.test(r.label));
  const calcDisabled = calculating || !projectId || !orgId;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>FASTLAB</div>
          <div style={{ fontSize: 12, color: MUTED }}>Classification des sols · GTR / NF P11-300</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="fl-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="LB" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={230} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de classer' : undefined}
            style={{ background: calcDisabled ? '#bcc0a2' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Classification…' : 'Classer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f5efe0', borderColor: '#ddd0a8', color: '#7a5a1e' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }} role="tablist">
        {([['ident', 'Identification'], ['eau', 'Eau & granulométrie'], ['atterberg', 'Limites d’Atterberg'], ['vbs', 'Bleu (VBS)'], ['proctor', 'Proctor'], ['cbr', 'CBR / IPI'], ['resultat', 'Classe GTR']] as const).map(([id, t]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 13px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'ident' && (
        <div style={card}>
          <div style={secH}>Identification &amp; prélèvement</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 11 }}>
            {IDENT.map((f) => (
              <div key={f.k}><label style={lbl}>{f.l}</label><input style={inp} value={ident[f.k] ?? ''} onChange={(e) => setIdent((p) => ({ ...p, [f.k]: e.target.value }))} /></div>
            ))}
          </div>
        </div>
      )}

      {tab === 'eau' && (
        <>
          <div style={card}>
            <div style={secH}>Teneur en eau (3 prises)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Prise', 'Tare (g)', 'Humide + tare (g)', 'Sec + tare (g)'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{water.map((w, i) => (
                <tr key={i}>
                  <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                  {(['t', 'h', 's'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={w[k]} onChange={(e) => setWater((a) => a.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={card}>
            <div style={secH}>Granulométrie — refus par tamis</div>
            <div style={{ maxWidth: 220, marginBottom: 10 }}><label style={lbl}>Masse totale sèche M (g)</label><input style={inp} value={gr_M} onChange={(e) => setGrM(e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 9 }}>
              {SIEVES.map((s) => (
                <div key={s.key}><label style={lbl}>Refus {s.label} (g)</label><input style={inp} value={sieves[s.key] ?? ''} onChange={(e) => setSieves((p) => ({ ...p, [s.key]: e.target.value }))} /></div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'atterberg' && (
        <>
          <div style={card}>
            <div style={secH}>Limite de liquidité (coupelle — 4 points)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Coups', 'Tare (g)', 'Humide + tare', 'Sec + tare'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{ll.map((r, i) => (
                <tr key={i}>
                  {(['x', 't', 'h', 's'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setLl((a) => a.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={card}>
            <div style={secH}>Limite de plasticité (2 prises)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Prise', 'Tare (g)', 'Humide + tare', 'Sec + tare'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pl.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                  {(['t', 'h', 's'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setPl((a) => a.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'vbs' && (
        <div style={card}>
          <div style={secH}>Valeur de bleu de méthylène (VBS) — NF P94-068</div>
          <div style={{ maxWidth: 240, marginBottom: 12 }}><label style={lbl}>Concentration solution (g/L)</label><input style={inp} value={vbs.conc ?? ''} onChange={(e) => setVbs((p) => ({ ...p, conc: e.target.value }))} /></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Essai', 'Prise (g)', 'Fraction 0/2 (%)', 'w (%)', 'V bleu (mL)'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{[1, 2].map((n) => (
              <tr key={n}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{n}</td>
                {(['prise', 'frac', 'w', 'V'] as const).map((k) => { const key = `${k}${n}`; return <td key={k} style={{ padding: 2 }}><input style={inp} value={vbs[key] ?? ''} onChange={(e) => setVbs((p) => ({ ...p, [key]: e.target.value }))} /></td>; })}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Le VBS caractérise la fraction 0/2 mm — voie de classement alternative à l&apos;indice de plasticité pour la famille de sol.</div>
        </div>
      )}

      {tab === 'proctor' && (
        <div style={card}>
          <div style={secH}>Essai Proctor — NF EN 13286-2</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <div><label style={lbl}>Moule</label>
              <select style={{ ...inp, width: 220 }} value={prMould} onChange={(e) => setPrMould(e.target.value)}>
                <option value="A">A — Ø101,6 × h116,4</option><option value="B">B — Ø152 × h116,4</option><option value="C">C — Ø250 × h200</option>
              </select>
            </div>
            <div><label style={lbl}>Énergie de compactage</label>
              <div style={{ display: 'flex', gap: 6 }}>{([['n', 'Normal'], ['m45', 'Modifié 4,5 kg'], ['m15', 'Modifié 15 kg']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPrType(v)} style={{ border: `1px solid ${prType === v ? ACCENT : LINE}`, background: prType === v ? '#eef1df' : '#fff', color: prType === v ? ACCENT : MUTED, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{l}</button>
              ))}</div>
            </div>
          </div>
          <div style={secH}>Points de compactage</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Point', 'Humide + moule (g)', 'Tare (g)', 'Humide + tare', 'Sec + tare'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{prPoints.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                {(['mh', 't', 'h', 's'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setPrPoints((a) => a.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
              </tr>
            ))}</tbody>
          </table>
          <button onClick={() => setPrPoints((a) => [...a, { mh: '', t: '', h: '', s: '' }])} style={{ marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#eef1df', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>+ Point</button>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Le Proctor donne w_OPN et ρ_d;max — il détermine l&apos;état hydrique (th/h/m/s/ts) qui complète la classe GTR.</div>
        </div>
      )}

      {tab === 'cbr' && (
        <div style={card}>
          <div style={secH}>Indice CBR / IPI — NF P94-078</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div><label style={lbl}>Méthode</label><select style={inp} value={cbMethod} onChange={(e) => setCbMethod(e.target.value)}><option value="box">Boîte</option><option value="ring">Anneau</option></select></div>
            <div><label style={lbl}>Forme du poinçon</label><select style={inp} value={cbShape} onChange={(e) => setCbShape(e.target.value)}><option value="sq">Carrée</option><option value="circ">Circulaire</option></select></div>
            <div><label style={lbl}>Dimension (mm)</label><input style={inp} value={cbDim} onChange={(e) => setCbDim(e.target.value)} /></div>
            <div><label style={lbl}>ρ_s (Mg/m³)</label><input style={inp} value={cbRs} onChange={(e) => setCbRs(e.target.value)} /></div>
          </div>
          <div style={secH}>Points (par énergie)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Point', 'Enfoncement (mm)', 'Force (kN)', 'ρ (kg/m³)', 'w (%)'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{cbPoints.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                {(['N', 'P', 'rho', 'w'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setCbPoints((a) => a.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>L&apos;indice CBR/IPI caractérise la portance du sol support — paramètre de dimensionnement des chaussées.</div>
        </div>
      )}

      {tab === 'resultat' && (
        <div style={card} data-testid="resultat">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Classer</strong> pour obtenir la classe GTR.</div>
          ) : (
            <>
              {classeFull && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', borderRadius: 12, background: '#eef1df', border: `1px solid ${LINE}`, marginBottom: 16 }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: ACCENT, letterSpacing: 0.5 }}>{classeFull}</div>
                  <div style={{ fontSize: 13, color: INK }}>{classeDesc}</div>
                </div>
              )}
              {cheminement.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={secH}>Cheminement de classement</div>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: INK, lineHeight: 1.7 }}>
                    {cheminement.map((p, i) => <li key={i}>{p}</li>)}
                  </ol>
                </div>
              )}
              <div style={secH}>Paramètres d’identification</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>{paramRows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : row.value}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Classification NF P11-300 / GTR côté serveur. Les seuils et la logique de classement restent serveur (§8) ; seuls la classe et le cheminement sont affichés.</div>
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
