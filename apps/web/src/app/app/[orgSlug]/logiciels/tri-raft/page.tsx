'use client';

/**
 * Radier triangulaire (DKT) — maillage triangulaire sur sol multicouche
 * (variante « maillage triangulaire » de GEOPLAQUE, §2.2.2). Saisie du
 * modèle ; le CALCUL est SERVEUR (moteur `tri-raft` → registryId `radier-tri`).
 * §8 : aucun champ nodal (w/p), aucune topologie de maillage (P/tris/N/nt).
 *
 * ⚠️ DIVERGENCE DOCUMENTÉE : ce solveur IGNORE les charges surfaciques `on:'soil'`
 * et les moments Mx/My des charges ponctuelles (effort vertical Fz seul).
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Pt { x: string; y: string }
interface PLoad { x: string; y: string; Fz: string }
interface LLoad { x1: string; y1: string; x2: string; y2: string; q: string }
interface ALoad { x1: string; y1: string; x2: string; y2: string; q: string; on: 'raft' | 'soil' }
interface Layer { zBase: string; E: string; nu: string }

const num = (s: string, d = 0): number => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d; };
const numU = (s: string): number | undefined => { const t = String(s).trim(); if (t === '') return undefined; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : undefined; };

export interface TriRaftForm {
  projet?: string;
  pts: Pt[];
  layers: Layer[];
  target: string; e: string; E: string; nu: string; q: string; foundD: string;
  pointLoads: PLoad[]; lineLoads: LLoad[]; areaLoads: ALoad[];
}

/** Payload API PUR (DoD §8 : géométrie du modèle bornée uniquement). */
export function buildTriRaftPayload(f: TriRaftForm): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    target: num(f.target, 1), e: num(f.e, 0.5), E: num(f.E, 30000), nu: num(f.nu, 0.2),
  };
  const q = numU(f.q); if (q !== undefined) opts.q = q;
  const foundD = numU(f.foundD); if (foundD !== undefined) opts.foundD = foundD;
  return {
    projet: f.projet,
    rafts: [{ pts: f.pts.map((p) => ({ x: num(p.x), y: num(p.y) })) }],
    pointLoads: f.pointLoads.map((l) => ({ x: num(l.x), y: num(l.y), Fz: num(l.Fz) })),
    lineLoads: f.lineLoads.map((l) => ({ x1: num(l.x1), y1: num(l.y1), x2: num(l.x2), y2: num(l.y2), q: num(l.q) })),
    areaLoads: f.areaLoads.map((l) => ({ x1: num(l.x1), y1: num(l.y1), x2: num(l.x2), y2: num(l.y2), q: num(l.q), on: l.on })),
    layers: f.layers.map((l) => ({ zBase: num(l.zBase), E: num(l.E), nu: num(l.nu) })),
    opts,
  };
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

/** Bandeau d'avertissement — divergence documentée du solveur DKT (charges sol + moments ignorés). */
function DivergenceBanner() {
  return (
    <div role="alert" data-testid="tri-raft-warning" style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: '#fff7e6', border: '1px solid #f0d38a', fontSize: 12.5, color: '#6e5a1f' }}>
      <strong>Ce mode ignore</strong> les charges surfaciques appliquées « sur le sol » (hors plaque) et les moments M<sub>x</sub>/M<sub>y</sub> des charges ponctuelles — seul l&apos;effort vertical F<sub>z</sub> est pris en compte par ce solveur.
    </div>
  );
}

