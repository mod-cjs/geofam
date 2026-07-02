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
    // Fail-closed (DoD §8) : état non reconnu → placeholder neutre, JAMAIS le texte
    // moteur brut (la map couvre l'ensemble complet ELU_F/A · ELS_C/F/QP).
    const et = typeof c.etat === 'string' ? (TERZAGHI_ETAT_LABEL[c.etat] ?? '—') : '—';
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
    pushRow(rows, `${et} — tassement`, c.tassement, 'm');
    pushRow(rows, `${et} — tassement (Schmertmann)`, c.tassementSchmertmann, 'm');
    pushRow(rows, `${et} — tassement œdométrique`, c.tassementOed, 'm');
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
 * Allowlist fail-closed des libellés de vérification pieux (EC7). Le moteur compose
 * `nom` soit comme un ELS fixe, soit `«ELU portance|traction» — «combinaison EC7»`.
 * On ne laisse traverser QUE des valeurs reconnues (état-limite + combinaison connus) ;
 * tout `nom` inattendu → libellé générique indexé, pour qu'aucun texte moteur non
 * whitelisté n'atteigne le navigateur (DoD §8). Ajouter ici toute nouvelle combinaison
 * EC7 introduite côté moteur (sinon elle s'affiche « Vérification N », jamais brute).
 */
const PIEUX_ELS_LABELS: ReadonlySet<string> = new Set(['ELS caractéristique', 'ELS quasi-permanent']);
const PIEUX_ELU_PREFIXES: ReadonlySet<string> = new Set(['ELU portance', 'ELU traction']);
const PIEUX_ELU_COMBOS: ReadonlySet<string> = new Set(['DA1·C1', 'DA1·C2', 'DA2', 'DA3']);

/** Sépare `nom` en (état-limite, combinaison) et ne le renvoie que si les DEUX sont whitelistés. */
function safePieuxVerifLabel(rawNom: unknown, index: number): string {
  const fallback = `Vérification ${index}`;
  if (typeof rawNom !== 'string') return fallback;
  if (PIEUX_ELS_LABELS.has(rawNom)) return rawNom;
  const sep = rawNom.indexOf(' — ');
  if (sep > 0) {
    const prefix = rawNom.slice(0, sep);
    const combo = rawNom.slice(sep + 3);
    if (PIEUX_ELU_PREFIXES.has(prefix) && PIEUX_ELU_COMBOS.has(combo)) return rawNom;
  }
  return fallback;
}

/**
 * CONTRAT client-safe du moteur pieux (fondation profonde, NF P 94-262 / EC7).
 * Lit UNIQUEMENT les résultats whitelistés par PieuxOutputSchema : résistances
 * (Rb;k, Rs;k, Rc;k, Rc;d), sollicitation ELU, taux (calculé Fd/Rc;d), tassement ELS,
 * + vérifications par combinaison. Exclut warnings/erreur + échos non numériques.
 * Libellés de vérification whitelistés (safePieuxVerifLabel). Fail-closed, DoD §8.
 */
function buildPieuxRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  const okGov: 'ok' | 'fail' = o.allOk === true ? 'ok' : 'fail';
  // COMPLÉTUDE + ordre de l'outil d'origine casagrande_V5 : taux gouvernant → résistances
  // (pointe R_b;k, frottement R_s;k, caractéristique R_c;k, calcul R_c;d, fluage R_c;cr;k)
  // → tassement ELS → vérifications par état-limite (Fd/Rd).
  const tg = finiteOrNull(o.tauxGouvernant);
  if (tg !== null) rows.push({ label: 'Taux de travail gouvernant', value: tg * 100, unit: '%', status: okGov });
  pushRow(rows, 'Résistance de pointe R_b;k', o.RbK, 'kN');
  pushRow(rows, 'Résistance de frottement R_s;k', o.RsK, 'kN');
  pushRow(rows, 'Résistance caractéristique R_c;k', o.RcK, 'kN');
  pushRow(rows, 'Résistance de calcul R_c;d', o.RcD, 'kN');
  pushRow(rows, 'Charge de fluage R_c;cr;k', o.RcrK, 'kN');
  pushRow(rows, 'Tassement estimé (ELS)', o.tassementELS, 'mm');
  const verifs = Array.isArray(o.verifications) ? o.verifications : [];
  let verifIdx = 0;
  for (const v of verifs) {
    if (v == null || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    verifIdx += 1;
    const nom = safePieuxVerifLabel(c.nom, verifIdx);
    const fdv = finiteOrNull(c.Fd);
    const rdv = finiteOrNull(c.Rd);
    const st: 'ok' | 'fail' = fdv !== null && rdv !== null && fdv <= rdv ? 'ok' : 'fail';
    pushRow(rows, `${nom} — sollicitation Fd`, c.Fd, 'kN', st);
    pushRow(rows, `${nom} — résistance Rd`, c.Rd, 'kN');
  }
  return rows;
}

/** Ligne TEXTUELLE (résultat non numérique : classe, catégorie…). Vide → ignorée. */
function pushText(rows: CalcOutputRow[], label: string, value: unknown, unit = ''): void {
  if (typeof value !== 'string' || value.trim() === '') return;
  rows.push({ label, value: value.trim(), unit });
}

/**
 * radier / plaque sur sol multicouche (EF) — déflexions & distorsions.
 * Moteur d'analyse (pas de verdict de conformité). Clés nommées (fail-closed §8).
 */
function buildRadierRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  // UNITÉS radier — TRANCHÉ (preuve : physique + solveModel de référence identique au bit
  // près à notre port + cohérence inter-cas). Le solveur sort ses déplacements
  // NUMÉRIQUEMENT en mm (piège d'unité E-en-MPa × charges-en-kN × géométrie-en-m) → les
  // tassements sont en mm et la distorsion (Δw/L) en ‰ (= 10⁻³ rad). Vérifié sur cas SANS
  // singularité (radier 6×6, charge surfacique 50 kPa, limon E=8 MPa → wMax=6,25 mm ; 6,25 m
  // ou 6251 mm seraient physiquement impossibles). NB : l'annotation « m/rad » du contrat
  // décrit l'unité SI VISÉE, pas la sortie numérique ; l'outil GEOPLAQUE_V10 du client
  // affiche wMax*1000 (sur-rapport ×1000) — on ne le copie pas.
  // COMPLÉTUDE : on affiche TOUS les diagnostics client-safe du RadierOutputSchema,
  // dans l'ordre du tableau EC7 de l'outil d'origine GEOPLAQUE_V10 (tassements →
  // distorsion gouvernante → intra → inclinaison → pente → inter-plaques → entre
  // charges → nombre). Les rangs inter-plaques / entre-charges ne s'affichent que
  // s'ils s'appliquent (comme l'outil d'origine).
  pushRow(rows, 'Tassement maximal w_max', o.wMax, 'mm');
  pushRow(rows, 'Tassement minimal w_min', o.wMin, 'mm');
  pushRow(rows, 'Tassement différentiel', o.diff, 'mm');
  pushRow(rows, 'Distorsion angulaire gouvernante β', o.betaGov, '‰');
  pushRow(rows, 'Distorsion intra-plaque max', o.betaIntra, '‰');
  pushRow(rows, "Inclinaison d'ensemble ϖ", o.tiltMax, '‰');
  pushRow(rows, 'Pente locale max |∇w|', o.slopeMax, '‰');
  const nRafts = finiteOrNull(o.nRafts);
  if (nRafts !== null && nRafts > 1) {
    pushRow(rows, 'Distorsion entre plaques', o.betaInter, '‰');
    pushRow(rows, 'Tassement différentiel inter-plaques', o.interDiff, 'mm');
  }
  const wlp = o.worstLoadPair;
  if (wlp != null && typeof wlp === 'object') {
    pushRow(rows, 'Distorsion max entre charges voisines', (wlp as Record<string, unknown>).beta, '‰');
  }
  pushRow(rows, 'Nombre de radiers', o.nRafts, '');
  return rows;
}

