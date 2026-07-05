'use client';

/**
 * ROADSENS — Dimensionnement rationnel des chaussées (Burmister exact / AGEROUTE 2015)
 *
 * Page dédiée au logiciel ROADSENS dans l'application GEOFAM.
 * Reproduit fidèlement l'UI de l'outil d'origine (roadsens_burmister_LCPC_VF_moderne.html).
 *
 * DoD §8 — ZÉRO import @roadsen/engines, ZÉRO coefficient de fatigue côté navigateur.
 * Seule la saisie et la visualisation sont ici ; le calcul est serveur (étape 2).
 *
 * Palette : navy #1a4a7a (brand) + cuivre/latérite #bd6a30 (accent).
 * Coupe transversale : SVG généré depuis l'état React (fidèle à rSec() de l'original).
 */

import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, useId } from 'react';

import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type {
  Project,
  CalcResult,
  CalcOutputRow,
  NormalizedCalcOutput,
  OfficialPv,
  EntitlementsResponse,
} from '@/lib/api/types';
import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { useOrgId } from '@/lib/org-context';

// ---------------------------------------------------------------------------
// Constantes de matériaux — DISPLAY ONLY (pas de coefficients de calcul)
// Source : AGEROUTE Sénégal 2015 (document public), valeurs nominales
// ---------------------------------------------------------------------------

/** Nature de la couche (pour badge couleur). */
type LayerNature = 'bitumineux' | 'granulaire' | 'mtlh';

/** Données d'affichage d'un matériau — AUCUN coefficient de fatigue inclus. */
interface MaterialUI {
  label: string;
  E: number; // Module nominal (MPa) — valeur de saisie par défaut
  nu: number; // Poisson
  color: string; // Couleur pour la coupe transversale
  nature: LayerNature;
}

/**
 * Catalogue de matériaux — affichage, pré-remplissage des champs, coupe transversale.
 * E et ν sont des valeurs de saisie standard (AGEROUTE 2015 / LCPC), jamais des
 * coefficients internes du moteur (e₆, b, kc, s₆ restent côté serveur).
 */
const MATERIALS: Record<string, MaterialUI> = {
  BBSG1: {
    label: 'BBSG classe 1',
    E: 1512,
    nu: 0.45,
    color: '#1e1e1e',
    nature: 'bitumineux',
  },
  BBSG2: {
    label: 'BBSG classe 2/3',
    E: 1896,
    nu: 0.45,
    color: '#0a0a0a',
    nature: 'bitumineux',
  },
  BBTM: {
    label: 'BB Très Mince (BBTM)',
    E: 2500,
    nu: 0.45,
    color: '#2a2a2a',
    nature: 'bitumineux',
  },
  BBM: {
    label: 'BB Mince (BBM)',
    E: 2500,
    nu: 0.45,
    color: '#2f2f2f',
    nature: 'bitumineux',
  },
  GB2: {
    label: 'Grave Bitume GB2',
    E: 2588,
    nu: 0.45,
    color: '#383838',
    nature: 'bitumineux',
  },
  GB3: {
    label: 'Grave Bitume GB3',
    E: 2588,
    nu: 0.45,
    color: '#303030',
    nature: 'bitumineux',
  },
  EME2: { label: 'EME2', E: 6151, nu: 0.45, color: '#1c1c1c', nature: 'bitumineux' },
  GL1: {
    label: 'Latérite GL1',
    E: 200,
    nu: 0.35,
    color: '#c8a040',
    nature: 'granulaire',
  },
  GL2: {
    label: 'Latérite GL2',
    E: 400,
    nu: 0.35,
    color: '#c09030',
    nature: 'granulaire',
  },
  GLli: {
    label: 'Latérite litho-stabilisée',
    E: 400,
    nu: 0.35,
    color: '#b89838',
    nature: 'granulaire',
  },
  GLa: {
    label: 'Latérite améliorée (GLa)',
    E: 400,
    nu: 0.35,
    color: '#b0a040',
    nature: 'granulaire',
  },
  GLc1: {
    label: 'Latérite ciment GLc1',
    E: 2500,
    nu: 0.25,
    color: '#8a7830',
    nature: 'mtlh',
  },
  GLc2: {
    label: 'Latérite ciment GLc2',
    E: 3000,
    nu: 0.25,
    color: '#807030',
    nature: 'mtlh',
  },
  GNT1: { label: 'GNT1', E: 200, nu: 0.35, color: '#c8b06a', nature: 'granulaire' },
  GNT2: { label: 'GNT2', E: 150, nu: 0.35, color: '#c0a860', nature: 'granulaire' },
  GC3: {
    label: 'Grave Ciment GC-T3',
    E: 23000,
    nu: 0.25,
    color: '#b0b098',
    nature: 'mtlh',
  },
  SC2: {
    label: 'Sable Ciment SC-T2',
    E: 12000,
    nu: 0.25,
    color: '#c0c0a0',
    nature: 'mtlh',
  },
  BQc: {
    label: 'Banco-coquillage (BQc)',
    E: 10000,
    nu: 0.25,
    color: '#c8c0a8',
    nature: 'mtlh',
  },
  BC5: { label: 'Béton BC5', E: 35000, nu: 0.25, color: '#e0e0d0', nature: 'mtlh' },
  BC2: {
    label: 'Béton Maigre BC2',
    E: 20000,
    nu: 0.25,
    color: '#d0d0c8',
    nature: 'mtlh',
  },
};

/** Preset de modules des classes de plateforme support (AGEROUTE 2015). */
const PF_PRESETS: Record<string, { E: number; label: string }> = {
  PF1: { E: 20, label: 'PF1 — 20 MPa' },
  PF2: { E: 50, label: 'PF2 — 50 MPa' },
  PF2qs: { E: 80, label: 'PF2qs — 80 MPa' },
  PF3: { E: 120, label: 'PF3 — 120 MPa' },
  PF4: { E: 200, label: 'PF4 — 200 MPa' },
  custom: { E: 50, label: 'Personnalisé' },
};

/**
 * Catalogue AGEROUTE 2015 (Annexe A) — épaisseurs de structures par famille/NE/PSC.
 * Données issues du document public CC1/0351/AGR (Egis/Ifsttar/Sénélabo).
 * Épaisseurs en cm · T_éq = 34 °C · r = 10 % · f = 20 Hz
 *
 * Format : { [neClass]: { [pfClass]: [h1, h2, ...] en cm } }
 */
type CatEntry = Record<string, Record<string, number[]>>;

interface CatFamily {
  label: string;
  mats: string[]; // clés de MATERIALS (dans l'ordre couche 1→N)
  data: CatEntry;
}

const CAT: Record<string, CatFamily> = {
  S2: {
    label: 'BBSG / GB3',
    mats: ['BBSG1', 'GB3', 'GB3', 'GB3'],
    data: {
      C1: { PF2: [6, 7, 8], PF2qs: [6, 12], PF3: [6, 9], PF4: [6, 8] },
      C2: { PF2: [6, 9, 10], PF2qs: [6, 8, 8], PF3: [6, 14], PF4: [6, 10] },
      C3: { PF2: [6, 12, 12], PF2qs: [6, 10, 10], PF3: [6, 8, 9], PF4: [6, 14] },
      C4: { PF2: [6, 9, 10, 10], PF2qs: [6, 12, 13], PF3: [6, 11, 11], PF4: [6, 8, 9] },
      C5: { PF3: [8, 13, 14], PF4: [8, 11, 12] },
      C6: { PF3: [8, 10, 11, 11], PF4: [8, 9, 10, 10] },
      C7: { PF3: [8, 11, 12, 12], PF4: [8, 10, 10, 11] },
      C8: { PF3: [8, 13, 13, 13], PF4: [8, 11, 12, 12] },
    },
  },
  S1: {
    label: 'BBSG / GB2',
    mats: ['BBSG1', 'GB2', 'GB2', 'GB2'],
    data: {
      C1: { PF1: [6, 11, 11], PF2: [6, 8, 9], PF2qs: [6, 7], PF3: [6, 11], PF4: [6, 8] },
      C2: { PF2: [6, 10, 10], PF2qs: [6, 8, 9], PF3: [6, 14], PF4: [6, 11] },
      C3: { PF2: [6, 12, 13], PF2qs: [6, 11, 11], PF3: [6, 9, 9], PF4: [6, 15] },
      C4: { PF2: [6, 9, 10, 10], PF2qs: [6, 13, 13], PF3: [6, 11, 12], PF4: [6, 9, 10] },
      C5: { PF3: [8, 10, 10, 10], PF4: [8, 13, 13] },
      C6: { PF3: [8, 11, 12, 12], PF4: [8, 10, 10, 11] },
      C7: { PF3: [8, 12, 13, 13], PF4: [8, 11, 11, 12] },
      C8: { PF3: [8, 14, 14, 14], PF4: [8, 12, 13, 13] },
    },
  },
  S13: {
    label: 'BBSG / GNT1',
    mats: ['BBSG1', 'GNT1', 'GNT1'],
    data: {
      C1: { PF2: [6, 30], PF2qs: [6, 20], PF3: [6, 15] },
      C2: { PF2: [6, 25, 25], PF2qs: [6, 15, 20], PF3: [6, 25] },
      C3: { PF2: [6, 25, 30], PF2qs: [6, 20, 25], PF3: [6, 15, 20] },
      C4: { PF2: [6, 20, 20, 25], PF2qs: [6, 25, 30], PF3: [6, 20, 25] },
    },
  },
  S14: {
    label: 'BBSG / GL1',
    mats: ['BBSG1', 'GL1', 'GL1'],
    data: {
      C1: {
        PF1: [6, 15, 25, 25],
        PF2: [6, 15, 25],
        PF2qs: [6, 15, 15],
        PF3: [6, 15, 10],
      },
      C2: { PF2: [6, 20, 20, 20], PF2qs: [6, 20, 25], PF3: [6, 20, 15] },
    },
  },
  S15: {
    label: 'BBSG / GL2+GL1',
    mats: ['BBSG1', 'GL2', 'GL1'],
    data: {
      C1: { PF2: [6, 15, 20], PF2qs: [6, 15, 10] },
      C2: { PF2: [6, 20, 15, 20], PF2qs: [6, 20, 20], PF3: [6, 20, 10] },
      C3: { PF2: [6, 20, 20, 25], PF2qs: [6, 20, 30], PF3: [6, 20, 20] },
      C4: { PF2: [6, 20, 25, 30], PF2qs: [6, 20, 20, 20], PF3: [6, 20, 30] },
    },
  },
  S8: {
    label: 'BBSG / GLc2',
    mats: ['BBSG1', 'GLc2', 'GLc2'],
    data: {
      C1: { PF2qs: [6, 27], PF3: [6, 22], PF4: [6, 18] },
      C2: { PF2qs: [6, 29], PF3: [6, 24], PF4: [6, 20] },
      C3: { PF2qs: [6, 20, 20], PF3: [6, 27], PF4: [6, 25] },
      C4: { PF2: [6, 22, 20], PF2qs: [6, 20, 20], PF3: [6, 29], PF4: [6, 25] },
      C5: { PF2: [8, 27, 24], PF2qs: [8, 24, 21], PF3: [8, 20, 18], PF4: [8, 17, 15] },
      C6: { PF2qs: [10, 23, 22], PF3: [10, 20, 19], PF4: [10, 17, 17] },
    },
  },
  S10: {
    label: 'BBSG / GLc1',
    mats: ['BBSG1', 'GLc1', 'GLc1'],
    data: {
      C1: { PF2: [6, 25, 23], PF2qs: [6, 23, 21], PF3: [6, 20, 18], PF4: [6, 16, 15] },
      C2: { PF2: [6, 27, 25], PF2qs: [6, 24, 22], PF3: [6, 22, 20], PF4: [6, 18, 17] },
      C3: { PF2: [6, 29, 27], PF2qs: [6, 26, 24], PF3: [6, 24, 22], PF4: [6, 19, 19] },
      C4: { PF2: [6, 30, 30], PF2qs: [6, 28, 26], PF3: [6, 25, 24], PF4: [6, 22, 20] },
    },
  },
};

