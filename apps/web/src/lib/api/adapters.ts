/**
 * Adaptateurs — mapping ligne Prisma (backend) vers types front ROADSEN.
 *
 * Le backend renvoie les lignes brutes Prisma : `input`/`output`/`engineId`/`status`…
 * Ces fonctions normalisent vers les types front (CalcResult, OfficialPv, etc.)
 * sans aucune logique de calcul côté client.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import type {
  CalcResult,
  CalcStatus,
  CalcOutputRow,
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
  domain: string;
  createdAt: string;
  updatedAt: string;
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
  'labo-classification-gtr': 'LB',
  // URL slugs (:engine dans les routes backend) — compatibilité fixtures de test
  burmister: 'CH',
  terzaghi: 'FD',
  pieux: 'FD',
  radier: 'FD',
  pressiometre: 'LB',
  labo: 'LB',
};

function deriveDomain(raw: PrismaCalcResult): ProjectDomain {
  if (raw.domain === 'CH' || raw.domain === 'FD' || raw.domain === 'LB') return raw.domain;
  return ENGINE_TO_DOMAIN[raw.engineId] ?? 'CH';
}

/** Nombre fini, sinon null (garde-fou anti-NaN à l'affichage). */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pushRow(
  rows: CalcOutputRow[],
  label: string,
  value: unknown,
  unit: string,
  status?: 'ok' | 'fail',
): void {
  const n = finiteOrNull(value);
  if (n === null) return; // valeur absente/null/NaN → ligne omise (jamais de "NaN" affiché)
  rows.push(status ? { label, value: n, unit, status } : { label, value: n, unit });
}

/**
 * CONTRAT client-safe du moteur chaussee-burmister.
 *
 * Construit les lignes affichables UNIQUEMENT à partir des champs whitelistés
 * par `BurmisterOutputSchema` (engines), qui sont déjà strippés côté serveur de
 * tout intermédiaire confidentiel (tenseur de contraintes, coefficients de
 * calage kr/ks/kc/Sh/b/ε₆, ABCD du propagateur). Défense en profondeur : même si
 * un champ confidentiel survivait au strip serveur, il N'apparaîtrait PAS ici car
 * on ne lit que des clés NOMMÉES (fail-closed — pas de copie d'objet brut).
 *
 * Inclus (grandeurs de RÉSULTAT d'ingénierie) : NE, épaisseurs, déformation/
 * contrainte sollicitante vs admissible (fatigue + orniérage) + verdict/critère.
 * Exclus : `famille` (libellé citant une §méthode — fail-closed, non rendu par le
 * panneau ; réouverture = décision explicite), `warnings`/`erreur` (texte libre,
 * canal séparé), `conforme` (porté par le verdict, pas une ligne numérique).
 */
function buildBurmisterRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];

  pushRow(rows, 'Trafic cumulé (NE)', o.NE, 'essieux éq.');
  pushRow(rows, 'Épaisseur totale', o.epaisseurTotale, 'm');
  pushRow(rows, 'Épaisseur de couches liées', o.epaisseurLiee, 'm');

  const f = o.fatigue;
  if (f != null && typeof f === 'object') {
    const fa = f as { rigide?: unknown; valeur?: unknown; admissible?: unknown; ok?: unknown };
    const rigide = fa.rigide === true;
    const unit = rigide ? 'MPa' : 'μdef';
    const fok: 'ok' | 'fail' = fa.ok === true ? 'ok' : 'fail';
    pushRow(
      rows,
      rigide ? 'Contrainte sollicitante σ_t' : 'Déformation sollicitante ε_t',
      fa.valeur,
      unit,
      fok,
    );
    pushRow(
      rows,
      rigide ? 'Contrainte admissible σ_t,adm' : 'Déformation admissible ε_t,adm',
      fa.admissible,
      unit,
    );
  }

  const orn = o.ornierage;
  if (orn != null && typeof orn === 'object') {
    const oa = orn as { valeur?: unknown; admissible?: unknown; ok?: unknown };
    const ok: 'ok' | 'fail' = oa.ok === true ? 'ok' : 'fail';
    pushRow(rows, 'Déformation ε_z sollicitante (PSC)', oa.valeur, 'μdef', ok);
    pushRow(rows, 'Déformation ε_z admissible', oa.admissible, 'μdef');
  }

  return rows;
}

/** Libellés d'état-limite (affichage). */
const TERZAGHI_ETAT_LABEL: Record<string, string> = {
  ELU_F: 'ELU fond.',
  ELU_A: 'ELU acc.',
  ELS_C: 'ELS car.',
  ELS_F: 'ELS fréq.',
  ELS_QP: 'ELS q.perm.',
};

