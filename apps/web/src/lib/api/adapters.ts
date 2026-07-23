/**
 * Adaptateurs — mapping ligne Prisma (backend) vers types front ROADSEN.
 *
 * Le backend renvoie les lignes brutes Prisma : `input`/`output`/`engineId`/`status`…
 * Ces fonctions normalisent vers les types front (CalcResult, OfficialPv, etc.)
 * sans aucune logique de calcul côté client.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 *
 * NOUVEAU PARADIGME (ADR 0015 — clone d'UI client) : le résultat détaillé d'un
 * calcul ne se reconstruit plus en React ici. Le clone d'UI (iframe, calcul
 * serveur) affiche/imprime NATIVEMENT les résultats à partir de `rawOutput`
 * (sortie serveur whitelistée brute, cf. `CalcResult.rawOutput`) ; le seul
 * livrable propre à la plateforme est le PV SCELLÉ (généré serveur). `output`
 * (ce fichier) ne porte donc plus qu'une MÉTADONNÉE DE CONFORMITÉ ({verdict}),
 * consommée par l'historique des calculs (badge CONFORME/NON CONFORME) — jamais
 * un tableau de résultat. `normalizeOutput` reste STRICTEMENT fail-closed : elle
 * ne renvoie jamais l'objet brut, seulement le verdict dérivé d'une whitelist de
 * discriminants de forme (mêmes clés que les anciens contrats de sortie moteur),
 * afin qu'aucun intermédiaire confidentiel ne puisse traverser vers le navigateur.
 */

import type {
  CalcResult,
  CalcStatus,
  NormalizedCalcOutput,
  OfficialPv,
  EntitlementsResponse,
  Project,
  ProjectDomain,
  LoginResponse,
} from './types';

// ---------------------------------------------------------------------------
// Formes Prisma brutes (telles qu'envoyées par le backend)
// ---------------------------------------------------------------------------

export interface PrismaCalcResult {
  id: string;
  projectId: string;
  orgId: string;
  engineId: string;
  /**
   * ⚠️ Forme RÉELLE du backend `GET /projects/:id/calc-results` :
   * `status`/`label`/`domain`/`updatedAt` NE sont PAS renvoyés (clés réelles :
   * userId, engineVersion, engineSourceHash, input, output, createdAt). On les
   * déclare optionnels et on DÉRIVE ce qui manque (cf. adaptCalcResult), tout en
   * restant compatible avec les fixtures de test qui les fournissent encore.
   */
  label?: string;
  domain?: string;
  status?: string;
  userId?: string;
  engineVersion?: string;
  engineSourceHash?: string;
  /** Paramètres d'entrée du calcul */
  input: unknown;
  /** Résultat du moteur */
  output: unknown | null;
  pvId?: string | null;
  createdAt: string;
  updatedAt?: string;
  /** Nom mnémonique — `null`/absent = mnémonique calculé côté front. */
  name?: string | null;
}

/**
 * Forme renvoyée par POST /projects/:projectId/calc/:engine — PersistedCalcResult.
 *
 * DIFFÉRENTE de la forme GET /calc-results (PrismaCalcResult) :
 *  - `calcResultId` (pas `id`)
 *  - `meta.engineId` (pas `engineId` direct)
 *  - pas de `projectId`/`orgId`/`createdAt` (contexte passé à l'adaptateur)
 *  - `ok: false` = échec moteur (rien persisté, calcResultId='')
 */
export interface BackendPersistedCalcResult {
  calcResultId: string;
  ok: boolean;
  meta: {
    engineId: string;
    engineVersion: string;
    engineSourceHash?: string;
  };
  output: unknown;
}

/**
 * Champs communs du PV officiel (modèle Prisma OfficialPv sérialisé en JSON).
 * Partagé par les deux formes de réponse (plate et imbriquée).
 */
