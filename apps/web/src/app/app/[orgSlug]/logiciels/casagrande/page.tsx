'use client';

/**
 * CASAGRANDE — Fondations profondes / pieux (NF P 94-262 / EC7).
 * Saisie + visualisation uniquement ; calcul SERVEUR (moteur `pieux` →
 * registryId `fondation-profonde-pieux`). Aucun facteur de calage de la méthode
 * côté navigateur (DoD §8) ; les coefficients partiels EC7 affichés/édités ici
 * sont des valeurs NORMATIVES publiques (NA française DA2), pas du calage moteur.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

type Section = 'circ' | 'carre' | 'rect' | 'quel';
type Meth = 'pmt' | 'cpt' | 'cphi';
type Da = 'da1' | 'da2' | 'da3';
type Sens = 'comp' | 'trac';
type Soil = 'argile' | 'sable' | 'craie' | 'marne' | 'roche';
interface LayerRow { soil: Soil; th: string; pl: string; em: string; qc: string; c: string; phi: string; gamma: string }

// Catalogue des 20 catégories de pieux (NF P 94-262, tableaux A.6/A.7/A.8) — verbatim outil client.
const PILES: { cat: number; label: string }[] = [
  { cat: 1, label: '1 · Foré simple (pieux et barrettes)' },
  { cat: 2, label: '2 · Foré boue (pieux et barrettes)' },
  { cat: 3, label: '3 · Foré tubé (virole perdue)' },
  { cat: 4, label: '4 · Foré tubé (virole récupérée)' },
  { cat: 5, label: '5 · Foré simple/boue avec rainurage ou puits' },
  { cat: 6, label: '6 · Foré tarière creuse simple/double rotation' },
  { cat: 7, label: '7 · Vissé moulé' },
  { cat: 8, label: '8 · Vissé tubé' },
  { cat: 9, label: '9 · Battu béton préfabriqué ou précontraint' },
  { cat: 10, label: '10 · Battu enrobé (béton/mortier/coulis)' },
  { cat: 11, label: '11 · Battu moulé' },
  { cat: 12, label: '12 · Battu acier fermé' },
  { cat: 13, label: '13 · Battu acier ouvert' },
  { cat: 14, label: '14 · Profilé H battu' },
  { cat: 15, label: '15 · Profilé H battu injecté' },
  { cat: 16, label: '16 · Palplanches battues' },
  { cat: 17, label: '17 · Micropieu type I' },
  { cat: 18, label: '18 · Micropieu type II' },
  { cat: 19, label: '19 · Pieu/micropieu injecté IGU (type III)' },
  { cat: 20, label: '20 · Pieu/micropieu injecté IRS (type IV)' },
];
const SOILS: { v: Soil; l: string }[] = [
  { v: 'argile', l: 'Argile / limon' }, { v: 'sable', l: 'Sable / grave' }, { v: 'craie', l: 'Craie' }, { v: 'marne', l: 'Marne' }, { v: 'roche', l: 'Roche' },
];
// Coefficients partiels EC7 par défaut (NA française DA2) — valeurs normatives publiques.
const DEFAULT_COEFFS = { k_gG: 1.35, k_gQ: 1.5, k_gb: 1.1, k_gs: 1.1, k_gst: 1.15, k_psi2: 0.3, cr_b_b: 0.7, cr_b_s: 0.7, cr_f_b: 0.5, cr_f_s: 0.7, cr_car: 0.9, cr_qp: 1.1, cr_car_t: 1.1, cr_qp_t: 1.5 };

const num = (s: string, d = 0): number => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d; };
const numU = (s: string): number | undefined => { const t = String(s).trim(); if (t === '') return undefined; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : undefined; };

export interface CasaForm {
  projet?: string;
  cat: number; section: Section; gB: string; gD: string; gz0: string;
  meth: Meth; da: Da; sens: Sens; essais: 'oui' | 'non';
  cG: string; cQ: string; nappe: string; nprofil: string; surf: string; redis: 'oui' | 'non';
  grpN: string; grpM: string; grpS: string;
  layers: LayerRow[];
  betonOn: boolean; fck: string; arm: 'arme' | 'nonarme'; k3: '1.0' | '1.2';
}

/** Payload API PUR (DoD §8 : entrées bornées + coefficients partiels EC7 publics ; nombres). */
export function buildCasaPayload(f: CasaForm): Record<string, unknown> {
  const geom: Record<string, unknown> = { section: f.section, g_B: num(f.gB, 0.6) };
  return {
    pieu: f.projet,
    geom,
    g_D: num(f.gD, 10),
    g_z0: num(f.gz0, 0),
    cat: f.cat,
    meth: f.meth,
    da: f.da,
    sens: f.sens,
    essais: f.essais,
    c_G: num(f.cG),
    c_Q: num(f.cQ),
    o_nappe: num(f.nappe, 500),
    o_nprofil: num(f.nprofil, 1),
    o_surf: num(f.surf),
    o_redis: f.redis,
    grp: { grp_n: num(f.grpN, 1), grp_m: num(f.grpM, 1), grp_s: num(f.grpS, 0) },
    coeffs: DEFAULT_COEFFS,
    layers: f.layers.map((l) => {
      const row: Record<string, unknown> = { soil: l.soil, th: num(l.th) };
      const add = (k: string, v: number | undefined) => { if (v !== undefined) row[k] = v; };
      add('pl', numU(l.pl)); add('em', numU(l.em)); add('qc', numU(l.qc)); add('c', numU(l.c)); add('phi', numU(l.phi)); add('gamma', numU(l.gamma));
      return row;
    }),
    cpt: { step: 0.2, pts: [] },
    ...(f.betonOn ? { beton: { b_fck: num(f.fck, 25), arm: f.arm, k3: f.k3 } } : {}),
  };
}

