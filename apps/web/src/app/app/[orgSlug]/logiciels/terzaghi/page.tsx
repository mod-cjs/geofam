'use client';

/**
 * Terzaghi — Fondations superficielles (NF P 94-261 / EC7).
 * Saisie + visualisation uniquement ; le calcul est SERVEUR (moteur
 * `terzaghi` → registryId `fondation-superficielle`). Aucune formule ni
 * coefficient de calage côté navigateur (DoD §8) : la sortie affichée est la
 * forme normalisée `{ verdict, rows }` whitelistée par le moteur.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, Fragment } from 'react';

import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type {
  Project,
  EntitlementsResponse,
  CalcResult,
  NormalizedCalcOutput,
  OfficialPv,
} from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

// ---------------------------------------------------------------------------
// Types de saisie (miroir borné de TerzaghiInputSchema)
// ---------------------------------------------------------------------------

type Forme = 'filante' | 'carree' | 'rect' | 'circ';
type SolCat = 'argiles' | 'sables' | 'craies' | 'marnes' | 'roches';
type Essai = 'pressio' | 'penetro' | 'labo';
type Etat = 'ELU_F' | 'ELU_A' | 'ELS_C' | 'ELS_F' | 'ELS_QP';
type CphiMode = 'auto' | 'nd' | 'd';
type ProfilMode = 'essais' | 'couches';
type TalusDir = 'ext' | 'int';

interface SondageRow { z: string; pl: string; em: string; al: string; qc: string }
interface ChargeRow { etat: Etat; fz: string; fx: string; fy: string; mx: string; my: string }

/** État de saisie complet (miroir borné de TerzaghiInputSchema). */
export interface TerzaghiForm {
  projet?: string;
  forme: Forme; B: string; L: string; D: string; beton: 'coule' | 'prefa';
  solCat: SolCat; c: string; phi: string; eYoung: string; nuSol: string; nappe: string;
  gAvant: string; gApres: string; gSous: string;
  cphiOn: boolean; cphiMode: CphiMode; talusOn: boolean; beta: string; dTalus: string; talusDir: TalusDir;
  profilMode: ProfilMode; alphaSang: string; essai: Essai;
  sondage: SondageRow[]; charges: ChargeRow[];
}

/**
 * Construit le payload API — PUR, sans effet de bord.
 * DoD §8 : ne contient QUE les entrées bornées du contrat (aucun coefficient de
 * calcul, aucune formule) ; L est dérivé de B hors cas rectangulaire.
 */
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

const ETATS: { v: Etat; l: string }[] = [
  { v: 'ELU_F', l: 'ELU fondamentale' },
  { v: 'ELU_A', l: 'ELU accidentelle' },
  { v: 'ELS_C', l: 'ELS caractéristique' },
  { v: 'ELS_F', l: 'ELS fréquente' },
  { v: 'ELS_QP', l: 'ELS quasi-permanente' },
];
const FORMES: { v: Forme; l: string }[] = [
  { v: 'filante', l: 'Filante' },
  { v: 'carree', l: 'Carrée' },
  { v: 'rect', l: 'Rectangulaire' },
  { v: 'circ', l: 'Circulaire' },
];
const SOLS: { v: SolCat; l: string }[] = [
  { v: 'argiles', l: 'Argiles & limons' },
  { v: 'sables', l: 'Sables & graves' },
  { v: 'craies', l: 'Craies' },
  { v: 'marnes', l: 'Marnes & marno-calcaires' },
  { v: 'roches', l: 'Roches altérées' },
];
const ESSAIS: { v: Essai; l: string }[] = [
  { v: 'pressio', l: 'Pressiomètre Ménard' },
  { v: 'penetro', l: 'Pénétromètre (qc)' },
  { v: 'labo', l: 'Laboratoire (c, φ)' },
];

