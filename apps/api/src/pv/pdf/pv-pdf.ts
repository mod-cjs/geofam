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
  const model = findPresentationModel(sealed.engineMeta.engineId);
  if (model) {
    return renderRichBody(sealed, model);
  }
  // FALLBACK : table clé-valeur propre (sans lignes-bruit), input puis output.
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
