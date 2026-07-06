import type { Content, TableCell } from 'pdfmake/interfaces';

import type { SealedContent } from '../pv-pdf';
import { COLORS } from '../pv-pdf.theme';

import { formatValue, resolvePath, workRate } from './format';
import type {
  CriterionSpec,
  LayerTableSpec,
  NumberFormat,
  PresentationModel,
  PresentedField,
  PresentedGroup,
  StructureTableSpec,
} from './types';

/**
 * RENDU MÉTIER d'un PV (#71) à partir de la donnée SCELLÉE + d'un PresentationModel.
 * Le corps est une NOTE DE CALCUL d'ingénieur (bandeau verdict, structure en
 * couches, vérifications dimensionnantes) — pas un vidage de dictionnaire.
 *
 * CONFIDENTIALITÉ / SCELLEMENT : on ne lit QUE des champs de la sortie/entrée
 * scellées ; on n'ajoute aucun champ moteur ; les coefficients de calage et flags
 * de branche sont MASQUÉS (model.hiddenKeys, fail-closed). Le scellement n'est pas
 * touché : scale m->cm et formats ne s'appliquent qu'à l'affichage.
 */
export function renderRichBody(
  sealed: SealedContent,
  model: PresentationModel,
): Content[] {
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const output = (sealed.output ?? {}) as Record<string, unknown>;

  const body: Content[] = [];

  // 1) BANDEAU VERDICT (en tête des résultats, avant les entrées pour l'impact).
  body.push(buildVerdictBanner(output, model));

  // 2) ENTRÉES — structure (couches + sol support) puis groupes (trafic, charge).
  body.push(sectionTitleRich('Données d’entrée'));
  if (model.structure) {
    body.push(buildStructureTable(input, model.structure));
  }
  for (const g of model.inputGroups) {
    body.push(buildGroupTable(input, g, model.numberFormat));
  }

  // 3) RÉSULTATS — vérifications dimensionnantes puis synthèse.
  body.push(sectionTitleRich('Résultats'));
  body.push(buildVerificationsTable(output, model));
  // Tables de vérification PAR COUCHE (σ_t par couche traitée, ε_z par couche
  // granulaire) — omises si le tableau scellé est vide/absent.
  for (const lt of model.layerTables ?? []) {
    const table = buildLayerTable(output, lt);
    if (table) body.push(table);
  }
  for (const g of model.resultGroups) {
    body.push(buildGroupTable(output, g, model.numberFormat));
  }

  // 3bis) AVERTISSEMENTS — `warnings` (déjà rédigés/rédigés côté moteur, sortie
  //    scellée whitelistée). VIDE -> rien ; NON VIDE -> ENCADRÉ D'ALERTE (jamais
  //    ignoré silencieusement). Les avertissements sont déjà rédactés des valeurs
  //    confidentielles en amont (cf. contrat moteur).
  const warnings = output.warnings;
  if (Array.isArray(warnings) && warnings.length > 0) {
    body.push(buildWarningsBox(warnings));
  }

  // 4) FAIL-CLOSED (B-1, DoD §8) : la voie riche est une WHITELIST. AUCUN champ
  //    non mappé n'est rendu (l'ancien « Autres paramètres » auto était fail-OPEN :
  //    il fuyait p.ex. `projet`). La garantie « ne jamais OMETTRE silencieusement »
  //    est tenue par le TEST DE COMPLÉTUDE (pv-presentation.completeness.spec.ts) :
  //    toute clé scellée non décidée -> test ROUGE au dev, jamais de fuite au rendu.

  return body;
}

// ---------------------------------------------------------------------------
// Bandeau verdict + vérifications
// ---------------------------------------------------------------------------

/**
 * Critères ACTIFS : on écarte les critères SECONDAIRES (`optional`) dont la valeur
 * sollicitante résout vers null/absent — leur famille de structure n'est pas
 * concernée (pas de ligne « — » trompeuse). Les critères principaux restent
 * toujours affichés (parité comportement historique).
 */