// ── Styles (accent pétrole CASAGRANDE) ──
const ACCENT = '#1f4e4a';
const INK = '#1c2422';
const MUTED = '#6b7570';
const LINE = '#d7ded9';
const PANEL = '#fbfcfb';
const card: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '15px 17px', marginBottom: 14 };
const secH: React.CSSProperties = { fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700, color: ACCENT, marginBottom: 11 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', border: '1px solid #c3ccc6', borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff' };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', color: MUTED, padding: '0 4px 5px', fontWeight: 700 };

export default function CasagrandePage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [, setEntitlements] = useState<EntitlementsResponse | null>(null);

  const [cat, setCat] = useState(1);
  const [section, setSection] = useState<Section>('circ');
  const [gB, setGB] = useState('0.6');
  const [gD, setGD] = useState('12');
  const [gz0, setGz0] = useState('0');
  const [meth, setMeth] = useState<Meth>('pmt');
  const [da, setDa] = useState<Da>('da2');
  const [sens, setSens] = useState<Sens>('comp');
  const [essais, setEssais] = useState<'oui' | 'non'>('non');
  const [cG, setCG] = useState('900');
  const [cQ, setCQ] = useState('300');
  const [nappe, setNappe] = useState('2');
  const [nprofil, setNprofil] = useState('1');
  const [surf, setSurf] = useState('0');
  const [redis, setRedis] = useState<'oui' | 'non'>('non');
  const [grpN, setGrpN] = useState('1');
  const [grpM, setGrpM] = useState('1');
  const [grpS, setGrpS] = useState('0');
  const [betonOn, setBetonOn] = useState(false);
  const [fck, setFck] = useState('25');
  const [arm, setArm] = useState<'arme' | 'nonarme'>('arme');
  const [k3, setK3] = useState<'1.0' | '1.2'>('1.0');
  const [layers, setLayers] = useState<LayerRow[]>([
    { soil: 'argile', th: '6', pl: '0.8', em: '8', qc: '', c: '', phi: '', gamma: '' },
    { soil: 'sable', th: '10', pl: '1.5', em: '15', qc: '', c: '', phi: '', gamma: '' },
  ]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<'pieu' | 'sol' | 'options' | 'resultats'>('pieu');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const fd = projs.filter((p) => p.domain === 'FD'); setProjects(fd); setEntitlements(ent); if (fd.length === 1) setProjectId(fd[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildCasaPayload({
    projet: projects.find((p) => p.id === projectId)?.name,
    cat, section, gB, gD, gz0, meth, da, sens, essais, cG, cQ, nappe, nprofil, surf, redis, grpN, grpM, grpS, layers, betonOn, fck, arm, k3,
  }), [projects, projectId, cat, section, gB, gD, gz0, meth, da, sens, essais, cG, cQ, nappe, nprofil, surf, redis, grpN, grpM, grpS, layers, betonOn, fck, arm, k3]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    const label = `CASAGRANDE — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'pieux', label, params: buildPayload() as Record<string, unknown> });
      setCalcResult(result); setTab('resultats');
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setCalcError(e?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : e?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : e?.reason === 'MODULE_NOT_IN_PACK' ? "Le module CASAGRANDE n'est pas inclus dans votre abonnement." : (e?.message ?? 'Erreur lors du calcul. Réessayez.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, buildPayload]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de CASAGRANDE" />;

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const calcDisabled = calculating || !projectId || !orgId;
  const upLayer = (i: number, k: keyof LayerRow, v: string) => setLayers((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>CASAGRANDE</div>
          <div style={{ fontSize: 12, color: MUTED }}>Fondations profondes — pieux · NF P 94-262 / Eurocode 7 · capacité portante</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div>
            <label style={lbl} htmlFor="cg-projet">Projet</label>
            <ProjectPicker orgId={orgId} domain="FD" projects={projects} setProjects={setProjects} value={projectId} onChange={setProjectId} accent={ACCENT} width={240} />
          </div>
          <button data-testid="btn-calculer" onClick={handleCalculer} disabled={calcDisabled} aria-busy={calculating}
            title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
            style={{ background: calcDisabled ? '#b7c2bd' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: calcDisabled ? 'not-allowed' : 'pointer' }}>
            {calculating ? 'Calcul…' : 'Calculer →'}
          </button>
        </div>
      </div>

      {calcError && <div style={{ ...card, background: '#fbeae7', borderColor: '#e0b3aa', color: '#8f2a1f' }} role="alert">{calcError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}` }} role="tablist">
        {([['pieu', 'Pieu & méthode'], ['sol', 'Profil de sol'], ['options', 'Options'], ['resultats', 'Résultats']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pieu' && (
        <>
          <div style={card}>
            <div style={secH}>Pieu</div>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Catégorie (NF P 94-262)</label>
              <select style={inp} value={cat} onChange={(e) => setCat(Number(e.target.value))}>{PILES.map((p) => <option key={p.cat} value={p.cat}>{p.label}</option>)}</select>
            </div>
            <div style={grid3}>
              <div><label style={lbl}>Section</label>
                <select style={inp} value={section} onChange={(e) => setSection(e.target.value as Section)}><option value="circ">Circulaire</option><option value="carre">Carrée</option><option value="rect">Rectangulaire</option><option value="quel">Quelconque</option></select>
              </div>
              <div><label style={lbl}>Diamètre/côté B (m)</label><input style={inp} value={gB} onChange={(e) => setGB(e.target.value)} /></div>
              <div><label style={lbl}>Fiche D (m)</label><input style={inp} value={gD} onChange={(e) => setGD(e.target.value)} /></div>
              <div><label style={lbl}>Cote de départ z₀ (m)</label><input style={inp} value={gz0} onChange={(e) => setGz0(e.target.value)} /></div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Méthode &amp; sollicitations</div>
            <div style={grid3}>
              <div><label style={lbl}>Méthode</label>
                <select style={inp} value={meth} onChange={(e) => setMeth(e.target.value as Meth)}><option value="pmt">Pressiomètre (pl*)</option><option value="cpt">Pénétromètre (qc)</option><option value="cphi">Labo (c, φ)</option></select>
              </div>
              <div><label style={lbl}>Approche de calcul</label>
                <select style={inp} value={da} onChange={(e) => setDa(e.target.value as Da)}><option value="da1">DA1 (A1+M1+R1 / A2+M1+R4)</option><option value="da2">DA2 — NF P 94-262 (A1+M1+R2)</option><option value="da3">DA3 (M2+R3)</option></select>
              </div>
              <div><label style={lbl}>Sens de sollicitation</label>
                <select style={inp} value={sens} onChange={(e) => setSens(e.target.value as Sens)}><option value="comp">Compression</option><option value="trac">Traction</option></select>
              </div>
              <div><label style={lbl}>Charge permanente G (kN)</label><input style={inp} value={cG} onChange={(e) => setCG(e.target.value)} /></div>
              <div><label style={lbl}>Charge variable Q (kN)</label><input style={inp} value={cQ} onChange={(e) => setCQ(e.target.value)} /></div>
              <div><label style={lbl}>Essais renforcés</label>
                <select style={inp} value={essais} onChange={(e) => setEssais(e.target.value as 'oui' | 'non')}><option value="non">Non</option><option value="oui">Oui</option></select>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'sol' && (
        <div style={card}>
          <div style={secH}>Profil de sol</div>
          <div style={{ ...grid3, marginBottom: 12 }}>
            <div><label style={lbl}>Nappe (m/TN)</label><input style={inp} value={nappe} onChange={(e) => setNappe(e.target.value)} /></div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Sol', 'H (m)', 'pl* (MPa)', 'EM (MPa)', 'qc (MPa)', 'c (kPa)', 'φ (°)', 'γ', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {layers.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 2, minWidth: 110 }}><select style={inp} value={r.soil} onChange={(e) => upLayer(i, 'soil', e.target.value)}>{SOILS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select></td>
                  {(['th', 'pl', 'em', 'qc', 'c', 'phi', 'gamma'] as const).map((k) => (
                    <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => upLayer(i, k, e.target.value)} placeholder={k === 'th' ? '' : '—'} /></td>
                  ))}
                  <td style={{ padding: 2 }}><button onClick={() => setLayers((p) => (p.length <= 1 ? p : p.filter((_, j) => j !== i)))} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#a1392c', fontSize: 12 }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setLayers((p) => [...p, { soil: 'sable', th: '', pl: '', em: '', qc: '', c: '', phi: '', gamma: '' }])} style={{ marginTop: 8, border: `1px dashed ${ACCENT}`, background: '#e7efed', color: ACCENT, borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>+ Ajouter une couche</button>
        </div>
      )}

      {tab === 'options' && (
        <>
          <div style={card}>
            <div style={secH}>Effet de groupe</div>
            <div style={grid3}>
              <div><label style={lbl}>Nombre de files n</label><input style={inp} value={grpN} onChange={(e) => setGrpN(e.target.value)} /></div>
              <div><label style={lbl}>Pieux par file m</label><input style={inp} value={grpM} onChange={(e) => setGrpM(e.target.value)} /></div>
              <div><label style={lbl}>Entraxe S (m) · 0 = isolé</label><input style={inp} value={grpS} onChange={(e) => setGrpS(e.target.value)} /></div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Options de calcul</div>
            <div style={grid3}>
              <div><label style={lbl}>N° de profil</label><input style={inp} value={nprofil} onChange={(e) => setNprofil(e.target.value)} /></div>
              <div><label style={lbl}>Surcharge surface (kN)</label><input style={inp} value={surf} onChange={(e) => setSurf(e.target.value)} /></div>
              <div><label style={lbl}>Redistribution</label>
                <select style={inp} value={redis} onChange={(e) => setRedis(e.target.value as 'oui' | 'non')}><option value="non">Non</option><option value="oui">Oui</option></select>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Béton (structurel)</div>
            <label style={{ ...lbl, display: 'flex', gap: 7, alignItems: 'center' }}><input type="checkbox" checked={betonOn} onChange={(e) => setBetonOn(e.target.checked)} /> Vérification structurelle du fût</label>
            {betonOn && (
              <div style={{ ...grid3, marginTop: 8 }}>
                <div><label style={lbl}>fck (MPa)</label><input style={inp} value={fck} onChange={(e) => setFck(e.target.value)} /></div>
                <div><label style={lbl}>Armature</label><select style={inp} value={arm} onChange={(e) => setArm(e.target.value as 'arme' | 'nonarme')}><option value="arme">Armé</option><option value="nonarme">Non armé</option></select></div>
                <div><label style={lbl}>k₃</label><select style={inp} value={k3} onChange={(e) => setK3(e.target.value as '1.0' | '1.2')}><option value="1.0">1,0</option><option value="1.2">1,2</option></select></div>
              </div>
            )}
          </div>
          <div style={card}>
            <div style={secH}>Coefficients partiels EC7 (NA française, DA2)</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>γ_G = {DEFAULT_COEFFS.k_gG} · γ_Q = {DEFAULT_COEFFS.k_gQ} · γ_b = {DEFAULT_COEFFS.k_gb} · γ_s = {DEFAULT_COEFFS.k_gs} · γ_s;t = {DEFAULT_COEFFS.k_gst} · ξ fluage compression = {DEFAULT_COEFFS.cr_car} · valeurs normatives appliquées.</div>
          </div>
        </>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un projet et cliquez sur <strong>Calculer</strong> pour lancer la vérification NF P 94-262.</div>
          ) : (
            <>
              <div data-testid="verdict-banner" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderRadius: 11, marginBottom: 14, background: output.verdict === 'PASS' ? '#e4efe6' : output.verdict === 'FAIL' ? '#fbeae7' : '#f4edd8', border: `1px solid ${output.verdict === 'PASS' ? '#a9d0b3' : output.verdict === 'FAIL' ? '#e0b3aa' : '#e6cf9c'}` }}>
                <b style={{ fontSize: 15, color: output.verdict === 'PASS' ? '#2e7d4f' : output.verdict === 'FAIL' ? '#b23a2e' : '#96701a' }}>
                  {output.verdict === 'PASS' ? 'Pieu vérifié — critères EC7 satisfaits' : output.verdict === 'FAIL' ? 'Pieu non vérifié — reprise nécessaire' : 'Résultats de vérification'}
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
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.status && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: row.status === 'ok' ? '#e4efe6' : '#fbeae7', color: row.status === 'ok' ? '#2e7d4f' : '#b23a2e' }}>{row.status === 'ok' ? 'OK' : 'NON'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Facteurs de portance et calage appliqués côté serveur ; seuls les résultats de vérification (Fd / Rd / taux) sont affichés.</div>
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
