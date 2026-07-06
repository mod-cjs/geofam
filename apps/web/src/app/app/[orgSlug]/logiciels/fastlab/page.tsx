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
/** Éprouvette de cisaillement direct (NF EN ISO 17892-10) : forces + identification. */
interface CiSpec { N: string; P: string; R: string; rho: string; w: string; nat: string }
/** Feuille « Cisaillement direct » DÉDIÉE (ne partage RIEN avec le CBR). */
interface CisailForm { method: string; shape: string; dim: string; Ra: string; Ri: string; rs: string; specs: CiSpec[] }

// Lignes de mesure VIDES (formulaires vides par defaut — revue adverse).
const emptyW = (): WaterS => ({ t: '', h: '', s: '' });
const emptyLL = (): LLPoint => ({ x: '', t: '', h: '', s: '' });
const emptyPL = (): PLPoint => ({ t: '', h: '', s: '' });
const emptyPr = (): PrPoint => ({ mh: '', t: '', h: '', s: '' });
const emptyCi = (): CiSpec => ({ N: '', P: '', R: '', rho: '', w: '', nat: '' });
const emptyCisail = (): CisailForm => ({ method: 'box', shape: 'sq', dim: '', Ra: '', Ri: '', rs: '', specs: [emptyCi(), emptyCi(), emptyCi(), emptyCi()] });
// Toggles de METHODE/equipement uniquement (pas de mesure) — conserves par defaut.
// NB : cbType (CBR/IPI) et les toggles de cisaillement (ciMethod/ci_shape) sont
// désormais des champs de FORMULAIRE dédiés (cf. FastlabForm), plus des « extra ».
const EXTRA_TOGGLE_DEFAULTS: Record<string, string> = {
  laVar: 'std', mdeVar: 'std', mdeMode: 'norme', permMode: 'var', su_type: 'SS', rs_liq: 'water', rsMethod: 'A',
};

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
  /** Type d'essai de portance : 'cbr' (après immersion) ou 'ipi' (indice portant immédiat). */
  cbType: string;
  /** Feuille Cisaillement direct DÉDIÉE (ci_*) — indépendante du CBR. */
  cisail: CisailForm;
  /** Sections d'essais additionnelles — clés = ids moteur exacts (œdo, triaxial, ES, LA, MDE, SZ, sulfates, perméa, UCS, densités). */
  extra: Record<string, string>;
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
  // CBR/IPI — SEUL le type d'essai est un toggle (cbType) ; les mesures de portance
  // (réf. OPM, moules, poinçonnement, gonflement) sont des cb_* saisis dans `extra`.
  // AUCUN champ de cisaillement ici : le CBR ne pilote plus calcCisail (fin du misroute).
  if (f.cbType) p.cbType = f.cbType;
  // Cisaillement direct (ci_*) — essai DÉDIÉ (NF EN ISO 17892-10), sans lien avec le CBR.
  // On n'émet les entrées de cisaillement (y compris le toggle de dispositif ciMethod)
  // QUE si la feuille est réellement renseignée : une feuille intacte ne doit injecter
  // aucun ci_* (le moteur retombe de toute façon sur ciMethod='box' par défaut).
  const ci = f.cisail;
  const ciHasData = ci.dim.trim() !== '' || ci.Ra.trim() !== '' || ci.Ri.trim() !== '' || ci.rs.trim() !== '' ||
    ci.specs.some((r) => r.N.trim() !== '' || r.P.trim() !== '' || r.R.trim() !== '' || r.rho.trim() !== '' || r.w.trim() !== '' || r.nat.trim() !== '');
  if (ciHasData) {
    if (ci.method) p.ciMethod = ci.method;
    if (ci.method === 'ring') {
      if (ci.Ra) p.ci_Ra = ci.Ra;
      if (ci.Ri) p.ci_Ri = ci.Ri;
    } else {
      if (ci.shape) p.ci_shape = ci.shape;
      if (ci.dim) p.ci_dim = ci.dim;
    }
    if (ci.rs) p.ci_rs = ci.rs;
    ci.specs.forEach((r, i) => {
      const n = i + 1;
      if (r.N) p[`ci_N${n}`] = r.N;
      if (r.P) p[`ci_P${n}`] = r.P;
      if (r.R) p[`ci_R${n}`] = r.R;
      if (r.rho) p[`ci_rho${n}`] = r.rho;
      if (r.w) p[`ci_w${n}`] = r.w;
      if (r.nat) p[`ci_nat${n}`] = r.nat;
    });
  }
  // Sections additionnelles (œdo, triaxial, ES, LA, MDE, SZ, sulfates, perméa, UCS, densités)
  for (const [k, v] of Object.entries(f.extra)) if (v.trim() !== '') p[k] = v;
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

