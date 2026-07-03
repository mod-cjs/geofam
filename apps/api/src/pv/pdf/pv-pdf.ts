import type { OfficialPv } from '@prisma/client';
import { sealContentHash, verifySeal } from '@roadsen/shared';
import type {
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import { getPvPrinter } from './pv-pdf.fonts';
import { COLORS, FINE_TABLE_LAYOUT, PV_STYLES } from './pv-pdf.theme';
import { findPresentationModel } from './pv-presentation';
import { renderRichBody } from './pv-presentation/render';

/**
 * GENERATEUR DE PDF DU PV SCELLE (#63, incr. C) — design maison ROADSEN.
 *
 * Le PDF est RENDU UNIQUEMENT depuis l'`official_pv` scellé : numéro, sealed_at,
 * méta moteur, identité, input (issu de input_canonical), output, content_hash.
 * REGENERABLE : à partir du MÊME official_pv, le CONTENU est identique (aucune
 * source non-déterministe — pas de Date.now(), le `creationDate` PDF est figé sur
 * sealed_at pour limiter la variation d'octets). Le sceau porte sur les DONNEES,
 * pas sur les octets du PDF.
 *
 * AUCUN bandeau / mention « science_status / @science-unsigned » (décision
 * titulaire) — le champ existe en base mais N'EST PAS rendu.
 */

/** Contenu scellé tel que sérialisé dans input_canonical (cf. PvService). */
export interface SealedContent {
  pvNumber: string;
  sealedAt: string;
  engineMeta: {
    engineId: string;
    engineVersion: string;
    engineSourceHash?: string;
  };
  identity: {
    userId: string;
    /** Nom de l'emetteur (SCELLE) ; '' si non renseigne -> « (identité non renseignée) ». */
    userDisplayName?: string;
    /** Organisation emettrice (SCELLE) — provenance / visa du PV. */
    orgDisplayName?: string;
    projectId: string;
    projectName: string;
  };
  input: unknown;
  output: unknown;
  scienceStatus: string;
  /**
   * Verdict SCELLE (ADR 0012) : CONFORME / NON_CONFORME / NON_APPLICABLE. Champ
   * de 1er niveau du contenu canonique. Le rendu du MARQUAGE NON CONFORME
   * (bandeau + filigrane, ADR 0012 §2) consomme ce champ — suivi a faire cote
   * presentation/PDF. Defaut 'NON_APPLICABLE' si absent (PV recette pre-0012).
   */
  verdict: string;
}

/**
 * Collecte TOUT le texte rendu par la docDefinition (en-tête, corps, pied,
 * tableaux), dans l'ordre de l'arbre. Sert à PROUVER, sans parseur PDF binaire
 * fragile, que le document CONTIENT bien les données scellées clés (numéro de PV,
 * empreinte SHA-256, ≥1 résultat). Le texte rendu = ce que voit le lecteur.
 */
export function collectPvPdfText(pv: OfficialPv): string {
  const def = buildPvDocDefinition(pv);
  const out: string[] = [];
  // header/footer sont des fonctions DynamicContent (currentPage,pageCount,pageSize)
  // -> on les évalue sur la page 1 pour collecter leur texte.
  const pageSize = {
    width: 595,
    height: 842,
    orientation: 'portrait' as const,
  };
  if (typeof def.header === 'function')
    walkText(def.header(1, 1, pageSize), out);
  if (typeof def.footer === 'function')
    walkText(def.footer(1, 1, pageSize), out);
  walkText(def.content, out);
  return out.join('\n');
}

function walkText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) walkText(n, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    else if (o.text != null) walkText(o.text, out);
    if (o.stack) walkText(o.stack, out);
    if (o.columns) walkText(o.columns, out);
    if (o.table && typeof o.table === 'object') {
      const t = o.table as { body?: unknown };
      if (t.body) walkText(t.body, out);
    }
  }
}

/**
 * MODÈLE DE RENDU — SOURCE UNIQUE (CRIT-1). Tout le contenu rendu en dérive ;
 * AUCUNE colonne hors-sceau (pv.output / pv.pvNumber / pv.contentHash…) n'est lue
 * pour le corps du document. Le seul rôle de `pv` au-delà de input_canonical est
 * de porter content_hash + hmac, qui servent à VÉRIFIER le sceau (pas à afficher).
 */
interface RenderModel {
  sealed: SealedContent;
  /** Hash RECALCULÉ depuis la canonique (= ce qui est imprimé, pas la colonne). */
  recomputedHash: string;
  /** Horodatage de scellement (Date), dérivé de la canonique. */
  sealedAt: Date;
}

/**
 * Dérive le modèle de rendu depuis input_canonical, EN FAIL-CLOSED :
 *  1) parse STRICT de input_canonical (throw si illisible — pas de rendu dégradé) ;
 *  2) recalcule le hash de contenu depuis la canonique ;
 *  3) verifySeal(canonique, content_hash, hmac, secret) DOIT passer — sinon throw.
 *
 * @throws si le secret est absent, le sceau invalide, ou la canonique illisible.
 */
function buildRenderModel(pv: OfficialPv): RenderModel {
  const secret = process.env.PV_SIGNING_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      'Rendu PV impossible : secret de scellement (PV_SIGNING_SECRET) absent.',
    );
  }

  // 1) PARSE STRICT — pas de repli sur les colonnes (CRIT-1). Une canonique
  //    illisible est une anomalie d'intégrité : on REFUSE de rendre.
  let sealed: SealedContent;
  try {
    sealed = parseSealedStrict(pv.inputCanonical);
  } catch (err) {
    throw new Error(
      `Rendu PV impossible : input_canonical illisible (intégrité) — ${(err as Error).message}`,
    );
  }

  // 2) HASH RECALCULÉ depuis la canonique (= ce qui sera imprimé).
  const recomputedHash = sealContentHash(pv.inputCanonical);

  // 3) VÉRIFICATION DU SCEAU AVANT TOUT RENDU (fail-closed). On confronte la
  //    canonique aux content_hash + hmac STOCKÉS : si l'un a été altéré, ou si le
  //    corps ne correspond plus, on REFUSE de produire un PDF « officiel » dégradé.
  if (!verifySeal(pv.inputCanonical, pv.contentHash, pv.hmac, secret)) {
    throw new Error(
      'Rendu PV refusé : sceau invalide (intégrité non vérifiée) — fail-closed.',
    );
  }

  // sealedAt dérivé de la canonique (source unique), pas de pv.sealedAt.
  const sealedAt = new Date(sealed.sealedAt);
  return { sealed, recomputedHash, sealedAt };
}

/** Génère le PDF du PV et le résout en Buffer. FAIL-CLOSED si sceau invalide. */
export function renderPvPdf(pv: OfficialPv): Promise<Buffer> {
  // buildPvDocDefinition vérifie le sceau (fail-closed) AVANT de construire quoi
  // que ce soit. Un sceau invalide rejette la promesse (aucun octet produit).
  let docDef: TDocumentDefinitions;
  try {
    docDef = buildPvDocDefinition(pv);
  } catch (err) {
    return Promise.reject(err as Error);
  }
  const printer = getPvPrinter();
  const doc = printer.createPdfKitDocument(docDef);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Construit la docDefinition pdfmake (testable sans générer les octets).
 * SOURCE UNIQUE = input_canonical (CRIT-1) ; FAIL-CLOSED via buildRenderModel.
 */
export function buildPvDocDefinition(pv: OfficialPv): TDocumentDefinitions {
  const model = buildRenderModel(pv);
  const { sealed, recomputedHash, sealedAt } = model;

  return {
    pageSize: 'A4',
    pageMargins: [40, 84, 40, 56],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: COLORS.text },
    info: {
      title: `Procès-verbal ${sealed.pvNumber}`,
      author: 'ROADSEN',
      subject: `Calcul ${sealed.engineMeta.engineId} v${sealed.engineMeta.engineVersion}`,
      // creationDate figée sur sealedAt (canonique) -> déterminisme des octets.
      creationDate: sealedAt,
    },
    // EN-TETE REPETE toutes les pages (numéro de PV + date de scellement).
    header: () => buildHeader(sealed, sealedAt),
    // PIED REPETE : numéro + pagination + confidentialité.
    footer: (currentPage: number, pageCount: number) =>
      buildFooter(sealed, currentPage, pageCount),
    content: [
      buildIdentityCards(sealed),
      buildObjet(sealed),
      // PRÉSENTATION MÉTIER (#71) si le moteur a un modèle ; sinon FALLBACK propre.
      ...buildBody(sealed),
      buildSealBlock(sealed, recomputedHash),
    ],
    styles: PV_STYLES,
  };
}

