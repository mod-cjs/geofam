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
import { buildFonProfondeBody } from './bodies/pieux';
import { buildPressiometreBody } from './bodies/pressiometre';

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
      author: 'GEOFAM',
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
  // Modes 2D GEOPLAQUE — RÉSULTATS de calcul EF (déformée), miroir des panneaux
  // `#ps-run` / `#ax-run` / `#tri-run` de l'outil client (statistiques + figure,
  // sans verdict de conformité). Les champs d'affichage volumineux (`profils`,
  // `champDeflexion`) restent SERVEUR (jamais listés) : on ne rend que les scalaires.
  if (engineId === 'plane-strain') {
    return buildPlaneStrainBody(sealed);
  }
  if (engineId === 'axi-plaque') {
    return buildAxiBody(sealed);
  }
  if (engineId === 'radier-tri') {
    return buildTriRaftBody(sealed);
  }
  // Corrections métrologiques pressiométriques — miroir de `renderEtalResult` /
  // `renderCalibResult` de l'outil client (coefficients + qualité + résidus).
  if (engineId === 'pressio-etalonnage') {
    return buildPressioEtalonnageBody(sealed);
  }
  if (engineId === 'pressio-calibrage') {
    return buildPressioCalibrageBody(sealed);
  }
  // FALLBACK générique : table clé-valeur propre (sans lignes-bruit), input puis output.
  return [
    sectionTitle('Données d’entrée'),
    buildKeyValueTable(sealed.input, 'Aucune donnée d’entrée enregistrée.'),
    sectionTitle('Résultats'),
    // MAJ-2 (frontière de confidentialité) : `output` a déjà été WHITELISTÉ en
    // amont — projectEngineOutput(contract.outputSchema) au moment du calcul puis
    // figé dans input_canonical au scellement. Le PDF NE RE-RÉDIGE PAS.
    // CRITIQUE-1 : les modes 2D GEOPLAQUE (plane-strain/axi/tri-raft) tombent
    // dans ce fallback et portent des CHAMPS D'AFFICHAGE volumineux (profils 97
    // points, champDeflexion 48×48). On les STRIP AVANT flatten pour ne rendre
    // que les scalaires métier (wMax, mMax, sumReact, EI, diff…) — sinon le PV
    // devient un mur de nombres imprésentable (DoD §5).
    buildKeyValueTable(
      stripDisplayOnlyFields(sealed.output),
      'Aucun résultat enregistré.',
    ),
  ];
}

/**
 * Clés de PURE VISUALISATION rendues par l'APP (cartographies / profils
 * ré-échantillonnés « design-sûrs », cf. mémoire geoplaque-heatmap-design-sur),
 * PAS par le tableau clé-valeur du PV. Aplaties récursivement, elles feraient un
 * mur de nombres (des centaines à des milliers de lignes).
 */
const PV_DISPLAY_ONLY_KEYS = new Set([
  'profils', // plane-strain / axi : profils de champs (x[97] + v[97] par courbe)
  'champs', // variante éventuelle de profils groupés
  'champDeflexion', // radier-tri : grille de déflexion (jusqu'à 48×48 = 2304 vals)
  'heatmap', // carto brute éventuelle
  'heatmaps',
]);

/**
 * Retire au RENDU les champs de pure visualisation d'un output (copie de surface ;
 * l'original scellé n'est jamais touché). L'INTÉGRITÉ est préservée : ces champs
 * restent DANS l'output scellé (input_canonical) — seul le rendu clé-valeur les
 * omet, car ils sont dessinés par l'app, pas listés dans le PV. Non-objet : rendu
 * tel quel (aucun champ à retirer).
 */
function stripDisplayOnlyFields(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (PV_DISPLAY_ONLY_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
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
const FDN_ETAT: Record<string, string> = {
  ELU_F: 'ELU fondamental',
  ELU_A: 'ELU accidentel',
  ELS_C: 'ELS caractéristique',
  ELS_F: 'ELS fréquent',
  ELS_QP: 'ELS quasi-permanent',
};

/** Coercition texte sûre pour le PDF : string/number tels quels, tout autre
 * type (objet, null, …) → « — » — jamais de « [object Object] » dans un PV. */
function pdfText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '—';
}

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
    .replace(/[\u202f\u00a0]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}

/**
 * Nombre → notation SCIENTIFIQUE fr-FR (toExponential(2), séparateur décimal « , »),
 * sinon « — ». Miroir du dépouillement client FASTLAB (`k.toExponential(2)`) : une
 * perméabilité ~1e-9 cm/s rendue en notation fixe donnerait « 0,00000000 » (illisible).
 */
function fdnExp(v: unknown, unit?: string): string {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n)) return '—';
  const s = n.toExponential(2).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}

