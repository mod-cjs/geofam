import { PIEUX_DEFAULT_COEFFS } from '@roadsen/engines';
import type { Content, TableCell } from 'pdfmake/interfaces';

import { COLORS, FINE_TABLE_LAYOUT } from '../pv-pdf.theme';
// Type-only import (erasé au build -> aucun cycle runtime avec pv-pdf.ts, qui
// importe `buildFonProfondeBody` de ce module). Source unique de la signature :
// le contrat de rendu vit dans pv-pdf.ts et ne doit jamais dériver.
import type { SealedContent } from '../pv-pdf';

/**
 * FAC-SIMILÉ de la note native `renderResults` (casagrande_V5.html) — décision
 * titulaire 18/07 : le PV scellé du moteur PIEUX (fondation profonde) reproduit
 * SECTION PAR SECTION le rapport que l'outil client imprime (PV == écran ==
 * rapport client). Le CLONE (apps/web) reconstruit `R` depuis la SORTIE SERVEUR
 * whitelistée (`PieuxOutputSchema`) puis rejoue `renderResults` ; ce corps pdfmake
 * fait de MÊME : il rejoue l'ordre et les libellés de `renderResults` à partir de la
 * même sortie whitelistée et des efforts SAISIS (input.c_G / input.c_Q). Aucune
 * science côté serveur PDF : on consomme les grandeurs déjà calculées et déjà
 * whitelistées.
 *
 * Sections reproduites (ordre de `renderResults`) :
 *   0. avertissements (native `notice`, en tête)
 *   1. verdict de portance (« Portance vérifiée / NON vérifiée » + taux gouvernant,
 *      méthode, sens, approche EC7)
 *   2. indicateurs clés (KPI grid : R_b, R_s, R_c;d en MN, tassement ELS en mm)
 *   3. caractéristiques du pieu (échos d'entrée whitelistés)
 *   4. paramètres réglementaires EC7 / NF P 94-262 (traçabilité des choix publics)
 *   5. résistances (table 3 colonnes R_m brut / R_k caract. / R_d calcul) + encart ξ
 *   6. vérifications par état-limite (F_d / R_d / taux / verdict)
 *   7. frottement latéral par couche (fric[] : cote, ép. mob., q_s, R_s,i) — AJOUTÉ
 *   8. synthèse géométrique (D, D_ef, couche porteuse, γ_R;d1, C_e, charge de fluage) — AJOUTÉ
 *   9. frottement négatif (downdrag, #94) si calculé
 *  10. vérification structurale du béton (#95) selon betonApplicable
 *
 * Branding GEOFAM (porté par en-tête/pied du document) ; référentiel NF P 94-262 —
 * JAMAIS « AGEROUTE » (norme chaussée) ni « ROADSEN » (marque interne) sur un PV
 * de fondation.
 *
 * CONFIDENTIALITÉ (DoD §8) : lecture par clés NOMMÉES uniquement (fail-closed) ; la
 * sortie est déjà whitelistée par `PieuxOutputSchema` au calcul. « Défaut NON pieux » :
 * les grandeurs affichées par l'outil mais NON whitelistées (R_b;d / R_s;d par terme,
 * aire de pointe A_b / périmètre, a / b et zone d'influence de pointe, classe /
 * abréviation de catégorie) ne sont PAS exposées ici — rendues « — » (comme le clone)
 * ou omises. Les rouvrir = décision gouvernée (expert + titulaire).
 */

// ---------------------------------------------------------------------------
// Libellés (miroir de l'outil client)
// ---------------------------------------------------------------------------

const PIEUX_METH: Record<string, string> = {
  pmt: 'Pressiomètre Ménard (PMT)',
  cpt: 'Pénétromètre statique (CPT)',
  cphi: 'Paramètres de laboratoire (c–φ)',
};
/** Adjectif de méthode pour la ligne de verdict (miroir de `renderResults`). */
const PIEUX_METH_ADJ: Record<string, string> = {
  pmt: 'pressiométrique',
  cpt: 'pénétrométrique',
  cphi: 'c-φ',
};
const PIEUX_SENS: Record<string, string> = {
  comp: 'Compression',
  trac: 'Traction',
};