/**
 * Corps du document : présentation MÉTIER riche si un PresentationModel existe
 * pour le moteur (#71), sinon FALLBACK table clé-valeur propre. Les deux dérivent
 * de la donnée SCELLÉE uniquement (CRIT-1 préservé).
 */
function buildBody(sealed: SealedContent): Content[] {
  const engineId = sealed.engineMeta.engineId;
  const model = findPresentationModel(engineId);
  if (model) {
    return renderRichBody(sealed, model);
  }
  // Présentation métier dédiée fondation superficielle (terzaghi) — note de calcul
  // structurée (bandeau verdict + entrées + vérifications par cas), pas un vidage.
  if (engineId === 'fondation-superficielle') {
    return buildFondationBody(sealed);
  }
  if (engineId === 'fondation-profonde-pieux') {
    return buildFonProfondeBody(sealed);
  }
  if (engineId === 'radier-plaque') {
    return buildRadierBody(sealed);
  }
  if (engineId === 'labo-classification-gtr') {
    return buildLaboBody(sealed);
  }
  if (engineId === 'pressiometre-menard') {
    return buildPressiometreBody(sealed);
  }
  // FALLBACK générique : table clé-valeur propre (sans lignes-bruit), input puis output.
  return [
    sectionTitle('Données d’entrée'),
    buildKeyValueTable(sealed.input, 'Aucune donnée d’entrée enregistrée.'),
    sectionTitle('Résultats'),
    // MAJ-2 (frontière de confidentialité) : `output` a déjà été WHITELISTÉ en
    // amont — projectEngineOutput(contract.outputSchema) au moment du calcul puis
    // figé dans input_canonical au scellement. Le PDF NE RE-RÉDIGE PAS.
    buildKeyValueTable(sealed.output, 'Aucun résultat enregistré.'),
  ];
}

// ---------------------------------------------------------------------------
// Présentation « fondation superficielle » (terzaghi / NF P 94-261)
// ---------------------------------------------------------------------------
// CONFIDENTIALITÉ (DoD §8) : lecture par clés NOMMÉES uniquement (fail-closed) ;
// la sortie est déjà whitelistée par TerzaghiOutputSchema au calcul ; l'entrée est
// la donnée de l'utilisateur. Aucun champ non nommé n'est rendu.

const FDN_FORME: Record<string, string> = {
  filante: 'Semelle filante',
  carree: 'Semelle carrée',
  rect: 'Semelle rectangulaire',
  circ: 'Semelle circulaire',
};
const FDN_SOL: Record<string, string> = {
  argiles: 'Argiles',
  sables: 'Sables',
  craies: 'Craies',
  marnes: 'Marnes',
  roches: 'Roches',
};
const FDN_ESSAI: Record<string, string> = {
  pressio: 'Pressiomètre Ménard',
  penetro: 'Pénétromètre statique (CPT)',
  labo: 'Paramètres de laboratoire (c–φ)',
};
const FDN_ETAT: Record<string, string> = {
  ELU_F: 'ELU fondamental',
  ELU_A: 'ELU accidentel',
  ELS_C: 'ELS caractéristique',
  ELS_F: 'ELS fréquent',
  ELS_QP: 'ELS quasi-permanent',
};

/** Nombre → texte fr-FR (espaces normalisées), sinon « — ». */
function fdnNum(v: unknown, decimals: number, unit?: string): string {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n)) return '—';
  const s = n
    .toLocaleString('fr-FR', { maximumFractionDigits: decimals })
    .replace(/[  ]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}