export interface PrismaOfficialPvCore {
  id: string;
  orgId: string;
  calcResultId: string;
  projectId: string;
  pvNumber: string;
  userId: string;
  projectName: string;
  engineId: string;
  engineVersion: string;
  engineSourceHash?: string | null;
  inputCanonical: string; // JSON canonique des entrées
  output: unknown;
  scienceStatus: string;
  verdict?: string;
  contentHash: string;
  hmac: string; // sceau HMAC complet (serveur)
  sealedAt: string;
  /**
   * 'html' = un document client (rendu de l'outil) a été scellé avec ce PV ;
   * `null`/absent = repli format standard (pdfmake), aucun document capturé au
   * moment de l'émission (B1, revue adverse — bannière véridique cf. page logiciel).
   */
  documentFormat?: string | null;
  /** Étiquette du PV — `null`/absent = mnémonique calculé côté front. */
  name?: string | null;
}

/**
 * Forme IMBRIQUÉE — retournée par GET /pvs/:id et GET /pvs (list).
 * Le PV est sous `pv`, avec `sealValid` au top-level.
 */
export interface PrismaOfficialPv {
  pv: PrismaOfficialPvCore;
  sealValid?: boolean;
}

/**
 * Forme PLATE — retournée directement par POST /calc-results/:id/pv (emit).
 * OfficialPv Prisma sérialisé sans enveloppe wrapper.
 * Alias de PrismaOfficialPvCore (même structure).
 */
export type PrismaOfficialPvFlat = PrismaOfficialPvCore;

export interface PrismaProject {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  // Nullable : les projets legacy (avant la colonne) reviennent domain=null.
  domain: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * P0-1 — compteurs de contenu agrégés côté serveur. Optionnels : un backend
   * antérieur (ou le mock) ne les renvoie pas, et l'UI doit alors n'afficher
   * aucune pastille plutôt qu'un « 0 » trompeur.
   */
  calcCount?: number;
  pvCount?: number;
  /** P0-3 — dernière activité réelle, agrégée et triée côté serveur. */
  lastActivityAt?: string;
  lastActivityKind?: 'calcul' | 'pv' | 'projet';
  /**
   * Champ réel du backend : `createdById` (Prisma : created_by_id).
   * ⚠️ PAS `createdBy` — bug #8.
   */
  createdById: string;
}

export interface BackendLoginResponse {
  accessToken: string;
  refreshToken: string;
  // Le backend /auth/login réel ne renvoie PAS de `user` (id = claim `sub` du JWT,
  // email/name via /auth/me). Optionnel pour ne pas casser l'adaptation.
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * Profil utilisateur renvoyé par GET /auth/me.
 * Forme : { userId, email, fullName, platformRole, memberships }.
 */
export interface BackendUserProfile {
  userId: string;
  email: string;
  fullName: string;
  platformRole: string | null;
  memberships: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    role: string;
  }>;
}

export interface BackendEntitlements {
  orgId: string;
  pack: string;
  modules: string[];
  expiresAt: string;
  expired: boolean;
  quota: {
    limit: number;
    used: number;
    remaining: number;
  };
  serverTime: string;
}

// ---------------------------------------------------------------------------
// CalcResult — input/output Prisma → params/output front
// ---------------------------------------------------------------------------

const CALC_STATUSES: readonly CalcStatus[] = ['DRAFT', 'PENDING', 'DONE', 'ERROR'];

function isCalcStatus(v: unknown): v is CalcStatus {
  return typeof v === 'string' && (CALC_STATUSES as readonly string[]).includes(v);
}

/**
 * Statut DÉRIVÉ de la sortie (le backend ne renvoie pas de champ `status`) :
 *  - sortie présente sans `erreur`   ⇒ DONE  (la science a abouti)
 *  - sortie présente avec `erreur≠null` ⇒ ERROR (science levée, message borné)
 *  - pas de sortie ⇒ statut backend s'il est fourni & valide, sinon neutre PENDING
 */
function deriveCalcStatus(raw: PrismaCalcResult): CalcStatus {
  const out = raw.output;
  if (out != null && typeof out === 'object') {
    const erreur = (out as { erreur?: unknown }).erreur;
    return erreur != null ? 'ERROR' : 'DONE';
  }
  if (isCalcStatus(raw.status)) return raw.status;
  return 'PENDING';
}