// ── Sections d'essais additionnelles (fidélité — vagues 2-4) ──────────────────
// `extra` = Record dont les CLÉS sont les ids moteur EXACTS. buildFastlabPayload les
// répand tels quels (mesures brutes, chaînes). Rendu générique data-driven.
interface ExtraField { id: string; l: string }
interface ExtraTable { title: string; cols: Array<{ prefix: string; l: string }>; rows: number }
interface ExtraSelect { id: string; l: string; opts: Array<[string, string]> }
interface ExtraSection { tab: string; label: string; title: string; norm: string; note?: string; selects?: ExtraSelect[]; groups?: Array<{ title?: string; fields: ExtraField[] }>; tables?: ExtraTable[] }

const EXTRA_SECTIONS: ExtraSection[] = [
  { tab: 'oedo', label: 'Œdomètre', title: 'Essai œdométrique par paliers', norm: 'NF EN ISO 17892-5', note: 'Donne l’indice de compression Cc et de gonflement Cs.',
    groups: [{ fields: [{ id: 'oe_H0', l: 'Hauteur initiale H₀ (mm)' }, { id: 'oe_D', l: 'Diamètre (mm)' }, { id: 'oe_md', l: 'Masse sèche (g)' }, { id: 'oe_rs', l: 'ρ_s (Mg/m³)' }] }],
    tables: [{ title: 'Paliers de chargement / déchargement', cols: [{ prefix: 'oe_s', l: 'Contrainte σ (kPa)' }, { prefix: 'oe_dh', l: 'Δh cumulé (mm)' }], rows: 9 }] },
  { tab: 'triuu', label: 'Triaxial UU', title: 'Triaxial non consolidé non drainé', norm: 'NF EN ISO 17892-8', note: 'Donne la cohésion non drainée c_u.',
    tables: [{ title: 'Éprouvettes', cols: [{ prefix: 'tu_s3_', l: 'σ₃ (kPa)' }, { prefix: 'tu_df_', l: 'Déviateur à la rupture (kPa)' }], rows: 3 }] },
  { tab: 'tricu', label: 'Triaxial CU', title: 'Triaxial consolidé (CU / CD)', norm: 'NF EN ISO 17892-9', note: 'Donne c′ et φ′ (enveloppe de rupture).',
    tables: [{ title: 'Éprouvettes', cols: [{ prefix: 'tc_s3_', l: 'σ₃ (kPa)' }, { prefix: 'tc_s1_', l: 'σ₁ à la rupture (kPa)' }], rows: 3 }] },
  { tab: 'es', label: 'Équiv. sable', title: 'Équivalent de sable (ES)', norm: 'NF EN 933-8', note: 'ES = h₂ / h₁ × 100.',
    tables: [{ title: 'Éprouvettes', cols: [{ prefix: 'es_h1_', l: 'h₁ — floculat (mm)' }, { prefix: 'es_h2_', l: 'h₂ — sédiment (mm)' }], rows: 2 }] },
  { tab: 'la', label: 'Los Angeles', title: 'Los Angeles (LA)', norm: 'NF EN 1097-2', note: 'LA = (M − m) / M × 100.',
    selects: [{ id: 'laVar', l: 'Variante', opts: [['std', 'Standard'], ['rb', 'Roches dures'], ['alt', 'Alternative']] }],
    groups: [{ fields: [{ id: 'la_M', l: 'Masse initiale M (g)' }, { id: 'la_m', l: 'Masse retenue 1,6 mm (g)' }, { id: 'la_ti', l: 'Passant initial (%)' }, { id: 'la_pi', l: 'Passant après (%)' }] }] },
  { tab: 'mde', label: 'Micro-Deval', title: 'Micro-Deval (MDE)', norm: 'NF EN 1097-1', note: 'MDE = (M − m) / M × 100 (moyenne des déterminations).',
    selects: [{ id: 'mdeVar', l: 'Variante', opts: [['std', 'Standard'], ['rb', 'Roches'], ['alt', 'Alt.']] }, { id: 'mdeMode', l: 'Mode', opts: [['norme', 'Normalisé'], ['camp', 'Campagne']] }],
    tables: [{ title: 'Déterminations', cols: [{ prefix: 'md_M', l: 'Masse initiale M (g)' }, { prefix: 'md_m', l: 'Retenu 1,6 mm m (g)' }], rows: 2 }] },
  { tab: 'sz', label: 'Fragmentation', title: 'Fragmentation par impact (SZ)', norm: 'NF EN 1097-2 §6',
    groups: [{ fields: [{ id: 'sz_M', l: 'Masse M (g)' }, { id: 'sz_8', l: 'Refus 8 mm (g)' }, { id: 'sz_5', l: 'Refus 5 mm (g)' }, { id: 'sz_2', l: 'Refus 2 mm (g)' }, { id: 'sz_0_63', l: 'Refus 0,63 mm (g)' }, { id: 'sz_0_2', l: 'Refus 0,2 mm (g)' }] }] },
  { tab: 'sulf', label: 'Sulfates', title: 'Teneur en sulfates', norm: 'NF EN 1744-1',
    selects: [{ id: 'su_type', l: 'Type', opts: [['SS', 'Solubles dans l’eau'], ['AS', 'Solubles à l’acide']] }],
    groups: [{ fields: [{ id: 'su_M', l: 'Prise M (g)' }, { id: 'su_ba', l: 'Masse BaSO₄ (g)' }, { id: 'su_f', l: 'Facteur de conversion' }] }] },
  { tab: 'perm', label: 'Perméabilité', title: 'Perméabilité k', norm: 'NF EN ISO 17892-11', note: 'Charge variable : k = (a·L)/(A·t) · ln(h₁/h₂).',
    selects: [{ id: 'permMode', l: 'Mode', opts: [['var', 'Charge variable'], ['const', 'Charge constante']] }],
    groups: [{ title: 'Charge variable', fields: [{ id: 'pe_a', l: 'Section tube a (cm²)' }, { id: 'pe_Av', l: 'Section éprouvette A (cm²)' }, { id: 'pe_Lv', l: 'Longueur L (cm)' }, { id: 'pe_h1', l: 'Charge h₁ (cm)' }, { id: 'pe_h2', l: 'Charge h₂ (cm)' }, { id: 'pe_tv', l: 'Temps (s)' }] }] },
  { tab: 'ucs', label: 'Compression', title: 'Compression simple (Rc)', norm: 'NF EN ISO 17892-7', note: 'q_u = F / A.',
    groups: [{ fields: [{ id: 'uc_d', l: 'Diamètre (mm)' }, { id: 'uc_h', l: 'Hauteur (mm)' }, { id: 'uc_f', l: 'Force max (kN)' }, { id: 'uc_dl', l: 'Déformation à rupture (mm)' }] }] },
  { tab: 'dens', label: 'Densités', title: 'Masses volumiques (ρ, ρ_s)', norm: 'NF EN ISO 17892-2/3',
    selects: [{ id: 'rsMethod', l: 'Méthode ρ_s', opts: [['A', 'Méthode A'], ['B', 'Méthode B']] }, { id: 'rs_liq', l: 'Liquide', opts: [['water', 'Eau distillée'], ['other', 'Autre (ρ saisie)']] }],
    groups: [{ title: 'Conditions ρ_s', fields: [{ id: 'rs_T', l: 'Température (°C)' }, { id: 'rs_rL', l: 'ρ liquide (auto si eau)' }] }, { title: 'Apparente ρ (éprouvette prismatique)', fields: [{ id: 'd_L', l: 'Longueur (mm)' }, { id: 'd_W', l: 'Largeur (mm)' }, { id: 'd_H', l: 'Hauteur (mm)' }, { id: 'd_m', l: 'Masse (g)' }, { id: 'd_w', l: 'Teneur en eau (%)' }] }],
    tables: [{ title: 'ρ_s — pycnomètre (déterminations)', cols: [{ prefix: 'rs2_m0_', l: 'Pycno vide m₀ (g)' }, { prefix: 'rs2_m1_', l: 'Pycno + eau m₁ (g)' }, { prefix: 'rs2_mx_', l: 'Pycno + sol mₓ (g)' }, { prefix: 'rs2_m3_', l: 'Pycno + sol + eau m₃ (g)' }], rows: 2 }] },
];


