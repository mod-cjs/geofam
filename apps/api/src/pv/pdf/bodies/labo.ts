/**
 * FAC-SIMILÉ du PROCÈS-VERBAL D'ESSAI natif FASTLAB (moteur `labo-classification-gtr`,
 * essais de labo + classification GTR NF P 11-300) — décision titulaire 18/07 : le PV
 * scellé reproduit le rapport que l'outil client IMPRIME (`printPV` + `buildPVChrome` de
 * packages/engines/reference/FASTLAB7.html), qui est LUI-MÊME intitulé « PROCÈS-VERBAL
 * D'ESSAI » et qui est un document MULTI-FICHES : une fiche détaillée par onglet d'essai
 * RENSEIGNÉ, précédée de l'identification de l'échantillon et suivie de la synthèse +
 * classification GTR + visa de l'ingénieur.
 *
 * Le PV précédent (`buildLaboBody` inline dans pv-pdf.ts) ne rendait qu'UNE table GTR
 * plate + un vidage de paramètres — très en-dessous du rapport natif (audit : divergence
 * la plus flagrante). Ce corps rétablit, dans l'ORDRE DES ONGLETS de l'outil (ordre DOM
 * = ordre d'impression via `querySelectorAll('.tab.pv-show')`) :
 *   ident → teneur en eau → granulo → Atterberg → VBS → ρs → Proctor → CBR → œdomètre →
 *   compression simple → triaxial UU → triaxial CU/CD → perméabilité → équivalent de sable
 *   → Los Angeles → fragmentation SZ → micro-Deval → ρ/absorption granulats → sulfates →
 *   cisaillement direct → masse volumique apparente → SYNTHÈSE & CLASSIFICATION GTR + visa.
 *
 * La sortie serveur `LaboOutputSchema` porte DÉJÀ le détail par ligne de chaque essai
 * (merge « fastlab-detail-complet » : `detail.<essai>` = colonnes calculées par ligne +
 * agrégats) : on rend une fiche par essai PRÉSENT dans `detail` (présence = contenu réel,
 * les sous-objets `detail.w/ucs/…` étant toujours émis même vides — cf. engine.ts).
 *
 * CONFIDENTIALITÉ (DoD §8) — lecture par clés NOMMÉES uniquement (fail-closed). Les
 * RÉSULTATS de labo + la classe GTR sont le LIVRABLE de l'essai, PAS une méthode
 * confidentielle (contrairement aux moteurs de dimensionnement) : la sortie a déjà été
 * whitelistée par `LaboOutputSchema` au calcul, puis figée dans input_canonical au
 * scellement — le PDF NE RE-RÉDIGE PAS, il consomme. SEUL le CHEMIN DE DÉCISION GTR
 * (`classe.path` / `desc` / `rNote` / `mfq` / caveats) passe par une ALLOWLIST FAIL-CLOSED
 * (gabarits de seuils NF P 11-300 PUBLICS ; slots contraints à des NOMBRES / CODES) —
 * INVARIANT §8 (avis ingenieur-securite) : un libellé injecté portant un coefficient ne
 * matche AUCUN gabarit et n'est donc jamais imprimé. Ces helpers dupliquent VERBATIM ceux
 * de pv-pdf.ts (aucun affaiblissement).
 *
 * Chrome GEOFAM, référentiel NF P 11-300 (+ norme d'essai par fiche, comme l'en-tête de
 * chaque onglet client). JAMAIS AGEROUTE, JAMAIS le brand ROADSEN dans le corps.
 */
import type { Content, TableCell } from 'pdfmake/interfaces';

import type { SealedContent } from '../pv-pdf';
import { COLORS, FINE_TABLE_LAYOUT } from '../pv-pdf.theme';

// ---------------------------------------------------------------------------
// Helpers de formatage — typographie maison fr-FR (séparateur décimal « , »),
// fail-closed « — » sur une valeur non finie (jamais de « NaN » / « [object
// Object] » dans un PV scellé).
// ---------------------------------------------------------------------------