const NE_CLASSES: Array<{ id: string; max: number }> = [
  { id: 'C1', max: 0.1e6 },
  { id: 'C2', max: 0.3e6 },
  { id: 'C3', max: 1e6 },
  { id: 'C4', max: 3e6 },
  { id: 'C5', max: 10e6 },
  { id: 'C6', max: 30e6 },
  { id: 'C7', max: 50e6 },
  { id: 'C8', max: 100e6 },
];
const PF_COLS = ['PF1', 'PF2', 'PF2qs', 'PF3', 'PF4'];

// ---------------------------------------------------------------------------
// Types d'état
// ---------------------------------------------------------------------------

interface Layer {
  id: number;
  mat: string;
  h: number; // épaisseur (m)
  E: number; // module (MPa)
  nu: number; // Poisson
}

interface PF {
  cls: string;
  E: number;
  nu: number;
}

interface Traffic {
  T: number; // TMJA PL/j/sens
  C: number; // CAM
  N: number; // durée (ans)
  tau: number; // taux (%/an)
  dir: number; // f_dir
  tv: number; // f_tv
}

interface Load {
  p: number; // pression (MPa)
  a: number; // rayon (m)
  d: number; // entre-axe (m)
  r: string; // risque : 'auto' | '5' | '10' | '15' | '25'
  sh: string; // dispersion Sh : 'auto' | '1' | '1.5' | '2.5' | '3'
  ks: string; // hétérogénéité ks : 'auto' | valeur numérique
}

type TabId =
  | 'structure'
  | 'trafic'
  | 'parametres'
  | 'catalogue'
  | 'resultats'
  | 'details';

// ---------------------------------------------------------------------------
// Fonctions utilitaires (display uniquement, pas de logique moteur)
// ---------------------------------------------------------------------------

/** Formate un nombre avec séparateurs français. */
function fmtNum(v: number, decimals = 0): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: decimals });
}

/** Formate en notation scientifique compacte (style original). */
function fmtSci(v: number): string {
  if (!v || !isFinite(v)) return '—';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}×10⁸`;
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}×10⁷`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}×10⁶`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}×10⁵`;
  return v.toFixed(0);
}

/**
 * Calcule le NE cumulé (essieux équivalents) — formule publique AGEROUTE 2015 §3.2.
 * Affiché à titre informatif dans la saisie ; recalculé côté serveur.
 */
export function computeNE(traffic: Traffic): number {
  const t = traffic.tau / 100;
  const Ccum = Math.abs(t) < 1e-4 ? traffic.N : (Math.pow(1 + t, traffic.N) - 1) / t;
  return 365 * traffic.T * Ccum * traffic.C * traffic.dir * traffic.tv;
}

/** Classe de NE (AGEROUTE 2015 Tab. 70). */
export function neClass(ne: number): string {
  if (ne < 0.1e6) return 'C1';
  if (ne < 0.3e6) return 'C2';
  if (ne < 1e6) return 'C3';
  if (ne < 3e6) return 'C4';
  if (ne < 10e6) return 'C5';
  if (ne < 30e6) return 'C6';
  if (ne < 50e6) return 'C7';
  if (ne < 100e6) return 'C8';
  return '>C8';
}

/** Classe de TMJA (AGEROUTE 2015). */
function tmjaClass(T: number): string {
  if (T < 25) return 'T5';
  if (T < 50) return 'T4';
  if (T < 150) return 'T3';
  if (T < 300) return 'T2';
  if (T < 750) return 'T1';
  if (T < 2000) return 'T0';
  if (T < 5000) return 'TS';
  return 'TEX';
}

/**
 * Construit le payload envoyé à l'API burmister (étape 2 — pour l'instant stub).
 * Format conforme au contrat InputSchema du moteur (layers[], subgrade, traffic, load).
 * Ne contient aucun coefficient de calcul.
 */
