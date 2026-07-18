import type { Content, TableCell } from 'pdfmake/interfaces';

import { COLORS, FINE_TABLE_LAYOUT } from '../pv-pdf.theme';
// Type-only import (erasé au build -> aucun cycle runtime avec pv-pdf.ts, qui
// dispatchera vers ces corps). Source unique de la signature : le contrat de rendu
// vit dans pv-pdf.ts et ne doit jamais dériver (patron pieux.ts / pressiometre.ts).
import type { SealedContent } from '../pv-pdf';

/**
 * FAC-SIMILÉ de la note native `printReport` (GEOPLAQUE_V10.html) — décision titulaire
 * 18/07 : le PV scellé du moteur RADIER / PLAQUE (et de ses 3 modes 2D) reproduit
 * SECTION PAR SECTION le rapport que l'outil client imprime (PV == écran == rapport
 * client). Le CLONE (apps/web) reconstruit l'affichage depuis la SORTIE SERVEUR
 * whitelistée (`RadierOutputSchema`) + l'ENTRÉE scellée (`RadierInputSchema`) ; ce corps
 * pdfmake fait de MÊME. Aucune science côté serveur PDF : on consomme les grandeurs
 * déjà calculées et déjà whitelistées, plus les échos d'entrée saisis.
 *
 * --- DÉCISION D'AFFICHAGE « COPIE-CLIENT » (à préserver, décision titulaire 15/07
 *     re-confirmée 17/07, « zéro écart absolu ») ---
 * La sortie MOTEUR reste physiquement juste (tassements en mm, distorsions en ‰) et le
 * scellé canonique est INCHANGÉ ; SEULE la couche de PRÉSENTATION reproduit les défauts
 * d'affichage de l'outil : tassements ×1000 (fdnSettleMm), grandeurs angulaires rendues
 * CRUES via `ratio1` + valeur brute étiquetée « rad » (fdnBetaRad / fdnRotRad).
 * Inclinaison ϖ = `ratio1(tilt)` SEUL (l'outil client ne lui adjoint pas de « rad »).
 * Réf. client : `printReport` l.1304, `refreshResults` (radier), panneaux `#ps-run` /
 * `#ax-run` / `#tri-run` l.2237-2333 (modes 2D). Typographie fr-FR maison.
 *
 * --- SECTIONS reproduites (buildRadierBody, ordre du rapport natif) ---
 *   0. alerte proéminente (poinçonnement / résultats NON VALIDES) — en tête (sécurité)
 *   1. « Modèle — fondations » (AJOUTÉ) : plaques (sommets / emprise / E / ν / e),
 *      charges ponctuelles / linéiques / surfaciques, ressorts, profil de sol — échos
 *      d'entrée SAISIS (client-safe, aucune méthode EF)
 *   2. « Vérifications — Eurocode 7, annexe H » (AJOUTÉ, le plus important) : VERDICT
 *      PAR CRITÈRE (CONFORME / ATTENTION / DÉPASSEMENT) avec seuils repères publics
 *   3. « Déflexions & distorsions » : diagnostics client-safe (RadierOutputSchema)
 *   4. « Synthèse — bilan global » : bilans de charge/réaction, rotations, extrêmes
 *   5. avertissements non critiques
 *
 * --- CONFIDENTIALITÉ (DoD §8, réserve nœuds EF #54) ---
 * Lecture par clés NOMMÉES uniquement (fail-closed). La sortie est déjà whitelistée par
 * `RadierOutputSchema`. Les LOCALISATIONS `*At` (wMaxAt / wMinAt / betaGovAt) sont des
 * COORDONNÉES DE NŒUDS DE MAILLAGE : elles ne sont PAS whitelistées (absentes de la
 * sortie) et NE SONT PAS reconstruites ici — la note native les imprime (« — en (x,y) »),
 * le PV les OMET. Seuls les VALEURS scalaires de diagnostic sont exposées. Exception
 * client-safe : `worstLoadPair.p1/p2/ki/kj` = coordonnées de POINTS DE CHARGE SAISIS
 * (echo d'entrée), exposables. Les verdicts EC7 (annexe H) sont dérivés de scalaires
 * whitelistés + seuils PUBLICS (EN 1990 / annexe H) — aucune méthode EF n'y transite
 * (même patron que `fmtChargeReaction`, front pur).
 *
 * Branding GEOFAM (porté par en-tête/pied) ; référentiel Eurocode 7 (annexe H).
 */

// ---------------------------------------------------------------------------
// Helpers LOCAUX — COPIÉS de pv-pdf.ts (patron pieux.ts : chaque corps porte ses
// helpers locaux, jamais d'export croisé). Les conventions d'affichage « copie-client »
// (×1000, angles crus) sont reprises À L'IDENTIQUE.
// ---------------------------------------------------------------------------