/** Nombre fini ou null (la sortie scellée est déjà typée numérique par le schéma Zod). */
function fin(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Formatte à `d` décimales fixes, fr-FR (clamp anti « -0,00 »), « — » si non fini. */
function num(v: unknown, d = 2, unit?: string): string {
  let n = fin(v);
  if (n === null) return '—';
  if (Math.abs(n) < 0.5 / Math.pow(10, d)) n = 0;
  const s = n
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/[\u202f\u00a0]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}

/** Notation SCIENTIFIQUE fr-FR — miroir de `k.toExponential(2)` (perméabilité ~1e-9). */
function sci(v: unknown, unit?: string): string {
  const n = fin(v);
  if (n === null) return '—';
  const s = n.toExponential(2).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Sous-objet `detail.<key>` lu par clé nommée (fail-closed) — {} si absent/non-objet. */
function det(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const d = isPlainObject(o.detail) ? o.detail : {};
  const s = d[key];
  return isPlainObject(s) ? s : {};
}

/** Tableau d'objets d'une sous-clé (filtre les non-objets). */
function rows(o: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const a = o[key];
  return Array.isArray(a) ? a.filter(isPlainObject) : [];
}

/** Chaîne de métadonnée d'identification : trimée si string, sinon '' (fail-closed). */
function metaStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** YYYY-MM-DD → DD/MM/YYYY — miroir de `pvFmtDate` de l'outil client. */
function pvFmtDate(v: unknown): string {
  const s = metaStr(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

// ---------------------------------------------------------------------------
// Blocs de présentation communs.
// ---------------------------------------------------------------------------

/** En-tête de section (MAJUSCULE inter-lettré maison). */
function section(label: string): Content {
  return { text: label.toUpperCase(), style: 'section', margin: [0, 14, 0, 6] };
}

/** En-tête d'une FICHE d'essai : titre + « Essai réalisé conformément à la norme … »
 *  (miroir du bandeau `pvh-sub` + `pvh-norm` de `buildPVChrome`). */
function ficheHead(title: string, norme: string): Content {
  return {
    stack: [
      { text: title.toUpperCase(), style: 'section', margin: [0, 14, 0, 1] },
      {
        text: `Essai réalisé conformément à la norme ${norme}`,
        fontSize: 8,
        italics: true,
        color: COLORS.muted,
        margin: [0, 0, 0, 4],
      },
    ],
  };
}

/** Sous-titre de groupe (miroir des `.grp`). */
function subTitle(label: string): Content {
  return { text: label, style: 'groupRow', margin: [0, 8, 0, 3] };
}

/** Cellule d'en-tête de table. */
function head(text: string, align: 'left' | 'right' = 'left'): TableCell {
  return { text, style: 'tableHead', alignment: align };
}

/** Cellule de donnée alignée à droite. */
function cell(text: string): TableCell {
  return { text, style: 'cell', alignment: 'right' };
}

/** Ajoute une ligne (label / valeur) à un corps KV si la valeur n'est pas « — ». */
function kvRow(body: TableCell[][], label: string, value: string): void {
  if (value === '—' || value === '') return;
  body.push([
    { text: label, style: 'cell' },
    { text: value, style: 'cell', alignment: 'right' },
  ]);
}

/** Rend un tableau KV (Paramètre / Valeur) si ≥ 1 ligne de donnée. */
function pushKv(body: Content[], t: TableCell[][]): void {
  if (t.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
}

/** Bandeau d'analyse (extraction / classification, sans verdict de conformité). */
function analyseBanner(): Content {
  return {
    margin: [0, 10, 0, 6],
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: 'Résultat d’analyse — extraction / classification (sans verdict de conformité)',
            color: COLORS.textSec2,
            fontSize: 9,
            fillColor: COLORS.groupFill,
            margin: [12, 7, 12, 7],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

// ===========================================================================
// INVARIANT §8 — ALLOWLIST FAIL-CLOSED du chemin de décision GTR.
// Dupliqué VERBATIM de pv-pdf.ts (avis ingenieur-securite) : seuls les libellés
// matchant un gabarit CONNU (seuils NF P 11-300 PUBLICS + valeurs déjà exposées)
// sont affichés ; les slots sont contraints à des NOMBRES / CODES → un coefficient
// injecté ne matche pas. `warn` (note de maturité C1/C2) n'est jamais imprimé au PV.
// ===========================================================================
const LABO_PV_N = '\\d[\\d.,\\u202f]*';
const LABO_PV_C = '[A-D0-9?]{1,6}';
const LABO_PV_ST = '[a-zàâéèêîïôûç]{1,4}';

// Allowlist des DESCRIPTIONS de sous-classe (NF P 11-300, statiques) — miroir du front.
const LABO_PV_DESCS: ReadonlySet<string> = new Set([
  'Limons peu plastiques, loess, sables fins argileux, arènes',
  'Sables fins argileux, limons, argiles peu plastiques',
  'Argiles et argiles marneuses, limons très plastiques',
  'Argiles très plastiques',
  'Sables silteux',
  'Sables argileux (peu argileux)',
  'Graves silteuses',
  'Graves argileuses (peu argileuses)',
  'Sables et graves très silteux',
  'Sables et graves argileux à très argileux',
  "Sables propres insensibles à l'eau",
  "Graves propres insensibles à l'eau",
  'Matériaux grossiers insensibles',
  'Gros éléments — comportement régi par le squelette',
  'Gros éléments — comportement régi par la fraction 0/50',
]);
const LABO_PV_DESC_C =
  /^Gros éléments — comportement régi par (?:le squelette|la fraction 0\/50)(?: · 0\/50 type (?:D1|D2))?$/;
function safeLaboDescPv(desc: unknown): string {
  if (typeof desc !== 'string') return '';
  const t = desc.trim();
  return LABO_PV_DESCS.has(t) || LABO_PV_DESC_C.test(t) ? t : '';
}
const LABO_PV_PATH_PATTERNS: readonly RegExp[] = [
  new RegExp(`^Dmax = ${LABO_PV_N} mm > ${LABO_PV_N} mm → famille C\\.$`),
  new RegExp(
    `^Fraction 0/50 reclassée → ${LABO_PV_C} \\(essais à réaliser sur le 0/50\\)\\.$`,
  ),
  new RegExp(
    `^Passant 80µm = ${LABO_PV_N} % ≤ ${LABO_PV_N} % et VBS = ${LABO_PV_N} ≤ ${LABO_PV_N} → insensible → famille D\\.$`,
  ),
  new RegExp(`^Passant 2mm = ${LABO_PV_N} % → ${LABO_PV_C}\\.$`),
  new RegExp(
    `^Passant 80µm = ${LABO_PV_N} % > ${LABO_PV_N} % → sol fin → famille A\\.$`,
  ),
  new RegExp(`^Ip = ${LABO_PV_N} \\(préférentiel\\) → ${LABO_PV_C}\\.$`),
  new RegExp(`^Ip absent → VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_PV_N} % ≤ ${LABO_PV_N} % → famille B\\.$`),
  new RegExp(
    `^Passant 2mm = ${LABO_PV_N} % \\((?:sables|graves)\\), VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`,
  ),
  new RegExp(
    `^Passant 80µm entre ${LABO_PV_N}–${LABO_PV_N} %, VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`,
  ),
  new RegExp(
    `^État hydrique ${LABO_PV_ST} \\((?:forcé|wn/wOPN = ${LABO_PV_N})\\) → ${LABO_PV_C}(?: ${LABO_PV_ST})?\\.$`,
  ),
  /^Famille D insensible : pas d'indice d'état\.$/,
];
function safeLaboPathPv(path: unknown): string[] {
  if (!Array.isArray(path)) return [];
  const out: string[] = [];
  for (const s of path) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t && LABO_PV_PATH_PATTERNS.some((re) => re.test(t))) out.push(t);
  }
  return out;
}

// Qualificatif du module de finesse (SABLES) — ensemble FERMÉ produit par l'outil client.
const LABO_MFQ_ALLOWED: ReadonlySet<string> = new Set(['très fin', 'idéal', 'grossier']);
function safeLaboMfqPv(mfq: unknown): string {
  if (typeof mfq !== 'string') return '';
  const t = mfq.trim();
  return LABO_MFQ_ALLOWED.has(t) ? t : '';
}

// Assistant famille R (rocheux) — famille géologique R1–R6 + LA/MDE. Fail-closed.
const LABO_RNOTE_PATTERNS: readonly RegExp[] = [
  /^Famille géologique : R[1-6]$/,
  /^LA=\d+(?:[.,]\d+)?$/,
  /^MDE=\d+(?:[.,]\d+)?$/,
];
function safeLaboRNotePv(rNote: unknown): string {
  if (!Array.isArray(rNote)) return '';
  const out: string[] = [];
  for (const s of rNote) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t && LABO_RNOTE_PATTERNS.some((re) => re.test(t))) out.push(t);
  }
  return out.join(' · ');
}

// Points à vérifier (`caveats` du moteur, whitelistés au sceau) — chaînes non vides.
function safeCaveatsPv(caveats: unknown): string[] {
  if (!Array.isArray(caveats)) return [];
  const out: string[] = [];
  for (const s of caveats) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t) out.push(t);
  }
  return out;
}

// ===========================================================================
// EN-TÊTE & IDENTIFICATION (miroir de `buildPVChrome` : bandeau + méta échantillon).
// ===========================================================================

/** En-tête « PROCÈS-VERBAL D'ESSAI » — chrome GEOFAM + référentiel de synthèse. */
function buildEntete(input: Record<string, unknown>): Content {
  const lab = metaStr(input.m_labo) || 'Laboratoire d’essais';
  const client = metaStr(input.m_client);
  return {
    stack: [
      {
        text: 'FASTLAB — procès-verbal d’essais de laboratoire',
        fontSize: 11,
        bold: true,
        color: COLORS.navy,
      },
      {
        text: `${lab} · Classification GTR — NF P 11-300 · GEOFAM${client ? ` · Client : ${client}` : ''}`,
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [0, 8, 0, 2],
  };
}

/** Fiche d'identification de l'échantillon (miroir de la méta `pvh-meta` du client). */
function buildIdentification(input: Record<string, unknown>): Content[] {
  const t: TableCell[][] = [[head('Identification'), head('Valeur', 'right')]];
  kvRow(t, 'Projet', metaStr(input.m_chantier));
  kvRow(t, 'N° dossier', metaStr(input.m_dossier));
  kvRow(t, 'Réf. / Sondage', metaStr(input.m_ref));
  kvRow(t, 'Point kilométrique', metaStr(input.m_pk));
  kvRow(t, 'Profondeur', metaStr(input.m_prof));
  kvRow(t, 'Date de prélèvement', pvFmtDate(input.m_date));
  kvRow(t, 'Date d’essai', pvFmtDate(input.m_dessai));
  kvRow(t, 'Opérateur', metaStr(input.m_op));
  kvRow(t, 'Nature du matériau', metaStr(input.m_nature));
  kvRow(t, 'Observations', metaStr(input.m_obs));
  if (t.length <= 1) return [];
  const out: Content[] = [section('Identification de l’échantillon')];
  pushKv(out, t);
  return out;
}

/** Bloc de visa de l'ingénieur (miroir du `pvf-sig` du client) — si renseigné. */
function buildVisa(input: Record<string, unknown>): Content[] {
  const ing = metaStr(input.m_ing);
  if (!ing) return [];
  return [
    {
      margin: [0, 16, 0, 0],
      stack: [
        {
          text: 'L’ingénieur chargé de l’étude',
          fontSize: 8,
          color: COLORS.muted,
        },
        {
          text: ing,
          fontSize: 10,
          bold: true,
          color: COLORS.text,
          margin: [0, 10, 0, 0],
        },
      ],
    },
  ];
}

// ===========================================================================
// FICHES D'ESSAI — une par onglet renseigné, dans l'ORDRE DOM de l'outil client.
// Chaque builder renvoie [] si l'essai n'est pas renseigné (présence = contenu réel).
// ===========================================================================

/** Teneur en eau — NF EN ISO 17892-1. */
function ficheW(o: Record<string, unknown>): Content[] {
  const d = det(o, 'w');
  const n = fin(d.n) ?? 0;
  if (n <= 0) return [];
  const out: Content[] = [ficheHead('Teneur en eau', 'NF EN ISO 17892-1')];
  const t: TableCell[][] = [[head('Prise'), head('w (%)', 'right')]];
  (Array.isArray(d.rows) ? d.rows : []).forEach((w, i) => {
    if (fin(w) === null) return;
    t.push([{ text: `Prise ${i + 1}`, style: 'cell' }, cell(num(w, 2))]);
  });
  pushKv(out, t);
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Teneur en eau naturelle w_n', num(o.wn ?? d.moy, 1, '%'));
  pushKv(out, kv);
  return out;
}

/** Analyse granulométrique — NF EN ISO 17892-4 / EN 933-1. */
function ficheGran(o: Record<string, unknown>): Content[] {
  const d = det(o, 'gran');
  const gr = rows(d, 'rows');
  const hasPts = Array.isArray(d.pts) && d.pts.length > 0;
  const hasRow = gr.some((r) => fin(r.cum) !== null);
  if (!hasPts && !hasRow) return [];
  const out: Content[] = [
    ficheHead('Analyse granulométrique', 'NF EN ISO 17892-4 / EN 933-1'),
  ];
  const t: TableCell[][] = [
    [head('Tamis (mm)', 'right'), head('Refus cumulé (g)', 'right'), head('Passant (%)', 'right')],
  ];
  for (const r of gr) {
    if (fin(r.cum) === null && fin(r.pass) === null) continue;
    t.push([cell(num(r.s, 2)), cell(num(r.cum, 0)), cell(num(r.pass, 1))]);
  }
  pushKv2(out, t, ['*', 'auto', 'auto']);
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Dmax', num(o.dmax, 0, 'mm'));
  kvRow(kv, 'Passant à 80 µm', num(o.p80, 0, '%'));
  kvRow(kv, 'Passant à 2 mm', num(o.p2, 0, '%'));
  kvRow(kv, "Coefficient d'uniformité Cu", num(o.Cu, 1));
  kvRow(kv, 'Coefficient de courbure Cc', num(o.Cc, 2));
  const mfV = num(o.mf, 2);
  const mfq = safeLaboMfqPv(o.mfq);
  kvRow(kv, 'Module de finesse', mfV !== '—' && mfq ? `${mfV} (${mfq})` : mfV);
  pushKv(out, kv);
  return out;
}

/** Limites d'Atterberg — NF P 94-051. */
function ficheAtt(o: Record<string, unknown>): Content[] {
  const d = det(o, 'att');
  const points = fin(d.points) ?? 0;
  const plw = Array.isArray(d.plw) ? d.plw.filter((x) => fin(x) !== null) : [];
  if (points <= 0 && plw.length === 0 && fin(o.wl) === null) return [];
  const out: Content[] = [ficheHead("Limites d'Atterberg", 'NF P 94-051')];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Limite de liquidité w_L', num(o.wl, 0, '%'));
  kvRow(kv, 'Limite de plasticité w_P', num(o.wp, 0, '%'));
  kvRow(kv, 'Indice de plasticité I_P', num(o.ip, 0));
  kvRow(kv, 'Indice de consistance I_C', num(o.ic, 2));
  pushKv(out, kv);
  // Nature vis-à-vis de la ligne A (readout « Nature » de l'onglet Atterberg).
  const nature = typeof o.natureLigneA === 'string' ? o.natureLigneA : '';
  if (nature) {
    out.push({
      text: `Nature (diagramme de plasticité) : ${nature}`,
      style: 'cellMuted',
      margin: [0, 0, 0, 4],
    });
  }
  return out;
}

/** Valeur de bleu de méthylène (VBS) — NF P 94-068. */
function ficheVbs(o: Record<string, unknown>): Content[] {
  const d = det(o, 'vbs');
  const essais = fin(d.essais) ?? 0;
  if (essais <= 0 && fin(d.manual) === null) return [];
  const out: Content[] = [
    ficheHead('Valeur de Bleu de méthylène (VBS)', 'NF P 94-068'),
  ];
  const vr = rows(d, 'rows');
  if (vr.length > 0) {
    const t: TableCell[][] = [
      [head('Essai', 'right'), head('M1 (g)', 'right'), head('Mb (g)', 'right'), head('VBS 0/5', 'right'), head('VBS sol', 'right')],
    ];
    vr.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.M1, 1)), cell(num(r.Mb, 1)), cell(num(r.v05, 2)), cell(num(r.vs, 2))]);
    });
    pushKv2(out, t, ['auto', '*', '*', '*', '*']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'VBS retenue', num(o.vbs ?? d.retenue, 2));
  pushKv(out, kv);
  return out;
}

