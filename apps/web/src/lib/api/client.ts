/**
 * Couche API ROADSEN — point de bascule mock / vrai backend.
 *
 * NEXT_PUBLIC_API_BASE_URL posée → vrai client HTTP (http-client.ts).
 * Variable absente → implémentation mock conservée (démo continue de marcher).
 *
 * Interface identique dans les deux cas : aucun consommateur n'a besoin de savoir
 * sur quel backend il tourne. Un seul point de bascule = cette variable d'env.
 *
 * Basculement de scénario de démo (mode mock uniquement) :
 * - Query param `?demo=expired | quota-exhausted | module-locked | active`
 * - Ou via le DemoPanel (localStorage `roadsen_demo_scenario`)
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

// Paramètres de contrat intentionnellement inutilisés dans le mock sont préfixés _.

import {
  httpLogin,
  httpLogout,
  httpGetStoredToken,
  httpGetStoredUser,
  httpGetStoredOrgs,
  httpGetEntitlements,
  httpListProjects,
  httpCreateProject,
  httpGetProject,
  httpRenameProject,
  httpDeleteProject,
  httpDeleteProjectPermanently,
  httpListArchivedProjects,
  httpRestoreProject,
  httpListCalcResults,
  httpGetCalcResult,
  httpRunCalc,
  httpSaveCalcSnapshot,
  httpGetCalcSnapshot,
  httpRenameCalcResult,
  httpDeleteCalcResult,
  httpListPvs,
  httpGetPv,
  httpEmitPv,
  httpRenamePv,
  httpVerifyPv,
  httpDownloadPvPdf,
  httpGetPvDocument,
} from './http-client';
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
  CalcSnapshot,
  OfficialPv,
  EmitPvRequest,
  VerifyPvResponse,
  PvDocument,
} from './types';

// ---------------------------------------------------------------------------
// Détection du mode : mock ou vrai backend
//
// NEXT_PUBLIC_API_BASE_URL est lue à la compilation par Next.js (static replace).
// En tests vitest, process.env.NEXT_PUBLIC_API_BASE_URL est undefined par défaut
// → mode mock conservé ; les tests existants restent verts sans configuration.
// ---------------------------------------------------------------------------

const _USE_REAL_BACKEND =
  typeof process !== 'undefined' &&
  typeof process.env.NEXT_PUBLIC_API_BASE_URL === 'string' &&
  process.env.NEXT_PUBLIC_API_BASE_URL.trim() !== '';

// ---------------------------------------------------------------------------
// Scénario de démo — résolution (mock uniquement, no-op en mode réel)
// ---------------------------------------------------------------------------

const DEMO_SCENARIO_KEY = 'roadsen_demo_scenario';

export function getActiveScenario(): DemoScenario {
  if (typeof window === 'undefined') return 'active';

  // 1. Query param prioritaire
  const sp = new URLSearchParams(window.location.search);
  const qp = sp.get('demo') as DemoScenario | null;
  if (qp && ['active', 'expired', 'quota-exhausted', 'module-locked'].includes(qp)) {
    // Persister pour les navigations suivantes
    try {
      localStorage.setItem(DEMO_SCENARIO_KEY, qp);
    } catch {
      /* storage indisponible */
    }
    return qp;
  }

  // 2. Valeur persistée
  try {
    const stored = localStorage.getItem(DEMO_SCENARIO_KEY) as DemoScenario | null;
    if (stored) return stored;
  } catch {
    /* storage indisponible */
  }

  return 'active';
}

export function setDemoScenario(s: DemoScenario): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DEMO_SCENARIO_KEY, s);
  } catch {
    /* storage indisponible */
  }
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
  if (_USE_REAL_BACKEND) return httpLogin(req);

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
  if (_USE_REAL_BACKEND) return httpLogout();

  await delay(200);
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('roadsen_access_token');
    sessionStorage.removeItem('roadsen_user');
    sessionStorage.removeItem('roadsen_orgs');
  }
}

export function getStoredToken(): string | null {
  if (_USE_REAL_BACKEND) return httpGetStoredToken();
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('roadsen_access_token');
}

