'use client';

/**
 * PressioPro — Dépouillement d'essai pressiométrique Ménard (NF EN ISO 22476-4).
 * Fidèle à l'outil client (onglets Projet/Log/Mesures/Résultats/Profil) : appareillage
 * partagé + PROFIL multi-profondeurs (une profondeur = un dépouillement serveur), coupe
 * de sondage (Log), sélection manuelle des seuils p₀/p_f, catalogue de sondes (auto-Vs)
 * et gaines. Le CALCUL est SERVEUR (moteur `pressiometre` → `pressiometre-menard`).
 * §8 : aucun intermédiaire confidentiel côté navigateur ; la courbe trace les LECTURES
 * saisies + le résultat p_L ; α et Ey sont des grandeurs de résultat publiques renvoyées
 * par le serveur.
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type { Project, EntitlementsResponse, CalcResult, NormalizedCalcOutput, CalcOutputRow, OfficialPv } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Row { p: string; v15: string; v30: string; v60: string }

const num = (s: string, d = 0): number => { const t = String(s).trim(); if (t === '') return d; const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : d; };
const pd = (label: string): number => { const v = parseFloat(String(label).replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export interface PressioProForm {
  projet?: string; label: string;
  a: string; Ph: string; Pe: string; V0: string; k0: string;
  gamma: string; nappe: string;
  rows: Row[];
  /** Indice de sélection manuelle du début pseudo-élastique p₀ (-1/absent = auto). */
  pf_idx?: number;
  /** Indice de sélection manuelle de la fin de plage p_f (-1/absent = auto). */
  plm_idx?: number;
}

/** Payload API PUR (DoD §8 : essai borné, nombres ; ≥ 4 paliers valides requis serveur). */
export function buildPressioProPayload(f: PressioProForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    projet: f.projet,
    label: (f.label || 'Essai').slice(0, 40),
    params: { a: num(f.a), Ph: num(f.Ph), Pe: num(f.Pe), V0: num(f.V0, 535), k0: num(f.k0, 0.5) },
    gamma: num(f.gamma),
    nappe: num(f.nappe),
    rows: f.rows.map((r) => ({ p: num(r.p), v15: num(r.v15), v30: num(r.v30), v60: num(r.v60) })),
  };
  // Sélection manuelle des seuils : on ne transmet un indice QUE s'il est choisi
  // (≥ 0). -1/absent = mode automatique (le moteur détermine p₀/p_f).
  if (typeof f.pf_idx === 'number' && f.pf_idx >= 0) out.pf_idx = f.pf_idx;
  if (typeof f.plm_idx === 'number' && f.plm_idx >= 0) out.plm_idx = f.plm_idx;
  return out;
}

// ---------------------------------------------------------------------------
// APPAREILLAGE — étalonnage (sonde dans l'air) & calibrage (forage indéformable).
// Deux calculs SERVEUR distincts (moteurs pressio-etalonnage / pressio-calibrage) qui
// produisent les coefficients (Vs/Pe/a) réutilisables dans l'appareillage ci-dessus.
// §8 : les payloads sont PURS (points de mesure bornés) ; les coefficients viennent du
// serveur, aucun calcul de régression côté navigateur.
// ---------------------------------------------------------------------------

/** Une ligne de mesure d'appareillage (P en bar, V60 en cm³). */
export interface AppRow { p: string; v60: string }

/** Ligne d'appareillage vide (saisie). */
export const emptyAppRow = (): AppRow => ({ p: '', v60: '' });

/**
 * Payload API PUR pour l'étalonnage / le calibrage (DoD §8) : on ne transmet QUE les
 * points (P, V60) réellement saisis (P et V60 non vides), en nombres. Aucune grandeur de
 * résultat (Vs/Pe/a viennent du serveur). Les rangées vides sont ÉCARTÉES (parité HTML :
 * `filter(r => r.p !== '' && r.v60 !== '')`). Le moteur exige ≥ 3 points.
 */
export function buildAppareillagePayload(
  rows: AppRow[],
  meta: { projet?: string; label: string },
): Record<string, unknown> {
  return {
    projet: meta.projet,
    label: (meta.label || 'Appareillage').slice(0, 40),
    rows: rows
      .filter((r) => String(r.p).trim() !== '' && String(r.v60).trim() !== '')
      .map((r) => ({ p: num(r.p), v60: num(r.v60) })),
  };
}

/** Nombre de points valides (P et V60 renseignés) dans une saisie d'appareillage. */
export function countAppPoints(rows: AppRow[]): number {
  return rows.filter((r) => String(r.p).trim() !== '' && String(r.v60).trim() !== '').length;
}