/**
 * labo — classification GTR (NF P 11-300) + paramètres d'identification.
 * La classe est un RÉSULTAT textuel. Clés nommées (fail-closed §8).
 */
function buildLaboRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  const cl = o.classe;
  if (cl != null && typeof cl === 'object') {
    const c = cl as Record<string, unknown>;
    // `code`/`full` contiennent DÉJÀ la lettre de famille (ex. code='A2', full='A2 h') :
    // concaténer `fam` la dupliquerait ('A'+'A2'='AA2'). On prend le libellé canonique
    // du moteur (`full` = classe + état hydrique), repli sur `code`. `desc` (texte long)
    // et `path` (justification, méthode) NE sont PAS exposés — fail-closed §8.
    const full = typeof c.full === 'string' ? c.full.trim() : '';
    const code = c.code != null && c.code !== '' ? String(c.code).trim() : '';
    const label = full || code;
    if (label) rows.push({ label: 'Classe GTR', value: label, unit: '' });
  }
  // COMPLÉTUDE : tous les résultats client-safe (multi-essais A/B/C/D). pushRow saute
  // automatiquement les champs non renseignés (null) selon l'essai réalisé.
  // — Identification (granulo / Atterberg / bleu)
  pushRow(rows, 'Dmax', o.dmax, 'mm');
  pushRow(rows, 'Passant à 80 µm', o.p80, '%');
  pushRow(rows, 'Passant à 2 mm', o.p2, '%');
  pushRow(rows, 'Teneur en eau naturelle w_n', o.wn, '%');
  pushRow(rows, 'Limite de liquidité w_L', o.wl, '%');
  pushRow(rows, 'Limite de plasticité w_P', o.wp, '%');
  pushRow(rows, 'Indice de plasticité I_P', o.ip, '');
  pushRow(rows, 'Indice de consistance I_C', o.ic, '');
  pushRow(rows, 'Valeur au bleu VBS', o.vbs, '');
  // — Proctor / portance (lot B)
  pushRow(rows, 'Teneur en eau optimale w_OPN', o.wopn, '%');
  pushRow(rows, 'Densité sèche max ρ_d;max', o.rdmax, 't/m³');
  pushRow(rows, 'Indice CBR', o.cbr, '');
  // — Œdomètre (lot C)
  pushRow(rows, 'Indice des vides initial e₀', o.e0_oedo, '');
  pushRow(rows, 'Indice de compression Cc', o.Cc_oedo, '');
  pushRow(rows, 'Indice de gonflement Cs', o.Cs_oedo, '');
  // — Cisaillement (lot D)
  pushRow(rows, "Cohésion c'", o.c_cis, 'kPa');
  pushRow(rows, "Angle de frottement φ'", o.phi_cis, '°');
  return rows;
}