/** Masse volumique des particules solides ρs — NF EN ISO 17892-3. */
function ficheRhos(o: Record<string, unknown>): Content[] {
  const d = det(o, 'rhos');
  const essais = fin(d.essais) ?? 0;
  if (essais <= 0) return [];
  const out: Content[] = [
    ficheHead('Masse volumique des particules solides ρs', 'NF EN ISO 17892-3'),
  ];
  const rr = rows(d, 'rows');
  if (rr.length > 0) {
    const t: TableCell[][] = [
      [head('Détermination', 'right'), head('m_d (g)', 'right'), head('ρs (Mg/m³)', 'right')],
    ];
    rr.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.md, 2)), cell(num(r.rs, 3))]);
    });
    pushKv2(out, t, ['*', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Masse volumique des grains ρs', num(o.rhos ?? d.mean, 3, 'Mg/m³'));
  pushKv(out, kv);
  return out;
}

/** Essai Proctor — NF EN 13286-2. */
function ficheProctor(o: Record<string, unknown>): Content[] {
  const d = det(o, 'proctor');
  const points = fin(d.points) ?? 0;
  if (points <= 0) return [];
  const out: Content[] = [ficheHead('Essai Proctor', 'NF EN 13286-2')];
  const pr = rows(d, 'rows');
  if (pr.length > 0) {
    const t: TableCell[][] = [
      [head('Point', 'right'), head('w (%)', 'right'), head('ρd (t/m³)', 'right')],
    ];
    pr.forEach((r, i) => {
      if (fin(r.w) === null && fin(r.rd) === null) return;
      t.push([cell(String(i + 1)), cell(num(r.w, 1)), cell(num(r.rd, 3))]);
    });
    pushKv2(out, t, ['*', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Teneur en eau optimale w_OPN', num(o.wopn ?? d.wopn, 1, '%'));
  kvRow(kv, 'Densité sèche maximale ρd;max', num(o.rdmax ?? d.rdmax, 3, 't/m³'));
  pushKv(out, kv);
  return out;
}

/** Indice CBR — NF P 94-078. */
function ficheCbr(o: Record<string, unknown>): Content[] {
  const d = det(o, 'cbr');
  const moules = fin(d.moules) ?? 0;
  if (moules <= 0) return [];
  const out: Content[] = [ficheHead('Indice CBR', 'NF P 94-078')];
  const cr = rows(d, 'rows');
  if (cr.length > 0) {
    const t: TableCell[][] = [
      [head('Coups', 'right'), head('ρd (t/m³)', 'right'), head('Compacité (%)', 'right'), head('CBR 2,5', 'right'), head('CBR 5', 'right'), head('CBR maxi', 'right')],
    ];
    for (const r of cr) {
      t.push([cell(num(r.coups, 0)), cell(num(r.ds, 3)), cell(num(r.comp, 1)), cell(num(r.c25, 0)), cell(num(r.c5, 0)), cell(num(r.maxi, 0))]);
    }
    pushKv2(out, t, ['auto', '*', '*', '*', '*', '*']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  const ipi = o.cbrType === 'ipi';
  kvRow(kv, ipi ? 'IPI (Indice Portant Immédiat)' : 'Indice CBR', num(o.cbr ?? d.icbr, 0));
  kvRow(kv, 'Compacité cible', num(d.cible, 0, '%'));
  kvRow(kv, 'Gonflement', num(o.gonfl ?? d.gonfl, 1, '%'));
  pushKv(out, kv);
  return out;
}

/** Essai œdométrique par paliers — NF EN ISO 17892-5. */
function ficheOedo(o: Record<string, unknown>): Content[] {
  const d = det(o, 'oedo');
  const points = fin(d.points) ?? 0;
  const paliers = rows(d, 'paliers');
  if (points <= 0 && paliers.length === 0) return [];
  const out: Content[] = [
    ficheHead('Essai œdométrique par paliers', 'NF EN ISO 17892-5'),
  ];
  if (paliers.length > 0) {
    const t: TableCell[][] = [
      [head('Palier', 'right'), head('Hf (mm)', 'right'), head('ε_v (%)', 'right'), head('e', 'right')],
    ];
    paliers.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.Hf, 3)), cell(num(r.ev, 2)), cell(num(r.e, 3))]);
    });
    pushKv2(out, t, ['auto', '*', '*', '*']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Indice des vides initial e₀', num(o.e0_oedo ?? d.e0, 3));
  kvRow(kv, 'Indice de compression Cc', num(o.Cc_oedo ?? d.Cc, 3));
  kvRow(kv, 'Indice de gonflement Cs', num(o.Cs_oedo ?? d.Cs, 3));
  pushKv(out, kv);
  return out;
}

/** Compression simple (Rc / cu) — NF EN ISO 17892-7. */
function ficheUcs(o: Record<string, unknown>): Content[] {
  const d = det(o, 'ucs');
  if (fin(d.qu) === null && fin(o.qu) === null) return [];
  const out: Content[] = [
    ficheHead('Compression simple (Rc / cu)', 'NF EN ISO 17892-7'),
  ];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Résistance à la compression simple q_u', num(o.qu ?? d.qu, 2, 'MPa'));
  kvRow(kv, 'Cohésion non drainée cu = qu/2', num(d.cu, 1, 'kPa'));
  pushKv(out, kv);
  return out;
}

/** Triaxial UU — NF EN ISO 17892-8. */
function ficheTriuu(o: Record<string, unknown>): Content[] {
  const d = det(o, 'triuu');
  const n = fin(d.eprouvettes) ?? 0;
  if (n <= 0) return [];
  const out: Content[] = [ficheHead('Triaxial UU', 'NF EN ISO 17892-8')];
  const tr = rows(d, 'rows');
  if (tr.length > 0) {
    const t: TableCell[][] = [
      [head('Éprouvette', 'right'), head('σ1 (kPa)', 'right'), head('cu (kPa)', 'right')],
    ];
    tr.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.s1, 1)), cell(num(r.cu, 1))]);
    });
    pushKv2(out, t, ['*', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Cohésion non drainée cu (UU)', num(o.cu_uu ?? d.cu_uu, 1, 'kPa'));
  pushKv(out, kv);
  return out;
}

/** Triaxial CU / CD — NF EN ISO 17892-9. */
function ficheTricu(o: Record<string, unknown>): Content[] {
  const d = det(o, 'tricu');
  const n = fin(d.eprouvettes) ?? 0;
  if (n <= 0) return [];
  const out: Content[] = [ficheHead('Triaxial CU / CD', 'NF EN ISO 17892-9')];
  const tr = rows(d, 'rows');
  if (tr.length > 0) {
    const t: TableCell[][] = [
      [head('Éprouvette', 'right'), head('s (kPa)', 'right'), head('t (kPa)', 'right')],
    ];
    tr.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.s, 1)), cell(num(r.t, 1))]);
    });
    pushKv2(out, t, ['*', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, "Cohésion c' (triaxial)", num(o.c ?? d.c, 1, 'kPa'));
  kvRow(kv, "Angle de frottement φ' (triaxial)", num(o.phi ?? d.phi, 1, '°'));
  pushKv(out, kv);
  return out;
}