export function buildBurmisterPayload(
  layers: Layer[],
  pf: PF,
  traffic: Traffic,
  load: Load,
): Record<string, unknown> {
  return {
    layers: layers.map((l) => ({ mat: l.mat, E: l.E, nu: l.nu, h: l.h })),
    subgrade: { cls: pf.cls !== 'custom' ? pf.cls : undefined, E: pf.E, nu: pf.nu },
    traffic: {
      T: traffic.T,
      C: traffic.C,
      N: traffic.N,
      tau: traffic.tau,
      dir: traffic.dir,
      tv: traffic.tv,
    },
    load: {
      p: load.p,
      a: load.a,
      d: load.d,
      r: load.r === 'auto' ? 'auto' : Number(load.r),
      sh: load.sh,
      ks: load.ks,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers écran Résultats — EXPORTÉS pour tests DoD §9
// ---------------------------------------------------------------------------

/**
 * Trouve une ligne de résultat par préfixe de label (fail-closed).
 * La comparaison est strictement sur le label, pas sur la valeur.
 */
function findOutputRow(rows: CalcOutputRow[], prefix: string): CalcOutputRow | undefined {
  return rows.find((r) => r.label.startsWith(prefix));
}

/** Extrais d'une valeur de ligne le nombre ou null. */
function rowNumber(row: CalcOutputRow | undefined): number | null {
  if (!row) return null;
  return typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
}

/** KPIs affichables extraits de la sortie normalisée burmister. */
export interface BurmisterKpis {
  hLie_cm: number | null; // H paquet lié en cm
  hTotal_cm: number | null; // H total en cm
  ne: number | null; // NE (essieux éq.)
  familleSanitized: string | null; // famille (libellé NU, déjà whitelisté)
  fatigueValeur: number | null;
  fatigueAdmissible: number | null;
  fatigueOk: 'ok' | 'fail' | null;
  fatigueRigide: boolean; // true = structure rigide (unité MPa), false = µdef
  ornieValeur: number | null;
  ornieAdmissible: number | null;
  ornieOk: 'ok' | 'fail' | null;
}

/**
 * Extrait les KPIs affichables depuis la sortie normalisée burmister.
 *
 * Ne lit QUE des labels connus (fail-closed, DoD §8) : aucun intermédiaire
 * confidentiel (E_pondere, nu_pondere, kc, kr, ks, σ_z brut) ne peut traverser
 * car les rows sont déjà whitelistées par `buildBurmisterRows` + `normalizeOutput`
 * côté adaptateur. Cette fonction ne fait que rechercher dans ces rows par label.
 */
export function extractBurmisterKpis(output: unknown): BurmisterKpis | null {
  if (output == null || typeof output !== 'object') return null;
  const o = output as { verdict?: unknown; rows?: unknown };
  if (!Array.isArray(o.rows)) return null;

  const rows = o.rows as CalcOutputRow[];

  const neRow = findOutputRow(rows, 'Trafic cumulé (NE)');
  const hLieRow = findOutputRow(rows, 'Épaisseur de couches liées');
  const hTotalRow = findOutputRow(rows, 'Épaisseur totale');
  const familleRow = findOutputRow(rows, 'Famille de structure');

  // Fatigue : libellé diffère selon structure souple (ε_t / µdef) ou rigide (σ_t / MPa)
  const fatigueRow =
    findOutputRow(rows, 'Déformation sollicitante ε_t') ??
    findOutputRow(rows, 'Contrainte sollicitante σ_t');
  const fatigueAdmRow =
    findOutputRow(rows, 'Déformation admissible ε_t,adm') ??
    findOutputRow(rows, 'Contrainte admissible σ_t,adm');
  const fatigueRigide = fatigueRow?.label.startsWith('Contrainte') ?? false;

  const ornieRow = findOutputRow(rows, 'Déformation ε_z sollicitante (PSC)');
  const ornieAdmRow = findOutputRow(rows, 'Déformation ε_z admissible');

  const hLieNum = rowNumber(hLieRow);
  const hTotalNum = rowNumber(hTotalRow);

  return {
    hLie_cm: hLieNum !== null ? Math.round(hLieNum * 100 * 10) / 10 : null,
    hTotal_cm: hTotalNum !== null ? Math.round(hTotalNum * 100 * 10) / 10 : null,
    ne: rowNumber(neRow),
    familleSanitized:
      typeof familleRow?.value === 'string' && familleRow.value.length > 0
        ? familleRow.value
        : null,
    fatigueValeur: rowNumber(fatigueRow),
    fatigueAdmissible: rowNumber(fatigueAdmRow),
    fatigueOk: fatigueRow?.status ?? null,
    fatigueRigide,
    ornieValeur: rowNumber(ornieRow),
    ornieAdmissible: rowNumber(ornieAdmRow),
    ornieOk: ornieRow?.status ?? null,
  };
}

/**
 * Construit les messages de diagnostic depuis des flags whitelistés uniquement.
 * Allowlist fail-closed (DoD §8) : seuls `verdict`, `fatigueOk`, `ornieOk`
 * et les valeurs numériques whitelistées par `extractBurmisterKpis` sont utilisés.
 * Aucun texte moteur libre ne traverse.
 */
export function buildBurmisterDiagnostics(output: unknown): string[] {
  const kpis = extractBurmisterKpis(output);
  if (!kpis) return [];
  const o = output as { verdict?: unknown } | null;
  const verdict = o?.verdict;
  const msgs: string[] = [];

  if (
    kpis.fatigueOk === 'fail' &&
    kpis.fatigueValeur !== null &&
    kpis.fatigueAdmissible !== null &&
    kpis.fatigueAdmissible > 0
  ) {
    const ratio = (kpis.fatigueValeur / kpis.fatigueAdmissible).toFixed(2);
    const critere = kpis.fatigueRigide
      ? 'contrainte de traction σ_t'
      : 'déformation de traction ε_t';
    msgs.push(
      `Fatigue bitumineuse non satisfaite : ${critere} sollicitante / admissible = ${ratio} > 1. ` +
        `Recommandation : augmenter l'épaisseur des couches liées. Consulter le catalogue AGEROUTE Sénégal 2015.`,
    );
  }

  if (
    kpis.ornieOk === 'fail' &&
    kpis.ornieValeur !== null &&
    kpis.ornieAdmissible !== null &&
    kpis.ornieAdmissible > 0
  ) {
    const ratio = (kpis.ornieValeur / kpis.ornieAdmissible).toFixed(2);
    msgs.push(
      `Orniérage PSC non satisfaisant : ε_z sollicitante / admissible = ${ratio} > 1. ` +
        `Recommandation : améliorer la qualité du sol support (hausse de classe PFi) ou augmenter l'épaisseur totale.`,
    );
  }

  if (verdict === 'PASS') {
    msgs.push(
      `Structure satisfaisante vis-à-vis des critères AGEROUTE 2015 (fatigue bitumineuse + orniérage PSC). ` +
        `Résultat éligible à l'émission du PV scellé.`,
    );
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// Coupe transversale SVG
// Reproduit fidèlement rSec() de l'outil d'origine (SVG React au lieu d'innerHTML).
// ---------------------------------------------------------------------------

interface CrossSectionProps {
  layers: Layer[];
  pf: PF;
  load: Load;
}

function CrossSection({ layers, pf, load }: CrossSectionProps) {
  const W = 560;
  const PAD = 165;
  const RW = 200;
  const SH = 0.3; // hauteur visuelle sol support (m)
  const AX = PAD + RW / 2;

  const totalH = layers.reduce((s, l) => s + l.h, 0);
  const SC = 200 / (totalH + SH * 0.7);

  // Construire les rects et labels des couches
  let cy = 40;
  const layerRects: React.ReactNode[] = [];
  const layerLabels: React.ReactNode[] = [];

  layers.forEach((l, i) => {
    const mat = MATERIALS[l.mat] ?? { color: '#888', label: l.mat };
    const hPx = l.h * SC;
    const ym = cy + hPx / 2;
    const cumCm = layers.slice(0, i + 1).reduce((s, x) => s + x.h, 0) * 100;

    layerRects.push(
      <rect key={`r-${l.id}`} x={PAD} y={cy} width={RW} height={hPx} fill={mat.color} />,
    );
    layerLabels.push(
      <g key={`l-${l.id}`}>
        <text
          x={PAD - 5}
          y={ym + 3}
          textAnchor="end"
          fontSize={10}
          fill="var(--text-primary)"
          fontWeight={500}
        >
          {mat.label.split(' ').slice(0, 3).join(' ')}
        </text>
        <text
          x={PAD - 5}
          y={ym + 13}
          textAnchor="end"
          fontSize={8.5}
          fill="var(--text-secondary)"
        >
          {`E=${fmtNum(l.E)} MPa · h=${(l.h * 100).toFixed(0)} cm`}
        </text>
        <line
          x1={PAD + RW}
          y1={cy + hPx}
          x2={PAD + RW + 12}
          y2={cy + hPx}
          stroke="var(--border-default)"
          strokeWidth={0.5}
        />
        <text
          x={PAD + RW + 15}
          y={cy + hPx + 4}
          fontSize={9.5}
          fill="var(--text-secondary)"
        >
          {`${cumCm.toFixed(0)} cm`}
        </text>
      </g>,
    );
    cy += hPx;
  });

  const shPx = SH * SC;
  const TH = cy + shPx + 10;

  return (
    <svg
      viewBox={`0 0 ${W} ${TH}`}
      width="100%"
      style={{ display: 'block' }}
      aria-label="Coupe transversale de la structure de chaussée"
      role="img"
    >
      <defs>
        <marker
          id="roadsens-arrow"
          markerWidth={6}
          markerHeight={6}
          refX={3}
          refY={3}
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="#1a4a7a" />
        </marker>
      </defs>

      {/* Charge en surface — roues jumelées */}
      <ellipse cx={AX - 19} cy={15} rx={12} ry={6} fill="#1a4a7a" opacity={0.8} />
      <ellipse cx={AX + 19} cy={15} rx={12} ry={6} fill="#1a4a7a" opacity={0.8} />
      <line
        x1={AX - 19}
        y1={22}
        x2={AX - 19}
        y2={33}
        stroke="#1a4a7a"
        strokeWidth={1.5}
        markerEnd="url(#roadsens-arrow)"
      />
      <line
        x1={AX + 19}
        y1={22}
        x2={AX + 19}
        y2={33}
        stroke="#1a4a7a"
        strokeWidth={1.5}
        markerEnd="url(#roadsens-arrow)"
      />
      <text x={AX} y={9} textAnchor="middle" fontSize={9} fill="#1a4a7a" fontWeight={500}>
        {`130 kN · p=${load.p} MPa · d=${load.d}m`}
      </text>

      {/* Bordure globale des couches + sol support */}
      <rect
        x={PAD}
        y={32}
        width={RW}
        height={cy - 32 + shPx}
        fill="none"
        stroke="var(--border-default)"
        strokeWidth={0.5}
      />

      {/* Couches */}
      {layerRects}
      {layerLabels}

      {/* Lignes latérales */}
      <line
        x1={PAD}
        y1={32}
        x2={PAD}
        y2={cy + shPx}
        stroke="var(--border-default)"
        strokeWidth={0.5}
      />
      <line
        x1={PAD + RW}
        y1={32}
        x2={PAD + RW}
        y2={cy + shPx}
        stroke="var(--border-default)"
        strokeWidth={0.5}
      />

      {/* Sol support */}
      <rect x={PAD} y={cy} width={RW} height={shPx} fill="#9b8060" opacity={0.85} />
      <text
        x={PAD - 5}
        y={cy + shPx / 2 + 3}
        textAnchor="end"
        fontSize={10}
        fill="var(--text-primary)"
        fontWeight={500}
      >
        {`${pf.cls} — Sol support`}
      </text>
      <text
        x={PAD - 5}
        y={cy + shPx / 2 + 13}
        textAnchor="end"
        fontSize={8.5}
        fill="var(--text-secondary)"
      >
        {`E=${pf.E} MPa · ν=${pf.nu}`}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Composant principal — page ROADSENS
// ---------------------------------------------------------------------------

let _nextLayerId = 4;

const DEFAULT_LAYERS: Layer[] = [
  { id: 1, mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
  { id: 2, mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
  { id: 3, mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
];
const DEFAULT_PF: PF = { cls: 'PF2', E: 50, nu: 0.35 };
// Trafic a 0 par defaut (revue adverse) : force la saisie du trafic projet avant tout
// resultat/PV. La structure (DEFAULT_LAYERS) reste un gabarit de conception a modifier.
const DEFAULT_TRAFFIC: Traffic = { T: 0, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
const DEFAULT_LOAD: Load = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'structure', label: 'Structure' },
  { id: 'trafic', label: 'Trafic' },
  { id: 'parametres', label: 'Paramètres' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'resultats', label: 'Résultats' },
  { id: 'details', label: 'Détails calcul' },
];

/** Styles de badge matériau (nature). */
const NATURE_STYLE: Record<LayerNature, { bg: string; color: string; label: string }> = {
  bitumineux: { bg: '#e6eaef', color: '#33414f', label: 'Bitumineux' },
  granulaire: { bg: '#fbf1e8', color: '#8a4a18', label: 'Granulaire' },
  mtlh: { bg: '#f7edd9', color: '#7a5200', label: 'MTLH' },
};

export default function RoadsensPage() {
  // ── Route & tenant ──────────────────────────────────────────────────────
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';
  const orgId = useOrgId(orgSlug);

  // ── Onglets + saisie ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('structure');
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);
  const [pf, setPf] = useState<PF>(DEFAULT_PF);
  const [traffic, setTraffic] = useState<Traffic>(DEFAULT_TRAFFIC);
  const [load, setLoad] = useState<Load>(DEFAULT_LOAD);

  // ── Projets ─────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [, setProjectsLoading] = useState(false);

  // ── Entitlements ─────────────────────────────────────────────────────────
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);

  // ── Calcul ──────────────────────────────────────────────────────────────
  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  // ── PV ──────────────────────────────────────────────────────────────────
  const [emittingPv, setEmittingPv] = useState(false);
  const [pvResult, setPvResult] = useState<OfficialPv | null>(null);

  // Guard SSR : évite les divergences d'hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Chargement des projets CH + entitlements quand orgId résolu.
  useEffect(() => {
    if (!orgId) return;
    setProjectsLoading(true);
    Promise.all([listProjects(orgId), getEntitlements(orgId)])
      .then(([projs, ent]) => {
        const chProjects = projs.filter((p) => p.domain === 'CH');
        setProjects(chProjects);
        setEntitlements(ent);
        if (chProjects.length === 1) setProjectId(chProjects[0].id);
      })
      .catch(() => {
        /* silencieux — l'utilisateur verra que le sélecteur est vide */
      })
      .finally(() => setProjectsLoading(false));
  }, [orgId]);

  // --------------------------------------------------------------------------
  // Gestion des couches
  // --------------------------------------------------------------------------

  const addLayer = useCallback(() => {
    setLayers((prev) => [
      ...prev,
      { id: _nextLayerId++, mat: 'GL1', h: 0.2, E: 200, nu: 0.35 },
    ]);
  }, []);

  const removeLayer = useCallback((id: number) => {
    setLayers((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }, []);

  const moveLayer = useCallback((id: number, dir: -1 | 1) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  const updateLayer = useCallback(
    (id: number, field: keyof Layer, value: string | number) => {
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          if (field === 'mat' && typeof value === 'string') {
            const mat = MATERIALS[value];
            return mat
              ? { ...l, mat: value, E: mat.E, nu: mat.nu }
              : { ...l, mat: value };
          }
          return { ...l, [field]: value };
        }),
      );
    },
    [],
  );

  // --------------------------------------------------------------------------
  // Bouton Calculer — branchement API réel
  // --------------------------------------------------------------------------

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;

    setCalculating(true);
    setCalcError(null);
    setPvResult(null);

    const payload = buildBurmisterPayload(layers, pf, traffic, load);
    const ne = computeNE(traffic);
    const label = `ROADSENS — ${neClass(ne)} — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;

    try {
      const result = await runCalc(orgId, projectId, {
        engineId: 'burmister',
        label,
        params: payload as Record<string, unknown>,
      });
      setCalcResult(result);
      setActiveTab('resultats');
    } catch (err: unknown) {
      const apiErr = err as { reason?: string; message?: string };
      const msg =
        apiErr?.reason === 'EXPIRED'
          ? 'Abonnement expiré — calcul impossible.'
          : apiErr?.reason === 'QUOTA'
            ? 'Quota de calculs épuisé.'
            : apiErr?.reason === 'MODULE_NOT_IN_PACK'
              ? "Le moteur ROADSENS (burmister) n'est pas inclus dans votre abonnement."
              : (apiErr?.message ?? 'Erreur lors du calcul. Réessayez.');
      setCalcError(msg);
    } finally {
      setCalculating(false);
    }
  }, [orgId, projectId, layers, pf, traffic, load]);

  // --------------------------------------------------------------------------
  // Bouton Imprimer / Émettre PV
  // --------------------------------------------------------------------------

  const handleEmitPv = useCallback(async () => {
    if (!calcResult || !orgId || !projectId) return;
    setEmittingPv(true);
    setCalcError(null);
    try {
      const pv = await emitPv(orgId, projectId, { calcResultId: calcResult.id });
      setPvResult(pv);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setCalcError(apiErr?.message ?? "Erreur lors de l'émission du PV.");
    } finally {
      setEmittingPv(false);
    }
  }, [calcResult, orgId, projectId]);

  if (!mounted) {
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de ROADSENS" />
    );
  }

  // --------------------------------------------------------------------------
  // Rendu
  // --------------------------------------------------------------------------

  return (
    <div
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '24px 20px 56px',
        fontFamily: 'inherit',
      }}
    >
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* EN-TÊTE ROADSENS                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 15,
          flexWrap: 'wrap',
          marginBottom: 18,
          padding: '15px 19px',
          background:
            'linear-gradient(118deg, var(--surface-base), var(--surface-base) 52%, #edf3f9)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 18,
          boxShadow: 'var(--elevation-card)',
        }}
      >
        {/* Logo stratum */}
        <div
          aria-hidden="true"
          style={{
            width: 46,
            height: 46,
            flexShrink: 0,
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(155deg, #5b86b3, #1a4a7a 46%, #143a61)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,.2), 0 7px 16px -7px rgba(26,74,122,.65)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Strates évoquant les couches de chaussée */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(0deg, transparent 0 9px, rgba(255,255,255,.07) 9px 10px)',
              pointerEvents: 'none',
            }}
          />
          <svg
            width={21}
            height={21}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'relative', zIndex: 1 }}
          >
            {/* Road / layers icon */}
            <path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <polyline points="11 1 11 7 17 7" />
          </svg>
        </div>

        {/* Nom + badges + sous-titre */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display, inherit)',
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
              }}
            >
              ROADSENS
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: '#1a4a7a',
                background: '#edf3f9',
                border: '1px solid rgba(26,74,122,.22)',
                padding: '3px 10px',
                borderRadius: 999,
              }}
            >
              Burmister exact · Transfer Matrix
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
            Solution exacte multi-couche · AGEROUTE Sénégal 2015 · T_éq = 34 °C · Dual
            wheels · Aucun Odemark
          </div>
        </div>

        {/* Sélecteur de projet CH */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 190 }}>
          <label
            htmlFor="roadsens-projet"
            style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)' }}
          >
            Projet
          </label>
          <ProjectPicker
            orgId={orgId}
            domain="CH"
            projects={projects}
            setProjects={setProjects}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              setCalcResult(null);
              setPvResult(null);
            }}
            accent="#1a4a7a"
            width={190}
          />
        </div>

        {/* Bouton Calculer */}
        <button
          onClick={() => void handleCalculer()}
          disabled={calculating || !projectId || !orgId}
          aria-busy={calculating}
          aria-disabled={!projectId || !orgId}
          title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background:
              calculating || !projectId || !orgId
                ? '#143a61'
                : 'linear-gradient(135deg, #1a4a7a, #143a61)',
            color: '#fff',
            border: 'none',
            padding: '11px 22px',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            borderRadius: 12,
            cursor: calculating || !projectId || !orgId ? 'not-allowed' : 'pointer',
            boxShadow:
              calculating || !projectId || !orgId
                ? 'none'
                : '0 7px 17px -7px rgba(26,74,122,.7)',
            opacity: calculating || !projectId || !orgId ? 0.55 : 1,
            transition: 'opacity .15s, box-shadow .15s',
            flexShrink: 0,
          }}
        >
          {calculating ? (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(255,255,255,.35)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'roadsens-spin .7s linear infinite',
                  display: 'inline-block',
                  verticalAlign: -2,
                }}
              />
              Calcul…
            </>
          ) : (
            <>
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="8" y1="6" x2="16" y2="6" />
                <line x1="8" y1="10" x2="16" y2="10" />
                <line x1="8" y1="14" x2="12" y2="14" />
              </svg>
              Calculer
            </>
          )}
        </button>
      </div>

      {/* Bandeau erreur calcul */}
      {calcError && (
        <div
          role="alert"
          style={{
            margin: '0 0 14px',
            padding: '10px 15px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderLeft: '3px solid #dc2626',
            borderRadius: 10,
            fontSize: 12.5,
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width={15}
            height={15}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {calcError}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* NAVIGATION PAR ONGLETS                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div
        role="tablist"
        aria-label="Sections ROADSENS"
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          background: 'var(--surface-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          padding: 5,
          marginBottom: 18,
          boxShadow: 'var(--elevation-card)',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`roadsens-panel-${tab.id}`}
              id={`roadsens-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
                padding: '9px 14px',
                fontSize: 12.5,
                fontWeight: 500,
                lineHeight: 1,
                border: 'none',
                background: isActive ? '#1a4a7a' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'background .15s, color .15s',
                boxShadow: isActive ? '0 3px 9px -3px rgba(26,74,122,.6)' : 'none',
              }}
              onMouseOver={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background =
                    'var(--surface-canvas)';
              }}
              onMouseOut={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PANNEAUX                                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div
        id={`roadsens-panel-structure`}
        role="tabpanel"
        aria-labelledby="roadsens-tab-structure"
        hidden={activeTab !== 'structure'}
        style={activeTab === 'structure' ? panelStyle : undefined}
      >
        <TabStructure
          layers={layers}
          pf={pf}
          load={load}
          onAddLayer={addLayer}
          onRemoveLayer={removeLayer}
          onMoveLayer={moveLayer}
          onUpdateLayer={updateLayer}
          onUpdatePf={setPf}
        />
      </div>

      <div
        id="roadsens-panel-trafic"
        role="tabpanel"
        aria-labelledby="roadsens-tab-trafic"
        hidden={activeTab !== 'trafic'}
        style={activeTab === 'trafic' ? panelStyle : undefined}
      >
        <TabTrafic traffic={traffic} onUpdate={setTraffic} />
      </div>

      <div
        id="roadsens-panel-parametres"
        role="tabpanel"
        aria-labelledby="roadsens-tab-parametres"
        hidden={activeTab !== 'parametres'}
        style={activeTab === 'parametres' ? panelStyle : undefined}
      >
        <TabParametres load={load} onUpdate={setLoad} />
      </div>

      <div
        id="roadsens-panel-catalogue"
        role="tabpanel"
        aria-labelledby="roadsens-tab-catalogue"
        hidden={activeTab !== 'catalogue'}
        style={activeTab === 'catalogue' ? panelStyle : undefined}
      >
        <TabCatalogue pfCls={pf.cls} />
      </div>

      <div
        id="roadsens-panel-resultats"
        role="tabpanel"
        aria-labelledby="roadsens-tab-resultats"
        hidden={activeTab !== 'resultats'}
        style={activeTab === 'resultats' ? panelStyle : undefined}
      >
        <TabResultats
          result={calcResult}
          ne={computeNE(traffic)}
          onEmitPv={() => void handleEmitPv()}
          emittingPv={emittingPv}
          pvResult={pvResult}
          entitlements={entitlements}
        />
      </div>

      <div
        id="roadsens-panel-details"
        role="tabpanel"
        aria-labelledby="roadsens-tab-details"
        hidden={activeTab !== 'details'}
        style={activeTab === 'details' ? panelStyle : undefined}
      >
        <TabDetails result={calcResult} />
      </div>

      <style>{`
        @keyframes roadsens-spin { to { transform: rotate(360deg); } }
        @keyframes roadsens-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .roadsens-pane { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style commun des panneaux
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  display: 'block',
  animation: 'roadsens-rise .26s ease',
  background: 'var(--surface-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 18,
  padding: '22px 24px',
  boxShadow: 'var(--elevation-card)',
};

// ---------------------------------------------------------------------------
// Composants de section
// ---------------------------------------------------------------------------

/** Titre de section avec trait bleu vertical (style original). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display, inherit)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: 'var(--text-primary)',
        margin: '24px 0 13px',
        paddingLeft: 12,
        position: 'relative',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 3,
          height: 13,
          borderRadius: 2,
          background: '#1a4a7a',
        }}
      />
      {children}
    </div>
  );
}

/** Encadré note informatif (style original). */
function Note({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: 'brand' | 'green' | 'orange';
}) {
  const borderColor =
    variant === 'green' ? '#2f7d32' : variant === 'orange' ? '#bd6a30' : '#1a4a7a';
  const bg =
    variant === 'green'
      ? '#e8f3e2'
      : variant === 'orange'
        ? '#fbf1e8'
        : 'var(--surface-canvas)';
  return (
    <div
      style={{
        fontSize: 11.5,
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        background: bg,
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 10,
        padding: '11px 14px',
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
}

/** Champ de formulaire labelisé. */
function FieldWrap({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label
        htmlFor={id}
        style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}
      >
        {label}
      </label>
      {/* On clone le child pour lui injecter l'id si c'est un input/select natif */}
      {children}
      {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 9px',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  background: 'var(--surface-base)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

/** Placeholder pour les onglets non encore implémentés. */
function PlaceholderPane({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  void icon; // utilisé symboliquement
  return (
    <div
      style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}
    >
      <svg
        width={48}
        height={48}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block', margin: '0 auto 0.75rem', opacity: 0.2 }}
        aria-hidden="true"
      >
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="12" y2="14" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: '0.3rem' }}>{description}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Structure
// ---------------------------------------------------------------------------

interface TabStructureProps {
  layers: Layer[];
  pf: PF;
  load: Load;
  onAddLayer: () => void;
  onRemoveLayer: (id: number) => void;
  onMoveLayer: (id: number, dir: -1 | 1) => void;
  onUpdateLayer: (id: number, field: keyof Layer, value: string | number) => void;
  onUpdatePf: (pf: PF) => void;
}

function TabStructure({
  layers,
  pf,
  load,
  onAddLayer,
  onRemoveLayer,
  onMoveLayer,
  onUpdateLayer,
  onUpdatePf,
}: TabStructureProps) {
  const matOptions = Object.entries(MATERIALS);

  return (
    <div>
      {/* ── Table couches ── */}
      <SectionTitle>Couches — surface vers fond</SectionTitle>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 12.5,
            background: 'var(--surface-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
          aria-label="Couches de chaussée"
        >
          <thead>
            <tr>
              {['#', 'Matériau', 'h (m)', 'E (MPa)', 'ν', 'Nature', ''].map((th) => (
                <th
                  key={th}
                  style={{
                    textAlign: 'left',
                    padding: '9px 11px',
                    background: 'var(--surface-canvas)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-subtle)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {th}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layers.map((l, i) => {
              const mat = MATERIALS[l.mat];
              const nature = mat?.nature ?? 'granulaire';
              const ns = NATURE_STYLE[nature];
              return (
                <tr
                  key={l.id}
                  style={{
                    borderBottom:
                      i < layers.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  {/* # */}
                  <td
                    style={{
                      padding: '8px 11px',
                      color: 'var(--text-secondary)',
                      fontSize: 10.5,
                      width: 28,
                    }}
                  >
                    {i + 1}
                  </td>

                  {/* Matériau */}
                  <td style={{ padding: '8px 6px', minWidth: 190 }}>
                    <select
                      value={l.mat}
                      onChange={(e) => onUpdateLayer(l.id, 'mat', e.target.value)}
                      aria-label={`Matériau couche ${i + 1}`}
                      style={{ ...inputStyle, maxWidth: '100%' }}
                    >
                      {matOptions.map(([key, m]) => (
                        <option key={key} value={key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* h */}
                  <td style={{ padding: '8px 6px', width: 80 }}>
                    <input
                      type="number"
                      value={l.h}
                      min={0.01}
                      max={1.5}
                      step={0.01}
                      aria-label={`Épaisseur couche ${i + 1} (m)`}
                      onChange={(e) =>
                        onUpdateLayer(l.id, 'h', parseFloat(e.target.value) || l.h)
                      }
                      style={{ ...inputStyle, width: 72, textAlign: 'right' }}
                    />
                  </td>

                  {/* E */}
                  <td style={{ padding: '8px 6px', width: 90 }}>
                    <input
                      type="number"
                      value={l.E}
                      min={10}
                      max={50000}
                      step={100}
                      aria-label={`Module E couche ${i + 1} (MPa)`}
                      onChange={(e) =>
                        onUpdateLayer(l.id, 'E', parseFloat(e.target.value) || l.E)
                      }
                      style={{ ...inputStyle, width: 72, textAlign: 'right' }}
                    />
                  </td>

                  {/* ν */}
                  <td style={{ padding: '8px 6px', width: 70 }}>
                    <input
                      type="number"
                      value={l.nu}
                      min={0.1}
                      max={0.5}
                      step={0.05}
                      aria-label={`Poisson couche ${i + 1}`}
                      onChange={(e) =>
                        onUpdateLayer(l.id, 'nu', parseFloat(e.target.value) || l.nu)
                      }
                      style={{ ...inputStyle, width: 60, textAlign: 'right' }}
                    />
                  </td>

                  {/* Nature */}
                  <td style={{ padding: '8px 11px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        background: ns.bg,
                        color: ns.color,
                      }}
                    >
                      {ns.label}
                    </span>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => onMoveLayer(l.id, -1)}
                        aria-label={`Monter couche ${i + 1}`}
                        style={actionBtnStyle}
                      >
                        ↑
                      </button>
                    )}{' '}
                    {i < layers.length - 1 && (
                      <button
                        type="button"
                        onClick={() => onMoveLayer(l.id, 1)}
                        aria-label={`Descendre couche ${i + 1}`}
                        style={actionBtnStyle}
                      >
                        ↓
                      </button>
                    )}{' '}
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(l.id)}
                      disabled={layers.length <= 1}
                      aria-label={`Supprimer couche ${i + 1}`}
                      style={{
                        ...actionBtnStyle,
                        color: layers.length <= 1 ? 'var(--text-muted)' : '#b5392f',
                        borderColor:
                          layers.length <= 1
                            ? 'var(--border-subtle)'
                            : 'rgba(181,57,47,.3)',
                        background: 'transparent',
                        cursor: layers.length <= 1 ? 'not-allowed' : 'pointer',
                        opacity: layers.length <= 1 ? 0.45 : 1,
                        fontSize: 10.5,
                      }}
                    >
                      ✕ Suppr.
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onAddLayer}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 13px',
            borderRadius: 9,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: '#1a4a7a',
            background: '#edf3f9',
            border: '1px solid rgba(26,74,122,.22)',
            fontFamily: 'inherit',
          }}
        >
          + Ajouter couche
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Couche de roulement en position 1
        </span>
      </div>

      {/* ── Plateforme support ── */}
      <SectionTitle>Plateforme support de chaussée (PSC)</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          maxWidth: 530,
        }}
      >
        <FieldWrap label="Classe PFi">
          <select
            value={pf.cls}
            aria-label="Classe de plateforme support"
            onChange={(e) => {
              const cls = e.target.value;
              const preset = PF_PRESETS[cls];
              onUpdatePf({
                ...pf,
                cls,
                ...(preset && cls !== 'custom' ? { E: preset.E } : {}),
              });
            }}
            style={inputStyle}
          >
            {Object.entries(PF_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </FieldWrap>

        <FieldWrap label="E_PSC (MPa)">
          <input
            type="number"
            value={pf.E}
            min={10}
            max={500}
            step={5}
            aria-label="Module PSC (MPa)"
            onChange={(e) =>
              onUpdatePf({ ...pf, E: parseFloat(e.target.value) || pf.E, cls: 'custom' })
            }
            style={inputStyle}
          />
        </FieldWrap>

        <FieldWrap label="ν_PSC">
          <input
            type="number"
            value={pf.nu}
            min={0.1}
            max={0.5}
            step={0.05}
            aria-label="Poisson PSC"
            onChange={(e) =>
              onUpdatePf({ ...pf, nu: parseFloat(e.target.value) || pf.nu })
            }
            style={inputStyle}
          />
        </FieldWrap>
      </div>

      {/* ── Coupe transversale ── */}
      <SectionTitle>Coupe transversale</SectionTitle>
      <div
        style={{
          borderRadius: 10,
          border: '0.5px solid var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        <CrossSection layers={layers} pf={pf} load={load} />
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2px 7px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  background: 'var(--surface-base)',
  border: '1px solid var(--border-default)',
  borderRadius: 7,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Onglet Trafic
// ---------------------------------------------------------------------------

const CAM_GUIDES = [
  { value: '0.5', label: '0,50 — Voirie urbaine légère · PL peu chargés (< 0,5)' },
  { value: '0.9', label: '0,90 — Chaussée souple / bitumineuse · et sol support' },
  { value: '1.3', label: '1,30 — Chaussée en latérite traitée' },
  { value: '1.4', label: '1,40 — Chaussée semi-rigide' },
  {
    value: '3',
    label: '3,00 — Voirie lourde industrielle / portuaire · PL surchargés (> 3)',
  },
];

function TabTrafic({
  traffic,
  onUpdate,
}: {
  traffic: Traffic;
  onUpdate: (t: Traffic) => void;
}) {
  const ne = computeNE(traffic);
  const t = traffic.tau / 100;
  const Ccum = Math.abs(t) < 1e-4 ? traffic.N : (Math.pow(1 + t, traffic.N) - 1) / t;

  return (
    <div>
      <SectionTitle>Données de trafic — AGEROUTE 2015</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <FieldWrap label="TMJA (PL/j/sens)">
          <input
            type="number"
            value={traffic.T}
            min={5}
            max={10000}
            step={10}
            aria-label="TMJA poids lourds par jour et par sens"
            onChange={(e) =>
              onUpdate({ ...traffic, T: parseFloat(e.target.value) || traffic.T })
            }
            style={inputStyle}
          />
        </FieldWrap>

        <FieldWrap label="CAM — agressivité moyenne">
          <select
            value=""
            aria-label="Valeur guide du CAM"
            onChange={(e) => {
              if (e.target.value) onUpdate({ ...traffic, C: parseFloat(e.target.value) });
            }}
            style={{ ...inputStyle, fontSize: 11.5 }}
          >
            <option value="">Valeur-guide du catalogue…</option>
            {CAM_GUIDES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={traffic.C}
            min={0.1}
            max={15}
            step={0.05}
            aria-label="CAM coefficient d'agressivité moyen"
            onChange={(e) =>
              onUpdate({ ...traffic, C: parseFloat(e.target.value) || traffic.C })
            }
            style={{ ...inputStyle, marginTop: 4 }}
          />
        </FieldWrap>

        <FieldWrap label="Durée n (ans)">
          <input
            type="number"
            value={traffic.N}
            min={10}
            max={30}
            step={5}
            aria-label="Durée de service (ans)"
            onChange={(e) =>
              onUpdate({ ...traffic, N: parseFloat(e.target.value) || traffic.N })
            }
            style={inputStyle}
          />
        </FieldWrap>

        <FieldWrap label="Taux τ (%/an)">
          <input
            type="number"
            value={traffic.tau}
            min={0}
            max={10}
            step={0.5}
            aria-label="Taux de croissance annuel (%)"
            onChange={(e) =>
              onUpdate({ ...traffic, tau: parseFloat(e.target.value) || 0 })
            }
            style={inputStyle}
          />
        </FieldWrap>

        <FieldWrap label="f_dir">
          <input
            type="number"
            value={traffic.dir}
            min={0.5}
            max={1.0}
            step={0.05}
            aria-label="Coefficient directionnel"
            onChange={(e) =>
              onUpdate({ ...traffic, dir: parseFloat(e.target.value) || traffic.dir })
            }
            style={inputStyle}
          />
        </FieldWrap>

        <FieldWrap label="f_tv">
          <input
            type="number"
            value={traffic.tv}
            min={0.5}
            max={1.0}
            step={0.05}
            aria-label="Coefficient de répartition transversale"
            onChange={(e) =>
              onUpdate({ ...traffic, tv: parseFloat(e.target.value) || traffic.tv })
            }
            style={inputStyle}
          />
        </FieldWrap>
      </div>

      <Note>
        Valeurs-guides issues du catalogue AGEROUTE Sénégal 2015 (Annexe F, par type de
        structure). Si une campagne de pesage est disponible, calculez le CAM réel et
        saisissez-le directement.
      </Note>

      {/* Résumé trafic — ESTIMATION à la saisie (aperçu). La valeur qui fait foi est le
          NE recalculé SERVEUR, affiché dans les résultats après « Calculer » (revue adverse :
          ne pas juxtaposer deux NE calculés indépendamment comme s'ils étaient équivalents). */}
      <SectionTitle>Résumé — estimation à la saisie</SectionTitle>
      <Note>Estimation indicative à partir du trafic saisi (formule AGEROUTE publique). Le NE qui fait foi est celui recalculé côté serveur, dans les résultats.</Note>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'NE (estim.)', value: fmtSci(ne), sub: `Classe ${neClass(ne)}` },
          {
            label: 'NPL cumulé',
            value: fmtSci(365 * traffic.T * Ccum * traffic.dir * traffic.tv),
            sub: `${traffic.N} ans`,
          },
          { label: 'Ti (TMJA)', value: tmjaClass(traffic.T), sub: `${traffic.T} PL/j/s` },
          { label: 'C (cumul)', value: Ccum.toFixed(2), sub: `τ=${traffic.tau}%/an` },
        ].map((m) => (
          <div
            key={m.label}
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: 'var(--surface-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '13px 15px',
              boxShadow: 'var(--elevation-card)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: 11,
                bottom: 11,
                width: 3,
                borderRadius: 2,
                background: '#1a4a7a',
                opacity: 0.85,
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}
            >
              {m.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginTop: 4,
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {m.value}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 3 }}>
              {m.sub}
            </div>
          </div>
        ))}
      </div>
      <Note>
        NE = 365 × TMJA × C × CAM × f_dir × f_tv &nbsp;·&nbsp; C = [(1+τ)ⁿ − 1] / τ
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Paramètres
// ---------------------------------------------------------------------------

function TabParametres({ load, onUpdate }: { load: Load; onUpdate: (l: Load) => void }) {
  return (
    <div>
      <SectionTitle>Charge de référence AGEROUTE — essieu 130 kN</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          maxWidth: 530,
        }}
      >
        <FieldWrap label="Pression p₀ (MPa)">
          <input
            type="number"
            value={load.p}
            min={0.3}
            max={1.0}
            step={0.01}
            aria-label="Pression de contact (MPa)"
            onChange={(e) =>
              onUpdate({ ...load, p: parseFloat(e.target.value) || load.p })
            }
            style={inputStyle}
          />
        </FieldWrap>
        <FieldWrap label="Rayon a (m)">
          <input
            type="number"
            value={load.a}
            min={0.05}
            max={0.3}
            step={0.005}
            aria-label="Rayon de la surface chargée (m)"
            onChange={(e) =>
              onUpdate({ ...load, a: parseFloat(e.target.value) || load.a })
            }
            style={inputStyle}
          />
        </FieldWrap>
        <FieldWrap label="Entre-axe d (m)">
          <input
            type="number"
            value={load.d}
            min={0.2}
            max={0.6}
            step={0.01}
            aria-label="Entre-axe du jumelage (m)"
            onChange={(e) =>
              onUpdate({ ...load, d: parseFloat(e.target.value) || load.d })
            }
            style={inputStyle}
          />
        </FieldWrap>
      </div>
      <Note>
        Dual wheel : ε_t calculée en r=0 (sous roue) ET r=d/2 (entre roues par
        superposition ×2) — valeur max retenue
      </Note>

      <SectionTitle>Risque</SectionTitle>
      <div style={{ maxWidth: 280 }}>
        <FieldWrap label="Risque r (%)">
          <select
            value={load.r}
            aria-label="Niveau de risque"
            onChange={(e) => onUpdate({ ...load, r: e.target.value })}
            style={inputStyle}
          >
            <option value="auto">Auto — Tab. 70 (25 % si NE &lt; 3M, 5 % au-delà)</option>
            <option value="5">r = 5 %</option>
            <option value="10">r = 10 %</option>
            <option value="15">r = 15 %</option>
            <option value="25">r = 25 %</option>
          </select>
        </FieldWrap>
      </div>

      <SectionTitle>Coefficients LCPC — ε_t admissible</SectionTitle>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', maxWidth: 320 }}>
          <FieldWrap label="Sh — dispersion d'épaisseur">
            <select
              value={load.sh}
              aria-label="Dispersion d'épaisseur Sh"
              onChange={(e) => onUpdate({ ...load, sh: e.target.value })}
              style={inputStyle}
            >
              <option value="auto">Auto — Tab. VI.2.4 (guide)</option>
              <option value="1">1 cm</option>
              <option value="1.5">1,5 cm</option>
              <option value="2.5">2,5 cm</option>
              <option value="3">3 cm (défaut Alizé)</option>
            </select>
          </FieldWrap>
        </div>
        <div style={{ flex: '1 1 280px', maxWidth: 320 }}>
          <FieldWrap label="ks — hétérogénéité du support">
            <select
              value={load.ks}
              aria-label="Coefficient ks d'hétérogénéité du support"
              onChange={(e) => onUpdate({ ...load, ks: e.target.value })}
              style={inputStyle}
            >
              <option value="auto">Auto — Tab. VI.4.3 (couche sous-jacente)</option>
              <option value="1">1 (E ≥ 120 MPa)</option>
              <option value="0.9090909">1/1,1 (50 ≤ E &lt; 80)</option>
              <option value="0.9389671">1/1,065 (80 ≤ E &lt; 120)</option>
              <option value="0.8333333">1/1,2 (E &lt; 50)</option>
            </select>
          </FieldWrap>
        </div>
      </div>

      <SectionTitle>Lois de fatigue — matériaux bitumineux</SectionTitle>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: '0.4rem',
        }}
      >
        ε_t_adm = ε₆ · kθ · (NE/10⁶)<sup>b</sup> · kr · kc · ks — LCPC 1994 (VI.4.2)
        &nbsp;·&nbsp; kθ = √(E(10°C)/E(θ_éq=34°C))
      </div>
      <Note>
        Les coefficients de fatigue (ε₆, b, kc, Sh) sont appliqués côté serveur uniquement
        et ne sont pas exposés ici. Le résultat de vérification (ε_t/ε_t,adm) sera affiché
        dans l&apos;onglet Résultats après calcul.
      </Note>

      <SectionTitle>Moteur ROADSENS — Burmister multi-couche exact</SectionTitle>
      <Note variant="green">
        <strong>
          Méthode de la matrice de transfert (Transfer Matrix / Propagateur) — Burmister
          (1945) généralisé à n couches :
        </strong>
        <br />· <strong>Éq. 6a (σ_z)</strong>, <strong>Éq. 6b (τ_rz)</strong>,{' '}
        <strong>Éq. 6c (σ_r)</strong>, <strong>Éq. 6d (w)</strong>,{' '}
        <strong>Éq. 6e (u)</strong> : fonctions de base de chaque couche
        <br />· <strong>Propagateur 4×4</strong> : M_top × M_bot⁻¹ par couche —
        propagation bottom-up PSC → surface
        <br />· <strong>CL surface</strong> : σ_z = −m·J₀(mr), τ_rz = 0 — résolution 2×2
        pour [B_s, D_s]
        <br />· <strong>Aucun Odemark</strong> · Intégration Hankel 400 pts · Dual wheels
        · σ_z et σ_r exactes à chaque interface
      </Note>

      <SectionTitle>Orniérage PSC</SectionTitle>
      <Note>
        ε_z_adm = 0,012 × NE<sup>−1/4,5</sup> (NE &gt; 250 000) · 0,016 × NE
        <sup>−1/4,5</sup> (NE ≤ 250 000) — catalogue p.124
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Catalogue AGEROUTE 2015
// ---------------------------------------------------------------------------

function TabCatalogue({ pfCls }: { pfCls: string }) {
  const [selectedFamily, setSelectedFamily] = useState<string>('S2');
  const [neInput, setNeInput] = useState<string>('');

  const family = CAT[selectedFamily];
  const neVal = neInput ? parseFloat(neInput) * 1e6 : null;

  if (!family) return null;

  return (
    <div>
      <SectionTitle>Catalogue AGEROUTE Sénégal 2015</SectionTitle>
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          maxWidth: 520,
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label
            style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}
          >
            Famille
          </label>
          <select
            value={selectedFamily}
            aria-label="Famille de structure"
            onChange={(e) => setSelectedFamily(e.target.value)}
            style={inputStyle}
          >
            {Object.entries(CAT).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label
            style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}
          >
            NE (×10⁶)
          </label>
          <input
            type="number"
            value={neInput}
            placeholder="ex: 2.5"
            step={0.1}
            min={0.05}
            max={100}
            aria-label="NE en millions"
            onChange={(e) => setNeInput(e.target.value)}
            style={{ ...inputStyle, padding: '5px 8px', fontSize: 12.5 }}
          />
        </div>
      </div>

      {/* Légende matériaux */}
      <div
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '0.65rem' }}
      >
        {family.mats.map((mk, i) => {
          const col = MATERIALS[mk]?.color ?? '#888';
          return (
            <span
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 1,
                  background: col,
                  display: 'inline-block',
                }}
              />
              {MATERIALS[mk]?.label ?? mk}
            </span>
          );
        })}
      </div>

      {/* Tableau */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            minWidth: 500,
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 12.5,
            background: 'var(--surface-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
          aria-label={`Catalogue AGEROUTE — famille ${family.label}`}
        >
          <thead>
            <tr>
              <th style={catThStyle}>NE (×10⁶)</th>
              {PF_COLS.map((p) => (
                <th key={p} style={{ ...catThStyle, textAlign: 'center' }}>
                  {p}
                  <br />
                  <span style={{ fontSize: 9, fontWeight: 400 }}>
                    {PF_PRESETS[p]?.E ?? '—'} MPa
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NE_CLASSES.map((nc, ni) => {
              const row = family.data[nc.id];
              const lim = nc.max / 1e6;
              const prevLim = ni > 0 ? NE_CLASSES[ni - 1].max / 1e6 : 0;
              const isHighlighted =
                neVal !== null &&
                (ni === 0
                  ? neVal / 1e6 < 0.1
                  : neVal / 1e6 < lim && neVal / 1e6 >= prevLim);

              return (
                <tr
                  key={nc.id}
                  style={{
                    background: isHighlighted ? 'rgba(26,74,122,.04)' : undefined,
                    borderBottom:
                      ni < NE_CLASSES.length - 1
                        ? '1px solid var(--border-subtle)'
                        : 'none',
                  }}
                >
                  <td
                    style={{
                      padding: '8px 11px',
                      fontWeight: 500,
                      fontSize: 11,
                      verticalAlign: 'middle',
                    }}
                  >
                    {nc.id}{' '}
                    <span
                      style={{
                        fontWeight: 400,
                        color: 'var(--text-secondary)',
                        fontSize: 9.5,
                      }}
                    >
                      &lt;{lim}
                    </span>
                  </td>
                  {PF_COLS.map((pk) => {
                    const thicknesses = row?.[pk];
                    const isHL = isHighlighted && pk === pfCls;
                    if (!thicknesses) {
                      return (
                        <td
                          key={pk}
                          style={{
                            padding: '3px 8px',
                            textAlign: 'center',
                            color: 'var(--text-secondary)',
                            fontSize: 10,
                          }}
                        >
                          —
                        </td>
                      );
                    }
                    const total = thicknesses.reduce((s, v) => s + v, 0);
                    const H_PX = 50;
                    const scale = H_PX / total;
                    let cumY = 0;

                    return (
                      <td
                        key={pk}
                        style={{
                          padding: 3,
                          textAlign: 'center',
                          outline: isHL ? '2px solid #1a4a7a' : undefined,
                          background: isHL ? 'rgba(26,74,122,.07)' : undefined,
                          borderRadius: isHL ? 3 : undefined,
                          verticalAlign: 'middle',
                        }}
                      >
                        <svg
                          width={76}
                          height={H_PX}
                          viewBox={`0 0 76 ${H_PX}`}
                          style={{ display: 'block', margin: '0 auto' }}
                          aria-label={`Structure ${nc.id}/${pk} : ${thicknesses.join('+')} cm = ${total} cm`}
                        >
                          {thicknesses.map((h, idx) => {
                            const ph = h * scale;
                            const mk = family.mats[Math.min(idx, family.mats.length - 1)];
                            const col = MATERIALS[mk]?.color ?? '#888';
                            const y0 = cumY;
                            cumY += ph;
                            return (
                              <g key={idx}>
                                <rect x={13} y={y0} width={50} height={ph} fill={col} />
                                {ph > 7 && (
                                  <text
                                    x={38}
                                    y={y0 + ph / 2 + 3.5}
                                    textAnchor="middle"
                                    fontSize={7.5}
                                    fill="rgba(255,255,255,.9)"
                                    fontWeight={500}
                                  >
                                    {h}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                          <text
                            x={38}
                            y={H_PX - 1}
                            textAnchor="middle"
                            fontSize={7.5}
                            fill="var(--text-secondary)"
                          >
                            {total}cm
                          </text>
                        </svg>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Note>
        CC1/0351/AGR — Egis/Ifsttar/Sénélabo · Épaisseurs en cm · T_éq=34°C · f=20Hz ·
        r=10%
      </Note>
    </div>
  );
}

const catThStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '9px 11px',
  background: 'var(--surface-canvas)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
};

// ---------------------------------------------------------------------------
// Onglet Résultats
// ---------------------------------------------------------------------------

interface TabResultatsProps {
  result: CalcResult | null;
  ne: number; // NE courant depuis les paramètres de trafic (pour la classe de trafic)
  onEmitPv: () => void;
  emittingPv: boolean;
  pvResult: OfficialPv | null;
  entitlements: EntitlementsResponse | null;
}

function TabResultats({
  result,
  ne,
  onEmitPv,
  emittingPv,
  pvResult,
  entitlements,
}: TabResultatsProps) {
  if (!result) {
    return (
      <PlaceholderPane
        icon="chart"
        title="Résultats de calcul"
        description={`Cliquez sur "Calculer" pour lancer l'analyse Burmister exacte et afficher les résultats ici.`}
      />
    );
  }

  const output = result.output as NormalizedCalcOutput | null;
  const verdict = output?.verdict;
  const kpis = extractBurmisterKpis(output);
  const diagnostics = buildBurmisterDiagnostics(output);

  // Classe de trafic (seuils AGEROUTE publics, décision D2a — présentation uniquement)
  const classeNE = neClass(ne);

  const isPass = verdict === 'PASS';
  const isFail = verdict === 'FAIL';
  const isError = result.status === 'ERROR';
  const isExpiredOrQuota =
    entitlements?.expired || (entitlements?.quota.remaining ?? 1) <= 0;

  return (
    <div data-testid="tab-resultats">
      {/* ── Bandeau verdict ───────────────────────────────────────────── */}
      <div
        role="status"
        aria-live="polite"
        data-testid="verdict-banner"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          borderRadius: 14,
          marginBottom: 20,
          background: isError
            ? '#fef2f2'
            : isPass
              ? '#f0fdf4'
              : isFail
                ? '#fef2f2'
                : 'var(--surface-canvas)',
          border: `1px solid ${isError ? '#fca5a5' : isPass ? '#86efac' : isFail ? '#fca5a5' : 'var(--border-subtle)'}`,
          borderLeft: `4px solid ${isError ? '#dc2626' : isPass ? '#16a34a' : isFail ? '#dc2626' : 'var(--border-subtle)'}`,
        }}
      >
        {/* Icône */}
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke={
            isPass ? '#16a34a' : isFail || isError ? '#dc2626' : 'var(--text-secondary)'
          }
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          {isPass ? (
            <>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          )}
        </svg>
        <div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: isPass
                ? '#15803d'
                : isFail || isError
                  ? '#991b1b'
                  : 'var(--text-primary)',
            }}
          >
            {isError
              ? 'Erreur moteur — calcul non abouti'
              : isPass
                ? 'Structure satisfaisante'
                : isFail
                  ? 'Structure non satisfaisante — renforcement requis'
                  : 'Résultat en attente'}
          </div>
          {!isError && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              Critères AGEROUTE Sénégal 2015 · Transfer Matrix (Burmister exact)
            </div>
          )}
        </div>
      </div>

      {/* ── 4 cartes KPI ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
          gap: 12,
          marginBottom: 22,
        }}
        data-testid="kpi-cards"
      >
        {[
          {
            label: 'H paquet lié',
            value: kpis?.hLie_cm != null ? `${fmtNum(kpis.hLie_cm, 1)} cm` : '—',
            sub: 'Couches bitumineuses liées',
            testId: 'kpi-hlie',
          },
          {
            label: 'H total couches',
            value: kpis?.hTotal_cm != null ? `${fmtNum(kpis.hTotal_cm, 1)} cm` : '—',
            sub: 'Épaisseur de structure',
            testId: 'kpi-htotal',
          },
          {
            label: 'Classe de trafic',
            value: classeNE,
            sub: `NE ≈ ${fmtSci(ne)} essieux éq.`,
            testId: 'kpi-classe',
          },
          {
            label: 'Moteur',
            value: 'Transfer Matrix',
            sub: 'Burmister exact · n couches',
            testId: 'kpi-moteur',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            data-testid={kpi.testId}
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: 'var(--surface-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '13px 15px',
              boxShadow: 'var(--elevation-card)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: 11,
                bottom: 11,
                width: 3,
                borderRadius: 2,
                background: '#1a4a7a',
                opacity: 0.85,
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}
            >
              {kpi.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 19,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginTop: 4,
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {kpi.value}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 3 }}>
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── Vérification des critères ──────────────────────────────────── */}
      <SectionTitle>Vérification des critères</SectionTitle>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        data-testid="criteres"
      >
        {/* Fatigue bitumineuse */}
        <CritereCard
          label={
            kpis?.fatigueRigide ? 'Fatigue (rigide) — σ_t' : 'Fatigue bitumineuse — ε_t'
          }
          unite={kpis?.fatigueRigide ? 'MPa' : 'µdef'}
          valeur={kpis?.fatigueValeur}
          admissible={kpis?.fatigueAdmissible}
          ok={kpis?.fatigueOk ?? null}
          famille={kpis?.familleSanitized}
          testId="critere-fatigue"
        />
        {/* Orniérage PSC */}
        <CritereCard
          label="Orniérage PSC — ε_z"
          unite="µdef"
          valeur={kpis?.ornieValeur}
          admissible={kpis?.ornieAdmissible}
          ok={kpis?.ornieOk ?? null}
          famille={null}
          testId="critere-ornierage"
        />
      </div>

      {/* ── Diagnostic & recommandations ──────────────────────────────── */}
      {diagnostics.length > 0 && (
        <>
          <SectionTitle>Diagnostic et recommandations</SectionTitle>
          <div
            data-testid="diagnostics"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {diagnostics.map((msg, i) => (
              <Note key={i} variant={isPass ? 'green' : 'orange'}>
                {msg}
              </Note>
            ))}
          </div>
        </>
      )}

      {/* ── PV scellé ─────────────────────────────────────────────────── */}
      <SectionTitle>Procès-verbal scellé</SectionTitle>
      {pvResult ? (
        <div
          data-testid="pv-success"
          style={{
            padding: '13px 16px',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderLeft: '3px solid #16a34a',
            borderRadius: 10,
            fontSize: 12.5,
            color: '#15803d',
          }}
        >
          PV {pvResult.number} scellé — HMAC {pvResult.hmacTruncated}…
          <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 11 }}>
            {new Date(pvResult.sealedAt).toLocaleString('fr-FR')}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onEmitPv}
            disabled={
              emittingPv || !result || result.status !== 'DONE' || isExpiredOrQuota
            }
            aria-busy={emittingPv}
            data-testid="btn-imprimer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background:
                emittingPv || result.status !== 'DONE' || isExpiredOrQuota
                  ? '#e5e7eb'
                  : 'linear-gradient(135deg, #1a4a7a, #143a61)',
              color:
                emittingPv || result.status !== 'DONE' || isExpiredOrQuota
                  ? 'var(--text-secondary)'
                  : '#fff',
              border: 'none',
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 11,
              cursor:
                emittingPv || result.status !== 'DONE' || isExpiredOrQuota
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                emittingPv || result.status !== 'DONE' || isExpiredOrQuota ? 0.55 : 1,
              fontFamily: 'inherit',
              transition: 'opacity .15s',
            }}
          >
            {emittingPv ? (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    width: 13,
                    height: 13,
                    border: '2px solid rgba(0,0,0,.15)',
                    borderTopColor: 'currentColor',
                    borderRadius: '50%',
                    animation: 'roadsens-spin .7s linear infinite',
                    display: 'inline-block',
                    verticalAlign: -1,
                  }}
                />
                Émission…
              </>
            ) : (
              <>
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Imprimer le rapport / Émettre PV
              </>
            )}
          </button>
          {result.status !== 'DONE' && (
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Le calcul doit être terminé pour émettre un PV.
            </span>
          )}
          {isExpiredOrQuota && (
            <span style={{ fontSize: 11.5, color: '#991b1b' }}>
              Abonnement expiré ou quota épuisé.
            </span>
          )}
        </div>
      )}

      <Note>
        Le PV est généré et scellé (HMAC) côté serveur. Il ne peut être modifié après
        émission. La vérification d&apos;intégrité en ligne sera disponible en Phase 2
        (certificat horodaté tiers).
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte de critère (fatigue / orniérage)
// ---------------------------------------------------------------------------