/**
 * pressiomètre Ménard — dépouillement (p_L, E_M, catégorie de sol).
 * `categorieLibelle`/`consolidation` = résultats textuels. Clés nommées (fail-closed §8).
 */
function buildPressiometreRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Pression limite p_L', o.pL, 'bar');
  pushRow(rows, 'Pression limite nette p_L*', o.pLNette, 'bar');
  pushRow(rows, 'Pression de fluage nette p_f*', o.pfNette, 'bar');
  pushRow(rows, 'Module pressiométrique E_M', o.EM, 'MPa');
  pushRow(rows, 'Rapport E_M / p_L*', o.ratioEMpL, '');
  pushText(rows, 'Catégorie de sol', o.categorieLibelle);
  pushText(rows, 'État de consolidation', o.consolidation);
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
  // radier (plaque/sol multicouche) : déflexions/distorsions — pas de verdict (NA)
  if (typeof o.betaGov === 'number' || 'nRafts' in o) {
    return { verdict: 'NA', rows: buildRadierRows(o) };
  }
  // labo (classification GTR) : classe + paramètres — pas de verdict (NA)
  if (o.classe != null && typeof o.classe === 'object') {
    return { verdict: 'NA', rows: buildLaboRows(o) };
  }
  // pressiomètre Ménard (dépouillement) : pL/EM/catégorie — pas de verdict (NA)
  if ('categorie' in o && ('pL' in o || 'ratioEMpL' in o)) {
    return { verdict: 'NA', rows: buildPressiometreRows(o) };
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