/** Rendu générique d'une section d'essai additionnelle (data-driven). */
function ExtraView({ s, extra, setExtra }: { s: ExtraSection; extra: Record<string, string>; setExtra: (u: (p: Record<string, string>) => Record<string, string>) => void }) {
  const set = (id: string, v: string) => setExtra((p) => ({ ...p, [id]: v }));
  return (
    <div style={card}>
      <div style={secH}>{s.title} — {s.norm}</div>
      {s.selects && s.selects.length > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          {s.selects.map((sl) => (
            <div key={sl.id}><label style={lbl}>{sl.l}</label>
              <select style={{ ...inp, width: 200 }} value={extra[sl.id] ?? sl.opts[0]?.[0] ?? ''} onChange={(e) => set(sl.id, e.target.value)}>
                {sl.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {s.groups?.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 12 }}>
          {g.title && <div style={{ ...lbl, fontSize: 11, color: ACCENT, marginBottom: 8 }}>{g.title}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {g.fields.map((f) => (
              <div key={f.id}><label style={lbl}>{f.l}</label><input style={inp} value={extra[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} /></div>
            ))}
          </div>
        </div>
      ))}
      {s.tables?.map((t, ti) => (
        <div key={ti} style={{ marginBottom: 12 }}>
          <div style={{ ...lbl, fontSize: 11, color: ACCENT, marginBottom: 8 }}>{t.title}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr><th style={th}>#</th>{t.cols.map((c) => <th key={c.prefix} style={th}>{c.l}</th>)}</tr></thead>
            <tbody>{Array.from({ length: t.rows }, (_, i) => i + 1).map((n) => (
              <tr key={n}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{n}</td>
                {t.cols.map((c) => { const id = `${c.prefix}${n}`; return <td key={c.prefix} style={{ padding: 2 }}><input style={inp} value={extra[id] ?? ''} onChange={(e) => set(id, e.target.value)} /></td>; })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {s.note && <div style={{ marginTop: 6, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>{s.note}</div>}
    </div>
  );
}

export default function FastlabPage() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [, setEnt] = useState<EntitlementsResponse | null>(null);

  // FORMULAIRES VIDES par defaut (revue adverse) : aucune mesure d'exemple pre-remplie
  // -> pas de PV scelle sur des donnees fictives. On conserve uniquement l'equipement et
  // les toggles de methode (moule, type d'essai, variantes) via EXTRA_DEFAULTS/consts.
  const [ident, setIdent] = useState<Record<string, string>>({});
  const [water, setWater] = useState<WaterS[]>([emptyW(), emptyW(), emptyW()]);
  const [gr_M, setGrM] = useState('');
  const [sieves, setSieves] = useState<Record<string, string>>({});
  const [ll, setLl] = useState<LLPoint[]>([emptyLL(), emptyLL(), emptyLL(), emptyLL()]);
  const [pl, setPl] = useState<PLPoint[]>([emptyPL(), emptyPL()]);
  const [vbs, setVbs] = useState<Record<string, string>>({});
  const [prMould, setPrMould] = useState('A');
  const [prType, setPrType] = useState('n');
  const [prPoints, setPrPoints] = useState<PrPoint[]>([emptyPr(), emptyPr(), emptyPr(), emptyPr(), emptyPr()]);
  const [cbType, setCbType] = useState('cbr');
  const [cisail, setCisail] = useState<CisailForm>(emptyCisail());
  const [extra, setExtra] = useState<Record<string, string>>({ ...EXTRA_TOGGLE_DEFAULTS });

  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);
  const [tab, setTab] = useState<string>('ident');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => { const lb = projs.filter((p) => p.domain === 'LB'); setProjects(lb); setEnt(ent); if (lb.length === 1) setProjectId(lb[0].id); })
      .catch(() => {});
  }, [orgId]);

  const buildPayload = useCallback(() => buildFastlabPayload({
    ident: { ...ident, geo: ident.geo ?? '' }, water, gr_M, sieves, ll, pl,
    vbs, prMould, prType, prPoints, cbType, cisail, extra,
  }), [ident, water, gr_M, sieves, ll, pl, vbs, prMould, prType, prPoints, cbType, cisail, extra]);

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
        {([
          ['ident', 'Identification'], ['eau', 'Eau & granulométrie'], ['atterberg', 'Limites d’Atterberg'],
          ['vbs', 'Bleu (VBS)'], ['proctor', 'Proctor'], ['cbr', 'CBR / IPI'], ['cisail', 'Cisaillement'],
          ...EXTRA_SECTIONS.map((s) => [s.tab, s.label] as [string, string]),
          ['resultat', 'Classe GTR'],
        ] as Array<[string, string]>).map(([id, t]) => (
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
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Type d’essai</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['cbr', 'CBR — après immersion (4 j)'], ['ipi', 'IPI — indice portant immédiat']] as const).map(([v, l]) => (
                <button key={v} data-testid={`cbtype-${v}`} aria-pressed={cbType === v} onClick={() => setCbType(v)}
                  style={{ border: `1px solid ${cbType === v ? ACCENT : LINE}`, background: cbType === v ? '#eef1df' : '#fff', color: cbType === v ? ACCENT : MUTED, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={secH}>Référence Proctor (OPM)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            {([['cb_ydmax', 'ρ_d max OPM (Mg/m³) — vide = Proctor'], ['cb_wopt', 'w_OPM (%) — vide = Proctor'], ['cb_cible', 'Compacité cible (% OPM)'], ['cb_s25', 'Force réf. 2,5 mm (kN)'], ['cb_s5', 'Force réf. 5 mm (kN)'], ['cb_K', 'Constante anneau K']] as const).map(([id, l]) => (
              <div key={id}><label style={lbl}>{l}</label><input style={inp} value={extra[id] ?? ''} onChange={(e) => setExtra((p) => ({ ...p, [id]: e.target.value }))} /></div>
            ))}
          </div>
          <div style={secH}>Poinçonnement CBR — moules compactés (55 / 25 / 10 coups)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Moule', 'Masse tot. (g)', 'Masse moule (g)', 'Volume (cm³)', 'w (%)', 'Force 2,5 mm', 'Force 5 mm', 'H₀ (mm)', 'Gonfl. (mm)'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{([[0, '55 coups'], [1, '25 coups'], [2, '10 coups']] as const).map(([m, lab]) => (
              <tr key={m}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{lab}</td>
                {[`cb_tot${m}`, `cb_moule${m}`, `cb_vol${m}`, `cb_w${m}`, `cb_pen_${m}_6`, `cb_pen_${m}_9`, `cb_H0${m}`, `cb_gonf${m}`].map((id) => <td key={id} style={{ padding: 2 }}><input style={{ ...inp, padding: '5px 6px' }} value={extra[id] ?? ''} onChange={(e) => setExtra((p) => ({ ...p, [id]: e.target.value }))} /></td>)}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>Les forces de poinçonnement à 2,5 et 5 mm (colonnes 6-7) déterminent l’indice ; le gonflement n’est rapporté qu’en mode CBR (après immersion). L&apos;indice CBR/IPI caractérise la portance du sol support.</div>
        </div>
      )}

      {tab === 'cisail' && (
        <div style={card}>
          <div style={secH}>Cisaillement direct — NF EN ISO 17892-10</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
            <div><label style={lbl}>Dispositif</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {([['box', 'Boîte de cisaillement'], ['ring', 'Anneau (annulaire)']] as const).map(([v, l]) => (
                  <button key={v} data-testid={`cimethod-${v}`} aria-pressed={cisail.method === v} onClick={() => setCisail((c) => ({ ...c, method: v }))}
                    style={{ border: `1px solid ${cisail.method === v ? ACCENT : LINE}`, background: cisail.method === v ? '#eef1df' : '#fff', color: cisail.method === v ? ACCENT : MUTED, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{l}</button>
                ))}
              </div>
            </div>
            <div><label style={lbl}>ρ_s grains (Mg/m³)</label><input style={{ ...inp, width: 150 }} value={cisail.rs} onChange={(e) => setCisail((c) => ({ ...c, rs: e.target.value }))} /></div>
          </div>
          {cisail.method === 'box' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div><label style={lbl}>Forme éprouvette</label><select style={inp} value={cisail.shape} onChange={(e) => setCisail((c) => ({ ...c, shape: e.target.value }))}><option value="sq">Carrée</option><option value="circ">Circulaire</option></select></div>
              <div><label style={lbl}>Côté / Ø (mm)</label><input style={inp} value={cisail.dim} onChange={(e) => setCisail((c) => ({ ...c, dim: e.target.value }))} /></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div><label style={lbl}>Rayon extérieur R_a (mm)</label><input style={inp} value={cisail.Ra} onChange={(e) => setCisail((c) => ({ ...c, Ra: e.target.value }))} /></div>
              <div><label style={lbl}>Rayon intérieur R_i (mm)</label><input style={inp} value={cisail.Ri} onChange={(e) => setCisail((c) => ({ ...c, Ri: e.target.value }))} /></div>
            </div>
          )}
          <div style={secH}>Éprouvettes (≥ 3 contraintes normales)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['#', cisail.method === 'box' ? 'Force verticale N (kN)' : 'Force verticale N (kN)', cisail.method === 'box' ? 'Cisaill. pic P (kN)' : 'Couple pic Mₜ (N·m)', cisail.method === 'box' ? 'Cisaill. résiduel (kN)' : 'Couple résiduel Mₜ (N·m)', 'ρ (kg/m³)', 'w (%)', 'Nature'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{cisail.specs.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 2, color: MUTED, fontSize: 11 }}>{i + 1}</td>
                {(['N', 'P', 'R', 'rho', 'w', 'nat'] as const).map((k) => (
                  <td key={k} style={{ padding: 2 }}><input style={{ ...inp, padding: '5px 6px', textAlign: k === 'nat' ? 'left' : undefined }} value={r[k]} onChange={(e) => setCisail((c) => ({ ...c, specs: c.specs.map((q, j) => j === i ? { ...q, [k]: e.target.value } : q) }))} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>L’enveloppe de Mohr-Coulomb (régression σ′_v ↔ τ) donne la cohésion c′ et l’angle de frottement φ′ ; la colonne « résiduel » alimente φ′_R. Résultats affichés après calcul.</div>
        </div>
      )}

      {EXTRA_SECTIONS.map((s) => (tab === s.tab ? <ExtraView key={s.tab} s={s} extra={extra} setExtra={setExtra} /> : null))}

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