// Tables normatives des guides (valeurs verbatim de l'outil client — NF P 94-261).
const FRAC: Record<string, string> = { '1': '1', '2/3': '0.67', '1/2': '0.5', '1/3': '0.33', '1/4': '0.25' };
// α rhéologique de Ménard — tableaux H.2.1.1.1 / H.2.1.1.2 (colonnes Argile / Limon / Sable / Grave).
const ALPHA_SOL: { etat: string; tourbe: string; cols: [string, string][] }[] = [
  { etat: 'Surconsolidé ou très serré', tourbe: '—', cols: [['> 16', '1'], ['> 14', '2/3'], ['> 12', '1/2'], ['> 10', '1/3']] },
  { etat: 'Normalement consolidé ou serré', tourbe: '1', cols: [['9 – 16', '2/3'], ['8 – 14', '1/2'], ['7 – 12', '1/3'], ['6 – 10', '1/4']] },
  { etat: 'Surconsolidé altéré, remanié ou lâche', tourbe: '1', cols: [['9 – 16', '2/3'], ['8 – 14', '1/2'], ['5 – 7', '1/3'], ['—', '—']] },
];
const ALPHA_ROCHER: [string, string][] = [['Très peu fracturé', '2/3'], ['Normalement fracturé', '1/2'], ['Très fracturé', '1/3'], ['Très altéré', '2/3']];
// α de Sanglerat — tableau J.2.3 (M = α·qc) : [type, qc, plage, valeur].
const SANG_ROWS: [string, string, string, string][] = [
  ['Argile peu plastique', '< 0,7', '3 à 8', '5'],
  ['Argile peu plastique', '0,7 à 2', '2 à 5', '3'],
  ['Argile peu plastique', '> 2', '1 à 2,5', '1,5'],
  ['Limon peu plastique', '< 2', '3 à 6', '4'],
  ['Limon peu plastique', '> 2', '1 à 2', '1,5'],
  ['Argile / limon très plastique', '< 2', '2 à 6', '3'],
  ['Argile / limon très plastique', '> 2', '1 à 2', '1,5'],
  ['Limon très organique', '< 1,2', '2 à 8', '4'],
  ['Tourbe / argile très org. (w 50–100 %)', '< 0,7', '1,5 à 4', '2'],
  ['Tourbe / argile très org. (w 100–200 %)', '< 0,7', '1 à 1,5', '1,2'],
  ['Tourbe / argile très org. (w > 200 %)', '< 0,7', '0,4 à 1,0', '0,7'],
  ['Craie', '2 à 3', '2 à 4', '3'],
  ['Craie', '> 3', '1,5 à 3', '2'],
  ['Sable', '< 5', '2', '2'],
  ['Sable', '> 10', '1,5', '1,5'],
];

// ---------------------------------------------------------------------------
// Styles (accent terre Terzaghi)
// ---------------------------------------------------------------------------

const ACCENT = '#a65a1e';
const INK = '#232e33';
const MUTED = '#6b7178';
const LINE = '#d9d3c2';
const PANEL = '#fcfbf6';