/**
 * CONTRAT client-safe du moteur terzaghi (fondation superficielle, NF P 94-261).
 * Lit UNIQUEMENT les champs de RÉSULTAT whitelistés par `TerzaghiOutputSchema`
 * (par cas = charge × état-limite) : Rtot, qRvd, taux, portanceOk, Rhd, tauxH,
 * glissementOk, tassement(s). Exclus : `warnings`/`erreur` (texte libre, canal
 * séparé), `idx`/`invalide` (internes). Aucune copie d'objet brut (clés nommées
 * seulement, fail-closed — cohérent avec buildBurmisterRows / DoD §8).
 */
function buildTerzaghiRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  const cas = Array.isArray(o.cas) ? o.cas : [];
  for (const item of cas) {
    if (item == null || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (c.invalide === true) continue;
    const et = typeof c.etat === 'string' ? (TERZAGHI_ETAT_LABEL[c.etat] ?? c.etat) : '—';
    const pOk: 'ok' | 'fail' = c.portanceOk === true ? 'ok' : 'fail';
    pushRow(rows, `${et} — résistance Rᵥ;d`, c.Rtot, 'kN', pOk);
    pushRow(rows, `${et} — contrainte adm. q_Rv;d`, c.qRvd, 'kPa');
    const taux = finiteOrNull(c.taux);
    if (taux !== null) rows.push({ label: `${et} — taux de mobilisation`, value: taux * 100, unit: '%', status: pOk });
    if (c.Rhd != null) {
      const gOk: 'ok' | 'fail' = c.glissementOk === true ? 'ok' : 'fail';
      pushRow(rows, `${et} — résistance au glissement R_h;d`, c.Rhd, 'kN', gOk);
      const tH = finiteOrNull(c.tauxH);
      if (tH !== null) rows.push({ label: `${et} — taux glissement`, value: tH * 100, unit: '%', status: gOk });
    }
    pushRow(rows, `${et} — tassement`, c.tassement, 'mm');
    pushRow(rows, `${et} — tassement (Schmertmann)`, c.tassementSchmertmann, 'mm');
    pushRow(rows, `${et} — tassement œdométrique`, c.tassementOed, 'mm');
  }
  return rows;
}

/** Verdict global terzaghi : tous les cas valides portants (et stables au glissement si évalué). */
function terzaghiVerdict(o: Record<string, unknown>): 'PASS' | 'FAIL' {
  const cas = Array.isArray(o.cas) ? o.cas : [];
  const valid = cas.filter(
    (c): c is Record<string, unknown> =>
      c != null && typeof c === 'object' && (c as Record<string, unknown>).invalide !== true,
  );
  if (valid.length === 0) return 'FAIL';
  return valid.every(
    (c) => c.portanceOk === true && (c.glissementOk === undefined || c.glissementOk === true),
  )
    ? 'PASS'
    : 'FAIL';
}

/**
 * CONTRAT client-safe du moteur pieux (fondation profonde, NF P 94-262 / EC7).
 * Lit UNIQUEMENT les résultats whitelistés par PieuxOutputSchema : résistances
 * (Rb;k, Rs;k, Rc;k, Rc;d), sollicitation ELU, taux (calculé Fd/Rc;d), tassement ELS,
 * + vérifications par combinaison. Exclut warnings/erreur + échos non numériques.
 * Clés nommées uniquement (fail-closed, DoD §8).
 */
function buildPieuxRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  const okElu: 'ok' | 'fail' = o.allOk === true ? 'ok' : 'fail';
  pushRow(rows, 'Résistance de pointe Rb;k', o.RbK, 'kN');
  pushRow(rows, 'Résistance de frottement Rs;k', o.RsK, 'kN');
  pushRow(rows, 'Résistance caractéristique Rc;k', o.RcK, 'kN');
  pushRow(rows, 'Résistance de calcul Rc;d', o.RcD, 'kN');
  pushRow(rows, 'Sollicitation ELU Fd', o.FduELU, 'kN', okElu);
  const fd = finiteOrNull(o.FduELU);
  const rcd = finiteOrNull(o.RcD);
  if (fd !== null && rcd !== null && rcd !== 0) {
    rows.push({ label: 'Taux de mobilisation ELU', value: (fd / rcd) * 100, unit: '%', status: okElu });
  }
  pushRow(rows, 'Tassement estimé (ELS)', o.tassementELS, 'mm');
  const verifs = Array.isArray(o.verifications) ? o.verifications : [];
  for (const v of verifs) {
    if (v == null || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    const nom = typeof c.nom === 'string' ? c.nom : 'Vérification';
    const fdv = finiteOrNull(c.Fd);
    const rdv = finiteOrNull(c.Rd);
    const st: 'ok' | 'fail' = fdv !== null && rdv !== null && fdv <= rdv ? 'ok' : 'fail';
    pushRow(rows, `${nom} — sollicitation Fd`, c.Fd, 'kN', st);
    pushRow(rows, `${nom} — résistance Rd`, c.Rd, 'kN');
  }
  return rows;
}

