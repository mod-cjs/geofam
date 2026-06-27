/**
 * Couche API ROADSEN — implémentation MOCK.
 *
 * Ce module est le SEUL endroit à remplacer lors du câblage du vrai backend.
 * Les signatures, les types et les formes de retour sont identiques au contrat réel.
 *
 * Basculement de scénario de démo :
 * - Query param `?demo=expired | quota-exhausted | module-locked | active`
 * - Ou cookie `roadsen_demo_scenario` (posé par le DemoPanel)
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

// Paramètres de contract intentionnellement inutilisés dans le mock (préfixe _).
/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  MOCK_LOGIN_RESPONSE,
  MOCK_CALCULS,
  MOCK_ORGS,
  MOCK_PROJECTS,
  MOCK_PVS,
  getMockEntitlements,
  type DemoScenario,
} from './mock-data';

import type {
  LoginRequest,
  LoginResponse,
  EntitlementsResponse,
  Project,
  CreateProjectRequest,
  CalcResult,
  CalcRequest,
  OfficialPv,
  EmitPvRequest,
  VerifyPvResponse,
} from './types';

// ---------------------------------------------------------------------------
// Scénario de démo — résolution
// ---------------------------------------------------------------------------

const DEMO_SCENARIO_KEY = 'roadsen_demo_scenario';

export function getActiveScenario(): DemoScenario {
  if (typeof window === 'undefined') return 'active';

  // 1. Query param prioritaire
  const sp = new URLSearchParams(window.location.search);
  const qp = sp.get('demo') as DemoScenario | null;
  if (qp && ['active', 'expired', 'quota-exhausted', 'module-locked'].includes(qp)) {
    // Persister pour les navigations suivantes
    try { localStorage.setItem(DEMO_SCENARIO_KEY, qp); } catch {}
    return qp;
  }

  // 2. Valeur persistée
  try {
    const stored = localStorage.getItem(DEMO_SCENARIO_KEY) as DemoScenario | null;
    if (stored) return stored;
  } catch {}

  return 'active';
}

export function setDemoScenario(s: DemoScenario): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DEMO_SCENARIO_KEY, s); } catch {}
}

// ---------------------------------------------------------------------------
// Délai simulé (mock réseau)
// ---------------------------------------------------------------------------

function delay(ms = 400): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

export async function login(req: LoginRequest): Promise<LoginResponse> {
  await delay(600);
  if (req.email === '' || req.password === '') {
    throw { statusCode: 401, reason: 'UNAUTHORIZED', message: 'Identifiants incorrects' };
  }
  if (req.password === 'wrong') {
    throw { statusCode: 401, reason: 'UNAUTHORIZED', message: 'Identifiants incorrects' };
  }
  // Stocker le token en mémoire (mock)
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('roadsen_access_token', MOCK_LOGIN_RESPONSE.accessToken);
    sessionStorage.setItem('roadsen_user', JSON.stringify(MOCK_LOGIN_RESPONSE.user));
    sessionStorage.setItem('roadsen_orgs', JSON.stringify(MOCK_ORGS));
  }
  return MOCK_LOGIN_RESPONSE;
}

export async function logout(): Promise<void> {
  await delay(200);
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('roadsen_access_token');
    sessionStorage.removeItem('roadsen_user');
    sessionStorage.removeItem('roadsen_orgs');
  }
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('roadsen_access_token');
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('roadsen_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getStoredOrgs() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem('roadsen_orgs');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// ENTITLEMENTS (ADR 0011)
// ---------------------------------------------------------------------------

export async function getEntitlements(orgId: string): Promise<EntitlementsResponse> {
  await delay(300);
  return getMockEntitlements(getActiveScenario(), orgId);
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------

export async function listProjects(orgId: string): Promise<Project[]> {
  await delay(500);
  return MOCK_PROJECTS.filter((p) => p.orgId === orgId);
}

export async function createProject(
  orgId: string,
  req: CreateProjectRequest
): Promise<Project> {
  await delay(600);
  const newProject: Project = {
    id: `proj_${Date.now()}`,
    orgId,
    name: req.name,
    description: req.description,
    domain: req.domain,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'usr_01',
  };
  MOCK_PROJECTS.push(newProject);
  return newProject;
}

export async function getProject(_orgId: string, projectId: string): Promise<Project> {
  await delay(300);
  const p = MOCK_PROJECTS.find((x) => x.id === projectId);
  if (!p) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  return p;
}

// ---------------------------------------------------------------------------
// CALCULS
// ---------------------------------------------------------------------------

export async function listCalcResults(
  _orgId: string,
  projectId: string
): Promise<CalcResult[]> {
  await delay(400);
  return MOCK_CALCULS.filter((c) => c.projectId === projectId);
}

export async function getCalcResult(
  _orgId: string,
  _projectId: string,
  calcId: string
): Promise<CalcResult> {
  await delay(300);
  const c = MOCK_CALCULS.find((x) => x.id === calcId);
  if (!c) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Calcul introuvable' };
  return c;
}

/**
 * Détermine si un CalcRequest doit produire un verdict FAIL.
 *
 * Règle mock (déterministe, jamais aléatoire) :
 *   1. Query param `?demo=fail` → FAIL forcé.
 *   2. Pour un moteur burmister : somme des épaisseurs de couches (layers[].h)
 *      strictement inférieure à 0,20 m → FAIL (sous-dimensionnement structurel).
 *
 * Cette règle ne contient aucune formule de calcul réelle (DoD §8).
 * Le calcul véritable reste 100 % côté serveur.
 */