function activeCriteria(
  output: Record<string, unknown>,
  model: PresentationModel,
): CriterionSpec[] {
  return model.criteria.filter((c) => {
    if (!c.optional) return true;
    const v = resolvePath(output, c.valuePath);
    return typeof v === 'number' && Number.isFinite(v);
  });
}

function buildVerdictBanner(
  output: Record<string, unknown>,
  model: PresentationModel,
): Content {
  // Le booléen SCELLÉ est CONSOMMÉ ici (jamais recalculé, jamais affiché en ligne).
  const conforme = resolvePath(output, model.verdict.key) === true;
  const label = conforme ? model.verdict.labelTrue : model.verdict.labelFalse;
  const fill = conforme ? COLORS.navy : COLORS.alert;

  // Colonnes internes : verdict 40 % + un encart par critère (taux de travail).
  const criteriaCols: Content[] = activeCriteria(output, model).map((c) => {
    const value = resolvePath(output, c.valuePath);
    const adm = resolvePath(output, c.admissiblePath);
    const rate = workRate(value, adm);
    const rateText = rate == null ? '—' : `${Math.round(rate)} %`;
    return {
      width: '*',
      stack: [
        { text: c.label, color: COLORS.white, fontSize: 7 },
        {
          text: `Taux de travail : ${rateText}`,
          color: COLORS.white,
          fontSize: 8,
          bold: true,
          margin: [0, 1, 0, 0],
        },
      ],
    };
  });

  return {
    margin: [0, 10, 0, 4],
    table: {
      widths: ['*'],
      body: [
        [
          {
            columns: [
              {
                width: '40%',
                text: label,
                color: COLORS.white,
                bold: true,
                fontSize: 11,
                margin: [0, 4, 0, 4],
              },
              ...criteriaCols,
            ],
            fillColor: fill,
            margin: [12, 6, 12, 6],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function buildVerificationsTable(
  output: Record<string, unknown>,
  model: PresentationModel,
): Content {
  // Critère | calculé | admissible | taux de travail % | ✓/✗. Critère le plus
  // défavorable (taux max) mis en avant (fond légèrement teinté).
  const head: TableCell[] = [
    { text: 'Vérification', style: 'tableHead' },
    { text: 'Calculé', style: 'tableHead', alignment: 'right' },
    { text: 'Admissible', style: 'tableHead', alignment: 'right' },
    { text: 'Taux de travail', style: 'tableHead', alignment: 'right' },
    { text: '', style: 'tableHead', alignment: 'center' },
  ];

  const rows = activeCriteria(output, model).map((c) => {
    const value = resolvePath(output, c.valuePath);
    const adm = resolvePath(output, c.admissiblePath);
    const rate = workRate(value, adm);
    const ok = rate != null && rate <= 100;
    const v = formatValue(value, c.format);
    const a = formatValue(adm, c.format);
    return {
      label: c.label,
      calc: `${v.value} ${v.unit}`.trim(),
      adm: `${a.value} ${a.unit}`.trim(),
      rate,
      rateText: rate == null ? '—' : `${Math.round(rate)} %`,
      ok,
    };
  });

  // critère dimensionnant = taux max (parmi ceux calculables).
  let maxRate = -Infinity;
  for (const r of rows)
    if (r.rate != null && r.rate > maxRate) maxRate = r.rate;

  const tbody: TableCell[][] = [head];
  for (const r of rows) {
    const dominant = r.rate != null && r.rate === maxRate;
    const fill = dominant ? COLORS.zebra : undefined;
    tbody.push([
      { text: r.label, style: 'cell', fillColor: fill, bold: dominant },
      { text: r.calc, style: 'cell', alignment: 'right', fillColor: fill },
      { text: r.adm, style: 'cell', alignment: 'right', fillColor: fill },
      {
        text: r.rateText,
        style: 'cell',
        alignment: 'right',
        fillColor: fill,
        bold: dominant,
      },
      // Coche/croix VECTORIELLE (canvas) : Roboto n'a pas U+2713/U+2717 (glyphes
      // manquants -> carrés). On dessine donc le picto -> rendu net, déterministe,
      // sans dépendance de fonte. Discret, PAS d'emoji.
      verdictMarkCell(r.ok, fill),
    ]);
  }

  return {
    margin: [0, 2, 0, 6],
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 16],
      body: tbody,
    },
    layout: richTableLayout(),
  };
}

/**
 * TABLE de vérification PAR COUCHE (σ_t par couche traitée, ε_z par couche
 * granulaire). Renvoie null si le tableau scellé est vide/absent (section omise).
 * FAIL-CLOSED (DoD §8) : on ne lit QUE les sous-clés NOMMÉES par le spec ; jamais
 * de copie d'objet brut. Le mode d'interface est un libellé normatif public
 * (allowlist appliquée côté moteur).
 */
function buildLayerTable(
  output: Record<string, unknown>,
  spec: LayerTableSpec,
): Content | null {
  const arr = resolvePath(output, spec.arrayPath);
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const withMode = spec.modeKey != null;
  const withAdm = spec.admissibleKey != null;

  const head: TableCell[] = [{ text: 'Couche', style: 'tableHead' }];
  if (withMode) head.push({ text: 'Interface', style: 'tableHead' });
  head.push({ text: 'Calculé', style: 'tableHead', alignment: 'right' });
  if (withAdm)
    head.push({ text: 'Admissible', style: 'tableHead', alignment: 'right' });
  head.push({ text: '', style: 'tableHead', alignment: 'center' });

  const tbody: TableCell[][] = [head];
  for (const el of arr) {
    if (el == null || typeof el !== 'object') continue;
    const row = el as Record<string, unknown>;
    const coucheRaw = row[spec.coucheKey];
    const couche =
      typeof coucheRaw === 'number' ? `Couche ${coucheRaw}` : 'Couche —';
    const v = formatValue(row[spec.valueKey], spec.format);
    const ok = row[spec.okKey] === true;

    const cells: TableCell[] = [{ text: couche, style: 'cell' }];
    if (withMode) {
      const m = row[spec.modeKey as string];
      cells.push({
        text: typeof m === 'string' ? m : '—',
        style: 'cell',
      });
    }
    cells.push({
      text: `${v.value} ${v.unit}`.trim(),
      style: 'cell',
      alignment: 'right',
    });
    if (withAdm) {
      const a = formatValue(row[spec.admissibleKey as string], spec.format);
      cells.push({
        text: `${a.value} ${a.unit}`.trim(),
        style: 'cell',
        alignment: 'right',
      });
    }
    cells.push(verdictMarkCell(ok));
    tbody.push(cells);
  }

  // Titre (sous-titre de section) + table.
  const widths: (string | number)[] = ['*'];
  if (withMode) widths.push('auto');
  widths.push('auto');
  if (withAdm) widths.push('auto');
  widths.push(16);

  return {
    margin: [0, 2, 0, 6],
    stack: [
      {
        text: spec.title,
        color: COLORS.navy,
        bold: true,
        fontSize: 8.5,
        margin: [0, 4, 0, 2],
      },
      {
        table: { headerRows: 1, widths, body: tbody },
        layout: richTableLayout(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Table structure (couches haut->bas + sol support)
// ---------------------------------------------------------------------------

function buildStructureTable(
  input: Record<string, unknown>,
  spec: StructureTableSpec,
): Content {
  const layers = resolvePath(input, spec.layersPath);
  const subgrade = resolvePath(input, spec.subgradePath) as
    | Record<string, unknown>
    | undefined;

  const head: TableCell[] = spec.columns.map((c) => ({
    text: c.header,
    style: 'tableHead',
    alignment: c.align === 'right' ? 'right' : 'left',
  }));

  const tbody: TableCell[][] = [head];

  // Couches HAUT -> BAS (ordre du tableau scellé).
  if (Array.isArray(layers)) {
    layers.forEach((layer) => {
      const row = layer as Record<string, unknown>;
      tbody.push(
        spec.columns.map((c) => {
          const f = formatValue(row[c.key], c.format);
          const txt = c.format?.unit ? `${f.value}` : f.value;
          return {
            text: txt,
            style: 'cell',
            alignment: c.align === 'right' ? 'right' : 'left',
          };
        }),
      );
    });
  }

  // SOL SUPPORT — dernière ligne (semi-infini). La 1re colonne = libellé matériau
  // (classe de plateforme), la colonne épaisseur = « semi-infini ».
  if (subgrade) {
    tbody.push(
      spec.columns.map((c, i) => {
        if (i === 0) {
          const cls = subgrade.cls;
          const label =
            typeof cls === 'string' && cls.length > 0
              ? `Sol support (${cls})`
              : 'Sol support';
          return { text: label, style: 'cell', italics: true };
        }
        // colonne épaisseur (dernière) -> « semi-infini »
        if (i === spec.columns.length - 1) {
          return {
            text: spec.subgradeThicknessLabel,
            style: 'cellMuted',
            alignment: c.align === 'right' ? 'right' : 'left',
            italics: true,
          };
        }
        const f = formatValue(subgrade[c.key], c.format);
        return {
          text: f.value,
          style: 'cell',
          alignment: c.align === 'right' ? 'right' : 'left',
        };
      }),
    );
  }

  return {
    margin: [0, 2, 0, 6],
    table: {
      headerRows: 1,
      widths: spec.columns.map((c, i) => (i === 0 ? '*' : 'auto')),
      body: tbody,
    },
    layout: richTableLayout(),
  };
}

// ---------------------------------------------------------------------------
// Tables de groupe (libellé | valeur | unité)
// ---------------------------------------------------------------------------

function buildGroupTable(
  data: Record<string, unknown>,
  group: PresentedGroup,
  numberFormat: Record<string, NumberFormat>,
): Content {
  const rows: TableCell[][] = [];
  // Sous-titre de groupe (cellule fusionnée 3 colonnes, fond #eef2f7).
  rows.push([
    {
      text: group.title,
      colSpan: 3,
      fillColor: COLORS.groupFill71,
      bold: true,
      color: COLORS.navy,
      fontSize: 8.5,
    },
    {},
    {},
  ]);
  for (const field of group.fields) {
    rows.push(buildFieldRow(data, field, numberFormat));
  }
  // MIN-1 : un groupe est COMPACT (sous-titre + ≤ ~10 champs) -> on l'enveloppe en
  // `unbreakable` pour qu'il ne soit JAMAIS coupé entre 2 pages : plus de
  // sous-titre ORPHELIN en bas de page (le commentaire « pas d'orphelin » d'avant
  // était faux). Un groupe trop grand pour une page resterait coupé (cas non
  // rencontré : nos groupes tiennent largement sur une page).
  return {
    unbreakable: rows.length <= 12,
    margin: [0, 2, 0, 4],
    table: { widths: ['*', 'auto', 'auto'], body: rows },
    layout: richTableLayout(),
  };
}

/**
 * ENCADRÉ D'ALERTE des avertissements moteur (`warnings` non vides). Les messages
 * sont déjà rédactés des valeurs confidentielles en amont (contrat moteur). Jamais
 * ignorés silencieusement : un PV avec avertissements DOIT les montrer.
 */
function buildWarningsBox(warnings: unknown[]): Content {
  const lines: Content[] = [
    {
      text: 'AVERTISSEMENTS',
      style: 'cardLabel',
      color: COLORS.alert,
      margin: [0, 0, 0, 4],
    },
    ...warnings.map(
      (w): Content => ({
        // MAJEUR-2 (audit, DoD §8) : un warning NON-STRING ne doit JAMAIS imprimer
        // ses sous-champs (JSON.stringify déverserait des coef. de calage). On rend
        // un MARQUEUR NEUTRE — fail-closed, cohérent avec M-3 (formatValue).
        text:
          typeof w === 'string' ? `• ${w}` : '• (avertissement non textuel)',
        fontSize: 8.5,
        color: COLORS.textSec,
        margin: [0, 1, 0, 0],
      }),
    ),
  ];
  return {
    margin: [0, 8, 0, 4],
    table: {
      widths: ['*'],
      body: [[{ stack: lines, margin: [12, 8, 12, 8] }]],
    },
    layout: {
      // filet bordeaux épais à gauche (motif « alerte » maison).
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => COLORS.alert,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
      fillColor: () => COLORS.zebra,
    },
  };
}

function buildFieldRow(
  data: Record<string, unknown>,
  field: PresentedField,
  numberFormat: Record<string, NumberFormat>,
): TableCell[] {
  const raw = resolvePath(data, field.path);
  // fallbackText : valeur littérale (ex. « auto ») — JAMAIS le coefficient brut.
  if (field.fallbackText != null) {
    return [
      { text: field.label, style: 'cell' },
      { text: field.fallbackText, style: 'cellMuted', alignment: 'right' },
      { text: '', style: 'cell' },
    ];
  }
  const fmt = field.format ?? numberFormat[field.path];
  const { value, unit } = formatValue(raw, fmt);
  return [
    { text: field.label, style: 'cell' },
    { text: value, style: 'cell', alignment: 'right' },
    { text: unit, style: 'cellMuted' },
  ];
}

// ---------------------------------------------------------------------------
// Complétude fail-closed (B-1) — énumération des chemins MAPPÉS
// ---------------------------------------------------------------------------

/**
 * Ensemble des CHEMINS explicitement MAPPÉS par le modèle (structure, groupes
 * d'entrée/résultat, critères, verdict). Sert au TEST DE COMPLÉTUDE (whitelist
 * fail-closed) : toute clé scellée doit être mappée OU dans hiddenKeys, sinon le
 * test rougit. AUCUN rendu automatique des champs non mappés (cf. renderRichBody).
 */
export function enumerateMappedPaths(model: PresentationModel): Set<string> {
  const mapped = new Set<string>();
  model.inputGroups.forEach((g) => g.fields.forEach((f) => mapped.add(f.path)));
  model.resultGroups.forEach((g) =>
    g.fields.forEach((f) => mapped.add(f.path)),
  );
  model.criteria.forEach((c) => {
    mapped.add(c.valuePath);
    mapped.add(c.admissiblePath);
  });
  // Les tables PAR COUCHE couvrent leur racine (ex. "couchesTraitees") : chaque
  // sous-clé d'élément est rendue via le spec, la racine suffit à la complétude.
  (model.layerTables ?? []).forEach((lt) => mapped.add(lt.arrayPath));
  mapped.add(model.verdict.key);
  if (model.structure) {
    mapped.add(model.structure.layersPath);
    mapped.add(model.structure.subgradePath);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Helpers de mise en forme
// ---------------------------------------------------------------------------

function sectionTitleRich(label: string): Content {
  return {
    text: label.toUpperCase(),
    style: 'section',
    margin: [0, 14, 0, 6],
  };
}

/**
 * Cellule picto VERDICT (coche/croix) dessinée en CANVAS — Roboto ne fournit pas
 * U+2713/U+2717 (sinon carrés « glyphe manquant »). Coche navy = OK ; croix
 * bordeaux = non vérifié. Discret (8x8 pt), déterministe, sans dépendance de fonte.
 */
function verdictMarkCell(ok: boolean, fill?: string): TableCell {
  const color = ok ? COLORS.navy : COLORS.alert;
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): CanvasLine => ({
    type: 'line',
    x1,
    y1,
    x2,
    y2,
    lineWidth: 1.3,
    lineColor: color,
  });
  const canvas: CanvasLine[] = ok
    ? // coche : descente puis remontée
      [line(1, 5, 3.5, 7.5), line(3.5, 7.5, 8, 1.5)]
    : // croix : deux diagonales
      [line(1, 1, 8, 8), line(8, 1, 1, 8)];
  return {
    fillColor: fill,
    margin: [0, 2, 0, 0],
    alignment: 'center',
    canvas,
  };
}

interface CanvasLine {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineWidth: number;
  lineColor: string;
}

/** Layout de table riche : filets horizontaux légers #d0d8e4, pas de vLine. */
function richTableLayout() {
  return {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 0.7 : 0.4,
    vLineWidth: () => 0,
    hLineColor: () => COLORS.ruleSoft,
    paddingTop: () => 3,
    paddingBottom: () => 3,
    paddingLeft: () => 6,
    paddingRight: () => 6,
  };
}