function fdnFirstFinite(...vals: unknown[]): number | null {
  for (const v of vals)
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Affichage RADIER / modes 2D GEOPLAQUE — COPIE des transformations d'affichage de
// l'outil client GEOPLAQUE_V10 (décision titulaire 15/07, re-confirmée 17/07 :
// « zéro écart absolu »). La sortie MOTEUR reste physiquement juste (tassements en mm,
// distorsions en ‰) et le SCELLÉ canonique est INCHANGÉ ; SEULE la couche de
// PRÉSENTATION reproduit les défauts d'affichage de l'outil client : tassements ×1000
// (sur-rapport), grandeurs angulaires rendues CRUES (`ratio1` + valeur brute étiquetée
// « rad »). Appliqué app ET PV ensemble (jamais l'un sans l'autre — leçon pressio
// MAJEUR-1). Exception à faire valider par STARFIRE (inverse la décision du 01/07 qui
// affichait mm/‰ « justes »). Réf. client : `refreshResults` l.2560-2598 (radier) ;
// panneaux `#ps-run`/`#ax-run`/`#tri-run` l.2237-2333 (2D). Typographie fr-FR maison
// (séparateur décimal « , », mantisse de la notation scientifique localisée).
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

function fdnSubTitle(label: string): Content {
  return { text: label, style: 'groupRow', margin: [0, 8, 0, 3] };
}

function fdnHead(
  text: string,
  align: 'left' | 'right' | 'center' = 'left',
): TableCell {
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

// ---------------------------------------------------------------------------
// FAC-SIMILÉ de la note native `buildNote` (terzaghi_V13.html) — décision
// titulaire 18/07 : le PV scellé reproduit SECTION PAR SECTION le rapport que
// l'outil client imprime (PV == écran == rapport client). Le CLONE (apps/web)
// reconstruit `R` depuis la SORTIE SERVEUR whitelistée puis rejoue `buildNote` ;
// ce corps pdfmake fait de MÊME : il rejoue la structure de la note à partir de
// la même sortie whitelistée (`TerzaghiOutputSchema`, détail pas-à-pas ADR 0015)
// et des efforts SAISIS (input.charges). Aucune science côté serveur PDF : on
// consomme les grandeurs déjà calculées et déjà whitelistées.
//
// Correctifs d'audit intégrés : §2 « Contraintes au niveau de la base » (u/q0/σ′v0,
// ABSENT auparavant) ; D d'encastrement RÉELLEMENT peuplé (BQ-3) ; vérification
// EXCENTREMENT présente en synthèse (BQ-5) ; tassement en CENTIMÈTRES comme la
// note (fmt sf·100), plus en mètres ; référentiel NF P 94-261 (BQ-4).
// ---------------------------------------------------------------------------

/** Parse tolérant FR — MIROIR du `num()` de l'outil client (number|string → number/NaN). */
function terzNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
  const x = Number(s);
  return Number.isFinite(x) ? x : NaN;
}

/** Formatte à `d` décimales fixes, fr-FR — MIROIR EXACT du `fmt(x,d)` de l'outil
 * client (mêmes décimales, même clamp anti « -0,00 »). « — » si non fini. */
function terzFmt(v: unknown, d = 2): string {
  let x = terzNum(v);
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 / Math.pow(10, d)) x = 0;
  return x
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** Ligne label/valeur pour la table d'hypothèses (label en gras, valeur libre). */
function terzHypRow(label: string, val: string): TableCell[] {
  return [
    { text: label, style: 'cell', bold: true },
    { text: val, style: 'cell' },
  ];
}

/** Sous-titre de GROUPE du déroulé (« A · Capacité portante »…), miroir des `.grp`. */
function terzGroup(label: string): Content {
  return { text: label, style: 'groupRow', margin: [0, 8, 0, 2] };
}

/** Une ÉTAPE du déroulé (numéro + titre + corps multi-lignes) — miroir de `step()`. */
function terzStep(n: number, title: string, bodyLines: string[]): Content {
  return {
    stack: [
      {
        text: [
          { text: `${n}. `, bold: true, color: COLORS.navy },
          { text: title, bold: true, color: COLORS.textSec2 },
        ],
        fontSize: 8.5,
        margin: [0, 5, 0, 1],
      },
      {
        text: bodyLines.filter((l) => l != null && l !== '').join('\n'),
        fontSize: 8.5,
        color: COLORS.textSec2,
        margin: [10, 0, 0, 2],
      },
    ],
  };
}

/** Équation « lhs = formule [= subst] [= résultat] » — miroir de `eqn()` client. */
function terzEqn(
  lhs: string,
  formula: string,
  subst?: string,
  result?: string,
): string {
  let s = `${lhs} = ${formula}`;
  if (subst != null && subst !== '') s += `\n    = ${subst}`;
  if (result != null && result !== '') s += `\n    = ${result}`;
  return s;
}

/**
 * Reconstruit le contexte d'affichage X depuis l'entrée saisie + les grandeurs
 * bénignes renvoyées par le serveur (contraintes de base) — MIROIR de
 * `buildCtxFromState` du clone. Aucun intermédiaire confidentiel (le serveur
 * whiteliste u/q0/σ′v0 dans `contraintesBase`).
 */
interface FdnCtx {
  forme: string;
  labo: boolean;
  filante: boolean;
  essai: string;
  B: number;
  L: number;
  D: number;
  gAv: number;
  gAp: number;
  zw: number;
  beton: string;
  u: number;
  q0: number;
  sv0: number;
  ml: string;
  mlF: string;
}

function terzCtx(
  input: Record<string, unknown>,
  cb: Record<string, unknown>,
): FdnCtx {
  const forme = pdfText(input.forme);
  const essai = pdfText(input.essai);
  const filante = forme === 'filante';
  return {
    forme,
    essai,
    labo: essai === 'labo',
    filante,
    B: terzNum(input.B),
    L: terzNum(input.L),
    D: terzNum(input.D),
    gAv: terzNum(input.gAvant),
    gAp: terzNum(input.gApres),
    zw: terzNum(input.nappe),
    beton: pdfText(input.beton),
    u: terzNum(cb.u),
    q0: terzNum(cb.q0),
    sv0: terzNum(cb.sv0),
    ml: filante ? '/ml' : '',
    mlF: filante ? ' kN/ml' : ' kN',
  };
}

/** Titre + efforts d'un cas — MIROIR de `caseTitle`. Efforts SAISIS (input.charges). */
function terzCaseHead(
  c: Record<string, unknown>,
  X: FdnCtx,
): { title: string; loads: string } {
  const idx = typeof c.idx === 'number' ? c.idx : 0;
  const etat = FDN_ETAT[pdfText(c.etat)] ?? pdfText(c.etat);
  let loads = `Fz = ${terzFmt(c.Fz, 0)} kN${X.ml}`;
  if (Math.abs(terzNum(c.Fx)) > 1e-9) loads += ` · Fx = ${terzFmt(c.Fx, 0)}`;
  if (Math.abs(terzNum(c.Fy)) > 1e-9) loads += ` · Fy = ${terzFmt(c.Fy, 0)}`;
  if (Math.abs(terzNum(c.Mx)) > 1e-9) loads += ` · Mx = ${terzFmt(c.Mx, 0)}`;
  if (Math.abs(terzNum(c.My)) > 1e-9)
    loads += ` · My = ${terzFmt(c.My, 0)} kN·m${X.ml}`;
  return { title: `Cas ${idx + 1} — ${etat}`, loads };
}

/**
 * Déroulé PAS-À-PAS d'un cas de charge — MIROIR de `caseSteps`. Consomme les
 * grandeurs whitelistées (géométrie effective de Meyerhof, coefficients D/E,
 * résistances, tassements décomposés) : aucune re-dérivation de méthode ici.
 */
function terzCaseSteps(c: Record<string, unknown>, X: FdnCtx): Content[] {
  const out: Content[] = [];
  const B = X.B;
  const mlF = X.mlF;
  const pm = X.ml;
  const Fz = c.Fz;
  let n = 0;

  out.push(terzGroup('A · Capacité portante'));

  // 1) Géométrie et sollicitations
  n += 1;
  let loads = `Vd = Fz = ${terzFmt(Fz, 0)} kN${pm}`;
  if (terzNum(c.Hd) > 1e-9) loads += ` · Hd = ${terzFmt(c.Hd, 0)} kN${pm}`;
  out.push(
    terzStep(n, 'Géométrie et sollicitations', [
      `Forme : ${FDN_FORME[X.forme] ?? X.forme} · B = ${terzFmt(B)} m${X.forme === 'rect' ? ` · L = ${terzFmt(X.L)} m` : ''} · D = ${terzFmt(X.D)} m`,
      terzEqn('A', "aire d'appui", '', `${terzFmt(c.A)} m²${pm}`),
      loads,
    ]),
  );

  // 2) Excentrement et surface comprimée A'
  n += 1;
  const excLines: string[] = [
    terzEqn(
      'eB',
      '|My| / Vd',
      `${terzFmt(Math.abs(terzNum(c.My)), 0)} / ${terzFmt(Fz, 0)}`,
      `${terzFmt(c.eB, 3)} m`,
    ),
  ];
  if (!X.filante && X.forme !== 'circ')
    excLines.push(
      terzEqn(
        'eL',
        '|Mx| / Vd',
        `${terzFmt(Math.abs(terzNum(c.Mx)), 0)} / ${terzFmt(Fz, 0)}`,
        `${terzFmt(c.eL, 3)} m`,
      ),
    );
  if (Number.isFinite(terzNum(c.Bp)))
    excLines.push(terzEqn("B'", 'B − 2·eB', '', `${terzFmt(c.Bp)} m`));
  excLines.push(
    terzEqn(
      "A' (Meyerhof)",
      'surface comprimée',
      '',
      `${terzFmt(c.Ap)} m²${pm}`,
    ),
  );
  out.push(terzStep(n, 'Excentrement et surface comprimée A′', excLines));

  // 3) Inclinaison de la charge
  n += 1;
  out.push(
    terzStep(n, 'Inclinaison de la charge', [
      terzEqn(
        'Hd',
        '√(Fx² + Fy²)',
        `${terzFmt(c.Fx, 0)}, ${terzFmt(c.Fy, 0)}`,
        `${terzFmt(c.Hd, 0)} kN${pm}`,
      ),
      terzEqn('δd', 'atan(Hd / Vd)', '', `${terzFmt(c.delta, 1)} °`),
      `iδ = ${terzFmt(c.idel, 3)}`,
    ]),
  );

  // 4) Contraintes au niveau de la base
  n += 1;
  out.push(
    terzStep(n, 'Contraintes au niveau de la base', [
      terzEqn('u', "pression d'eau", '', `${terzFmt(X.u, 1)} kPa`),
      terzEqn(
        'q0',
        'γap · D',
        `${terzFmt(X.gAp, 1)} × ${terzFmt(X.D)}`,
        `${terzFmt(X.q0, 1)} kPa`,
      ),
      terzEqn(
        "σ'v0",
        'γav · D − u',
        `${terzFmt(X.gAv, 1)} × ${terzFmt(X.D)} − ${terzFmt(X.u, 1)}`,
        `${terzFmt(X.sv0, 1)} kPa`,
      ),
    ]),
  );

  if (!X.labo) {
    const rLbl = X.essai === 'penetro' ? 'qce' : 'ple*';
    const kLbl = X.essai === 'penetro' ? 'kc' : 'kp';
    // 5) Pression nette équivalente
    n += 1;
    out.push(
      terzStep(n, `Pression nette équivalente ${rLbl}`, [
        terzEqn(
          'hr (hauteur de moyenne)',
          '1,5 · B',
          `1,5 × ${terzFmt(B)}`,
          `${terzFmt(c.hr)} m`,
        ),
        `${rLbl} = ${terzFmt(c.ple, 3)} MPa`,
      ]),
    );
    // 6) Hauteur d'encastrement équivalente De
    n += 1;
    out.push(
      terzStep(n, "Hauteur d'encastrement équivalente De", [
        `De = ${terzFmt(c.De)} m  →  De/B = ${terzFmt(c.De)}/${terzFmt(B)} = ${terzFmt(c.DeB)}`,
      ]),
    );
    // 7) Facteur de portance
    n += 1;
    const kpLines: string[] = [`x = De/B (plafonné à 2) = ${terzFmt(c.kpx)}`];
    if (X.filante) kpLines.push(`${kLbl} = ${terzFmt(c.kf, 3)}`);
    else if (X.forme === 'rect')
      kpLines.push(
        `${kLbl} (base filante) = ${terzFmt(c.kf, 3)}`,
        `${kLbl} (base carrée) = ${terzFmt(c.kc, 3)}`,
        `${kLbl} = ${terzFmt(c.kp, 3)}`,
      );
    else kpLines.push(`${kLbl} (carré/cercle) = ${terzFmt(c.kp, 3)}`);
    out.push(terzStep(n, `Facteur de portance ${kLbl}`, kpLines));
    // 8) Coefficients de réduction
    n += 1;
    out.push(
      terzStep(n, 'Coefficients de réduction', [
        `iδ (inclinaison) = ${terzFmt(c.idel, 3)} · iβ (talus) = ${terzFmt(c.ibet, 3)}`,
        terzEqn('iδβ (combiné)', 'iδ · iβ', '', `${terzFmt(c.idb, 3)}`),
      ]),
    );
    // 9) Résistance nette du sol
    n += 1;
    out.push(
      terzStep(n, 'Résistance nette du sol qnet', [
        terzEqn(
          'qnet',
          `${kLbl} · ${rLbl} · iδβ`,
          '',
          `${terzFmt(terzNum(c.qnet) / 1000, 3)} MPa = ${terzFmt(c.qnet, 0)} kPa`,
        ),
      ]),
    );
  } else {
    // Labo (c–φ, annexe F) : la résistance nette est analytique.
    n += 1;
    out.push(
      terzStep(n, 'Résistance nette qnet (annexe F, c–φ)', [
        terzEqn(
          'qnet',
          '(annexe F : Nc·sc·ic, Nq·sq·iq, ½·γ′·B′·Nγ·sγ·iγ)',
          '',
          `${terzFmt(c.qnet, 0)} kPa`,
        ),
      ]),
    );
  }

  // 10) Contrainte de référence appliquée
  n += 1;
  out.push(
    terzStep(n, 'Contrainte de référence appliquée', [
      terzEqn(
        'qref',
        "Vd / A'",
        `${terzFmt(Fz, 0)} / ${terzFmt(c.Ap)}`,
        `${terzFmt(c.qref, 0)} kPa`,
      ),
    ]),
  );

  // 11) Résistance de calcul et vérification
  n += 1;
  const portOk = c.portanceOk === true;
  out.push(
    terzStep(n, 'Résistance de calcul Rv;d et vérification', [
      terzEqn(
        'R0',
        'A · q0',
        `${terzFmt(c.A)} × ${terzFmt(X.q0, 1)}`,
        `${terzFmt(c.R0, 0)}${mlF}`,
      ),
      terzEqn(
        'Rv;d',
        'R0 + A′·qnet/(γRv·γRdv)',
        '',
        `${terzFmt(c.Rtot, 0)}${mlF}`,
      ),
      terzEqn(
        'qRv;d',
        "Rv;d / A'",
        `${terzFmt(c.Rtot, 0)} / ${terzFmt(c.Ap)}`,
        `${terzFmt(c.qRvd, 0)} kPa`,
      ),
      `Vérification : qref = ${terzFmt(c.qref, 0)} ${portOk ? '≤' : '>'} qRv;d = ${terzFmt(c.qRvd, 0)} kPa → portance ${portOk ? 'VÉRIFIÉE' : 'NON VÉRIFIÉE'} (taux ${terzFmt(terzNum(c.taux) * 100, 0)} %)`,
    ]),
  );

  // 12) Vérification complémentaire c–φ (annexe F) — in situ + option cochée
  const cphi = isPlainObject(c.cphi) ? c.cphi : null;
  if (!X.labo && cphi && typeof cphi.err !== 'string') {
    n += 1;
    const cok = cphi.ok === true;
    out.push(
      terzStep(n, 'Vérification complémentaire par la méthode c–φ (annexe F)', [
        terzEqn(
          'Rv;d;F',
          'R0 + A′·qnet;F/(γ·γ)',
          '',
          `${terzFmt(cphi.Rtot, 0)}${mlF}`,
        ),
        `qref = ${terzFmt(c.qref, 0)} ${cok ? '≤' : '>'} qRv;d;F = ${terzFmt(cphi.qRvd, 0)} kPa → ${cok ? 'vérifié' : 'NON vérifié'} (taux ${terzFmt(terzNum(cphi.taux) * 100, 0)} %)`,
      ]),
    );
  }

  // Glissement (ELU avec effort horizontal)
  const isELU = c.etat === 'ELU_F' || c.etat === 'ELU_A';
  if (isELU && terzNum(c.Hd) > 1e-9 && typeof c.glissementOk === 'boolean') {
    out.push(terzGroup('B · Glissement'));
    n += 1;
    const gok = c.glissementOk === true;
    const gLines: string[] = [];
    if (Number.isFinite(terzNum(c.da)))
      gLines.push(
        terzEqn(
          'Rh;d',
          'Vd·tan(δa) / (γRh·γRdh)',
          '',
          `${terzFmt(c.Rhd, 0)}${mlF}`,
        ),
        `δa = ${terzFmt(c.da, 1)} ° (interface ${X.beton === 'coule' ? 'béton coulé : δa = φ′' : 'préfa : δa = ⅔ φ′'})`,
      );
    else
      gLines.push(
        terzEqn(
          'Rh;d',
          "min( A'·cu/(γRh·γRdh) ; 0,4·Vd )",
          '',
          `${terzFmt(c.Rhd, 0)}${mlF}`,
        ),
      );
    gLines.push(
      `Vérification : Hd = ${terzFmt(c.Hd, 0)} ${gok ? '≤' : '>'} Rh;d = ${terzFmt(c.Rhd, 0)}${mlF} → ${gok ? 'VÉRIFIÉ' : 'NON VÉRIFIÉ'} (taux ${terzFmt(terzNum(c.tauxH) * 100, 0)} %)`,
    );
    out.push(terzStep(n, 'Résistance au glissement', gLines));
  }

  // Tassement (ELS)
  const tass = isPlainObject(c.tass) ? c.tass : null;
  const elast = isPlainObject(c.elast) ? c.elast : null;
  const schm = isPlainObject(c.schm) ? c.schm : null;
  const oed = isPlainObject(c.oed) ? c.oed : null;
  if (tass || elast || schm || oed) {
    out.push(terzGroup('C · Tassement'));
    const dq = Math.max(terzNum(c.qref) - X.sv0, 0);
    n += 1;
    out.push(
      terzStep(n, 'Accroissement de contrainte sous la base', [
        terzEqn(
          'Δq',
          "qref − σ'v0",
          `${terzFmt(c.qref, 0)} − ${terzFmt(X.sv0, 1)}`,
          `${terzFmt(dq, 0)} kPa`,
        ),
      ]),
    );
    if (tass) {
      n += 1;
      out.push(
        terzStep(n, 'Modules pressiométriques et coefficients', [
          `Ec = ${terzFmt(tass.Ec, 1)} MPa · Ed = ${terzFmt(tass.Ed, 1)} MPa`,
          `αc = ${terzFmt(tass.alc, 2)} · αd = ${terzFmt(tass.ald, 2)} · λc = ${terzFmt(tass.lc, 2)} · λd = ${terzFmt(tass.ld, 2)}`,
        ]),
      );
      n += 1;
      out.push(
        terzStep(n, 'Tassement de consolidation sc', [
          terzEqn(
            'sc',
            'αc/(9·Ec) · Δq · λc · B',
            '',
            `${terzFmt(terzNum(tass.sc) * 100, 2)} cm`,
          ),
        ]),
      );
      n += 1;
      out.push(
        terzStep(n, 'Tassement déviatorique sd', [
          terzEqn(
            'sd',
            '2/(9·Ed) · Δq · B0 · (λd·B/B0)^αd',
            '',
            `${terzFmt(terzNum(tass.sd) * 100, 2)} cm`,
          ),
        ]),
      );
      n += 1;
      out.push(
        terzStep(n, 'Tassement total', [
          terzEqn(
            'sf',
            'sc + sd',
            `${terzFmt(terzNum(tass.sc) * 100, 2)} + ${terzFmt(terzNum(tass.sd) * 100, 2)}`,
            `${terzFmt(terzNum(tass.sf) * 100, 2)} cm`,
          ),
        ]),
      );
    }
    if (elast) {
      n += 1;
      out.push(
        terzStep(n, 'Tassement élastique (annexe J.3.1)', [
          `cf = ${terzFmt(elast.cf, 2)} · E = ${terzFmt(elast.E, 0)} MPa · ν = ${terzFmt(elast.nu, 2)}`,
          terzEqn(
            's',
            'cf · (1 − ν²) · B · Δq / E',
            '',
            `${terzFmt(terzNum(elast.s) * 100, 2)} cm`,
          ),
        ]),
      );
    }
    if (schm) {
      n += 1;
      out.push(
        terzStep(n, 'Tassement de Schmertmann (§6.2)', [
          `C1 = ${terzFmt(schm.C1, 2)} · C2 = ${terzFmt(schm.C2, 2)} · C3 = ${terzFmt(schm.C3, 2)}`,
          terzEqn(
            's',
            'C1·C2·Δq·∫ Iz/(C3·E) dz',
            '',
            `${terzFmt(terzNum(schm.s) * 100, 2)} cm`,
          ),
        ]),
      );
    }
    if (oed) {
      n += 1;
      out.push(
        terzStep(n, 'Tassement œdométrique (variante J.4.1)', [
          terzEqn(
            's',
            'qref · ∫ Iz(ζ)/M(ζ) dζ',
            '',
            `${terzFmt(terzNum(oed.s) * 100, 2)} cm`,
          ),
        ]),
      );
    }
  }
  return out;
}

/** Déroulé de la CAPACITÉ PORTANTE DE RÉFÉRENCE (charge centrée verticale) —
 * MIROIR condensé de `refCapSteps`, utilisé quand aucun cas de charge n'est saisi. */
function terzRefCapSteps(rc: Record<string, unknown>, X: FdnCtx): Content[] {
  const out: Content[] = [];
  const mlF = rc.perML === true || X.filante ? ' kN/ml' : ' kN';
  let n = 0;
  out.push(terzGroup('A · Capacité portante Rv;d'));
  n += 1;
  out.push(
    terzStep(n, 'Géométrie de la semelle', [
      `Forme : ${FDN_FORME[X.forme] ?? X.forme} · B = ${terzFmt(X.B)} m${X.forme === 'rect' ? ` · L = ${terzFmt(X.L)} m` : ''} · encastrement D = ${terzFmt(X.D)} m`,
      terzEqn("A (surface d'appui)", "aire d'appui", '', `${terzFmt(rc.A)} m²`),
    ]),
  );
  n += 1;
  out.push(
    terzStep(n, 'Contraintes au niveau de la base', [
      terzEqn('u', "pression d'eau", '', `${terzFmt(X.u, 1)} kPa`),
      terzEqn(
        'q0',
        'γap · D',
        `${terzFmt(X.gAp, 1)} × ${terzFmt(X.D)}`,
        `${terzFmt(rc.q0, 1)} kPa`,
      ),
      terzEqn("σ'v0", 'γav · D − u', '', `${terzFmt(X.sv0, 1)} kPa`),
    ]),
  );
  const method = typeof rc.method === 'string' ? rc.method : '';
  if (method.indexOf('c–φ') < 0) {
    const rLbl = X.essai === 'penetro' ? 'qce' : 'ple*';
    const kLbl = X.essai === 'penetro' ? 'kc' : 'kp';
    n += 1;
    out.push(
      terzStep(n, `Pression nette équivalente ${rLbl}`, [
        `hr = 1,5 · B = ${terzFmt(rc.hr)} m`,
        `${rLbl} = ${terzFmt(rc.ple, 3)} MPa`,
      ]),
    );
    n += 1;
    out.push(
      terzStep(n, "Hauteur d'encastrement équivalente De", [
        `De = ${terzFmt(rc.De)} m  →  De/B = ${terzFmt(rc.DeB)}`,
      ]),
    );
    n += 1;
    out.push(
      terzStep(n, `Facteur de portance ${kLbl}`, [
        `x = De/B = ${terzFmt(rc.kpx)} · ${kLbl} = ${terzFmt(rc.kp, 3)}`,
      ]),
    );
    n += 1;
    out.push(
      terzStep(n, 'Résistance nette du sol qnet', [
        `qnet = ${terzFmt(rc.qnet, 0)} kPa`,
      ]),
    );
  }
  // Résistances par état-limite.
  const states = (Array.isArray(rc.states) ? rc.states : []).filter(
    isPlainObject,
  );
  if (states.length > 0) {
    n += 1;
    const lines = states.map(
      (s) =>
        `${FDN_ETAT[pdfText(s.etat)] ?? pdfText(s.etat)} : Rv;d = ${terzFmt(s.Rvd, 0)}${mlF} · qRv;d = ${terzFmt(s.qRvd, 0)} kPa`,
    );
    out.push(terzStep(n, 'Résistances de calcul par état-limite', lines));
  }
  return out;
}

function buildFondationBody(sealed: SealedContent): Content[] {
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  const output = (sealed.output ?? {}) as Record<string, unknown>;
  const cb = isPlainObject(output.contraintesBase)
    ? output.contraintesBase
    : {};
  const X = terzCtx(input, cb);
  const body: Content[] = [];

  body.push(buildFondationVerdictBanner(sealed.verdict));

  const methLib = X.labo
    ? 'méthode c–φ'
    : X.essai === 'penetro'
      ? 'méthode pénétrométrique'
      : 'méthode pressiométrique';

  // En-tête de la note (miroir de l'en-tête `buildNote`).
  body.push({
    stack: [
      {
        text: 'Terzaghi — note de calcul',
        fontSize: 11,
        bold: true,
        color: COLORS.navy,
      },
      {
        text: `Semelle superficielle · ${methLib} · NF P 94-261`,
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [0, 8, 0, 2],
  });

  // === §1 · Hypothèses ===
  body.push(sectionTitle('1 · Hypothèses'));
  const formeLib = FDN_FORME[X.forme] ?? X.forme;
  let fondTxt = formeLib;
  if (X.forme === 'circ') fondTxt += `, diamètre B = ${terzFmt(X.B)} m`;
  else {
    fondTxt += `, B = ${terzFmt(X.B)} m`;
    if (X.forme === 'rect') fondTxt += `, L = ${terzFmt(X.L)} m`;
  }
  // BQ-3 : D d'encastrement RÉELLEMENT peuplé depuis l'entrée saisie.
  fondTxt += `, encastrement D = ${terzFmt(X.D)} m`;
  const solLib = FDN_SOL[pdfText(input.solCat)] ?? pdfText(input.solCat);
  const interfaceLib =
    // MIROIR binaire de la note native : `coule` sinon « préfabriquée ».
    X.beton === 'coule'
      ? 'béton coulé en place (δa = φ′)'
      : 'préfabriquée (δa = ⅔ φ′)';
  const methRow = X.labo
    ? 'méthode c–φ (paramètres de cisaillement) — portance par l’approche analytique (annexe F) ; tassement par élasticité linéaire (annexe J.3.1)'
    : X.essai === 'penetro'
      ? 'pénétromètre statique — portance par la méthode pénétrométrique (annexe E)'
      : 'pressiomètre Ménard — portance par la méthode pressiométrique (annexe D)';
  const nappeTxt = Number.isFinite(X.zw)
    ? `, nappe à ${terzFmt(X.zw)} m/TN (γw = 10 kN/m³)`
    : ', nappe non rencontrée';
  const hyp: TableCell[][] = [
    terzHypRow('Fondation', fondTxt),
    terzHypRow(
      'Terrain porteur',
      `${solLib} — c′ = ${terzFmt(input.c, 0)} kPa, φ′ = ${terzFmt(input.phi, 0)} °, interface ${interfaceLib}`,
    ),
    terzHypRow('Méthode', methRow),
    terzHypRow(
      'Poids volumiques',
      `γ avant = ${terzFmt(X.gAv, 1)} kN/m³, γ après = ${terzFmt(X.gAp, 1)} kN/m³${nappeTxt}`,
    ),
  ];
  body.push({
    table: { widths: ['auto', '*'], body: hyp },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // Profil de sondage (mode in situ ; pas de sondage en labo).
  const sondage = (Array.isArray(input.sondage) ? input.sondage : []).filter(
    isPlainObject,
  );
  if (!X.labo && sondage.length > 0) {
    if (X.essai === 'penetro') {
      const sb: TableCell[][] = [
        [fdnHead('z (m/TN)', 'right'), fdnHead('qc (MPa)', 'right')],
      ];
      for (const s of sondage)
        sb.push([
          { text: terzFmt(s.z), style: 'cell', alignment: 'right' },
          { text: terzFmt(s.qc), style: 'cell', alignment: 'right' },
        ]);
      body.push({
        table: { headerRows: 1, widths: ['*', '*'], body: sb },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    } else {
      const sb: TableCell[][] = [
        [
          fdnHead('z (m/TN)', 'right'),
          fdnHead('pl* (MPa)', 'right'),
          fdnHead('EM (MPa)', 'right'),
          fdnHead('α (–)', 'right'),
        ],
      ];
      for (const s of sondage)
        sb.push([
          { text: terzFmt(s.z), style: 'cell', alignment: 'right' },
          { text: terzFmt(s.pl), style: 'cell', alignment: 'right' },
          { text: terzFmt(s.em, 1), style: 'cell', alignment: 'right' },
          { text: terzFmt(s.al), style: 'cell', alignment: 'right' },
        ]);
      body.push({
        table: { headerRows: 1, widths: ['*', '*', '*', '*'], body: sb },
        layout: FINE_TABLE_LAYOUT,
        margin: [0, 2, 0, 4],
      });
    }
  }

  // === §2 · Contraintes au niveau de la base === (BQ : section auparavant ABSENTE)
  if (Number.isFinite(X.u) && Number.isFinite(X.q0) && Number.isFinite(X.sv0)) {
    body.push(sectionTitle('2 · Contraintes au niveau de la base'));
    body.push({
      text: `u = ${terzFmt(X.u, 1)} kPa   ·   q0 (totale, après travaux) = γap·D = ${terzFmt(X.q0, 1)} kPa   ·   σ′v0 (effective, avant travaux) = γav·D − u = ${terzFmt(X.sv0, 1)} kPa`,
      fontSize: 8.5,
      color: COLORS.textSec2,
      margin: [0, 2, 0, 4],
    });
  }

  // === §3..N · Développement du calcul pas-à-pas ===
  // Efforts SAISIS re-attachés à chaque cas (miroir `mapOutputToR`).
  const charges = (Array.isArray(input.charges) ? input.charges : []) as Record<
    string,
    unknown
  >[];
  const rawCas = (Array.isArray(output.cas) ? output.cas : []).filter(
    isPlainObject,
  );
  const casWithEfforts: Record<string, unknown>[] = rawCas.map((o) => {
    const idx = typeof o.idx === 'number' ? o.idx : 0;
    const ch = charges[idx] ?? {};
    return {
      ...o,
      Fz: terzNum(ch.fz),
      Fx: terzNum(ch.fx) || 0,
      Fy: terzNum(ch.fy) || 0,
      Mx: terzNum(ch.mx) || 0,
      My: terzNum(ch.my) || 0,
    };
  });
  const validCas = casWithEfforts.filter((c) => c.invalide !== true);
  const refCap = isPlainObject(output.capaciteReference)
    ? output.capaciteReference
    : null;

  let secNo = 3;
  if (validCas.length === 0 && refCap && refCap.ok === true) {
    body.push(
      sectionTitle(
        `${secNo} · Capacité portante de référence — charge centrée verticale (calcul détaillé)`,
      ),
    );
    body.push({
      text: 'Les charges n’ont pas été saisies : ce paragraphe déroule la charge maximale que la semelle peut supporter (charge centrée et verticale, cas le plus favorable).',
      fontSize: 8.5,
      italics: true,
      color: COLORS.muted,
      margin: [0, 2, 0, 2],
    });
    body.push(...terzRefCapSteps(refCap, X));
    secNo += 1;
  } else {
    for (const c of casWithEfforts) {
      const head = terzCaseHead(c, X);
      body.push(sectionTitle(`${secNo} · ${head.title}`));
      body.push({
        text: head.loads,
        fontSize: 8.5,
        italics: true,
        color: COLORS.muted,
        margin: [0, 2, 0, 2],
      });
      if (c.invalide === true) {
        body.push({
          text: 'Cas de charge rejeté à la saisie (charge nulle ou géométrie invalide).',
          style: 'cellMuted',
          color: COLORS.alert,
          margin: [0, 2, 0, 2],
        });
      } else {
        body.push(...terzCaseSteps(c, X));
      }
      secNo += 1;
    }
  }

  // Raideurs équivalentes du sol support (annexe J.3 / Gazetas) — la note native
  // les rend dans le déroulé (groupe « Raideurs équivalentes ») ; ici, une fois,
  // depuis le champ whitelisté `output.raideurs` (Kv/Kh/Kθ, déjà affichés à l'écran).
  const raid = isPlainObject(output.raideurs) ? output.raideurs : null;
  if (raid && Number.isFinite(terzNum(raid.Kv))) {
    const mlK = raid.perML === true ? '/ml' : '';
    body.push(fdnSubTitle('Raideurs équivalentes du sol support'));
    const rLines = [
      `Kv = ${terzFmt(raid.Kv, 0)} MN/m${mlK} (verticale)`,
      `Kh;B / Kh;L = ${terzFmt(raid.KhB, 0)} / ${terzFmt(raid.KhL, 0)} MN/m${mlK} (horizontale)`,
      `Kθ;B / Kθ;L = ${terzFmt(raid.KtB, 0)} / ${terzFmt(raid.KtL, 0)} MN·m/rd${mlK} (rotation)`,
    ];
    body.push({
      text: rLines.join('\n'),
      fontSize: 8.5,
      color: COLORS.textSec2,
      margin: [10, 0, 0, 4],
    });
  }

  // === Synthèse === (BQ-5 : colonne EXCENTREMENT ; tassement en CENTIMÈTRES)
  body.push(sectionTitle(`${secNo} · Synthèse`));
  const syn: TableCell[][] = [
    [
      fdnHead('Cas'),
      fdnHead('État-limite'),
      fdnHead('Portance', 'center'),
      fdnHead('Excentr.', 'center'),
      fdnHead('Glissement', 'center'),
      fdnHead('sf (cm) · qref', 'right'),
    ],
  ];
  const okCell = (v: unknown): TableCell => {
    if (typeof v !== 'boolean')
      return { text: '—', style: 'cell', alignment: 'center' };
    return {
      text: v ? 'OK' : 'NON',
      style: 'cell',
      alignment: 'center',
      bold: true,
      color: v ? COLORS.navy : COLORS.alert,
    };
  };
  for (const c of casWithEfforts) {
    const idx = typeof c.idx === 'number' ? c.idx : 0;
    const etat = FDN_ETAT[pdfText(c.etat)] ?? pdfText(c.etat);
    if (c.invalide === true) {
      syn.push([
        { text: String(idx + 1), style: 'cell' },
        { text: etat, style: 'cell' },
        { text: '—', style: 'cell', alignment: 'center' },
        { text: '—', style: 'cell', alignment: 'center' },
        { text: '—', style: 'cell', alignment: 'center' },
        { text: '—', style: 'cell', alignment: 'right' },
      ]);
      continue;
    }
    const taux = Number.isFinite(terzNum(c.taux))
      ? ` (${terzFmt(terzNum(c.taux) * 100, 0)} %)`
      : '';
    const portCell: TableCell = {
      text: `${c.portanceOk === true ? 'OK' : c.portanceOk === false ? 'NON' : '—'}${taux}`,
      style: 'cell',
      alignment: 'center',
      bold: true,
      color: c.portanceOk === false ? COLORS.alert : COLORS.navy,
    };
    // Tassement : première méthode disponible, en CENTIMÈTRES (fmt sf·100).
    const sfM = fdnFirstFinite(
      c.tassement,
      c.tassementElastique,
      c.tassementSchmertmann,
      c.tassementOed,
    );
    const sfCell =
      sfM === null
        ? '—'
        : `${terzFmt(sfM * 100, 2)} cm${Number.isFinite(terzNum(c.qref)) ? ` (${terzFmt(c.qref, 0)} kPa)` : ''}`;
    syn.push([
      { text: String(idx + 1), style: 'cell' },
      { text: etat, style: 'cell' },
      portCell,
      okCell(c.excOk),
      okCell(c.glissementOk),
      { text: sfCell, style: 'cell', alignment: 'right' },
    ]);
  }
  body.push({
    table: {
      headerRows: 1,
      widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
      body: syn,
    },
    layout: FINE_TABLE_LAYOUT,
    margin: [0, 2, 0, 4],
  });

  // Avertissements (déjà rédigés/whitelistés côté moteur).
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

/**
 * Encadré d'ALERTE proéminent (résultats NON VALIDES). Miroir de l'encadré ROUGE de
 * l'outil client GEOPLAQUE (`R.overCap` : capacité d'interface dépassée / poinçonnement)
 * — pleine largeur, fond bordeaux, texte blanc gras. Le message est déjà CLIENT-SAFE
 * (whitelisté/rédigé côté moteur) : rendu verbatim, sans intermédiaire de calcul.
 */
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


function buildRadierBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  // AVERTISSEMENTS — le poinçonnement (résultats NON VALIDES) est PROÉMINENT : encadré
  // rouge EN TÊTE des résultats, comme l'outil client. Les warnings sont déjà rédigés/
  // whitelistés côté moteur ; ici on les CLASSE (critique vs. informatif) et on rend le
  // critique en alerte. `warnings` est une whitelist du RadierOutputSchema.
  const warnings = (Array.isArray(o.warnings) ? o.warnings : []).filter(
    (w): w is string => typeof w === 'string',
  );
  const critiques = warnings.filter((w) => /non valides/i.test(w));
  const autres = warnings.filter((w) => !/non valides/i.test(w));
  for (const w of critiques) body.push(buildRadierAlertBox(w));

  body.push(sectionTitle('Déflexions & distorsions'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  // AFFICHAGE = COPIE de l'outil client GEOPLAQUE_V10 (`refreshResults`, décision
  // titulaire 15/07 re-confirmée 17/07 : « zéro écart absolu »). La sortie MOTEUR reste
  // juste (tassements en mm, distorsions en ‰) et le scellé est INCHANGÉ ; seule la
  // PRÉSENTATION reproduit les défauts de l'outil : tassements ×1000 (fdnSettleMm),
  // distorsions/pentes rendues CRUES via ratio1 + valeur brute « rad » (fdnBetaRad /
  // fdnRotRad). Inclinaison ϖ = `ratio1(tilt)` SEUL (l'outil client ne lui adjoint pas de
  // « rad »). Détails du raisonnement d'unité : bandeau des helpers ci-dessus.
  // COMPLÉTUDE : tous les diagnostics client-safe (RadierOutputSchema), ordre GEOPLAQUE_V10.
  fdnKvRow(t, 'Tassement maximal w_max', fdnSettleMm(o.wMax));
  fdnKvRow(t, 'Tassement minimal w_min', fdnSettleMm(o.wMin));
  fdnKvRow(t, 'Tassement différentiel', fdnSettleMm(o.diff));
  fdnKvRow(t, 'Distorsion angulaire gouvernante β', fdnBetaRad(o.betaGov));
  fdnKvRow(t, 'Distorsion intra-plaque max', fdnBetaRad(o.betaIntra));
  fdnKvRow(t, "Inclinaison d'ensemble ϖ", ratio1(o.tiltMax));
  fdnKvRow(t, 'Pente locale max |∇w|', fdnRotRad(o.slopeMax));
  const nRafts = typeof o.nRafts === 'number' ? o.nRafts : 0;
  if (nRafts > 1) {
    // Inter-plaques : l'outil client affiche `ratio1(interBeta)  · Δs (interDiff*1000)`
    // — distorsion CRUE (ratio1 seul) + différentiel ×1000.
    fdnKvRow(t, 'Distorsion entre plaques', ratio1(o.betaInter));
    fdnKvRow(
      t,
      'Tassement différentiel inter-plaques',
      fdnSettleMm(o.interDiff),
    );
  }
  const wlp = o.worstLoadPair;
  if (wlp != null && typeof wlp === 'object') {
    // Entre charges : l'outil client affiche `ratio1(w.beta)  · Δs …` (ratio1 seul).
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

  // SYNTHÈSE — bilan global (panneau « Synthèse » de GEOPLAQUE_V10, ADR 0014). Diagnostics
  // GLOBAUX (scalaires) : bilans de charge/réaction, rotations et réactions/moments
  // EXTREMES. Ordre de l'outil d'origine. Les lignes CONDITIONNELLES (Winkler/ressorts/
  // décollement) valent `null` quand l'option est inactive -> fdnNum -> « — » -> fdnKvRow
  // les OMET (jamais de ligne parasite). `decolNodes = 0` (décollement actif, aucun nœud
  // décollé) est FINI -> RENDU « 0 » (distinct de l'option inactive). Aucune localisation
  // ni champ nodal (méthode EF) : ces VALEURS scalaires sont client-safe (whitelist #54).
  const s: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  fdnKvRow(s, 'Charge appliquée Σ', fdnNum(o.totalLoad, 1, 'kN'));
  fdnKvRow(s, 'Σ réactions du sol', fdnNum(o.sumReact, 1, 'kN'));
  fdnKvRow(s, 'Σ réaction de Winkler', fdnNum(o.sumWink, 1, 'kN'));
  fdnKvRow(s, 'Σ réaction des ressorts', fdnNum(o.sumSpr, 1, 'kN'));
  // Rotations : format « Synthèse » de l'outil client (`v.toExponential(2)+' rad  ('+
  // ratio1(v)+')'`) — rendues CRUES, plus de ‰.
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

  // Autres avertissements (non critiques) — ligne sobre (l'alerte de poinçonnement, elle,
  // est déjà rendue en encadré rouge en tête). Déjà rédigés/whitelistés côté moteur.
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

// Qualificatif du module de finesse (SABLES, NF P 18-540) — ensemble FERMÉ produit
// par l'outil client (`mf<=2.2?'très fin':mf<=2.8?'idéal':'grossier'`). Fail-closed :
// tout autre contenu est écarté (pas de texte arbitraire dans un livrable scellé).
const LABO_MFQ_ALLOWED: ReadonlySet<string> = new Set([
  'très fin',
  'idéal',
  'grossier',
]);
function safeLaboMfqPv(mfq: unknown): string {
  if (typeof mfq !== 'string') return '';
  const t = mfq.trim();
  return LABO_MFQ_ALLOWED.has(t) ? t : '';
}

// Assistant famille R (rocheux) — `classe.rNote` de l'outil client : famille géologique
// R1–R6 + éventuels LA/MDE (résultats client-safe). Fail-closed : chaque entrée doit
// coller au gabarit, sinon écartée. Ordre d'origine préservé, rendu joint par « · ».
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

// Anticipation TOLÉRANTE : futur champ `caveats: string[]` (chantier moteur parallèle).
// Points à vérifier client-safe (produits par le moteur, whitelistés au sceau). On rend
// les chaînes non vides ; toute entrée non-chaîne / vide est ignorée. Absent si champ absent.
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
  let laboRNote = '';
  if (cl != null && typeof cl === 'object') {
    const c = cl as Record<string, unknown>;
    // `code`/`full` incluent DÉJÀ la lettre de famille (code='A2', full='A2 h') :
    // concaténer `fam` la dupliquerait ('AA2'). Libellé canonique `full`, repli `code`.
    const full = typeof c.full === 'string' ? c.full.trim() : '';
    const code =
      c.code != null && c.code !== '' && pdfText(c.code) !== '—'
        ? pdfText(c.code).trim()
        : '';
    classe = full || code;
    // desc (allowlisté sur l'ensemble NF P 11-300) + path (allowlisté) = client-safe.
    laboDesc = safeLaboDescPv(c.desc);
    laboPath = safeLaboPathPv(c.path);
    // rNote (assistant famille R rocheuse, allowlisté) = client-safe.
    laboRNote = safeLaboRNotePv(c.rNote);
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
  // Assistant famille R (rocheux) — miroir de l'encadré info de l'outil client.
  if (laboRNote) {
    body.push(fdnSubTitle('Assistant famille R (rocheux)'));
    body.push({ text: laboRNote, style: 'cellMuted', margin: [0, 0, 0, 6] });
  }
  // Points à vérifier (caveats, si le moteur en fournit) — encart sobre, absent sinon.
  const caveats = safeCaveatsPv(o.caveats);
  if (caveats.length > 0) {
    body.push(fdnSubTitle('Points à vérifier'));
    caveats.forEach((line, i) => {
      body.push({
        text: `· ${line}`,
        style: 'cellMuted',
        margin: [0, 0, 0, i === caveats.length - 1 ? 6 : 2],
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
  // Module de finesse + qualificatif SABLES (mfq) : « 2,41 (idéal) », comme l'outil client.
  const mfVal = fdnNum(o.mf, 2);
  const mfq = safeLaboMfqPv(o.mfq);
  fdnKvRow(
    t,
    'Module de finesse',
    mfVal !== '—' && mfq ? `${mfVal} (${mfq})` : mfVal,
  );
  fdnKvRow(t, 'Teneur en eau naturelle w_n', fdnNum(o.wn, 1, '%'));
  fdnKvRow(t, 'Limite de liquidité w_L', fdnNum(o.wl, 0, '%'));
  fdnKvRow(t, 'Limite de plasticité w_P', fdnNum(o.wp, 0, '%'));
  fdnKvRow(t, 'Indice de plasticité I_P', fdnNum(o.ip, 0));
  fdnKvRow(t, 'Indice de consistance I_C', fdnNum(o.ic, 2));
  fdnKvRow(t, 'Valeur au bleu VBS', fdnNum(o.vbs, 2));
  fdnKvRow(t, 'Masse volumique des grains ρ_s', fdnNum(o.rhos, 2, 'Mg/m³'));
  fdnKvRow(t, 'Masse volumique apparente ρ', fdnNum(o.rho_app, 2, 'Mg/m³'));
  fdnKvRow(
    t,
    'Masse volumique sèche apparente ρ_d',
    fdnNum(o.rhod_app, 2, 'Mg/m³'),
  );
  fdnKvRow(t, 'Teneur en eau optimale w_OPN', fdnNum(o.wopn, 1, '%'));
  fdnKvRow(t, 'Densité sèche max ρ_d;max', fdnNum(o.rdmax, 2, 't/m³'));
  // Le libellé reflète le type d'essai (CBR après immersion / IPI immédiat) — cbrType
  // est client-safe (résultat, pas méthode) : les deux alimentent la même valeur `cbr`.
  fdnKvRow(
    t,
    o.cbrType === 'ipi' ? 'IPI (Indice Portant Immédiat)' : 'Indice CBR',
    fdnNum(o.cbr, 0),
  );
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
  fdnKvRow(
    t,
    "Angle de frottement φ' (cisaillement)",
    fdnNum(o.phi_cis, 1, '°'),
  );
  fdnKvRow(t, "Angle de frottement résiduel φ'_R", fdnNum(o.phiR_cis, 1, '°'));
  fdnKvRow(t, "Cohésion c' (triaxial)", fdnNum(o.c, 1, 'kPa'));
  fdnKvRow(t, "Angle de frottement φ' (triaxial)", fdnNum(o.phi, 1, '°'));
  fdnKvRow(t, 'Cohésion non drainée c_u (UU)', fdnNum(o.cu_uu, 1, 'kPa'));
  // Perméabilité en notation scientifique (fdnExp) : ~1e-9 cm/s en notation fixe
  // rendrait « 0,00000000 » (illisible). Miroir du dépouillement client.
  fdnKvRow(t, 'Perméabilité k', fdnExp(o.k, 'cm/s'));
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


// ---------------------------------------------------------------------------
// Présentations « déformée 2D » GEOPLAQUE (déformations planes / axisymétrique /
// radier triangulaire) — RÉSULTATS de calcul EF, SANS verdict de conformité :
// pour ces modes l'outil client (`#ps-run` / `#ax-run` / `#tri-run`) n'affiche que
// des STATISTIQUES + une figure. Clés NOMMÉES (fail-closed, DoD §8). Les tassements
// sont sur-rapportés ×1000 (fdnSettleMm) pour COPIER l'affichage de l'outil client
// (`(R.wMax*1000).toFixed(1)+' mm'` des panneaux #ps-run/#ax-run/#tri-run) — décision
// titulaire 15/07 re-confirmée 17/07 (« zéro écart absolu ») ; sortie moteur et scellé
// INCHANGÉS (cf. bandeau des helpers radier + mémoire roadsen-radier-units).
// ---------------------------------------------------------------------------

/** Cellule de tableau alignée à droite (valeur numérique). */
function cellRight(text: string): TableCell {
  return { text, style: 'cell', alignment: 'right' };
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

function buildPlaneStrainBody(sealed: SealedContent): Content[] {
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
  // Cote d'assise & décollement : affichés par le client seulement si l'option est
  // ACTIVE (foundD>0 / décollement coché) — lu dans l'ENTRÉE scellée (fidélité exacte,
  // pas de ligne « 0 » parasite quand l'option est inactive).
  if (typeof opts.foundD === 'number' && opts.foundD > 0) {
    fdnKvRow(t, "Cote d'assise D", fdnNum(o.z0, 2, 'm'));
  }
  if (opts.decol === true) {
    fdnKvRow(t, 'Nœuds décollés (contact unilatéral)', fdnNum(o.decolN, 0));
  }
  // Rigidité de flexion D = E·e³/12(1−ν²) — affichée EN PERMANENCE par le client
  // (notation scientifique). Forme fermée des SEULES entrées publiques E/e/ν (ADR 0014) :
  // aucun intermédiaire de maillage, à distinguer du pas `dx` (SERVEUR).
  fdnKvRow(t, 'Rigidité de flexion D', fdnExp(o.EI, 'kN·m'));
  pushKvTable(body, t);

  body.push(...build2DErreurWarnings(o));
  return body;
}

function buildAxiBody(sealed: SealedContent): Content[] {
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

function buildTriRaftBody(sealed: SealedContent): Content[] {
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

// ---------------------------------------------------------------------------
// Corrections métrologiques pressiométriques (étalonnage / calibrage) — miroir de
// `renderEtalResult` / `renderCalibResult` de pressiometre__1_.html : coefficients
// d'appareillage + qualité d'ajustement (R²/RMS) + table des résidus. Analyse SANS
// verdict de conformité. Clés NOMMÉES (fail-closed, DoD §8). L'unité d'affichage du
// coefficient est le cm³/MPa (= valeur BRUTE cm³/bar ×10, comme l'outil client).
// ---------------------------------------------------------------------------

/**
 * Label QUALITÉ de l'ajustement d'étalonnage — seuils EXACTS de `renderEtalResult`
 * (ensemble FERMÉ). Fail-closed : R² non fini -> pas de label.
 */
function etalQualite(r2: unknown): string {
  if (typeof r2 !== 'number' || !Number.isFinite(r2)) return '';
  if (r2 > 0.9999) return 'Excellent';
  if (r2 > 0.999) return 'Très bon';
  if (r2 > 0.99) return 'Acceptable';
  return 'Mauvais — vérifier les données';
}

/** Label QUALITÉ du calibrage — seuils EXACTS de `renderCalibResult`. */
function calibQualite(r2: unknown): string {
  if (typeof r2 !== 'number' || !Number.isFinite(r2)) return '';
  if (r2 > 0.999) return 'Excellent';
  if (r2 > 0.99) return 'Bon';
  return 'Vérifier';
}

function buildPressioEtalonnageBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Étalonnage de la sonde (sonde dans l’air)'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  // Pente d'air affichée ×10 en cm³/MPa par le client (a brut = cm³/bar) — la mention
  // « ≠ coefficient a » reprend l'avertissement du client (ce n'est PAS le coeff. de
  // correction de volume, qui vient du CALIBRAGE).
  const aMpa =
    typeof o.a === 'number' && Number.isFinite(o.a) ? o.a * 10 : null;
  fdnKvRow(t, 'Pente d’air (≠ coefficient a)', fdnNum(aMpa, 1, 'cm³/MPa'));
  fdnKvRow(t, 'Vs (droite ajustée)', fdnNum(o.Vs, 1, 'cm³'));
  fdnKvRow(t, 'Vs réel (1er palier mesuré)', fdnNum(o.vsReel, 1, 'cm³'));
  fdnKvRow(t, 'Pe (à V = 1,2 × Vs)', fdnNum(o.Pe, 3, 'bar'));
  fdnKvRow(t, 'Volume cible V_pe = 1,2 × Vs', fdnNum(o.vPe, 0, 'cm³'));
  const r2 = fdnNum(o.R2, 6);
  const q = etalQualite(o.R2);
  fdnKvRow(
    t,
    'Coefficient de détermination R²',
    r2 !== '—' && q ? `${r2} (${q})` : r2,
  );
  fdnKvRow(t, 'Erreur quadratique moyenne (RMS)', fdnNum(o.rms, 3, 'cm³'));
  pushKvTable(body, t);

  body.push(...buildPressioResidus(o, 'V mesuré (cm³)', 'V ajusté (cm³)'));
  return body;
}

function buildPressioCalibrageBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const body: Content[] = [];
  body.push(buildAnalyseBanner());

  body.push(sectionTitle('Calibrage de volume (tube indéformable)'));
  const t: TableCell[][] = [[fdnHead('Grandeur'), fdnHead('Valeur', 'right')]];
  // a = pente dV/dP, affichée ×10 en cm³/MPa par le client (a brut = cm³/bar). C'est
  // LE coefficient de correction de volume réutilisable (Vc = Vr − a·Pr).
  const aMpa =
    typeof o.a === 'number' && Number.isFinite(o.a) ? o.a * 10 : null;
  fdnKvRow(t, 'Coefficient a (pente dV/dP)', fdnNum(aMpa, 3, 'cm³/MPa'));
  // Coefficients de la courbe polynomiale Pc = c0 + c1·V + c2·V² (notation
  // scientifique, comme les KPI `renderCalibResult`).
  fdnKvRow(t, 'c₀ (constante)', fdnExp(o.c0));
  fdnKvRow(t, 'c₁ (coefficient de V)', fdnExp(o.c1));
  fdnKvRow(t, 'c₂ (coefficient de V²)', fdnExp(o.c2));
  const r2 = fdnNum(o.R2, 6);
  const q = calibQualite(o.R2);
  fdnKvRow(
    t,
    'Coefficient de détermination R²',
    r2 !== '—' && q ? `${r2} (${q})` : r2,
  );
  fdnKvRow(t, 'Erreur quadratique moyenne (RMS)', fdnNum(o.rms, 4, 'bar'));
  pushKvTable(body, t);

  // Équation de la courbe (miroir du client) — seulement si les 3 coeffs sont finis.
  const c0 = fdnExp(o.c0);
  const c1 = fdnExp(o.c1);
  const c2 = fdnExp(o.c2);
  if (c0 !== '—' && c1 !== '—' && c2 !== '—') {
    body.push({
      text: `Équation ajustée : Pc = ${c0} + ${c1} × V + ${c2} × V²`,
      style: 'cellMuted',
      margin: [0, 2, 0, 4],
    });
  }

  body.push(...buildPressioResidus(o, 'V60 mesuré (cm³)', 'V60 ajusté (cm³)'));
  return body;
}

/**
 * Table des résidus (étalonnage / calibrage) — colonnes EXACTES du client
 * (P / V mesuré / V ajusté / Résidu). Chaque ligne est un objet {p, vMesure|v60Mesure,
 * vAjuste|v60Ajuste, residu} whitelisté au contrat ; lecture par clés NOMMÉES avec
 * repli étalonnage↔calibrage. Absente si aucun résidu (fail-closed).
 */
function buildPressioResidus(
  o: Record<string, unknown>,
  labelMesure: string,
  labelAjuste: string,
): Content[] {
  const residus = (Array.isArray(o.residus) ? o.residus : []).filter(
    isPlainObject,
  );
  if (residus.length === 0) return [];
  const rb: TableCell[][] = [
    [
      fdnHead('P (bar)', 'right'),
      fdnHead(labelMesure, 'right'),
      fdnHead(labelAjuste, 'right'),
      fdnHead('Résidu', 'right'),
    ],
  ];
  for (const r of residus) {
    const mesure = r.vMesure ?? r.v60Mesure;
    const ajuste = r.vAjuste ?? r.v60Ajuste;
    rb.push([
      cellRight(fdnNum(r.p, 2)),
      cellRight(fdnNum(mesure, 1)),
      cellRight(fdnNum(ajuste, 1)),
      cellRight(fdnNum(r.residu, 2)),
    ]);
  }
  return [
    fdnSubTitle('Tableau des résidus'),
    {
      table: {
        headerRows: 1,
        widths: ['*', '*', '*', '*'],
        body: rb,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    },
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
            { text: 'GEOFAM', style: 'brand' },
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

/**
 * RÉFÉRENTIEL normatif par moteur pour la note du bloc de scellement (BQ-4). Le
 * texte « méthode rationnelle (AGEROUTE 2015) » n'appartient QU'À la chaussée ;
 * chaque moteur cite sa propre norme. Un moteur inconnu tombe sur une formulation
 * neutre (jamais de citation normative fausse sur un livrable scellé).
 */
const SEAL_REFERENTIEL_BY_ENGINE: Record<string, string> = {
  'chaussee-burmister': 'la méthode rationnelle (AGEROUTE 2015)',
  'fondation-superficielle': 'la norme NF P 94-261 (fondations superficielles)',
  'fondation-profonde-pieux':
    'la norme NF P 94-262 (fondations profondes, EC7)',
  'radier-plaque': 'la théorie des plaques sur sol élastique',
  'pressiometre-menard': 'l’essai pressiométrique Ménard (NF P 94-110)',
  'labo-classification-gtr': 'le guide GTR / NF P 11-300',
};

function sealReferentielNote(engineId: string): string {
  const ref =
    SEAL_REFERENTIEL_BY_ENGINE[engineId] ??
    'le référentiel normatif applicable au calcul';
  return `Libellés et unités métier établis selon ${ref} — en cours de co-validation avec l’expert.`;
}

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
              // NOTE SCIENCE (#71-titulaire 3) : RÉFÉRENTIEL conditionnel au moteur
              // (BQ-4). Le boilerplate « AGEROUTE 2015 » (chaussée) ne doit PAS
              // s'imprimer sur un PV de fondation/pieux/etc. : chaque moteur porte
              // sa propre norme (NF P 94-261 superficielle, NF P 94-262 pieux…).
              {
                text: sealReferentielNote(sealed.engineMeta.engineId),
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