function mockShouldFail(req: CalcRequest): boolean {
  // 1. Query param explicite
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('demo') === 'fail') return true;
  }

  // 2. Seuil structurel burmister : épaisseur totale < 0,20 m
  if (req.engineId === 'burmister') {
    const params = req.params as { layers?: Array<{ h?: number }> };
    const layers = Array.isArray(params?.layers) ? params.layers : [];
    const totalH = layers.reduce((sum, l) => sum + (Number(l?.h) || 0), 0);
    if (layers.length > 0 && totalH < 0.20) return true;
  }

  return false;
}

export async function runCalc(
  orgId: string,
  projectId: string,
  req: CalcRequest
): Promise<CalcResult> {
  // Vérifier entitlements en défense
  const ent = getMockEntitlements(getActiveScenario(), orgId);
  if (ent.expired) {
    throw { statusCode: 402, reason: 'EXPIRED', message: 'Abonnement expiré' };
  }
  if (ent.quota.remaining <= 0) {
    throw { statusCode: 402, reason: 'QUOTA', message: "Quota d'utilisation atteint" };
  }
  if (!ent.modules.includes(req.engineId)) {
    throw { statusCode: 403, reason: 'MODULE_NOT_IN_PACK', message: 'Module non inclus dans votre abonnement' };
  }

  // Simuler calcul (~800ms)
  await delay(800);

  const fail = mockShouldFail(req);

  const output = fail
    ? {
        NE: 3200000,
        NEadm: 980000,
        verdict: 'FAIL' as const,
        failReason: 'NE admissible (980 000) inférieur au trafic de dimensionnement (3 200 000). Épaisseur de chaussée insuffisante.',
        rows: [
          { label: 'Trafic de dimensionnement NE', value: 3200000, unit: 'essieux' },
          { label: 'NE admissible (couche 1)', value: 980000, unit: 'essieux' },
          { label: 'Déformation admissible εz', value: 12.4e-4, unit: 'mm/mm' },
          { label: 'Contrainte de traction σt max', value: 2.31, unit: 'MPa' },
        ],
      }
    : {
        NE: 1243500,
        verdict: 'PASS' as const,
        rows: [
          { label: 'Résultat principal', value: 1243500, unit: 'essieux' },
          { label: 'Paramètre secondaire', value: 8.21e-4, unit: 'mm/mm' },
          { label: 'Valeur de contrôle', value: 0.842, unit: 'MPa' },
        ],
      };

  const newCalc: CalcResult = {
    id: `calc_${Date.now()}`,
    projectId,
    orgId,
    engineId: req.engineId,
    label: req.label,
    domain: 'CH',
    status: 'DONE',
    params: req.params,
    output,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  MOCK_CALCULS.push(newCalc);
  return newCalc;
}

// ---------------------------------------------------------------------------
// PV
// ---------------------------------------------------------------------------

export async function listPvs(_orgId: string, projectId: string): Promise<OfficialPv[]> {
  await delay(400);
  return MOCK_PVS.filter((p) => p.projectId === projectId);
}

export async function getPv(
  _orgId: string,
  _projectId: string,
  pvId: string
): Promise<OfficialPv> {
  await delay(300);
  const pv = MOCK_PVS.find((p) => p.id === pvId);
  if (!pv) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'PV introuvable' };
  return pv;
}

export async function emitPv(
  orgId: string,
  projectId: string,
  req: EmitPvRequest
): Promise<OfficialPv> {
  // Vérifier entitlements
  const ent = getMockEntitlements(getActiveScenario());
  if (ent.expired) {
    throw { statusCode: 402, reason: 'EXPIRED', message: 'Abonnement expiré' };
  }
  if (ent.quota.remaining <= 0) {
    throw { statusCode: 402, reason: 'QUOTA', message: "Quota d'utilisation atteint" };
  }

  await delay(700);

  const calc = MOCK_CALCULS.find((c) => c.id === req.calcResultId);
  if (!calc) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Calcul introuvable' };
  if (calc.status !== 'DONE') {
    throw { statusCode: 422, reason: 'SERVER_ERROR', message: 'Le calcul doit avoir le statut Calculé' };
  }

  const newPv: OfficialPv = {
    id: `pv_${Date.now()}`,
    number: `PV-2026-${String(MOCK_PVS.length + 1).padStart(4, '0')}`,
    orgId,
    projectId,
    calcResultId: req.calcResultId,
    engineId: calc.engineId,
    hmacTruncated: Math.random().toString(16).slice(2, 10),
    sealedAt: new Date().toISOString(),
    sealedBy: 'Amadou Diallo',
    params: calc.params,
    output: calc.output,
  };
  MOCK_PVS.push(newPv);
  // Lier le calcul au PV
  calc.pvId = newPv.id;
  return newPv;
}

export async function verifyPv(_pvId: string): Promise<VerifyPvResponse> {
  await delay(500);
  return {
    pvId: _pvId,
    intact: true,
    verifiedAt: new Date().toISOString(),
  };
}

export async function downloadPvPdf(pvId: string): Promise<Blob> {
  await delay(800);
  // Mock PDF — en prod : fetch GET /projects/:id/pvs/:pvId/pdf
  const content = `PV SCELLÉ — ROADSEN\nID: ${pvId}\nCeci est un aperçu de démonstration.`;
  return new Blob([content], { type: 'application/pdf' });
}
