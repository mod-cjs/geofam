'use client';

/**
 * Terzaghi — Fondations superficielles (NF P 94-261 / EC7).
 * Reproduction FIDÈLE de l'outil client (terzaghi_V13) : 2 colonnes saisie /
 * résultats, sections métier, coupe SVG, onglets Coupe/Vérifications/Note.
 * Le CALCUL est SERVEUR (moteur `terzaghi` → `fondation-superficielle`) ; les
 * formules et coefficients de calage restent côté serveur (DoD §8), seuls les
 * résultats de vérification (sollicitantes/admissibles) sont affichés.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, Fragment } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv, CalcOutputRow } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

// ── Types (miroir borné de TerzaghiInputSchema) ──
type Forme = 'filante' | 'carree' | 'rect' | 'circ';
type SolCat = 'argiles' | 'sables' | 'craies' | 'marnes' | 'roches';
type Essai = 'pressio' | 'penetro' | 'labo';
type Etat = 'ELU_F' | 'ELU_A' | 'ELS_C' | 'ELS_F' | 'ELS_QP';
type CphiMode = 'auto' | 'nd' | 'd';
type ProfilMode = 'essais' | 'couches';
type TalusDir = 'ext' | 'int';
interface SondageRow { z: string; pl: string; em: string; al: string; qc: string }
interface ChargeRow { etat: Etat; fz: string; fx: string; fy: string; mx: string; my: string }

const ETATS: { v: Etat; l: string }[] = [
  { v: 'ELU_F', l: 'ELU fond.' }, { v: 'ELU_A', l: 'ELU acc.' }, { v: 'ELS_C', l: 'ELS car.' }, { v: 'ELS_F', l: 'ELS fréq.' }, { v: 'ELS_QP', l: 'ELS q-p.' },
];
const SOLS: { v: SolCat; l: string }[] = [
  { v: 'argiles', l: 'Argiles et limons' }, { v: 'sables', l: 'Sables et graves' }, { v: 'craies', l: 'Craies' }, { v: 'marnes', l: 'Marnes et marno-calcaires' }, { v: 'roches', l: 'Roches altérées' },
];

// Guides normatifs (verbatim outil client — NF P 94-261).
const FRAC: Record<string, string> = { '1': '1', '2/3': '0.67', '1/2': '0.5', '1/3': '0.33', '1/4': '0.25' };
const ALPHA_SOL: { etat: string; tourbe: string; cols: [string, string][] }[] = [
  { etat: 'Surconsolidé ou très serré', tourbe: '—', cols: [['> 16', '1'], ['> 14', '2/3'], ['> 12', '1/2'], ['> 10', '1/3']] },
  { etat: 'Normalement consolidé ou serré', tourbe: '1', cols: [['9 – 16', '2/3'], ['8 – 14', '1/2'], ['7 – 12', '1/3'], ['6 – 10', '1/4']] },
  { etat: 'Surconsolidé altéré, remanié ou lâche', tourbe: '1', cols: [['9 – 16', '2/3'], ['8 – 14', '1/2'], ['5 – 7', '1/3'], ['—', '—']] },
];
const ALPHA_ROCHER: [string, string][] = [['Très peu fracturé', '2/3'], ['Normalement fracturé', '1/2'], ['Très fracturé', '1/3'], ['Très altéré', '2/3']];
const SANG_ROWS: [string, string, string, string][] = [
  ['Argile peu plastique', '< 0,7', '3 à 8', '5'], ['Argile peu plastique', '0,7 à 2', '2 à 5', '3'], ['Argile peu plastique', '> 2', '1 à 2,5', '1,5'],
  ['Limon peu plastique', '< 2', '3 à 6', '4'], ['Limon peu plastique', '> 2', '1 à 2', '1,5'],
  ['Argile / limon très plastique', '< 2', '2 à 6', '3'], ['Argile / limon très plastique', '> 2', '1 à 2', '1,5'],
  ['Limon très organique', '< 1,2', '2 à 8', '4'], ['Tourbe (w 50–100 %)', '< 0,7', '1,5 à 4', '2'], ['Tourbe (w 100–200 %)', '< 0,7', '1 à 1,5', '1,2'],
  ['Tourbe (w > 200 %)', '< 0,7', '0,4 à 1,0', '0,7'], ['Craie', '2 à 3', '2 à 4', '3'], ['Craie', '> 3', '1,5 à 3', '2'], ['Sable', '< 5', '2', '2'], ['Sable', '> 10', '1,5', '1,5'],
];

// ── État de saisie + payload pur (DoD §8 : entrées bornées uniquement) ──
export interface TerzaghiForm {
  projet?: string;
  forme: Forme; B: string; L: string; D: string; beton: 'coule' | 'prefa';
  solCat: SolCat; c: string; phi: string; eYoung: string; nuSol: string; nappe: string;
  gAvant: string; gApres: string; gSous: string;
  cphiOn: boolean; cphiMode: CphiMode; talusOn: boolean; beta: string; dTalus: string; talusDir: TalusDir;
  profilMode: ProfilMode; alphaSang: string; essai: Essai;
  sondage: SondageRow[]; charges: ChargeRow[];
}
export function buildTerzaghiPayload(f: TerzaghiForm): Record<string, unknown> {
  return {
    projet: f.projet,
    forme: f.forme, B: f.B, L: f.forme === 'rect' ? f.L : f.B, D: f.D, beton: f.beton,
    solCat: f.solCat, c: f.c, phi: f.phi, eYoung: f.eYoung, nuSol: f.nuSol, nappe: f.nappe,
    gAvant: f.gAvant, gApres: f.gApres, gSous: f.gSous,
    cphiOn: f.cphiOn, cphiMode: f.cphiMode, talusOn: f.talusOn, beta: f.beta, dTalus: f.dTalus, talusDir: f.talusDir,
    profilMode: f.profilMode, alphaSang: f.alphaSang, essai: f.essai,
    sondage: f.sondage.map((s) => ({ z: s.z, pl: s.pl, em: s.em, al: s.al, qc: s.qc })),
    charges: f.charges.map((x) => ({ etat: x.etat, fz: x.fz, fx: x.fx, fy: x.fy, mx: x.mx, my: x.my })),
  };
}

// ── Design (accent terre) ──
const ACCENT = '#a65a1e', INK = '#232e33', MUTED = '#71767a', LINE = '#d9d3c2', LINE2 = '#c9c2ad', PANEL = '#fcfbf6', PANEL2 = '#f3f1e8';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, marginBottom: 14, overflow: 'hidden' };
const cardH: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderBottom: `1px solid ${LINE}`, background: PANEL2 };
const cardNo: React.CSSProperties = { width: 22, height: 22, borderRadius: 6, background: ACCENT, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' };
const cardB: React.CSSProperties = { padding: '13px 14px' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const unit: React.CSSProperties = { fontWeight: 400, color: MUTED };
const inp: React.CSSProperties = { width: '100%', border: `1px solid ${LINE2}`, borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff' };
const g2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const g3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const subnote: React.CSSProperties = { fontSize: 10.5, color: MUTED, lineHeight: 1.5, marginTop: 8 };
const gtable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const gth: React.CSSProperties = { border: `1px solid ${LINE}`, background: PANEL2, padding: '5px 7px', fontSize: 10.5, color: MUTED, fontWeight: 700, textAlign: 'center' };
const gtd: React.CSSProperties = { border: `1px solid ${LINE}`, padding: '4px 7px', textAlign: 'center' };
const gtdL: React.CSSProperties = { border: `1px solid ${LINE}`, padding: '4px 7px', textAlign: 'left' };
const aval: React.CSSProperties = { border: `1px solid ${ACCENT}`, background: '#f4edd8', color: ACCENT, borderRadius: 5, padding: '3px 9px', cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: 'inherit' };

/** Segmented control fidèle (.seg). */
function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: React.ReactNode }[] }) {
  return (
    <div style={{ display: 'inline-flex', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 2, gap: 2, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          style={{ border: 'none', background: value === o.v ? ACCENT : 'transparent', color: value === o.v ? '#fff' : MUTED, borderRadius: 6, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** Coupe transversale (schématique, DISPLAY ONLY). */
function Coupe({ B, D, nappe, forme }: { B: string; D: string; nappe: string; forme: Forme }) {
  const b = Math.max(0.2, Number(B) || 2), d = Math.max(0, Number(D) || 1);
  const nap = nappe === '' ? null : Number(nappe);
  const W = 480, H = 300, scale = 30, cx = W / 2, tn = 66, baseY = tn + d * scale, halfB = (b * scale) / 2;
  const napY = nap != null && !isNaN(nap) ? tn + nap * scale : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Coupe : semelle ${forme} largeur ${b} m, encastrement ${d} m`}>
      <rect x="0" y={tn} width={W} height={H - tn} fill="#e8e0cd" />
      {[0, 1, 2, 3, 4, 5, 6].map((k) => <line key={k} x1="0" y1={tn + 20 + k * 32} x2={W} y2={tn + 8 + k * 32} stroke="#cbbf9e" strokeWidth="0.6" />)}
      <line x1="0" y1={tn} x2={W} y2={tn} stroke="#8a8474" strokeWidth="1.4" />
      <text x="8" y={tn - 6} fontSize="10.5" fill={MUTED}>Terrain naturel</text>
      {napY != null && (<><line x1="0" y1={napY} x2={W} y2={napY} stroke="#3d7ea6" strokeWidth="1.2" strokeDasharray="5 3" /><text x={W - 8} y={napY - 5} fontSize="10.5" fill="#3d7ea6" textAnchor="end">▽ Nappe</text></>)}
      <rect x={cx - halfB} y={baseY} width={halfB * 2} height="18" fill="#7c7d80" stroke="#3a3b3d" />
      <rect x={cx - 10} y={tn - 30} width="20" height={baseY - tn + 30} fill="#9a9ba0" stroke="#3a3b3d" />
      <line x1={cx} y1={tn - 46} x2={cx} y2={tn - 30} stroke={ACCENT} strokeWidth="2.4" markerEnd="url(#tzar)" />
      <defs><marker id="tzar" markerWidth="8" markerHeight="8" refX="4" refY="7" orient="auto"><path d="M1 1 L4 7 L7 1" fill="none" stroke={ACCENT} strokeWidth="1.5" /></marker></defs>
      <line x1={cx - halfB} y1={baseY + 30} x2={cx + halfB} y2={baseY + 30} stroke={INK} strokeWidth="0.9" />
      <text x={cx} y={baseY + 43} fontSize="11" fill={INK} textAnchor="middle" fontWeight="600">B = {b} m</text>
      <line x1={cx + halfB + 24} y1={tn} x2={cx + halfB + 24} y2={baseY} stroke={INK} strokeWidth="0.9" />
      <text x={cx + halfB + 30} y={(tn + baseY) / 2} fontSize="11" fill={INK}>D = {d} m</text>
    </svg>
  );
}

export default function TerzaghiPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [essai, setEssai] = useState<Essai>('pressio');
  const [profilMode, setProfilMode] = useState<ProfilMode>('couches');
  const [alphaSang, setAlphaSang] = useState('');
  const [sondage, setSondage] = useState<SondageRow[]>([
    { z: '1', pl: '0.8', em: '8', al: '', qc: '' }, { z: '3', pl: '1.2', em: '12', al: '', qc: '' }, { z: '5', pl: '1.6', em: '16', al: '', qc: '' },
  ]);
  const [solCat, setSolCat] = useState<SolCat>('sables');
  const [nappe, setNappe] = useState(''); const [gAvant, setGAvant] = useState('20'); const [gApres, setGApres] = useState('20'); const [gSous, setGSous] = useState('');
  const [c, setC] = useState(''); const [phi, setPhi] = useState(''); const [eYoung, setEYoung] = useState(''); const [nuSol, setNuSol] = useState('0.33');
  const [cphiOn, setCphiOn] = useState(false); const [cphiMode, setCphiMode] = useState<CphiMode>('auto');
  const [forme, setForme] = useState<Forme>('carree'); const [B, setB] = useState('2'); const [L, setL] = useState('2'); const [D, setD] = useState('1');
  const [talusOn, setTalusOn] = useState(false); const [beta, setBeta] = useState(''); const [dTalus, setDTalus] = useState(''); const [talusDir, setTalusDir] = useState<TalusDir>('ext');
  const [beton, setBeton] = useState<'coule' | 'prefa'>('coule');
  const [charges, setCharges] = useState<ChargeRow[]>([
    { etat: 'ELU_F', fz: '900', fx: '', fy: '', mx: '', my: '' }, { etat: 'ELS_C', fz: '650', fx: '', fy: '', mx: '', my: '' },
  ]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [rtab, setRtab] = useState<'coupe' | 'verifs' | 'note'>('coupe');
  const [guide, setGuide] = useState<'alpha' | 'sang' | null>(null);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const fd = projs.filter((p) => p.domain === 'FD'); setProjects(fd); setEnt(ent); if (fd.length === 1) setProjectId(fd[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildTerzaghiPayload({
    projet: projects.find((p) => p.id === projectId)?.name, forme, B, L, D, beton, solCat, c, phi, eYoung, nuSol, nappe, gAvant, gApres, gSous,
    cphiOn, cphiMode, talusOn, beta, dTalus, talusDir, profilMode, alphaSang, essai, sondage, charges,
  }), [projects, projectId, forme, B, L, D, beton, solCat, c, phi, eYoung, nuSol, nappe, gAvant, gApres, gSous, cphiOn, cphiMode, talusOn, beta, dTalus, talusDir, profilMode, alphaSang, essai, sondage, charges]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    const label = `Terzaghi — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'terzaghi', label, params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setRtab('verifs');
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setCalcError(e?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : e?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : e?.reason === 'MODULE_NOT_IN_PACK' ? "Le module Terzaghi n'est pas inclus dans votre abonnement." : (e?.message ?? 'Erreur lors du calcul. Réessayez.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de Terzaghi" />;

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const calcDisabled = calculating || !projectId || !orgId;
  const upS = (i: number, k: keyof SondageRow, v: string) => setSondage((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const upC = (i: number, k: keyof ChargeRow, v: string) => setCharges((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const applyAlpha = (fr: string) => { const v = FRAC[fr] ?? fr; setSondage((p) => p.map((r) => ({ ...r, al: v }))); setGuide(null); };
  const applySang = (v: string) => { setAlphaSang(v.replace(',', '.')); setGuide(null); };

  return (
    <div style={{ padding: '18px 20px 56px', fontFamily: 'inherit', color: INK, maxWidth: 1440, margin: '0 auto' }}>
      {/* Bandeau outil */}
      <div style={{ ...card, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '13px 16px' }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Terzaghi</div>
          <div style={{ fontSize: 12, color: MUTED }}>Fondations superficielles · NF P 94-261 / Eurocode 7 · capacité portante &amp; tassements</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="tz-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="FD" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={220} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#c9beb0' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Calculer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f6e5e1', borderColor: '#e0b3aa', color: '#8f2a1f', padding: '11px 15px' }} role="alert">{calcError}</div>}

      {/* 2 colonnes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 500px) 1fr', gap: 18, alignItems: 'start' }} className="tz-layout">
        {/* ===== SAISIE ===== */}
        <section>
          {/* 01 Sondage in situ */}
          <div style={card}>
            <div style={cardH}><span style={cardNo}>1</span><h2 style={{ fontSize: 14, margin: 0 }}>Sondage in situ</h2><span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>profondeurs / TN</span></div>
            <div style={cardB}>
              <label style={lbl}>Méthode de calcul</label>
              <Seg value={essai} onChange={setEssai} options={[{ v: 'pressio', l: 'Pressiomètre Ménard' }, { v: 'penetro', l: 'Pénétromètre statique' }, { v: 'labo', l: 'Méthode c–φ' }]} />
              {essai === 'penetro' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <label style={{ ...lbl, margin: 0 }}>α Sanglerat (M = α·q<sub>c</sub>) :</label>
                  <input style={{ ...inp, width: 90 }} value={alphaSang} onChange={(e) => setAlphaSang(e.target.value)} placeholder="ex. 2" />
                  <button type="button" onClick={() => setGuide('sang')} style={{ ...aval, background: '#fff' }}>Guide α Sanglerat</button>
                </div>
              )}
              <table style={{ ...gtable, marginTop: 11 }}>
                <thead><tr><th style={gth}>Prof. (m)</th><th style={gth}>{essai === 'penetro' ? 'qc (MPa)' : 'pl* (MPa)'}</th>{essai !== 'penetro' && <th style={gth}>E_M (MPa)</th>}<th style={gth}>α <button type="button" onClick={() => setGuide('alpha')} title="Guide de choix de α" style={{ border: `1px solid ${LINE2}`, background: '#fff', color: ACCENT, borderRadius: 4, width: 16, height: 16, lineHeight: '1', cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: 0 }}>?</button></th><th style={gth}></th></tr></thead>
                <tbody>
                  {sondage.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...gtd, padding: 2 }}><input style={inp} value={r.z} onChange={(e) => upS(i, 'z', e.target.value)} /></td>
                      <td style={{ ...gtd, padding: 2 }}><input style={inp} value={essai === 'penetro' ? r.qc : r.pl} onChange={(e) => upS(i, essai === 'penetro' ? 'qc' : 'pl', e.target.value)} /></td>
                      {essai !== 'penetro' && <td style={{ ...gtd, padding: 2 }}><input style={inp} value={r.em} onChange={(e) => upS(i, 'em', e.target.value)} /></td>}
                      <td style={{ ...gtd, padding: 2 }}><input style={inp} value={r.al} onChange={(e) => upS(i, 'al', e.target.value)} placeholder="—" /></td>
                      <td style={{ ...gtd, padding: 2 }}><button onClick={() => setSondage((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)))} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: '#963b28', fontSize: 11 }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setSondage((p) => [...p, { z: '', pl: '', em: '', al: '', qc: '' }])} style={{ marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#f4edd8', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>+ Ajouter une ligne</button>
              <div style={{ marginTop: 11 }}>
                <label style={lbl}>Lecture du profil</label>
                <Seg value={profilMode} onChange={setProfilMode} options={[{ v: 'couches', l: 'Couches (escalier)' }, { v: 'essais', l: 'Essais ponctuels (interpolé)' }]} />
              </div>
              <div style={subnote}><strong>Couches</strong> : chaque valeur s&apos;applique de sa profondeur jusqu&apos;à la ligne suivante. <strong>Essais ponctuels</strong> : interpolation entre points de mesure.</div>

              <div style={{ ...g2, marginTop: 13 }}>
                <div><label style={lbl}>Catégorie de terrain porteur <span style={unit}>(k_p)</span></label>
                  <select style={inp} value={solCat} onChange={(e) => setSolCat(e.target.value as SolCat)}>{SOLS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select></div>
                <div><label style={lbl}>Nappe <span style={unit}>(m/TN, vide = absente)</span></label><input style={inp} value={nappe} onChange={(e) => setNappe(e.target.value)} /></div>
                <div><label style={lbl}>γ avant travaux <span style={unit}>(kN/m³)</span></label><input style={inp} value={gAvant} onChange={(e) => setGAvant(e.target.value)} /></div>
                <div><label style={lbl}>γ après travaux <span style={unit}>(kN/m³)</span></label><input style={inp} value={gApres} onChange={(e) => setGApres(e.target.value)} /></div>
                <div><label style={lbl}>Cohésion c′ <span style={unit}>(kPa)</span></label><input style={inp} value={c} onChange={(e) => setC(e.target.value)} placeholder="—" /></div>
                <div><label style={lbl}>Angle φ′ <span style={unit}>(°)</span></label><input style={inp} value={phi} onChange={(e) => setPhi(e.target.value)} placeholder="—" /></div>
                <div><label style={lbl}>Module E <span style={unit}>(MPa)</span></label><input style={inp} value={eYoung} onChange={(e) => setEYoung(e.target.value)} placeholder="—" /></div>
                <div><label style={lbl}>Poisson ν <span style={unit}>(–)</span></label><input style={inp} value={nuSol} onChange={(e) => setNuSol(e.target.value)} /></div>
              </div>
              <label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={cphiOn} onChange={(e) => setCphiOn(e.target.checked)} /> Portance par la méthode analytique c–φ (annexe F)</label>
              {cphiOn && (
                <div style={{ ...g2, marginTop: 8 }}>
                  <div><label style={lbl}>Comportement</label>
                    <select style={inp} value={cphiMode} onChange={(e) => setCphiMode(e.target.value as CphiMode)}><option value="auto">Automatique (φ′ &gt; 0 → drainé)</option><option value="nd">Non drainé (c = cu)</option><option value="d">Drainé (c′ et φ′)</option></select></div>
                  <div><label style={lbl}>γ sous la base <span style={unit}>(kN/m³)</span></label><input style={inp} value={gSous} onChange={(e) => setGSous(e.target.value)} placeholder="défaut : γ après" /></div>
                </div>
              )}
            </div>
          </div>

          {/* 02 Fondation */}
          <div style={card}>
            <div style={cardH}><span style={cardNo}>2</span><h2 style={{ fontSize: 14, margin: 0 }}>Fondation</h2></div>
            <div style={cardB}>
              <label style={lbl}>Forme de la semelle</label>
              <Seg value={forme} onChange={setForme} options={[{ v: 'filante', l: 'Filante' }, { v: 'carree', l: 'Carrée' }, { v: 'rect', l: 'Rectangulaire' }, { v: 'circ', l: 'Circulaire' }]} />
              <div style={{ ...g3, marginTop: 11 }}>
                <div><label style={lbl}>{forme === 'circ' ? 'Diamètre B' : 'Largeur B'} <span style={unit}>(m)</span></label><input style={inp} value={B} onChange={(e) => setB(e.target.value)} /></div>
                {forme === 'rect' && <div><label style={lbl}>Longueur L <span style={unit}>(m)</span></label><input style={inp} value={L} onChange={(e) => setL(e.target.value)} /></div>}
                <div><label style={lbl}>Encastrement D <span style={unit}>(m/TN)</span></label><input style={inp} value={D} onChange={(e) => setD(e.target.value)} /></div>
              </div>
              <label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center', marginTop: 12 }}><input type="checkbox" checked={talusOn} onChange={(e) => setTalusOn(e.target.checked)} /> Présence d&apos;un talus à proximité</label>
              {talusOn && (
                <div style={{ ...g2, marginTop: 8 }}>
                  <div><label style={lbl}>Pente β <span style={unit}>(°)</span></label><input style={inp} value={beta} onChange={(e) => setBeta(e.target.value)} /></div>
                  <div><label style={lbl}>Distance d <span style={unit}>(m)</span></label><input style={inp} value={dTalus} onChange={(e) => setDTalus(e.target.value)} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Inclinaison de la charge / talus</label>
                    <select style={inp} value={talusDir} onChange={(e) => setTalusDir(e.target.value as TalusDir)}><option value="ext">Vers l&apos;extérieur (D.2.6)</option><option value="int">Vers l&apos;intérieur (D.2.6.1)</option></select></div>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <label style={lbl}>Interface (glissement)</label>
                <select style={{ ...inp, maxWidth: 320 }} value={beton} onChange={(e) => setBeton(e.target.value as 'coule' | 'prefa')}><option value="coule">Béton coulé en place — δa = φ′</option><option value="prefa">Préfabriqué lisse — δa = ⅔ φ′</option></select>
              </div>
            </div>
          </div>

          {/* 03 Cas de charge */}
          <div style={card}>
            <div style={cardH}><span style={cardNo}>3</span><h2 style={{ fontSize: 14, margin: 0 }}>Cas de charge</h2><span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>kN, kN·m</span></div>
            <div style={cardB}>
              <div style={{ overflowX: 'auto' }}>
                <table style={gtable}>
                  <thead><tr>{['État-limite', 'Fz', 'Fx', 'Fy', 'Mx', 'My', ''].map((h) => <th key={h} style={gth}>{h}</th>)}</tr></thead>
                  <tbody>
                    {charges.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...gtd, padding: 2, minWidth: 90 }}><select style={inp} value={r.etat} onChange={(e) => upC(i, 'etat', e.target.value)}>{ETATS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></td>
                        {(['fz', 'fx', 'fy', 'mx', 'my'] as const).map((k) => <td key={k} style={{ ...gtd, padding: 2 }}><input style={{ ...inp, minWidth: 52 }} value={r[k]} onChange={(e) => upC(i, k, e.target.value)} placeholder={k === 'fz' ? '' : '—'} /></td>)}
                        <td style={{ ...gtd, padding: 2 }}><button onClick={() => setCharges((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)))} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: '#963b28', fontSize: 11 }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => setCharges((p) => [...p, { etat: 'ELU_F', fz: '', fx: '', fy: '', mx: '', my: '' }])} style={{ marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#f4edd8', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>+ Ajouter un cas de charge</button>
              <div style={subnote}>F<sub>z</sub> vertical, F<sub>x</sub> selon B, F<sub>y</sub> selon L. Semelle filante : valeurs <strong>par mètre linéaire</strong>.</div>
            </div>
          </div>
        </section>

        {/* ===== RÉSULTATS ===== */}
        <section style={{ ...card, position: 'sticky', top: 12 }}>
          <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: `1px solid ${LINE}`, background: PANEL2 }} role="tablist">
            {([['coupe', 'Coupe'], ['verifs', 'Vérifications'], ['note', 'Note de calcul']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={rtab === id} onClick={() => setRtab(id)} style={{ border: 'none', background: rtab === id ? ACCENT : 'transparent', color: rtab === id ? '#fff' : MUTED, borderRadius: 7, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
            ))}
            {output && (
              <button data-testid="btn-imprimer" onClick={handleEmitPv} disabled={emittingPv} style={{ marginLeft: 'auto', background: '#fff', color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 7, padding: '7px 12px', fontWeight: 600, cursor: emittingPv ? 'wait' : 'pointer', fontSize: 12.5 }}>{emittingPv ? 'Émission…' : 'Émettre le PV scellé'}</button>
            )}
          </div>
          <div style={{ padding: '16px 18px' }}>
            {rtab === 'coupe' && (
              <div style={{ background: 'radial-gradient(120% 100% at 50% 0,#fdfdfb,#efece3)', border: `1px solid ${LINE}`, borderRadius: 10 }}><Coupe B={B} D={D} nappe={nappe} forme={forme} /></div>
            )}
            {rtab === 'verifs' && (
              <div data-testid="verdict-banner">
                {!output ? <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Calculer</strong>.</div> : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderRadius: 11, marginBottom: 14, background: output.verdict === 'PASS' ? '#e4efe6' : output.verdict === 'FAIL' ? '#f6e5e1' : '#f4edd8', border: `1px solid ${output.verdict === 'PASS' ? '#a9d0b3' : output.verdict === 'FAIL' ? '#e0b3aa' : '#e6cf9c'}` }}>
                      <b style={{ fontSize: 15, color: output.verdict === 'PASS' ? '#2e7d4f' : output.verdict === 'FAIL' ? '#b23a2e' : '#96701a' }}>{output.verdict === 'PASS' ? 'Fondation vérifiée — critères EC7 satisfaits' : output.verdict === 'FAIL' ? 'Fondation non vérifiée — reprise nécessaire' : 'Résultats de vérification'}</b>
                    </div>
                    <ResultTable rows={output.rows} />
                    {output.details && output.details.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, margin: '4px 0 10px' }}>Détails de calcul — intermédiaires de la méthode</div>
                        <ResultTable rows={output.details} />
                      </div>
                    )}
                    <div style={subnote}>Intermédiaires de la méthode exposés ci-dessus ; seuls les coefficients de calage propriétaires (facteurs de portance) restent côté serveur (DoD §8).</div>
                  </>
                )}
              </div>
            )}
            {rtab === 'note' && (
              output ? <NoteDeCalcul output={output} projet={projects.find((p) => p.id === projectId)?.name} pv={pvResult} /> : <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Lancez le calcul pour générer la note.</div>
            )}
          </div>
        </section>
      </div>

      {/* Modals guides */}
      {guide && (
        <div role="dialog" aria-modal="true" onClick={() => setGuide(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(25,22,15,.45)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL, borderRadius: 12, maxWidth: 740, width: '100%', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: PANEL }}>
              <h3 style={{ margin: 0, fontSize: 15, color: INK }}>{guide === 'alpha' ? 'Choisir le coefficient rhéologique α (Ménard)' : 'Coefficient α de Sanglerat — M = α·qc'}</h3>
              <button onClick={() => setGuide(null)} aria-label="Fermer" style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: MUTED }}>×</button>
            </div>
            <div style={{ padding: '16px 18px' }}>
              {guide === 'alpha' ? (
                <>
                  <p style={{ fontSize: 12, color: MUTED, marginTop: 0 }}>α via E<sub>M</sub>/p<sub>l</sub> (NF P 94-261, tab. H.2.1.1). <strong>Cliquez une valeur</strong> pour l&apos;appliquer à toute la colonne α.</p>
                  <table style={gtable}><thead><tr><th style={gth} rowSpan={2}>État du terrain</th><th style={gth}>Tourbe</th><th style={gth} colSpan={2}>Argile</th><th style={gth} colSpan={2}>Limon</th><th style={gth} colSpan={2}>Sable</th><th style={gth} colSpan={2}>Grave</th></tr><tr><th style={gth}>α</th>{[0, 1, 2, 3].map((k) => <Fragment key={k}><th style={gth}>E/p</th><th style={gth}>α</th></Fragment>)}</tr></thead>
                    <tbody>{ALPHA_SOL.map((r, i) => (<tr key={i}><td style={gtdL}>{r.etat}</td><td style={gtd}>{r.tourbe === '—' ? '—' : <button style={aval} onClick={() => applyAlpha(r.tourbe)}>{r.tourbe}</button>}</td>{r.cols.map(([rg, al], j) => <Fragment key={j}><td style={gtd}>{rg}</td><td style={gtd}>{al === '—' ? '—' : <button style={aval} onClick={() => applyAlpha(al)}>{al}</button>}</td></Fragment>)}</tr>))}</tbody>
                  </table>
                  <table style={{ ...gtable, maxWidth: 340, marginTop: 12 }}><thead><tr><th style={gth}>Rocher</th><th style={gth}>α</th></tr></thead><tbody>{ALPHA_ROCHER.map(([n, al], i) => <tr key={i}><td style={gtdL}>{n}</td><td style={gtd}><button style={aval} onClick={() => applyAlpha(al)}>{al}</button></td></tr>)}</tbody></table>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: MUTED, marginTop: 0 }}>M = α·q<sub>c</sub> (NF P 94-261, tab. J.2.3). <strong>Cliquez une valeur</strong>.</p>
                  <table style={gtable}><thead><tr><th style={gth}>Type de sol</th><th style={gth}>q<sub>c</sub> (MPa)</th><th style={gth}>α (plage)</th><th style={gth}>Valeur</th></tr></thead><tbody>{SANG_ROWS.map((r, i) => <tr key={i}><td style={gtdL}>{r[0]}</td><td style={gtd}>{r[1]}</td><td style={gtd}>{r[2]}</td><td style={gtd}><button style={aval} onClick={() => applySang(r[3])}>{r[3]}</button></td></tr>)}</tbody></table>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`@media (max-width:900px){.tz-layout{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}

// ── Rendu résultats (§8 : {verdict, rows}) ──
function ResultTable({ rows }: { rows: CalcOutputRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead><tr>{['Grandeur', 'Valeur', 'Unité', 'Statut'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: MUTED, padding: '6px 8px', fontWeight: 700, borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => (
        <tr key={i}>
          <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
          <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : row.value}</td>
          <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
          <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.status && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: row.status === 'ok' ? '#e4efe6' : '#f6e5e1', color: row.status === 'ok' ? '#2e7d4f' : '#b23a2e' }}>{row.status === 'ok' ? 'OK' : 'NON'}</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function NoteDeCalcul({ output, projet, pv }: { output: NormalizedCalcOutput; projet?: string; pv: OfficialPv | null }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '20px 22px', background: '#fff' }}>
      <div style={{ borderBottom: `2px solid ${INK}`, paddingBottom: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><div style={{ fontSize: 15, fontWeight: 700 }}>Note de dimensionnement — fondation superficielle</div><div style={{ fontSize: 11, color: MUTED }}>Terzaghi · NF P 94-261 / EC7</div></div>
        <div style={{ textAlign: 'right', fontSize: 11, color: MUTED }}><b style={{ color: INK }}>{projet ?? '—'}</b><br />{new Date().toLocaleDateString('fr-FR')}</div>
      </div>
      <div style={{ display: 'inline-block', padding: '6px 14px', border: `2px solid ${output.verdict === 'PASS' ? '#2e7d4f' : '#b23a2e'}`, color: output.verdict === 'PASS' ? '#2e7d4f' : '#b23a2e', borderRadius: 8, fontWeight: 800, transform: 'rotate(-1.5deg)', marginBottom: 14 }}>{output.verdict === 'PASS' ? 'CONFORME' : output.verdict === 'FAIL' ? 'NON CONFORME' : 'RÉSULTATS'}</div>
      <ResultTable rows={output.rows} />
      {output.details && output.details.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, margin: '4px 0 10px' }}>Détails de calcul — intermédiaires de la méthode</div>
          <ResultTable rows={output.details} />
        </div>
      )}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px dashed ${LINE2}`, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>
        Note générée par Terzaghi — formules et coefficients de calage appliqués côté serveur. {pv ? <span style={{ color: '#2e7d4f', fontWeight: 600, fontStyle: 'normal' }}>PV scellé n° {pv.number ?? pv.id} — intégrité + horodatage garantis.</span> : 'Non signée tant que non scellée ; le sceau garantit intégrité + horodatage (ne vaut pas signature électronique qualifiée).'}
      </div>
    </div>
  );
}
