'use client';

/**
 * GEOPLAQUE — Radier & plaque sur sol multicouche (modèle éléments finis).
 * Saisie du modèle + visualisation ; le CALCUL est SERVEUR (moteur `radier` →
 * registryId `radier-plaque`). §8 : aucune valeur nodale / topologie de maillage
 * côté navigateur ; la cartographie est une grille d'AFFICHAGE ré-échantillonnée
 * (découplée du maillage) — le motif de déflexion, pas la méthode EF.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, useRef } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv, HeatmapData } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Pt { x: string; y: string }
interface PLoad { x: string; y: string; Fz: string; Mx: string; My: string }
interface LLoad { x1: string; y1: string; x2: string; y2: string; q: string }
interface ALoad { x1: string; y1: string; x2: string; y2: string; q: string; on: 'raft' | 'soil' }
interface PSpring { x: string; y: string; k: string }
interface Layer { zBase: string; E: string; nu: string }

const num = (s: string, d = 0): number => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d; };
const numU = (s: string): number | undefined => { const t = String(s).trim(); if (t === '') return undefined; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : undefined; };

export interface GeoplaqueForm {
  projet?: string;
  pts: Pt[]; E: string; nu: string; e: string;
  layers: Layer[];
  mesh: string; decol: boolean; qLim: string;
  pointLoads: PLoad[]; lineLoads: LLoad[]; areaLoads: ALoad[]; pointSprings: PSpring[];
}

/** Payload API PUR (DoD §8 : géométrie du modèle bornée, nombres). */
export function buildGeoplaquePayload(f: GeoplaqueForm): Record<string, unknown> {
  return {
    projet: f.projet,
    rafts: [{ pts: f.pts.map((p) => ({ x: num(p.x), y: num(p.y) })), E: num(f.E, 30000), nu: num(f.nu, 0.2), e: num(f.e, 0.4) }],
    pointLoads: f.pointLoads.map((l) => { const r: Record<string, unknown> = { x: num(l.x), y: num(l.y), Fz: num(l.Fz) }; const mx = numU(l.Mx); const my = numU(l.My); if (mx !== undefined) r.Mx = mx; if (my !== undefined) r.My = my; return r; }),
    lineLoads: f.lineLoads.map((l) => ({ x1: num(l.x1), y1: num(l.y1), x2: num(l.x2), y2: num(l.y2), q: num(l.q) })),
    areaLoads: f.areaLoads.map((l) => ({ x1: num(l.x1), y1: num(l.y1), x2: num(l.x2), y2: num(l.y2), q: num(l.q), on: l.on })),
    pointSprings: f.pointSprings.map((s) => ({ x: num(s.x), y: num(s.y), k: num(s.k) })),
    layers: f.layers.map((l) => ({ zBase: num(l.zBase), E: num(l.E), nu: num(l.nu) })),
    opts: { mesh: num(f.mesh, 0.5), decol: f.decol, ...(numU(f.qLim) !== undefined ? { qLim: num(f.qLim) } : {}) },
  };
}

// Couleur d'un stop de la carto (bleu = peu de tassement → rouge = fort).
const HEAT_STOPS = [[44, 111, 191], [40, 160, 170], [120, 175, 70], [230, 180, 40], [192, 57, 43]];
function heatRGB(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  const seg = c * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
  const m = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return [m(0), m(1), m(2)];
}
function heatColor(t: number): string {
  const [r, g, b] = heatRGB(t);
  return `rgb(${r},${g},${b})`;
}

/**
 * Cartographie LISSÉE — rendu 100 % front par interpolation bilinéaire de la grille
 * d'affichage 48×48 (déjà ré-échantillonnée côté serveur, découplée du maillage EF).
 * Le lissage est COSMÉTIQUE : il n'ajoute aucune information et ne révèle rien du
 * maillage (§8) — il améliore seulement la qualité visuelle. On dessine la grille sur
 * un canvas offscreen puis on l'étire avec le lissage bilinéaire natif du navigateur.
 */