/** Libellés de nature de sol — MIROIR EXACT de `SOILS[*].label` de l'outil client. */
const PIEUX_SOIL_LABEL: Record<string, string> = {
  argile: 'Argile / Limon',
  sable: 'Sable / Grave',
  craie: 'Craie',
  marne: 'Marne / M-calc.',
  roche: 'Roche altérée',
};

// TRANSPARENCE réglementaire (feature d'intégrité, avis expert-genie-civil) : les
// facteurs partiels EC7 sont des choix RÉGLEMENTAIRES PUBLICS (EN 1990 /
// NF P 94-262) ajustables par le BE. On ne les fige pas, on les TRACE sur le PV
// scellé. AUCUN calage confidentiel (kp/kc/α) n'apparaît ici.
const PIEUX_DA_LABEL: Record<string, string> = {
  da1: 'DA1',
  da2: 'DA2 (NA France)',
  da3: 'DA3',
};

/**
 * Coefficients partiels tracés SEULEMENT s'ils s'écartent du défaut (choix
 * explicite du BE) — ordre normatif, libellés EN 1990 / NF P 94-262. ψ₂ (k_psi2)
 * est TOUJOURS affiché (non universel : dépend de la catégorie d'action) donc
 * traité à part, hors de cette liste.
 */
const PIEUX_COEFF_LABELS: ReadonlyArray<
  [keyof typeof PIEUX_DEFAULT_COEFFS, string]
> = [
  ['k_gG', 'γG (permanente défavorable)'],
  ['k_gQ', 'γQ (variable défavorable)'],
  ['k_gb', 'γb (pointe, R2)'],
  ['k_gs', 'γs (frottement, R2)'],
  ['k_gst', 'γs;t (traction, R2)'],
  ['cr_b_b', 'Rc;cr;k coef. Rb;k, pieu refoulant'],
  ['cr_b_s', 'Rc;cr;k coef. Rs;k, pieu refoulant'],
  ['cr_f_b', 'Rc;cr;k coef. Rb;k, pieu foré'],
  ['cr_f_s', 'Rc;cr;k coef. Rs;k, pieu foré'],
  ['cr_car', 'coef. fluage ELS caractéristique (compression)'],
  ['cr_qp', 'γ fluage ELS q.perm. (compression)'],
  ['cr_car_t', 'γs;cr ELS caract. (traction)'],
  ['cr_qp_t', 'γs;cr ELS q.perm. (traction)'],
];

/**
 * Allowlist fail-closed du libellé de vérification pieux au PV (miroir serveur de
 * `safePieuxVerifLabel` côté front). Le PV est la surface la PLUS sensible (scellée,
 * remise au client) : le `nom` de vérification (texte libre borné en longueur mais PAS
 * en contenu par CheckSchema) ne s'imprime que s'il est reconnu (état-limite +
 * combinaison EC7 whitelistés), sinon libellé générique indexé.
 */
const PV_PIEUX_ELS_LABELS: ReadonlySet<string> = new Set([
  'ELS caractéristique',
  'ELS quasi-permanent',
]);
const PV_PIEUX_ELU_PREFIXES: ReadonlySet<string> = new Set([
  'ELU portance',
  'ELU traction',
]);
const PV_PIEUX_ELU_COMBOS: ReadonlySet<string> = new Set([
  'DA1·C1',
  'DA1·C2',
  'DA2',
  'DA3',
]);
function safePieuxVerifLabel(rawNom: unknown, index: number): string {
  const fallback = `Vérification ${index}`;
  if (typeof rawNom !== 'string') return fallback;
  if (PV_PIEUX_ELS_LABELS.has(rawNom)) return rawNom;
  const sep = rawNom.indexOf(' — ');
  if (sep > 0) {
    const prefix = rawNom.slice(0, sep);
    const combo = rawNom.slice(sep + 3);
    if (PV_PIEUX_ELU_PREFIXES.has(prefix) && PV_PIEUX_ELU_COMBOS.has(combo))
      return rawNom;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Helpers LOCAUX (fac-similé du dépouillement client)
// ---------------------------------------------------------------------------

/** Parse tolérant FR — MIROIR du `num()` de l'outil client (number|string → number/NaN). */
function pieuxNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
  const x = Number(s);
  return Number.isFinite(x) ? x : NaN;
}

/**
 * Formatte à `d` décimales fixes, fr-FR — MIROIR EXACT du `fmt(v,d)` de l'outil
 * client (`(v==null||isNaN(v))?'—':v.toLocaleString('fr-FR',{min:d,max:d})`). Les
 * espaces fines/insécables sont normalisées pour un rendu PDF stable. « — » si non fini.
 */
function pieuxFmt(v: unknown, d = 0): string {
  const x = pieuxNum(v);
  if (!Number.isFinite(x)) return '—';
  return x
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/\s/g, ' ');
}

