/**
 * Données de démo — fixtures réalistes pour le parcours cœur ROADSEN.
 * Remplacées par des appels API réels lors du swap backend.
 */

import type {
  LoginResponse,
  EntitlementsResponse,
  Project,
  CalcResult,
  OfficialPv,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Demo scenarios — basculables via query param ?demo=<scenario>
// ou via le panneau de démo (DemoPanel)
// ---------------------------------------------------------------------------

export type DemoScenario =
  | 'active'          // abonnement valide, quota restant
  | 'expired'         // abonnement expiré → lecture seule
  | 'quota-exhausted' // quota à 0
  | 'module-locked';  // pack ROUTES → fondations verrouillées

export const DEFAULT_DEMO_SCENARIO: DemoScenario = 'active';

// ---------------------------------------------------------------------------
// Token mocké (JWT-like payload décodé — jamais exposé au moteur)
// ---------------------------------------------------------------------------

export const MOCK_TOKEN = 'mock.jwt.token';

export const MOCK_USER = {
  id: 'usr_01',
  email: 'demo@starfire.sn',
  name: 'Amadou Diallo',
};

export const MOCK_ORGS = [
  { id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' as const },
  { id: 'org_02', slug: 'labo-thies', role: 'ENGINEER' as const },
];

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const MOCK_LOGIN_RESPONSE: LoginResponse = {
  accessToken: MOCK_TOKEN,
  refreshToken: 'mock.refresh.token',
  user: MOCK_USER,
};

// ---------------------------------------------------------------------------
// Entitlements par scénario
// ---------------------------------------------------------------------------

export function getMockEntitlements(scenario: DemoScenario, orgId = 'org_01'): EntitlementsResponse {
  const base = {
    orgId,
    serverTime: new Date().toISOString(),
  };

  switch (scenario) {
    case 'expired':
      return {
        ...base,
        pack: 'COMPLETE',
        modules: ['burmister', 'terzaghi', 'pressiometre', 'pieux', 'radier', 'labo'],
        expiresAt: iso(-30),
        expired: true,
        quota: { limit: 500, used: 487, remaining: 13 },
      };

    case 'quota-exhausted':
      return {
        ...base,
        pack: 'COMPLETE',
        modules: ['burmister', 'terzaghi', 'pressiometre', 'pieux', 'radier', 'labo'],
        expiresAt: iso(180),
        expired: false,
        quota: { limit: 500, used: 500, remaining: 0 },
      };

    case 'module-locked':
      return {
        ...base,
        pack: 'ROUTES',
        modules: ['burmister', 'pressiometre'],
        expiresAt: iso(180),
        expired: false,
        quota: { limit: 200, used: 45, remaining: 155 },
      };

    case 'active':
    default:
      return {
        ...base,
        pack: 'COMPLETE',
        modules: ['burmister', 'terzaghi', 'pressiometre', 'pieux', 'radier', 'labo'],
        expiresAt: iso(180),
        expired: false,
        quota: { limit: 500, used: 137, remaining: 363 },
      };
  }
}

// ---------------------------------------------------------------------------
// Projets
// ---------------------------------------------------------------------------

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj_01',
    orgId: 'org_01',
    name: 'RN2 — PK 45+000 à PK 52+000',
    description: 'Réhabilitation chaussée route nationale 2',
    domain: 'CH',
    createdAt: iso(-15),
    updatedAt: iso(-2),
    createdBy: 'usr_01',
  },
  {
    id: 'proj_02',
    orgId: 'org_01',
    name: 'Pont de Mbodiene — fondations',
    description: 'Étude fondations appuis pile P3 et P4',
    domain: 'FD',
    createdAt: iso(-8),
    updatedAt: iso(-1),
    createdBy: 'usr_01',
  },
  {
    id: 'proj_03',
    orgId: 'org_01',
    name: 'Zone industrielle Thiès — labo',
    description: 'Campagne GTR plateforme logistique',
    domain: 'LB',
    createdAt: iso(-3),
    updatedAt: iso(-0),
    createdBy: 'usr_01',
  },
];

// ---------------------------------------------------------------------------
// Calculs — fixtures nommées
// ---------------------------------------------------------------------------

// calc_01 : calcul CONFORME (PASS) avec PV
const MOCK_CALC_01: CalcResult = {
  id: 'calc_01',
  projectId: 'proj_01',
  orgId: 'org_01',
  engineId: 'burmister',
  label: 'Structure S1 — variante BBSG1/GB3',
  domain: 'CH',
  status: 'DONE',
  params: {
    traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
    load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
    layers: [
      { mat: 'BBSG1', E: 5400, nu: 0.35, h: 0.06 },
      { mat: 'GB3', E: 5400, nu: 0.35, h: 0.10 },
      { mat: 'GL1', E: 800, nu: 0.35, h: 0.20 },
    ],
  },
  output: {
    NE: 1243500,
    verdict: 'PASS',
    rows: [
      { label: 'Trafic de dimensionnement NE', value: 1243500, unit: 'essieux' },
      { label: 'Déformation admissible εz', value: 8.21e-4, unit: 'mm/mm' },
      { label: 'Contrainte de traction σt max', value: 0.842, unit: 'MPa' },
      { label: 'Épaisseur totale chaussée', value: 0.36, unit: 'm' },
      { label: 'Module effectif couche 1', value: 5400, unit: 'MPa' },
    ],
  },
  createdAt: iso(-5),
  updatedAt: iso(-5),
  pvId: 'pv_01',
};