/**
 * Re-whiteliste un tableau de lignes : ne garde QUE `{label, value, unit, status?}`
 * par ligne, jamais de spread du brut. Toute ligne incomplète/non finie est écartée.
 */
function sanitizeRows(rows: unknown): CalcOutputRow[] {
  if (!Array.isArray(rows)) return [];
  const out: CalcOutputRow[] = [];
  for (const r of rows) {
    if (r == null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const value = finiteOrNull(o.value);
    if (value === null || typeof o.label !== 'string' || typeof o.unit !== 'string') continue;
    const status = o.status === 'ok' || o.status === 'fail' ? o.status : undefined;
    out.push(status ? { label: o.label, value, unit: o.unit, status } : { label: o.label, value, unit: o.unit });
  }
  return out;
}

/**
 * Normalise la sortie moteur vers la forme attendue par l'UI ({verdict, rows}).
 *
 * STRICTEMENT FAIL-CLOSED (DoD §8) — ne renvoie JAMAIS l'objet brut : la sortie
 * moteur peut contenir des intermédiaires/méthode/coefficients/warnings
 * confidentiels, et tous les moteurs (terzaghi/casagrande/geoplaque/pressiometre/
 * fastlab) sont sélectionnables.
 *  - null / non-objet                         → null
 *  - sortie BRUTE burmister (`conforme:boolean`) → {verdict, rows} whitelistées
 *  - sortie déjà normalisée (`verdict:string` + `rows:[]`) → re-whitelistée via
 *    `sanitizeRows` (re-projetée, jamais copiée telle quelle)
 *  - moteur NON reconnu                        → null (AUCUNE donnée brute exposée)
 *
 * SUIVI Phase 1 : les moteurs fondations/labo afficheront « résultat non
 * affichable » tant qu'un builder whitelisté dédié (`buildTerzaghiRows`…) n'existe
 * pas — comportement correct (mieux vaut rien afficher que fuiter la science).
 */
function normalizeOutput(output: unknown): NormalizedCalcOutput | null {
  if (output == null || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  if (typeof o.conforme === 'boolean') {
    return { verdict: o.conforme === true ? 'PASS' : 'FAIL', rows: buildBurmisterRows(o) };
  }
  if (typeof o.verdict === 'string' && Array.isArray(o.rows)) {
    return { verdict: o.verdict === 'PASS' ? 'PASS' : 'FAIL', rows: sanitizeRows(o.rows) };
  }
  // terzaghi (fondation superficielle) : sortie {cas:[…]} → whitelist par cas
  if (Array.isArray(o.cas)) {
    return { verdict: terzaghiVerdict(o), rows: buildTerzaghiRows(o) };
  }
  // pieux (fondation profonde) : verdict global booléen `allOk` + résistances
  if (typeof o.allOk === 'boolean') {
    return { verdict: o.allOk === true ? 'PASS' : 'FAIL', rows: buildPieuxRows(o) };
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
    // Sortie normalisée client-safe ({verdict, rows}) — fail-closed.
    output: normalizeOutput(raw.output),
    pvId: raw.pvId ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
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
    pvId: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// OfficialPv — robuste aux deux formes (plate emit / imbriquée list/get)
// ---------------------------------------------------------------------------

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
export function adaptOfficialPv(raw: PrismaOfficialPv | PrismaOfficialPvFlat): OfficialPv {
  // Détection de la forme
  const isNested =
    'pv' in raw &&
    (raw as PrismaOfficialPv).pv != null &&
    typeof (raw as PrismaOfficialPv).pv === 'object';

  const p: PrismaOfficialPvCore = isNested
    ? (raw as PrismaOfficialPv).pv
    : (raw as PrismaOfficialPvFlat);

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
    domain: raw.domain as ProjectDomain,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    // #8 — le champ réel est `createdById` (Prisma: created_by_id), pas `createdBy`
    createdBy: raw.createdById,
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
export function adaptUserProfile(raw: BackendUserProfile): { id: string; email: string; name: string } {
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
