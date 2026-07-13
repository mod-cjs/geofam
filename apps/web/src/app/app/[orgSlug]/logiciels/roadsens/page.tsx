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

import {
  Route,
  Calculator,
  Layers,
  Truck,
  SlidersHorizontal,
  BookOpen,
  BarChart3,
  Microscope,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect, useId, useRef, Fragment } from 'react';

import { PvEmittedActions } from '@/components/pv/PvEmittedActions';
import { ProjectPicker } from '@/components/ui/ProjectPicker';
import { listProjects, runCalc, emitPv, getEntitlements } from '@/lib/api/client';
import type {
  Project,
  CalcResult,
  CalcOutputRow,
  NormalizedCalcOutput,
  OfficialPv,
  EntitlementsResponse,
} from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { evaluateGate } from '@/lib/subscription-gate';

const ENGINE_ID = 'burmister';

// ---------------------------------------------------------------------------
// Retint définitif (rebase, décision titulaire) — palette locale à CETTE page
// uniquement : on ne touche PAS aux tokens globaux du design system (`--surface-*`
// restent inchangés ailleurs dans l'app), on remplace juste les valeurs littérales
// utilisées ici par les teintes exactes du HTML définitif.
// ---------------------------------------------------------------------------
const RS_PANEL = '#eaf1f9'; // fond en-tête / nav onglets / panneaux
const RS_PANEL_2 = '#dde7f2'; // fond en-tête de tableau / survol / cartes secondaires
const RS_FIELD = '#f4f8fc'; // fond des champs de saisie + cartes métriques
const RS_BRAND_TINT = '#e2ecf7'; // teinte d'accent (tag, dégradés)

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
    label: 'BBSG classe 1 (E = 1 512 MPa — T.54)',
    E: 1512,
    nu: 0.45,
    color: '#1e1e1e',
    nature: 'bitumineux',
  },
  BBSG2: {
    label: 'BBSG classe 2/3 (E = 1 896 MPa — T.54)',
    E: 1896,
    nu: 0.45,
    color: '#0a0a0a',
    nature: 'bitumineux',
  },
  BBTM: {
    label: 'BB Très Mince (BBTM) (E = 2 500 MPa — T.54)',
    E: 2500,
    nu: 0.45,
    color: '#2a2a2a',
    nature: 'bitumineux',
  },
  BBM: {
    label: 'BB Mince (BBM) (E = 2 500 MPa — T.54)',
    E: 2500,
    nu: 0.45,
    color: '#2f2f2f',
    nature: 'bitumineux',
  },
  GB2: {
    label: 'Grave Bitume GB2 (E = 2 588 MPa — T.44)',
    E: 2588,
    nu: 0.45,
    color: '#383838',
    nature: 'bitumineux',
  },
  GB3: {
    label: 'Grave Bitume GB3 (E = 2 588 MPa — T.44)',
    E: 2588,
    nu: 0.45,
    color: '#303030',
    nature: 'bitumineux',
  },
  EME2: {
    label: 'EME2 (E = 6 151 MPa — T.50)',
    E: 6151,
    nu: 0.45,
    color: '#1c1c1c',
    nature: 'bitumineux',
  },
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
  // Rebase définitive (#93 sous-port 3c) : dalle béton BC5 goujonnée (Tab. 68) —
  // même module/ν que BC5, kd goujonné réservé au moteur (materialsRev='definitive').
  BC5g: {
    label: 'Béton BC5 (dalle goujonnée)',
    E: 35000,
    nu: 0.25,
    color: '#e8e8de',
    nature: 'mtlh',
  },
};

/**
 * Lois de fatigue — matériaux bitumineux (LCPC 1994, valeurs PUBLIQUES du catalogue
 * AGEROUTE 2015). Affichage LECTURE SEULE (décision titulaire) : aucun branchement au
 * calcul, qui reste exclusivement serveur (DoD §8). ε₆/b/Kc ne sont PAS des coefficients
 * de calage confidentiels ici — ce sont les valeurs normatives publiées du catalogue.
 */
interface FatigueBitEntry {
  label: string;
  e6: number; // ε₆ (μdef)
  b: number;
  kc: number;
  source: string;
}
const FATIGUE_BIT: Record<string, FatigueBitEntry> = {
  BBSG1: { label: 'BBSG classe 1', e6: 100, b: 5, kc: 1.1, source: 'T.54' },
  BBSG2: { label: 'BBSG classe 2/3', e6: 100, b: 5, kc: 1.1, source: 'T.54' },
  BBTM: { label: 'BB Très Mince (BBTM)', e6: 100, b: 5, kc: 1.1, source: 'T.54' },
  BBM: { label: 'BB Mince (BBM)', e6: 100, b: 5, kc: 1.1, source: 'T.54' },
  GB2: { label: 'Grave Bitume GB2', e6: 80, b: 5, kc: 1.3, source: 'T.44' },
  GB3: { label: 'Grave Bitume GB3', e6: 90, b: 5, kc: 1.3, source: 'T.44' },
  EME2: { label: 'EME2', e6: 130, b: 5, kc: 1.0, source: 'T.50' },
};