// calc_04 : fondation CONFORME (PASS) avec PV
const MOCK_CALC_04: CalcResult = {
  id: 'calc_04',
  projectId: 'proj_02',
  orgId: 'org_01',
  engineId: 'terzaghi',
  label: 'Fondation semelle F1 — appui P3',
  domain: 'FD',
  status: 'DONE',
  params: {
    forme: 'rect',
    B: 1.5,
    L: 2.0,
    D: 1.2,
    gamma: 18,
    c: 25,
    phi: 28,
    q0: 10,
  },
  output: {
    verdict: 'PASS',
    rows: [
      { label: 'Capacité portante qlim', value: 487.3, unit: 'kPa' },
      { label: 'Charge limite ultime Qu', value: 1462, unit: 'kN' },
      { label: 'Facteur Nc', value: 25.80, unit: '—' },
      { label: 'Facteur Nq', value: 14.72, unit: '—' },
      { label: 'Facteur Nγ', value: 16.72, unit: '—' },
    ],
  },
  createdAt: iso(-6),
  updatedAt: iso(-6),
  pvId: 'pv_02',
};

/**
 * Fixture NON CONFORME — épaisseur insuffisante face au trafic.
 *
 * Règle déterministe de runCalc (client.ts) :
 *   si la somme des épaisseurs de couches < 0,20 m → verdict FAIL
 *
 * Cette structure S3 ne comporte qu'une seule couche de 0,08 m (< seuil),
 * ce qui garantit un FAIL reproductible, sans aléatoire.
 *
 * Atteignable via :
 *   ?demo=fail  (query param reconnu par runCalc)
 *   ou en soumettant un formulaire burmister avec une seule couche h < 0,20 m
 */
export const MOCK_CALC_FAIL: CalcResult = {
  id: 'calc_fail_01',
  projectId: 'proj_01',
  orgId: 'org_01',
  engineId: 'burmister',
  label: 'Structure S3 — épaisseur insuffisante (NON CONFORME)',
  domain: 'CH',
  status: 'DONE',
  params: {
    traffic: { T: 500, C: 1.1, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
    load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    subgrade: { cls: 'PF1', E: 35, nu: 0.35 },
    layers: [
      { mat: 'BBSG1', E: 5400, nu: 0.35, h: 0.08 },
    ],
  },
  output: {
    NE: 3200000,
    NEadm: 980000,
    verdict: 'FAIL',
    failReason: 'NE admissible (980 000) inférieur au trafic de dimensionnement (3 200 000). Épaisseur de chaussée insuffisante.',
    rows: [
      { label: 'Trafic de dimensionnement NE', value: 3200000, unit: 'essieux' },
      { label: 'NE admissible (couche 1)', value: 980000, unit: 'essieux' },
      { label: 'Déformation admissible εz', value: 12.4e-4, unit: 'mm/mm' },
      { label: 'Contrainte de traction σt max', value: 2.31, unit: 'MPa' },
      { label: 'Épaisseur totale chaussée', value: 0.08, unit: 'm' },
    ],
  },
  createdAt: iso(-2),
  updatedAt: iso(-2),
  // Pas de pvId : un calcul NON CONFORME ne doit pas avoir de PV (F-08 — décision en cours)
};

/**
 * Tableau mutable des calculs (les runCalc/emitPv mock y pushent).
 * Les constantes nommées sont placées en tête — MOCK_CALC_FAIL en premier
 * pour que le calcul NON CONFORME soit visible immédiatement en démo.
 */
export const MOCK_CALCULS: CalcResult[] = [
  MOCK_CALC_FAIL,
  MOCK_CALC_01,
  {
    id: 'calc_02',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId: 'burmister',
    label: 'Structure S2 — variante EME2',
    domain: 'CH',
    status: 'DONE',
    params: {
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      layers: [
        { mat: 'BBSG1', E: 5400, nu: 0.35, h: 0.05 },
        { mat: 'EME2', E: 14000, nu: 0.35, h: 0.08 },
      ],
    },
    output: {
      NE: 1243500,
      verdict: 'PASS',
      rows: [
        { label: 'Trafic de dimensionnement NE', value: 1243500, unit: 'essieux' },
        { label: 'Déformation admissible εz', value: 7.14e-4, unit: 'mm/mm' },
        { label: 'Contrainte de traction σt max', value: 1.12, unit: 'MPa' },
        { label: 'Épaisseur totale chaussée', value: 0.13, unit: 'm' },
      ],
    },
    createdAt: iso(-4),
    updatedAt: iso(-4),
  },
  {
    id: 'calc_03',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId: 'pressiometre',
    label: 'Pressiomètre PZ-03 — module Ménard',
    domain: 'LB',
    status: 'DRAFT',
    params: {},
    output: null,
    createdAt: iso(-1),
    updatedAt: iso(-1),
  },
  MOCK_CALC_04,
];

// ---------------------------------------------------------------------------
// PV
// ---------------------------------------------------------------------------

export const MOCK_PVS: OfficialPv[] = [
  {
    id: 'pv_01',
    number: 'PV-2026-0001',
    orgId: 'org_01',
    projectId: 'proj_01',
    calcResultId: 'calc_01',
    engineId: 'burmister',
    hmacTruncated: 'a3f8c2d1',
    sealedAt: iso(-4),
    sealedBy: 'Amadou Diallo',
    params: MOCK_CALC_01.params,
    output: MOCK_CALC_01.output,
    sealValid: true,
  },
  {
    id: 'pv_02',
    number: 'PV-2026-0002',
    orgId: 'org_01',
    projectId: 'proj_02',
    calcResultId: 'calc_04',
    engineId: 'terzaghi',
    hmacTruncated: 'e7b1a9f4',
    sealedAt: iso(-5),
    sealedBy: 'Amadou Diallo',
    params: MOCK_CALC_04.params,
    output: MOCK_CALC_04.output,
    sealValid: true,
  },
];