function fdnFirstFinite(...vals: unknown[]): number | null {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function fdnSubTitle(label: string): Content {
  return { text: label, style: 'groupRow', margin: [0, 8, 0, 3] };
}

function fdnHead(text: string, align: 'left' | 'right' | 'center' = 'left'): TableCell {
  return { text, style: 'tableHead', alignment: align };
}

function buildFondationVerdictBanner(verdict: string): Content {
  const v =
    verdict === 'CONFORME'
      ? { label: 'CONFORME', fill: COLORS.navy }
      : verdict === 'NON_CONFORME'
        ? { label: 'NON CONFORME', fill: COLORS.alert }
        : { label: 'NON APPLICABLE', fill: COLORS.muted };
  return {
    margin: [0, 10, 0, 6],
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: `Verdict : ${v.label}`,
            color: COLORS.white,
            bold: true,
            fontSize: 12,
            fillColor: v.fill,
            margin: [12, 8, 12, 8],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

function buildFondationBody(sealed: SealedContent): Content[] {
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const output = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];

  body.push(buildFondationVerdictBanner(sealed.verdict));

  // 1) ENTRÉES — géométrie & sol (table clé/valeur)
  body.push(sectionTitle('Données d’entrée'));
  const geo: TableCell[][] = [[fdnHead('Paramètre'), fdnHead('Valeur', 'right')]];
  const kv = (p: string, val: string): void => {
    geo.push([
      { text: p, style: 'cell' },
      { text: val, style: 'cell', alignment: 'right' },
    ]);
  };
  kv('Forme de la fondation', FDN_FORME[String(input.forme)] ?? String(input.forme ?? '—'));
  kv('Largeur B', fdnNum(input.B, 2, 'm'));
  if (input.L != null && input.L !== '') kv('Longueur L', fdnNum(input.L, 2, 'm'));
  kv('Profondeur d’encastrement D', fdnNum(input.D, 2, 'm'));
  kv('Catégorie de sol', FDN_SOL[String(input.solCat)] ?? String(input.solCat ?? '—'));
  kv('Type d’essai', FDN_ESSAI[String(input.essai)] ?? String(input.essai ?? '—'));
  kv('Poids volumique γ (avant travaux)', fdnNum(input.gAvant, 1, 'kN/m³'));
  kv('Poids volumique γ (après travaux)', fdnNum(input.gApres, 1, 'kN/m³'));
  body.push({
    table: { headerRows: 1, widths: ['*', 'auto'], body: geo },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // Profil de sondage
  const sondage = (Array.isArray(input.sondage) ? input.sondage : []).filter(
    isPlainObject,
  ) as Record<string, unknown>[];
  if (sondage.length > 0) {
    const sb: TableCell[][] = [
      [
        fdnHead('Profondeur z', 'right'),
        fdnHead('pl* (MPa)', 'right'),
        fdnHead('EM (MPa)', 'right'),
        fdnHead('qc (MPa)', 'right'),
      ],
    ];
    for (const s of sondage) {
      sb.push([
        { text: fdnNum(s.z, 2, 'm'), style: 'cell', alignment: 'right' },
        { text: fdnNum(s.pl, 2), style: 'cell', alignment: 'right' },
        { text: fdnNum(s.em, 1), style: 'cell', alignment: 'right' },
        { text: fdnNum(s.qc, 1), style: 'cell', alignment: 'right' },
      ]);
    }
    body.push(fdnSubTitle('Profil de sondage'));
    body.push({
      table: { headerRows: 1, widths: ['*', '*', '*', '*'], body: sb },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Cas de charge
  const charges = (Array.isArray(input.charges) ? input.charges : []).filter(
    isPlainObject,
  ) as Record<string, unknown>[];
  if (charges.length > 0) {
    const cb: TableCell[][] = [
      [
        fdnHead('État-limite'),
        fdnHead('Fz (kN)', 'right'),
        fdnHead('Fx (kN)', 'right'),
        fdnHead('Fy (kN)', 'right'),
      ],
    ];
    for (const c of charges) {
      cb.push([
        { text: FDN_ETAT[String(c.etat)] ?? String(c.etat ?? '—'), style: 'cell' },
        { text: fdnNum(c.fz, 0), style: 'cell', alignment: 'right' },
        { text: fdnNum(c.fx, 0), style: 'cell', alignment: 'right' },
        { text: fdnNum(c.fy, 0), style: 'cell', alignment: 'right' },
      ]);
    }
    body.push(fdnSubTitle('Cas de charge'));
    body.push({
      table: { headerRows: 1, widths: ['*', '*', '*', '*'], body: cb },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 2) RÉSULTATS — vérifications par cas
  body.push(sectionTitle('Résultats — vérifications'));
  const cas = (Array.isArray(output.cas) ? output.cas : []).filter(
    (c) => isPlainObject(c) && (c as Record<string, unknown>).invalide !== true,
  ) as Record<string, unknown>[];

  if (cas.length === 0) {
    body.push({
      text: 'Aucun cas de vérification exploitable.',
      style: 'cellMuted',
      margin: [0, 2, 0, 6],
    });
  } else {
    // Portance (toujours)
    const rb: TableCell[][] = [
      [
        fdnHead('État-limite'),
        fdnHead('Résistance Rᵥ;d (kN)', 'right'),
        fdnHead('Contrainte q_Rv;d (kPa)', 'right'),
        fdnHead('Taux', 'right'),
        fdnHead('Portance', 'center'),
      ],
    ];
    for (const c of cas) {
      const ok = c.portanceOk === true;
      const taux =
        typeof c.taux === 'number' && Number.isFinite(c.taux)
          ? `${Math.round(c.taux * 100)} %`
          : '—';
      rb.push([
        { text: FDN_ETAT[String(c.etat)] ?? String(c.etat ?? '—'), style: 'cell' },
        { text: fdnNum(c.Rtot, 1), style: 'cell', alignment: 'right' },
        { text: fdnNum(c.qRvd, 1), style: 'cell', alignment: 'right' },
        { text: taux, style: 'cell', alignment: 'right' },
        {
          text: ok ? '✓ OK' : '✗ NON',
          style: 'cell',
          alignment: 'center',
          bold: true,
          color: ok ? COLORS.navy : COLORS.alert,
        },
      ]);
    }
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: rb },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });

    // Glissement (si évalué sur ≥1 cas)
    const glissCas = cas.filter((c) => c.Rhd != null);
    if (glissCas.length > 0) {
      const gb: TableCell[][] = [
        [
          fdnHead('État-limite'),
          fdnHead('Résistance R_h;d (kN)', 'right'),
          fdnHead('Taux', 'right'),
          fdnHead('Glissement', 'center'),
        ],
      ];
      for (const c of glissCas) {
        const gok = c.glissementOk === true;
        const tH =
          typeof c.tauxH === 'number' && Number.isFinite(c.tauxH)
            ? `${Math.round(c.tauxH * 100)} %`
            : '—';
        gb.push([
          { text: FDN_ETAT[String(c.etat)] ?? String(c.etat ?? '—'), style: 'cell' },
          { text: fdnNum(c.Rhd, 1), style: 'cell', alignment: 'right' },
          { text: tH, style: 'cell', alignment: 'right' },
          {
            text: gok ? '✓ OK' : '✗ NON',
            style: 'cell',
            alignment: 'center',
            bold: true,
            color: gok ? COLORS.navy : COLORS.alert,
          },
        ]);
      }
      body.push(fdnSubTitle('Vérification au glissement'));
      body.push({
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: gb },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }

    // Tassements (si calculés sur ≥1 cas)
    const tassCas = cas.filter(
      (c) =>
        c.tassement != null ||
        c.tassementSchmertmann != null ||
        c.tassementOed != null ||
        c.tassementElastique != null,
    );
    if (tassCas.length > 0) {
      const tb: TableCell[][] = [
        [fdnHead('État-limite'), fdnHead('Tassement estimé (m)', 'right')],
      ];
      for (const c of tassCas) {
        const t = fdnFirstFinite(
          c.tassement,
          c.tassementSchmertmann,
          c.tassementOed,
          c.tassementElastique,
        );
        tb.push([
          { text: FDN_ETAT[String(c.etat)] ?? String(c.etat ?? '—'), style: 'cell' },
          { text: fdnNum(t, 3), style: 'cell', alignment: 'right' },
        ]);
      }
      body.push(fdnSubTitle('Estimation des tassements'));
      body.push({
        table: { headerRows: 1, widths: ['*', 'auto'], body: tb },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }
  }

  // Avertissements (déjà rédigés/whitelistés côté moteur)
  const warnings = output.warnings;
  if (Array.isArray(warnings) && warnings.length > 0) {
    body.push(fdnSubTitle('Avertissements'));
    body.push({
      text: warnings.map((w) => String(w)).join(' · '),
      style: 'cellMuted',
      color: COLORS.accent,
      margin: [0, 2, 0, 4],
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Présentation « fondation profonde » (pieux / NF P 94-262, EC7)
// ---------------------------------------------------------------------------
const PIEUX_METH: Record<string, string> = {
  pmt: 'Pressiomètre Ménard (PMT)',
  cpt: 'Pénétromètre statique (CPT)',
  cphi: 'Paramètres de laboratoire (c–φ)',
};
const PIEUX_SENS: Record<string, string> = {
  comp: 'Compression',
  trac: 'Traction',
};

/**
 * Allowlist fail-closed du libellé de vérification pieux au PV (miroir serveur de
 * safePieuxVerifLabel côté front, apps/web adapters.ts). Le PV est la surface la PLUS
 * sensible (scellée, remise au client) : le `nom` de vérification (texte libre du moteur,
 * borné en longueur mais PAS en contenu par CheckSchema) ne doit s'imprimer que s'il est
 * reconnu (état-limite + combinaison EC7 whitelistés), sinon libellé générique indexé —
 * aucun texte moteur non whitelisté sur un livrable client (DoD §8).
 */
const PV_PIEUX_ELS_LABELS: ReadonlySet<string> = new Set(['ELS caractéristique', 'ELS quasi-permanent']);
const PV_PIEUX_ELU_PREFIXES: ReadonlySet<string> = new Set(['ELU portance', 'ELU traction']);
const PV_PIEUX_ELU_COMBOS: ReadonlySet<string> = new Set(['DA1·C1', 'DA1·C2', 'DA2', 'DA3']);
function safePieuxVerifLabelPv(rawNom: unknown, index: number): string {
  const fallback = `Vérification ${index}`;
  if (typeof rawNom !== 'string') return fallback;
  if (PV_PIEUX_ELS_LABELS.has(rawNom)) return rawNom;
  const sep = rawNom.indexOf(' — ');
  if (sep > 0) {
    const prefix = rawNom.slice(0, sep);
    const combo = rawNom.slice(sep + 3);
    if (PV_PIEUX_ELU_PREFIXES.has(prefix) && PV_PIEUX_ELU_COMBOS.has(combo)) return rawNom;
  }
  return fallback;
}

function buildFonProfondeBody(sealed: SealedContent): Content[] {
  const output = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];

  body.push(buildFondationVerdictBanner(sealed.verdict));

  // 1) Caractéristiques du pieu (échos d'entrée whitelistés)
  body.push(sectionTitle('Caractéristiques du pieu'));
  const geo: TableCell[][] = [[fdnHead('Paramètre'), fdnHead('Valeur', 'right')]];
  const kv = (p: string, val: string): void => {
    geo.push([
      { text: p, style: 'cell' },
      { text: val, style: 'cell', alignment: 'right' },
    ]);
  };
  kv('Diamètre / largeur B', fdnNum(output.B, 2, 'm'));
  kv('Profondeur de base D', fdnNum(output.D, 2, 'm'));
  kv('Catégorie de pieu', fdnNum(output.categorie, 0));
  kv('Méthode de portance', PIEUX_METH[String(output.methode)] ?? String(output.methode ?? '—'));
  kv('Sens de sollicitation', PIEUX_SENS[String(output.sens)] ?? String(output.sens ?? '—'));
  body.push({
    table: { headerRows: 1, widths: ['*', 'auto'], body: geo },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // 2) Résistances de calcul
  body.push(sectionTitle('Résistances de calcul'));
  const rb: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  const rr = (p: string, v: unknown): void => {
    const n = fdnNum(v, 1, 'kN');
    if (n !== '—') rb.push([{ text: p, style: 'cell' }, { text: n, style: 'cell', alignment: 'right' }]);
  };
  rr('Résistance de pointe Rb;k', output.RbK);
  rr('Résistance de frottement Rs;k', output.RsK);
  rr('Résistance caractéristique Rc;k', output.RcK);
  rr('Résistance de calcul Rc;d', output.RcD);
  rr('Résistance de fluage Rc;cr;k', output.RcrK);
  body.push({
    table: { headerRows: 1, widths: ['*', 'auto'], body: rb },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // 3) Sollicitations & vérification
  body.push(sectionTitle('Sollicitations & vérification'));
  const okElu = output.allOk === true;
  const sb: TableCell[][] = [
    [
      fdnHead('Combinaison'),
      fdnHead('Sollicitation Fd (kN)', 'right'),
      fdnHead('Résistance (kN)', 'right'),
      fdnHead('Vérif.', 'center'),
    ],
  ];
  const checkRow = (nom: string, fd: unknown, rd: unknown): void => {
    const f = typeof fd === 'number' && Number.isFinite(fd) ? fd : null;
    const r = typeof rd === 'number' && Number.isFinite(rd) ? rd : null;
    if (f === null && r === null) return;
    const ok = f !== null && r !== null ? f <= r : okElu;
    sb.push([
      { text: nom, style: 'cell' },
      { text: fdnNum(fd, 0), style: 'cell', alignment: 'right' },
      { text: fdnNum(rd, 0), style: 'cell', alignment: 'right' },
      {
        text: ok ? '✓ OK' : '✗ NON',
        style: 'cell',
        alignment: 'center',
        bold: true,
        color: ok ? COLORS.navy : COLORS.alert,
      },
    ]);
  };
  const verifs = Array.isArray(output.verifications) ? output.verifications : [];
  if (verifs.length > 0) {
    let vi = 0;
    for (const v of verifs) {
      if (v === null || typeof v !== 'object') continue;
      const c = v as Record<string, unknown>;
      vi += 1;
      checkRow(safePieuxVerifLabelPv(c.nom, vi), c.Fd, c.Rd);
    }
  } else {
    // Combinaisons standard depuis les échos scellés.
    checkRow('ELU — portance (DA2)', output.FduELU, output.RcD);
    checkRow('ELS caractéristique — fluage', output.FdCar, output.RcrCar);
    checkRow('ELS quasi-permanent — fluage', output.FdQp, output.RcrQp);
  }
  if (sb.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: sb },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 4) Tassement ELS (si estimé)
  const tass = fdnNum(output.tassementELS, 1, 'mm');
  if (tass !== '—') {
    body.push(fdnSubTitle('Tassement (ELS)'));
    body.push({ text: tass, style: 'cell', margin: [0, 2, 0, 4] });
  }

  // 5) Frottement négatif (downdrag, #94) — si calculé (sinon rien : fail-closed)
  const gsn = fdnNum(output.Gsn, 1, 'kN');
  const nmax = fdnNum(output.Nmax, 1, 'kN');
  const zN = fdnNum(output.pointNeutre, 2, 'm');
  if (gsn !== '—' || nmax !== '—' || zN !== '—') {
    body.push(sectionTitle('Frottement négatif'));
    const fn: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
    const fnRow = (p: string, v: string): void => {
      if (v !== '—') fn.push([{ text: p, style: 'cell' }, { text: v, style: 'cell', alignment: 'right' }]);
    };
    fnRow('Charge de frottement négatif G_sn', gsn);
    fnRow('Effort axial maximal N_max', nmax);
    fnRow('Profondeur du point neutre z_N', zN);
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: fn },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // 6) Vérification structurale du béton (#95) — selon betonApplicable
  if (output.betonApplicable === true) {
    body.push(sectionTitle('Vérification structurale du béton'));
    const bt: TableCell[][] = [
      [fdnHead('Grandeur'), fdnHead('Taux', 'right'), fdnHead('Vérif.', 'center')],
    ];
    const betonRow = (p: string, taux: unknown, ok: unknown): void => {
      const n = typeof taux === 'number' && Number.isFinite(taux) ? taux : null;
      if (n === null) return;
      const isOk = ok === true;
      bt.push([
        { text: p, style: 'cell' },
        { text: fdnNum(n * 100, 0, '%'), style: 'cell', alignment: 'right' },
        {
          text: isOk ? '✓ OK' : '✗ NON',
          style: 'cell',
          alignment: 'center',
          bold: true,
          color: isOk ? COLORS.navy : COLORS.alert,
        },
      ]);
    };
    betonRow('Taux béton ELU σ/f_cd', output.betonTauxELU, output.betonOkELU);
    betonRow('Taux béton ELS', output.betonTauxELS, output.betonOkELS);
    if (bt.length > 1) {
      body.push({
        table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: bt },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }
    const fcd = fdnNum(output.betonFcd, 1, 'MPa');
    if (fcd !== '—') {
      body.push({ text: `Résistance de calcul du béton f_cd = ${fcd}`, style: 'cellMuted', margin: [0, 0, 0, 4] });
    }
  } else if (output.betonApplicable === false) {
    body.push(sectionTitle('Vérification structurale du béton'));
    body.push({ text: 'Non applicable pour ce pieu.', style: 'cellMuted', margin: [0, 2, 0, 4] });
  }

  // Avertissements
  const w = output.warnings;
  if (Array.isArray(w) && w.length > 0) {
    body.push(fdnSubTitle('Avertissements'));
    body.push({
      text: w.map((x) => String(x)).join(' · '),
      style: 'cellMuted',
      color: COLORS.accent,
      margin: [0, 2, 0, 4],
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Présentations « analyse » (radier / labo GTR / pressiomètre) — extraction &
// classification, SANS verdict de conformité. Clés nommées (fail-closed, DoD §8).
// ---------------------------------------------------------------------------

/** Bandeau neutre pour les moteurs d'analyse (pas de CONFORME/NON CONFORME). */
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

/** Ajoute une ligne (label/valeur) à un corps de table si la valeur n'est pas « — ». */
function fdnKvRow(rows: TableCell[][], label: string, value: string): void {
  if (value === '—' || value === '') return;
  rows.push([
    { text: label, style: 'cell' },
    { text: value, style: 'cell', alignment: 'right' },
  ]);
}

function buildRadierBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());
  body.push(sectionTitle('Déflexions & distorsions'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  // Moteur radier : tassements en mm, distorsion en ‰ — TRANCHÉ (physique + solveModel
  // de référence identique au bit près + cohérence inter-cas). Le solveur sort ses
  // déplacements numériquement en mm (piège d'unité E-MPa × charges-kN × géométrie-m) ;
  // l'annotation « m/rad » du contrat vise l'unité SI, pas la sortie numérique. Voir le
  // commentaire détaillé dans apps/web adapters.ts (buildRadierRows).
  // COMPLÉTUDE : tous les diagnostics client-safe (RadierOutputSchema), ordre GEOPLAQUE_V10.
  fdnKvRow(t, 'Tassement maximal w_max', fdnNum(o.wMax, 2, 'mm'));
  fdnKvRow(t, 'Tassement minimal w_min', fdnNum(o.wMin, 2, 'mm'));
  fdnKvRow(t, 'Tassement différentiel', fdnNum(o.diff, 2, 'mm'));
  fdnKvRow(t, 'Distorsion angulaire gouvernante β', fdnNum(o.betaGov, 2, '‰'));
  fdnKvRow(t, 'Distorsion intra-plaque max', fdnNum(o.betaIntra, 2, '‰'));
  fdnKvRow(t, "Inclinaison d'ensemble ϖ", fdnNum(o.tiltMax, 2, '‰'));
  fdnKvRow(t, 'Pente locale max |∇w|', fdnNum(o.slopeMax, 2, '‰'));
  const nRafts = typeof o.nRafts === 'number' ? o.nRafts : 0;
  if (nRafts > 1) {
    fdnKvRow(t, 'Distorsion entre plaques', fdnNum(o.betaInter, 2, '‰'));
    fdnKvRow(t, 'Tassement différentiel inter-plaques', fdnNum(o.interDiff, 2, 'mm'));
  }
  const wlp = o.worstLoadPair;
  if (wlp != null && typeof wlp === 'object') {
    fdnKvRow(t, 'Distorsion max entre charges voisines', fdnNum((wlp as Record<string, unknown>).beta, 2, '‰'));
  }
  fdnKvRow(t, 'Nombre de radiers', fdnNum(o.nRafts, 0));
  if (t.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
  return body;
}

// Allowlist FAIL-CLOSED du chemin de décision GTR (classe.path) — DoD §8, avis
// ingenieur-securite. Miroir de `safeLaboPath` du front : seuls les libellés matchant un
// gabarit connu (seuils NF P 11-300 publics + valeurs déjà exposées) sont affichés ;
// slots contraints à des NOMBRES / CODES → un coefficient injecté ne matche pas. `warn`
// (note de maturité C1/C2) n'est JAMAIS imprimé au PV.
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
const LABO_PV_DESC_C = /^Gros éléments — comportement régi par (?:le squelette|la fraction 0\/50)(?: · 0\/50 type (?:D1|D2))?$/;
function safeLaboDescPv(desc: unknown): string {
  if (typeof desc !== 'string') return '';
  const t = desc.trim();
  return LABO_PV_DESCS.has(t) || LABO_PV_DESC_C.test(t) ? t : '';
}
const LABO_PV_PATH_PATTERNS: readonly RegExp[] = [
  new RegExp(`^Dmax = ${LABO_PV_N} mm > ${LABO_PV_N} mm → famille C\\.$`),
  new RegExp(`^Fraction 0/50 reclassée → ${LABO_PV_C} \\(essais à réaliser sur le 0/50\\)\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_PV_N} % ≤ ${LABO_PV_N} % et VBS = ${LABO_PV_N} ≤ ${LABO_PV_N} → insensible → famille D\\.$`),
  new RegExp(`^Passant 2mm = ${LABO_PV_N} % → ${LABO_PV_C}\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_PV_N} % > ${LABO_PV_N} % → sol fin → famille A\\.$`),
  new RegExp(`^Ip = ${LABO_PV_N} \\(préférentiel\\) → ${LABO_PV_C}\\.$`),
  new RegExp(`^Ip absent → VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_PV_N} % ≤ ${LABO_PV_N} % → famille B\\.$`),
  new RegExp(`^Passant 2mm = ${LABO_PV_N} % \\((?:sables|graves)\\), VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`),
  new RegExp(`^Passant 80µm entre ${LABO_PV_N}–${LABO_PV_N} %, VBS = ${LABO_PV_N} → ${LABO_PV_C}\\.$`),
  new RegExp(`^État hydrique ${LABO_PV_ST} \\((?:forcé|wn/wOPN = ${LABO_PV_N})\\) → ${LABO_PV_C}(?: ${LABO_PV_ST})?\\.$`),
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

function buildLaboBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  // Classe GTR (résultat principal)
  body.push(sectionTitle('Classification GTR (NF P 11-300)'));
  const cl = o.classe;
  let classe = '';
  let laboDesc = '';
  let laboPath: string[] = [];
  if (cl != null && typeof cl === 'object') {
    const c = cl as Record<string, unknown>;
    // `code`/`full` incluent DÉJÀ la lettre de famille (code='A2', full='A2 h') :
    // concaténer `fam` la dupliquerait ('AA2'). Libellé canonique `full`, repli `code`.
    const full = typeof c.full === 'string' ? c.full.trim() : '';
    const code = c.code != null && c.code !== '' ? String(c.code).trim() : '';
    classe = full || code;
    // desc (allowlisté sur l'ensemble NF P 11-300) + path (allowlisté) = client-safe.
    laboDesc = safeLaboDescPv(c.desc);
    laboPath = safeLaboPathPv(c.path);
  }
  body.push({
    text: classe ? `Classe : ${classe}` : 'Classe non déterminée.',
    fontSize: classe ? 13 : 9,
    bold: !!classe,
    color: classe ? COLORS.navy : COLORS.muted,
    margin: [0, 2, 0, laboDesc || laboPath.length ? 2 : 6],
  });
  if (laboDesc) {
    body.push({ text: laboDesc, style: 'cellMuted', margin: [0, 0, 0, 4] });
  }
  if (laboPath.length > 0) {
    body.push(fdnSubTitle('Justification du classement'));
    laboPath.forEach((line, i) => {
      body.push({
        text: `${i + 1}. ${line}`,
        style: 'cellMuted',
        margin: [0, 0, 0, i === laboPath.length - 1 ? 6 : 2],
      });
    });
  }

  // Paramètres d'identification
  const t: TableCell[][] = [[fdnHead('Paramètre'), fdnHead('Valeur', 'right')]];
  // COMPLÉTUDE : tous les résultats client-safe (essais A/B/C/D). Les champs non
  // renseignés (fdnNum→'—') sont auto-supprimés par fdnKvRow.
  fdnKvRow(t, 'Dmax', fdnNum(o.dmax, 0, 'mm'));
  fdnKvRow(t, 'Passant à 80 µm', fdnNum(o.p80, 0, '%'));
  fdnKvRow(t, 'Passant à 2 mm', fdnNum(o.p2, 0, '%'));
  fdnKvRow(t, "Coefficient d'uniformité Cu", fdnNum(o.Cu, 1));
  fdnKvRow(t, 'Coefficient de courbure Cc', fdnNum(o.Cc, 2));
  fdnKvRow(t, 'Module de finesse', fdnNum(o.mf, 2));
  fdnKvRow(t, 'Teneur en eau naturelle w_n', fdnNum(o.wn, 1, '%'));
  fdnKvRow(t, 'Limite de liquidité w_L', fdnNum(o.wl, 0, '%'));
  fdnKvRow(t, 'Limite de plasticité w_P', fdnNum(o.wp, 0, '%'));
  fdnKvRow(t, 'Indice de plasticité I_P', fdnNum(o.ip, 0));
  fdnKvRow(t, 'Indice de consistance I_C', fdnNum(o.ic, 2));
  fdnKvRow(t, 'Valeur au bleu VBS', fdnNum(o.vbs, 2));
  fdnKvRow(t, 'Masse volumique des grains ρ_s', fdnNum(o.rhos, 2, 'Mg/m³'));
  fdnKvRow(t, 'Masse volumique apparente ρ', fdnNum(o.rho_app, 2, 'Mg/m³'));
  fdnKvRow(t, 'Masse volumique sèche apparente ρ_d', fdnNum(o.rhod_app, 2, 'Mg/m³'));
  fdnKvRow(t, 'Teneur en eau optimale w_OPN', fdnNum(o.wopn, 1, '%'));
  fdnKvRow(t, 'Densité sèche max ρ_d;max', fdnNum(o.rdmax, 2, 't/m³'));
  fdnKvRow(t, 'Indice CBR', fdnNum(o.cbr, 0));
  fdnKvRow(t, 'Gonflement', fdnNum(o.gonfl, 1, '%'));
  fdnKvRow(t, 'Équivalent de sable ES', fdnNum(o.es, 0, '%'));
  fdnKvRow(t, 'Los Angeles LA', fdnNum(o.la, 0));
  fdnKvRow(t, 'Fragmentation SZ', fdnNum(o.sz, 0, '%'));
  fdnKvRow(t, 'Micro-Deval MDE', fdnNum(o.mde, 0));
  fdnKvRow(t, "Absorption d'eau WA24", fdnNum(o.wa, 1, '%'));
  fdnKvRow(t, 'Teneur en sulfates SO₃', fdnNum(o.so3, 2, '%'));
  fdnKvRow(t, 'Résistance à la compression simple q_u', fdnNum(o.qu, 2, 'MPa'));
  fdnKvRow(t, 'Indice des vides initial e₀', fdnNum(o.e0_oedo, 3));
  fdnKvRow(t, 'Indice de compression Cc (œdo)', fdnNum(o.Cc_oedo, 3));
  fdnKvRow(t, 'Indice de gonflement Cs', fdnNum(o.Cs_oedo, 3));
  fdnKvRow(t, "Cohésion c' (cisaillement)", fdnNum(o.c_cis, 1, 'kPa'));
  fdnKvRow(t, "Angle de frottement φ' (cisaillement)", fdnNum(o.phi_cis, 1, '°'));
  fdnKvRow(t, "Angle de frottement résiduel φ'_R", fdnNum(o.phiR_cis, 1, '°'));
  fdnKvRow(t, "Cohésion c' (triaxial)", fdnNum(o.c, 1, 'kPa'));
  fdnKvRow(t, "Angle de frottement φ' (triaxial)", fdnNum(o.phi, 1, '°'));
  fdnKvRow(t, 'Cohésion non drainée c_u (UU)', fdnNum(o.cu_uu, 1, 'kPa'));
  fdnKvRow(t, 'Perméabilité k', fdnNum(o.k, 8, 'cm/s'));
  if (t.length > 1) {
    body.push(sectionTitle('Paramètres d’identification'));
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }
  return body;
}

function buildPressiometreBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Résultats de dépouillement'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(t, 'Pression limite p_L', fdnNum(o.pL, 2, 'bar'));
  fdnKvRow(t, 'Pression limite nette p_L*', fdnNum(o.pLNette, 2, 'bar'));
  fdnKvRow(t, 'Pression de fluage nette p_f*', fdnNum(o.pfNette, 2, 'bar'));
  fdnKvRow(t, 'Module pressiométrique E_M', fdnNum(o.EM, 1, 'MPa'));
  fdnKvRow(t, 'Rapport E_M / p_L*', fdnNum(o.ratioEMpL, 1));
  if (t.length > 1) {
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: t },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  // Classification du sol (résultats textuels)
  const cat = typeof o.categorieLibelle === 'string' ? o.categorieLibelle : '';
  const cons = typeof o.consolidation === 'string' ? o.consolidation : '';
  if (cat || cons) {
    const ct: TableCell[][] = [[fdnHead('Paramètre'), fdnHead('Valeur', 'right')]];
    if (cat) fdnKvRow(ct, 'Catégorie de sol', cat);
    if (cons) fdnKvRow(ct, 'État de consolidation', cons);
    if (ct.length > 1) {
      body.push(sectionTitle('Classification du sol'));
      body.push({
        table: { headerRows: 1, widths: ['*', 'auto'], body: ct },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }
  }
  return body;
}

// ---------------------------------------------------------------------------
// En-tête / pied répétés
// ---------------------------------------------------------------------------

// Largeur de contenu A4 (595pt) moins les marges latérales (40pt x2) = 515pt.
const HEADER_RULE_WIDTH = 515;

function buildHeader(sealed: SealedContent, sealedAt: Date): Content {
  // Bandeau marque à gauche, numéro + date à droite (numéro = source canonique),
  // SUIVI d'un FILET BLEU pleine largeur (toutes pages, motif maison .sec).
  return {
    margin: [40, 24, 40, 0],
    stack: [
      {
        columns: [
          [
            { text: 'ROADSEN', style: 'brand' },
            {
              text: 'Plateforme de calcul géotechnique & routier',
              style: 'sub',
              margin: [0, 1, 0, 0],
            },
          ],
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              {
                text: sealed.pvNumber,
                color: COLORS.navy,
                bold: true,
                fontSize: 10,
              },
              {
                text: `Scellé le ${formatDate(sealedAt)}`,
                style: 'sub',
                margin: [0, 2, 0, 0],
              },
            ],
          },
        ],
      },
      // FILET BLEU sous l'en-tête (MIN-1 : réellement rendu, plus de no-op).
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 6,
            x2: HEADER_RULE_WIDTH,
            y2: 6,
            lineWidth: 0.8,
            lineColor: COLORS.navy,
          },
        ],
      },
    ],
  };
}

function buildFooter(
  sealed: SealedContent,
  currentPage: number,
  pageCount: number,
): Content {
  return {
    margin: [40, 8, 40, 0],
    columns: [
      { text: sealed.pvNumber, style: 'footer', width: '*' },
      {
        text: `page ${currentPage} / ${pageCount}`,
        style: 'footer',
        alignment: 'center',
        width: '*',
      },
      {
        text: 'Document confidentiel',
        style: 'footer',
        alignment: 'right',
        width: '*',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cartes d'identité + objet
// ---------------------------------------------------------------------------

function card(label: string, lines: string[]): TableCell {
  const stack: Content[] = [
    {
      text: label.toUpperCase(),
      style: 'cardLabel',
      margin: [0, 0, 0, 4] as [number, number, number, number],
    },
    ...lines.map(
      (l): Content => ({
        text: l,
        style: 'cardValue',
        margin: [0, 1, 0, 0] as [number, number, number, number],
      }),
    ),
  ];
  return {
    stack,
    fillColor: COLORS.cardFill,
    margin: [10, 8, 10, 8] as [number, number, number, number],
  };
}

function buildIdentityCards(sealed: SealedContent): Content {
  // Cartes d'identité — TOUTES depuis la canonique scellée (CRIT-1).
  const { identity, engineMeta } = sealed;
  const model = findPresentationModel(engineMeta.engineId);
  // Moteur : libellé MÉTIER si modèle présent, sinon l'id (pas de slug cryptique).
  const engineLabel = model ? model.engineLabel : engineMeta.engineId;
  // Ingénieur émetteur : VRAI NOM (userDisplayName, désormais SCELLÉ). Fallback
  // « (identité non renseignée) » seulement si le nom scellé est vide.
  const rows: TableCell[][] = [
    [
      // #71-titulaire(2) : « Réf. <slug> » RETIRÉE — le libellé projet suffit
      // (pas de champ de réf admin dans le schéma ; on ne montre jamais le slug).
      card('Projet', [identity.projectName]),
      card('Ingénieur émetteur', [engineerDisplay(identity)]),
    ],
    [
      card('Moteur', [engineLabel, `Version ${engineMeta.engineVersion}`]),
      // MAJEUR-1 (audit) : libellé DESCRIPTIF, sans verdict ni jargon. « Intégrité
      // vérifiée » serait une AUTO-ATTESTATION trompeuse (un PDF exporté puis
      // modifié l'afficherait quand même) ; « Recalculé serveur » = jargon interne.
      // La vraie portée d'intégrité est décrite dans le bloc scellement (+ Phase 2).
      card('Statut', ['Scellé (empreinte SHA-256 / HMAC)']),
    ],
  ];
  return {
    margin: [0, 12, 0, 4],
    table: { widths: ['*', '*'], body: rows },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  };
}

function buildObjet(sealed: SealedContent): Content {
  // Bloc « objet » à filet bleu à gauche (motif maison .objet). #71 : PHRASE
  // RÉDIGÉE depuis le PresentationModel (engineLabel + contexte projet), PAS un
  // slug+hash. Repli propre (sans hash) si le moteur n'a pas de modèle.
  const { engineMeta, identity } = sealed;
  const model = findPresentationModel(engineMeta.engineId);
  let objetText: string;
  if (model) {
    const projetCtx = identity.projectName ? `« ${identity.projectName} »` : '';
    objetText = model.objectSentence.replace('{projet}', projetCtx).trim();
  } else {
    // Repli générique (aucun slug brut, aucun hash dans l'objet).
    objetText = `Note de calcul — ${engineMeta.engineId} (version ${engineMeta.engineVersion}).`;
  }
  return {
    margin: [0, 8, 0, 0],
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              {
                text: 'OBJET DU CALCUL',
                style: 'cardLabel',
                margin: [0, 0, 0, 3],
              },
              {
                text: objetText,
                fontSize: 9.5,
                color: COLORS.text,
              },
            ],
            fillColor: COLORS.navyFillSoft,
            border: [false, false, false, false],
            margin: [12, 8, 12, 8],
          },
        ],
      ],
    },
    layout: {
      // filet bleu épais à gauche uniquement.
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => COLORS.navy,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tableaux entrée / résultats (gabarit générique : 5 ou 50 champs)
// ---------------------------------------------------------------------------

interface FlatRow {
  group?: string; // sous-titre de groupe (objet imbriqué)
  param?: string;
  value?: string;
}

/**
 * Aplatit récursivement une valeur (objet/tableau/scalaire) en lignes
 * param/valeur, avec sous-titres de GROUPE pour les objets imbriqués. Tri des
 * clés stable (lisibilité reproductible). Profondeur bornée (anti-récursion folle).
 */
const MAX_DEPTH = 6;

function flatten(
  value: unknown,
  rows: FlatRow[],
  prefix = '',
  depth = 0,
): void {
  if (depth > MAX_DEPTH) {
    // MIN-4 : sur un livrable d'intégrité, on NE supprime PAS silencieusement des
    // paramètres scellés. On rend un MARQUEUR VISIBLE (traçable) au lieu d'omettre.
    rows.push({
      param: prefix || '(valeur)',
      value: `… niveau tronqué (profondeur > ${MAX_DEPTH})`,
    });
    return;
  }
  if (value === null || value === undefined) {
    rows.push({ param: prefix || '(valeur)', value: '—' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const key = prefix ? `${prefix}[${i + 1}]` : `[${i + 1}]`;
      if (isPlainObject(item) || Array.isArray(item)) {
        flatten(item, rows, key, depth + 1);
      } else {
        rows.push({ param: key, value: scalar(item) });
      }
    });
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    // Un objet imbriqué (sous le 1er niveau) devient un GROUPE titré.
    if (
      prefix &&
      entries.some(([, v]) => isPlainObject(v) || Array.isArray(v))
    ) {
      rows.push({ group: prefix });
    }
    for (const [k, v] of entries) {
      const key = prefix ? `${prefix} · ${k}` : k;
      if (isPlainObject(v) || Array.isArray(v)) {
        flatten(v, rows, key, depth + 1);
      } else {
        rows.push({ param: key, value: scalar(v) });
      }
    }
    return;
  }
  rows.push({ param: prefix || '(valeur)', value: scalar(value) });
}

function buildKeyValueTable(value: unknown, emptyLabel: string): Content {
  const rows: FlatRow[] = [];
  flatten(value, rows);
  if (rows.length === 0) {
    return { text: emptyLabel, style: 'cellMuted', margin: [0, 2, 0, 6] };
  }

  const body: TableCell[][] = [
    [
      { text: 'Paramètre', style: 'tableHead' },
      { text: 'Valeur', style: 'tableHead', alignment: 'right' },
    ],
  ];
  for (const r of rows) {
    if (r.group) {
      // Sous-titre de groupe (fond bleu pâle, sur toute la largeur).
      body.push([
        {
          text: r.group,
          style: 'groupRow',
          fillColor: COLORS.groupFill,
          colSpan: 2,
        },
        {},
      ]);
      continue;
    }
    body.push([
      { text: r.param ?? '', style: 'cell' },
      { text: r.value ?? '', style: 'cell', alignment: 'right' },
    ]);
  }

  const table: ContentTable = {
    table: {
      headerRows: 1, // en-tête répété si le tableau déborde en multi-pages
      widths: ['*', 'auto'],
      body,
    },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  };
  return table;
}

// ---------------------------------------------------------------------------
// Bloc de scellement (élément distinctif, jamais coupé)
// ---------------------------------------------------------------------------

function buildSealBlock(
  sealed: SealedContent,
  recomputedHash: string,
): Content {
  return {
    unbreakable: true, // ne JAMAIS couper le bloc de scellement entre 2 pages
    margin: [0, 18, 0, 0],
    table: {
      widths: ['*', 'auto'],
      body: [
        [
          {
            stack: [
              { text: 'SCELLEMENT', style: 'sealLabel', margin: [0, 0, 0, 6] },
              {
                text: 'Numéro de procès-verbal',
                style: 'cardLabel',
                color: COLORS.muted,
              },
              {
                text: sealed.pvNumber,
                fontSize: 10,
                bold: true,
                color: COLORS.navy,
                margin: [0, 0, 0, 6],
              },
              {
                text: 'Empreinte SHA-256 du contenu',
                style: 'cardLabel',
                color: COLORS.muted,
              },
              // Hash RECALCULÉ depuis la canonique (CRIT-1) — en POLICE COURIER.
              // C'est l'empreinte du corps RÉELLEMENT rendu, pas la colonne stockée.
              {
                text: recomputedHash,
                font: 'Courier',
                fontSize: 8,
                color: COLORS.text,
                margin: [0, 1, 0, 6],
              },
              {
                text: `Horodatage de scellement : ${formatDateTime(new Date(sealed.sealedAt))}`,
                style: 'cellMuted',
              },
              // VISA (#71-titulaire 5) : « Établi et scellé par ». Le sceau
              // cryptographique EST la signature ; on le rend explicite. Émetteur +
              // organisation viennent de la canonique SCELLÉE.
              {
                text: 'Établi et scellé par :',
                style: 'cardLabel',
                color: COLORS.muted,
                margin: [0, 8, 0, 2],
              },
              {
                text: visaText(sealed),
                fontSize: 9,
                bold: true,
                color: COLORS.text,
              },
              // NOTE SCIENCE (#71-titulaire 3) : honnête, pas « brouillon ». Les
              // libellés/unités métier sont en co-validation expert.
              {
                text: 'Libellés et unités métier établis selon la méthode rationnelle (AGEROUTE 2015) — en cours de co-validation avec l’expert.',
                fontSize: 7,
                italics: true,
                color: COLORS.muted,
                margin: [0, 6, 0, 0],
              },
              // NOTE D'HONNÊTETÉ : l'affichage des valeurs est formaté (nettoyage
              // du bruit binaire) ; la représentation SCELLÉE (empreinte ci-dessus)
              // est la version de référence. On retire « fait foi » (connotation
              // juridique non acquise — fiscal-juridique tranche en parallèle).
              {
                text: 'Valeurs affichées au format ; la représentation scellée (empreinte ci-dessus) constitue la version de référence du contenu.',
                fontSize: 7,
                italics: true,
                color: COLORS.muted,
                margin: [0, 4, 0, 0],
              },
              // NOTE D'INTÉGRITÉ / PORTÉE (texte EXACT validé par fiscal-juridique,
              // anti-surcote) : on décrit ce que le scellement FAIT (détection
              // d'altération) sans prétendre à une valeur probatoire/signature
              // qualifiée qu'on n'a pas. Termes juridiques bannis (« fait foi »,
              // « certifié »…) ; on garde « intégrité / scellé / version de référence ».
              {
                text:
                  'Document scellé pour contrôle d’intégrité (SHA-256 / HMAC, ' +
                  'horodatage serveur), permettant de détecter toute modification ' +
                  'ultérieure. Aide au calcul — la responsabilité de l’étude reste ' +
                  'à l’ingénieur signataire. Ne vaut pas signature électronique ' +
                  'qualifiée (loi 2008-08).',
                fontSize: 7,
                italics: true,
                color: COLORS.muted,
                margin: [0, 4, 0, 0],
              },
            ],
            margin: [12, 12, 12, 12],
          },
          // #71 : QR vide RETIRÉ (façade « cassée ») -> simple texte grisé. Le QR
          // réel de vérification en ligne arrive en Phase 2.
          {
            stack: [
              {
                text: 'Vérification en ligne :',
                fontSize: 8,
                color: COLORS.muted,
                alignment: 'right',
              },
              {
                text: 'disponible en Phase 2',
                fontSize: 8,
                italics: true,
                color: COLORS.muted2,
                alignment: 'right',
                margin: [0, 2, 0, 0],
              },
            ],
            margin: [12, 14, 12, 12],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => COLORS.rule,
      vLineColor: () => COLORS.rule,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
      fillColor: () => COLORS.navyFillSoft,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionTitle(label: string): Content {
  return {
    text: label.toUpperCase(),
    style: 'section',
    // filet sous le titre (motif .sec maison).
    margin: [0, 16, 0, 6],
  };
}

/**
 * Parse STRICT de input_canonical en SealedContent (CRIT-1). AUCUN repli sur les
 * colonnes du PV : une canonique illisible ou incomplète est une anomalie
 * d'intégrité -> on LÈVE (le rendu dégradé depuis la ligne est PROSCRIT). Les
 * champs structurels requis (pvNumber, sealedAt, engineMeta, identity) sont
 * vérifiés présents ; input/output peuvent être vides mais doivent exister.
 */
function parseSealedStrict(canonical: string): SealedContent {
  const parsed = JSON.parse(canonical) as Record<string, unknown>;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('canonique : objet attendu');
  }
  const pvNumber = parsed.pvNumber;
  const sealedAt = parsed.sealedAt;
  const engineMeta = parsed.engineMeta as
    | SealedContent['engineMeta']
    | undefined;
  const identity = parsed.identity as SealedContent['identity'] | undefined;
  if (typeof pvNumber !== 'string' || pvNumber.length === 0) {
    throw new Error('canonique : pvNumber manquant');
  }
  if (typeof sealedAt !== 'string' || Number.isNaN(Date.parse(sealedAt))) {
    throw new Error('canonique : sealedAt manquant/invalide');
  }
  if (
    !engineMeta ||
    typeof engineMeta.engineId !== 'string' ||
    typeof engineMeta.engineVersion !== 'string'
  ) {
    throw new Error('canonique : engineMeta manquant');
  }
  if (
    !identity ||
    typeof identity.userId !== 'string' ||
    typeof identity.projectId !== 'string' ||
    typeof identity.projectName !== 'string'
  ) {
    throw new Error('canonique : identity manquant');
  }
  return {
    pvNumber,
    sealedAt,
    engineMeta,
    identity,
    input: 'input' in parsed ? parsed.input : {},
    output: 'output' in parsed ? parsed.output : {},
    // scienceStatus est dans le canonique mais N'EST JAMAIS rendu (anti-fuite).
    scienceStatus:
      typeof parsed.scienceStatus === 'string' ? parsed.scienceStatus : '',
    // Verdict scelle (ADR 0012). Defaut neutre si absent (canonique recette
    // pre-0012) -> le rendu ne casse pas ; un PV emis post-0012 le porte toujours.
    verdict:
      typeof parsed.verdict === 'string' ? parsed.verdict : 'NON_APPLICABLE',
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string' || typeof v === 'bigint') {
    return String(v);
  }
  // Garde-fou : `flatten` ne passe ici que des scalaires (objets/tableaux récursés).
  // Un type inattendu -> marqueur NEUTRE (M-3), JAMAIS JSON.stringify (qui
  // déverserait des sous-champs potentiellement confidentiels).
  return '(structuré)';
}

/**
 * INTÉRIM : supprime le bruit binaire IEEE-754 à l'affichage. Le format
 * d'affichage INGÉNIERIE par grandeur (précision métier) est défini par l'expert
 * STARFIRE — voir ticket [STARFIRE — format d'affichage ingénierie, n° à venir].
 * Ne PAS confondre avec un arrondi métier.
 *
 * MÉCANIQUE : `parseFloat(x.toPrecision(12))` ne touche QUE l'affichage (le
 * scellement reste intouché : la canonique garde le double EXACT). 12 chiffres
 * significatifs >> toute précision d'ingénierie -> on retire UNIQUEMENT l'artefact
 * binaire (~1e-16) : strict sous-ensemble du futur format expert, ne préjuge rien.
 * Ex. 0.16+0.25 = 0.41000000000000003 -> « 0,41 » ; une vraie valeur à 6-8 chiffres
 * reste intacte ; entiers/petits décimaux exacts inchangés.
 *
 * Rendu FR : virgule décimale (séparateur d'usage). La NOTE du bloc scellement
 * rappelle que l'affichage est formaté et que la représentation scellée (empreinte)
 * constitue la version de référence du contenu — honnêteté d'ingénieur.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return frDecimal(String(n)); // NaN/Infinity : tel quel
  if (Number.isInteger(n)) return frDecimal(String(n)); // entiers exacts : inchangés
  // toPrecision(12) puis parseFloat -> retire les zéros/artefacts de queue.
  return frDecimal(String(parseFloat(n.toPrecision(12))));
}

/** Rendu FR : point décimal -> virgule (séparateur décimal d'usage au Sénégal/FR). */
function frDecimal(s: string): string {
  return s.replace('.', ',');
}

/**
 * Nom de l'ingénieur émetteur À AFFICHER. #71-titulaire(1) : userDisplayName est
 * désormais une donnée SCELLÉE (l'auteur fait partie de l'intégrité du PV). On rend
 * le VRAI NOM ; fallback « (identité non renseignée) » seulement s'il est vide
 * (jamais le slug technique).
 */
function engineerDisplay(identity: SealedContent['identity']): string {
  const name = identity.userDisplayName;
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim();
  }
  return '(identité non renseignée)';
}

/**
 * Texte du VISA (#71-titulaire 5) : « <Ingénieur émetteur> — <Organisation> ».
 * Émetteur et organisation viennent de la canonique SCELLÉE. L'organisation peut
 * manquer (PV émis avant l'ajout du champ) -> on n'affiche que l'émetteur.
 */
function visaText(sealed: SealedContent): string {
  const engineer = engineerDisplay(sealed.identity);
  const org = sealed.identity.orgDisplayName;
  return typeof org === 'string' && org.trim().length > 0
    ? `${engineer} — ${org.trim()}`
    : engineer;
}

/** Date jj/mm/aaaa en UTC (déterministe, indépendant du fuseau du serveur). */
function formatDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Date + heure UTC (déterministe). */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${formatDate(d)} ${iso.slice(11, 16)} UTC`;
}