export function getStoredUser() {
  if (_USE_REAL_BACKEND) return httpGetStoredUser();
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('roadsen_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getStoredOrgs() {
  if (_USE_REAL_BACKEND) return httpGetStoredOrgs();
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem('roadsen_orgs');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ENTITLEMENTS (ADR 0011)
// ---------------------------------------------------------------------------

export async function getEntitlements(orgId: string): Promise<EntitlementsResponse> {
  if (_USE_REAL_BACKEND) return httpGetEntitlements(orgId);
  await delay(300);
  return getMockEntitlements(getActiveScenario(), orgId);
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------

/**
 * Mock ISO-CONTRAT : le vrai backend renvoie `calcCount` / `pvCount` agrégés en
 * base. Sans cela, les pastilles d'onglet DISPARAISSENT en mode mock (démos,
 * dev sans API, tests) alors qu'elles s'affichent en réel — un mock qui ment
 * sur le contrat est pire qu'un mock absent. On les dérive donc des jeux de
 * données de mock, exactement comme le serveur les dérive de la base.
 */
function withMockCounts(p: Project): Project {
  return {
    ...p,
    calcCount: MOCK_CALCULS.filter((c) => c.projectId === p.id).length,
    pvCount: MOCK_PVS.filter((v) => v.projectId === p.id).length,
  };
}

export async function listProjects(orgId: string): Promise<Project[]> {
  if (_USE_REAL_BACKEND) return httpListProjects(orgId);
  await delay(500);
  return MOCK_PROJECTS.filter((p) => p.orgId === orgId).map(withMockCounts);
}

export async function createProject(
  orgId: string,
  req: CreateProjectRequest,
): Promise<Project> {
  if (_USE_REAL_BACKEND) return httpCreateProject(orgId, req);

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
  if (_USE_REAL_BACKEND) return httpGetProject(_orgId, projectId);

  await delay(300);
  const p = MOCK_PROJECTS.find((x) => x.id === projectId);
  if (!p) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  return withMockCounts(p);
}

// ---------------------------------------------------------------------------
// Cache projet en lecture — évite les appels GET /projects/:id redondants
// quand plusieurs composants indépendants (Topbar, ProjetLayoutClient,
// PvListClient) ont besoin du même projet au même chargement de page (aucun
// n'est ancêtre des autres, donc pas de prop-drilling possible). Dédoublonne
// aussi les requêtes concurrentes (montage simultané).
//
// PAS une source pour un flux qui doit voir un état garanti frais après
// mutation locale (ex. formulaire de renommage) : ceux-ci continuent d'appeler
// `getProject` directement. Invalidée par renameProject/deleteProject.
// ---------------------------------------------------------------------------

const projectCache = new Map<string, Project>();
const projectCacheInFlight = new Map<string, Promise<Project>>();

function projectCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

/**
 * Purge CIBLÉE de l'entrée de cache d'un projet (P0-1, suite de revue adverse).
 *
 * Depuis que les compteurs (`calcCount` / `pvCount`) viennent du projet et non
 * plus d'un appel de liste, ils héritent de ce cache. Sans purge, lancer un
 * calcul laissait la pastille sur l'ancien compte pendant que l'onglet Calculs
 * affichait déjà la nouvelle ligne — l'écran se contredisait, et l'écart durait
 * toute la session.
 *
 * Purge CIBLÉE (clé `orgId:projectId`) et non `clear()` : vider tout le cache
 * ferait recharger le tenant entier à chaque calcul, et purgerait des entrées
 * appartenant à d'autres organisations.
 */
function invalidateProjectCache(orgId: string, projectId: string): void {
  const key = projectCacheKey(orgId, projectId);
  projectCache.delete(key);
  projectCacheInFlight.delete(key);
}

/** Sondes de test — lecture seule, jamais utilisées par le code applicatif. */
export function __projectCacheHas(orgId: string, projectId: string): boolean {
  return projectCache.has(projectCacheKey(orgId, projectId));
}
export function __projectCacheSize(): number {
  return projectCache.size;
}

export async function getProjectCached(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const key = projectCacheKey(orgId, projectId);
  const cached = projectCache.get(key);
  if (cached) return cached;

  let pending = projectCacheInFlight.get(key);
  if (!pending) {
    pending = getProject(orgId, projectId)
      .then((p) => {
        projectCache.set(key, p);
        projectCacheInFlight.delete(key);
        return p;
      })
      .catch((err) => {
        projectCacheInFlight.delete(key);
        throw err;
      });
    projectCacheInFlight.set(key, pending);
  }
  return pending;
}

/**
 * Renomme un projet — PERSISTE réellement (PATCH /projects/:id côté backend).
 * Mock : mute l'entrée MOCK_PROJECTS en place (name + updatedAt) pour que la
 * persistance soit observable par un re-GET ultérieur, comme en mode réel.
 */
export async function renameProject(
  orgId: string,
  projectId: string,
  name: string,
): Promise<Project> {
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpRenameProject(orgId, projectId, name);

  await delay(400);
  const p = MOCK_PROJECTS.find((x) => x.id === projectId);
  if (!p) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  p.name = name;
  p.updatedAt = new Date().toISOString();
  return p;
}

/**
 * Supprime (archive) un projet — DELETE /projects/:id côté backend.
 * Soft-delete : les calc-results et PV scellés restent conservés en base ;
 * le projet disparaît simplement des listes (GET /projects l'exclut).
 * Mock : retire l'entrée de MOCK_PROJECTS pour reproduire cette exclusion.
 */
/** Projets archivés du tenant — sans cette lecture, un archivé est introuvable. */
export async function listArchivedProjects(orgId: string): Promise<Project[]> {
  if (_USE_REAL_BACKEND) return httpListArchivedProjects(orgId);
  await delay(300);
  return [];
}

/**
 * Restaure un projet archivé (P0-8).
 * Invalide le cache : le projet redevient visible en liste et en détail.
 */
export async function restoreProject(orgId: string, projectId: string): Promise<Project> {
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpRestoreProject(orgId, projectId);
  await delay(400);
  const p = MOCK_PROJECTS.find((x) => x.id === projectId);
  if (!p) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  return withMockCounts(p);
}

export async function deleteProject(orgId: string, projectId: string): Promise<Project> {
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpDeleteProject(orgId, projectId);

  await delay(400);
  const idx = MOCK_PROJECTS.findIndex((x) => x.id === projectId);
  if (idx === -1)
    throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  const [archived] = MOCK_PROJECTS.splice(idx, 1);
  return archived;
}

/**
 * Supprime DÉFINITIVEMENT un projet — DELETE /projects/:projectId/permanent.
 *
 * Contrat serveur (posé par un autre agent en parallèle) :
 *  - 200 avec le projet supprimé ;
 *  - 409 si le projet porte au moins un PV scellé (message serveur exploitable) ;
 *  - 404 tenant-safe sinon (absent / hors-tenant) ;
 *  - rôles OWNER/ADMIN uniquement (RBAC réel côté serveur — pas ici).
 *
 * Irréversible, à la différence de `deleteProject` (archivage). Aucune UI
 * optimiste : l'appelant attend la résolution avant de retirer la ligne.
 */
export async function deleteProjectPermanently(
  orgId: string,
  projectId: string,
): Promise<Project> {
  invalidateProjectCache(orgId, projectId);

  if (_USE_REAL_BACKEND) return httpDeleteProjectPermanently(orgId, projectId);

  await delay(400);
  const idx = MOCK_PROJECTS.findIndex((x) => x.id === projectId);
  if (idx === -1)
    throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' };
  // Cohérent avec le contrat serveur : un PV scellé bloque la suppression
  // définitive. Le mock n'a pas de notion de « scellé » distincte de MOCK_PVS —
  // un projet y figurant est donc traité comme portant un PV scellé.
  if (MOCK_PVS.some((v) => v.projectId === projectId)) {
    throw {
      statusCode: 409,
      reason: 'SERVER_ERROR',
      message:
        'Ce projet porte au moins un PV scellé : suppression définitive impossible.',
    };
  }
  const [removed] = MOCK_PROJECTS.splice(idx, 1);
  return removed;
}

// ---------------------------------------------------------------------------
// CALCULS
// ---------------------------------------------------------------------------

export async function listCalcResults(
  _orgId: string,
  projectId: string,
): Promise<CalcResult[]> {
  if (_USE_REAL_BACKEND) return httpListCalcResults(_orgId, projectId);
  await delay(400);
  return MOCK_CALCULS.filter((c) => c.projectId === projectId);
}

export async function getCalcResult(
  _orgId: string,
  _projectId: string,
  calcId: string,
): Promise<CalcResult> {
  if (_USE_REAL_BACKEND) return httpGetCalcResult(_orgId, _projectId, calcId);

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
    if (layers.length > 0 && totalH < 0.2) return true;
  }

  return false;
}

export async function runCalc(
  orgId: string,
  projectId: string,
  req: CalcRequest,
): Promise<CalcResult> {
  // Un calcul de plus => `calcCount` du projet a changé : le cache doit tomber,
  // sinon la pastille d'onglet reste sur l'ancien compte (cf. project-cache-invalidation).
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpRunCalc(orgId, projectId, req);

  // Vérifier entitlements en défense
  const ent = getMockEntitlements(getActiveScenario(), orgId);
  if (ent.expired) {
    throw { statusCode: 402, reason: 'EXPIRED', message: 'Abonnement expiré' };
  }
  if (ent.quota.remaining <= 0) {
    throw { statusCode: 402, reason: 'QUOTA', message: "Quota d'utilisation atteint" };
  }
  if (!ent.modules.includes(req.engineId)) {
    throw {
      statusCode: 403,
      reason: 'MODULE_NOT_IN_PACK',
      message: 'Module non inclus dans votre abonnement',
    };
  }

  // Simuler calcul (~800ms)
  await delay(800);

  const fail = mockShouldFail(req);

  const output = fail
    ? {
        NE: 3200000,
        NEadm: 980000,
        verdict: 'FAIL' as const,
        failReason:
          'NE admissible (980 000) inférieur au trafic de dimensionnement (3 200 000). Épaisseur de chaussée insuffisante.',
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

/**
 * Scelle le DOCUMENT rendu par l'outil (HTML d'affichage + HTML imprimable) sur
 * un calc-result existant — option 3 « le PV = le document que l'outil produit
 * à l'impression ». Le HTML ne transporte QUE des valeurs déjà rendues
 * (whitelistées serveur) + SVG, jamais de science (DoD §8).
 *
 * Mode mock : no-op (démo sans backend de persistance). Mode réel : POST
 * /projects/:projectId/calc-results/:calcResultId/snapshot. Best-effort côté
 * appelant : un échec ne doit jamais casser l'outil (cf. ToolFrame).
 */
export async function saveCalcSnapshot(
  orgId: string,
  projectId: string,
  calcResultId: string,
  snapshot: { displayHtml: string; printHtml: string },
): Promise<void> {
  if (_USE_REAL_BACKEND)
    return httpSaveCalcSnapshot(orgId, projectId, calcResultId, snapshot);
  // Mock : rien à persister (pas de backend). Résolution silencieuse.
  await delay(150);
}

/**
 * Relit le DOCUMENT capturé (affichage + impression) d'un calcul — pour le
 * re-afficher/le ré-imprimer AVANT scellement (onglet Calculs, option 3).
 *
 * `null` = pas de capture pour ce calcul (404 : ancien calcul, moteur non
 * cloné, ou capture jamais faite) — l'appelant retombe sur son panneau de
 * métadonnées. Mode mock : pas de backend de capture → `null` (déclenche le
 * même repli, la démo continue de marcher sans capture réelle).
 */
export async function getCalcSnapshot(
  orgId: string,
  projectId: string,
  calcResultId: string,
): Promise<CalcSnapshot | null> {
  if (_USE_REAL_BACKEND) return httpGetCalcSnapshot(orgId, projectId, calcResultId);
  await delay(200);
  return null;
}

/**
 * Renomme un calcul — PATCH /projects/:id/calc-results/:id côté backend.
 * `name: null` = revenir au mnémonique calculé (efface le nom personnalisé).
 * Mock : mute l'entrée MOCK_CALCULS en place (patron renameProject).
 */
export async function renameCalcResult(
  orgId: string,
  projectId: string,
  calcResultId: string,
  name: string | null,
): Promise<CalcResult> {
  if (_USE_REAL_BACKEND)
    return httpRenameCalcResult(orgId, projectId, calcResultId, name);

  await delay(300);
  const c = MOCK_CALCULS.find((x) => x.id === calcResultId && x.projectId === projectId);
  if (!c) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Calcul introuvable' };
  c.name = name;
  return c;
}

/**
 * Supprime DÉFINITIVEMENT un calcul NON scellé — DELETE /projects/:id/calc-results/:id.
 * 409 si un PV existe pour ce calcul (contrat serveur, cf. httpDeleteCalcResult).
 * Invalide le cache projet : `calcCount` change.
 */
export async function deleteCalcResult(
  orgId: string,
  projectId: string,
  calcResultId: string,
): Promise<void> {
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpDeleteCalcResult(orgId, projectId, calcResultId);

  await delay(300);
  const idx = MOCK_CALCULS.findIndex(
    (x) => x.id === calcResultId && x.projectId === projectId,
  );
  if (idx === -1)
    throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Calcul introuvable' };
  if (MOCK_CALCULS[idx].pvId) {
    throw {
      statusCode: 409,
      reason: 'SERVER_ERROR',
      message: 'Ce calcul porte un PV scellé : il ne peut pas être supprimé.',
    };
  }
  MOCK_CALCULS.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// PV
// ---------------------------------------------------------------------------

export async function listPvs(_orgId: string, projectId: string): Promise<OfficialPv[]> {
  if (_USE_REAL_BACKEND) return httpListPvs(_orgId, projectId);
  await delay(400);
  return MOCK_PVS.filter((p) => p.projectId === projectId);
}

export async function getPv(
  _orgId: string,
  _projectId: string,
  pvId: string,
): Promise<OfficialPv> {
  if (_USE_REAL_BACKEND) return httpGetPv(_orgId, _projectId, pvId);

  await delay(300);
  const pv = MOCK_PVS.find((p) => p.id === pvId);
  if (!pv) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'PV introuvable' };
  return pv;
}

export async function emitPv(
  orgId: string,
  projectId: string,
  req: EmitPvRequest,
): Promise<OfficialPv> {
  // Un PV de plus => `pvCount` du projet a changé : même raison qu'au-dessus.
  invalidateProjectCache(orgId, projectId);
  if (_USE_REAL_BACKEND) return httpEmitPv(orgId, projectId, req);

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
  if (!calc)
    throw { statusCode: 404, reason: 'NOT_FOUND', message: 'Calcul introuvable' };
  if (calc.status !== 'DONE') {
    throw {
      statusCode: 422,
      reason: 'SERVER_ERROR',
      message: 'Le calcul doit avoir le statut Calculé',
    };
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
    // Mock : la capture (saveCalcSnapshot) réussit toujours (no-op résolu) →
    // cohérent avec un documentFormat='html' pour la démo (bannière véridique).
    documentFormat: 'html',
    // Étiquette proposée à l'émission (pré-remplie par CalculsClient avec le
    // nom d'affichage courant du calcul) — `undefined` si non fournie (ancien
    // appelant) → `null` (mnémonique calculé) plutôt qu'une chaîne vide.
    name: req.name ?? null,
  };
  MOCK_PVS.push(newPv);
  // Lier le calcul au PV
  calc.pvId = newPv.id;
  return newPv;
}

/**
 * Renomme l'ÉTIQUETTE d'un PV — PATCH /projects/:id/pvs/:id côté backend.
 * N'affecte JAMAIS le contenu scellé (HMAC) : pas de re-scellement.
 * Mock : mute l'entrée MOCK_PVS en place.
 */
export async function renamePv(
  orgId: string,
  projectId: string,
  pvId: string,
  name: string | null,
): Promise<OfficialPv> {
  if (_USE_REAL_BACKEND) return httpRenamePv(orgId, projectId, pvId, name);

  await delay(300);
  const pv = MOCK_PVS.find((p) => p.id === pvId && p.projectId === projectId);
  if (!pv) throw { statusCode: 404, reason: 'NOT_FOUND', message: 'PV introuvable' };
  pv.name = name;
  return pv;
}

export async function verifyPv(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<VerifyPvResponse> {
  if (_USE_REAL_BACKEND) return httpVerifyPv(orgId, projectId, pvId);

  await delay(500);
  return {
    pvId,
    intact: true,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Génère un PDF minimal valide avec offsets xref calculés dynamiquement.
 * Permet au viewer PDF du navigateur d'afficher une page blanche avec le numéro de PV
 * plutôt qu'une erreur "Failed to load PDF" causée par du texte brut.
 *
 * Nota : ceci est uniquement utilisé en mode mock (pas de vrai backend).
 */
function makeMockPvPdf(pvId: string): Blob {
  const pageText = `PV ROADSEN - ID: ${pvId} - Apercu de demonstration`;
  // Flux PDF (contenu de la page)
  const stream = `BT /F1 11 Tf 40 720 Td (${pageText}) Tj ET`;
  const streamLen = stream.length;

  // Objets PDF
  const o1 = '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n';
  const o2 = '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n';
  const o3 =
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]' +
    '/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>\nendobj\n';
  const o4 = `4 0 obj\n<</Length ${streamLen}>>\nstream\n${stream}\nendstream\nendobj\n`;

  const header = '%PDF-1.4\n';
  const off1 = header.length;
  const off2 = off1 + o1.length;
  const off3 = off2 + o2.length;
  const off4 = off3 + o3.length;
  const body = header + o1 + o2 + o3 + o4;
  const xrefStart = body.length;

  const pad = (n: number) => n.toString().padStart(10, '0');
  const xref =
    'xref\n0 5\n' +
    '0000000000 65535 f \n' +
    `${pad(off1)} 00000 n \n` +
    `${pad(off2)} 00000 n \n` +
    `${pad(off3)} 00000 n \n` +
    `${pad(off4)} 00000 n \n`;
  const trailer = `trailer\n<</Size 5/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Blob([body + xref + trailer], { type: 'application/pdf' });
}

export async function downloadPvPdf(
  pvId: string,
  orgId?: string,
  projectId?: string,
): Promise<Blob> {
  if (_USE_REAL_BACKEND) {
    if (!orgId || !projectId) {
      throw {
        statusCode: 400,
        reason: 'SERVER_ERROR',
        message: 'orgId et projectId requis en mode réel',
      };
    }
    return httpDownloadPvPdf(orgId, projectId, pvId);
  }

  await delay(800);
  // Mock PDF — en prod : fetch GET /projects/:id/pvs/:pvId/pdf
  // Le mock génère un PDF minimal valide (offsets xref calculés dynamiquement)
  // pour que le viewer du navigateur affiche quelque chose (pas du texte brut).
  return makeMockPvPdf(pvId);
}

/**
 * Relit le DOCUMENT CLIENT SCELLÉ (HTML d'impression figé, option 3) d'un PV —
 * à afficher/imprimer TEL QUEL. `null` = PV sans document HTML servable
 * (404 UNIQUEMENT : ancien PV/autre moteur — absence légitime). Un 409
 * (intégrité rompue) ou toute autre erreur (réseau, 5xx…) est PROPAGÉ (rejette),
 * pas de repli silencieux ici — révisé suite à reco qa-challenger : un 409
 * n'est pas une absence de document, c'est une anomalie ; chaque appelant
 * décide de sa politique (`PvListClient` retombe sur le PDF pdfmake, qui a son
 * propre contrôle d'intégrité indépendant ; `CalculsClient` refuse d'imprimer
 * et alerte, cf. `httpGetPvDocument`).
 *
 * Mode mock : pas de document client capturé → `null` (repli PDF, comme en
 * réel pour un ancien PV).
 */
export async function getPvDocument(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<PvDocument | null> {
  if (_USE_REAL_BACKEND) return httpGetPvDocument(orgId, projectId, pvId);
  await delay(200);
  return null;
}
