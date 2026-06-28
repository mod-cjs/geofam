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
  modules: string[];          // engineId autorisés
  expiresAt: string;          // ISO
  expired: boolean;           // now_serveur > date_fin
  quota: {
    limit: number;
    used: number;
    remaining: number;
  };
  serverTime: string;         // ancre de temps — NE PAS utiliser Date.now() local
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
  domain: ProjectDomain;
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
  createdAt: string;
  updatedAt: string;
  pvId?: string;   // défini si un PV a été émis
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
  number: string;        // ex. "PV-2026-0001"
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
}

export interface EmitPvRequest {
  calcResultId: string;
  note?: string;
}

export interface VerifyPvResponse {
  pvId: string;
  intact: boolean;   // true = sceau vérifié côté serveur
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
