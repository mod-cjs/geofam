import type { Content, TableCell } from 'pdfmake/interfaces';

import type { SealedContent } from '../pv-pdf';
import { COLORS } from '../pv-pdf.theme';

import { formatValue, resolvePath, workRate } from './format';
import type {
  CriterionSpec,
  DetailReportSpec,
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

  // 3ter) RAPPORT DÉTAILLÉ DE CALCUL (annexe) — équivalent du « Rapport détaillé »
  //    (renderDetails) de l'outil client : grandeurs de sortie whitelistées
  //    (`details.*`) affichées à l'écran (détails-transparents, ADR 0014). Rendu
  //    fail-closed : omis si `details` absent (chemin d'erreur) ou sans valeur finie.
  if (model.detailReport) {
    body.push(...buildDetailReport(output, model.detailReport));
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

/**
 * Présentation EFFECTIVE d'un critère, résolue depuis la donnée scellée :
 *  - `requis` : le critère est-il PLIÉ dans `conforme` ? (requisPath -> booléen de
 *    verdict public §8). `false` = INFORMATIF : pas de picto ✓/✗, exclu du bandeau,
 *    jamais dominant -> ne peut PAS contredire le verdict scellé. Absent -> requis.
 *  - `label`/`format` : variante RIGIDE (MTLH/béton, σt MPa) quand rigideFlagPath
 *    résout `true` (MAJEUR-2), sinon le libellé/format bitumineux (εt µdef). Le flag
 *    lui-même n'est jamais rendu (§8) — seul le libellé/format change.
 */
interface EffectiveCriterion {
  label: string;
  format?: NumberFormat;
  requis: boolean;
}
function effectiveCriterion(
  output: Record<string, unknown>,
  c: CriterionSpec,
): EffectiveCriterion {
  const rigide = c.rigideFlagPath
    ? resolvePath(output, c.rigideFlagPath) === true
    : false;
  return {
    label: rigide && c.rigideLabel ? c.rigideLabel : c.label,
    format: rigide && c.rigideFormat ? c.rigideFormat : c.format,
    // fail-safe : seul un `false` EXPLICITE dégrade en informatif (absent -> requis).
    requis: c.requisPath ? resolvePath(output, c.requisPath) !== false : true,
  };
}

function buildVerdictBanner(
  output: Record<string, unknown>,
  model: PresentationModel,
): Content {
  // Le booléen SCELLÉ est CONSOMMÉ ici (jamais recalculé, jamais affiché en ligne).
  const conforme = resolvePath(output, model.verdict.key) === true;
  const label = conforme ? model.verdict.labelTrue : model.verdict.labelFalse;
  const fill = conforme ? COLORS.navy : COLORS.alert;

  // Colonnes internes : verdict 40 % + un encart par critère DIMENSIONNANT (taux de
  // travail). Les critères INFORMATIFS (requis=false) sont EXCLUS du bandeau : leur
  // taux (ex. 253 % d'une phase 2 non exigée) ne doit pas cohabiter avec CONFORME.
  const criteriaCols: Content[] = activeCriteria(output, model)
    .map((c) => ({ c, eff: effectiveCriterion(output, c) }))
    .filter(({ eff }) => eff.requis)
    .map(({ c, eff }) => {
      const value = resolvePath(output, c.valuePath);
      const adm = resolvePath(output, c.admissiblePath);
      const rate = workRate(value, adm);
      const rateText = rate == null ? '—' : `${Math.round(rate)} %`;
      return {
        width: '*',
        stack: [
          { text: eff.label, color: COLORS.white, fontSize: 7 },
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
    const eff = effectiveCriterion(output, c);
    const value = resolvePath(output, c.valuePath);
    const adm = resolvePath(output, c.admissiblePath);
    const rate = workRate(value, adm);
    const ok = rate != null && rate <= 100;
    const v = formatValue(value, eff.format);
    const a = formatValue(adm, eff.format);
    return {
      label: eff.label,
      calc: `${v.value} ${v.unit}`.trim(),
      adm: `${a.value} ${a.unit}`.trim(),
      rate,
      rateText: rate == null ? '—' : `${Math.round(rate)} %`,
      ok,
      requis: eff.requis,
    };
  });

  // critère dimensionnant = taux max PARMI LES CRITÈRES REQUIS (un critère
  // informatif ne peut pas être « dimensionnant » ni contredire le verdict).
  let maxRate = -Infinity;
  for (const r of rows)
    if (r.requis && r.rate != null && r.rate > maxRate) maxRate = r.rate;

  const tbody: TableCell[][] = [head];
  for (const r of rows) {
    const dominant = r.requis && r.rate != null && r.rate === maxRate;
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
      // REQUIS -> picto verdict ✓/✗ (canvas vectoriel : Roboto n'a pas U+2713/U+2717).
      // INFORMATIF (requis=false) -> marqueur neutre « informatif » (AUCUN picto
      // ✓/✗) : un critère non exigé ne peut JAMAIS afficher un ✗ contredisant le
      // bandeau CONFORME (MAJEUR-1). Discret, PAS d'emoji.
      r.requis ? verdictMarkCell(r.ok, fill) : informativeMarkCell(fill),
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
    // Élément INFORMATIF (requis=false) : ε_z granulaire exempté (§4.1.2) — pas de
    // picto ✓/✗, il ne peut pas contredire le bandeau CONFORME (MAJEUR-1). Absent /
    // undefined -> requis (verdict normal).
    const requis =
      spec.requisKey != null ? row[spec.requisKey] !== false : true;

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
    cells.push(requis ? verdictMarkCell(ok) : informativeMarkCell());
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
// Rapport détaillé de calcul (annexe — équivalent renderDetails)
// ---------------------------------------------------------------------------

/**
 * RAPPORT DÉTAILLÉ (annexe) — miroir du « Rapport détaillé » (renderDetails) de
 * l'outil client : rend les GRANDEURS de sortie whitelistées (`details.*`) que
 * l'outil affiche déjà (contraintes σ, déformations ε, coefficients LCPC) — pas la
 * méthode. FAIL-CLOSED (DoD §8) :
 *  - omis en bloc si l'objet racine (`details`) est absent (chemin d'erreur) ;
 *  - chaque champ est lu NOMMÉMENT (jamais de copie d'objet brut) ;
 *  - un champ non fini est OMIS (pas de « — » de bruit) ;
 *  - une section sans aucune valeur finie est OMISE ;
 * -> une famille sans couche liée (granulaire) n'imprime pas de fatigue fantôme.
 * Les admissibles basculent µdef->MPa pour les familles rigides (rigideFormat).
 */
function buildDetailReport(
  output: Record<string, unknown>,
  spec: DetailReportSpec,
): Content[] {
  const root = resolvePath(output, spec.rootPath);
  if (root == null || typeof root !== 'object') return []; // fail-closed

  const rigide = spec.rigideFlagPath
    ? resolvePath(output, spec.rigideFlagPath) === true
    : false;

  const blocks: Content[] = [];
  for (const section of spec.sections) {
    const rows: TableCell[][] = [];
    // Sous-titre de section (cellule fusionnée 3 colonnes).
    rows.push([
      {
        text: section.title,
        colSpan: 3,
        fillColor: COLORS.groupFill71,
        bold: true,
        color: COLORS.navy,
        fontSize: 8.5,
      },
      {},
      {},
    ]);
    let hasValue = false;
    for (const f of section.fields) {
      const raw = resolvePath(output, f.path);
      // Fail-closed : n'imprimer QUE des grandeurs finies (pas de « — » de bruit).
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      hasValue = true;
      const fmt = rigide && f.rigideFormat ? f.rigideFormat : f.format;
      const { value, unit } = formatValue(raw, fmt);
      rows.push([
        { text: f.label, style: 'cell' },
        { text: value, style: 'cell', alignment: 'right' },
        { text: unit, style: 'cellMuted' },
      ]);
    }
    // Section VIDE (aucune valeur finie) -> omise (pas de sous-titre orphelin).
    if (!hasValue) continue;
    blocks.push({
      unbreakable: rows.length <= 12,
      margin: [0, 2, 0, 4],
      table: { widths: ['*', 'auto', 'auto'], body: rows },
      layout: richTableLayout(),
    });
  }

  // Aucune section rendue -> aucune annexe (fail-closed complet).
  if (blocks.length === 0) return [];

  const head: Content[] = [sectionTitleRich(spec.title)];
  if (spec.subtitle) {
    head.push({
      text: spec.subtitle,
      style: 'cellMuted',
      fontSize: 8,
      margin: [0, 0, 0, 4],
    });
  }
  return [...head, ...blocks];
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
    // Les flags de VERDICT consommés par le critère (requis/rigide) sont « décidés »
    // (lus par la logique de rendu) : ils comptent comme mappés pour la complétude.
    if (c.requisPath) mapped.add(c.requisPath);
    if (c.rigideFlagPath) mapped.add(c.rigideFlagPath);
  });
  // Les tables PAR COUCHE couvrent leur racine (ex. "couchesTraitees") : chaque
  // sous-clé d'élément est rendue via le spec, la racine suffit à la complétude.
  (model.layerTables ?? []).forEach((lt) => mapped.add(lt.arrayPath));
  // Rapport détaillé (annexe) : chaque grandeur `details.*` rendue est mappée ; le
  // flag rigide consommé pour l'unité (rigideFlagPath) compte aussi comme décidé.
  if (model.detailReport) {
    model.detailReport.sections.forEach((s) =>
      s.fields.forEach((f) => mapped.add(f.path)),
    );
    if (model.detailReport.rigideFlagPath) {
      mapped.add(model.detailReport.rigideFlagPath);
    }
  }
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

/**
 * Cellule NEUTRE d'un critère INFORMATIF (non requis) : aucun picto ✓/✗ — juste un
 * libellé sobre « informatif ». Un critère non exigé pour la structure ne porte
 * PAS de verdict et ne peut donc pas contredire le bandeau CONFORME (MAJEUR-1).
 * Le mot « informatif » ne fuite aucun flag de méthode (§8, verdict public).
 */
function informativeMarkCell(fill?: string): TableCell {
  return {
    text: 'informatif',
    style: 'cellMuted',
    fontSize: 6.5,
    alignment: 'center',
    fillColor: fill,
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