function HeatmapCanvas({ heatmap, raftPts }: { heatmap: HeatmapData; raftPts: { x: number; y: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cols, rows, vals, vMin, vMax, x0, y0, x1, y1 } = heatmap;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || cols < 2 || rows < 2) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    // Grille source (cols×rows) → ImageData ; cellules null = transparentes.
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const octx = off.getContext('2d');
    if (!octx) return;
    const img = octx.createImageData(cols, rows);
    const span = vMax > vMin ? vMax - vMin : 1;
    for (let i = 0; i < cols * rows; i++) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v)) { img.data[i * 4 + 3] = 0; continue; }
      const [r, g, b] = heatRGB((v - vMin) / span);
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Étirement lissé + retournement vertical (y vers le haut, convention ingénieur).
    ctx.save();
    ctx.translate(0, H); ctx.scale(1, -1);
    ctx.drawImage(off, 0, 0, cols, rows, 0, 0, W, H);
    ctx.restore();
    // Contour du radier (coords modèle → canvas, y vers le haut).
    if (raftPts.length >= 3 && x1 > x0 && y1 > y0) {
      ctx.save();
      ctx.beginPath();
      raftPts.forEach((p, k) => {
        const cx = ((p.x - x0) / (x1 - x0)) * W;
        const cy = H - ((p.y - y0) / (y1 - y0)) * H;
        if (k === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(42,35,51,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }, [cols, rows, vals, vMin, vMax, x0, y0, x1, y1, raftPts]);
  const aspect = x1 > x0 ? (y1 - y0) / (x1 - x0) : 1;
  const W = 460, H = Math.max(180, Math.min(520, Math.round(W * (aspect || 1))));
  return <canvas ref={ref} width={W} height={H} style={{ width: '100%', maxWidth: W, height: 'auto', border: `1px solid ${LINE}`, borderRadius: 8, background: '#faf8fc' }} role="img" aria-label="Cartographie lissée de déflexion du radier (grille d'affichage ré-échantillonnée, découplée du maillage)" />;
}

const ACCENT = '#5a3e7c', INK = '#241f2e', MUTED = '#6e6779', LINE = '#ddd6e4', PANEL = '#fdfcff';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: `1px solid #c8c0d2`, borderRadius: 7, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', color: MUTED, padding: '0 4px 5px', fontWeight: 700 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const addBtn: React.CSSProperties = { marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#efe9f5', color: ACCENT, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12 };
const delBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: '#8a2d55', fontSize: 11 };