function radierNum(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Nombre → texte fr-FR (espaces normalisées), sinon « — ». */
function fdnNum(v: unknown, decimals: number, unit?: string): string {
  const n = radierNum(v);
  if (n === null) return '—';
  const s = n
    .toLocaleString('fr-FR', { maximumFractionDigits: decimals })
    .replace(/[\u202f\u00a0]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}

/** Notation SCIENTIFIQUE fr-FR (toExponential(2), séparateur « , »), sinon « — ». */
function fdnExp(v: unknown, unit?: string): string {
  const n = radierNum(v);
  if (n === null) return '—';
  const s = n.toExponential(2).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}

/** Tassement sur-rapporté ×1000 « mm » — miroir de `(d.wMax*1000).toFixed(1)+' mm'`. */
function fdnSettleMm(v: unknown): string {
  const n = radierNum(v);
  return n === null ? '—' : fdnNum(n * 1000, 1, 'mm');
}

/** `ratio1(v)` = « 1/N » (fr-FR) — miroir exact de l'outil client. « — » si v ≤ 0 / non fini. */
function ratio1(v: unknown): string {
  const n = radierNum(v);
  if (n === null || n <= 0) return '—';
  return `1/${Math.round(1 / n)
    .toLocaleString('fr-FR')
    .replace(/\s/g, ' ')}`;
}

/** Distorsion β CRUE — miroir de `ratio1(β)+'  ('+β.toExponential(1)+' rad)'`. */
function fdnBetaRad(v: unknown): string {
  const n = radierNum(v);
  if (n === null) return '—';
  return `${ratio1(n)} (${n.toExponential(1).replace('.', ',')} rad)`;
}

/** Rotation / pente CRUE — miroir de `v.toExponential(2)+' rad  ('+ratio1(v)+')'` (Synthèse). */
function fdnRotRad(v: unknown): string {
  const n = radierNum(v);
  if (n === null) return '—';
  return `${n.toExponential(2).replace('.', ',')} rad (${ratio1(n)})`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fdnSubTitle(label: string): Content {
  return { text: label, style: 'groupRow', margin: [0, 8, 0, 3] };
}

function fdnHead(
  text: string,
  align: 'left' | 'right' | 'center' = 'left',
): TableCell {
  return { text, style: 'tableHead', alignment: align };
}

function sectionTitle(label: string): Content {
  return { text: label.toUpperCase(), style: 'section', margin: [0, 16, 0, 6] };
}

/** Ajoute une ligne (label/valeur) à un corps de table si la valeur n'est pas « — ». */
function fdnKvRow(rows: TableCell[][], label: string, value: string): void {
  if (value === '—' || value === '') return;
  rows.push([
    { text: label, style: 'cell' },
    { text: value, style: 'cell', alignment: 'right' },
  ]);
}

/** Rend un tableau Grandeur/Valeur (≥1 ligne de donnée), sinon rien. */
function pushKvTable(body: Content[], rows: TableCell[][]): void {
  if (rows.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
}

/**
 * Encadré d'ALERTE proéminent (résultats NON VALIDES). Miroir de l'encadré ROUGE de
 * l'outil client GEOPLAQUE (`R.overCap` : capacité d'interface dépassée / poinçonnement)
 * — pleine largeur, fond bordeaux, texte blanc gras. Le message est déjà CLIENT-SAFE
 * (whitelisté/rédigé côté moteur) : rendu verbatim, sans intermédiaire de calcul.
 */
/**
 * Bandeau « Résultat d'analyse — sans verdict de conformité » — MIROIR du chrome
 * ROADSEN des modes 2D (panneaux `#ps-run`/`#ax-run`/`#tri-run` : STATISTIQUES seules,
 * aucun verdict). Honnête pour ces modes ; le corps RADIER ne l'emploie PAS (il porte
 * désormais les verdicts EC7 par critère).
 */
function buildAnalyseBanner(): Content {
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

function buildRadierAlertBox(message: string): Content {
  return {
    margin: [0, 10, 0, 6],
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              {
                text: 'ALERTE — RÉSULTATS À CONSIDÉRER COMME NON VALIDES',
                bold: true,
                fontSize: 11,
                color: COLORS.white,
              },
              {
                text: message,
                fontSize: 8.5,
                color: COLORS.white,
                margin: [0, 3, 0, 0],
              },
            ],
            fillColor: COLORS.alert,
            margin: [12, 8, 12, 8],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

/**
 * « Charge / réaction Σ » — ligne COMBINÉE de l'outil client (`st('Charge / réaction
 * Σ', total/react (équilibre …))`). `totalLoad` et `sumReact` sont whitelistés ;
 * l'écart d'équilibre est un simple DÉRIVÉ (front pur, aucune méthode EF exposée).
 * FAIL-CLOSED : « — » si l'une des deux grandeurs manque. `unit` = kN/m (coupe
 * unitaire, plane-strain) ou kN (axi / tri).
 */
function fmtChargeReaction(
  total: unknown,
  react: unknown,
  unit: string,
): string {
  const t = typeof total === 'number' && Number.isFinite(total) ? total : null;
  const r = typeof react === 'number' && Number.isFinite(react) ? react : null;
  if (t === null || r === null) return '—';
  const eqp = t !== 0 ? (Math.abs(r - t) / Math.abs(t)) * 100 : 0;
  const eq = eqp < 0.01 ? 'équilibre ✓' : `${fdnNum(eqp, 2)} %`;
  return `${fdnNum(t, 0)} / ${fdnNum(r, 0)} ${unit} (${eq})`;
}

/**
 * Erreur de calcul (garde moteur / science) + avertissements des modes 2D. Une
 * `erreur` non vide = résultats invalides -> encadré d'alerte proéminent (miroir
 * du bloc d'erreur du client). Les `warnings` sont déjà rédigés/whitelistés côté
 * moteur. Absents -> rien (fail-closed, jamais de section vide).
 */
function build2DErreurWarnings(o: Record<string, unknown>): Content[] {
  const out: Content[] = [];
  if (typeof o.erreur === 'string' && o.erreur.trim() !== '') {
    out.push(buildRadierAlertBox(o.erreur.trim()));
  }
  const warnings = (Array.isArray(o.warnings) ? o.warnings : []).filter(
    (w): w is string => typeof w === 'string',
  );
  if (warnings.length > 0) {
    out.push(fdnSubTitle('Avertissements'));
    out.push({
      text: warnings.join(' · '),
      style: 'cellMuted',
      color: COLORS.accent,
      margin: [0, 2, 0, 4],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vérifications EC7 (annexe H) — VERDICT PAR CRITÈRE (le plus important)
// ---------------------------------------------------------------------------

// Seuils PUBLICS Eurocode 7 (annexe H) — miroir EXACT des `lvl*` de l'outil client
// (l.2480-2482). Ce sont des repères réglementaires publics (aptitude au service),
// PAS des calages confidentiels. Le tassement / différentiel sont comparés en mm
// (valeur ×1000 « copie-client », comme la note native `wmaxmm=d.wMax*1000`).
type Ec7Level = 'ok' | 'warn' | 'bad';
function lvlSettle(mm: number): Ec7Level {
  return mm <= 25 ? 'ok' : mm <= 50 ? 'warn' : 'bad';
}
function lvlDiff(mm: number): Ec7Level {
  return mm <= 10 ? 'ok' : mm <= 20 ? 'warn' : 'bad';
}
function lvlBeta(bv: number): Ec7Level {
  return bv <= 1 / 500 ? 'ok' : bv <= 1 / 150 ? 'warn' : 'bad';
}

/** Cellule de verdict EC7 colorée — miroir de `verdict(l)` (CONFORME/ATTENTION/DÉPASSEMENT). */
function ec7VerdictCell(level: Ec7Level): TableCell {
  const map = {
    ok: { label: 'CONFORME', color: COLORS.navy },
    warn: { label: 'ATTENTION', color: COLORS.accent },
    bad: { label: 'DÉPASSEMENT', color: COLORS.alert },
  } as const;
  const v = map[level];
  return {
    text: v.label,
    style: 'cell',
    alignment: 'center',
    bold: true,
    color: v.color,
  };
}

/**
 * Section « Vérifications — Eurocode 7, annexe H » — MIROIR de la table `.chk` de
 * `printReport` (l.1336) : Critère / Valeur / Repère / Verdict, un verdict PAR critère.
 * Réserve nœuds EF #54 : la note native adjoint « — en (x,y) » aux valeurs (coordonnées
 * de nœuds de maillage) ; ces localisations ne sont PAS whitelistées (absentes de la
 * sortie) et sont OMISES ici. Seuls les scalaires whitelistés + les seuils PUBLICS
 * (annexe H) alimentent le verdict. Un critère n'apparaît que si sa grandeur est finie
 * (fail-closed) ; les lignes inter-plaques / entre charges sont conditionnelles (miroir
 * exact des conditions natives `d.nRafts>1` / `d.loadPairs.worst`).
 */
function buildRadierEC7Verifications(o: Record<string, unknown>): Content[] {
  const rows: TableCell[][] = [
    [
      fdnHead('Critère'),
      fdnHead('Valeur', 'right'),
      fdnHead('Repère', 'right'),
      fdnHead('Verdict', 'center'),
    ],
  ];
  const push = (
    critere: string,
    valeur: string,
    repere: string,
    level: Ec7Level,
  ): void => {
    rows.push([
      { text: critere, style: 'cell' },
      { text: valeur, style: 'cell', alignment: 'right' },
      { text: repere, style: 'cellMuted', alignment: 'right' },
      ec7VerdictCell(level),
    ]);
  };

  const wMax = radierNum(o.wMax);
  if (wMax !== null)
    push(
      'Tassement total max',
      fdnSettleMm(o.wMax),
      '≈ 50 mm',
      lvlSettle(wMax * 1000),
    );
  const diff = radierNum(o.diff);
  if (diff !== null)
    push(
      'Tassement différentiel',
      fdnSettleMm(o.diff),
      '≈ 20 mm',
      lvlDiff(diff * 1000),
    );
  const betaGov = radierNum(o.betaGov);
  if (betaGov !== null)
    push(
      'Distorsion angulaire β',
      fdnBetaRad(o.betaGov),
      'ELS 1/500 · ELU 1/150',
      lvlBeta(betaGov),
    );
  const tilt = radierNum(o.tiltMax);
  if (tilt !== null)
    push(
      "Inclinaison d'ensemble ϖ",
      ratio1(o.tiltMax),
      'visible ≈ 1/500',
      // Miroir native : `tiltMax<=1/500?'ok':tiltMax<=1/150?'warn':'bad'`.
      lvlBeta(tilt),
    );

  // Distorsion entre plaques — conditionnelle (miroir `d.nRafts>1`).
  const nRafts = radierNum(o.nRafts) ?? 0;
  const betaInter = radierNum(o.betaInter);
  if (nRafts > 1 && betaInter !== null) {
    const dsInter = fdnSettleMm(o.interDiff);
    const valeur =
      dsInter === '—'
        ? ratio1(o.betaInter)
        : `${ratio1(o.betaInter)} · Δs ${dsInter}`;
    push('Distorsion entre plaques', valeur, 'ELS 1/500', lvlBeta(betaInter));
  }

  // Distorsion max entre charges voisines — conditionnelle (miroir `d.loadPairs.worst`).
  // p1/p2/ki/kj = points de charge SAISIS (echo d'entrée, client-safe #54).
  const wlp = isPlainObject(o.worstLoadPair) ? o.worstLoadPair : null;
  const wlpBeta = wlp ? radierNum(wlp.beta) : null;
  if (wlp && wlpBeta !== null) {
    const ki = radierNum(wlp.ki);
    const kj = radierNum(wlp.kj);
    const paire =
      ki !== null && kj !== null
        ? ` — P${fdnNum(ki, 0)}↔P${fdnNum(kj, 0)}`
        : '';
    const ds = fdnSettleMm(wlp.ds);
    const L = fdnNum(wlp.L, 2, 'm');
    const parts = [ratio1(wlp.beta)];
    if (ds !== '—') parts.push(`Δs ${ds}`);
    if (L !== '—') parts.push(L);
    push(
      `Distorsion entre charges (max)${paire}`,
      parts.join(' · '),
      'ELS 1/500 · ELU 1/150',
      lvlBeta(wlpBeta),
    );
  }

  if (rows.length <= 1) return [];
  return [
    sectionTitle('Vérifications — Eurocode 7, annexe H'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto'],
        body: rows,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 2],
    },
    {
      // Miroir de la note de bas de rapport : les repères annexe H sont INDICATIFS.
      text: 'Repères Eurocode 7 annexe H indicatifs, à confronter au type de structure portée. Verdict d’aptitude au service par critère, sans valeur de conformité réglementaire globale.',
      style: 'cellMuted',
      margin: [0, 0, 0, 4],
    },
  ];
}

// ---------------------------------------------------------------------------
// Modèle — fondations (échos d'entrée SAISIS, client-safe)
// ---------------------------------------------------------------------------

/**
 * Section « Modèle — fondations » — MIROIR de la table `<h2>Modèle — fondations</h2>` +
 * charges + ressorts + profil de sol de `printReport` (l.1420-1439), reconstruite depuis
 * l'ENTRÉE scellée (`RadierInputSchema`). Ce sont les données de MODÈLE SAISIES par
 * l'utilisateur (géométrie, matériaux, charges, sol) — client-safe, aucune méthode EF.
 * NB unités : l'ENTRÉE plateforme porte E en MPa (contrat) — affiché tel quel, sans le
 * `/1000` de la note native (qui convertissait ses kPa internes en MPa).
 */
function buildRadierModele(input: Record<string, unknown>): Content[] {
  const out: Content[] = [];

  // Plaques (rafts) : sommets / emprise / E / ν / e.
  const rafts = Array.isArray(input.rafts)
    ? input.rafts.filter(isPlainObject)
    : [];
  const raftRows: TableCell[][] = [
    [
      fdnHead('Élément'),
      fdnHead('Géométrie'),
      fdnHead('Emprise X × Y (m)'),
      fdnHead('E', 'right'),
      fdnHead('ν', 'right'),
      fdnHead('Épaisseur', 'right'),
    ],
  ];
  rafts.forEach((rf, i) => {
    const pts = Array.isArray(rf.pts) ? rf.pts.filter(isPlainObject) : [];
    const xs = pts
      .map((p) => radierNum(p.x))
      .filter((n): n is number => n !== null);
    const ys = pts
      .map((p) => radierNum(p.y))
      .filter((n): n is number => n !== null);
    const emprise =
      xs.length > 0 && ys.length > 0
        ? `${fdnNum(Math.min(...xs), 2)} – ${fdnNum(Math.max(...xs), 2)} × ${fdnNum(Math.min(...ys), 2)} – ${fdnNum(Math.max(...ys), 2)}`
        : '—';
    raftRows.push([
      { text: `R${i + 1}`, style: 'cell' },
      { text: `${pts.length} sommets`, style: 'cell' },
      { text: emprise, style: 'cell' },
      { text: fdnNum(rf.E, 0, 'MPa'), style: 'cell', alignment: 'right' },
      { text: fdnNum(rf.nu, 2), style: 'cell', alignment: 'right' },
      { text: fdnNum(rf.e, 2, 'm'), style: 'cell', alignment: 'right' },
    ]);
  });
  if (raftRows.length > 1) {
    out.push(sectionTitle('Modèle — fondations'));
    out.push({
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
        body: raftRows,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Charges ponctuelles : # / position / Fz / Mx-My.
  const pointLoads = Array.isArray(input.pointLoads)
    ? input.pointLoads.filter(isPlainObject)
    : [];
  if (pointLoads.length > 0) {
    const rows: TableCell[][] = [
      [
        fdnHead('#'),
        fdnHead('Position (m)'),
        fdnHead('Fz', 'right'),
        fdnHead('Mx / My', 'right'),
      ],
    ];
    pointLoads.forEach((p, i) => {
      rows.push([
        { text: `P${i + 1}`, style: 'cell' },
        {
          text: `${fdnNum(p.x, 2)} ; ${fdnNum(p.y, 2)}`,
          style: 'cell',
        },
        { text: fdnNum(p.Fz, 0, 'kN'), style: 'cell', alignment: 'right' },
        {
          text: `${fdnNum(p.Mx, 0)} / ${fdnNum(p.My, 0)} kN·m`,
          style: 'cell',
          alignment: 'right',
        },
      ]);
    });
    out.push(fdnSubTitle('Charges ponctuelles'));
    out.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto'],
        body: rows,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Charges linéiques : # / tracé / q.
  const lineLoads = Array.isArray(input.lineLoads)
    ? input.lineLoads.filter(isPlainObject)
    : [];
  if (lineLoads.length > 0) {
    const rows: TableCell[][] = [
      [fdnHead('#'), fdnHead('Tracé (m)'), fdnHead('q', 'right')],
    ];
    lineLoads.forEach((l, i) => {
      rows.push([
        { text: `L${i + 1}`, style: 'cell' },
        {
          text: `${fdnNum(l.x1, 2)};${fdnNum(l.y1, 2)} → ${fdnNum(l.x2, 2)};${fdnNum(l.y2, 2)}`,
          style: 'cell',
        },
        { text: fdnNum(l.q, 0, 'kN/ml'), style: 'cell', alignment: 'right' },
      ]);
    });
    out.push(fdnSubTitle('Charges linéiques'));
    out.push({
      table: { headerRows: 1, widths: ['auto', '*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Charges surfaciques : # / emprise / q / support (sol vs plaque).
  const areaLoads = Array.isArray(input.areaLoads)
    ? input.areaLoads.filter(isPlainObject)
    : [];
  if (areaLoads.length > 0) {
    const rows: TableCell[][] = [
      [
        fdnHead('#'),
        fdnHead('Emprise (m)'),
        fdnHead('q', 'right'),
        fdnHead('Sur'),
      ],
    ];
    areaLoads.forEach((a, i) => {
      const on = a.on === 'soil' ? 'sol (ext.)' : 'plaque';
      rows.push([
        { text: `A${i + 1}`, style: 'cell' },
        {
          text: `${fdnNum(a.x1, 2)};${fdnNum(a.y1, 2)} → ${fdnNum(a.x2, 2)};${fdnNum(a.y2, 2)}`,
          style: 'cell',
        },
        { text: fdnNum(a.q, 0, 'kPa'), style: 'cell', alignment: 'right' },
        { text: on, style: 'cell' },
      ]);
    });
    out.push(fdnSubTitle('Charges réparties'));
    out.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto'],
        body: rows,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Ressorts ponctuels (§2.2.7) — rendus SEULEMENT s'il y en a (miroir native).
  const pointSprings = Array.isArray(input.pointSprings)
    ? input.pointSprings.filter(isPlainObject)
    : [];
  if (pointSprings.length > 0) {
    const rows: TableCell[][] = [
      [fdnHead('#'), fdnHead('Position (m)'), fdnHead('Raideur k', 'right')],
    ];
    pointSprings.forEach((s, i) => {
      rows.push([
        { text: `K${i + 1}`, style: 'cell' },
        { text: `${fdnNum(s.x, 2)} ; ${fdnNum(s.y, 2)}`, style: 'cell' },
        { text: fdnNum(s.k, 0, 'kN/m'), style: 'cell', alignment: 'right' },
      ]);
    });
    out.push(fdnSubTitle('Ressorts ponctuels (§2.2.7)'));
    out.push({
      table: { headerRows: 1, widths: ['auto', '*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Ressorts linéiques (§2.2.7).
  const lineSprings = Array.isArray(input.lineSprings)
    ? input.lineSprings.filter(isPlainObject)
    : [];
  if (lineSprings.length > 0) {
    const rows: TableCell[][] = [
      [fdnHead('#'), fdnHead('Tracé (m)'), fdnHead('Raideur k', 'right')],
    ];
    lineSprings.forEach((l, i) => {
      rows.push([
        { text: `KL${i + 1}`, style: 'cell' },
        {
          text: `${fdnNum(l.x1, 2)};${fdnNum(l.y1, 2)} → ${fdnNum(l.x2, 2)};${fdnNum(l.y2, 2)}`,
          style: 'cell',
        },
        { text: fdnNum(l.k, 0, 'kN/m/m'), style: 'cell', alignment: 'right' },
      ]);
    });
    out.push(fdnSubTitle('Ressorts linéiques (§2.2.7)'));
    out.push({
      table: { headerRows: 1, widths: ['auto', '*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Profil de sol : couche / Z base / E / ν.
  const layers = Array.isArray(input.layers)
    ? input.layers.filter(isPlainObject)
    : [];
  if (layers.length > 0) {
    const rows: TableCell[][] = [
      [
        fdnHead('Couche'),
        fdnHead('Z base', 'right'),
        fdnHead('E', 'right'),
        fdnHead('ν', 'right'),
      ],
    ];
    layers.forEach((c, i) => {
      const name =
        typeof c.name === 'string' && c.name.trim() !== ''
          ? c.name
          : `Couche ${i + 1}`;
      rows.push([
        { text: name, style: 'cell' },
        { text: fdnNum(c.zBase, 1, 'm'), style: 'cell', alignment: 'right' },
        { text: fdnNum(c.E, 0, 'MPa'), style: 'cell', alignment: 'right' },
        { text: fdnNum(c.nu, 2), style: 'cell', alignment: 'right' },
      ]);
    });
    out.push(fdnSubTitle('Profil de sol'));
    out.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto'],
        body: rows,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Corps RADIER (plaque sur sol multicouche élastique, GEOPLAQUE)
// ---------------------------------------------------------------------------

export function buildRadierBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const body: Content[] = [];

  // 0) AVERTISSEMENTS — le poinçonnement (résultats NON VALIDES) est PROÉMINENT : encadré
  // rouge EN TÊTE des résultats, comme l'outil client. Les warnings sont déjà rédigés/
  // whitelistés côté moteur ; ici on les CLASSE (critique vs. informatif) et on rend le
  // critique en alerte. `warnings` est une whitelist du RadierOutputSchema.
  const warnings = (Array.isArray(o.warnings) ? o.warnings : []).filter(
    (w): w is string => typeof w === 'string',
  );
  const critiques = warnings.filter((w) => /non valides/i.test(w));
  const autres = warnings.filter((w) => !/non valides/i.test(w));
  for (const w of critiques) body.push(buildRadierAlertBox(w));

  // 1) Modèle — fondations (échos d'entrée saisis) — MIROIR de printReport l.1420.
  body.push(...buildRadierModele(input));

  // 2) Vérifications — Eurocode 7, annexe H (verdict par critère) — MIROIR l.1336.
  body.push(...buildRadierEC7Verifications(o));

  // 3) Déflexions & distorsions — diagnostics client-safe (RadierOutputSchema), ordre
  // GEOPLAQUE_V10. AFFICHAGE = COPIE de l'outil client (tassements ×1000 via fdnSettleMm,
  // distorsions/pentes crues via ratio1 + « rad », inclinaison ϖ = ratio1 seul).
  body.push(sectionTitle('Déflexions & distorsions'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(t, 'Tassement maximal w_max', fdnSettleMm(o.wMax));
  fdnKvRow(t, 'Tassement minimal w_min', fdnSettleMm(o.wMin));
  fdnKvRow(t, 'Tassement différentiel', fdnSettleMm(o.diff));
  fdnKvRow(t, 'Distorsion angulaire gouvernante β', fdnBetaRad(o.betaGov));
  fdnKvRow(t, 'Distorsion intra-plaque max', fdnBetaRad(o.betaIntra));
  fdnKvRow(t, "Inclinaison d'ensemble ϖ", ratio1(o.tiltMax));
  fdnKvRow(t, 'Pente locale max |∇w|', fdnRotRad(o.slopeMax));
  const nRafts = typeof o.nRafts === 'number' ? o.nRafts : 0;
  if (nRafts > 1) {
    // Inter-plaques : distorsion CRUE (ratio1 seul) + différentiel ×1000.
    fdnKvRow(t, 'Distorsion entre plaques', ratio1(o.betaInter));
    fdnKvRow(
      t,
      'Tassement différentiel inter-plaques',
      fdnSettleMm(o.interDiff),
    );
  }
  const wlp = o.worstLoadPair;
  if (wlp != null && typeof wlp === 'object') {
    fdnKvRow(
      t,
      'Distorsion max entre charges voisines',
      ratio1((wlp as Record<string, unknown>).beta),
    );
  }
  fdnKvRow(t, 'Nombre de radiers', fdnNum(o.nRafts, 0));
  if (t.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 4) SYNTHÈSE — bilan global (panneau « Synthèse » de GEOPLAQUE_V10, ADR 0014).
  // Diagnostics GLOBAUX (scalaires) : bilans de charge/réaction, rotations et
  // réactions/moments EXTREMES. Les lignes CONDITIONNELLES (Winkler/ressorts/décollement)
  // valent `null` quand l'option est inactive -> fdnNum « — » -> fdnKvRow les OMET.
  // `decolNodes = 0` (décollement actif, aucun nœud décollé) est FINI -> RENDU « 0 ».
  const s: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(s, 'Charge appliquée Σ', fdnNum(o.totalLoad, 1, 'kN'));
  fdnKvRow(s, 'Σ réactions du sol', fdnNum(o.sumReact, 1, 'kN'));
  fdnKvRow(s, 'Σ réaction de Winkler', fdnNum(o.sumWink, 1, 'kN'));
  fdnKvRow(s, 'Σ réaction des ressorts', fdnNum(o.sumSpr, 1, 'kN'));
  fdnKvRow(s, 'Rotation θx max', fdnRotRad(o.txMax));
  fdnKvRow(s, 'Rotation θy max', fdnRotRad(o.tyMax));
  fdnKvRow(s, 'Réaction de sol minimale', fdnNum(o.pMin, 1, 'kPa'));
  fdnKvRow(s, 'Réaction de sol maximale', fdnNum(o.pMax, 1, 'kPa'));
  fdnKvRow(s, 'Moment |Mx| max', fdnNum(o.mxMax, 1, 'kN·m/ml'));
  fdnKvRow(s, 'Moment |My| max', fdnNum(o.myMax, 1, 'kN·m/ml'));
  fdnKvRow(s, 'Moment de torsion |Mxy| max', fdnNum(o.mxyMax, 1, 'kN·m/ml'));
  fdnKvRow(s, 'Nœuds décollés (contact unilatéral)', fdnNum(o.decolNodes, 0));
  if (s.length > 1) {
    body.push(sectionTitle('Synthèse — bilan global'));
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: s },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 5) Autres avertissements (non critiques). Déjà rédigés/whitelistés côté moteur.
  if (autres.length > 0) {
    body.push(fdnSubTitle('Avertissements'));
    body.push({
      text: autres.map((w) => String(w)).join(' · '),
      style: 'cellMuted',
      color: COLORS.accent,
      margin: [0, 2, 0, 4],
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Présentations « déformée 2D » GEOPLAQUE (déformations planes / axisymétrique /
// radier triangulaire) — RÉSULTATS de calcul EF, SANS verdict de conformité : pour ces
// modes l'outil client (`#ps-run` / `#ax-run` / `#tri-run`) n'affiche que des
// STATISTIQUES + une figure. Clés NOMMÉES (fail-closed, DoD §8). Tassements ×1000
// (fdnSettleMm) pour COPIER l'affichage de l'outil client — décision titulaire 15/07
// re-confirmée 17/07 ; sortie moteur et scellé INCHANGÉS.
// ---------------------------------------------------------------------------

export function buildPlaneStrainBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const opts = isPlainObject(input.opts) ? input.opts : {};
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Résultats — coupe en déformations planes'));
  // Ordre & libellés du panneau `#ps-run` de GEOPLAQUE_V10 (tranche unitaire).
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(t, 'Tassement maximal w_max', fdnSettleMm(o.wMax));
  fdnKvRow(t, 'Tassement minimal w_min', fdnSettleMm(o.wMin));
  fdnKvRow(t, 'Tassement différentiel', fdnSettleMm(o.diff));
  fdnKvRow(t, 'Moment fléchissant maximal', fdnNum(o.mMax, 1, 'kN·m/m'));
  fdnKvRow(t, 'Moment fléchissant minimal', fdnNum(o.mMin, 1, 'kN·m/m'));
  fdnKvRow(t, 'Réaction de sol maximale', fdnNum(o.pMax, 1, 'kPa'));
  fdnKvRow(
    t,
    'Charge / réaction Σ',
    fmtChargeReaction(o.totalLoad, o.sumReact, 'kN/m'),
  );
  // Cote d'assise & décollement : affichés SEULEMENT si l'option est ACTIVE (lu dans
  // l'ENTRÉE scellée — fidélité exacte, pas de ligne « 0 » parasite quand inactif).
  if (typeof opts.foundD === 'number' && opts.foundD > 0) {
    fdnKvRow(t, "Cote d'assise D", fdnNum(o.z0, 2, 'm'));
  }
  if (opts.decol === true) {
    fdnKvRow(t, 'Nœuds décollés (contact unilatéral)', fdnNum(o.decolN, 0));
  }
  // Rigidité de flexion D = E·e³/12(1−ν²) — affichée EN PERMANENCE (notation scientifique).
  fdnKvRow(t, 'Rigidité de flexion D', fdnExp(o.EI, 'kN·m'));
  pushKvTable(body, t);

  body.push(...build2DErreurWarnings(o));
  return body;
}

export function buildAxiBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  // L'entrée axi porte les options sous la clé `o` (handler `#ax-run`).
  const opts = isPlainObject(input.o) ? input.o : {};
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Résultats — plaque axisymétrique'));
  // Ordre & libellés du panneau `#ax-run` : centre/bord + différentiel (le client
  // n'affiche PAS wMax/wMin isolés — ils sont AGRÉGÉS dans « Tassement différentiel »).
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(t, 'Tassement au centre w_c', fdnSettleMm(o.wc));
  fdnKvRow(t, 'Tassement au bord w_bord', fdnSettleMm(o.wEdge));
  fdnKvRow(t, 'Tassement différentiel', fdnSettleMm(o.diff));
  fdnKvRow(t, 'Moment radial M_r max', fdnNum(o.mrMax, 1, 'kN·m/m'));
  fdnKvRow(t, 'Moment tangentiel M_t max', fdnNum(o.mtMax, 1, 'kN·m/m'));
  fdnKvRow(t, 'Réaction de sol maximale', fdnNum(o.pMax, 1, 'kPa'));
  fdnKvRow(
    t,
    'Charge / réaction Σ',
    fmtChargeReaction(o.totalLoad, o.sumReact, 'kN'),
  );
  if (typeof opts.foundD === 'number' && opts.foundD > 0) {
    fdnKvRow(t, "Cote d'assise D", fdnNum(o.z0, 2, 'm'));
  }
  pushKvTable(body, t);
  // NB : le contrat axi n'expose ni `erreur` ni `warnings` (aucun à rendre).
  return body;
}

export function buildTriRaftBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const opts = isPlainObject(input.opts) ? input.opts : {};
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Résultats — radier maillé (triangulaire)'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  // « Maillage » du client = « n plaques · N nœuds · nt triangles » ; N/nt sont la
  // DENSITÉ DE MAILLAGE (méthode EF) NON whitelistée (§8) -> on ne rend que le nb de
  // plaques (donnée de modèle, client-safe).
  fdnKvRow(t, 'Nombre de plaques modélisées', fdnNum(o.nRaft, 0));
  fdnKvRow(t, 'Tassement maximal w_max', fdnSettleMm(o.wMax));
  fdnKvRow(t, 'Tassement minimal w_min', fdnSettleMm(o.wMin));
  fdnKvRow(t, 'Tassement différentiel', fdnSettleMm(o.diff));
  fdnKvRow(t, 'Réaction de sol maximale', fdnNum(o.reactionMax, 1, 'kPa'));
  fdnKvRow(
    t,
    'Charge / réaction Σ',
    fmtChargeReaction(o.totalLoad, o.sumReact, 'kN'),
  );
  if (typeof opts.foundD === 'number' && opts.foundD > 0) {
    fdnKvRow(t, "Cote d'assise D", fdnNum(o.z0, 2, 'm'));
  }
  pushKvTable(body, t);

  body.push(...build2DErreurWarnings(o));
  return body;
}