/**
 * Mapping engineId → domaine de projet.
 *
 * DEUX types de clés :
 *  - registryId (ce que le backend stocke dans calc_results.engine_id et renvoie
 *    dans PersistedCalcResult.meta.engineId) : forme canonique longue.
 *  - slug URL (ce que le client envoie dans :engine, gardé pour compat fixtures).
 *
 * Table alignée sur engine-dispatch.ts (apps/api/src/pv/engine-dispatch.ts) :
 *   burmister    → registryId chaussee-burmister       → CH
 *   terzaghi     → registryId fondation-superficielle  → FD
 *   pieux        → registryId fondation-profonde-pieux → FD
 *   radier       → registryId radier-plaque            → FD
 *   pressiometre → registryId pressiometre-menard      → LB
 *   labo         → registryId labo-classification-gtr  → LB
 *   plane-strain → registryId plane-strain             → FD
 *   axi          → registryId axi-plaque               → FD
 *   tri-raft     → registryId radier-tri                → FD
 *
 * Anciens noms GeoSuite (casagrande, geoplaque, fastlab) supprimés :
 * ils ne correspondent à aucun registryId ni slug supporté par le backend.
 */
const ENGINE_TO_DOMAIN: Record<string, ProjectDomain> = {
  // registryIds (clés stables persistées en base — champ engine_id de calc_results)
  'chaussee-burmister': 'CH',
  'fondation-superficielle': 'FD',
  'fondation-profonde-pieux': 'FD',
  'radier-plaque': 'FD',
  'pressiometre-menard': 'LB',
  'pressio-etalonnage': 'LB',
  'pressio-calibrage': 'LB',
  'labo-classification-gtr': 'LB',
  // Variantes GEOPLAQUE (registryIds, cf. engine-dispatch.ts) — mêmes moteurs
  // d'analyse EF, domaine fondations (FD).
  'plane-strain': 'FD',
  'axi-plaque': 'FD',
  'radier-tri': 'FD',
  // URL slugs (:engine dans les routes backend) — compatibilité fixtures de test
  burmister: 'CH',
  terzaghi: 'FD',
  pieux: 'FD',
  radier: 'FD',
  pressiometre: 'LB',
  labo: 'LB',
  axi: 'FD',
  'tri-raft': 'FD',
  // NB : les slugs 'pressio-etalonnage'/'pressio-calibrage' sont IDENTIQUES à leurs
  // registryIds (déjà déclarés ci-dessus) — pas de doublon à ajouter ici.
};

function deriveDomain(raw: PrismaCalcResult): ProjectDomain {
  if (raw.domain === 'CH' || raw.domain === 'FD' || raw.domain === 'LB')
    return raw.domain;
  return ENGINE_TO_DOMAIN[raw.engineId] ?? 'CH';
}

/**
 * Verdict global terzaghi : tous les cas valides portants (et stables au
 * glissement/excentrement si évalués). Ne construit AUCUNE ligne de résultat —
 * seulement le booléen de conformité (métadonnée légitime, DoD §8).
 */
function terzaghiVerdict(o: Record<string, unknown>): 'PASS' | 'FAIL' {
  const cas = Array.isArray(o.cas) ? o.cas : [];
  const valid = cas.filter(
    (c): c is Record<string, unknown> =>
      c != null &&
      typeof c === 'object' &&
      (c as Record<string, unknown>).invalide !== true,
  );
  if (valid.length === 0) return 'FAIL';
  // MAJEUR-1 : l'excentrement compte dans le verdict. `excOk === undefined` = non requis
  // (ELU accidentel, tab. 5.5) → n'échoue pas ; `excOk === false` (excentrement non
  // vérifié) → FAIL (fin du faux PASS où un cas excentré affichait « Fondation vérifiée »).
  return valid.every(
    (c) =>
      c.portanceOk === true &&
      (c.glissementOk === undefined || c.glissementOk === true) &&
      (c.excOk === undefined || c.excOk === true),
  )
    ? 'PASS'
    : 'FAIL';
}