export default function GeoplaquePage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [pts, setPts] = useState<Pt[]>([{ x: '0', y: '0' }, { x: '6', y: '0' }, { x: '6', y: '6' }, { x: '0', y: '6' }]);
  const [E, setE] = useState('30000'); const [nu, setNu] = useState('0.2'); const [e, setEp] = useState('0.4');
  const [layers, setLayers] = useState<Layer[]>([{ zBase: '10', E: '8', nu: '0.33' }]);
  const [mesh, setMesh] = useState('0.5'); const [decol, setDecol] = useState(false); const [qLim, setQLim] = useState('');
  const [pointLoads, setPointLoads] = useState<PLoad[]>([]);
  const [lineLoads] = useState<LLoad[]>([]);
  const [areaLoads, setAreaLoads] = useState<ALoad[]>([{ x1: '0', y1: '0', x2: '6', y2: '6', q: '50', on: 'raft' }]);
  const [pointSprings, setPointSprings] = useState<PSpring[]>([]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'modele' | 'charges' | 'resultats'>('modele');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const fd = projs.filter((p) => p.domain === 'FD'); setProjects(fd); setEnt(ent); if (fd.length === 1) setProjectId(fd[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildGeoplaquePayload({
    projet: projects.find((p) => p.id === projectId)?.name, pts, E, nu, e, layers, mesh, decol, qLim, pointLoads, lineLoads, areaLoads, pointSprings,
  }), [projects, projectId, pts, E, nu, e, layers, mesh, decol, qLim, pointLoads, lineLoads, areaLoads, pointSprings]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    const label = `GEOPLAQUE — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'radier', label, params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setTab('resultats');
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : x?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : x?.reason === 'MODULE_NOT_IN_PACK' ? "Le module GEOPLAQUE n'est pas inclus dans votre abonnement." : (x?.message ?? 'Erreur lors du calcul. Réessayez.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de GEOPLAQUE" />;

  const output = calcResult?.output as (NormalizedCalcOutput & { heatmap?: HeatmapData }) | null;
  const heatmap = output?.heatmap;
  const calcDisabled = calculating || !projectId || !orgId;

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>GEOPLAQUE</div>
          <div style={{ fontSize: 12, color: MUTED }}>Radier &amp; plaque sur sol multicouche · éléments finis · Eurocode 7 annexe H</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="gp-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="FD" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={230} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#c3bacf' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Calculer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#f8e6ee', borderColor: '#e0b3c8', color: '#8a2d55' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['modele', 'Modèle & sol'], ['charges', 'Charges & ressorts'], ['resultats', 'Résultats & cartographie']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'modele' && (
        <>
          <div style={card}>
            <div style={secH}>Plaque (radier)</div>
            <div style={grid3}>
              <div><label style={lbl}>Module béton E (MPa)</label><input style={inp} value={E} onChange={(ev) => setE(ev.target.value)} /></div>
              <div><label style={lbl}>ν béton</label><input style={inp} value={nu} onChange={(ev) => setNu(ev.target.value)} /></div>
              <div><label style={lbl}>Épaisseur e (m)</label><input style={inp} value={e} onChange={(ev) => setEp(ev.target.value)} /></div>
            </div>
            <div style={{ ...secH, marginTop: 14, marginBottom: 8 }}>Sommets du radier (contour)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['#', 'x (m)', 'y (m)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pts.map((p, i) => (
                <tr key={i}>
                  <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                  <td style={{ padding: 2 }}><input style={inp} value={p.x} onChange={(ev) => setPts((a) => a.map((q, j) => j === i ? { ...q, x: ev.target.value } : q))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={p.y} onChange={(ev) => setPts((a) => a.map((q, j) => j === i ? { ...q, y: ev.target.value } : q))} /></td>
                  <td style={{ padding: 2 }}><button onClick={() => setPts((a) => a.length <= 3 ? a : a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setPts((a) => [...a, { x: '0', y: '0' }])} style={addBtn}>+ Ajouter un sommet</button>
          </div>

          <div style={card}>
            <div style={secH}>Profil de sol (couches)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Base z (m)', 'E (MPa)', 'ν', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{layers.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}><input style={inp} value={l.zBase} onChange={(ev) => setLayers((a) => a.map((q, j) => j === i ? { ...q, zBase: ev.target.value } : q))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={l.E} onChange={(ev) => setLayers((a) => a.map((q, j) => j === i ? { ...q, E: ev.target.value } : q))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={l.nu} onChange={(ev) => setLayers((a) => a.map((q, j) => j === i ? { ...q, nu: ev.target.value } : q))} /></td>
                  <td style={{ padding: 2 }}><button onClick={() => setLayers((a) => a.length <= 1 ? a : a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setLayers((a) => [...a, { zBase: '', E: '', nu: '0.33' }])} style={addBtn}>+ Ajouter une couche</button>
          </div>

          <div style={card}>
            <div style={secH}>Paramètres de calcul</div>
            <div style={grid3}>
              <div><label style={lbl}>Maillage — pas (m)</label><input style={inp} value={mesh} onChange={(ev) => setMesh(ev.target.value)} /></div>
              <div><label style={lbl}>Contrainte limite q_lim (kPa)</label><input style={inp} value={qLim} onChange={(ev) => setQLim(ev.target.value)} placeholder="—" /></div>
              <div><label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center', marginTop: 20 }}><input type="checkbox" checked={decol} onChange={(ev) => setDecol(ev.target.checked)} /> Décollement autorisé</label></div>
            </div>
          </div>
        </>
      )}

      {tab === 'charges' && (
        <>
          <div style={card}>
            <div style={secH}>Charges réparties</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x1', 'y1', 'x2', 'y2', 'q (kPa)', 'sur', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{areaLoads.map((l, i) => (
                <tr key={i}>
                  {(['x1', 'y1', 'x2', 'y2', 'q'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={l[k]} onChange={(ev) => setAreaLoads((a) => a.map((q, j) => j === i ? { ...q, [k]: ev.target.value } : q))} /></td>)}
                  <td style={{ padding: 2 }}><select style={inp} value={l.on} onChange={(ev) => setAreaLoads((a) => a.map((q, j) => j === i ? { ...q, on: ev.target.value as 'raft' | 'soil' } : q))}><option value="raft">Radier</option><option value="soil">Sol</option></select></td>
                  <td style={{ padding: 2 }}><button onClick={() => setAreaLoads((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setAreaLoads((a) => [...a, { x1: '', y1: '', x2: '', y2: '', q: '', on: 'raft' }])} style={addBtn}>+ Charge répartie</button>
          </div>
          <div style={card}>
            <div style={secH}>Charges ponctuelles</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x', 'y', 'Fz (kN)', 'Mx', 'My', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pointLoads.map((l, i) => (
                <tr key={i}>
                  {(['x', 'y', 'Fz', 'Mx', 'My'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={l[k]} onChange={(ev) => setPointLoads((a) => a.map((q, j) => j === i ? { ...q, [k]: ev.target.value } : q))} placeholder={k === 'Mx' || k === 'My' ? '—' : ''} /></td>)}
                  <td style={{ padding: 2 }}><button onClick={() => setPointLoads((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setPointLoads((a) => [...a, { x: '', y: '', Fz: '', Mx: '', My: '' }])} style={addBtn}>+ Charge ponctuelle</button>
          </div>
          <div style={card}>
            <div style={secH}>Ressorts ponctuels (§2.2.7)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x', 'y', 'k (kN/m)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pointSprings.map((s, i) => (
                <tr key={i}>
                  {(['x', 'y', 'k'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={s[k]} onChange={(ev) => setPointSprings((a) => a.map((q, j) => j === i ? { ...q, [k]: ev.target.value } : q))} /></td>)}
                  <td style={{ padding: 2 }}><button onClick={() => setPointSprings((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setPointSprings((a) => [...a, { x: '', y: '', k: '' }])} style={addBtn}>+ Ressort ponctuel</button>
          </div>
        </>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Calculer</strong> pour lancer l&apos;analyse du radier.</div>
          ) : (
            <>
              {heatmap && heatmap.vals.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={secH}>Cartographie des déflexions</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
                      <HeatmapCanvas heatmap={heatmap} raftPts={pts.map((p) => ({ x: num(p.x), y: num(p.y) }))} />
                    </div>
                    <div style={{ flex: '0 0 auto', fontSize: 11.5, color: MUTED }}>
                      <div style={{ fontWeight: 600, color: INK, marginBottom: 6 }}>Échelle (mm)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 16, height: 120, borderRadius: 4, background: `linear-gradient(to top, ${heatColor(0)}, ${heatColor(0.25)}, ${heatColor(0.5)}, ${heatColor(0.75)}, ${heatColor(1)})`, border: `1px solid ${LINE}` }} />
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 120 }}>
                          <span>{heatmap.vMax.toFixed(2)}</span><span>{((heatmap.vMin + heatmap.vMax) / 2).toFixed(2)}</span><span>{heatmap.vMin.toFixed(2)}</span>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontStyle: 'italic', maxWidth: 180 }}>Grille d&apos;affichage ré-échantillonnée (découplée du maillage) — le motif de déflexion, pas les valeurs nodales (§8).</div>
                    </div>
                  </div>
                </div>
              )}

              <div style={secH}>Diagnostics (Eurocode 7 annexe H)</div>
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
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Calcul éléments finis côté serveur. La cartographie est un champ d&apos;affichage ré-échantillonné ; le maillage et les valeurs nodales restent serveur (§8).</div>

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