/** Perméabilité k — NF EN ISO 17892-11 (pas de sous-objet detail : sentinelle output.k). */
function fichePerm(o: Record<string, unknown>): Content[] {
  if (fin(o.k) === null) return [];
  const out: Content[] = [ficheHead('Perméabilité k', 'NF EN ISO 17892-11')];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Coefficient de perméabilité k', sci(o.k, 'cm/s'));
  pushKv(out, kv);
  return out;
}

/** Équivalent de sable — NF EN 933-8. */
function ficheEs(o: Record<string, unknown>): Content[] {
  const d = det(o, 'es');
  const essais = fin(d.essais) ?? 0;
  if (essais <= 0) return [];
  const out: Content[] = [ficheHead('Équivalent de sable', 'NF EN 933-8')];
  const er = rows(d, 'rows');
  if (er.length > 0) {
    const t: TableCell[][] = [[head('Essai', 'right'), head('SE (%)', 'right')]];
    er.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.se, 0))]);
    });
    pushKv2(out, t, ['*', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Équivalent de sable ES', num(o.es ?? d.es, 0, '%'));
  pushKv(out, kv);
  return out;
}

/** Los Angeles (LA) — NF EN 1097-2. */
function ficheLa(o: Record<string, unknown>): Content[] {
  const d = det(o, 'la');
  if (fin(d.la) === null && fin(o.la) === null) return [];
  const out: Content[] = [ficheHead('Los Angeles (LA)', 'NF EN 1097-2')];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Coefficient Los Angeles LA', num(o.la ?? d.la, 0));
  kvRow(kv, 'Prise M', num(d.M, 0, 'g'));
  const conf = typeof d.conformite === 'string' ? d.conformite.trim() : '';
  if (conf) kvRow(kv, 'Classe granulaire', conf);
  pushKv(out, kv);
  return out;
}

/** Fragmentation par impact (SZ) — NF EN 1097-2 §6. */
function ficheSz(o: Record<string, unknown>): Content[] {
  const d = det(o, 'sz');
  if (fin(d.sz) === null && fin(d.sumPass) === null) return [];
  const out: Content[] = [
    ficheHead('Fragmentation par impact (SZ)', 'NF EN 1097-2 §6'),
  ];
  const sr = rows(d, 'rows');
  if (sr.some((r) => fin(r.ref) !== null || fin(r.pas) !== null)) {
    const t: TableCell[][] = [
      [head('Tamis (mm)', 'right'), head('Refus (g)', 'right'), head('Passant (%)', 'right')],
    ];
    for (const r of sr) {
      if (fin(r.ref) === null && fin(r.pas) === null) continue;
      t.push([cell(num(r.s, 2)), cell(num(r.ref, 0)), cell(num(r.pas, 1))]);
    }
    pushKv2(out, t, ['*', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Fragmentation SZ', num(o.sz ?? d.sz, 0, '%'));
  pushKv(out, kv);
  return out;
}

/** Micro-Deval (MDE) — NF EN 1097-1 (mode norme ou campagne). */
function ficheMde(o: Record<string, unknown>): Content[] {
  const d = det(o, 'mde');
  if (fin(d.mde) === null && fin(o.mde) === null) return [];
  const out: Content[] = [ficheHead('Micro-Deval (MDE)', 'NF EN 1097-1')];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  if (d.mode === 'camp') {
    const pertes = Array.isArray(d.pertes) ? d.pertes : [];
    pertes.forEach((p, i) => kvRow(kv, `Perte éprouvette ${i + 1}`, num(p, 1, '%')));
    kvRow(kv, 'CMDS (sec)', num(d.cmds, 1));
    kvRow(kv, 'CMDE (humide)', num(d.cmde, 1));
    kvRow(kv, 'CMD', num(d.cmd, 1));
  } else {
    const mr = rows(d, 'rows');
    mr.forEach((r, i) => kvRow(kv, `Coefficient éprouvette ${i + 1}`, num(r.cc, 1)));
    const conf = typeof d.conformite === 'string' ? d.conformite.trim() : '';
    if (conf) kvRow(kv, 'Classe granulaire', conf);
  }
  kvRow(kv, 'Coefficient Micro-Deval MDE', num(o.mde ?? d.mde, 1));
  pushKv(out, kv);
  return out;
}

/** Masse volumique & absorption des granulats — NF EN 1097-6. */
function ficheRho(o: Record<string, unknown>): Content[] {
  const d = det(o, 'rho');
  const any =
    fin(d.ra) !== null || fin(d.rrd) !== null || fin(d.rssd) !== null || fin(d.wa) !== null;
  if (!any) return [];
  const out: Content[] = [
    ficheHead('Masse volumique & absorption des granulats', 'NF EN 1097-6'),
  ];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Masse volumique réelle ρa', num(d.ra, 3, 'Mg/m³'));
  kvRow(kv, 'Masse volumique réelle sèche ρrd', num(d.rrd, 3, 'Mg/m³'));
  kvRow(kv, 'Masse volumique saturée surface sèche ρssd', num(d.rssd, 3, 'Mg/m³'));
  kvRow(kv, "Absorption d'eau WA24", num(o.wa ?? d.wa, 1, '%'));
  pushKv(out, kv);
  return out;
}

/** Teneur en sulfates — NF EN 1744-1. */
function ficheSulf(o: Record<string, unknown>): Content[] {
  const d = det(o, 'sulf');
  if (fin(d.so3) === null && fin(o.so3) === null) return [];
  const out: Content[] = [ficheHead('Teneur en sulfates', 'NF EN 1744-1')];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Teneur en sulfates SO₃', num(o.so3 ?? d.so3, 2, '%'));
  kvRow(kv, 'Teneur en sulfates SO₄ = SO₃·1,2', num(d.so4, 2, '%'));
  pushKv(out, kv);
  return out;
}

/** Cisaillement direct (c′, φ′) — NF EN ISO 17892-10. */
function ficheCisail(o: Record<string, unknown>): Content[] {
  const d = det(o, 'cisail');
  const n = fin(d.eprouvettes) ?? 0;
  if (n <= 0) return [];
  const out: Content[] = [
    ficheHead('Cisaillement direct (c′, φ′)', 'NF EN ISO 17892-10'),
  ];
  const cr = rows(d, 'rows');
  if (cr.length > 0) {
    const t: TableCell[][] = [
      [head('Éprouvette', 'right'), head('σ′v (kPa)', 'right'), head('τ pic (kPa)', 'right'), head('τ rés. (kPa)', 'right')],
    ];
    cr.forEach((r, i) => {
      t.push([cell(String(i + 1)), cell(num(r.sv, 0)), cell(num(r.tp, 1)), cell(num(r.tr, 1))]);
    });
    pushKv2(out, t, ['*', 'auto', 'auto', 'auto']);
  }
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, "Cohésion c' (pic)", num(o.c_cis ?? d.c, 1, 'kPa'));
  kvRow(kv, "Angle de frottement φ' (pic)", num(o.phi_cis ?? d.phi, 1, '°'));
  kvRow(kv, "Angle de frottement résiduel φ'_R", num(o.phiR_cis ?? d.phiR, 1, '°'));
  pushKv(out, kv);
  return out;
}

/** Masse volumique apparente ρ — NF EN ISO 17892-2. */
function ficheDens(o: Record<string, unknown>): Content[] {
  const d = det(o, 'dens');
  if (fin(d.rho) === null && fin(d.Vcm3) === null && fin(o.rho_app) === null) return [];
  const out: Content[] = [
    ficheHead('Masse volumique apparente ρ', 'NF EN ISO 17892-2'),
  ];
  const kv: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(kv, 'Volume de l’éprouvette', num(d.Vcm3, 1, 'cm³'));
  kvRow(kv, 'Masse volumique apparente ρ', num(o.rho_app ?? d.rho, 3, 'Mg/m³'));
  kvRow(kv, 'Masse volumique sèche apparente ρd', num(o.rhod_app ?? d.rhod, 3, 'Mg/m³'));
  pushKv(out, kv);
  return out;
}

/** Rend un tableau à colonnes personnalisées si ≥ 1 ligne de donnée. */
function pushKv2(body: Content[], t: TableCell[][], widths: (string | number)[]): void {
  if (t.length > 1) {
    body.push({
      table: { headerRows: 1, widths, body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
}

// ===========================================================================
// SYNTHÈSE & CLASSIFICATION GTR (dernière fiche « class » de l'outil client).
// ===========================================================================

function buildSyntheseGTR(o: Record<string, unknown>): Content[] {
  const out: Content[] = [section('Synthèse & classification GTR (NF P 11-300)')];

  const cl = isPlainObject(o.classe) ? o.classe : {};
  const full = typeof cl.full === 'string' ? cl.full.trim() : '';
  const code =
    typeof cl.code === 'string' && cl.code.trim() !== '' ? cl.code.trim() : '';
  const classe = full || code;
  out.push({
    text: classe ? `Classe : ${classe}` : 'Classe non déterminée.',
    fontSize: classe ? 13 : 9,
    bold: !!classe,
    color: classe ? COLORS.navy : COLORS.muted,
    margin: [0, 2, 0, 3],
  });

  const desc = safeLaboDescPv(cl.desc);
  if (desc) out.push({ text: desc, style: 'cellMuted', margin: [0, 0, 0, 4] });

  // Justification du classement — chemin de décision GTR (ALLOWLIST FAIL-CLOSED §8).
  const path = safeLaboPathPv(cl.path);
  if (path.length > 0) {
    out.push(subTitle('Justification du classement'));
    path.forEach((line, i) => {
      out.push({
        text: `${i + 1}. ${line}`,
        style: 'cellMuted',
        margin: [0, 0, 0, i === path.length - 1 ? 6 : 2],
      });
    });
  }

  // Assistant famille R (rocheux) — encadré info de l'outil client (allowlisté).
  const rNote = safeLaboRNotePv(cl.rNote);
  if (rNote) {
    out.push(subTitle('Assistant famille R (rocheux)'));
    out.push({ text: rNote, style: 'cellMuted', margin: [0, 0, 0, 6] });
  }

  // Points à vérifier (caveats normatifs, whitelistés au sceau).
  const caveats = safeCaveatsPv(cl.caveats);
  if (caveats.length > 0) {
    out.push(subTitle('Points à vérifier'));
    caveats.forEach((line, i) => {
      out.push({
        text: `· ${line}`,
        style: 'cellMuted',
        margin: [0, 0, 0, i === caveats.length - 1 ? 6 : 2],
      });
    });
  }

  // Fiche de synthèse des essais — récapitulatif de TOUS les résultats client-safe
  // (miroir de la table `recap` de l'onglet « class »). Les champs non renseignés
  // (num → « — ») sont auto-supprimés par kvRow.
  const t: TableCell[][] = [[head('Paramètre'), head('Valeur', 'right')]];
  kvRow(t, 'Teneur en eau naturelle w_n', num(o.wn, 1, '%'));
  kvRow(t, 'Dmax', num(o.dmax, 0, 'mm'));
  kvRow(t, 'Passant à 80 µm', num(o.p80, 0, '%'));
  kvRow(t, 'Passant à 2 mm', num(o.p2, 0, '%'));
  kvRow(t, "Coefficient d'uniformité Cu", num(o.Cu, 1));
  kvRow(t, 'Coefficient de courbure Cc', num(o.Cc, 2));
  const mfV = num(o.mf, 2);
  const mfq = safeLaboMfqPv(o.mfq);
  kvRow(t, 'Module de finesse', mfV !== '—' && mfq ? `${mfV} (${mfq})` : mfV);
  kvRow(t, 'Limite de liquidité w_L', num(o.wl, 0, '%'));
  kvRow(t, 'Limite de plasticité w_P', num(o.wp, 0, '%'));
  kvRow(t, 'Indice de plasticité I_P', num(o.ip, 0));
  kvRow(t, 'Indice de consistance I_C', num(o.ic, 2));
  kvRow(t, 'Valeur au bleu VBS', num(o.vbs, 2));
  kvRow(t, 'Masse volumique des grains ρ_s', num(o.rhos, 2, 'Mg/m³'));
  kvRow(t, 'Masse volumique apparente ρ', num(o.rho_app, 2, 'Mg/m³'));
  kvRow(t, 'Masse volumique sèche apparente ρ_d', num(o.rhod_app, 2, 'Mg/m³'));
  kvRow(t, 'Teneur en eau optimale w_OPN', num(o.wopn, 1, '%'));
  kvRow(t, 'Densité sèche max ρ_d;max', num(o.rdmax, 2, 't/m³'));
  kvRow(t, o.cbrType === 'ipi' ? 'IPI (Indice Portant Immédiat)' : 'Indice CBR', num(o.cbr, 0));
  kvRow(t, 'Gonflement', num(o.gonfl, 1, '%'));
  kvRow(t, 'Équivalent de sable ES', num(o.es, 0, '%'));
  kvRow(t, 'Los Angeles LA', num(o.la, 0));
  kvRow(t, 'Fragmentation SZ', num(o.sz, 0, '%'));
  kvRow(t, 'Micro-Deval MDE', num(o.mde, 0));
  kvRow(t, "Absorption d'eau WA24", num(o.wa, 1, '%'));
  kvRow(t, 'Teneur en sulfates SO₃', num(o.so3, 2, '%'));
  kvRow(t, 'Résistance à la compression simple q_u', num(o.qu, 2, 'MPa'));
  kvRow(t, 'Indice des vides initial e₀', num(o.e0_oedo, 3));
  kvRow(t, 'Indice de compression Cc (œdo)', num(o.Cc_oedo, 3));
  kvRow(t, 'Indice de gonflement Cs', num(o.Cs_oedo, 3));
  kvRow(t, "Cohésion c' (cisaillement)", num(o.c_cis, 1, 'kPa'));
  kvRow(t, "Angle de frottement φ' (cisaillement)", num(o.phi_cis, 1, '°'));
  kvRow(t, "Angle de frottement résiduel φ'_R", num(o.phiR_cis, 1, '°'));
  kvRow(t, "Cohésion c' (triaxial)", num(o.c, 1, 'kPa'));
  kvRow(t, "Angle de frottement φ' (triaxial)", num(o.phi, 1, '°'));
  kvRow(t, 'Cohésion non drainée c_u (UU)', num(o.cu_uu, 1, 'kPa'));
  kvRow(t, 'Perméabilité k', sci(o.k, 'cm/s'));
  if (t.length > 1) {
    out.push(subTitle('Fiche de synthèse des essais'));
    pushKv(out, t);
  }
  return out;
}

// ===========================================================================
// CORPS DU PV LABO.
// ===========================================================================

export function buildLaboBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const body: Content[] = [];

  body.push(analyseBanner());
  body.push(buildEntete(input));
  body.push(...buildIdentification(input));

  // Fiches d'essai — ORDRE DES ONGLETS de l'outil client (ordre DOM = ordre d'impression).
  body.push(...ficheW(o));
  body.push(...ficheGran(o));
  body.push(...ficheAtt(o));
  body.push(...ficheVbs(o));
  body.push(...ficheRhos(o));
  body.push(...ficheProctor(o));
  body.push(...ficheCbr(o));
  body.push(...ficheOedo(o));
  body.push(...ficheUcs(o));
  body.push(...ficheTriuu(o));
  body.push(...ficheTricu(o));
  body.push(...fichePerm(o));
  body.push(...ficheEs(o));
  body.push(...ficheLa(o));
  body.push(...ficheSz(o));
  body.push(...ficheMde(o));
  body.push(...ficheRho(o));
  body.push(...ficheSulf(o));
  body.push(...ficheCisail(o));
  body.push(...ficheDens(o));

  // Synthèse & classification GTR (dernière fiche « class »).
  body.push(...buildSyntheseGTR(o));

  // Visa de l'ingénieur chargé de l'étude (miroir du pied de fiche du client).
  body.push(...buildVisa(input));

  return body;
}