/** `pieuxFmt` + unité accolée (« X kN ») ; « — » nu si valeur non finie. */
function pieuxUnit(v: unknown, d: number, unit: string): string {
  const s = pieuxFmt(v, d);
  return s === '—' ? s : `${s} ${unit}`;
}

/** Coercition texte sûre : string tel quel, sinon « — » (jamais « [object Object] »). */
function pieuxText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '—';
}

function pieuxIsObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** En-tête de section (miroir de `sectionTitle` maison : MAJUSCULE inter-lettré). */
function pieuxSection(label: string): Content {
  return { text: label.toUpperCase(), style: 'section', margin: [0, 16, 0, 6] };
}

/** En-tête de colonne de table. */
function pieuxHead(
  text: string,
  align: 'left' | 'right' | 'center' = 'left',
): TableCell {
  return { text, style: 'tableHead', alignment: align };
}

/** Cellule verdict ✓/✗ colorée (miroir des classes `.pass`/`.fail`). */
function pieuxVerdictCell(ok: boolean): TableCell {
  return {
    text: ok ? '✓ OK' : '✗ NON',
    style: 'cell',
    alignment: 'center',
    bold: true,
    color: ok ? COLORS.navy : COLORS.alert,
  };
}

/**
 * Bandeau de verdict de portance — MIROIR de la `div.verdict` de `renderResults` :
 * « Portance vérifiée / NON vérifiée » + « Taux de travail le plus défavorable : X %
 * · pieu <méthode> en <sens> · approche DA n ». Couleur pilotée par `allOk`.
 */