const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: '1px solid #c9c2ad', borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff' };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: MUTED, padding: '0 5px 6px', fontWeight: 700 };
const delBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#963b28', fontSize: 12 };
const addBtn: React.CSSProperties = { marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#f4edd8', color: ACCENT, borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 };
const gtable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const gth: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#f3f1e8', padding: '5px 7px', fontSize: 10.5, color: MUTED, fontWeight: 700, textAlign: 'center' };
const gtd: React.CSSProperties = { border: `1px solid ${LINE}`, padding: '4px 7px', textAlign: 'center' };
const gtdL: React.CSSProperties = { border: `1px solid ${LINE}`, padding: '4px 7px', textAlign: 'left' };
const aval: React.CSSProperties = { border: `1px solid ${ACCENT}`, background: '#f4edd8', color: ACCENT, borderRadius: 5, padding: '3px 9px', cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: 'inherit' };

// ---------------------------------------------------------------------------
// Coupe transversale (schématique, DISPLAY ONLY)
// ---------------------------------------------------------------------------

function Coupe({ B, D, nappe, solCat }: { B: string; D: string; nappe: string; solCat: SolCat }) {
  const b = Math.max(0.2, Number(B) || 2);
  const d = Math.max(0, Number(D) || 1);
  const nap = nappe === '' ? null : Number(nappe);
  const W = 460, H = 240;
  const scale = 26; // px/m
  const cx = W / 2;
  const tn = 60; // y du terrain naturel
  const baseY = tn + d * scale;
  const halfB = (b * scale) / 2;
  const napY = nap != null && !isNaN(nap) ? tn + nap * scale : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Coupe : semelle largeur ${b} m, encastrement ${d} m, sol ${solCat}`}>
      <rect x="0" y={tn} width={W} height={H - tn} fill="#e8e0cd" />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <line key={k} x1="0" y1={tn + 18 + k * 30} x2={W} y2={tn + 6 + k * 30} stroke="#cbbf9e" strokeWidth="0.6" />
      ))}
      <line x1="0" y1={tn} x2={W} y2={tn} stroke="#8a8474" strokeWidth="1.4" />
      <text x="8" y={tn - 5} fontSize="10" fill={MUTED}>Terrain naturel</text>
      {napY != null && (
        <>
          <line x1="0" y1={napY} x2={W} y2={napY} stroke="#3d7ea6" strokeWidth="1.2" strokeDasharray="5 3" />
          <text x={W - 8} y={napY - 4} fontSize="10" fill="#3d7ea6" textAnchor="end">Nappe</text>
        </>
      )}
      {/* semelle */}
      <rect x={cx - halfB} y={baseY} width={halfB * 2} height="16" fill="#7c7d80" stroke="#3a3b3d" />
      <rect x={cx - 9} y={tn - 26} width="18" height={baseY - tn + 26} fill="#9a9ba0" stroke="#3a3b3d" />
      {/* charge */}
      <line x1={cx} y1={tn - 40} x2={cx} y2={tn - 26} stroke={ACCENT} strokeWidth="2.4" markerEnd="url(#tzar)" />
      <defs><marker id="tzar" markerWidth="8" markerHeight="8" refX="4" refY="7" orient="auto"><path d="M1 1 L4 7 L7 1" fill="none" stroke={ACCENT} strokeWidth="1.5" /></marker></defs>
      {/* cotes */}
      <line x1={cx - halfB} y1={baseY + 26} x2={cx + halfB} y2={baseY + 26} stroke={INK} strokeWidth="0.9" />
      <text x={cx} y={baseY + 39} fontSize="11" fill={INK} textAnchor="middle" fontWeight="600">B = {b} m</text>
      <line x1={cx + halfB + 22} y1={tn} x2={cx + halfB + 22} y2={baseY} stroke={INK} strokeWidth="0.9" />
      <text x={cx + halfB + 28} y={(tn + baseY) / 2} fontSize="11" fill={INK}>D = {d} m</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export default function TerzaghiPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [, setEntitlements] = useState<EntitlementsResponse | null>(null);

  // ── Fondation ──
  const [forme, setForme] = useState<Forme>('carree');
  const [B, setB] = useState('2');
  const [L, setL] = useState('2');
  const [D, setD] = useState('1');
  const [beton, setBeton] = useState<'coule' | 'prefa'>('coule');
  // ── Sol ──
  const [solCat, setSolCat] = useState<SolCat>('argiles');
  const [c, setC] = useState('');
  const [phi, setPhi] = useState('');
  const [eYoung, setEYoung] = useState('');
  const [nuSol, setNuSol] = useState('0.33');
  const [nappe, setNappe] = useState('');
  const [gAvant, setGAvant] = useState('20');
  const [gApres, setGApres] = useState('20');
  const [gSous, setGSous] = useState('');
  // ── Options ──
  const [cphiOn, setCphiOn] = useState(false);
  const [cphiMode, setCphiMode] = useState<CphiMode>('auto');
  const [talusOn, setTalusOn] = useState(false);
  const [beta, setBeta] = useState('');
  const [dTalus, setDTalus] = useState('');
  const [talusDir, setTalusDir] = useState<TalusDir>('ext');
  const [profilMode, setProfilMode] = useState<ProfilMode>('essais');
  const [alphaSang, setAlphaSang] = useState('');
  // ── Essai / sondage / charges ──
  const [essai, setEssai] = useState<Essai>('pressio');
  const [sondage, setSondage] = useState<SondageRow[]>([
    { z: '1', pl: '0.8', em: '8', al: '', qc: '' },
    { z: '3', pl: '1.2', em: '12', al: '', qc: '' },
    { z: '5', pl: '1.6', em: '16', al: '', qc: '' },
  ]);
  const [charges, setCharges] = useState<ChargeRow[]>([
    { etat: 'ELU_F', fz: '900', fx: '', fy: '', mx: '', my: '' },
    { etat: 'ELS_C', fz: '650', fx: '', fy: '', mx: '', my: '' },
  ]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'fond' | 'sondage' | 'charges' | 'resultats'>('fond');
  const [guide, setGuide] = useState<'alpha' | 'sang' | null>(null);
  const applyAlpha = (frac: string) => { const v = FRAC[frac] ?? frac; setSondage((p) => p.map((r) => ({ ...r, al: v }))); setGuide(null); };
  const applySang = (v: string) => { setAlphaSang(v.replace(',', '.')); setGuide(null); };

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => {
        const fd = projs.filter((p) => p.domain === 'FD');
        setProjects(fd);
        setEntitlements(ent);
        if (fd.length === 1) setProjectId(fd[0].id);
      })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildTerzaghiPayload({
    projet: projects.find((p) => p.id === projectId)?.name,
    forme, B, L, D, beton, solCat, c, phi, eYoung, nuSol, nappe, gAvant, gApres, gSous,
    cphiOn, cphiMode, talusOn, beta, dTalus, talusDir, profilMode, alphaSang, essai, sondage, charges,
  }), [projects, projectId, forme, B, L, D, beton, solCat, c, phi, eYoung, nuSol, nappe, gAvant, gApres, gSous, cphiOn, cphiMode, talusOn, beta, dTalus, talusDir, profilMode, alphaSang, essai, sondage, charges]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true);
    setCalcError(null);
    setPvResult(null);
    const label = `Terzaghi — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'terzaghi', label, params: buildPayload() as Record<string, unknown> });
      setCalcResult(result);
      setTab('resultats');
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setCalcError(
        e?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.'
          : e?.reason === 'QUOTA' ? 'Quota de calculs épuisé.'
            : e?.reason === 'MODULE_NOT_IN_PACK' ? "Le module Terzaghi n'est pas inclus dans votre abonnement."
              : (e?.message ?? 'Erreur lors du calcul. Réessayez.'),
      );
    } finally {
      setCalculating(false);
    }
  }, [orgId, projectId, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true);
    setCalcError(null);
    try {
      const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id });
      setPvResult(pv);
    } catch (err: unknown) {
      setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV.");
    } finally {
      setEmittingPv(false);
    }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de Terzaghi" />;

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const calcDisabled = calculating || !projectId || !orgId;
  const upSondage = (i: number, k: keyof SondageRow, v: string) => setSondage((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const upCharge = (i: number, k: keyof ChargeRow, v: string) => setCharges((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      {/* En-tête */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Terzaghi</div>
          <div style={{ fontSize: 12, color: MUTED }}>Fondations superficielles · NF P 94-261 / Eurocode 7 · capacité portante &amp; tassements</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div>
            <label style={lbl} htmlFor="tz-projet">Projet</label>
            <select id="tz-projet" style={{ ...inp, width: 240 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Sélectionner…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating}
            title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#c9beb0' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Calculer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f6e5e1', borderColor: '#e0b3aa', color: '#8f2a1f' }} role="alert">{calcError}</div>}

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['fond', 'Fondation & sol'], ['sondage', 'Sondage in situ'], ['charges', 'Cas de charge'], ['resultats', 'Résultats']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Fondation & sol */}
      {tab === 'fond' && (
        <>
          <div style={card}>
            <div style={secH}>Fondation</div>
            <div style={grid2}>
              <div><label style={lbl}>Forme</label>
                <select style={inp} value={forme} onChange={(e) => setForme(e.target.value as Forme)}>{FORMES.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</select>
              </div>
              <div><label style={lbl}>Encastrement D (m)</label><input style={inp} value={D} onChange={(e) => setD(e.target.value)} /></div>
              <div><label style={lbl}>Largeur B (m)</label><input style={inp} value={B} onChange={(e) => setB(e.target.value)} /></div>
              {forme === 'rect' && <div><label style={lbl}>Longueur L (m)</label><input style={inp} value={L} onChange={(e) => setL(e.target.value)} /></div>}
              <div><label style={lbl}>Béton</label>
                <select style={inp} value={beton} onChange={(e) => setBeton(e.target.value as 'coule' | 'prefa')}><option value="coule">Coulé en place</option><option value="prefa">Préfabriqué</option></select>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={secH}>Coupe transversale</div>
            <div style={{ background: 'radial-gradient(120% 100% at 50% 0,#fdfdfb,#efece3)', border: `1px solid ${LINE}`, borderRadius: 10 }}>
              <Coupe B={B} D={D} nappe={nappe} solCat={solCat} />
            </div>
          </div>

          <div style={card}>
            <div style={secH}>Sol support</div>
            <div style={grid3}>
              <div><label style={lbl}>Catégorie</label>
                <select style={inp} value={solCat} onChange={(e) => setSolCat(e.target.value as SolCat)}>{SOLS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
              </div>
              <div><label style={lbl}>Cohésion c (kPa)</label><input style={inp} value={c} onChange={(e) => setC(e.target.value)} placeholder="—" /></div>
              <div><label style={lbl}>Angle φ (°)</label><input style={inp} value={phi} onChange={(e) => setPhi(e.target.value)} placeholder="—" /></div>
              <div><label style={lbl}>Module E (MPa)</label><input style={inp} value={eYoung} onChange={(e) => setEYoung(e.target.value)} placeholder="—" /></div>
              <div><label style={lbl}>ν sol</label><input style={inp} value={nuSol} onChange={(e) => setNuSol(e.target.value)} /></div>
              <div><label style={lbl}>Nappe (m/TN)</label><input style={inp} value={nappe} onChange={(e) => setNappe(e.target.value)} placeholder="—" /></div>
              <div><label style={lbl}>γ avant (kN/m³)</label><input style={inp} value={gAvant} onChange={(e) => setGAvant(e.target.value)} /></div>
              <div><label style={lbl}>γ après (kN/m³)</label><input style={inp} value={gApres} onChange={(e) => setGApres(e.target.value)} /></div>
              <div><label style={lbl}>γ sous nappe (kN/m³)</label><input style={inp} value={gSous} onChange={(e) => setGSous(e.target.value)} placeholder="—" /></div>
            </div>
          </div>

          <div style={card}>
            <div style={secH}>Options avancées</div>
            <div style={grid2}>
              <div>
                <label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center' }}>
                  <input type="checkbox" checked={cphiOn} onChange={(e) => setCphiOn(e.target.checked)} /> Vérification c-φ (drainé / non drainé)
                </label>
                {cphiOn && (
                  <select style={{ ...inp, marginTop: 6 }} value={cphiMode} onChange={(e) => setCphiMode(e.target.value as CphiMode)}>
                    <option value="auto">Auto (selon sol)</option>
                    <option value="nd">Court terme — non drainé (cu)</option>
                    <option value="d">Long terme — drainé (c′, φ′)</option>
                  </select>
                )}
              </div>
              <div>
                <label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center' }}>
                  <input type="checkbox" checked={talusOn} onChange={(e) => setTalusOn(e.target.checked)} /> Fondation près d&apos;un talus
                </label>
                {talusOn && (
                  <div style={{ ...grid3, marginTop: 6 }}>
                    <input style={inp} value={beta} onChange={(e) => setBeta(e.target.value)} placeholder="β (°)" />
                    <input style={inp} value={dTalus} onChange={(e) => setDTalus(e.target.value)} placeholder="d (m)" />
                    <select style={inp} value={talusDir} onChange={(e) => setTalusDir(e.target.value as TalusDir)}><option value="ext">Vers l&apos;extérieur</option><option value="int">Vers l&apos;intérieur</option></select>
                  </div>
                )}
              </div>
              <div><label style={lbl}>Profil de sol</label>
                <select style={inp} value={profilMode} onChange={(e) => setProfilMode(e.target.value as ProfilMode)}><option value="essais">Par essais in situ</option><option value="couches">Par couches</option></select>
              </div>
              {essai === 'penetro' && (
                <div>
                  <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>α Sanglerat (M = α·qc)
                    <button type="button" onClick={() => setGuide('sang')} title="Guide du coefficient de Sanglerat" style={{ border: `1px solid ${LINE}`, background: '#fff', color: ACCENT, borderRadius: 5, width: 18, height: 18, lineHeight: '1', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>?</button>
                  </label>
                  <input style={inp} value={alphaSang} onChange={(e) => setAlphaSang(e.target.value)} placeholder="auto" />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Sondage */}
      {tab === 'sondage' && (
        <div style={card}>
          <div style={secH}>Sondage in situ</div>
          <div style={{ ...grid2, marginBottom: 12, alignItems: 'flex-end' }}>
            <div><label style={lbl}>Méthode d&apos;essai</label>
              <select style={inp} value={essai} onChange={(e) => setEssai(e.target.value as Essai)}>{ESSAIS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
            </div>
            <div>
              <button type="button" onClick={() => setGuide('alpha')} style={{ border: `1px solid ${LINE}`, background: '#fff', color: ACCENT, borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, fontFamily: 'inherit' }}>
                ? Guide de choix de α (Ménard)
              </button>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['z (m)', 'pl* (MPa)', 'EM (MPa)', 'α (rhéo.)', 'qc (MPa)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {sondage.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 3 }}><input style={inp} value={r.z} onChange={(e) => upSondage(i, 'z', e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.pl} onChange={(e) => upSondage(i, 'pl', e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.em} onChange={(e) => upSondage(i, 'em', e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.al} onChange={(e) => upSondage(i, 'al', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.qc} onChange={(e) => upSondage(i, 'qc', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><button onClick={() => setSondage((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)))} style={delBtn}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setSondage((p) => [...p, { z: '', pl: '', em: '', al: '', qc: '' }])} style={addBtn}>+ Ajouter une profondeur</button>
        </div>
      )}

      {/* Charges */}
      {tab === 'charges' && (
        <div style={card}>
          <div style={secH}>Cas de charge (ELU / ELS)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['État-limite', 'Fz (kN)', 'Fx (kN)', 'Fy (kN)', 'Mx (kN·m)', 'My (kN·m)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {charges.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 3, minWidth: 150 }}>
                    <select style={inp} value={r.etat} onChange={(e) => upCharge(i, 'etat', e.target.value)}>{ETATS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
                  </td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.fz} onChange={(e) => upCharge(i, 'fz', e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.fx} onChange={(e) => upCharge(i, 'fx', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.fy} onChange={(e) => upCharge(i, 'fy', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.mx} onChange={(e) => upCharge(i, 'mx', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><input style={inp} value={r.my} onChange={(e) => upCharge(i, 'my', e.target.value)} placeholder="—" /></td>
                  <td style={{ padding: 3 }}><button onClick={() => setCharges((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)))} style={delBtn}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setCharges((p) => [...p, { etat: 'ELU_F', fz: '', fx: '', fy: '', mx: '', my: '' }])} style={addBtn}>+ Ajouter un cas</button>
        </div>
      )}

      {/* Résultats */}
      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Calculer</strong> pour lancer la vérification EC7.</div>
          ) : (
            <>
              <div data-testid="verdict-banner" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderRadius: 11, marginBottom: 14, background: output.verdict === 'PASS' ? '#e4efe6' : output.verdict === 'FAIL' ? '#f6e5e1' : '#f4edd8', border: `1px solid ${output.verdict === 'PASS' ? '#a9d0b3' : output.verdict === 'FAIL' ? '#e0b3aa' : '#e6cf9c'}` }}>
                <b style={{ fontSize: 15, color: output.verdict === 'PASS' ? '#2e7d4f' : output.verdict === 'FAIL' ? '#b23a2e' : '#96701a' }}>
                  {output.verdict === 'PASS' ? 'Fondation vérifiée — critères EC7 satisfaits' : output.verdict === 'FAIL' ? 'Fondation non vérifiée — reprise nécessaire' : 'Résultats de vérification'}
                </b>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité', 'Statut'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {output.rows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : row.value}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>
                        {row.status && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: row.status === 'ok' ? '#e4efe6' : '#f6e5e1', color: row.status === 'ok' ? '#2e7d4f' : '#b23a2e' }}>{row.status === 'ok' ? 'OK' : 'NON'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Formules et coefficients de calcul appliqués côté serveur ; seuls les résultats de vérification (sollicitantes / admissibles) sont affichés.</div>
              <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button data-testid="btn-imprimer" onClick={handleEmitPv} disabled={emittingPv} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontWeight: 600, cursor: emittingPv ? 'wait' : 'pointer', fontSize: 13 }}>
                  {emittingPv ? 'Émission…' : 'Émettre le PV scellé'}
                </button>
                {pvResult && <span data-testid="pv-success" style={{ fontSize: 12.5, color: '#2e7d4f', fontWeight: 600 }}>PV scellé émis (n° {pvResult.number ?? pvResult.id}).</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals d'aide (guides normatifs NF P 94-261) */}
      {guide && (
        <div role="dialog" aria-modal="true" aria-label={guide === 'alpha' ? 'Guide du coefficient rhéologique' : 'Guide du coefficient de Sanglerat'} onClick={() => setGuide(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(25,22,15,.45)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL, borderRadius: 12, maxWidth: 740, width: '100%', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: PANEL }}>
              <h3 style={{ margin: 0, fontSize: 15, color: INK }}>{guide === 'alpha' ? 'Choisir le coefficient rhéologique α (Ménard)' : 'Coefficient α de Sanglerat — M = α·qc'}</h3>
              <button onClick={() => setGuide(null)} aria-label="Fermer" style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: MUTED, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '16px 18px' }}>
              {guide === 'alpha' ? (
                <>
                  <p style={{ fontSize: 12, color: MUTED, marginTop: 0 }}>α dépend de la nature du terrain et de son état de consolidation/serrage, estimé via E<sub>M</sub>/p<sub>l</sub> (NF P 94-261, tab. H.2.1.1). <strong>Cliquez une valeur</strong> pour l&apos;appliquer à toute la colonne α du sondage.</p>
                  <table style={gtable}>
                    <thead>
                      <tr><th style={gth} rowSpan={2}>État du terrain</th><th style={gth}>Tourbe</th><th style={gth} colSpan={2}>Argile</th><th style={gth} colSpan={2}>Limon</th><th style={gth} colSpan={2}>Sable</th><th style={gth} colSpan={2}>Grave</th></tr>
                      <tr><th style={gth}>α</th>{[0, 1, 2, 3].map((k) => <Fragment key={k}><th style={gth}>E/p</th><th style={gth}>α</th></Fragment>)}</tr>
                    </thead>
                    <tbody>
                      {ALPHA_SOL.map((r, i) => (
                        <tr key={i}>
                          <td style={gtdL}>{r.etat}</td>
                          <td style={gtd}>{r.tourbe === '—' ? '—' : <button style={aval} onClick={() => applyAlpha(r.tourbe)}>{r.tourbe}</button>}</td>
                          {r.cols.map(([rg, al], j) => <Fragment key={j}><td style={gtd}>{rg}</td><td style={gtd}>{al === '—' ? '—' : <button style={aval} onClick={() => applyAlpha(al)}>{al}</button>}</td></Fragment>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table style={{ ...gtable, maxWidth: 340, marginTop: 12 }}>
                    <thead><tr><th style={gth}>Rocher</th><th style={gth}>α</th></tr></thead>
                    <tbody>{ALPHA_ROCHER.map(([n, al], i) => <tr key={i}><td style={gtdL}>{n}</td><td style={gtd}><button style={aval} onClick={() => applyAlpha(al)}>{al}</button></td></tr>)}</tbody>
                  </table>
                  <p style={{ fontSize: 11, color: MUTED }}>Décimales appliquées : 1 · 2/3→0,67 · 1/2→0,5 · 1/3→0,33 · 1/4→0,25.</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: MUTED, marginTop: 0 }}>Pour le tassement œdométrique (annexe J.4.1), M = α·q<sub>c</sub> (NF P 94-261, tab. J.2.3). <strong>Cliquez une valeur</strong> pour l&apos;appliquer. Un choix prudent (valeur basse) majore le tassement.</p>
                  <table style={gtable}>
                    <thead><tr><th style={gth}>Type de sol</th><th style={gth}>q<sub>c</sub> (MPa)</th><th style={gth}>α (plage)</th><th style={gth}>Valeur</th></tr></thead>
                    <tbody>{SANG_ROWS.map((r, i) => <tr key={i}><td style={gtdL}>{r[0]}</td><td style={gtd}>{r[1]}</td><td style={gtd}>{r[2]}</td><td style={gtd}><button style={aval} onClick={() => applySang(r[3])}>{r[3]}</button></td></tr>)}</tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