// ---------------------------------------------------------------------------
// Catalogue de sondes (Vs auto) et de gaines (coefficient a indicatif) — repris
// FIDÈLEMENT de l'outil d'origine (onglet Projet/Appareillage). Données de
// référence pures (aucune science), utilisées pour pré-remplir les champs.
// ---------------------------------------------------------------------------

export interface SondeItem { group: string; name: string; vs: number }
export const SONDE_CATALOGUE: readonly SondeItem[] = [
  { group: 'Sonde Ø 44 mm', name: 'Ø 44 — Tube fendu avec passe', vs: 280 },
  { group: 'Sonde Ø 44 mm', name: 'Ø 44 — Tube fendu sans passe', vs: 280 },
  { group: 'Sonde Ø 44 mm', name: 'Ø 44 — Carottier battu (SPT)', vs: 280 },
  { group: 'Sonde Ø 52 mm', name: 'Ø 52 — Standard NF EN ISO 22476-4', vs: 400 },
  { group: 'Sonde Ø 52 mm', name: 'Ø 52 — Tube fendu avec passe', vs: 400 },
  { group: 'Sonde Ø 60 mm', name: 'Ø 60 — Standard', vs: 535 },
  { group: 'Sonde Ø 60 mm', name: 'Ø 60 — Tube fendu avec passe', vs: 535 },
  { group: 'Sonde Ø 60 mm', name: 'Ø 60 — Tube fendu sans passe', vs: 535 },
  { group: 'Sonde Ø 75 mm', name: 'Ø 75 — Standard NF EN ISO 22476-4', vs: 810 },
  { group: 'Sonde Ø 75 mm', name: 'Ø 75 — Tube fendu avec passe', vs: 810 },
  { group: 'Sonde Ø 75 mm', name: 'Ø 75 — Tube fendu sans passe', vs: 810 },
  { group: 'Sonde Ø 75 mm', name: 'Ø 75 — Forage refoulé / battu', vs: 810 },
  { group: 'Sonde Ø 90 mm', name: 'Ø 90 — Standard', vs: 1200 },
  { group: 'Sonde Ø 90 mm', name: 'Ø 90 — Grande cavité (roche)', vs: 1200 },
  { group: 'Autres sondes', name: 'Pencel (Ø 32 mm)', vs: 100 },
  { group: 'Autres sondes', name: 'Micro-pressiomètre Ø 22 mm', vs: 80 },
  { group: 'Autres sondes', name: 'Sonde autoforeuse (PAF)', vs: 535 },
  { group: 'Autres sondes', name: 'Sonde haute pression (HP)', vs: 535 },
];

/** Vs (cm³) de la sonde sélectionnée, ou null si inconnue (jamais de défaut inventé). */
export function vsForSonde(name: string): number | null {
  const s = SONDE_CATALOGUE.find((x) => x.name === name);
  return s ? s.vs : null;
}

export interface GaineItem { name: string; a: number }
export const GAINE_CATALOGUE: readonly GaineItem[] = [
  { name: 'Gaine 1,5 mm (souple)', a: 0.35 },
  { name: 'Gaine 3 mm (standard)', a: 0.65 },
  { name: 'Gaine métallique à lamelles', a: 0.15 },
  { name: 'Gaine toilée renforcée', a: 0.45 },
  { name: 'Gaine toilée métallique', a: 0.25 },
];

/** Coefficient a indicatif de la gaine (documentaire), ou null si inconnue. */
export function aForGaine(name: string): number | null {
  const g = GAINE_CATALOGUE.find((x) => x.name === name);
  return g ? g.a : null;
}

// ---------------------------------------------------------------------------
// Agrégation multi-profondeurs (PROFIL) — extraction PURE des grandeurs PUBLIQUES
// d'un dépouillement serveur (jamais de recalcul côté navigateur : §8).
// ---------------------------------------------------------------------------

export interface ProfilRow {
  label: string; z: number;
  EM: number | null; pL_MPa: number | null; pf_MPa: number | null;
  ratio: number | null; alpha: number | null; categorie: string | null;
}

/** Retrouve la valeur numérique d'une ligne de résultat par motif de libellé. */
function rowNum(rows: CalcOutputRow[], re: RegExp): number | null {
  const r = rows.find((x) => re.test(x.label));
  return r && typeof r.value === 'number' ? r.value : null;
}
function rowText(rows: CalcOutputRow[], re: RegExp): string | null {
  const r = rows.find((x) => re.test(x.label));
  return r && typeof r.value === 'string' ? r.value : null;
}

