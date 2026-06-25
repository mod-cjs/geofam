/**
 * IDENTITE MAISON ROADSEN pour le PDF du PV (#63, incr. C).
 *
 * Palette + typographie reprises EXACTEMENT des documents commerciaux
 * (01-Commercial/Devis_ROADSEN.html, Facture_Acompte, Rapport_Avancement) :
 *  - bleu d'en-tête #1a4a7a, fonds bleu pâle #f5f7fa / #f0f4f9 ;
 *  - neutres : texte #1f2937, secondaire #4b5563 / #374151, atténué #6b7280 /
 *    #9aa3ad, filets #e3e6ea / #eef0f3 ; carte #fafbfc ;
 *  - accent (mention prudente) #bf6a04.
 * Tableaux à filets fins, en-têtes de section MAJUSCULE inter-lettré, pied sobre.
 */
export const COLORS = {
  navy: '#1a4a7a',
  navyFillSoft: '#f5f7fa',
  groupFill: '#f0f4f9',
  cardFill: '#fafbfc',
  text: '#1f2937',
  textSec: '#4b5563',
  textSec2: '#374151',
  muted: '#6b7280',
  muted2: '#9aa3ad',
  rule: '#e3e6ea',
  ruleThin: '#eef0f3',
  white: '#ffffff',
  accent: '#bf6a04',
} as const;

/** Styles nommés pdfmake (hiérarchie de tailles alignée sur les docs maison). */
export const PV_STYLES = {
  h1: { fontSize: 20, bold: true, color: COLORS.navy, letterSpacing: 0.3 },
  brand: {
    fontSize: 11,
    bold: true,
    color: COLORS.navy,
    characterSpacing: 0.5,
  },
  sub: { fontSize: 8.5, color: COLORS.muted },
  // En-tête de section : MAJUSCULE inter-lettré, bleu.
  section: {
    fontSize: 9.5,
    bold: true,
    color: COLORS.navy,
    characterSpacing: 1,
    margin: [0, 14, 0, 6] as [number, number, number, number],
  },
  // Libellé de carte (uppercase, petit, bleu).
  cardLabel: {
    fontSize: 7.5,
    bold: true,
    color: COLORS.navy,
    characterSpacing: 1,
  },
  cardValue: { fontSize: 9.5, color: COLORS.textSec2 },
  tableHead: { fontSize: 8.5, bold: true, color: COLORS.navy },
  cell: { fontSize: 9, color: COLORS.textSec2 },
  cellMuted: { fontSize: 9, color: COLORS.muted },
  groupRow: { fontSize: 8.5, bold: true, color: COLORS.navy },
  mono: { fontSize: 8.5, color: COLORS.text }, // Courier pour le hash (cf. font Courier)
  sealLabel: {
    fontSize: 7.5,
    bold: true,
    color: COLORS.navy,
    characterSpacing: 1,
  },
  footer: { fontSize: 7.5, color: COLORS.muted2 },
} as const;

/**
 * Layout de tableau « filets fins » maison : pas de bordures verticales, filets
 * horizontaux #eef0f3, en-tête sur fond #f5f7fa. Réutilisé par les tableaux
 * d'entrée et de résultats.
 */
export const FINE_TABLE_LAYOUT = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
    i === 0 || i === node.table.body.length ? 0.7 : 0.5,
  vLineWidth: () => 0,
  hLineColor: (i: number, node: { table: { body: unknown[] } }) =>
    i === 0 || i === 1 || i === node.table.body.length
      ? COLORS.rule
      : COLORS.ruleThin,
  paddingTop: () => 4,
  paddingBottom: () => 4,
  paddingLeft: () => 6,
  paddingRight: () => 6,
} as const;