function buildPieuxVerdictBanner(
  allOk: boolean,
  taux: unknown,
  methode: string,
  sens: string,
  da: string,
): Content {
  const methAdj = PIEUX_METH_ADJ[methode] ?? methode;
  const sensAdj = sens === 'trac' ? 'traction' : 'compression';
  // MIROIR : `R.da.toUpperCase().replace('DA','DA ')` -> « da2 » => « DA 2 ».
  const daLbl = da ? da.toUpperCase().replace('DA', 'DA ') : '—';
  return {
    margin: [0, 10, 0, 6],
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              {
                text: allOk ? 'Portance vérifiée' : 'Portance NON vérifiée',
                color: COLORS.white,
                bold: true,
                fontSize: 12,
              },
              {
                text: `Taux de travail le plus défavorable : ${pieuxFmt(pieuxNum(taux) * 100, 0)} % · pieu ${methAdj} en ${sensAdj} · approche ${daLbl}`,
                color: COLORS.white,
                fontSize: 8.5,
                margin: [0, 2, 0, 0],
              },
            ],
            fillColor: allOk ? COLORS.navy : COLORS.alert,
            margin: [12, 8, 12, 8],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

/**
 * Section « Paramètres réglementaires (EC7 / NF P 94-262) » — TRACABILITÉ des choix
 * réglementaires PUBLICS depuis l'ENTRÉE scellée (`input.coeffs` + `input.da`) :
 *  - TOUJOURS : l'approche de calcul (da) + ψ₂ (k_psi2, non universel) ;
 *  - les AUTRES coeffs UNIQUEMENT s'ils diffèrent de PIEUX_DEFAULT_COEFFS.
 * FAIL-CLOSED : coeffs/da absents -> aucune section (jamais de crash / section vide).
 */
function buildPieuxReglementaires(input: Record<string, unknown>): Content[] {
  const coeffs = pieuxIsObj(input.coeffs) ? input.coeffs : null;
  const da = typeof input.da === 'string' ? input.da : null;
  if (coeffs === null && da === null) return [];

  const rows: TableCell[][] = [
    [pieuxHead('Paramètre'), pieuxHead('Valeur', 'right')],
  ];
  const row = (p: string, val: string): void => {
    rows.push([
      { text: p, style: 'cell' },
      { text: val, style: 'cell', alignment: 'right' },
    ]);
  };

  if (da !== null) row('Approche de calcul EC7', PIEUX_DA_LABEL[da] ?? da);

  if (coeffs !== null) {
    const psi2 = pieuxFmt(coeffs.k_psi2, 2);
    if (psi2 !== '—') row('ψ₂ (quasi-permanent)', psi2);
    for (const [key, label] of PIEUX_COEFF_LABELS) {
      const v = coeffs[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v === PIEUX_DEFAULT_COEFFS[key]) continue;
      row(label, pieuxFmt(v, 2));
    }
  }

  if (rows.length <= 1) return [];
  return [
    pieuxSection('Paramètres réglementaires (EC7 / NF P 94-262)'),
    {
      table: { headerRows: 1, widths: ['*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    },
  ];
}

// ---------------------------------------------------------------------------
// Corps « fondation profonde » (pieux / NF P 94-262, EC7)
// ---------------------------------------------------------------------------

export function buildFonProfondeBody(sealed: SealedContent): Content[] {
  const output = pieuxIsObj(sealed.output) ? sealed.output : {};
  const input = pieuxIsObj(sealed.input) ? sealed.input : {};
  const body: Content[] = [];

  const methode = pieuxText(output.methode);
  const sens = pieuxText(output.sens);
  const da = typeof input.da === 'string' ? input.da : '';
  const allOk = output.allOk === true;

  // 0) Avertissements — MIROIR de la `div.notice` en TÊTE de `renderResults`.
  const warns = Array.isArray(output.warnings) ? output.warnings : [];
  if (warns.length > 0) {
    body.push({
      text: warns.map((x) => `⚠ ${String(x)}`).join('\n'),
      style: 'cellMuted',
      color: COLORS.accent,
      margin: [0, 8, 0, 0],
    });
  }

  // 1) Bandeau de verdict de portance (miroir de `div.verdict`).
  body.push(
    buildPieuxVerdictBanner(allOk, output.tauxGouvernant, methode, sens, da),
  );

  // En-tête de la note (miroir du chrome de l'outil client CASAGRANDE).
  const methLib = PIEUX_METH_ADJ[methode]
    ? `méthode ${PIEUX_METH_ADJ[methode]}`
    : 'méthode de portance';
  body.push({
    stack: [
      {
        text: 'Casagrande — note de calcul',
        fontSize: 11,
        bold: true,
        color: COLORS.navy,
      },
      {
        text: `Fondation profonde · ${methLib} · NF P 94-262`,
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [0, 8, 0, 2],
  });

  // 2) Indicateurs clés — MIROIR du `kpi-grid` (R_b / R_s / R_c;d en MN, tassement mm).
  body.push(pieuxSection('Indicateurs clés'));
  const kpi: TableCell[][] = [
    [pieuxHead('Grandeur'), pieuxHead('Valeur', 'right'), pieuxHead('Détail')],
  ];
  const kpiRow = (label: string, val: string, sub: string): void => {
    if (val === '—') return;
    kpi.push([
      { text: label, style: 'cell', bold: true },
      { text: val, style: 'cell', alignment: 'right' },
      { text: sub, style: 'cellMuted' },
    ]);
  };
  // Sous-texte de R_b : p*le / kp (pmt) ou q_ce / kc (cpt) — valeurs whitelistées
  // (miroir du sous-texte KPI du clone, qui remplace la chaîne `qbDetail` serveur).
  let rbSub = 'résistance de pointe';
  if (methode === 'pmt' && pieuxFmt(output.ple, 2) !== '—') {
    rbSub = `p*le = ${pieuxFmt(output.ple, 2)} MPa`;
    if (pieuxFmt(output.kfac, 2) !== '—')
      rbSub += ` · kp = ${pieuxFmt(output.kfac, 2)}`;
    if (pieuxFmt(output.kmax, 2) !== '—')
      rbSub += ` · kp,max = ${pieuxFmt(output.kmax, 2)}`;
  } else if (methode === 'cpt' && pieuxFmt(output.qce, 2) !== '—') {
    rbSub = `qce = ${pieuxFmt(output.qce, 2)} MPa`;
    if (pieuxFmt(output.kfac, 2) !== '—')
      rbSub += ` · kc = ${pieuxFmt(output.kfac, 2)}`;
  }
  // « sur X m de fût » = D − z0 (D whitelisté ; z0 = input.g_z0 saisi).
  const D = pieuxNum(output.D);
  const z0 = pieuxNum(input.g_z0);
  const futLen = Number.isFinite(D) && Number.isFinite(z0) ? D - z0 : NaN;
  const rsSub = Number.isFinite(futLen)
    ? `sur ${pieuxFmt(futLen, 1)} m de fût`
    : 'frottement latéral';
  kpiRow('R_b — pointe', pieuxUnit(pieuxNum(output.Rb) / 1000, 2, 'MN'), rbSub);
  kpiRow(
    'R_s — frottement',
    pieuxUnit(pieuxNum(output.Rs) / 1000, 2, 'MN'),
    rsSub,
  );
  kpiRow(
    'R_c;d — calcul ELU',
    pieuxUnit(pieuxNum(output.RcD) / 1000, 2, 'MN'),
    'après γ_b, γ_s, ξ',
  );
  kpiRow(
    'Tassement (ELS car.)',
    pieuxUnit(output.tassementELS, 1, 'mm'),
    'Frank & Zhao',
  );
  if (kpi.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['auto', 'auto', '*'], body: kpi },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 3) Caractéristiques du pieu (échos d'entrée whitelistés).
  body.push(pieuxSection('Caractéristiques du pieu'));
  const geo: TableCell[][] = [
    [pieuxHead('Paramètre'), pieuxHead('Valeur', 'right')],
  ];
  const kv = (p: string, val: string): void => {
    geo.push([
      { text: p, style: 'cell' },
      { text: val, style: 'cell', alignment: 'right' },
    ]);
  };
  kv('Diamètre / largeur B', pieuxUnit(output.B, 2, 'm'));
  kv('Profondeur de base D', pieuxUnit(output.D, 2, 'm'));
  kv('Catégorie de pieu', pieuxFmt(output.categorie, 0));
  kv('Méthode de portance', PIEUX_METH[methode] ?? methode);
  kv('Sens de sollicitation', PIEUX_SENS[sens] ?? sens);
  body.push({
    table: { headerRows: 1, widths: ['*', 'auto'], body: geo },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // 4) Paramètres réglementaires EC7/NF P 94-262 (traçabilité des choix publics).
  body.push(...buildPieuxReglementaires(input));

  // 5) Résistances — MIROIR de la table 3 colonnes (R_m brut / R_k caract. / R_d calcul).
  //    « Défaut NON pieux » : R_b;d et R_s;d PAR TERME ne sont pas whitelistés -> « — »
  //    (comme le clone). Seule la résistance de calcul TOTALE R_c;d est exposée.
  body.push(pieuxSection('Résistances'));
  const rb = pieuxNum(output.Rb);
  const rs = pieuxNum(output.Rs);
  const rcTotBrut = Number.isFinite(rb) && Number.isFinite(rs) ? rb + rs : NaN;
  const resHead: TableCell[] = [
    pieuxHead('Terme'),
    pieuxHead('Brut R_m (kN)', 'right'),
    pieuxHead('Caract. R_k (kN)', 'right'),
    pieuxHead('Calcul R_d (kN)', 'right'),
  ];
  const resRow = (
    lbl: string,
    brut: string,
    kar: string,
    dcalc: string,
    bold = false,
  ): TableCell[] => [
    { text: lbl, style: 'cell', bold },
    { text: brut, style: 'cell', alignment: 'right', bold },
    { text: kar, style: 'cell', alignment: 'right', bold },
    { text: dcalc, style: 'cell', alignment: 'right', bold },
  ];
  const res: TableCell[][] = [
    resHead,
    resRow('Pointe R_b', pieuxFmt(output.Rb, 0), pieuxFmt(output.RbK, 0), '—'),
    resRow(
      'Frottement R_s',
      pieuxFmt(output.Rs, 0),
      pieuxFmt(output.RsK, 0),
      '—',
    ),
    resRow(
      'Total R_c',
      pieuxFmt(rcTotBrut, 0),
      pieuxFmt(output.RcK, 0),
      pieuxFmt(output.RcD, 0),
      true,
    ),
    resRow('Charge fluage R_c;cr;k', pieuxFmt(output.RcrK, 0), '', '—'),
  ];
  body.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: res,
    },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });
  // Encart ξ₃/ξ₄ + γ_R;d1 — MIROIR du `.hint` sous la table Résistances.
  const xi3 = pieuxFmt(output.xi3, 2);
  const xi4 = pieuxFmt(output.xi4, 2);
  if (xi3 !== '—' || xi4 !== '—') {
    const N = pieuxNum(input.o_nprofil);
    const S = pieuxNum(input.o_surf);
    const redis = input.o_redis === 'oui';
    const parts: string[] = [`ξ₃ = ${xi3} · ξ₄ = ${xi4}`];
    if (Number.isFinite(N) && Number.isFinite(S)) {
      const sqrt = Math.sqrt(S / 2500);
      parts.push(
        `(N = ${pieuxFmt(N, 0)} profil${N > 1 ? 's' : ''} · S = ${pieuxFmt(S, 0)} m² → √(S/2500) = ${pieuxFmt(sqrt, 2)}${redis ? ' · ÷1,1 redistribution' : ''})`,
      );
    }
    const grd = pieuxFmt(output.gammaRd1, 2);
    if (grd !== '—') parts.push(`γ_R;d1 = ${grd}`);
    body.push({
      text: parts.join(' '),
      style: 'cellMuted',
      margin: [0, 0, 0, 4],
    });
  }

  // 6) Vérifications par état-limite — MIROIR de la table « Vérifications »
  //    (F_d / R_d / taux / verdict). Libellé whitelisté (allowlist fail-closed).
  body.push(pieuxSection('Vérifications'));
  const verHead: TableCell[] = [
    pieuxHead('État-limite'),
    pieuxHead('F_d (kN)', 'right'),
    pieuxHead('R_d (kN)', 'right'),
    pieuxHead('Taux', 'right'),
    pieuxHead('Vérif.', 'center'),
  ];
  const ver: TableCell[][] = [verHead];
  const verifs = Array.isArray(output.verifications)
    ? output.verifications
    : [];
  let vi = 0;
  for (const v of verifs) {
    if (!pieuxIsObj(v)) continue;
    vi += 1;
    const fd = pieuxNum(v.Fd);
    const rd = pieuxNum(v.Rd);
    // Taux : préfère le champ serveur `taux` (whitelisté), sinon Fd/Rd (miroir native).
    const taux = Number.isFinite(pieuxNum(v.taux))
      ? pieuxNum(v.taux)
      : rd !== 0
        ? fd / rd
        : NaN;
    const ok = v.ok === true;
    ver.push([
      { text: safePieuxVerifLabel(v.nom, vi), style: 'cell' },
      { text: pieuxFmt(v.Fd, 0), style: 'cell', alignment: 'right' },
      { text: pieuxFmt(v.Rd, 0), style: 'cell', alignment: 'right' },
      {
        text: Number.isFinite(taux) ? `${pieuxFmt(taux * 100, 0)} %` : '—',
        style: 'cell',
        alignment: 'right',
      },
      pieuxVerdictCell(ok),
    ]);
  }
  if (ver.length > 1) {
    body.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
        body: ver,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
  // Encart charges G / Q — MIROIR du `.hint` sous la table Vérifications.
  const g = pieuxFmt(input.c_G, 0);
  const q = pieuxFmt(input.c_Q, 0);
  if (g !== '—' || q !== '—') {
    body.push({
      text: `F_d = sollicitation pondérée · R_d = résistance de calcul. Charges : G = ${g} kN, Q = ${q} kN.`,
      style: 'cellMuted',
      margin: [0, 0, 0, 4],
    });
  }

  // 7) Frottement latéral par couche — MIROIR de la table « Frottement latéral par
  //    couche » (Couche / Cote / Ép. mob. / q_s / R_s,i), consommée depuis fric[].
  const fric = Array.isArray(output.fric) ? output.fric : [];
  const fricRows = fric.filter(pieuxIsObj);
  if (fricRows.length > 0) {
    body.push(pieuxSection('Frottement latéral par couche'));
    const fr: TableCell[][] = [
      [
        pieuxHead('Couche'),
        pieuxHead('Cote (m)', 'right'),
        pieuxHead('Ép. mob. (m)', 'right'),
        pieuxHead('q_s (kPa)', 'right'),
        pieuxHead('R_s,i (kN)', 'right'),
      ],
    ];
    for (const f of fricRows) {
      const soil = pieuxText(f.soil);
      fr.push([
        { text: PIEUX_SOIL_LABEL[soil] ?? soil, style: 'cell' },
        {
          text: `${pieuxFmt(f.top, 1)} – ${pieuxFmt(f.bot, 1)}`,
          style: 'cell',
          alignment: 'right',
        },
        { text: pieuxFmt(f.dz, 2), style: 'cell', alignment: 'right' },
        { text: pieuxFmt(f.qs, 0), style: 'cell', alignment: 'right' },
        { text: pieuxFmt(f.dRs, 0), style: 'cell', alignment: 'right' },
      ]);
    }
    // Ligne de total R_s (colSpan 4 + valeur) — miroir de la `tr.total`.
    fr.push([
      { text: 'Total R_s', style: 'cell', bold: true, colSpan: 4 },
      {},
      {},
      {},
      {
        text: pieuxFmt(output.Rs, 0),
        style: 'cell',
        alignment: 'right',
        bold: true,
      },
    ]);
    body.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
        body: fr,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 8) Synthèse géométrique — MIROIR de la card « Synthèse géométrique ». On rend les
  //    lignes DONT la donnée est whitelistée (D, D_ef/D_ef/B, couche porteuse dérivée du
  //    frottement, γ_R;d1, C_e, charge de fluage). Les lignes non whitelistées (section
  //    A_b / périm., zone d'influence de pointe, a / b, classe / abréviation) sont OMISES
  //    (« défaut NON pieux » — réouverture gouvernée expert + titulaire).
  const syn: TableCell[][] = [];
  const synRow = (label: string, val: string): void => {
    if (val === '—' || val === '') return;
    syn.push([
      { text: label, style: 'cell' },
      { text: val, style: 'cell', alignment: 'right' },
    ]);
  };
  synRow('Catégorie de pieu', pieuxFmt(output.categorie, 0));
  synRow('Encastrement D', pieuxUnit(output.D, 2, 'm'));
  const def = pieuxFmt(output.Def, 2);
  const debR = pieuxFmt(output.debR, 1);
  if (def !== '—')
    synRow('Encastrement équiv. D_ef', `${def} m · D_ef/B = ${debR}`);
  // Couche porteuse = nature de sol de la couche la plus profonde de l'emprise (dernière
  // ligne de fric[], whitelistée) — évite de lire `baseLayer` (non whitelisté).
  if (fricRows.length > 0) {
    const soilPorteuse = pieuxText(fricRows[fricRows.length - 1].soil);
    synRow('Couche porteuse', PIEUX_SOIL_LABEL[soilPorteuse] ?? soilPorteuse);
  }
  synRow('Coef. de modèle γ_R;d1', pieuxFmt(output.gammaRd1, 2));
  synRow('Effet de groupe C_e', pieuxFmt(output.Ce, 2));
  synRow('Charge de fluage R_c;cr;k', pieuxUnit(output.RcrK, 0, 'kN'));
  if (syn.length > 0) {
    body.push(pieuxSection('Synthèse géométrique'));
    body.push({
      table: { widths: ['*', 'auto'], body: syn },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 9) Frottement négatif (downdrag, #94) — MIROIR des KPI de `drawDowndrag` (onglet
  //    dédié de l'outil). Rendu SEULEMENT si calculé (fail-closed sinon).
  const gsn = pieuxUnit(output.Gsn, 1, 'kN');
  const nmax = pieuxUnit(output.Nmax, 1, 'kN');
  const zN = pieuxUnit(output.pointNeutre, 2, 'm');
  if (gsn !== '—' || nmax !== '—' || zN !== '—') {
    body.push(pieuxSection('Frottement négatif'));
    const fn: TableCell[][] = [
      [
        pieuxHead('Grandeur'),
        pieuxHead('Valeur', 'right'),
        pieuxHead('Détail'),
      ],
    ];
    const fnRow = (p: string, v: string, sub: string): void => {
      if (v === '—') return;
      fn.push([
        { text: p, style: 'cell' },
        { text: v, style: 'cell', alignment: 'right' },
        { text: sub, style: 'cellMuted' },
      ]);
    };
    fnRow('Effort axial max N_max', nmax, 'au point neutre');
    fnRow('Frottement négatif G_sn', gsn, 'N_max − Q');
    fnRow('Point neutre z_N', zN, 'déplacement relatif nul');
    // Tassement en tête du pieu (profil downdrag whitelisté).
    const prof = pieuxIsObj(output.profilsDowndrag)
      ? output.profilsDowndrag
      : null;
    if (prof)
      fnRow('Tassement tête pieu', pieuxUnit(prof.wHead, 1, 'mm'), 'w(z₀)');
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto', '*'], body: fn },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
    body.push({
      text: 'Le frottement négatif est une action permanente à ajouter à la charge en tête pour les vérifications (NF P 94-262, ch. 11).',
      style: 'cellMuted',
      margin: [0, 0, 0, 4],
    });
  }

  // 10) Vérification structurale du béton (#95) — MIROIR de `drawBeton`. Selon
  //     betonApplicable : table taux ELU/ELS + f_cd, ou mention de non-applicabilité.
  if (output.betonApplicable === true) {
    body.push(pieuxSection('Résistance du béton (structure)'));
    const bt: TableCell[][] = [
      [
        pieuxHead('Combinaison'),
        pieuxHead('Taux', 'right'),
        pieuxHead('Vérif.', 'center'),
      ],
    ];
    const betonRow = (p: string, taux: unknown, ok: unknown): void => {
      const n = pieuxNum(taux);
      if (!Number.isFinite(n)) return;
      const isOk = ok === true;
      bt.push([
        { text: p, style: 'cell' },
        {
          text: `${pieuxFmt(n * 100, 0)} %`,
          style: 'cell',
          alignment: 'right',
        },
        pieuxVerdictCell(isOk),
      ]);
    };
    betonRow('σ ELU = N_d/A_b', output.betonTauxELU, output.betonOkELU);
    betonRow('σ ELS car. = N_ser/A_b', output.betonTauxELS, output.betonOkELS);
    if (bt.length > 1) {
      body.push({
        table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: bt },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }
    const fcd = pieuxUnit(output.betonFcd, 1, 'MPa');
    if (fcd !== '—') {
      body.push({
        text: `Résistance de calcul du béton f_cd = ${fcd} (NF P 94-262 §4.4).`,
        style: 'cellMuted',
        margin: [0, 0, 0, 4],
      });
    }
  } else if (output.betonApplicable === false) {
    body.push(pieuxSection('Résistance du béton (structure)'));
    body.push({
      text: 'Non applicable pour ce pieu (traction ou catégorie non couverte : la résistance structurale dépend du matériau / des armatures, hors de cet outil).',
      style: 'cellMuted',
      margin: [0, 2, 0, 4],
    });
  }

  return body;
}