/**
 * Construit une ligne de profil à partir du dépouillement SERVEUR d'une profondeur.
 * Renvoie null si la sortie n'a pas de résultat exploitable (pas de p_L). Les
 * pressions sont converties bar → MPa pour le profil (parité outil d'origine).
 */
export function buildProfilRow(label: string, output: NormalizedCalcOutput | null): ProfilRow | null {
  if (!output || !Array.isArray(output.rows) || output.rows.length === 0) return null;
  const rows = output.rows;
  const pL_bar = rowNum(rows, /p_L\b/);
  if (pL_bar === null || !Number.isFinite(pL_bar)) return null;
  const pf_bar = rowNum(rows, /p_f\*/);
  return {
    label, z: pd(label),
    EM: rowNum(rows, /Module pressiométrique/),
    pL_MPa: pL_bar / 10,
    pf_MPa: pf_bar !== null ? pf_bar / 10 : null,
    ratio: rowNum(rows, /Rapport E_M/),
    alpha: rowNum(rows, /Coefficient rhéologique/),
    categorie: rowText(rows, /Catégorie de sol/),
  };
}

// ---------------------------------------------------------------------------
// LOG — coupe de sondage carotté (documentaire). Structure fidèle à l'outil client
// (NF EN ISO 22475-1 / ISO 14688). Front-local : le moteur ne consomme PAS ces
// champs (aucune entrée moteur). Persistance/PV = à câbler côté backend (avenant).
// ---------------------------------------------------------------------------

interface LogLayer { de: string; a: string; nature: string; etat: string; prel: string; qual: string; rqd: string; desc: string }
const emptyLayer = (): LogLayer => ({ de: '', a: '', nature: '', etat: '', prel: '', qual: '', rqd: '', desc: '' });