export default function TriRaftPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  const [pts, setPts] = useState<Pt[]>([{ x: '0', y: '0' }, { x: '6', y: '0' }, { x: '6', y: '6' }, { x: '0', y: '6' }]);
  const [layers, setLayers] = useState<Layer[]>([{ zBase: '-10', E: '15', nu: '0.33' }]);
  const [target, setTarget] = useState('1.0'); const [e, setE] = useState('0.5');
  const [E, setEBeton] = useState('30000'); const [nu, setNu] = useState('0.2');
  const [q, setQ] = useState(''); const [foundD, setFoundD] = useState('');
  const [pointLoads, setPointLoads] = useState<PLoad[]>([]);
  const [lineLoads, setLineLoads] = useState<LLoad[]>([]);
  const [areaLoads, setAreaLoads] = useState<ALoad[]>([{ x1: '0', y1: '0', x2: '6', y2: '6', q: '50', on: 'raft' }]);

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

  const buildPayload = useCallback(() => buildTriRaftPayload({
    projet: projects.find((p) => p.id === projectId)?.name, pts, layers, target, e, E, nu, q, foundD, pointLoads, lineLoads, areaLoads,
  }), [projects, projectId, pts, layers, target, e, E, nu, q, foundD, pointLoads, lineLoads, areaLoads]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    const label = `Radier triangulaire — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'tri-raft', label, params: buildPayload() as Record<string, unknown> });
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
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Radier triangulaire (DKT)</div>
          <div style={{ fontSize: 12, color: MUTED }}>Maillage triangulaire sur sol multicouche · éléments finis · §2.2.2</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div><label style={lbl} htmlFor="tri-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="FD" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={230} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating} title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#c3bacf' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Mailler & calculer →'}
          </button>
        </div>
      </div>

      <DivergenceBanner />

      {calcError && <div style={{ ...card, background: '#f8e6ee', borderColor: '#e0b3c8', color: '#8a2d55' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['modele', 'Plaque & sol'], ['charges', 'Charges'], ['resultats', 'Résultats']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'modele' && (
        <>
          <div style={card}>
            <div style={secH}>Plaque (matériau par défaut)</div>
            <div style={grid3}>
              <div><label style={lbl}>Épaisseur e (m)</label><input style={inp} value={e} onChange={(ev) => setE(ev.target.value)} /></div>
              <div><label style={lbl}>Taille maille cible (m²)</label><input style={inp} value={target} onChange={(ev) => setTarget(ev.target.value)} /></div>
              <div><label style={lbl}>Profondeur d&apos;assise D (m)</label><input style={inp} value={foundD} onChange={(ev) => setFoundD(ev.target.value)} placeholder="0" /></div>
            </div>
            <div style={{ ...grid3, marginTop: 10 }}>
              <div><label style={lbl}>Module béton E (MPa)</label><input style={inp} value={E} onChange={(ev) => setEBeton(ev.target.value)} /></div>
              <div><label style={lbl}>ν béton</label><input style={inp} value={nu} onChange={(ev) => setNu(ev.target.value)} /></div>
              <div><label style={lbl}>Charge répartie additionnelle q (kPa)</label><input style={inp} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="0" /></div>
            </div>
            <div style={{ ...secH, marginTop: 14, marginBottom: 8 }}>Sommets du radier (contour)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['#', 'x (m)', 'y (m)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pts.map((p, i) => (
                <tr key={i}>
                  <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                  <td style={{ padding: 2 }}><input style={inp} value={p.x} onChange={(ev) => setPts((a) => a.map((q2, j) => j === i ? { ...q2, x: ev.target.value } : q2))} /></td>
                  <td style={{ padding: 2 }}><input style={inp} value={p.y} onChange={(ev) => setPts((a) => a.map((q2, j) => j === i ? { ...q2, y: ev.target.value } : q2))} /></td>
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

      {tab === 'charges' && (
        <>
          <div style={card}>
            <div style={secH}>Charges réparties (sur la plaque)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x1', 'y1', 'x2', 'y2', 'q (kPa)', 'sur', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{areaLoads.map((l, i) => (
                <tr key={i}>
                  {(['x1', 'y1', 'x2', 'y2', 'q'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={l[k]} onChange={(ev) => setAreaLoads((a) => a.map((q2, j) => j === i ? { ...q2, [k]: ev.target.value } : q2))} /></td>)}
                  <td style={{ padding: 2 }}><select style={inp} value={l.on} onChange={(ev) => setAreaLoads((a) => a.map((q2, j) => j === i ? { ...q2, on: ev.target.value as 'raft' | 'soil' } : q2))}><option value="raft">Radier</option><option value="soil">Sol (ignorée par ce solveur)</option></select></td>
                  <td style={{ padding: 2 }}><button onClick={() => setAreaLoads((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setAreaLoads((a) => [...a, { x1: '', y1: '', x2: '', y2: '', q: '', on: 'raft' }])} style={addBtn}>+ Charge répartie</button>
          </div>
          <div style={card}>
            <div style={secH}>Charges linéiques</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x1', 'y1', 'x2', 'y2', 'q (kN/ml)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{lineLoads.map((l, i) => (
                <tr key={i}>
                  {(['x1', 'y1', 'x2', 'y2', 'q'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={l[k]} onChange={(ev) => setLineLoads((a) => a.map((q2, j) => j === i ? { ...q2, [k]: ev.target.value } : q2))} /></td>)}
                  <td style={{ padding: 2 }}><button onClick={() => setLineLoads((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setLineLoads((a) => [...a, { x1: '', y1: '', x2: '', y2: '', q: '' }])} style={addBtn}>+ Charge linéique</button>
          </div>
          <div style={card}>
            <div style={secH}>Charges ponctuelles (effort vertical F<sub>z</sub> seul)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['x', 'y', 'Fz (kN)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pointLoads.map((l, i) => (
                <tr key={i}>
                  {(['x', 'y', 'Fz'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={l[k]} onChange={(ev) => setPointLoads((a) => a.map((q2, j) => j === i ? { ...q2, [k]: ev.target.value } : q2))} /></td>)}
                  <td style={{ padding: 2 }}><button onClick={() => setPointLoads((a) => a.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setPointLoads((a) => [...a, { x: '', y: '', Fz: '' }])} style={addBtn}>+ Charge ponctuelle</button>
          </div>
        </>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Mailler &amp; calculer</strong> pour lancer l&apos;analyse.</div>
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
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Calcul éléments finis côté serveur ; le maillage triangulaire et les valeurs nodales restent serveur (§8).</div>

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
