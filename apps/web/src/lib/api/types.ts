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

/**
 * Ligne de résultat AFFICHABLE — contrat client-safe.
 *
 * Forme alignée sur `CalcOutputRow` consommé par CalculsClient ResultPanel
 * ({ label, value, unit }). `status` porte le verdict PAR critère (fatigue,
 * orniérage) ; optionnel — colonne « état » à câbler côté dev-frontend.
 *
 * Confidentialité DoD §8 : ces lignes ne contiennent QUE des grandeurs de
 * RÉSULTAT d'ingénierie issues de la whitelist du moteur (cf. adapters.ts).
 * Aucun intermédiaire confidentiel (contraintes brutes, coefficients de calage).
 */
export interface CalcOutputRow {
  label: string;
  /** number = grandeur formatée ; string = résultat textuel (classe, catégorie…). */
  value: number | string;
  unit: string;
  status?: 'ok' | 'fail';
}

/**
 * Sortie moteur NORMALISÉE pour l'UI : verdict global + lignes affichables.
 * C'est la seule forme que le ResultPanel lit (`output.verdict`, `output.rows`).
 */
export interface NormalizedCalcOutput {
  /** 'NA' = moteur d'extraction/classification (pas de verdict de conformité). */
  verdict: 'PASS' | 'FAIL' | 'NA';
  rows: CalcOutputRow[];
  /**
   * Détails de calcul — intermédiaires de MÉTHODE PUBLICS (contraintes σ,
   * déformations ε intermédiaires, modules pondérés). Whitelistés par un builder
   * dédié (jamais copie brute) ; JAMAIS de coefficient de calage (DoD §8,
   * rescope « méthode transparente »). Absent si le moteur n'en fournit pas.
   */
  details?: CalcOutputRow[];
  /**
   * Champ de résultat RÉ-ÉCHANTILLONNÉ pour affichage (heatmap radier) — grille
   * FIXE découplée du maillage EF. Montre le MOTIF (résultat), jamais les valeurs
   * nodales/indices/topologie (méthode). Décision STARFIRE+expert (rescope §8).
   *
   * Legacy — conservé pour compatibilité descendante (calculs déjà persistés
   * avant l'introduction du sélecteur multi-champs, cf. `heatmaps` ci-dessous) :
   * un ancien CalcResult ne porte que ce champ (déflexion uniquement).
   */
  heatmap?: HeatmapData;
  /**
   * Contrat cartes 14/07 — sélecteur multi-champs (fidélité au panneau `res-field`
   * du client GEOPLAQUE_V10.html) : une grille d'affichage par grandeur radier.
   * Clés attendues : deflexion, reaction, momentX, momentY, momentXY, raideur,
   * pente, rotationX, rotationY. Absent sur les anciens calculs → fallback `heatmap`.
   */
  heatmaps?: Record<string, HeatmapData>;
  /**
   * Contrat cartes 14/07 — profils 1D des solveurs plans (`plane-strain`, `axi`).
   * `x` = abscisse (m, ou rayon r pour axi), `v` = valeurs échantillonnées (même
   * longueur que `x`). Clés attendues : plane-strain → deflexion/moment/reaction
   * (97 points) ; axi → deflexion/momentR/momentT/reaction. Absent → pas de tracé
   * (pas de crash), ex. moteurs `radier`/`tri-raft` qui n'en produisent pas.
   */
  profils?: Record<string, ProfilData>;
}

/** Grille d'affichage d'un champ (heatmap) — découplée du maillage. */
export interface HeatmapData {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cols: number;
  rows: number;
  /** Valeurs de la grille d'affichage (row-major) ; null = hors domaine. */
  vals: (number | null)[];
  vMin: number;
  vMax: number;
  /** Contrat cartes 14/07 — unité d'affichage de la grandeur (ex. 'mm', 'kPa', 'rad'). */
  unit?: string;
  /** Contrat cartes 14/07 — libellé métier de la grandeur (ex. 'Tassement'). */
  label?: string;
}

/**
 * Contrat cartes 14/07 — profil 1D échantillonné (bande de tracé plane-strain/axi).
 * `x`/`v` de même longueur ; `unit`/`label` portent l'affichage (axe, légende).
 */
export interface ProfilData {
  x: number[];
  v: number[];
  unit: string;
  label: string;
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