/**
 * Normalise la sortie moteur vers la MÉTADONNÉE de conformité affichable
 * ({verdict}) — STRICTEMENT FAIL-CLOSED (DoD §8).
 *
 * Ne renvoie JAMAIS l'objet brut : la sortie moteur peut contenir des
 * intermédiaires/méthode/coefficients/warnings confidentiels. Le résultat
 * détaillé se consulte désormais dans le clone d'UI du logiciel (via
 * `CalcResult.rawOutput`, whitelisté serveur — cf. ADR 0015 §4) ou dans le PV
 * scellé ; cette fonction ne sert plus qu'à dériver le badge CONFORME/NON
 * CONFORME de l'historique des calculs.
 *
 *  - null / non-objet                          → null
 *  - sortie BRUTE burmister (`conforme:boolean`) → verdict PASS/FAIL
 *  - sortie déjà normalisée (`verdict:string` + `rows:[]`) → verdict re-projeté
 *  - terzaghi (`cas:[]`)                         → verdict dérivé par cas
 *  - pieux (`allOk:boolean`)                      → verdict PASS/FAIL
 *  - moteurs d'ANALYSE sans verdict de conformité (radier, labo, pressiomètre,
 *    étalonnage, calibrage, axi, plane-strain, tri-raft) → verdict 'NA'
 *  - moteur NON reconnu                          → null (AUCUNE donnée brute exposée)
 */