interface CritereCardProps {
  label: string;
  unite: string;
  valeur: number | null | undefined;
  admissible: number | null | undefined;
  ok: 'ok' | 'fail' | null;
  famille: string | null | undefined;
  testId: string;
}

function CritereCard({
  label,
  unite,
  valeur,
  admissible,
  ok,
  famille,
  testId,
}: CritereCardProps) {
  const isOk = ok === 'ok';
  const isFail = ok === 'fail';
  const ratio =
    valeur != null && admissible != null && admissible > 0 ? valeur / admissible : null;

  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '12px 16px',
        background: 'var(--surface-base)',
        border: `1px solid ${isFail ? '#fca5a5' : isOk ? '#86efac' : 'var(--border-subtle)'}`,
        borderLeft: `3px solid ${isFail ? '#dc2626' : isOk ? '#16a34a' : 'var(--border-subtle)'}`,
        borderRadius: 10,
      }}
    >
      {/* Badge SATISFAIT / NON */}
      <span
        data-testid={`${testId}-badge`}
        style={{
          display: 'inline-block',
          padding: '4px 11px',
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          background: isFail ? '#fee2e2' : isOk ? '#dcfce7' : 'var(--surface-canvas)',
          color: isFail ? '#991b1b' : isOk ? '#15803d' : 'var(--text-secondary)',
          flexShrink: 0,
        }}
      >
        {isFail ? 'NON SATISFAIT' : isOk ? 'SATISFAIT' : '—'}
      </span>

      {/* Libellé + famille */}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
          {label}
        </div>
        {famille && (
          <div
            data-testid={`${testId}-famille`}
            style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}
          >
            Famille : {famille}
          </div>
        )}
      </div>

      {/* Valeur sollicitante */}
      {valeur != null && (
        <div style={{ textAlign: 'right', minWidth: 90 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 17,
              fontWeight: 700,
              color: isFail ? '#dc2626' : isOk ? '#16a34a' : 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtNum(valeur, 1)} {unite}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>sollicitante</div>
        </div>
      )}

      {/* Séparateur / */}
      {valeur != null && admissible != null && (
        <div
          style={{
            fontSize: 18,
            color: 'var(--text-muted)',
            fontWeight: 300,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          /
        </div>
      )}

      {/* Admissible + ratio */}
      {admissible != null && (
        <div style={{ textAlign: 'right', minWidth: 90 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtNum(admissible, 1)} {unite}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>admissible</div>
        </div>
      )}

      {/* Taux % */}
      {ratio != null && (
        <div
          data-testid={`${testId}-ratio`}
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 14,
            fontWeight: 700,
            color: ratio > 1 ? '#dc2626' : '#15803d',
            minWidth: 48,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(ratio * 100)} %
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet Détails calcul
// ---------------------------------------------------------------------------

function TabDetails({ result }: { result: CalcResult | null }) {
  if (!result) {
    return (
      <PlaceholderPane
        icon="microscope"
        title="Détails de calcul"
        description="Lancez un calcul pour accéder au récapitulatif des critères et épaisseurs."
      />
    );
  }

  const output = result.output as NormalizedCalcOutput | null;
  const rows = Array.isArray(output?.rows) ? (output!.rows as CalcOutputRow[]) : [];
  const details = Array.isArray(output?.details) ? (output!.details as CalcOutputRow[]) : [];

  return (
    <div data-testid="tab-details">
      <SectionTitle>
        Récapitulatif des critères — calcul n° {result.id.slice(-8)}
      </SectionTitle>
      <Note>
        Résultats de la méthode Transfer Matrix (Burmister exact, n couches). Les
        intermédiaires de la méthode (contraintes σ, déformations ε, modules pondérés)
        sont exposés ci-dessous ; seuls les coefficients de calage propriétaires (ε₆, b,
        kc, kr, ks, Sh, kθ) restent côté serveur (DoD §8).
      </Note>

      {rows.length === 0 ? (
        <div style={{ padding: '1.5rem', color: 'var(--text-secondary)', fontSize: 13 }}>
          Aucune ligne de résultat disponible.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontSize: 12.5,
              background: 'var(--surface-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
            aria-label="Détails du calcul ROADSENS"
          >
            <thead>
              <tr>
                {['Critère', 'Valeur', 'Unité', 'Statut'].map((th) => (
                  <th
                    key={th}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      background: 'var(--surface-canvas)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {th}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom:
                      i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <td
                    style={{
                      padding: '8px 12px',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {row.label}
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {typeof row.value === 'number'
                      ? fmtNum(row.value, row.unit === 'm' ? 4 : 2)
                      : row.value}
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                    }}
                  >
                    {row.unit || '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {row.status ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          background: row.status === 'ok' ? '#dcfce7' : '#fee2e2',
                          color: row.status === 'ok' ? '#15803d' : '#991b1b',
                        }}
                      >
                        {row.status === 'ok' ? 'OK' : 'NON'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {details.length > 0 && (
        <>
          <SectionTitle>Détails de calcul — intermédiaires de la méthode</SectionTitle>
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table
              style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}
              aria-label="Détails de calcul ROADSENS — intermédiaires de méthode"
            >
              <thead>
                <tr>
                  {['Grandeur', 'Valeur', 'Unité'].map((thh) => (
                    <th key={thh} style={{ textAlign: 'left', padding: '9px 12px', background: 'var(--surface-canvas)', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                      {thh}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < details.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {typeof row.value === 'number' ? fmtNum(row.value, 2) : row.value}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>{row.unit || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Note>
        Calcul effectué le {new Date(result.createdAt).toLocaleString('fr-FR')} · Moteur :{' '}
        {result.engineId} · ID : {result.id}
      </Note>
    </div>
  );
}