interface Depth { id: string; label: string; rows: Row[]; pf_idx: number; plm_idx: number }
let _did = 0;
const newDepth = (label: string): Depth => ({ id: `d${++_did}`, label, rows: [
  { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' },
  { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' }, { p: '', v15: '', v30: '', v60: '' },
], pf_idx: -1, plm_idx: -1 });

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

type Tab = 'essai' | 'etalonnage' | 'calibrage' | 'log' | 'mesures' | 'resultats' | 'profil';

/** Extrait la valeur numérique d'une ligne de résultat serveur par motif de libellé. */
function pickRow(rows: CalcOutputRow[] | undefined, re: RegExp): number | null {
  if (!rows) return null;
  const r = rows.find((x) => re.test(x.label));
  return r && typeof r.value === 'number' ? r.value : null;
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

  // Appareillage PARTAGÉ entre profondeurs (parité outil : getParams() global).
  const [sonde, setSonde] = useState('Ø 60 — Standard');
  const [gaine, setGaine] = useState('Gaine 3 mm (standard)');
  const [a, setA] = useState('0'); const [Ph, setPh] = useState('0'); const [Pe, setPe] = useState('0');
  const [V0, setV0] = useState('535'); const [k0, setK0] = useState('0.5');
  const [gamma, setGamma] = useState(''); const [nappe, setNappe] = useState('');

  // PROFIL multi-profondeurs : source de vérité = depths[] ; cur = profondeur éditée.
  const [depths, setDepths] = useState<Depth[]>([newDepth('Profondeur 1')]);
  const [cur, setCur] = useState(0);
  const d = depths[cur] ?? depths[0];

  // Coupe de sondage (Log) — documentaire, front-local.
  const [logLayers, setLogLayers] = useState<LogLayer[]>([emptyLayer()]);

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<Tab>('essai');

  // PROFIL : résultats de dépouillement par profondeur.
  const [profil, setProfil] = useState<ProfilRow[]>([]);
  const [profiling, setProfiling] = useState(false);

  // APPAREILLAGE — étalonnage (sonde dans l'air) & calibrage (forage indéformable).
  const [etalRows, setEtalRows] = useState<AppRow[]>([emptyAppRow(), emptyAppRow(), emptyAppRow()]);
  const [calibRows, setCalibRows] = useState<AppRow[]>([emptyAppRow(), emptyAppRow(), emptyAppRow()]);
  const [etalOut, setEtalOut] = useState<NormalizedCalcOutput | null>(null);
  const [calibOut, setCalibOut] = useState<NormalizedCalcOutput | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const lb = projs.filter((p) => p.domain === 'LB'); setProjects(lb); setEnt(ent); if (lb.length === 1) setProjectId(lb[0].id); })
      .catch(() => {});
  }, [orgId]);

  // Mutations sur la profondeur courante.
  const patchDepth = useCallback((patch: Partial<Depth>) => {
    setDepths((ds) => ds.map((x, i) => (i === cur ? { ...x, ...patch } : x)));
  }, [cur]);
  const setRows = useCallback((upd: (r: Row[]) => Row[]) => {
    setDepths((ds) => ds.map((x, i) => (i === cur ? { ...x, rows: upd(x.rows) } : x)));
  }, [cur]);

  const depthForm = useCallback((dp: Depth): PressioProForm => ({
    projet: projects.find((p) => p.id === projectId)?.name,
    label: dp.label, a, Ph, Pe, V0, k0, gamma, nappe, rows: dp.rows, pf_idx: dp.pf_idx, plm_idx: dp.plm_idx,
  }), [projects, projectId, a, Ph, Pe, V0, k0, gamma, nappe]);

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;
    setCalculating(true); setCalcError(null); setPvResult(null);
    try {
      const result = await runCalc(orgId, projectId, { engineId: 'pressiometre', label: `PressioPro — ${d.label}`.slice(0, 60), params: buildPressioProPayload(depthForm(d)) as Record<string, unknown> });
      setCalcResult(result); setTab('resultats');
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'EXPIRED' ? 'Abonnement expiré — calcul impossible.' : x?.reason === 'QUOTA' ? 'Quota de calculs épuisé.' : x?.reason === 'MODULE_NOT_IN_PACK' ? "Le module PressioPro n'est pas inclus dans votre abonnement." : (x?.message ?? 'Erreur lors du calcul. Vérifiez qu’il y a au moins 4 paliers cohérents.'));
    } finally { setCalculating(false); }
  }, [orgId, projectId, d, depthForm]);

  // PROFIL : dépouille CHAQUE profondeur côté serveur puis agrège (aucun calcul navigateur).
  const handleProfil = useCallback(async () => {
    if (!orgId || !projectId) return;
    setProfiling(true); setCalcError(null);
    try {
      const out: ProfilRow[] = [];
      for (const dp of depths) {
        const valid = dp.rows.filter((r) => num(r.p) > 0 && num(r.v60) > 0).length;
        if (valid < 4) continue; // parité moteur : ≥ 4 paliers valides
        const res = await runCalc(orgId, projectId, { engineId: 'pressiometre', label: `PressioPro — ${dp.label}`.slice(0, 60), params: buildPressioProPayload(depthForm(dp)) as Record<string, unknown> });
        const row = buildProfilRow(dp.label, res.output as NormalizedCalcOutput | null);
        if (row) out.push(row);
      }
      out.sort((x, y) => x.z - y.z);
      setProfil(out);
    } catch (err: unknown) {
      const x = err as { reason?: string; message?: string };
      setCalcError(x?.reason === 'QUOTA' ? 'Quota de calculs épuisé (le profil dépouille chaque profondeur).' : (x?.message ?? 'Erreur lors du calcul du profil.'));
    } finally { setProfiling(false); }
  }, [orgId, projectId, depths, depthForm]);

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true); setCalcError(null);
    try { const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id }); setPvResult(pv); }
    catch (err: unknown) { setCalcError((err as { message?: string })?.message ?? "Erreur lors de l'émission du PV."); }
    finally { setEmittingPv(false); }
  }, [calcResult, orgId, projectId]);

  // Appareillage : mappe l'erreur d'entitlement/quota vers un message lisible.
  const appErrMsg = (err: unknown, fallback: string): string => {
    const x = err as { reason?: string; message?: string };
    if (x?.reason === 'EXPIRED') return 'Abonnement expiré — calcul impossible.';
    if (x?.reason === 'QUOTA') return 'Quota de calculs épuisé.';
    if (x?.reason === 'MODULE_NOT_IN_PACK') return "PressioPro n'est pas inclus dans votre abonnement.";
    return x?.message ?? fallback;
  };

  const projName = useCallback(
    () => projects.find((p) => p.id === projectId)?.name,
    [projects, projectId],
  );

  const handleEtalonnage = useCallback(async () => {
    if (!orgId || !projectId) return;
    if (countAppPoints(etalRows) < 3) { setAppError('Saisissez au moins 3 points (P, V60).'); return; }
    setAppBusy(true); setAppError(null);
    try {
      const res = await runCalc(orgId, projectId, {
        engineId: 'pressio-etalonnage', label: 'PressioPro — étalonnage',
        params: buildAppareillagePayload(etalRows, { projet: projName(), label: 'Étalonnage' }),
      });
      setEtalOut(res.output as NormalizedCalcOutput | null);
    } catch (err: unknown) {
      setEtalOut(null); setAppError(appErrMsg(err, "Erreur lors de l'étalonnage. Vérifiez au moins 3 points cohérents."));
    } finally { setAppBusy(false); }
  }, [orgId, projectId, etalRows, projName]);

  const handleCalibrage = useCallback(async () => {
    if (!orgId || !projectId) return;
    if (countAppPoints(calibRows) < 3) { setAppError('Saisissez au moins 3 points (P, V60).'); return; }
    setAppBusy(true); setAppError(null);
    try {
      const res = await runCalc(orgId, projectId, {
        engineId: 'pressio-calibrage', label: 'PressioPro — calibrage',
        params: buildAppareillagePayload(calibRows, { projet: projName(), label: 'Calibrage' }),
      });
      setCalibOut(res.output as NormalizedCalcOutput | null);
    } catch (err: unknown) {
      setCalibOut(null); setAppError(appErrMsg(err, 'Erreur lors du calibrage. Vérifiez au moins 3 points cohérents.'));
    } finally { setAppBusy(false); }
  }, [orgId, projectId, calibRows, projName]);

  // Transfert des coefficients serveur vers l'appareillage partagé (parité applyEtalonnage/
  // applyCalibrage de l'outil : l'étalonnage fournit Vs et Pe ; le calibrage fournit a).
  const applyEtalonnage = useCallback(() => {
    const vs = pickRow(etalOut?.rows, /^Vs\b/);
    const pe = pickRow(etalOut?.rows, /^Pe\b/);
    if (vs !== null) setV0(vs.toFixed(1));
    if (pe !== null) setPe(pe.toFixed(3));
    setTab('essai');
  }, [etalOut]);

  const applyCalibrage = useCallback(() => {
    // Le champ appareillage `a` est en cm³/MPa (cf. onglet Projet) ; le moteur renvoie a en
    // cm³/bar -> on transfère la valeur cm³/MPa (a×10) pour cohérence avec la saisie.
    const aMPa = pickRow(calibOut?.rows, /cm³\/MPa/);
    const aBar = pickRow(calibOut?.rows, /^Coefficient de calibrage a$/);
    const val = aMPa ?? (aBar !== null ? aBar * 10 : null);
    if (val !== null) setA(val.toFixed(3));
    setTab('essai');
  }, [calibOut]);

  const output = calcResult?.output as NormalizedCalcOutput | null;
  const pLBar = useMemo(() => {
    const r = output?.rows?.find((x) => /p_L\b/.test(x.label) && !/nette/i.test(x.label));
    return r && typeof r.value === 'number' ? r.value : null;
  }, [output]);

  if (!mounted) return <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de PressioPro" />;
  const calcDisabled = calculating || !projectId || !orgId;
  // Options de seuils : un item par palier renseigné + « Auto ».
  const seuilOptions = d.rows.map((r, i) => ({ i, p: num(r.p) })).filter((o) => o.p > 0);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 56px', fontFamily: 'inherit', color: INK }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>PressioPro</div>
          <div style={{ fontSize: 12, color: MUTED }}>Dépouillement d&apos;essai pressiométrique · Ménard · NF EN ISO 22476-4</div>
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

      {/* Barre des profondeurs (parité renderDepthBar) */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px' }}>
        <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, color: MUTED, marginRight: 4 }}>Profondeurs</span>
        {depths.map((dp, i) => (
          <span key={dp.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <button onClick={() => setCur(i)} data-testid={`depth-tab-${i}`}
              style={{ border: `1px solid ${i === cur ? ACCENT : LINE}`, background: i === cur ? '#f7ece9' : '#fff', color: i === cur ? ACCENT : INK, borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {dp.label}
            </button>
            {depths.length > 1 && <button aria-label={`Supprimer ${dp.label}`} onClick={() => { setDepths((ds) => ds.filter((_, j) => j !== i)); setCur((c) => (c >= i && c > 0 ? c - 1 : c)); }} style={delBtn}>✕</button>}
          </span>
        ))}
        <button onClick={() => { setDepths((ds) => [...ds, newDepth(`Profondeur ${ds.length + 1}`)]); setCur(depths.length); }} style={addBtn} data-testid="add-depth">+ Profondeur</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }} role="tablist">
        {([['essai', 'Projet & appareillage'], ['etalonnage', 'Étalonnage'], ['calibrage', 'Calibrage'], ['log', 'Log de sondage'], ['mesures', 'Mesures & seuils'], ['resultats', 'Courbe & résultats'], ['profil', 'Profil']] as const).map(([id, t]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ border: 'none', background: 'none', padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: tab === id ? ACCENT : MUTED, borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'essai' && (
        <>
          <div style={card}>
            <div style={secH}>Identification — profondeur courante</div>
            <label style={lbl}>Repère (sondage / profondeur) — le préfixe numérique donne z (m)</label>
            <input style={{ ...inp, maxWidth: 320 }} value={d.label} onChange={(e) => patchDepth({ label: e.target.value })} />
          </div>
          <div style={card}>
            <div style={secH}>Appareillage (partagé entre profondeurs)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Type de sonde → remplit Vs auto</label>
                <select style={inp} value={sonde} onChange={(e) => { const v = e.target.value; setSonde(v); const vs = vsForSonde(v); if (vs !== null) setV0(String(vs)); }}>
                  {Array.from(new Set(SONDE_CATALOGUE.map((s) => s.group))).map((g) => (
                    <optgroup key={g} label={g}>
                      {SONDE_CATALOGUE.filter((s) => s.group === g).map((s) => <option key={s.name} value={s.name}>{s.name} — Vs={s.vs} cm³</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Type de gaine (documentaire — a indicatif)</label>
                <select style={inp} value={gaine} onChange={(e) => setGaine(e.target.value)}>
                  {GAINE_CATALOGUE.map((g) => <option key={g.name} value={g.name}>{g.name} — a≈{g.a}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>a vient du <strong>calibrage</strong> (forage libre) — laissez 0 si non effectué. Vs et Pe viennent de l’<strong>étalonnage</strong> (sonde dans l’air). Corrections NF EN ISO 22476-4 Annexe D.</div>
            <div style={grid5}>
              <div><label style={lbl}>a (cm³/MPa)</label><input style={inp} value={a} onChange={(e) => setA(e.target.value)} /></div>
              <div><label style={lbl}>P_h (bar)</label><input style={inp} value={Ph} onChange={(e) => setPh(e.target.value)} /></div>
              <div><label style={lbl}>P_e (bar)</label><input style={inp} value={Pe} onChange={(e) => setPe(e.target.value)} /></div>
              <div><label style={lbl}>Vs (cm³)</label><input style={inp} value={V0} onChange={(e) => setV0(e.target.value)} /></div>
              <div><label style={lbl}>K₀</label><input style={inp} value={k0} onChange={(e) => setK0(e.target.value)} /></div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Sol &amp; nappe (pour σ_h0)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 320 }}>
              <div><label style={lbl}>Poids volumique γ (kN/m³)</label><input style={inp} value={gamma} onChange={(e) => setGamma(e.target.value)} /></div>
              <div><label style={lbl}>Nappe Z_w (m) — 0 si absente</label><input style={inp} value={nappe} onChange={(e) => setNappe(e.target.value)} /></div>
            </div>
          </div>
        </>
      )}

      {tab === 'etalonnage' && (
        <>
          <div style={card}>
            <div style={secH}>Étalonnage — sonde dans l’air (V = Vs + a·P)</div>
            <p style={{ fontSize: 11, color: MUTED, marginBottom: 10, lineHeight: 1.6 }}>
              Saisissez les paliers (P, V₆₀) mesurés sonde dans l’air. Le calcul serveur ajuste la droite
              V = Vs + a·P et détermine <strong>Vs</strong> (volume à l’origine) et <strong>Pe</strong> (pression à V = 1,2·Vs).
              La pente d’air a <strong>n’est pas</strong> le coefficient de correction (celui-ci vient du calibrage). ≥ 3 points.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['P (bar)', 'V₆₀ (cm³)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{etalRows.map((r, i) => (
                <tr key={i}>
                  {(['p', 'v60'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input data-testid={`etal-${k}-${i}`} style={inp} value={r[k]} onChange={(e) => setEtalRows((rs) => rs.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                  <td style={{ padding: 2 }}><button aria-label={`Supprimer palier ${i + 1}`} onClick={() => setEtalRows((rs) => rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setEtalRows((rs) => [...rs, emptyAppRow()])} style={addBtn}>+ Ajouter un palier</button>
              <button data-testid="btn-etalonner" onClick={handleEtalonnage} disabled={appBusy || !projectId || !orgId}
                style={{ marginLeft: 'auto', background: appBusy ? '#cbb8b2' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontWeight: 600, cursor: appBusy ? 'wait' : 'pointer', fontSize: 13 }}>
                {appBusy ? 'Calcul…' : 'Calculer l’étalonnage →'}
              </button>
            </div>
          </div>
          {etalOut && Array.isArray(etalOut.rows) && etalOut.rows.length > 0 && (
            <div style={card} data-testid="etal-result">
              <div style={secH}>Coefficients d’étalonnage</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>{etalOut.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : row.value}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                  </tr>
                ))}</tbody>
              </table>
              <button data-testid="btn-appliquer-etal" onClick={applyEtalonnage} style={{ marginTop: 12, background: '#2e7d4f', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Appliquer Vs et Pe dans l’appareillage
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'calibrage' && (
        <>
          <div style={card}>
            <div style={secH}>Calibrage — forage indéformable (correction de volume)</div>
            <p style={{ fontSize: 11, color: MUTED, marginBottom: 10, lineHeight: 1.6 }}>
              Saisissez les paliers (P, V₆₀) mesurés en tube indéformable. Le calcul serveur détermine le
              <strong> coefficient de calibrage a</strong> (pente dV/dP) — correction <strong>Vc = Vr − a·Pr</strong> — ainsi que la qualité d’ajustement. ≥ 3 points.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['P (bar)', 'V₆₀ (cm³)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{calibRows.map((r, i) => (
                <tr key={i}>
                  {(['p', 'v60'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input data-testid={`calib-${k}-${i}`} style={inp} value={r[k]} onChange={(e) => setCalibRows((rs) => rs.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                  <td style={{ padding: 2 }}><button aria-label={`Supprimer palier ${i + 1}`} onClick={() => setCalibRows((rs) => rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCalibRows((rs) => [...rs, emptyAppRow()])} style={addBtn}>+ Ajouter un palier</button>
              <button data-testid="btn-calibrer" onClick={handleCalibrage} disabled={appBusy || !projectId || !orgId}
                style={{ marginLeft: 'auto', background: appBusy ? '#cbb8b2' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontWeight: 600, cursor: appBusy ? 'wait' : 'pointer', fontSize: 13 }}>
                {appBusy ? 'Calcul…' : 'Calculer le calibrage →'}
              </button>
            </div>
          </div>
          {calibOut && Array.isArray(calibOut.rows) && calibOut.rows.length > 0 && (
            <div style={card} data-testid="calib-result">
              <div style={secH}>Coefficient de calibrage</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{['Grandeur', 'Valeur', 'Unité'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
                <tbody>{calibOut.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, textAlign: 'right' }}>{typeof row.value === 'number' ? row.value.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : row.value}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{row.unit}</td>
                  </tr>
                ))}</tbody>
              </table>
              <button data-testid="btn-appliquer-calib" onClick={applyCalibrage} style={{ marginTop: 12, background: '#2e7d4f', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Appliquer a dans l’appareillage
              </button>
            </div>
          )}
        </>
      )}

      {appError && (tab === 'etalonnage' || tab === 'calibrage') && (
        <div style={{ ...card, background: '#f8e7e2', borderColor: '#e0bdb3', color: '#8a2d20' }} role="alert">{appError}</div>
      )}

      {tab === 'log' && (
        <div style={card}>
          <div style={secH}>Coupe de sondage — sondage carotté (NF EN ISO 22475-1)</div>
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 10, lineHeight: 1.6 }}>
            Coupe du sondage carotté (profondeurs en m / TN). Dénomination sol &amp; roche (ISO 14688-1 / 14689-1),
            état (ISO 14688-2). <b>Prél.</b> = catégorie A/B/C · <b>Qual.</b> = classe 1–5 · <b>RQD</b> = récupération de carotte (%).
            Section documentaire (non consommée par le calcul).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['De (m)', 'À (m)', 'Nature (14688/89)', 'État (14688-2)', 'Prél.', 'Qual.', 'RQD %', 'Description', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{logLayers.map((ly, i) => (
                <tr key={i}>
                  {(['de', 'a', 'nature', 'etat', 'prel', 'qual', 'rqd', 'desc'] as const).map((k) => (
                    <td key={k} style={{ padding: 2 }}><input style={inp} value={ly[k]} onChange={(e) => setLogLayers((ls) => ls.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>
                  ))}
                  <td style={{ padding: 2 }}><button onClick={() => setLogLayers((ls) => ls.length <= 1 ? ls : ls.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button onClick={() => setLogLayers((ls) => [...ls, emptyLayer()])} style={addBtn}>+ Ajouter une couche</button>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>La coupe est saisie pour le rapport ; sa reprise dans le PV scellé nécessite un champ dédié côté serveur (à câbler).</div>
        </div>
      )}

      {tab === 'mesures' && (
        <>
          <div style={card}>
            <div style={secH}>Phase pseudo-élastique — seuils p₀ / p_f ({d.label})</div>
            <p style={{ fontSize: 11, color: MUTED, marginBottom: 10, lineHeight: 1.6 }}>
              La courbe de fluage Δ60/30 est plate sur la zone pseudo-élastique. <strong>p₀</strong> = début de la zone plate,
              <strong> p_f</strong> = fin (remontée du fluage). E_M est calculé entre p₀ et p_f. « Auto » laisse le moteur choisir.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 560 }}>
              <div>
                <label style={lbl}>🔵 p₀ — début zone plate (pseudo-élastique)</label>
                <select style={inp} value={d.pf_idx} onChange={(e) => patchDepth({ pf_idx: parseInt(e.target.value, 10) })} data-testid="sel-p0">
                  <option value={-1}>Auto (détermination moteur)</option>
                  {seuilOptions.map((o) => <option key={o.i} value={o.i}>Palier {o.i + 1} — P = {o.p} bar</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>🔴 p_f — fin zone plate (fluage)</label>
                <select style={inp} value={d.plm_idx} onChange={(e) => patchDepth({ plm_idx: parseInt(e.target.value, 10) })} data-testid="sel-pf">
                  <option value={-1}>Auto (détermination moteur)</option>
                  {seuilOptions.map((o) => <option key={o.i} value={o.i}>Palier {o.i + 1} — P = {o.p} bar</option>)}
                </select>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={secH}>Paliers de mesure (≥ 4 valides) — {d.label}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['P (bar)', 'V à 15 s', 'V à 30 s', 'V à 60 s', 'Δ60/30', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.rows.map((r, i) => (
                <tr key={i}>
                  {(['p', 'v15', 'v30', 'v60'] as const).map((k) => <td key={k} style={{ padding: 2 }}><input style={inp} value={r[k]} onChange={(e) => setRows((a2) => a2.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q))} /></td>)}
                  <td style={{ padding: '2px 6px', fontSize: 11.5, color: MUTED, textAlign: 'right', minWidth: 48 }}>{num(r.v60) && num(r.v30) ? (num(r.v60) - num(r.v30)).toFixed(1) : ''}</td>
                  <td style={{ padding: 2 }}><button onClick={() => setRows((a2) => a2.length <= 1 ? a2 : a2.filter((_, j) => j !== i))} style={delBtn}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={() => setRows((a2) => [...a2, { p: '', v15: '', v30: '', v60: '' }])} style={addBtn}>+ Ajouter un palier</button>
            <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Δ60/30 = fluage (V₆₀−V₃₀) ; sa remontée repère la pression de fluage p_f.</div>
          </div>
        </>
      )}

      {tab === 'resultats' && (
        <div style={card} data-testid="resultats">
          {!output ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Sélectionnez un sondage et cliquez sur <strong>Dépouiller</strong> pour obtenir p_L, E_M, α, E_y et la classification.</div>
          ) : (
            <>
              <div style={secH}>Courbe pressiométrique — {d.label}</div>
              <PressioCurve rows={d.rows} pL={pLBar} />
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

      {tab === 'profil' && (
        <div style={card} data-testid="profil">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={secH}>Profil en profondeur — dépouillement de toutes les profondeurs</div>
            <button onClick={handleProfil} disabled={profiling || !projectId || !orgId} data-testid="btn-profil"
              style={{ marginLeft: 'auto', background: profiling ? '#cbb8b2' : ACCENT, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontWeight: 600, cursor: profiling ? 'wait' : 'pointer', fontSize: 13 }}>
              {profiling ? 'Calcul du profil…' : 'Calculer le profil →'}
            </button>
          </div>
          <p style={{ fontSize: 10.5, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>Chaque profondeur (≥ 4 paliers valides) est dépouillée côté serveur puis triée par profondeur croissante.</p>
          {profil.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: MUTED }}>Saisissez plusieurs profondeurs (barre ci-dessus) puis cliquez sur <strong>Calculer le profil</strong>.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Prof. (m)', 'E_M (MPa)', 'p_L (MPa)', 'p_f* (MPa)', 'E_M/p_L*', 'α', 'Catégorie'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', borderBottom: `1px solid ${LINE}` }}>{h}</th>)}</tr></thead>
              <tbody>{profil.map((r, i) => (
                <tr key={i} data-testid={`profil-row-${i}`}>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, fontWeight: 600 }}>{r.z.toLocaleString('fr-FR')}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{r.EM?.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{r.pL_MPa?.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{r.pf_MPa?.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{r.ratio?.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{r.alpha?.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED }}>{r.categorie ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