function normalizeOutput(output: unknown): NormalizedCalcOutput | null {
  if (output == null || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;

  if (typeof o.conforme === 'boolean') {
    return { verdict: o.conforme === true ? 'PASS' : 'FAIL' };
  }
  if (typeof o.verdict === 'string' && Array.isArray(o.rows)) {
    return {
      verdict: o.verdict === 'PASS' ? 'PASS' : o.verdict === 'FAIL' ? 'FAIL' : 'NA',
    };
  }
  // terzaghi (fondation superficielle) : sortie {cas:[…]} → verdict par cas
  if (Array.isArray(o.cas)) {
    return { verdict: terzaghiVerdict(o) };
  }
  // pieux (fondation profonde) : verdict global booléen `allOk`
  if (typeof o.allOk === 'boolean') {
    return { verdict: o.allOk === true ? 'PASS' : 'FAIL' };
  }
  // radier (plaque/sol multicouche) : déflexions/distorsions — pas de verdict (NA).
  if (typeof o.betaGov === 'number' || 'nRafts' in o) {
    return { verdict: 'NA' };
  }
  // labo (classification GTR) : classe + paramètres — pas de verdict (NA)
  if (o.classe != null && typeof o.classe === 'object') {
    return { verdict: 'NA' };
  }
  // pressiomètre Ménard (dépouillement) : pL/EM/catégorie — pas de verdict (NA).
  if ('categorie' in o && ('pL' in o || 'ratioEMpL' in o)) {
    return { verdict: 'NA' };
  }
  // PressioPro — ÉTALONNAGE : Vs + Pe — coefficients d'appareillage, pas de verdict (NA).
  if ('Vs' in o && 'Pe' in o) {
    return { verdict: 'NA' };
  }
  // PressioPro — CALIBRAGE : a + R² + rms sans Vs — pas de verdict (NA).
  if ('a' in o && 'R2' in o && 'rms' in o && !('Vs' in o)) {
    return { verdict: 'NA' };
  }
  // GEOPLAQUE — variantes (clés de diagnostic DISJOINTES du radier ACM et entre elles) :
  // axisymétrique (wc/wEdge), déformations planes (decolN+mMax), triangulaire (reactionMax+
  // nRaft — singulier, distinct de `nRafts` du radier ACM). Analyses → verdict NA.
  if ('wc' in o && 'wEdge' in o) {
    return { verdict: 'NA' };
  }
  if ('decolN' in o && 'mMax' in o) {
    return { verdict: 'NA' };
  }
  if ('reactionMax' in o && 'nRaft' in o) {
    return { verdict: 'NA' };
  }
  // Moteur non reconnu : fail-closed, aucune sortie brute ne traverse vers le navigateur.
  return null;
}

export function adaptCalcResult(raw: PrismaCalcResult): CalcResult {
  return {
    id: raw.id,
    projectId: raw.projectId,
    orgId: raw.orgId,
    engineId: raw.engineId,
    // Le backend réel ne renvoie pas de `label` : repli sur l'engineId.
    label: raw.label ?? raw.engineId,
    domain: deriveDomain(raw),
    // Le backend réel ne renvoie pas de `status` : on le DÉRIVE de la sortie.
    status: deriveCalcStatus(raw),
    // Le backend nomme le champ "input", le front "params"
    params: (raw.input ?? {}) as Record<string, unknown>,
    // Métadonnée de conformité client-safe ({verdict}) — fail-closed.
    output: normalizeOutput(raw.output),
    // Sortie serveur whitelistée BRUTE, conservée pour les clones d'UI client (ADR
    // 0015 §4). Seul ToolFrame la lit ; `output` (ci-dessus) ne porte plus que le verdict.
    rawOutput: raw.output ?? undefined,
    pvId: raw.pvId ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    // `undefined`/`null` traités identiquement par nomAffiche — propagé tel
    // quel (jamais de chaîne vide fabriquée).
    name: raw.name ?? null,
  };
}

export function adaptCalcResults(raws: PrismaCalcResult[]): CalcResult[] {
  return raws.map(adaptCalcResult);
}

/**
 * Adapte la réponse de POST /projects/:id/calc/:engine (PersistedCalcResult)
 * vers CalcResult front.
 *
 * La forme PersistedCalcResult est DIFFÉRENTE de PrismaCalcResult (GET list) :
 *  - `calcResultId` → `id`
 *  - `meta.engineId` → `engineId`
 *  - `projectId`/`orgId`/`params` ne sont pas dans la réponse → passés en `context`
 *  - `ok: false` → status ERROR (rien persisté)
 *
 * Corrige le bug #2 : id/engineId/label/createdAt ne sont plus undefined après runCalc.
 */
export function adaptPersistedCalcResult(
  raw: BackendPersistedCalcResult,
  context: { orgId: string; projectId: string; params: Record<string, unknown> },
): CalcResult {
  const engineId = raw.meta.engineId;
  const now = new Date().toISOString();

  let status: CalcStatus;
  if (!raw.ok) {
    status = 'ERROR';
  } else if (raw.output != null) {
    status = 'DONE';
  } else {
    status = 'PENDING';
  }

  return {
    id: raw.calcResultId,
    projectId: context.projectId,
    orgId: context.orgId,
    engineId,
    label: engineId,
    domain: ENGINE_TO_DOMAIN[engineId] ?? 'CH',
    status,
    params: context.params,
    output: normalizeOutput(raw.output),
    // Sortie serveur whitelistée BRUTE (barrière §8 = contrat serveur) — livrée au
    // clone d'UI par ToolFrame (ADR 0015 §4).
    rawOutput: raw.output ?? undefined,
    pvId: undefined,
    createdAt: now,
    updatedAt: now,
    // Calcul tout juste créé : jamais de nom personnalisé à ce stade.
    name: null,
  };
}

// ---------------------------------------------------------------------------
// OfficialPv — robuste aux deux formes (plate emit / imbriquée list/get)
// ---------------------------------------------------------------------------

/**
 * Mappe le verdict SCELLÉ serveur (`official_pvs.verdict`, ADR 0012 —
 * CONFORME / NON_CONFORME / NON_APPLICABLE, cf. apps/api/src/pv/verdict.ts
 * resolveVerdict) vers le type front `'PASS' | 'FAIL' | 'NA'`. FAIL-CLOSED :
 * toute valeur inattendue (colonne absente, chaîne non reconnue) renvoie
 * `undefined` plutôt que de fabriquer un verdict — l'appelant traite alors
 * « pas de badge affiché », jamais un verdict inventé.
 */
function mapSealedVerdict(v: string | undefined): OfficialPv['verdict'] {
  if (v === 'CONFORME') return 'PASS';
  if (v === 'NON_CONFORME') return 'FAIL';
  if (v === 'NON_APPLICABLE') return 'NA';
  return undefined;
}

/**
 * Adapte un PV officiel vers le type front OfficialPv.
 *
 * Robuste aux DEUX formes de réponse backend :
 *  - Forme IMBRIQUÉE (GET /pvs, GET /pvs/:id) : `{ pv: {...}, sealValid?: boolean }`
 *  - Forme PLATE (POST /calc-results/:id/pv emit) : `OfficialPv` Prisma direct
 *
 * Détection : présence de la clé `pv` avec un objet = forme imbriquée,
 * sinon forme plate.
 *
 * Corrige le bug #4 : raw.pv.id ne crash plus sur la forme plate emit.
 *
 * #20 — sealedBy : extrait identity.userDisplayName de inputCanonical si disponible
 * (le nom d'émetteur est scellé dans le contenu canonique). Fallback = userId (UUID).
 */
export function adaptOfficialPv(
  raw: PrismaOfficialPv | PrismaOfficialPvFlat,
): OfficialPv {
  // Détection de la forme
  const isNested =
    'pv' in raw &&
    (raw as PrismaOfficialPv).pv != null &&
    typeof (raw as PrismaOfficialPv).pv === 'object';

  const p: PrismaOfficialPvCore = isNested
    ? (raw as PrismaOfficialPv).pv
    : (raw as PrismaOfficialPvFlat);
  // sealValid n'existe qu'à la racine de la forme imbriquée (GET /pvs, GET /pvs/:id) ;
  // absent en forme plate (POST emit) -> undefined, traité comme "non vérifié" par l'UI.
  const sealValid = isNested ? (raw as PrismaOfficialPv).sealValid : undefined;

  // Extraire params et, si possible, identity.userDisplayName depuis inputCanonical.
  // `params` = l'ENTRÉE UTILISATEUR (sa propre donnée tenant, saisie dans le formulaire,
  // transmise telle quelle au serveur). Ce n'est PAS un intermédiaire moteur confidentiel.
  // Le contenu canonique peut inclure d'autres champs (pvNumber, verdict…) ; on expose
  // l'objet entier pour l'affichage récapitulatif du PV — acceptable (données propres
  // au tenant).
  let params: Record<string, unknown> = {};
  let sealedBy: string = p.userId;
  try {
    const canonical = JSON.parse(p.inputCanonical ?? '{}') as Record<string, unknown>;
    params = canonical;
    // #20 — Nom de l'émetteur depuis identity.userDisplayName (scellé dans la canonique)
    const identity = canonical.identity as Record<string, unknown> | undefined;
    const displayName = identity?.userDisplayName;
    if (typeof displayName === 'string' && displayName.trim().length > 0) {
      sealedBy = displayName.trim();
    }
  } catch {
    /* inputCanonical illisible : params vide, sealedBy = userId (UUID) */
  }

  return {
    id: p.id,
    number: p.pvNumber,
    orgId: p.orgId,
    projectId: p.projectId,
    calcResultId: p.calcResultId,
    engineId: p.engineId,
    // 8 premiers caractères du HMAC (jamais le sceau complet côté navigateur)
    hmacTruncated: (p.hmac ?? '').slice(0, 8),
    sealedAt: p.sealedAt,
    sealedBy,
    pdfUrl: undefined,
    params,
    // MAJEUR-1 — output PV normalisé via le MÊME normalizeOutput fail-closed que
    // adaptCalcResult. Garantit qu'aucun intermédiaire confidentiel (famille §4.2,
    // propagateur, warnings, coefficients kc/kr/ks…) ne traverse vers le navigateur,
    // même si la whitelist serveur avait laissé passer un champ inattendu.
    // Sortie non reconnue → null (fail-closed).
    output: normalizeOutput(p.output),
    // Verdict SCELLÉ côté serveur (ADR 0012) — PAS une re-dérivation de `output`
    // (cf. `verdict.tsx` en-tête + normalizeOutput ci-dessus, utilisé pour
    // l'historique NON scellé uniquement).
    verdict: mapSealedVerdict(p.verdict),
    sealValid,
    // B1 (revue adverse) : 'html' seulement si le backend a effectivement scellé
    // un document client (calc_snapshots présent au moment de l'émission).
    documentFormat: p.documentFormat === 'html' ? 'html' : null,
    // Étiquette du PV — `undefined`/`null` traités identiquement par nomAffiche.
    name: p.name ?? null,
  };
}

export function adaptOfficialPvs(raws: PrismaOfficialPv[]): OfficialPv[] {
  return raws.map(adaptOfficialPv);
}

// ---------------------------------------------------------------------------
// Project — normalisation du domain
// ---------------------------------------------------------------------------

export function adaptProject(raw: PrismaProject): Project {
  return {
    id: raw.id,
    orgId: raw.orgId,
    name: raw.name,
    description: raw.description ?? undefined,
    // domain null (projet legacy) préservé tel quel — le filtrage front le tolère
    // (matchesDomain). Une chaîne connue est castée en ProjectDomain.
    domain: raw.domain === null ? null : (raw.domain as ProjectDomain),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    // #8 — le champ réel est `createdById` (Prisma: created_by_id), pas `createdBy`
    createdBy: raw.createdById,
    // P0-1 — compteurs servis par l'API. Propagés TELS QUELS : `0` doit rester
    // `0` (connu et vide) et l'absence rester `undefined` (pas encore connu).
    // Un `?? 0` ici ferait afficher « projet vide » avant même le chargement ;
    // un `|| undefined` effacerait un compteur légitime à zéro.
    calcCount: raw.calcCount,
    pvCount: raw.pvCount,
    // Même règle de propagation que les compteurs : tel quel, sans repli —
    // l'absence signifie « backend antérieur », pas « aucune activité ».
    lastActivityAt: raw.lastActivityAt,
    lastActivityKind: raw.lastActivityKind,
  };
}

export function adaptProjects(raws: PrismaProject[]): Project[] {
  return raws.map(adaptProject);
}

// ---------------------------------------------------------------------------
// Login — re-export direct (même forme)
// ---------------------------------------------------------------------------

export function adaptLoginResponse(raw: BackendLoginResponse): LoginResponse {
  // ⚠️ Le backend ne renvoie pas de `user` : lire `raw.user.*` sans garde levait une
  // exception → storeTokens jamais atteint → cookie jamais posé → login bloqué (rebond
  // /login). On dérive l'id depuis le claim `sub` du JWT ; email/name via /auth/me ensuite.
  let userId = '';
  try {
    const part = raw.accessToken.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    userId = ((JSON.parse(json) as { sub?: string })?.sub ?? '') as string;
  } catch {
    /* token illisible : id vide, le login passe quand même */
  }
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    user: raw.user ?? { id: userId, email: '', name: '' },
  };
}

/**
 * Adapte le profil GET /auth/me vers la forme stockée en session.
 * Mapping : userId→id, fullName→name, email→email.
 * Compatibilité : Sidebar/Topbar/page Compte lisent `user.name` et `user.email`.
 */
export function adaptUserProfile(raw: BackendUserProfile): {
  id: string;
  email: string;
  name: string;
} {
  return {
    id: raw.userId,
    email: raw.email,
    name: raw.fullName,
  };
}

// ---------------------------------------------------------------------------
// Entitlements — re-export direct (même forme ADR 0011)
// ---------------------------------------------------------------------------

export function adaptEntitlements(raw: BackendEntitlements): EntitlementsResponse {
  return {
    orgId: raw.orgId,
    pack: raw.pack as EntitlementsResponse['pack'],
    modules: raw.modules,
    expiresAt: raw.expiresAt,
    expired: raw.expired,
    quota: {
      limit: raw.quota.limit,
      used: raw.quota.used,
      remaining: raw.quota.remaining,
    },
    serverTime: raw.serverTime,
  };
}
