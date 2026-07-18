/**
 * Contrats de types pour la couche API ROADSEN.
 * Ces types reflètent exactement le contrat backend — le swap vers l'API réelle
 * n'est qu'un remplacement de l'implémentation mock, pas des types.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface OrgClaim {
  id: string;
  slug: string;
  role: 'OWNER' | 'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER';
}

export interface AccessClaims {
  sub: string;
  typ: 'access';
  orgs: OrgClaim[];
  iat: number;
  exp: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Entitlements (ADR 0011)
// ---------------------------------------------------------------------------

export interface EntitlementsResponse {
  orgId: string;
  pack: 'ROUTES' | 'FONDATIONS' | 'COMPLETE';
  modules: string[]; // engineId autorisés
  expiresAt: string; // ISO
  expired: boolean; // now_serveur > date_fin
  quota: {
    limit: number;
    used: number;
    remaining: number;
  };
  serverTime: string; // ancre de temps — NE PAS utiliser Date.now() local
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectDomain = 'CH' | 'FD' | 'LB';

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  // `null` = projet LEGACY créé avant la colonne domaine (domaine inconnu) —
  // sélectionnable dans tous les logiciels. Un projet neuf porte toujours CH/FD/LB.
  domain: ProjectDomain | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  domain: ProjectDomain;
}

// ---------------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------------

export type CalcStatus = 'DRAFT' | 'PENDING' | 'DONE' | 'ERROR';

/**
 * Sortie moteur NORMALISÉE pour l'UI — MÉTADONNÉE DE CONFORMITÉ SEULE.
 *
 * Nouveau paradigme (ADR 0015 — clone d'UI client) : le résultat détaillé d'un
 * calcul ne se reconstruit plus en React (ancien tableau Grandeur/Valeur/Unité/
 * Statut). Il se consulte dans le clone d'UI du logiciel (iframe, calcul serveur,
 * lit `CalcResult.rawOutput`) ou dans le PV scellé (livrable officiel). Cette
 * forme ne porte donc plus que le verdict de conformité, affiché en badge dans
 * l'historique des calculs (CONFORME / NON CONFORME / — ).
 *
 * Confidentialité DoD §8 : dérivé par une whitelist de discriminants de forme
 * (adapters.ts `normalizeOutput`), jamais une copie de l'objet brut.
 */
export interface NormalizedCalcOutput {
  /** 'NA' = moteur d'extraction/classification (pas de verdict de conformité). */
  verdict: 'PASS' | 'FAIL' | 'NA';
}

export interface CalcResult {
  id: string;
  projectId: string;
  orgId: string;
  engineId: string;
  label: string;
  domain: ProjectDomain;
  status: CalcStatus;
  params: Record<string, unknown>;
  output: unknown | null;
  /**
   * Sortie serveur WHITELISTÉE BRUTE (telle que renvoyée par le moteur côté serveur,
   * projetée sur son contrat de sortie — barrière §8, ADR 0015 §4). Conservée À CÔTÉ
   * de `output` (métadonnée de conformité). Consommée UNIQUEMENT par les clones d'UI
   * client (ToolFrame → bridge → `mapOutputToR`), qui lisent la structure brute du
   * moteur (`output.cas`, `output.capaciteReference`, `output.contraintesBase`…).
   * `output` (ci-dessus) n'est lu que pour son `verdict` (badge CONFORME/NON CONFORME
   * de l'historique des calculs) — plus aucune page ne reconstruit le résultat en
   * React. Absent en mode mock (pas de sortie serveur whitelistée).
   */
  rawOutput?: unknown;
  createdAt: string;
  updatedAt: string;
  pvId?: string; // défini si un PV a été émis
}

export interface CalcRequest {
  engineId: string;
  label: string;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PV (Procès-Verbaux)
// ---------------------------------------------------------------------------

export type PvStatus = 'SEALED';

export interface OfficialPv {
  id: string;
  number: string; // ex. "PV-2026-0001"
  orgId: string;
  projectId: string;
  calcResultId: string;
  engineId: string;
  hmacTruncated: string; // 8 premiers caractères du HMAC
  sealedAt: string;
  sealedBy: string;
  pdfUrl?: string;
  params: Record<string, unknown>;
  output: unknown;
  /**
   * Vérification du sceau recalculée serveur (GET /pvs, GET /pvs/:id). `undefined`
   * pour la forme plate d'émission (POST .../pv) : un PV qui vient d'être scellé
   * n'a pas encore été relu/vérifié — ne PAS l'afficher comme "invalide" à tort ;
   * le composant appelant doit traiter `undefined` comme "non vérifié" et non "invalide".
   */
  sealValid?: boolean;
}

export interface EmitPvRequest {
  calcResultId: string;
  note?: string;
}

export interface VerifyPvResponse {
  pvId: string;
  intact: boolean; // true = sceau vérifié côté serveur
  verifiedAt: string;
}

// ---------------------------------------------------------------------------
// Erreurs contrat
// ---------------------------------------------------------------------------

export type ApiErrorReason =
  | 'UNAUTHORIZED'
  | 'MODULE_NOT_IN_PACK'
  | 'EXPIRED'
  | 'QUOTA'
  | 'NOT_FOUND'
  | 'SERVER_ERROR';

export interface ApiError {
  statusCode: number;
  reason: ApiErrorReason;
  message: string;
}