/** Lois de fatigue — matériaux MTLH (LCPC 1994, valeurs publiques du catalogue). */
interface FatigueMtlhEntry {
  label: string;
  s6: number; // σ₆ (MPa)
  b: number; // affiché 1/b
  kc: number;
  source: string;
}
const FATIGUE_MTLH: Record<string, FatigueMtlhEntry> = {
  GLc1: { label: 'Latérite ciment GLc1', s6: 0.19, b: 11, kc: 1.4, source: 'T.19' },
  GLc2: { label: 'Latérite ciment GLc2', s6: 0.37, b: 11, kc: 1.4, source: 'T.19' },
  GC3: { label: 'Grave Ciment GC-T3', s6: 0.75, b: 15, kc: 1.4, source: 'T.33' },
  SC2: { label: 'Sable Ciment SC-T2', s6: 0.5, b: 12, kc: 1.5, source: 'T.33' },
  BQc: { label: 'Banco-coquillage (BQc)', s6: 0.3, b: 11, kc: 1.4, source: 'T.35' },
  BC5: { label: 'Béton BC5', s6: 2.15, b: 16, kc: 1.5, source: 'T.37' },
  BC2: { label: 'Béton Maigre BC2', s6: 1.37, b: 14, kc: 1.5, source: 'T.37' },
  BC5g: {
    label: 'Béton BC5 (dalle goujonnée)',
    s6: 2.15,
    b: 16,
    kc: 1.5,
    source: 'T.37',
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

/**
 * Placement des matériaux dans une structure de famille catalogue : `top` = couche
 * de roulement (toujours 1re), `tail` = couche de fond (si présente, seule couche
 * granulaire non liée sous le paquet traité), `mid` = 2e couche quand la structure a
 * 3 couches liées distinctes (ex. S9 : BBSG / GLc2 / GL2), `body` = matériau par
 * défaut pour toute position intermédiaire non couverte par mid/tail.
 */
interface CatMats {
  top: string;
  mid?: string;
  body: string;
  tail?: string;
}

interface CatFamily {
  label: string;
  m: CatMats;
  data: CatEntry;
}

/**
 * Résout le matériau (clé MATERIALS) affiché à la position `i` (0-based) d'une
 * structure catalogue de longueur `L`. Reproduit fidèlement `catMat()` de la
 * définitive : top en tête, tail en pied (si défini), mid en position 1 (si défini
 * et pas déjà couvert par tail), sinon body. EXPORTÉ pour tests DoD §9.
 */
export function catalogueMaterialAt(m: CatMats, i: number, L: number): string {
  if (i === 0) return m.top;
  if (m.tail && i === L - 1) return m.tail;
  if (m.mid && i === 1) return m.mid;
  return m.body;
}

/** Catalogue AGEROUTE 2015 — 14 familles (S1-S11, S13-S15), données de la définitive. */
export const CAT: Record<string, CatFamily> = {
  S1: {
    label: 'BBSG / GB2',
    m: { top: 'BBSG1', body: 'GB2' },
    data: {
      C1: {
        PF1: [6, 11, 11],
        PF2: [6, 8, 9],
        PF2qs: [6, 7, 7],
        PF3: [6, 11],
        PF4: [6, 8],
      },
      C2: {
        PF1: [6, 13, 13],
        PF2: [6, 10, 10],
        PF2qs: [6, 8, 9],
        PF3: [6, 14],
        PF4: [6, 11],
      },
      C3: {
        PF1: [6, 10, 10, 10],
        PF2: [6, 12, 13],
        PF2qs: [6, 11, 11],
        PF3: [6, 9, 9],
        PF4: [6, 15],
      },
      C4: { PF2: [6, 9, 10, 10], PF2qs: [6, 13, 13], PF3: [6, 11, 12], PF4: [6, 9, 10] },
      C5: { PF3: [8, 10, 10, 10], PF4: [8, 13, 13] },
      C6: { PF3: [8, 11, 12, 12], PF4: [8, 10, 10, 11] },
      C7: { PF3: [8, 12, 13, 13], PF4: [8, 11, 11, 12] },
      C8: { PF3: [8, 14, 14, 14], PF4: [8, 12, 13, 13] },
    },
  },
  S2: {
    label: 'BBSG / GB3',
    m: { top: 'BBSG1', body: 'GB3' },
    data: {
      C1: { PF2: [6, 7, 8], PF2qs: [6, 12], PF3: [6, 9], PF4: [6, 8] },
      C2: { PF2: [6, 9, 10], PF2qs: [6, 8, 8], PF3: [6, 14], PF4: [6, 10] },
      C3: { PF2: [6, 12, 12], PF2qs: [6, 10, 10], PF3: [6, 8, 9], PF4: [6, 14] },
      C4: { PF2: [6, 9, 10, 10], PF2qs: [6, 12, 13], PF3: [6, 11, 11], PF4: [6, 8, 9] },
      C5: { PF2qs: [8, 10, 10, 11], PF3: [8, 13, 14], PF4: [8, 11, 12] },
      C6: { PF3: [8, 10, 11, 11], PF4: [8, 9, 10, 10] },
      C7: { PF3: [8, 11, 12, 12], PF4: [8, 10, 10, 11] },
      C8: { PF3: [8, 13, 13, 13], PF4: [8, 11, 12, 12] },
    },
  },
  S3: {
    label: 'BBSG / GB2 / GNT1',
    m: { top: 'BBSG1', body: 'GB2', tail: 'GNT1' },
    data: {
      C2: { PF2: [6, 7, 8, 25], PF2qs: [6, 11, 25], PF3: [6, 8, 15] },
      C3: { PF2: [6, 10, 10, 25], PF2qs: [6, 7, 8, 25], PF3: [6, 13, 15] },
      C4: { PF2: [6, 12, 12, 25], PF2qs: [6, 10, 10, 25], PF3: [6, 9, 9, 15] },
      C5: { PF2: [8, 10, 11, 11, 25], PF2qs: [8, 14, 14, 25], PF3: [8, 12, 13, 15] },
    },
  },
  S4: {
    label: 'BBSG / GB3 / GNT1',
    m: { top: 'BBSG1', body: 'GB3', tail: 'GNT1' },
    data: {
      C1: { PF2: [6, 9, 25] },
      C2: { PF2: [6, 14, 25], PF2qs: [6, 9, 25], PF3: [6, 8, 15] },
      C3: { PF2: [6, 9, 10, 25], PF2qs: [6, 14, 25], PF3: [6, 13, 15] },
      C4: { PF2: [6, 12, 12, 25], PF2qs: [6, 9, 9, 25], PF3: [6, 8, 9, 15] },
      C5: { PF2: [8, 9, 10, 10, 25], PF2qs: [8, 12, 13, 15], PF3: [8, 12, 13, 15] },
      C6: { PF2qs: [8, 10, 10, 11, 25], PF3: [8, 14, 14, 15] },
      C7: { PF3: [8, 10, 10, 11, 15] },
    },
  },
  S5: {
    label: 'BBSG3 / EME2',
    m: { top: 'BBSG2', body: 'EME2' },
    data: {
      C1: { PF2qs: [6, 7] },
      C2: { PF2qs: [6, 11], PF3: [6, 9], PF4: [6, 7] },
      C3: { PF2qs: [6, 7, 7], PF3: [6, 12], PF4: [6, 9] },
      C4: { PF2qs: [6, 9, 9], PF3: [6, 7, 8], PF4: [6, 12] },
      C5: { PF2qs: [8, 10, 11], PF3: [8, 9, 9], PF4: [8, 8, 8] },
      C6: { PF2qs: [8, 12, 13], PF3: [8, 11, 11], PF4: [8, 10, 10] },
      C7: { PF2qs: [8, 9, 9, 9], PF3: [8, 12, 12], PF4: [8, 11, 11] },
      C8: { PF2qs: [8, 10, 10, 10], PF3: [8, 9, 9, 9], PF4: [8, 12, 12] },
    },
  },
  S6: {
    label: 'BBSG / GC-T3',
    m: { top: 'BBSG1', body: 'GC3' },
    data: {
      C2: { PF2: [6, 29], PF2qs: [6, 27], PF3: [6, 25], PF4: [6, 22] },
      C3: { PF2: [6, 20, 20], PF2qs: [6, 29], PF3: [6, 26], PF4: [6, 25] },
      C4: { PF2: [6, 20, 20], PF2qs: [6, 30], PF3: [6, 27], PF4: [6, 25] },
      C5: { PF2: [8, 23, 20], PF2qs: [8, 21, 20], PF3: [8, 19, 18], PF4: [8, 18, 15] },
      C6: {
        PF2: [10, 23, 20],
        PF2qs: [10, 21, 20],
        PF3: [10, 19, 18],
        PF4: [10, 18, 15],
      },
      C7: { PF2qs: [12, 21, 20], PF3: [12, 19, 18], PF4: [12, 18, 15] },
      C8: { PF2qs: [14, 21, 20], PF3: [14, 19, 18], PF4: [14, 18, 15] },
    },
  },
  S7: {
    label: 'BBSG / SC-T2',
    m: { top: 'BBSG1', body: 'SC2' },
    data: {
      C1: { PF2qs: [6, 28], PF3: [6, 25], PF4: [6, 23] },
      C2: { PF2qs: [6, 30], PF3: [6, 27], PF4: [6, 24] },
      C3: { PF2: [6, 20, 20], PF2qs: [6, 20, 20], PF3: [6, 29], PF4: [6, 26] },
      C4: { PF2: [6, 22, 20], PF2qs: [6, 20, 20], PF3: [6, 18, 18], PF4: [6, 28] },
    },
  },
  S8: {
    label: 'BBSG / GLc2',
    m: { top: 'BBSG1', body: 'GLc2' },
    data: {
      C1: { PF2qs: [6, 27], PF3: [6, 22], PF4: [6, 18] },
      C2: { PF2qs: [6, 29], PF3: [6, 24], PF4: [6, 20] },
      C3: { PF2qs: [6, 20, 20], PF3: [6, 27], PF4: [6, 25] },
      C4: { PF2: [6, 22, 20], PF2qs: [6, 20, 20], PF3: [6, 29], PF4: [6, 25] },
      C5: { PF2: [8, 27, 24], PF2qs: [8, 24, 21], PF3: [8, 20, 18], PF4: [8, 17, 15] },
      C6: { PF2qs: [10, 23, 22], PF3: [10, 20, 19], PF4: [10, 17, 17] },
      C7: { PF2qs: [12, 23, 22], PF3: [12, 20, 19], PF4: [12, 17, 17] },
      C8: { PF2qs: [14, 23, 22], PF3: [14, 21, 19], PF4: [14, 18, 17] },
    },
  },
  S9: {
    label: 'BBSG / GLc2 / GL2',
    m: { top: 'BBSG1', mid: 'GLc2', body: 'GL2' },
    data: {
      C1: { PF2: [6, 26, 25], PF2qs: [6, 22, 25] },
      C2: { PF2: [6, 29, 25], PF2qs: [6, 25, 25] },
      C3: { PF2: [6, 30, 30], PF2qs: [6, 25, 30] },
      C4: { PF2qs: [6, 28, 30] },
    },
  },
  S10: {
    label: 'BBSG / GLc1',
    m: { top: 'BBSG1', body: 'GLc1' },
    data: {
      C1: { PF2: [6, 25, 23], PF2qs: [6, 23, 21], PF3: [6, 20, 18], PF4: [6, 16, 15] },
      C2: { PF2: [6, 27, 25], PF2qs: [6, 24, 22], PF3: [6, 22, 20], PF4: [6, 18, 17] },
      C3: { PF2: [6, 29, 27], PF2qs: [6, 26, 24], PF3: [6, 24, 22], PF4: [6, 19, 19] },
      C4: { PF2: [6, 30, 30], PF2qs: [6, 28, 26], PF3: [6, 25, 24], PF4: [6, 22, 20] },
      C5: { PF4: [8, 28, 27] },
      C6: { PF4: [10, 29, 28] },
    },
  },
  S11: {
    label: 'BBSG / BQc',
    m: { top: 'BBSG1', body: 'BQc' },
    data: {
      C1: { PF2: [6, 24, 23], PF2qs: [6, 23, 21], PF3: [6, 21, 20], PF4: [6, 19, 18] },
      C2: { PF2: [6, 26, 25], PF2qs: [6, 24, 23], PF3: [6, 23, 21], PF4: [6, 21, 19] },
      C3: { PF2: [6, 27, 27], PF2qs: [6, 26, 24], PF3: [6, 25, 23], PF4: [6, 22, 21] },
      C4: { PF2: [6, 29, 28], PF2qs: [6, 28, 26], PF3: [6, 26, 24], PF4: [6, 24, 22] },
      C5: { PF4: [8, 29, 27] },
    },
  },
  S13: {
    label: 'BBSG / GNT1',
    m: { top: 'BBSG1', body: 'GNT1' },
    data: {
      C1: { PF2: [6, 30], PF2qs: [6, 20], PF3: [6, 15] },
      C2: { PF2: [6, 25, 25], PF2qs: [6, 15, 20], PF3: [6, 25] },
      C3: { PF2: [6, 25, 30], PF2qs: [6, 20, 25], PF3: [6, 15, 20] },
      C4: { PF2: [6, 20, 20, 25], PF2qs: [6, 25, 30], PF3: [6, 20, 25] },
    },
  },
  S14: {
    label: 'BBSG / GL1',
    m: { top: 'BBSG1', body: 'GL1' },
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
    label: 'BBSG / GL2 / GL1',
    m: { top: 'BBSG1', mid: 'GL2', body: 'GL1' },
    data: {
      C1: { PF1: [6, 15, 20, 25], PF2: [6, 15, 20], PF2qs: [6, 15, 10] },
      C2: { PF2: [6, 20, 15, 20], PF2qs: [6, 20, 20], PF3: [6, 20, 10] },
      C3: { PF2: [6, 20, 20, 25], PF2qs: [6, 20, 30], PF3: [6, 20, 20] },
      C4: { PF2: [6, 20, 25, 30], PF2qs: [6, 20, 20, 20], PF3: [6, 20, 30] },
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

/** Mode d'interface entre cette couche et la suivante (Tab. 68 AGEROUTE) — même allowlist que le contrat moteur. */
type LayerIface = 'auto' | 'collée' | 'semi-collée' | 'glissante';

interface Layer {
  id: number;
  mat: string;
  h: number; // épaisseur (m)
  E: number; // module (MPa)
  nu: number; // Poisson
  /** Condition d'interface imposée (Tab. 68) — 'auto' par défaut (définitive, #87 étape 2/2). */
  iface: LayerIface;
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
  r: string; // risque : 'auto' | '5' | '10' | '15' | '25' | '50' | 'custom'
  /** Saisie libre du risque (%) quand `r === 'custom'` — texte, converti à l'envoi. */
  rCustom: string;
  sh: string; // dispersion Sh : 'auto' | '1' | '1.5' | '2.5' | '3'
  ks: string; // hétérogénéité ks : 'auto' | valeur numérique
  /** Module GNT automatique (fiche catalogue p.79, #87 étape 1/2) — défaut ON (définitive). */
  gntAuto: boolean;
  /** Conditions d'interface automatiques (Tab. 68 AGEROUTE, #87 étape 2/2) — défaut ON (définitive). */
  ifaceAuto: boolean;
  /** NE cumulé — saisie directe (#93 sous-port 3b) : coché → `neForce` envoyé, court-circuite le calcul TMJA. */
  neDirect: boolean;
  /** Valeur du NE cumulé imposé (PL équivalents) — utilisée seulement si `neDirect === true`. */
  neDirectValue: number;
  /**
   * Surcharge des lois de fatigue ε₆ (bitumineux, µdef) / σ₆ (MTLH, MPa) par matériau
   * (#93 sous-port 3d, table éditable de la définitive — `M['${k}'].e6=+this.value`).
   * Clé = code matériau (ex. "BBSG1", "GLc2") ; entrée absente/vide → défaut catalogue
   * inchangé côté serveur. Converti en tableau `{mat,e6?,s6?}` par
   * `buildBurmisterPayload` (forme attendue du contrat moteur).
   */
  fatigueOverrides: Record<string, { e6?: number; s6?: number }>;
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
  return 365 * traffic.T * computeCcum(traffic) * traffic.C * traffic.dir * traffic.tv;
}

/** Coefficient cumulatif C = [(1+τ)^n - 1] / τ (formule publique AGEROUTE §3.2) —
 * extrait de `computeNE` pour affichage isolé (onglet Détails, section Trafic). */
export function computeCcum(traffic: Traffic): number {
  const t = traffic.tau / 100;
  return Math.abs(t) < 1e-4 ? traffic.N : (Math.pow(1 + t, traffic.N) - 1) / t;
}

/**
 * NE affiché (estimation) — tient compte du NE cumulé en saisie directe (#93 sous-port
 * 3b, `neDirect`/`neDirectValue`) : quand activé et valide, court-circuite `computeNE`
 * comme le fait le moteur serveur (`neForce`). Fail-closed sur valeur invalide/nulle
 * (retombe sur l'estimation TMJA classique).
 */
export function effectiveNE(traffic: Traffic, load: Load): number {
  if (load.neDirect && Number.isFinite(load.neDirectValue) && load.neDirectValue > 0) {
    return load.neDirectValue;
  }
  return computeNE(traffic);
}

/**
 * Résout le risque effectif (%) à envoyer au moteur depuis la saisie `Load` :
 * 'auto' (Tab. 70) ; un choix prédéfini ('5'|'10'|'15'|'25'|'50') converti en nombre ;
 * ou 'custom' + `rCustom` (saisie libre). Fail-closed : `rCustom` vide/non numérique/
 * négatif ou nul retombe sur 'auto' (jamais un risque absurde envoyé au serveur — le
 * schéma serveur re-borne de toute façon 0,001-50 %, mais on évite un 400 évitable).
 */
export function resolveRisk(load: Load): 'auto' | number {
  if (load.r === 'auto') return 'auto';
  if (load.r === 'custom') {
    const n = parseFloat(load.rCustom);
    return Number.isFinite(n) && n > 0 ? n : 'auto';
  }
  const n = Number(load.r);
  return Number.isFinite(n) ? n : 'auto';
}

/**
 * Quantile u_r associé à un risque r (%) — affichage informatif seul (indice de
 * quantile à côté du champ Risque, comme la définitive). Valeurs catalogue exactes
 * pour 5/10/15/25/50 % (Tab. 70 AGEROUTE), loi normale inverse (algorithme d'Acklam,
 * |erreur| < 1,2e-9) pour tout autre risque. Formule STATISTIQUE PUBLIQUE (pas un
 * coefficient de calage AGEROUTE confidentiel) : le kr effectif (qui combine u_r à
 * SN/Sh/b propriétaires) reste calculé côté serveur (DoD §8).
 */
const U_RISK: Record<number, number> = {
  5: 1.645,
  10: 1.282,
  15: 1.036,
  25: 0.674,
  50: 0.0,
};

/** Loi normale inverse (algorithme d'Acklam) — fractile pour un risque quelconque. */
export function invNorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];
  const pl = 0.02425;
  const ph = 1 - pl;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= ph) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** u_r associé au risque r (%) : valeurs catalogue exactes, sinon calcul (invNorm). */
export function uRisk(r: number): number {
  const v = U_RISK[r];
  return v !== undefined ? v : invNorm(1 - r / 100);
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

/** Chiffres exposant (Unicode) — fidèle à `_neFmt()` de la définitive. */
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/**
 * Formate un NE en notation scientifique compacte à exposant réel (ex. « 3,0×10⁷ »),
 * fidèle à `_neFmt()` de la définitive — utilisé UNIQUEMENT pour l'affichage de la
 * note d'un cas de validation du catalogue (formule d'affichage PUBLIQUE, aucun
 * résultat moteur — l'entrée est `preset.ne`, une constante du catalogue).
 */
export function formatNeExponent(ne: number): string {
  if (!ne || !isFinite(ne) || ne <= 0) return '—';
  const e = Math.floor(Math.log10(ne) + 1e-9);
  const m = ne / Math.pow(10, e);
  const exp = String(e)
    .split('')
    .map((c) => (c === '-' ? '⁻' : SUP_DIGITS[Number(c)]))
    .join('');
  return `${m.toFixed(1).replace('.', ',')}×10${exp}`;
}

/**
 * Classe de trafic affichée dans la note d'un cas de validation du catalogue —
 * fidèle à `_trClass()` de la définitive (seuils avec marge ×1,7, Tableau 70
 * AGEROUTE 2015). DISTINCTE de `neClass()` (saisie TMJA classique, seuils sans
 * marge) — les deux existent dans la définitive pour des usages différents.
 */
export function presetTrafficClass(ne: number): string {
  const thresholds: Array<[number, string]> = [
    [1e5, 'C1'],
    [3e5, 'C2'],
    [1e6, 'C3'],
    [3e6, 'C4'],
    [1e7, 'C5'],
    [3e7, 'C6'],
    [1e8, 'C7'],
  ];
  for (const [t, label] of thresholds) {
    if (ne <= t * 1.7) return label;
  }
  return 'C8';
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
    layers: layers.map((l) => ({
      mat: l.mat,
      E: l.E,
      nu: l.nu,
      h: l.h,
      iface: l.iface ?? 'auto',
    })),
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
      r: resolveRisk(load),
      sh: load.sh,
      ks: load.ks,
      gntAuto: load.gntAuto,
      ifaceAuto: load.ifaceAuto,
      // NE cumulé — saisie directe (#93 sous-port 3b) : absent/invalide -> calcul
      // TMJA historique inchangé côté serveur (gate naturel du schéma `neForce?`).
      ...(load.neDirect && Number.isFinite(load.neDirectValue) && load.neDirectValue > 0
        ? { neForce: load.neDirectValue }
        : {}),
      // Rebase définitive (#93 sous-port 3c, décision titulaire) : référentiel
      // matériaux CORRIGÉ envoyé par défaut (GLc2/BQc recalés + BC5g disponible).
      materialsRev: 'definitive' as const,
      // Surcharge ε₆/σ₆ (#93 sous-port 3d) : seules les entrées réellement éditées
      // sont transmises (tableau {mat,e6?,s6?}, forme attendue du contrat moteur) ;
      // vide/absent -> défauts catalogue inchangés (gate naturel, équivalence
      // historique préservée).
      ...(() => {
        const overrides = Object.entries(load.fatigueOverrides)
          .filter(([, v]) => v.e6 !== undefined || v.s6 !== undefined)
          .map(([mat, v]) => ({ mat, ...v }));
        return overrides.length > 0 ? { fatigueOverrides: overrides } : {};
      })(),
    },
  };
}

/**
 * Libellé d'affichage de la condition d'interface AUTOMATIQUE entre deux couches
 * adjacentes (Tab. 68 AGEROUTE, référence PUBLIQUE — même règle que `ifaceAuto()`
 * du HTML client) : deux couches traitées (MTLH/béton) → semi-collée, sauf deux
 * couches « BC » (béton goujonné) → glissante ; sinon collée. Affichage seul
 * (sert de texte d'aide dans le sélecteur « Auto · … » avant calcul) : ne
 * détermine JAMAIS le résultat — le calcul effectif reste serveur.
 */
export function autoIfaceLabel(matA: string, matB: string | null): LayerIface {
  const a = MATERIALS[matA];
  const b = matB ? MATERIALS[matB] : null;
  if (a?.nature === 'mtlh' && b?.nature === 'mtlh') {
    return matA.startsWith('BC') && matB!.startsWith('BC') ? 'glissante' : 'semi-collée';
  }
  return 'collée';
}

/** Libellé court d'un matériau — fidèle à `_matLbl()` de la définitive (utilisé
 * dans la note d'un cas de validation, pas dans le tableau de saisie complet).
 * Fallback = IDENTITÉ (la clé), comme `_matLbl(k) || k` — jamais le libellé
 * catalogue long, qui dupliquerait E dans la note. */
const MAT_SHORT_LABEL: Record<string, string> = {
  BBSG1: 'BBSG',
  BBSG2: 'BBSG 2/3',
  GNT1: 'GNT',
  GNT2: 'GNT',
  BC5g: 'BC5 (goujonnée)',
};
function matShortLabel(mat: string): string {
  return MAT_SHORT_LABEL[mat] ?? mat;
}

// ---------------------------------------------------------------------------
// Cas de validation du catalogue (presets) — dimensionnements pré-remplis (preuve)
// ---------------------------------------------------------------------------

/** Tuple couche d'un preset : [clé matériau, épaisseur en CM, module E imposé (MPa) optionnel]. */
type PresetLayerTuple = [mat: string, hCm: number, EOverride?: number];

export interface RoadsensPreset {
  id: string;
  label: string;
  crit: string;
  pfCls: string;
  ne: number;
  desc: string;
  layers: PresetLayerTuple[];
}

/**
 * Cas de validation du catalogue AGEROUTE 2015 — données EXACTES de la définitive
 * (`PRESETS`). Chaque preset pré-remplit structure/PSC/NE (saisie directe) pour
 * reproduire un point de référence documenté (ε_t,adm / σ_t,adm / ε_z,adm) ;
 * `gntAuto` est désactivé au chargement (modules déjà explicites dans `layers`).
 */
export const ROADSENS_PRESETS: RoadsensPreset[] = [
  {
    id: 's1',
    label: '1 — BBSG / GB2 (bitumineuse épaisse)',
    crit: 'ε_t base bitumineux',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Réf. catalogue : ε_t,adm = 83,96 µdef',
    layers: [
      ['BBSG1', 8],
      ['GB2', 35],
    ],
  },
  {
    id: 's2',
    label: '2 — BBSG / GB3 (bitumineuse épaisse)',
    crit: 'ε_t base bitumineux',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Réf. catalogue : ε_t,adm = 94,45 µdef',
    layers: [
      ['BBSG1', 8],
      ['GB3', 32],
    ],
  },
  {
    id: 's3',
    label: '3 — BBSG / GB2 / GNT1 (bitumineuse + assise GNT)',
    crit: 'ε_t base bitumineux',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Réf. catalogue : ε_t,adm = 83,96 µdef',
    layers: [
      ['BBSG1', 8],
      ['GB2', 30],
      ['GNT1', 15, 400],
    ],
  },
  {
    id: 's4',
    label: '4 — BBSG / GB3 / GNT1 (bitumineuse + assise GNT)',
    crit: 'ε_t base bitumineux',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Réf. catalogue : ε_t,adm = 94,45 µdef',
    layers: [
      ['BBSG1', 8],
      ['GB3', 27],
      ['GNT1', 15, 400],
    ],
  },
  {
    id: 's5',
    label: '5 — BBSG / EME2 (bitumineuse épaisse)',
    crit: 'ε_t base bitumineux',
    pfCls: 'PF2',
    ne: 1e7,
    desc: 'Surface BBSG E = 1512 MPa (convention fichier) · Réf. catalogue : ε_t,adm = 94,67 µdef',
    layers: [
      ['BBSG1', 8],
      ['EME2', 24],
    ],
  },
  {
    id: 's6',
    label: '6 — BBSG / GC-T3 / GC-T3 (semi-rigide)',
    crit: 'σ_t base traitées',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Réf. catalogue : σ_t,adm = 0,596 MPa',
    layers: [
      ['BBSG1', 8],
      ['GC3', 19],
      ['GC3', 18],
    ],
  },
  {
    id: 's7',
    label: '7 — BBSG / SC-T2 / SC-T2 (semi-rigide)',
    crit: 'σ_t base traitées',
    pfCls: 'PF3',
    ne: 1e7,
    desc: 'Réf. catalogue : σ_t,adm = 0,451 MPa',
    layers: [
      ['BBSG1', 8],
      ['SC2', 22],
      ['SC2', 18],
    ],
  },
  {
    id: 's8',
    label: '8 — BBSG / GLc2 / GLc2 (semi-rigide, latérite ciment)',
    crit: 'σ_t base traitées',
    pfCls: 'PF3',
    ne: 1e7,
    desc: 'Réf. catalogue : σ_t,adm = 0,279 MPa',
    layers: [
      ['BBSG1', 8],
      ['GLc2', 20],
      ['GLc2', 18],
    ],
  },
  {
    id: 's10',
    label: '10 — BBSG / GLc1 / GLc1 (semi-rigide, latérite ciment)',
    crit: 'σ_t base traitées',
    pfCls: 'PF4',
    ne: 1e7,
    desc: 'Réf. catalogue : σ_t,adm = 0,143 MPa',
    layers: [
      ['BBSG1', 8],
      ['GLc1', 28],
      ['GLc1', 27],
    ],
  },
  {
    id: 's11',
    label: '11 — BBSG / BQc / BQc (semi-rigide, banco-coquillage)',
    crit: 'σ_t base traitées',
    pfCls: 'PF4',
    ne: 1e7,
    desc: 'Réf. catalogue : σ_t,adm = 0,229 MPa',
    layers: [
      ['BBSG1', 8],
      ['BQc', 29],
      ['BQc', 27],
    ],
  },
  {
    id: 's13',
    label: '13 — BBSG / GNT1 (souple)',
    crit: 'ε_z sol support',
    pfCls: 'PF2',
    ne: 1e5,
    desc: 'Contrôle ε_z indicatif (modèle GNT distinct) · Réf. catalogue : ε_z,adm = 1239 µdef',
    layers: [
      ['BBSG1', 6],
      ['GNT1', 26, 400],
    ],
  },
  {
    id: 's14',
    label: '14 — BBSG / GL1 / GL1 (souple, latérite)',
    crit: 'ε_z sol support',
    pfCls: 'PF2',
    ne: 1e5,
    desc: 'Latérite en sandwich (2×E plafonné à 200) · contrôle ε_z indicatif · Réf. : ε_z,adm = 1239 µdef',
    layers: [
      ['BBSG1', 6],
      ['GL1', 15, 200],
      ['GL1', 24, 100],
    ],
  },
  {
    id: 's16',
    label: '16 — BC5 / BC2 (rigide, béton)',
    crit: 'σ_t dalles béton',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Épaisseur catalogue · Réf. : σ_t,adm dalle = 1,196 MPa',
    layers: [
      ['BC5', 22],
      ['BC2', 20],
    ],
  },
  {
    id: 's17',
    label: '17 — BC5 goujonné / BC2 (rigide, béton)',
    crit: 'σ_t dalles béton',
    pfCls: 'PF3',
    ne: 3e7,
    desc: 'Dalle goujonnée (kd = 1/1,47) · épaisseur catalogue · Réf. : σ_t,adm dalle = 1,383 MPa',
    layers: [
      ['BC5g', 22],
      ['BC2', 15],
    ],
  },
  {
    id: 'sa',
    label: 'annexe — BBSG / GLa (souple, latérite améliorée — hors catalogue)',
    crit: 'ε_z sol support',
    pfCls: 'PF2',
    ne: 1e5,
    desc: 'Hors catalogue · contrôle ε_z indicatif · Réf. : ε_z,adm = 1239 µdef',
    layers: [
      ['BBSG1', 6],
      ['GLa', 19, 800],
    ],
  },
  {
    id: 'sb',
    label: 'annexe — BBSG / GL2 / GL2 (souple, latérite — hors catalogue)',
    crit: 'ε_z sol support',
    pfCls: 'PF2qs',
    ne: 1e5,
    desc: 'Hors catalogue · latérite sandwich (2×E plafonné à 400) · Réf. : ε_z,adm = 1239 µdef',
    layers: [
      ['BBSG1', 6],
      ['GL2', 15, 320],
      ['GL2', 10, 160],
    ],
  },
];

/**
 * Construit les couches React (`Layer[]`) depuis un preset : h en cm -> m, ν
 * toujours issu du catalogue matériaux, E = surcharge du preset si fournie sinon
 * valeur catalogue par défaut. Identifiants séquentiels 1..N (auto, interface).
 * EXPORTÉ pour tests DoD §9 (équivalence préréglage -> état applicable).
 */
export function buildLayersFromPreset(preset: RoadsensPreset): Layer[] {
  let id = 1;
  return preset.layers.map(([mat, hCm, EOverride]) => {
    const matDef = MATERIALS[mat];
    return {
      id: id++,
      mat,
      h: hCm / 100,
      E: EOverride ?? matDef?.E ?? 0,
      nu: matDef?.nu ?? 0.35,
      iface: 'auto' as const,
    };
  });
}

/**
 * Conditions d'un cas de validation à afficher sous le sélecteur de presets —
 * équivalent de `#presetNote` / `buildPresetNote()` de la définitive. `famille`
 * et `risqueLine` proviennent du RÉSULTAT du calcul serveur (comme l'original,
 * qui construit la note APRÈS le retour de `doCalc()`) ; le reste (PF, classe de
 * trafic, structure, interfaces auto) est connu côté saisie/catalogue public.
 */
export interface PresetConditions {
  pfLine: string;
  trafficLine: string;
  risqueLine: string;
  famille: string | null;
  layerLines: string[];
  interfaceLines: Array<string | null>;
  detail: string;
}

/**
 * Construit les conditions affichables d'un cas de validation — EXPORTÉ pour
 * tests DoD §9. `output` = `CalcResult.output` déjà normalisé (rows/details
 * whitelistés, DoD §8) ; `null`/absent → famille et risque affichés en attente.
 */
export function buildPresetConditions(
  preset: RoadsensPreset,
  layersNext: Layer[],
  pfNext: PF,
  output: unknown,
): PresetConditions {
  const o =
    output != null && typeof output === 'object'
      ? (output as { rows?: unknown; details?: unknown })
      : null;
  const rows = Array.isArray(o?.rows) ? (o!.rows as CalcOutputRow[]) : [];
  const details = Array.isArray(o?.details) ? (o!.details as CalcOutputRow[]) : [];

  const familleRow = findOutputRow(rows, 'Famille de structure');
  const famille =
    typeof familleRow?.value === 'string' && familleRow.value.length > 0
      ? familleRow.value
      : null;

  const risqueRow = findOutputRow(details, 'Risque effectif');
  const risqueNum = rowNumber(risqueRow);
  const risqueLine =
    risqueNum !== null ? `${fmtNum(risqueNum, 2)} % (auto, Tableau 70)` : '—';

  const nuStr = String(pfNext.nu).replace('.', ',');
  const pfLine = `${preset.pfCls} — E = ${pfNext.E} MPa, ν = ${nuStr}`;
  const trafficLine = `${presetTrafficClass(preset.ne)} — NE = ${formatNeExponent(preset.ne)} essieux équivalents`;

  const layerLines = layersNext.map(
    (l) => `${matShortLabel(l.mat)} — ${Math.round(l.h * 100)} cm · E = ${l.E} MPa`,
  );
  const interfaceLines = layersNext.map((l, i) =>
    i < layersNext.length - 1 ? autoIfaceLabel(l.mat, layersNext[i + 1].mat) : null,
  );

  return {
    pfLine,
    trafficLine,
    risqueLine,
    famille,
    layerLines,
    interfaceLines,
    detail: preset.desc,
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

/** Toutes les lignes dont le label commence par `prefix` (détail par couche). */
function findAllOutputRows(rows: CalcOutputRow[], prefix: string): CalcOutputRow[] {
  return rows.filter((r) => r.label.startsWith(prefix));
}

/** Formate la valeur d'une ligne de résultat (nombre FR ou texte tel quel).
 * Décimales FIXES comme le formatteur `f(v,n)` de la définitive (toFixed —
 * « 43,00 », jamais « 43 »), en locale FR (convention de la page). `scale` =
 * facteur d'affichage (ex. 100 pour rendre en cm une épaisseur émise en m par
 * l'adaptateur — la définitive édite `f(d.H_tot*100,2)`) ; ignoré pour une
 * valeur texte. EXPORTÉ pour tests DoD §9. */
export function reportRowValue(
  row: CalcOutputRow | undefined,
  decimals = 2,
  scale = 1,
): string {
  if (!row) return '—';
  if (typeof row.value !== 'number') return String(row.value);
  if (!isFinite(row.value)) return '—';
  return (row.value * scale).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Garde de l'onglet Détails : la définitive n'édite JAMAIS de rapport pour un
 * calcul en échec — un statut ≠ DONE affiche le message d'échec, pas les 9
 * sections (sinon rapport « NON CONFORME » factice à zéros). EXPORTÉ pour tests. */
export function tabDetailsMode(
  result: { status: CalcResult['status'] } | null,
): 'placeholder' | 'error' | 'report' {
  if (!result) return 'placeholder';
  return result.status === 'DONE' ? 'report' : 'error';
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

/**
 * Message d'erreur affiché depuis une réponse d'API de calcul en échec — factorisé
 * entre `handleCalculer` et `handleApplyPreset` (même mapping de raisons).
 */
function deriveCalcErrorMessage(err: unknown): string {
  const apiErr = err as { reason?: string; message?: string };
  return apiErr?.reason === 'EXPIRED'
    ? 'Abonnement expiré — calcul impossible.'
    : apiErr?.reason === 'QUOTA'
      ? 'Quota de calculs épuisé.'
      : apiErr?.reason === 'MODULE_NOT_IN_PACK'
        ? "Le moteur ROADSENS (burmister) n'est pas inclus dans votre abonnement."
        : (apiErr?.message ?? 'Erreur lors du calcul. Réessayez.');
}

// ---------------------------------------------------------------------------
// Composant principal — page ROADSENS
// ---------------------------------------------------------------------------

let _nextLayerId = 4;

const DEFAULT_LAYERS: Layer[] = [
  { id: 1, mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45, iface: 'auto' },
  { id: 2, mat: 'GB3', h: 0.1, E: 2588, nu: 0.45, iface: 'auto' },
  { id: 3, mat: 'GL1', h: 0.25, E: 200, nu: 0.35, iface: 'auto' },
];
const DEFAULT_PF: PF = { cls: 'PF2', E: 50, nu: 0.35 };
// Trafic a 0 par defaut (revue adverse) : force la saisie du trafic projet avant tout
// resultat/PV. La structure (DEFAULT_LAYERS) reste un gabarit de conception a modifier.
const DEFAULT_TRAFFIC: Traffic = { T: 0, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
// Défauts = version définitive du HTML client (gntAutoChk coché, ifaceAuto actif
// par défaut — #87 étapes 1/2 et 2/2).
const DEFAULT_LOAD: Load = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  rCustom: '',
  sh: 'auto',
  ks: 'auto',
  gntAuto: true,
  ifaceAuto: true,
  neDirect: false,
  neDirectValue: 3e7,
  fatigueOverrides: {},
};

const TABS: Array<{ id: TabId; label: string; Icon: typeof Layers }> = [
  { id: 'structure', label: 'Structure', Icon: Layers },
  { id: 'trafic', label: 'Trafic', Icon: Truck },
  { id: 'parametres', label: 'Paramètres', Icon: SlidersHorizontal },
  { id: 'catalogue', label: 'Catalogue', Icon: BookOpen },
  { id: 'resultats', label: 'Résultats', Icon: BarChart3 },
  { id: 'details', label: 'Détails calcul', Icon: Microscope },
];

/** Styles de badge matériau (nature). */
const NATURE_STYLE: Record<LayerNature, { bg: string; color: string; label: string }> = {
  bitumineux: { bg: '#e6eaef', color: '#33414f', label: 'Bitumineux' },
  granulaire: { bg: '#fbf1e8', color: '#bd6a30', label: 'Granulaire' },
  mtlh: { bg: '#f7edd9', color: '#92600a', label: 'MTLH' },
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

  // ── Cas de validation du catalogue (presets, #93/#GAP1) ──────────────────
  const [presetId, setPresetId] = useState('');
  const [presetConditions, setPresetConditions] = useState<PresetConditions | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);

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
      { id: _nextLayerId++, mat: 'GL1', h: 0.2, E: 200, nu: 0.35, iface: 'auto' },
    ]);
  }, []);

  /** Met à jour la condition d'interface imposée d'une couche (Tab. 68, dédié : `iface` est une union stricte). */
  const updateLayerIface = useCallback((id: number, iface: LayerIface) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, iface } : l)));
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

  // Mémoïsé : l'identité de `buildPayload` change dès qu'un champ d'entrée
  // (couches, PSC, trafic, charge — dont gntAuto/ifaceAuto/iface) change ; sert
  // à la fois à construire le payload et à détecter la péremption du résultat
  // affiché (cf. useEffect d'invalidation ci-dessous).
  const buildPayload = useCallback(
    () => buildBurmisterPayload(layers, pf, traffic, load),
    [layers, pf, traffic, load],
  );

  const handleCalculer = useCallback(async () => {
    if (!orgId || !projectId) return;

    setCalculating(true);
    setCalcError(null);
    setPvResult(null);

    const payload = buildPayload();
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
      setCalcError(deriveCalcErrorMessage(err));
    } finally {
      setCalculating(false);
    }
  }, [orgId, projectId, traffic, buildPayload]);

  // --------------------------------------------------------------------------
  // Cas de validation du catalogue (presets) — fidèle à `loadPreset()` de la
  // définitive (l.608-620) : pose la structure + PSC + NE direct du cas,
  // DÉCLENCHE le calcul serveur (async, contrairement à l'original synchrone),
  // et À LA RÉCEPTION du résultat construit la note « Conditions du cas de
  // validation » (famille/risque effectif proviennent du résultat, whitelistés
  // DoD §8) puis bascule sur l'onglet Résultats.
  // --------------------------------------------------------------------------
  const handleApplyPreset = useCallback(
    async (id: string) => {
      setPresetId(id);

      if (!id) {
        setLayers(DEFAULT_LAYERS);
        setPf(DEFAULT_PF);
        setLoad((prev) => ({ ...prev, gntAuto: true, neDirect: false }));
        setPresetConditions(null);
        return;
      }

      const preset = ROADSENS_PRESETS.find((p) => p.id === id);
      if (!preset) return;

      const layersNext = buildLayersFromPreset(preset);
      const pfPreset = PF_PRESETS[preset.pfCls];
      const pfNext: PF = { cls: preset.pfCls, E: pfPreset?.E ?? pf.E, nu: 0.35 };
      // Presets : GNT auto désactivé (module explicite du cas), r/sh remis en
      // auto (fidèle à `syncPresetUI()` — pr='auto', prv='', psh='auto').
      const loadNext: Load = {
        ...load,
        gntAuto: false,
        neDirect: true,
        neDirectValue: preset.ne,
        r: 'auto',
        rCustom: '',
        sh: 'auto',
      };

      setLayers(layersNext);
      setPf(pfNext);
      setLoad(loadNext);
      setPresetConditions(null);

      // Aucun projet sélectionné : structure posée, calcul différé (bouton
      // Calculer manuel) — pas de régression si l'utilisateur n'a pas encore
      // choisi de dossier/projet.
      if (!orgId || !projectId) return;

      setPresetLoading(true);
      setCalcError(null);
      setPvResult(null);
      try {
        const payload = buildBurmisterPayload(layersNext, pfNext, traffic, loadNext);
        const label = `ROADSENS — Cas ${preset.id} (catalogue) — ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}`;
        const result = await runCalc(orgId, projectId, {
          engineId: 'burmister',
          label,
          params: payload as Record<string, unknown>,
        });
        setCalcResult(result);
        setPresetConditions(
          buildPresetConditions(preset, layersNext, pfNext, result.output),
        );
        setActiveTab('resultats');
      } catch (err: unknown) {
        setCalcError(deriveCalcErrorMessage(err));
      } finally {
        setPresetLoading(false);
      }
    },
    [orgId, projectId, load, pf, traffic],
  );

  // --------------------------------------------------------------------------
  // Bouton Émettre PV
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

  // Nouveau calcul — sort de l'impasse post-émission (audit Lot 4) : ramène
  // l'utilisateur à la saisie plutôt que de laisser affiché un PV déjà scellé
  // sans action possible.
  const handleNouveauCalcul = useCallback(() => {
    setCalcResult(null);
    setPvResult(null);
    setCalcError(null);
    setActiveTab('structure');
  }, []);

  // Invalidation (même patron que Terzaghi, §Lot 5bis) : toute saisie devenue
  // périmée invalide le résultat déjà affiché — dont gntAuto/ifaceAuto/iface
  // (#87), qui changent le calcul serveur au même titre que E/ν/h. `buildPayload`
  // change d'identité dès qu'un champ d'entrée change ; pas d'invalidation au
  // tout premier rendu (résultat déjà null).
  const firstFormRender = useRef(true);
  useEffect(() => {
    if (firstFormRender.current) {
      firstFormRender.current = false;
      return;
    }
    setCalcResult(null);
    setPvResult(null);
    setCalcError(null);
  }, [buildPayload]);

  if (!mounted) {
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement de ROADSENS" />
    );
  }

  // --------------------------------------------------------------------------
  // Rendu
  // --------------------------------------------------------------------------

  // Gating tenant AMONT (avant le 403 serveur) : module non inclus / quota épuisé /
  // abo expiré -> bandeau + bouton désactivé. Fail-closed tant que entitlements est
  // null (evaluateGate(null, …) renvoie NOT_INCLUDED).
  const gate = evaluateGate(entitlements, ENGINE_ID);

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
          background: `linear-gradient(118deg, ${RS_PANEL}, ${RS_PANEL} 52%, ${RS_BRAND_TINT})`,
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
          <Route
            width={21}
            height={21}
            color="#fff"
            strokeWidth={2}
            style={{ position: 'relative', zIndex: 1 }}
            aria-hidden="true"
          />
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
                background: RS_BRAND_TINT,
                border: '1px solid rgba(26,74,122,.22)',
                padding: '3px 10px',
                borderRadius: 999,
              }}
            >
              Burmister exact · Transfer Matrix
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
            Solution exacte multi-couche (éq. 6a–6e · J. Appl. Phys. 1945) · AGEROUTE
            Sénégal 2015 · T_éq = 34 °C · Dual wheels · Aucun Odemark
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
          disabled={calculating || !projectId || !orgId || !gate.allowed}
          aria-busy={calculating}
          aria-disabled={!projectId || !orgId || !gate.allowed}
          title={!projectId ? 'Sélectionnez un projet avant de calculer' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background:
              calculating || !projectId || !orgId || !gate.allowed
                ? '#143a61'
                : 'linear-gradient(135deg, #1a4a7a, #143a61)',
            color: '#fff',
            border: 'none',
            padding: '11px 22px',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            borderRadius: 12,
            cursor:
              calculating || !projectId || !orgId || !gate.allowed
                ? 'not-allowed'
                : 'pointer',
            boxShadow:
              calculating || !projectId || !orgId || !gate.allowed
                ? 'none'
                : '0 7px 17px -7px rgba(26,74,122,.7)',
            opacity: calculating || !projectId || !orgId || !gate.allowed ? 0.55 : 1,
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
              Calcul Burmister…
            </>
          ) : (
            <>
              <Calculator width={16} height={16} color="#fff" aria-hidden="true" />
              Calculer
            </>
          )}
        </button>
      </div>

      {/* Bandeau module non inclus / quota / abo (gating tenant amont) */}
      {!gate.allowed && (
        <div
          role="alert"
          style={{
            margin: '0 0 14px',
            padding: '10px 15px',
            background: '#fdf6e3',
            border: '1px solid #e6cf9c',
            borderLeft: '3px solid #96701a',
            borderRadius: 10,
            fontSize: 12.5,
            color: '#7a5a10',
          }}
        >
          {gate.message}
        </div>
      )}

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
          background: RS_PANEL,
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
                  (e.currentTarget as HTMLElement).style.background = RS_PANEL_2;
              }}
              onMouseOut={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <tab.Icon width={14} height={14} aria-hidden="true" />
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
          onUpdateLayerIface={updateLayerIface}
          onUpdatePf={setPf}
          onUpdateLoad={setLoad}
          presetId={presetId}
          presetConditions={presetConditions}
          presetLoading={presetLoading}
          onSelectPreset={(id) => void handleApplyPreset(id)}
        />
      </div>

      <div
        id="roadsens-panel-trafic"
        role="tabpanel"
        aria-labelledby="roadsens-tab-trafic"
        hidden={activeTab !== 'trafic'}
        style={activeTab === 'trafic' ? panelStyle : undefined}
      >
        <TabTrafic
          traffic={traffic}
          onUpdate={setTraffic}
          load={load}
          onUpdateLoad={setLoad}
        />
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
          traffic={traffic}
          pf={pf}
          load={load}
          onEmitPv={() => void handleEmitPv()}
          emittingPv={emittingPv}
          pvResult={pvResult}
          entitlements={entitlements}
          orgId={orgId}
          orgSlug={orgSlug}
          projetId={projectId}
          onNewCalcul={handleNouveauCalcul}
        />
      </div>

      <div
        id="roadsens-panel-details"
        role="tabpanel"
        aria-labelledby="roadsens-tab-details"
        hidden={activeTab !== 'details'}
        style={activeTab === 'details' ? panelStyle : undefined}
      >
        <TabDetails
          result={calcResult}
          layers={layers}
          pf={pf}
          load={load}
          traffic={traffic}
        />
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
  background: RS_PANEL,
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
    variant === 'green' ? '#e8f3e2' : variant === 'orange' ? '#fbf1e8' : RS_PANEL_2;
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

/**
 * Note « Conditions du cas de validation » — équivalent de `#presetNote` /
 * `buildPresetNote()` de la définitive. `conditions` est `null` tant que le
 * résultat serveur n'est pas revenu (aucun projet sélectionné, ou calcul en
 * cours) : affiche alors le critère/référence catalogue seuls (comme avant
 * calcul), sans famille/risque (whitelistés depuis le résultat, DoD §8).
 */
function PresetConditionsNote({
  preset,
  conditions,
}: {
  preset: RoadsensPreset;
  conditions: PresetConditions | null;
}) {
  if (!conditions) {
    return (
      <Note>
        {preset.crit} — {preset.desc}
      </Note>
    );
  }
  const rowStyle: React.CSSProperties = {
    padding: '2px 9px 2px 0',
    verticalAlign: 'top',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  };
  const valStyle: React.CSSProperties = { padding: '2px 0', verticalAlign: 'top' };
  return (
    <Note>
      <div style={{ fontWeight: 700, color: '#1a4a7a', marginBottom: 5 }}>
        Conditions du cas de validation
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
        <tbody>
          <tr>
            <td style={rowStyle}>Plateforme support</td>
            <td style={valStyle}>{conditions.pfLine}</td>
          </tr>
          <tr>
            <td style={rowStyle}>Classe de trafic</td>
            <td style={valStyle}>{conditions.trafficLine}</td>
          </tr>
          <tr>
            <td style={rowStyle}>Risque de calcul</td>
            <td style={valStyle}>{conditions.risqueLine}</td>
          </tr>
          <tr>
            <td style={rowStyle}>Famille (LCPC 1994)</td>
            <td style={valStyle}>{conditions.famille ?? '—'}</td>
          </tr>
          <tr>
            <td style={rowStyle}>Structure (surface → support)</td>
            <td style={valStyle}>
              {conditions.layerLines.map((line, i) => (
                <div key={i}>
                  <div>{line}</div>
                  {conditions.interfaceLines[i] != null && (
                    <div
                      style={{ color: '#c1622b', fontSize: 10, margin: '1px 0 3px 12px' }}
                    >
                      ⇲ interface {conditions.interfaceLines[i]}
                    </div>
                  )}
                </div>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
        {conditions.detail}
      </div>
    </Note>
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
  background: RS_FIELD,
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
  onUpdateLayerIface: (id: number, iface: LayerIface) => void;
  onUpdatePf: (pf: PF) => void;
  onUpdateLoad: (load: Load) => void;
  presetId: string;
  presetConditions: PresetConditions | null;
  presetLoading: boolean;
  onSelectPreset: (id: string) => void;
}

function TabStructure({
  layers,
  pf,
  load,
  onAddLayer,
  onRemoveLayer,
  onMoveLayer,
  onUpdateLayer,
  onUpdateLayerIface,
  onUpdatePf,
  onUpdateLoad,
  presetId,
  presetConditions,
  presetLoading,
  onSelectPreset,
}: TabStructureProps) {
  const matOptions = Object.entries(MATERIALS);
  const gntAutoId = useId();
  const selectedPreset = presetId
    ? ROADSENS_PRESETS.find((p) => p.id === presetId)
    : undefined;

  return (
    <div>
      {/* ── Cas de validation du catalogue (presets) ── */}
      <SectionTitle>Cas de validation du catalogue</SectionTitle>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <select
          value={presetId}
          aria-label="Charger une famille de structure validée"
          onChange={(e) => onSelectPreset(e.target.value)}
          disabled={presetLoading}
          style={{ ...inputStyle, flex: '1 1 320px', minWidth: 280 }}
        >
          <option value="">— Charger une famille de structure validée —</option>
          {ROADSENS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSelectPreset('')}
          disabled={presetLoading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 13px',
            borderRadius: 9,
            cursor: presetLoading ? 'default' : 'pointer',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            background: RS_FIELD,
            border: '1px solid var(--border-subtle)',
            fontFamily: 'inherit',
            opacity: presetLoading ? 0.6 : 1,
          }}
        >
          Réinitialiser
        </button>
      </div>
      {presetLoading && <Note>Calcul du cas de validation en cours…</Note>}
      {!presetLoading && selectedPreset && (
        <PresetConditionsNote preset={selectedPreset} conditions={presetConditions} />
      )}

      {/* ── Table couches ── */}
      <SectionTitle>Couches — surface → fond</SectionTitle>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 12.5,
            background: RS_FIELD,
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
                    background: RS_PANEL_2,
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
                <Fragment key={l.id}>
                  <tr
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

                  {/* ⇲ interface — Tab. 68 AGEROUTE, override par couche (#87 étape 2/2) */}
                  {i < layers.length - 1 && (
                    <tr>
                      <td></td>
                      <td
                        colSpan={6}
                        style={{
                          padding: '3px 11px 6px',
                          borderTop: '1px dashed var(--border-subtle)',
                          borderBottom:
                            i < layers.length - 2
                              ? '1px solid var(--border-subtle)'
                              : 'none',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 10.5,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <span style={{ letterSpacing: '0.3px' }}>
                            {`⇲ interface C${i + 1} / C${i + 2}`}
                          </span>
                          <select
                            value={l.iface}
                            aria-label={`Condition d'interface couche ${i + 1} / couche ${i + 2}`}
                            onChange={(e) =>
                              onUpdateLayerIface(l.id, e.target.value as LayerIface)
                            }
                            style={{
                              fontSize: 10.5,
                              padding: '1px 4px',
                              borderRadius: 6,
                              border: '1px solid var(--border-default)',
                              background: RS_FIELD,
                              color: 'var(--text-primary)',
                              fontFamily: 'inherit',
                            }}
                          >
                            <option value="auto">
                              {`Auto · ${autoIfaceLabel(l.mat, layers[i + 1]?.mat ?? null)}`}
                            </option>
                            <option value="collée">Collée</option>
                            <option value="semi-collée">Semi-collée</option>
                            <option value="glissante">Glissante</option>
                          </select>
                          {l.iface !== 'auto' && (
                            <span
                              style={{ color: '#bd6a30', fontWeight: 700, fontSize: 9.5 }}
                            >
                              IMPOSÉE
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
            background: RS_BRAND_TINT,
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

      {/* Module GNT automatique — fiche catalogue p.79 (#87 étape 1/2), défaut ON (définitive) */}
      <div
        style={{
          marginTop: 9,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 7,
          fontSize: 11,
        }}
      >
        <input
          type="checkbox"
          id={gntAutoId}
          checked={load.gntAuto}
          onChange={(e) => onUpdateLoad({ ...load, gntAuto: e.target.checked })}
          style={{ width: 14, height: 14, marginTop: 1 }}
        />
        <label
          htmlFor={gntAutoId}
          style={{ color: 'var(--text-primary)', cursor: 'pointer', lineHeight: 1.4 }}
        >
          Module GNT automatique{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            (catalogue p.79 : 3×E sous-jacent · plafond 360 GNT/GB · 600 GNT/GNT · base
            600 · ν=0,35)
          </span>
        </label>
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
  background: RS_PANEL,
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
  load,
  onUpdateLoad,
}: {
  traffic: Traffic;
  onUpdate: (t: Traffic) => void;
  load: Load;
  onUpdateLoad: (load: Load) => void;
}) {
  const ne = effectiveNE(traffic, load);
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
        structure ; plages basses/hautes citées au chapitre « classe de trafic NE »). Le
        catalogue ne fixe pas de CAM par défaut : sa valeur résulte du pesage des poids
        lourds et est fortement sensible aux surcharges. Si une campagne de pesage est
        disponible, calculez le CAM réel et saisissez-le directement — la case reste
        librement modifiable.
      </Note>

      <SectionTitle>NE cumulé — saisie directe</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={load.neDirect}
            aria-label="Imposer le NE cumulé directement"
            onChange={(e) => onUpdateLoad({ ...load, neDirect: e.target.checked })}
          />
          Imposer le NE cumulé (essieux équivalents), sans passer par le TMJA
        </label>
        {load.neDirect && (
          <input
            type="number"
            value={load.neDirectValue}
            min={1}
            step={1e5}
            aria-label="NE cumulé imposé (essieux équivalents)"
            onChange={(e) =>
              onUpdateLoad({ ...load, neDirectValue: parseFloat(e.target.value) || 0 })
            }
            style={{ ...inputStyle, width: 160 }}
          />
        )}
      </div>
      <Note>
        Court-circuite le calcul TMJA × CAM × croissance × durée ci-dessus : le NE imposé
        est envoyé directement au moteur (fail-closed si valeur invalide/nulle — retombe
        sur l&apos;estimation TMJA).
      </Note>

      {/* Résumé trafic — ESTIMATION à la saisie (aperçu). La valeur qui fait foi est le
          NE recalculé SERVEUR, affiché dans les résultats après « Calculer » (revue adverse :
          ne pas juxtaposer deux NE calculés indépendamment comme s'ils étaient équivalents). */}
      <SectionTitle>Résumé — estimation à la saisie</SectionTitle>
      <Note>
        Estimation indicative à partir du trafic saisi (formule AGEROUTE publique). Le NE
        qui fait foi est celui recalculé côté serveur, dans les résultats.
      </Note>
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
// Tables de lois de fatigue — éditables (#93 sous-port 3d, fidèle à la
// définitive : `onchange="M['${k}'].e6=+this.value"`). Valeurs PUBLIQUES du
// catalogue AGEROUTE (pas un coefficient de calage, DoD §8) ; kr/ks/Sh restent
// calculés côté serveur.
// ---------------------------------------------------------------------------

const fatigueThStyle: React.CSSProperties = {
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

const fatigueTdStyle: React.CSSProperties = {
  padding: '8px 11px',
  borderBottom: '1px solid var(--border-subtle)',
};

const fatigueInputStyle: React.CSSProperties = {
  ...inputStyle,
  width: 65,
  textAlign: 'right',
};

/**
 * Table « Lois de fatigue — bitumineux » — ε₆ éditable par matériau (#93 sous-port
 * 3d). `overrides`/`onChange` portent uniquement l'ÉCART au catalogue ; bornes =
 * celles du contrat moteur (50-300 µdef).
 */
function FatigueBitTable({
  overrides,
  onChange,
}: {
  overrides: Record<string, { e6?: number; s6?: number }>;
  onChange: (mat: string, e6: number | undefined) => void;
}) {
  const entries = Object.entries(FATIGUE_BIT);
  return (
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
        aria-label="Lois de fatigue — matériaux bitumineux (éditable)"
      >
        <thead>
          <tr>
            {['Matériau', 'ε₆ (µdef)', 'b', 'Kc', 'Source'].map((th) => (
              <th key={th} style={fatigueThStyle}>
                {th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, v]) => {
            const value = overrides[key]?.e6 ?? v.e6;
            return (
              <tr key={key}>
                <td style={fatigueTdStyle}>{v.label}</td>
                <td style={fatigueTdStyle}>
                  <input
                    type="number"
                    value={value}
                    min={50}
                    max={300}
                    step={5}
                    aria-label={`ε₆ ${v.label} (µdef)`}
                    style={fatigueInputStyle}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      onChange(key, Number.isFinite(n) ? n : undefined);
                    }}
                  />
                </td>
                <td style={fatigueTdStyle}>{v.b}</td>
                <td style={fatigueTdStyle}>{v.kc}</td>
                <td
                  style={{
                    ...fatigueTdStyle,
                    fontSize: 10.5,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {v.source}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Table « Lois de fatigue — MTLH » — σ₆ éditable par matériau (#93 sous-port 3d).
 * Bornes = celles du contrat moteur (0,05-5,0 MPa).
 */
function FatigueMtlhTable({
  overrides,
  onChange,
}: {
  overrides: Record<string, { e6?: number; s6?: number }>;
  onChange: (mat: string, s6: number | undefined) => void;
}) {
  const entries = Object.entries(FATIGUE_MTLH);
  return (
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
        aria-label="Lois de fatigue — matériaux MTLH (éditable)"
      >
        <thead>
          <tr>
            {['Matériau', 'σ₆ (MPa)', 'b', 'Kc', 'Source'].map((th) => (
              <th key={th} style={fatigueThStyle}>
                {th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, v]) => {
            const value = overrides[key]?.s6 ?? v.s6;
            return (
              <tr key={key}>
                <td style={fatigueTdStyle}>{v.label}</td>
                <td style={fatigueTdStyle}>
                  <input
                    type="number"
                    value={value}
                    min={0.05}
                    max={5.0}
                    step={0.01}
                    aria-label={`σ₆ ${v.label} (MPa)`}
                    style={fatigueInputStyle}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      onChange(key, Number.isFinite(n) ? n : undefined);
                    }}
                  />
                </td>
                <td style={fatigueTdStyle}>{`1/${v.b}`}</td>
                <td style={fatigueTdStyle}>{v.kc}</td>
                <td
                  style={{
                    ...fatigueTdStyle,
                    fontSize: 10.5,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {v.source}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <div style={{ display: 'flex', gap: 10, maxWidth: 400, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <FieldWrap label="Risque r (%)">
            <select
              value={load.r}
              aria-label="Niveau de risque"
              onChange={(e) => onUpdate({ ...load, r: e.target.value })}
              style={inputStyle}
            >
              <option value="auto">
                Auto — Tab. 70 (25 % si NE &lt; 3M, 5 % au-delà)
              </option>
              <option value="5">r = 5 %</option>
              <option value="10">r = 10 %</option>
              <option value="15">r = 15 %</option>
              <option value="25">r = 25 %</option>
              <option value="50">r = 50 %</option>
              <option value="custom">Personnalisé…</option>
            </select>
          </FieldWrap>
        </div>
        {load.r === 'custom' && (
          <div style={{ flex: '0 0 100px' }}>
            <FieldWrap label="r (%)">
              <input
                type="number"
                value={load.rCustom}
                min={1}
                max={50}
                step={0.5}
                placeholder="r %"
                aria-label="Risque personnalisé (%)"
                onChange={(e) => onUpdate({ ...load, rCustom: e.target.value })}
                style={inputStyle}
              />
            </FieldWrap>
          </div>
        )}
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
      <FatigueBitTable
        overrides={load.fatigueOverrides}
        onChange={(mat, e6) =>
          onUpdate({
            ...load,
            fatigueOverrides: {
              ...load.fatigueOverrides,
              [mat]: { ...load.fatigueOverrides[mat], e6 },
            },
          })
        }
      />

      <SectionTitle>Lois de fatigue — MTLH</SectionTitle>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: '0.4rem',
        }}
      >
        σ_t_adm = σ₆ · (NE/10⁶)<sup>b</sup> · kr · kc · ks [MPa] — LCPC 1994
      </div>
      <FatigueMtlhTable
        overrides={load.fatigueOverrides}
        onChange={(mat, s6) =>
          onUpdate({
            ...load,
            fatigueOverrides: {
              ...load.fatigueOverrides,
              [mat]: { ...load.fatigueOverrides[mat], s6 },
            },
          })
        }
      />
      <Note>
        Lois de fatigue éditables (valeurs publiques du catalogue AGEROUTE 2015, comme
        dans la référence) : ε₆/σ₆ modifiés ici sont transmis au moteur et remplacent le
        défaut catalogue pour le matériau dimensionnant. kr, ks et Sh (dépendants du
        risque et du support) restent calculés côté serveur (DoD §8). Le résultat de
        vérification (ε_t/ε_t,adm) est affiché dans l&apos;onglet Résultats après calcul.
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
        {Array.from(
          new Set(
            [family.m.top, family.m.mid, family.m.body, family.m.tail].filter(
              (x): x is string => Boolean(x),
            ),
          ),
        ).map((mk, i) => {
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
                            const mk = catalogueMaterialAt(
                              family.m,
                              idx,
                              thicknesses.length,
                            );
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
  traffic: Traffic;
  pf: PF;
  load: Load;
  onEmitPv: () => void;
  emittingPv: boolean;
  pvResult: OfficialPv | null;
  entitlements: EntitlementsResponse | null;
  orgId: string | null;
  orgSlug: string;
  projetId: string;
  onNewCalcul: () => void;
}

function TabResultats({
  result,
  ne,
  traffic,
  pf,
  load,
  onEmitPv,
  emittingPv,
  pvResult,
  entitlements,
  orgId,
  orgSlug,
  projetId,
  onNewCalcul,
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
              {`NE = ${classeNE} · Ti = ${tmjaClass(traffic.T)} · PSC ${pf.cls} (${pf.E} MPa) · Dual wheels d=${load.d} m`}
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
          formule={
            kpis?.fatigueRigide
              ? 'σ_t_adm = σ₆ · (NE/10⁶)^b · kr · kc · ks · kd (LCPC 1994)'
              : 'ε_t_adm = ε₆ · kθ · (NE/10⁶)^b · kr · kc · ks (LCPC 1994)'
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
          formule="ε_z_adm = 0,016 (ou 0,012) × NE^(−1/4,5)"
          unite="µdef"
          valeur={kpis?.ornieValeur}
          admissible={kpis?.ornieAdmissible}
          ok={kpis?.ornieOk ?? null}
          famille={null}
          testId="critere-ornierage"
        />
      </div>

      <Note variant="green">
        <strong>
          Moteur ROADSENS — Burmister exact multi-couche (1945), méthode de la matrice de
          transfert (Transfer Matrix / Propagateur) généralisée à n couches :
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
          <div style={{ marginTop: 12 }}>
            <PvEmittedActions
              pv={pvResult}
              orgId={orgId}
              orgSlug={orgSlug}
              projetId={projetId}
              accent="#1a4a7a"
              onNewCalcul={onNewCalcul}
            />
          </div>
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
                Émettre le PV scellé
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
  formule: string;
  unite: string;
  valeur: number | null | undefined;
  admissible: number | null | undefined;
  ok: 'ok' | 'fail' | null;
  famille: string | null | undefined;
  testId: string;
}

function CritereCard({
  label,
  formule,
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
  const pct = ratio != null ? Math.round(ratio * 100) : null;

  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        background: 'var(--surface-base)',
        border: `1px solid ${isFail ? '#fca5a5' : isOk ? '#86efac' : 'var(--border-subtle)'}`,
        borderLeft: `3px solid ${isFail ? '#dc2626' : isOk ? '#16a34a' : 'var(--border-subtle)'}`,
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
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

        {/* Libellé + formule + famille */}
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
            {label}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--text-secondary)',
              marginTop: 2,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {formule}
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
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              sollicitante
            </div>
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

      {/* Barre de progression — % de l'admissible */}
      {pct != null && (
        <div>
          <div
            style={{
              height: 7,
              borderRadius: 4,
              background: 'var(--surface-canvas)',
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
            }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 4,
                width: `${Math.min(pct, 100)}%`,
                background: isFail ? '#dc2626' : '#16a34a',
                transition: 'width .5s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
            {`${pct} % de la valeur admissible`}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bandeau titre de section numérotée (fidèle à `sec()` de `renderDetails()` définitive). */
function DetailSectionBanner({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td
        colSpan={3}
        style={{
          padding: '7px 10px 3px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: '#fff',
          background: '#1a4a7a',
        }}
      >
        {children}
      </td>
    </tr>
  );
}

/** Bandeau formule encadrée (fidèle à `fml()` de `renderDetails()` définitive). */
function DetailFormula({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td
        colSpan={3}
        style={{
          padding: '3px 12px 5px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10.5,
          background: '#f0f0f8',
          color: '#333',
          borderBottom: '.5px solid #ddd',
        }}
      >
        {children}
      </td>
    </tr>
  );
}

/** Ligne du rapport détaillé (label / valeur / commentaire) — fidèle à `row()`. */
function DetailRow({
  label,
  value,
  unit,
  comment,
  status,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  comment?: React.ReactNode;
  status?: 'ok' | 'fail';
}) {
  return (
    <tr>
      <td
        style={{
          padding: '5px 10px',
          fontSize: 11,
          color: '#444',
          width: '38%',
          borderBottom: '.5px solid #eee',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '5px 10px',
          fontSize: 11.5,
          fontWeight: 600,
          fontFamily: 'var(--font-mono, monospace)',
          color: status === 'fail' ? '#c04000' : status === 'ok' ? '#2d6a11' : '#1a4a7a',
          borderBottom: '.5px solid #eee',
        }}
      >
        {value}
        {unit ? (
          <span style={{ fontWeight: 400, fontSize: 10, color: '#888', marginLeft: 4 }}>
            {unit}
          </span>
        ) : null}
      </td>
      <td
        style={{
          padding: '5px 10px',
          fontSize: 10,
          color: '#888',
          fontStyle: 'italic',
          borderBottom: '.5px solid #eee',
        }}
      >
        {comment ?? ''}
      </td>
    </tr>
  );
}

/** Ligne « non exposé » — grandeur intermédiaire connue de la définitive mais PAS
 * whitelistée côté client (DoD §8). N'INVENTE jamais de valeur : l'affiche
 * explicitement comme absente + le motif (par défaut : coefficient de calage
 * propriétaire ; `reason` pour un motif honnête différent, ex. intermédiaire
 * simplement non whitelisté). */
function NotExposedRow({
  label,
  symbols,
  reason,
}: {
  label: React.ReactNode;
  symbols: string;
  reason?: string;
}) {
  return (
    <DetailRow
      label={label}
      value={
        <span style={{ color: '#999', fontWeight: 400 }}>non exposé côté client</span>
      }
      comment={
        reason ??
        `Coefficient de calage propriétaire (${symbols}) — reste côté serveur, DoD §8`
      }
    />
  );
}

interface TabDetailsProps {
  result: CalcResult | null;
  layers: Layer[];
  pf: PF;
  load: Load;
  traffic: Traffic;
}

function TabDetails({ result, layers, pf, load, traffic }: TabDetailsProps) {
  if (tabDetailsMode(result) === 'placeholder' || !result) {
    return (
      <PlaceholderPane
        icon="microscope"
        title="Détails de calcul"
        description="Cliquez sur Calculer pour afficher les détails."
      />
    );
  }

  // Calcul non abouti (ERROR/PENDING) : jamais de rapport 9 sections — la
  // définitive n'édite pas de rapport en erreur (sinon « NON CONFORME » factice).
  if (tabDetailsMode(result) === 'error') {
    const isError = result.status === 'ERROR';
    return (
      <div
        role="status"
        data-testid="details-error"
        style={{
          padding: '14px 18px',
          borderRadius: 14,
          background: isError ? '#fef2f2' : 'var(--surface-canvas)',
          border: `1px solid ${isError ? '#fca5a5' : 'var(--border-subtle)'}`,
          borderLeft: `4px solid ${isError ? '#dc2626' : 'var(--border-subtle)'}`,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: isError ? '#991b1b' : 'var(--text-primary)',
          }}
        >
          {isError ? 'Erreur moteur — calcul non abouti' : 'Calcul en attente'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
          {isError
            ? 'Aucun rapport détaillé n’est disponible pour un calcul en échec. Corrigez les entrées (onglet Résultats) puis relancez le calcul.'
            : 'Le rapport détaillé sera disponible une fois le calcul terminé.'}
        </div>
      </div>
    );
  }

  const output = result.output as NormalizedCalcOutput | null;
  const rows = Array.isArray(output?.rows) ? (output!.rows as CalcOutputRow[]) : [];
  const details = Array.isArray(output?.details)
    ? (output!.details as CalcOutputRow[])
    : [];
  const verdict = output?.verdict ?? 'NA';

  // ── Section 1 — Données d'entrée (saisie, publique) ──────────────────────
  const risk = resolveRisk(load);
  const riskLabel = risk === 'auto' ? 'auto — Tableau 70' : String(risk);

  // ── Section 2 — Trafic NE ──────────────────────────────────────────────────
  const neRow = findOutputRow(rows, 'Trafic cumulé (NE)');
  const neVal = rowNumber(neRow);
  const Ccum = computeCcum(traffic);
  const ezAdmRow = findOutputRow(rows, 'Déformation ε_z admissible');

  // ── Section 3 — Structure des couches ───────────────────────────────────
  const hLieRow = findOutputRow(rows, 'Épaisseur de couches liées');
  const hTotalRow = findOutputRow(rows, 'Épaisseur totale');
  const hTotalNum = rowNumber(hTotalRow);
  const E1PondRow = findOutputRow(details, 'Module pondéré du paquet lié');
  const nu1PondRow = findOutputRow(details, 'Coefficient de Poisson pondéré');

  // ── Section 4 — Matrice de transfert ────────────────────────────────────
  const mMax =
    hTotalNum != null && hTotalNum > 0 ? 100 / Math.max(hTotalNum, load.a) : null;
  // Paquet lié (couches liées contiguës depuis la surface) — même inférence de
  // saisie que l'annotation « paquet lié » de la section 3 (le d.be serveur
  // n'est pas une sortie whitelistée ; indication avant calcul).
  let beCount = 0;
  for (const l of layers) {
    if (MATERIALS[l.mat]?.nature === 'granulaire') break;
    beCount++;
  }

  // ── Section 5 — Contraintes à l'interface critique ──────────────────────
  const sigZ0 = findOutputRow(details, 'σ_z interface critique (r=0)');
  const sigR0 = findOutputRow(details, 'σ_r interface critique (r=0)');
  const sigZd2 = findOutputRow(details, 'σ_z entre roues (r=d/2');
  const sigRd2 = findOutputRow(details, 'σ_r entre roues (r=d/2');

  // ── Section 6 — Déformation εt / Fatigue ────────────────────────────────
  const etR0 = findOutputRow(details, 'ε_t sous roue (r=0)');
  const etD2 = findOutputRow(details, 'ε_t entre roues (r=d/2)');
  const fatigueRow =
    findOutputRow(rows, 'Déformation sollicitante ε_t') ??
    findOutputRow(rows, 'Contrainte sollicitante σ_t');
  const fatigueAdmRow =
    findOutputRow(rows, 'Déformation admissible ε_t,adm') ??
    findOutputRow(rows, 'Contrainte admissible σ_t,adm');
  const familleRow = findOutputRow(rows, 'Famille de structure');
  // ε₆/σ₆ du matériau dimensionnant — grandeur publique du catalogue AGEROUTE,
  // émise par l'adaptateur depuis fatigue.referenceCatalogue (absente sur un
  // ancien calcul persisté → « — »). Définitive : ligne « Matériau dimensionnant ».
  const refCatRow = findOutputRow(rows, 'Référence catalogue');
  // Point critique retenu (définitive : « critique: r=0 » / « critique: r=d/2 »).
  const etR0Num = rowNumber(etR0);
  const etD2Num = rowNumber(etD2);
  const etCritique =
    etR0Num != null && etD2Num != null
      ? etR0Num >= etD2Num
        ? 'critique : r=0'
        : 'critique : r=d/2'
      : undefined;
  const couchesTraitees = findAllOutputRows(details, 'σ_t couche traitée');
  const couchesTraiteesAdm = findAllOutputRows(details, 'σ_t admissible couche');
  const phase2Row = findAllOutputRows(rows, 'Fatigue phase 2');
  const inverseRow = findAllOutputRows(rows, 'Structure inverse');

  // ── Section 7 — Déformation admissible ──────────────────────────────────
  const risqueEffRow = findOutputRow(details, 'Risque effectif');
  const risqueEffNum = rowNumber(risqueEffRow);
  const uR = risqueEffNum != null ? uRisk(risqueEffNum) : null;
  const etAdmRow = findOutputRow(details, 'ε_t admissible');

  // ── Section 8 — Déformation εz / Orniérage ──────────────────────────────
  const ezAxe = findOutputRow(details, 'ε_z axe de roue');
  const ezMid = findOutputRow(details, 'ε_z entre-jumelage');
  const ezCouchesGranulaires = findAllOutputRows(details, 'ε_z sommet couche granulaire');
  const ornieRow = findOutputRow(rows, 'Déformation ε_z sollicitante (PSC)');
  const ornieAdmRow = findOutputRow(rows, 'Déformation ε_z admissible');

  // ── Section 9 — Synthèse ─────────────────────────────────────────────────
  const fatigueVal = rowNumber(fatigueRow);
  const fatigueAdmVal = rowNumber(fatigueAdmRow);
  const fatigueRatio =
    fatigueVal != null && fatigueAdmVal != null && fatigueAdmVal > 0
      ? fatigueVal / fatigueAdmVal
      : null;
  const ornieVal = rowNumber(ornieRow);
  const ornieAdmVal = rowNumber(ornieAdmRow);
  const ornieRatio =
    ornieVal != null && ornieAdmVal != null && ornieAdmVal > 0
      ? ornieVal / ornieAdmVal
      : null;

  return (
    <div data-testid="tab-details">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '2px solid #1a4a7a',
          paddingBottom: 8,
          marginBottom: 10,
        }}
      >
        <div>
          <strong style={{ color: '#1a4a7a' }}>ROADSENS — Rapport détaillé</strong>
          <span style={{ fontSize: 10, color: '#888', marginLeft: 8 }}>
            Burmister Transfer Matrix (n couches exactes) · AGEROUTE Sénégal 2015
          </span>
        </div>
        <strong
          style={{
            color:
              verdict === 'PASS' ? '#2d6a11' : verdict === 'FAIL' ? '#c04000' : '#888',
          }}
        >
          {verdict === 'PASS'
            ? '✓ CONFORME'
            : verdict === 'FAIL'
              ? '✗ NON CONFORME'
              : '— sans verdict'}
        </strong>
      </div>

      {/* ── Coupe transversale (structure d'entrée, connue côté front) ── */}
      <div
        style={{
          margin: '0 0 14px',
          padding: '11px 13px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          background: 'var(--surface-base)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: '#1a4a7a',
            marginBottom: 7,
          }}
        >
          Coupe transversale de la structure
        </div>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <CrossSection layers={layers} pf={pf} load={load} />
        </div>
      </div>

      <Note>
        Résultats de la méthode Transfer Matrix (Burmister exact, n couches). Les
        intermédiaires de la méthode (contraintes σ, déformations ε, modules pondérés,
        référence catalogue ε₆/σ₆) sont exposés ci-dessous ; seuls les coefficients de
        calage propriétaires (b, kc, kr, ks, SN, Sh, kθ) restent côté serveur (DoD §8).
      </Note>

      {/* ── Rapport structuré — 9 sections numérotées (fidèle à renderDetails()) ── */}
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
            border: '1px solid #ddd',
          }}
          aria-label="Rapport détaillé ROADSENS — sections numérotées"
        >
          <tbody>
            <DetailSectionBanner>1. Données d&#39;entrée</DetailSectionBanner>
            <DetailRow
              label="Pression p0"
              value={fmtNum(load.p, 3)}
              unit="MPa"
              comment="Essieu 130 kN"
            />
            <DetailRow label="Rayon a" value={fmtNum(load.a * 100, 1)} unit="cm" />
            <DetailRow label="Entre-axe d" value={fmtNum(load.d * 100, 0)} unit="cm" />
            {/* Définitive : valeur = risque EFFECTIF numérique (_rE), « auto — Tableau 70 » en commentaire */}
            <DetailRow
              label="Risque r"
              value={risqueEffNum != null ? fmtNum(risqueEffNum, 2) : riskLabel}
              unit={risqueEffNum != null || risk !== 'auto' ? '%' : undefined}
              comment={risk === 'auto' ? 'auto — Tableau 70' : undefined}
            />
            <DetailRow
              label={`Plateforme ${pf.cls}`}
              value={fmtNum(pf.E, 0)}
              unit="MPa"
              comment={`ν=${pf.nu}`}
            />

            <DetailSectionBanner>2. Trafic NE</DetailSectionBanner>
            <DetailFormula>
              NE = 365 × TMJA × C × CAM × f_dir × f_tv &nbsp; avec &nbsp; C = [(1+τ)ⁿ - 1]
              / τ
            </DetailFormula>
            <DetailRow label="TMJA" value={fmtNum(traffic.T, 0)} unit="PL/j/sens" />
            <DetailRow label="CAM" value={fmtNum(traffic.C, 2)} />
            <DetailRow label="Durée N" value={fmtNum(traffic.N, 0)} unit="ans" />
            <DetailRow label="Taux τ" value={fmtNum(traffic.tau, 1)} unit="%/an" />
            <DetailRow label="C cumulatif" value={fmtNum(Ccum, 3)} />
            <DetailRow
              label="NE"
              value={reportRowValue(neRow, 0)}
              unit="essieux"
              comment={neVal != null ? `Classe ${neClass(neVal)}` : undefined}
            />
            <DetailRow
              label="ε_z,adm catalogue"
              value={reportRowValue(ezAdmRow, 1)}
              unit="µdef"
              comment={
                neVal != null
                  ? `${neVal <= 250000 ? '0,016' : '0,012'} × NE^(-1/4,5) — ${neVal <= 250000 ? 'NE≤250 000' : 'NE>250 000'} (p.124)`
                  : undefined
              }
            />

            <DetailSectionBanner>3. Structure des couches</DetailSectionBanner>
            <DetailFormula>
              Moteur : Burmister multi-couche exact — matrice de transfert 4×4 — aucune
              réduction Odemark
            </DetailFormula>
            {layers.map((l, i) => {
              const mat = MATERIALS[l.mat];
              return (
                <DetailRow
                  key={l.id}
                  label={`Couche ${i + 1} — ${mat?.label ?? l.mat}`}
                  value={`${(l.h * 100).toFixed(0)} cm · E=${fmtNum(l.E)} MPa · ν=${l.nu.toFixed(2)}`}
                  comment={mat?.nature === 'granulaire' ? 'non lié' : 'paquet lié'}
                />
              );
            })}
            {/* Adaptateur en m → affichage cm (définitive : f(d.H_bit*100,2)) */}
            <DetailRow
              label="h paquet lié (réel)"
              value={reportRowValue(hLieRow, 2, 100)}
              unit="cm"
              comment="Épaisseur physique"
            />
            <DetailRow
              label="h total couches"
              value={reportRowValue(hTotalRow, 2, 100)}
              unit="cm"
            />
            <DetailRow
              label="Ē pondérée paquet lié"
              value={reportRowValue(E1PondRow, 0)}
              unit="MPa"
              comment="Moy. pondérée sur h"
            />
            <DetailRow
              label="ν̄ pondérée paquet lié"
              value={reportRowValue(nu1PondRow, 3)}
            />

            <DetailSectionBanner>4. Matrice de transfert Burmister</DetailSectionBanner>
            <DetailFormula>
              Pour chaque m : état_sommet = [M_top × M_bot⁻¹] × état_base (4×4 par couche)
            </DetailFormula>
            <DetailFormula>
              Propagation bottom-up : PSC semi-infini → couche N → … → couche 1 → CL
              surface
            </DetailFormula>
            <DetailRow
              label="Intégration Hankel"
              value="400 pts midpoint"
              comment={mMax != null ? `mMax=${fmtNum(mMax, 1)} m⁻¹` : undefined}
            />
            <DetailRow
              label="CL surface"
              value="σ_z=-m·J₀(mr) · τ_rz=0"
              comment="éq. 8a-8b Burmister I"
            />
            {/* Définitive : d.be couches liées/PSC — inféré ici de la saisie
                (couches liées contiguës depuis la surface). */}
            <DetailRow
              label="Interface critiques"
              value={
                beCount > 0
                  ? `${beCount} couche${beCount > 1 ? 's' : ''}/PSC lue(s)`
                  : 'aucune'
              }
            />

            <DetailSectionBanner>
              5. Contraintes à l&#39;interface critique (base paquet lié) — Éq. 6a, 6c
              Burmister I
            </DetailSectionBanner>
            <DetailRow
              label="σ_z r=0"
              value={reportRowValue(sigZ0, 2)}
              unit="kPa"
              comment="sous roue (sup. jumelage)"
            />
            <DetailRow
              label="σ_r r=0"
              value={reportRowValue(sigR0, 2)}
              unit="kPa"
              comment="compression + / traction -"
            />
            <DetailRow
              label="σ_z r=d/2 (×2)"
              value={reportRowValue(sigZd2, 2)}
              unit="kPa"
              comment="entre roues (×2)"
            />
            <DetailRow
              label="σ_r r=d/2 (×2)"
              value={reportRowValue(sigRd2, 2)}
              unit="kPa"
            />

            <DetailSectionBanner>6. Déformation εt — Fatigue</DetailSectionBanner>
            <DetailFormula>
              εt = [σ_r(1-ν_i) - ν_i·σ_z] / E_i &nbsp; [µdef] &nbsp; (couche i = dernier
              bitumineux)
            </DetailFormula>
            <DetailRow label="εt r=0" value={reportRowValue(etR0, 2)} unit="µdef" />
            <DetailRow
              label="εt r=d/2"
              value={reportRowValue(etD2, 2)}
              unit="µdef"
              comment="dual wheel"
            />
            <DetailRow
              label="εt / σt retenue (max)"
              value={reportRowValue(fatigueRow, 2)}
              unit={fatigueRow?.unit}
              status={fatigueRow?.status}
              comment={etCritique}
            />
            <DetailRow
              label="Famille de structure"
              value={reportRowValue(familleRow, 0)}
              comment={`critère ε_t ${fatigueRow?.status != null ? 'EXIGÉ' : 'informatif/non exigé'} (§4.2-4.5)`}
            />
            {/* ε₆/σ₆ = grandeur PUBLIQUE du catalogue (déjà affichée dans la saisie
                fatigue) ; seuls les coefficients de calage restent masqués (§8). */}
            <DetailRow
              label="Matériau dimensionnant"
              value={reportRowValue(refCatRow, refCatRow?.unit === 'MPa' ? 2 : 0)}
              unit={refCatRow?.unit}
              comment="base du paquet lié — ε₆/σ₆ référence catalogue AGEROUTE"
            />
            <NotExposedRow label="Coefficients de fatigue" symbols="1/b, kc, SN, kθ" />
            {couchesTraitees.map((r, i) => (
              <DetailRow
                key={`ct-${i}`}
                label={r.label}
                value={reportRowValue(r, 3)}
                unit={r.unit}
                status={r.status}
              />
            ))}
            {couchesTraiteesAdm.map((r, i) => (
              <DetailRow
                key={`cta-${i}`}
                label={r.label}
                value={reportRowValue(r, 3)}
                unit={r.unit}
              />
            ))}
            {phase2Row.map((r, i) => (
              <DetailRow
                key={`p2-${i}`}
                label={r.label}
                value={reportRowValue(r, 2)}
                unit={r.unit}
                status={r.status}
              />
            ))}
            {inverseRow.map((r, i) => (
              <DetailRow
                key={`inv-${i}`}
                label={r.label}
                value={reportRowValue(r, 3)}
                unit={r.unit}
                status={r.status}
              />
            ))}

            <DetailSectionBanner>
              Conditions d&#39;interfaces — Tableau 68 AGEROUTE
            </DetailSectionBanner>
            {layers.map((l, i) => {
              const nextMat = i + 1 < layers.length ? layers[i + 1].mat : null;
              const nom =
                i + 1 < layers.length
                  ? `C${i + 1} / C${i + 2}`
                  : `C${layers.length} / PSC`;
              const overridden = l.iface !== 'auto';
              const auto = autoIfaceLabel(l.mat, nextMat);
              const cond = overridden ? l.iface : auto;
              // Motifs riches de la définitive (BC5/BC2, MTLH demi-somme, fondation/support).
              const note = overridden
                ? `imposée par le concepteur (auto : ${auto})`
                : auto === 'glissante'
                  ? 'BC5/BC2 — Tab. 68 (auto)'
                  : auto === 'semi-collée'
                    ? 'MTLH/MTLH — Tab. 68 (auto, demi-somme collé+glissant)'
                    : nextMat == null
                      ? 'fondation / support — Tab. 68 (auto)'
                      : 'Tab. 68 (auto)';
              return (
                <DetailRow
                  key={`ifc-${l.id}`}
                  label={`Interface ${nom}`}
                  value={cond}
                  comment={note}
                />
              );
            })}
            {/* Définitive : ligne émise seulement si le critère phase 2 (structures
                mixtes §4.4.1) est présent dans la sortie moteur. */}
            {phase2Row.length > 0 ? (
              <DetailRow
                label="Phase 2 mixte (§4.4.1)"
                value="glissante"
                comment="MTLH fissuré E/5 émulé — pour le critère εt phase 2 uniquement"
              />
            ) : null}

            <DetailSectionBanner>
              7. Déformation admissible — formule LCPC 1994 (VI.4.2)
            </DetailSectionBanner>
            <DetailFormula>
              σt_adm = σ6 × (NE/10⁶)^b × kr × kc × ks × kd &nbsp; [MPa] &nbsp; (bitumineux
              : et_adm = e6 × kθ × (NE/10⁶)^b × kr × kc × ks)
            </DetailFormula>
            <DetailFormula>
              kθ = √(E(10°C)/E(θeq)) &nbsp; kr = 10^(-u·b·δ) &nbsp; δ = √(SN² +
              (c²/b²)·Sh²) &nbsp; c = 0,02 cm⁻¹
            </DetailFormula>
            <NotExposedRow
              label="kθ, kr, kc, ks, SN, Sh, δ"
              symbols="kθ/kr/kc/ks/SN/Sh/δ"
            />
            <DetailRow
              label="Risque r"
              value={reportRowValue(risqueEffRow, 2)}
              unit="%"
              comment={
                uR != null
                  ? `quantile u_r = ${fmtNum(uR, 3)}${risk === 'auto' ? ' · auto Tab. 70' : ''}`
                  : undefined
              }
            />
            <DetailRow
              label="εt / σt admissible"
              value={reportRowValue(etAdmRow ?? fatigueAdmRow, 2)}
              unit={(etAdmRow ?? fatigueAdmRow)?.unit}
            />

            <DetailSectionBanner>
              8. Déformation εz — Orniérage PSC (Burmister multi-couche exact)
            </DetailSectionBanner>
            <DetailFormula>
              εz = [σ_z - ν_PSC·(σ_xx + σ_yy)] / E_PSC — au sommet PSC, max(axe roue,
              entre-jumelage)
            </DetailFormula>
            <DetailRow
              label="h total couches"
              value={reportRowValue(hTotalRow, 2, 100)}
              unit="cm"
              comment="épaisseur réelle (sans Odemark)"
            />
            <NotExposedRow
              label="σ_z / σ_r PSC (brut)"
              symbols="σz_PSC, σr_PSC"
              reason="Intermédiaire non whitelisté côté client (σz_PSC, σr_PSC) — reste côté serveur, DoD §8"
            />
            <DetailRow label="εz axe roue" value={reportRowValue(ezAxe, 2)} unit="µdef" />
            <DetailRow
              label="εz entre-jumelage"
              value={reportRowValue(ezMid, 2)}
              unit="µdef"
            />
            {ezCouchesGranulaires.map((r, i) => (
              <DetailRow
                key={`ezg-${i}`}
                label={r.label}
                value={reportRowValue(r, 2)}
                unit={r.unit}
                status={r.status}
              />
            ))}
            <DetailRow
              label="εz retenue (max)"
              value={reportRowValue(ornieRow, 2)}
              unit="µdef"
              status={ornieRow?.status}
            />
            <DetailRow
              label="εz admissible"
              value={reportRowValue(ornieAdmRow, 2)}
              unit="µdef"
            />

            <DetailSectionBanner>9. Synthèse des critères</DetailSectionBanner>
            <DetailRow
              label="Fatigue εt/σt"
              value={`${reportRowValue(fatigueRow, 2)} / ${reportRowValue(fatigueAdmRow, 2)}`}
              unit={fatigueRow?.unit}
              comment={
                fatigueRatio != null
                  ? `Ratio=${fmtNum(fatigueRatio, 3)} → ${fatigueRow?.status === 'ok' ? '✓ SATISFAIT' : fatigueRow?.status === 'fail' ? '✗ NON SATISFAIT' : 'informatif'}`
                  : undefined
              }
              status={fatigueRow?.status}
            />
            <DetailRow
              label="Orniérage εz"
              value={`${reportRowValue(ornieRow, 2)} / ${reportRowValue(ornieAdmRow, 2)}`}
              unit="µdef"
              comment={
                ornieRatio != null
                  ? `Ratio=${fmtNum(ornieRatio, 3)} → ${ornieRow?.status === 'ok' ? '✓ SATISFAIT' : '✗ NON SATISFAIT'}`
                  : undefined
              }
              status={ornieRow?.status}
            />
            <DetailRow
              label="Verdict"
              value={
                verdict === 'PASS'
                  ? 'CONFORME'
                  : verdict === 'FAIL'
                    ? 'NON CONFORME'
                    : '—'
              }
              comment={
                verdict === 'PASS'
                  ? 'Les deux critères sont satisfaits'
                  : verdict === 'FAIL'
                    ? 'Au moins un critère non satisfait'
                    : 'Pas de verdict de conformité pour ce moteur'
              }
            />
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 8,
          padding: '6px 10px',
          background: 'var(--surface-canvas)',
          fontSize: 10,
          color: 'var(--text-secondary)',
          borderLeft: '3px solid #1a4a7a',
        }}
      >
        Burmister J.Appl.Phys.16 (1945) · Transfer Matrix 4×4 multi-couche · LCPC/SETRA ·
        AGEROUTE Sénégal Nov.2015 (CC1/0351/AGR)
      </div>

      {/* ── Récapitulatif à plat (rows) — table de synthèse déjà whitelistée ── */}
      <SectionTitle>
        Récapitulatif des critères — calcul n° {result.id.slice(-8)}
      </SectionTitle>

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
              aria-label="Détails de calcul ROADSENS — intermédiaires de méthode"
            >
              <thead>
                <tr>
                  {['Grandeur', 'Valeur', 'Unité'].map((thh) => (
                    <th
                      key={thh}
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
                      {thh}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom:
                        i < details.length - 1
                          ? '1px solid var(--border-subtle)'
                          : 'none',
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
                      {typeof row.value === 'number' ? fmtNum(row.value, 2) : row.value}
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
