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
  HeatmapData,
  ProfilData,
  OfficialPv,
  EntitlementsResponse,
  Project,
  ProjectDomain,
  LoginResponse,
  PressioNormalized,
  PressioDepouillement,
  PressioCourbePoint,
  PressioEtalonnageResidu,
  PressioCalibrageResidu,
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
 * Familles de structure client-safe (catégories LCPC-SETRA §4.2-4.5, PUBLIQUES),
 * en libellé NU sans discriminant. Doublon VOLONTAIRE de l'allowlist du contrat
 * moteur (`FAMILLES_STRUCTURE`) : le front NE peut PAS importer @roadsen/engines
 * (DoD §8). Ces noms de catégorie ne sont PAS confidentiels ; seul le ratio de
 * rigidité Kmix calculé l'est — il ne doit jamais apparaître.
 * ORDRE : préfixes les plus LONGS d'abord (« souple à faible trafic » avant « souple »).
 */
const BURMISTER_FAMILLES: readonly string[] = [
  'bitumineuse épaisse',
  'souple à faible trafic',
  'souple',
  'semi-rigide',
  'mixte',
  'inverse',
  'granulaire',
];
const BURMISTER_FAMILLE_GENERIQUE = 'structure non catégorisée';

/**
 * Nettoie (fail-closed, DoD §8) un libellé de famille potentiellement corrompu en
 * un libellé d'allowlist NU. Défense en profondeur : même si un output persisté /
 * ancien portait « mixte (§4.4, K=0.62) », on n'affiche que « mixte » — jamais le
 * discriminant Kmix. Non reconnu / non-chaîne → générique.
 */
function safeBurmisterFamille(raw: unknown): string {
  if (typeof raw !== 'string') return BURMISTER_FAMILLE_GENERIQUE;
  const s = raw.trim().toLowerCase();
  if (s === '') return BURMISTER_FAMILLE_GENERIQUE;
  for (const fam of BURMISTER_FAMILLES) {
    if (s.startsWith(fam.toLowerCase())) return fam;
  }
  return BURMISTER_FAMILLE_GENERIQUE;
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
 * Inclus (grandeurs de RÉSULTAT d'ingénierie) : famille (libellé NU nettoyé, aligné
 * avec le PV), NE, épaisseurs, déformation/contrainte sollicitante vs admissible
 * (fatigue + orniérage) + verdict/critère. La `famille` passe par
 * `safeBurmisterFamille` : jamais le discriminant Kmix ni la référence §méthode
 * (FUITE #1 / issue #81). Exclus : `warnings`/`erreur` (texte libre, canal séparé),
 * `conforme` (porté par le verdict, pas une ligne numérique).
 */
/**
 * Statut d'affichage d'un critère PLIÉ ou non dans le verdict `conforme` (§8,
 * booléen public). `requis===false` -> INFORMATIF : status `undefined` (aucun picto
 * ✓/✗) pour qu'un critère non exigé ne contredise JAMAIS un verdict PASS (MAJEUR-1).
 * `requis` absent/undefined -> traité comme requis (rétro-compat des sorties sans le
 * flag). Sinon status dérivé de `ok`.
 */
function requisStatus(requis: unknown, ok: unknown): 'ok' | 'fail' | undefined {
  if (requis === false) return undefined;
  return ok === true ? 'ok' : 'fail';
}

function buildBurmisterRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];

  // Famille de structure — libellé NU nettoyé (fail-closed §8), aligné avec le PV.
  rows.push({
    label: 'Famille de structure',
    value: safeBurmisterFamille(o.famille),
    unit: '',
  });

  pushRow(rows, 'Trafic cumulé (NE)', o.NE, 'essieux éq.');
  pushRow(rows, 'Épaisseur totale', o.epaisseurTotale, 'm');
  pushRow(rows, 'Épaisseur de couches liées', o.epaisseurLiee, 'm');

  const f = o.fatigue;
  if (f != null && typeof f === 'object') {
    const fa = f as {
      rigide?: unknown;
      valeur?: unknown;
      admissible?: unknown;
      ok?: unknown;
      requis?: unknown;
      referenceCatalogue?: unknown;
    };
    const rigide = fa.rigide === true;
    const unit = rigide ? 'MPa' : 'μdef';
    // MAJEUR-1 : un critère NON requis (souple à faible trafic) est INFORMATIF —
    // pas de status ✓/✗ (sinon un ✗ rouge cohabiterait avec un verdict PASS). Le
    // verdict `conforme` ne plie que les critères requis ; l'affichage doit refléter
    // ce périmètre. `requis` absent/undefined -> traité comme requis (rétro-compat).
    const fok: 'ok' | 'fail' | undefined = requisStatus(fa.requis, fa.ok);
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
    // ε₆/σ₆ du matériau dimensionnant — grandeur PUBLIQUE du catalogue AGEROUTE,
    // exposée délibérément par le moteur (fatigue.referenceCatalogue) ; la
    // définitive l'édite en clair (« Matériau dimensionnant »). Les coefficients
    // de calage (b, kc, SN, kθ…) restent, eux, côté serveur (DoD §8). null
    // (e6 infini) ou champ absent (ancien calcul) → aucune ligne (pushRow).
    pushRow(
      rows,
      rigide ? 'Référence catalogue σ₆' : 'Référence catalogue ε₆',
      fa.referenceCatalogue,
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

  // Critère SECONDAIRE — phase 2 des structures MIXTES (§4.4.1) : ε_t (μdef) à la
  // base bitumineuse (MTLH fissuré E/5 + interface glissante). Affiché SEULEMENT
  // quand applicable (objet non-null) — sinon la structure n'est pas concernée.
  const p2 = o.fatiguePhase2;
  if (p2 != null && typeof p2 === 'object') {
    const pa = p2 as {
      valeur?: unknown;
      admissible?: unknown;
      ok?: unknown;
      requis?: unknown;
      couche?: unknown;
    };
    const suffix = typeof pa.couche === 'number' ? ` (couche ${pa.couche})` : '';
    // MAJEUR-1 : phase 2 non requise (semi-rigide Kmix<0,5) -> informatif (pas de ✗).
    const pok = requisStatus(pa.requis, pa.ok);
    pushRow(
      rows,
      `Fatigue phase 2 — base bitumineuse ε_t${suffix}`,
      pa.valeur,
      'μdef',
      pok,
    );
    pushRow(rows, 'Fatigue phase 2 — ε_t admissible', pa.admissible, 'μdef');
  }

  // Critère SECONDAIRE — structures INVERSES (§4.5) : σ_t (MPa) à la base du
  // segment MTLH profond. Affiché SEULEMENT quand applicable.
  const inv = o.fatigueInverse;
  if (inv != null && typeof inv === 'object') {
    const ia = inv as {
      valeur?: unknown;
      admissible?: unknown;
      ok?: unknown;
      requis?: unknown;
      couche?: unknown;
    };
    const suffix = typeof ia.couche === 'number' ? ` (couche ${ia.couche})` : '';
    // Inverse : toujours requis (okSt2 toujours plié) — chemin symétrique.
    const iok = requisStatus(ia.requis, ia.ok);
    pushRow(
      rows,
      `Structure inverse — base MTLH profond σ_t${suffix}`,
      ia.valeur,
      'MPa',
      iok,
    );
    pushRow(rows, 'Structure inverse — σ_t admissible', ia.admissible, 'MPa');
  }

  return rows;
}

/**
 * DÉTAILS DE CALCUL burmister — intermédiaires de MÉTHODE PUBLICS (rescope §8
 * « méthode transparente »). Lit UNIQUEMENT les champs NOMMÉS de `o.details`
 * (déjà whitelistés par `DetailsSchema` côté serveur) ; fail-closed : aucune
 * copie d'objet brut.
 *
 * Décision titulaire 13/07 (« zéro écart » avec la définitive du client) : les
 * coefficients de méthode kθ/SN/Sh/δ/kr/kc/ks/1/b, l'admissible à r=50 % et
 * σ_z/σ_r PSC sont désormais exposés eux aussi (ne sont plus masqués « non
 * exposé côté client »). Ce sont des RÉSULTATS intermédiaires PUBLICS de la
 * méthode LCPC 1994/AGEROUTE 2015 — le DoD §8 protège le CODE du moteur (son
 * implémentation), pas ces nombres, déjà affichés en clair par l'outil de
 * référence du client.
 */
function buildBurmisterDetails(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  // Structure rigide (σt en MPa) vs souple (εt en μdef) — même dérivation que
  // buildBurmisterRows ; nécessaire pour l'unité de « Adm. fatigue r=50 % ».
  const fRaw = o.fatigue;
  const fRigide =
    fRaw != null &&
    typeof fRaw === 'object' &&
    (fRaw as { rigide?: unknown }).rigide === true;

  // Intermédiaires de méthode (o.details) — présents en fonctionnement normal,
  // absents sur le chemin d'erreur. Le détail PAR COUCHE (couchesTraitees /
  // couchesGranulaires) est INDÉPENDANT de cet objet (champs de sortie racine).
  const d = o.details;
  if (d != null && typeof d === 'object') {
    const g = d as Record<string, unknown>;
    pushRow(rows, 'Module pondéré du paquet lié Ē₁', g.E1_pond, 'MPa');
    pushRow(rows, 'Coefficient de Poisson pondéré ν̄₁', g.nu1_pond, '');
    pushRow(rows, 'Module plateforme support (PSC)', g.E_psc, 'MPa');
    pushRow(rows, 'ν plateforme support', g.nu_psc, '');
    pushRow(rows, 'Risque effectif', g.risque_pct, '%');
    pushRow(rows, 'σ_z interface critique (r=0)', g.sigmaZ_r0, 'kPa');
    pushRow(rows, 'σ_r interface critique (r=0)', g.sigmaR_r0, 'kPa');
    pushRow(rows, 'σ_z entre roues (r=d/2, ×2)', g.sigmaZ_d2, 'kPa');
    pushRow(rows, 'σ_r entre roues (r=d/2, ×2)', g.sigmaR_d2, 'kPa');
    pushRow(rows, 'ε_t sous roue (r=0)', g.epsilonT_r0, 'μdef');
    pushRow(rows, 'ε_t entre roues (r=d/2)', g.epsilonT_d2, 'μdef');
    pushRow(rows, 'ε_t retenue (max)', g.epsilonT, 'μdef');
    pushRow(rows, 'ε_t admissible', g.epsilonT_adm, 'μdef');
    pushRow(rows, 'ε_z axe de roue (sommet PSC)', g.epsilonZ_axe, 'μdef');
    pushRow(rows, 'ε_z entre-jumelage', g.epsilonZ_mid, 'μdef');
    pushRow(rows, 'ε_z retenue (max)', g.epsilonZ, 'μdef');
    pushRow(rows, 'ε_z admissible', g.epsilonZ_adm, 'μdef');

    // Coefficients de MÉTHODE, désormais exposés (cf. docstring ci-dessus). Labels
    // choisis pour n'être JAMAIS préfixe d'un autre label (garde-fou fail-closed de
    // `findOutputRow`, qui matche par préfixe) — en particulier « Adm. fatigue
    // r=50 % » ne doit jamais collisionner avec « ε_t admissible ».
    pushRow(rows, 'kθ température', g.ktheta, '');
    pushRow(rows, 'SN', g.sn, '');
    pushRow(rows, 'Sh', g.sh_cm, 'cm');
    pushRow(rows, 'δ', g.delta, '');
    pushRow(rows, 'kr risque', g.kr, '');
    pushRow(rows, 'kc calage', g.kc, '');
    pushRow(rows, 'ks support', g.ks, '');
    pushRow(rows, '1/b', g.ub, '');
    pushRow(rows, 'Adm. fatigue r=50 %', g.adm_r50, fRigide ? 'MPa' : 'μdef');
    pushRow(rows, 'σ_z PSC', g.sigmaZ_psc_kpa, 'kPa');
    pushRow(rows, 'σ_r PSC', g.sigmaR_psc_kpa, 'kPa');
  }

  // σ_t PAR COUCHE traitée + mode d'interface (Tab. 68) — lecture de champs NOMMÉS
  // de o.couchesTraitees (déjà whitelistés/sanitizés côté serveur). Aucune copie
  // d'objet brut. Le mode est un libellé normatif public (allowlist serveur).
  const ct = o.couchesTraitees;
  if (Array.isArray(ct)) {
    for (const item of ct) {
      if (item == null || typeof item !== 'object') continue;
      const c = item as {
        couche?: unknown;
        mode?: unknown;
        valeur?: unknown;
        admissible?: unknown;
        ok?: unknown;
        requis?: unknown;
      };
      const n = typeof c.couche === 'number' ? c.couche : '?';
      const mode = typeof c.mode === 'string' ? c.mode : '';
      const label = mode
        ? `σ_t couche traitée ${n} (interface ${mode})`
        : `σ_t couche traitée ${n}`;
      // Critère σ_t rigide principal : toujours requis (verdict normal) ; on lit le
      // drapeau pour rester cohérent si une évolution du moteur l'exemptait.
      const cok = requisStatus(c.requis, c.ok);
      pushRow(rows, label, c.valeur, 'MPa', cok);
      pushRow(rows, `σ_t admissible couche ${n}`, c.admissible, 'MPa');
    }
  }

  // Détail ε_z PAR COUCHE granulaire non liée (§4.1.2) — champs NOMMÉS de
  // o.couchesGranulaires (whitelistés côté serveur).
  const cg = o.couchesGranulaires;
  if (Array.isArray(cg)) {
    for (const item of cg) {
      if (item == null || typeof item !== 'object') continue;
      const c = item as {
        couche?: unknown;
        valeur?: unknown;
        ok?: unknown;
        requis?: unknown;
      };
      const n = typeof c.couche === 'number' ? c.couche : '?';
      // MAJEUR-1 : ε_z granulaire exempté (§4.1.2, requis=false) -> informatif (pas
      // de ✗ sous un verdict PASS), même si la couche dépasse son seuil.
      const gok = requisStatus(c.requis, c.ok);
      pushRow(rows, `ε_z sommet couche granulaire ${n}`, c.valeur, 'μdef', gok);
    }
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
    if (taux !== null)
      rows.push({
        label: `${et} — taux de mobilisation`,
        value: taux * 100,
        unit: '%',
        status: pOk,
      });
    // Portance complémentaire c–φ (annexe F) — MAJEUR-2 : n'apparaissait pas quand
    // l'option était cochée. Bloc déjà assaini côté serveur (verdict + résistances,
    // jamais les facteurs de portance). En méthode labo, c–φ est déjà la portance
    // principale ci-dessus : le serveur n'émet le bloc `cphi` qu'en in situ.
    const cphi = c.cphi;
    if (cphi != null && typeof cphi === 'object') {
      const cp = cphi as Record<string, unknown>;
      if (typeof cp.err === 'string') {
        // Message normatif borné (domaine c–φ) — tags HTML retirés pour l'affichage.
        rows.push({
          label: `${et} — portance c–φ (annexe F)`,
          value: cp.err.replace(/<[^>]+>/g, ''),
          unit: '',
        });
      } else {
        const cOk: 'ok' | 'fail' = cp.ok === true ? 'ok' : 'fail';
        pushRow(rows, `${et} — portance c–φ (annexe F) R_v;d;F`, cp.Rtot, 'kN', cOk);
        pushRow(rows, `${et} — contrainte c–φ q_Rv;d;F`, cp.qRvd, 'kPa');
        const tc = finiteOrNull(cp.taux);
        if (tc !== null)
          rows.push({
            label: `${et} — taux mobilisation c–φ`,
            value: tc * 100,
            unit: '%',
            status: cOk,
          });
      }
    }
    // Excentrement (tab. 5.5) — MAJEUR-1 : absent = non requis (ELU acc.), ligne omise.
    // Présent : valeur = taux de surface comprimée (–), verdict ok/fail, limite en libellé.
    if (typeof c.excOk === 'boolean') {
      const eOk: 'ok' | 'fail' = c.excOk === true ? 'ok' : 'fail';
      const lib = typeof c.excLimLib === 'string' ? c.excLimLib : null;
      const excVal = finiteOrNull(c.exc);
      rows.push({
        label: `${et} — excentrement (surface comprimée${lib ? ` ≥ ${lib}` : ''})`,
        value: excVal !== null ? excVal : '—',
        unit: '',
        status: eOk,
      });
    }
    if (c.Rhd != null) {
      const gOk: 'ok' | 'fail' = c.glissementOk === true ? 'ok' : 'fail';
      pushRow(rows, `${et} — résistance au glissement R_h;d`, c.Rhd, 'kN', gOk);
      const tH = finiteOrNull(c.tauxH);
      if (tH !== null)
        rows.push({
          label: `${et} — taux glissement`,
          value: tH * 100,
          unit: '%',
          status: gOk,
        });
    }
    pushRow(rows, `${et} — tassement`, c.tassement, 'm');
    pushRow(rows, `${et} — tassement (Schmertmann)`, c.tassementSchmertmann, 'm');
    pushRow(rows, `${et} — tassement œdométrique`, c.tassementOed, 'm');
  }
  return rows;
}

/**
 * DÉTAILS DE CALCUL terzaghi — intermédiaires de MÉTHODE PUBLICS déjà whitelistés
 * (capacité de référence A/R₀/états, régime, tassements complémentaires). Clés
 * nommées uniquement (fail-closed §8) ; pl* et qc (in situ) restent serveur.
 */
function buildTerzaghiDetails(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  if (typeof o.regime === 'string') {
    const reg =
      o.regime === 'superficielle'
        ? 'Superficielle'
        : o.regime === 'semi-profonde'
          ? 'Semi-profonde'
          : null;
    if (reg) rows.push({ label: 'Régime de fondation', value: reg, unit: '' });
  }
  const ref = o.capaciteReference;
  if (ref != null && typeof ref === 'object') {
    const rf = ref as Record<string, unknown>;
    pushRow(rows, 'Aire de la semelle A', rf.A, 'm²');
    pushRow(rows, 'Résistance de référence R₀', rf.R0, 'kN');
    const states = Array.isArray(rf.states) ? rf.states : [];
    for (const s of states) {
      if (s == null || typeof s !== 'object') continue;
      const st = s as Record<string, unknown>;
      const et =
        typeof st.etat === 'string' ? (TERZAGHI_ETAT_LABEL[st.etat] ?? '—') : '—';
      pushRow(rows, `${et} — γ_Rv appliqué`, st.gRv, '');
      pushRow(rows, `${et} — Rᵥ;d de référence`, st.Rvd, 'kN');
      pushRow(rows, `${et} — q_Rv;d de référence`, st.qRvd, 'kPa');
    }
  }
  const cas = Array.isArray(o.cas) ? o.cas : [];
  for (const item of cas) {
    if (item == null || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (c.invalide === true) continue;
    const et = typeof c.etat === 'string' ? (TERZAGHI_ETAT_LABEL[c.etat] ?? '—') : '—';
    pushRow(rows, `${et} — tassement élastique`, c.tassementElastique, 'm');
    pushRow(rows, `${et} — déplacement vertical`, c.deplacementVertical, 'm');
  }
  return rows;
}

/** Verdict global terzaghi : tous les cas valides portants (et stables au glissement si évalué). */
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
 * Allowlist fail-closed des libellés de vérification pieux (EC7). Le moteur compose
 * `nom` soit comme un ELS fixe, soit `«ELU portance|traction» — «combinaison EC7»`.
 * On ne laisse traverser QUE des valeurs reconnues (état-limite + combinaison connus) ;
 * tout `nom` inattendu → libellé générique indexé, pour qu'aucun texte moteur non
 * whitelisté n'atteigne le navigateur (DoD §8). Ajouter ici toute nouvelle combinaison
 * EC7 introduite côté moteur (sinon elle s'affiche « Vérification N », jamais brute).
 */
const PIEUX_ELS_LABELS: ReadonlySet<string> = new Set([
  'ELS caractéristique',
  'ELS quasi-permanent',
]);
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
  if (tg !== null)
    rows.push({
      label: 'Taux de travail gouvernant',
      value: tg * 100,
      unit: '%',
      status: okGov,
    });
  pushRow(rows, 'Résistance de pointe R_b;k', o.RbK, 'kN');
  pushRow(rows, 'Résistance de frottement R_s;k', o.RsK, 'kN');
  pushRow(rows, 'Résistance caractéristique R_c;k', o.RcK, 'kN');
  // MINEUR-2 : libellé conditionnel selon le sens (compression → Rc;d ; traction → Rt;d).
  // o.sens n'est jamais exposé dans la sortie — seul le libellé change.
  pushRow(
    rows,
    o.sens === 'trac' ? 'Résistance de calcul R_t;d' : 'Résistance de calcul R_c;d',
    o.RcD,
    'kN',
  );
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

  // Frottement négatif (downdrag, #94) — lignes conditionnelles si non-null
  pushRow(rows, 'Charge de frottement négatif G_sn', o.Gsn, 'kN');
  pushRow(rows, 'Effort axial maximal N_max', o.Nmax, 'kN');
  pushRow(rows, 'Profondeur du point neutre z_N', o.pointNeutre, 'm');
  // MAJEUR-2 : note de découplage — affichée uniquement si au moins une valeur downdrag
  // est présente. Aligne le caveat du PV (frottement négatif non intégré au verdict).
  // Texte statique client-safe : aucun intermédiaire confidentiel ne traverse.
  if (
    finiteOrNull(o.Gsn) !== null ||
    finiteOrNull(o.Nmax) !== null ||
    finiteOrNull(o.pointNeutre) !== null
  ) {
    rows.push({
      label: 'Note frottement négatif',
      value:
        'Frottement négatif reporté à titre indicatif — non intégré au verdict de portance ; action permanente à ajouter à la charge en tête selon NF P 94-262.',
      unit: '',
    });
  }

  // Vérification structurale du béton (#95) — conditionnelle selon betonApplicable
  if (o.betonApplicable === false) {
    // Cas na : traction ou catégorie de pieu non couverte par la vérification structurale
    rows.push({ label: 'Vérification béton', value: 'Non applicable', unit: '' });
  } else if (o.betonApplicable === true) {
    const tELU = finiteOrNull(o.betonTauxELU);
    if (tELU !== null) {
      rows.push({
        label: 'Taux béton ELU σ/f_cd',
        value: tELU * 100,
        unit: '%',
        status: o.betonOkELU === true ? 'ok' : 'fail',
      });
    }
    const tELS = finiteOrNull(o.betonTauxELS);
    if (tELS !== null) {
      rows.push({
        label: 'Taux béton ELS',
        value: tELS * 100,
        unit: '%',
        status: o.betonOkELS === true ? 'ok' : 'fail',
      });
    }
    pushRow(rows, 'Résistance béton f_cd', o.betonFcd, 'MPa');
  }
  // betonApplicable === null (ou undefined) : béton non demandé → aucune ligne béton

  return rows;
}

const PIEUX_METH_LABEL: Record<string, string> = {
  pmt: 'Pressiomètre (pl*)',
  cpt: 'Pénétromètre (qc)',
  cphi: 'Laboratoire (c, φ)',
};
/**
 * DÉTAILS DE CALCUL pieux — contexte de dimensionnement PUBLIC déjà whitelisté
 * (géométrie B/D, catégorie de pieu, méthode). Clés nommées (fail-closed §8) ;
 * les facteurs de portance kp et coefficients de calage restent serveur.
 */
function buildPieuxDetails(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  if (typeof o.categorie === 'number')
    rows.push({
      label: 'Catégorie de pieu (NF P 94-262)',
      value: o.categorie,
      unit: 'n°',
    });
  if (typeof o.methode === 'string') {
    const m = PIEUX_METH_LABEL[o.methode];
    if (m) rows.push({ label: 'Méthode de dimensionnement', value: m, unit: '' });
  }
  pushRow(rows, 'Diamètre / côté B', o.B, 'm');
  pushRow(rows, 'Fiche D', o.D, 'm');
  return rows;
}

/** Ligne TEXTUELLE (résultat non numérique : classe, catégorie…). Vide → ignorée. */
function pushText(rows: CalcOutputRow[], label: string, value: unknown, unit = ''): void {
  if (typeof value !== 'string' || value.trim() === '') return;
  rows.push({ label, value: value.trim(), unit });
}

/** Liste de chaînes bornées (fail-closed) : ignore non-chaînes/vides ; borne la longueur. */
function asStrList(v: unknown, max = 300): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t) out.push(t.length > max ? t.slice(0, max) : t);
  }
  return out;
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
    pushRow(
      rows,
      'Distorsion max entre charges voisines',
      (wlp as Record<string, unknown>).beta,
      '‰',
    );
  }
  pushRow(rows, 'Nombre de radiers', o.nRafts, '');
  // SYNTHÈSE (bilans + extrêmes globaux) — panneau « Synthèse » de l'outil client
  // GEOPLAQUE_V10 (ADR 0014). Ordre et libellés repris du HTML. Rotations/pentes en ‰
  // (même convention que tiltMax/slopeMax ci-dessus). Les rangs conditionnels (Winkler,
  // ressorts, décollement) ne s'affichent que si l'option est active : le contrat rend
  // `null` sinon → pushRow OMET la ligne (comme l'outil d'origine).
  pushRow(rows, 'Rotation θx max', o.txMax, '‰');
  pushRow(rows, 'Rotation θy max', o.tyMax, '‰');
  pushRow(rows, 'Réaction de sol min p_min', o.pMin, 'kPa');
  pushRow(rows, 'Réaction de sol max p_max', o.pMax, 'kPa');
  pushRow(rows, '|Mx| max', o.mxMax, 'kN·m/ml');
  pushRow(rows, '|My| max', o.myMax, 'kN·m/ml');
  pushRow(rows, '|Mxy| max (torsion)', o.mxyMax, 'kN·m/ml');
  pushRow(rows, 'Charge appliquée Σ', o.totalLoad, 'kN');
  pushRow(rows, 'Σ réactions sol', o.sumReact, 'kN');
  pushRow(rows, 'Σ réaction Winkler', o.sumWink, 'kN');
  pushRow(rows, 'Σ réaction ressorts', o.sumSpr, 'kN');
  pushRow(rows, 'Nœuds décollés', o.decolNodes, '');
  return rows;
}

/**
 * HEATMAP radier — grille d'affichage RÉ-ÉCHANTILLONNÉE (déjà découplée du maillage
 * côté serveur). Lit UNIQUEMENT les champs nommés de `o.champDeflexion` (fail-closed
 * §8) ; jamais de valeurs nodales/indices/topologie. Garde-fous de cohérence.
 */
function buildRadierHeatmap(o: Record<string, unknown>): HeatmapData | undefined {
  return parseHeatmapGrid(o.champDeflexion);
}

/**
 * Parse UNE grille de champ (heatmap) fail-closed (§8) : ne lit QUE les clés nommées d'une
 * grille d'affichage ≤48×48 découplée du maillage. Optionnellement `unit`/`label` (cartes
 * étendues étiquetées). Jamais de valeur nodale/indice/topologie. `undefined` si la forme
 * n'est pas exactement celle attendue.
 */
function parseHeatmapGrid(h: unknown): HeatmapData | undefined {
  if (h == null || typeof h !== 'object') return undefined;
  const g = h as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const x0 = num(g.x0),
    y0 = num(g.y0),
    x1 = num(g.x1),
    y1 = num(g.y1);
  const cols = num(g.cols),
    rows = num(g.rows),
    vMin = num(g.vMin),
    vMax = num(g.vMax);
  if (
    x0 === null ||
    y0 === null ||
    x1 === null ||
    y1 === null ||
    cols === null ||
    rows === null ||
    vMin === null ||
    vMax === null
  )
    return undefined;
  if (!Array.isArray(g.vals) || cols < 2 || rows < 2 || cols * rows > 4096)
    return undefined;
  const vals = (g.vals as unknown[]).map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null,
  );
  if (vals.length !== cols * rows) return undefined;
  const base: HeatmapData = { x0, y0, x1, y1, cols, rows, vals, vMin, vMax };
  // Étiquettes optionnelles (cartes étendues) : reprises telles quelles si présentes.
  if (typeof g.unit === 'string') base.unit = g.unit;
  if (typeof g.label === 'string') base.label = g.label;
  return base;
}

/** Clés de cartes étendues autorisées (fail-closed §8) — reprises des boutons du client. */
const CHAMP_KEYS = [
  'deflexion',
  'reaction',
  'momentX',
  'momentY',
  'momentXY',
  'raideur',
  'pente',
  'rotationX',
  'rotationY',
] as const;

/**
 * Normalise `output.champs` (cartes étendues) en `Record<string, HeatmapData>` — clés
 * NOMMÉES fail-closed (§8), jamais de copie brute. `undefined` si aucune carte valide.
 */
function buildFieldMaps(champs: unknown): Record<string, HeatmapData> | undefined {
  if (champs == null || typeof champs !== 'object') return undefined;
  const src = champs as Record<string, unknown>;
  const out: Record<string, HeatmapData> = {};
  for (const key of CHAMP_KEYS) {
    const g = parseHeatmapGrid(src[key]);
    if (g) out[key] = g;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Clés de profils autorisées (fail-closed §8) — union plane-strain (deflexion/moment/
 * reaction) et axi (deflexion/momentR/momentT/reaction). */
const PROFIL_KEYS = ['deflexion', 'moment', 'reaction', 'momentR', 'momentT'] as const;

/** Parse UN profil (97 points) fail-closed : x/v denses finis de même longueur + unit/label. */
function parseProfile(p: unknown): ProfilData | undefined {
  if (p == null || typeof p !== 'object') return undefined;
  const g = p as Record<string, unknown>;
  if (!Array.isArray(g.x) || !Array.isArray(g.v)) return undefined;
  const n = g.x.length;
  if (n < 2 || n > 97 || g.v.length !== n) return undefined;
  const finiteNums = (a: unknown[]): number[] | undefined => {
    const r: number[] = [];
    for (const v of a) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      r.push(v);
    }
    return r;
  };
  const x = finiteNums(g.x);
  const v = finiteNums(g.v);
  if (!x || !v) return undefined;
  if (typeof g.unit !== 'string' || typeof g.label !== 'string') return undefined;
  return { x, v, unit: g.unit, label: g.label };
}

/**
 * Normalise `output.profils` en `Record<string, ProfilData>` — clés NOMMÉES fail-closed
 * (§8), jamais de copie brute. `undefined` si aucun profil valide.
 */
function buildProfils(profils: unknown): Record<string, ProfilData> | undefined {
  if (profils == null || typeof profils !== 'object') return undefined;
  const src = profils as Record<string, unknown>;
  const out: Record<string, ProfilData> = {};
  for (const key of PROFIL_KEYS) {
    const p = parseProfile(src[key]);
    if (p) out[key] = p;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * plane-strain — déformations planes / poutre (coupe 2D) sur sol multicouche (EF).
 * Moteur d'analyse (pas de verdict). Clés NOMMÉES (fail-closed §8) : on ne lit QUE les
 * diagnostics globaux de `RadierOutputSchema`-frère, jamais de champ nodal/topologie.
 *
 * UNITÉS : même convention que le radier (piège E-MPa × charges-kN × géométrie-m) —
 * tassements NUMÉRIQUEMENT en mm, rendus SANS ×1000. Moments/réactions/bilans en
 * kN·m/m, kPa, kN (unités à figer avec STARFIRE pour un PV opposable, comme mm/‰).
 */
function buildPlaneStrainRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Tassement maximal w_max', o.wMax, 'mm');
  pushRow(rows, 'Tassement minimal w_min', o.wMin, 'mm');
  pushRow(rows, 'Tassement différentiel', o.diff, 'mm');
  pushRow(rows, 'Moment fléchissant maximal M_max', o.mMax, 'kN·m/m');
  pushRow(rows, 'Moment fléchissant minimal M_min', o.mMin, 'kN·m/m');
  pushRow(rows, 'Réaction de sol maximale p_max', o.pMax, 'kPa');
  pushRow(rows, 'Charge verticale totale', o.totalLoad, 'kN');
  pushRow(rows, 'Résultante de réaction', o.sumReact, 'kN');
  pushRow(rows, "Profondeur d'assise retenue z_0", o.z0, 'm');
  pushRow(rows, 'Nœuds décollés', o.decolN, '');
  // Rigidité de flexion D = E·e³/12(1−ν²) — affichée en permanence par l'outil client
  // (ADR 0014). Forme fermée des entrées E/e/ν, pas un intermédiaire de maillage.
  pushRow(rows, 'Rigidité de flexion D', o.EI, 'kN·m');
  return rows;
}

/**
 * axi — plaque annulaire / radier circulaire (axisymétrique) sur sol multicouche (EF).
 * Moteur d'analyse (pas de verdict). Clés NOMMÉES (fail-closed §8) : diagnostics globaux
 * scalaires seuls (aucun champ nodal radial r/w/p/Mr/Mt). mm pour les tassements.
 */
function buildAxiRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Tassement au centre w_c', o.wc, 'mm');
  pushRow(rows, 'Tassement au bord w_bord', o.wEdge, 'mm');
  pushRow(rows, 'Tassement maximal w_max', o.wMax, 'mm');
  pushRow(rows, 'Tassement minimal w_min', o.wMin, 'mm');
  // Tassement différentiel (wMax−wMin) — affiché par l'outil client (ADR 0014).
  pushRow(rows, 'Tassement différentiel', o.diff, 'mm');
  pushRow(rows, 'Moment radial maximal M_r', o.mrMax, 'kN·m/m');
  pushRow(rows, 'Moment tangentiel maximal M_t', o.mtMax, 'kN·m/m');
  pushRow(rows, 'Réaction de sol maximale p_max', o.pMax, 'kPa');
  pushRow(rows, 'Charge totale appliquée', o.totalLoad, 'kN');
  // Résultante de la réaction de sol Σ (bilan d'équilibre) — affichée par le client.
  pushRow(rows, 'Résultante de réaction Σ', o.sumReact, 'kN');
  pushRow(rows, "Côte d'assise retenue z_0", o.z0, 'm');
  return rows;
}

/**
 * tri-raft — radier à maillage triangulaire (DKT) sur sol multicouche (EF).
 * Moteur d'analyse (pas de verdict). Clés NOMMÉES (fail-closed §8) : aucun champ nodal
 * (w/p) ni topologie de maillage (P/tris/N/nt). mm pour les tassements.
 *
 * NB UI : ce mode IGNORE les charges `on:'soil'` et les moments Mx/My (effort vertical
 * seul) — l'UI doit le signaler (cf. divergence documentée dans le module engines).
 */
function buildTriRaftRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Tassement maximal w_max', o.wMax, 'mm');
  pushRow(rows, 'Tassement minimal w_min', o.wMin, 'mm');
  pushRow(rows, 'Tassement différentiel', o.diff, 'mm');
  pushRow(rows, 'Réaction de sol maximale', o.reactionMax, 'kPa');
  pushRow(rows, 'Charge verticale totale ΣFz', o.totalLoad, 'kN');
  pushRow(rows, 'Réaction de sol intégrée Σp·A', o.sumReact, 'kN');
  pushRow(rows, "Côte d'assise retenue z_0", o.z0, 'm');
  pushRow(rows, 'Nombre de radiers', o.nRaft, '');
  return rows;
}

/**
 * labo — classification GTR (NF P 11-300) + paramètres d'identification.
 * La classe est un RÉSULTAT textuel. Clés nommées (fail-closed §8).
 */
// Allowlist FAIL-CLOSED du chemin de décision GTR (classe.path) — DoD §8, avis
// ingenieur-securite. path ne contient que des SEUILS NF P 11-300 PUBLICS + des
// valeurs DÉJÀ exposées (passant, Ip, VBS…) + la sous-classe résultante. On n'affiche
// QUE les libellés matchant un gabarit connu ; tout libellé inattendu (future branche
// qui y écrirait un coefficient) est ÉCARTÉ. Les slots variables sont contraints à des
// NOMBRES / CODES (jamais `.*`) : un « kc=1.3 » injecté ne matche aucun slot. `warn`
// n'est JAMAIS affiché (note de maturité C1/C2 → arbitrage STARFIRE/expert).
const LABO_N = '\\d[\\d.,\\u202f]*';
const LABO_C = '[A-D0-9?]{1,6}';
const LABO_ST = '[a-zàâéèêîïôûç]{1,4}';

// Allowlist des DESCRIPTIONS de sous-classe (NF P 11-300, statiques). Symétrie fail-closed
// avec `path` : desc n'est affiché QUE s'il correspond à un libellé normatif connu (ou à
// une variante famille C « … · 0/50 type D1/D2 »). Tout desc inattendu est écarté.
const LABO_DESCS: ReadonlySet<string> = new Set([
  'Limons peu plastiques, loess, sables fins argileux, arènes',
  'Sables fins argileux, limons, argiles peu plastiques',
  'Argiles et argiles marneuses, limons très plastiques',
  'Argiles très plastiques',
  'Sables silteux',
  'Sables argileux (peu argileux)',
  'Graves silteuses',
  'Graves argileuses (peu argileuses)',
  'Sables et graves très silteux',
  'Sables et graves argileux à très argileux',
  "Sables propres insensibles à l'eau",
  "Graves propres insensibles à l'eau",
  'Matériaux grossiers insensibles',
  'Gros éléments — comportement régi par le squelette',
  'Gros éléments — comportement régi par la fraction 0/50',
]);
const LABO_DESC_C =
  /^Gros éléments — comportement régi par (?:le squelette|la fraction 0\/50)(?: · 0\/50 type (?:D1|D2))?$/;
function safeLaboDesc(desc: unknown): string {
  if (typeof desc !== 'string') return '';
  const t = desc.trim();
  return LABO_DESCS.has(t) || LABO_DESC_C.test(t) ? t : '';
}
const LABO_PATH_PATTERNS: readonly RegExp[] = [
  new RegExp(`^Dmax = ${LABO_N} mm > ${LABO_N} mm → famille C\\.$`),
  new RegExp(
    `^Fraction 0/50 reclassée → ${LABO_C} \\(essais à réaliser sur le 0/50\\)\\.$`,
  ),
  new RegExp(
    `^Passant 80µm = ${LABO_N} % ≤ ${LABO_N} % et VBS = ${LABO_N} ≤ ${LABO_N} → insensible → famille D\\.$`,
  ),
  new RegExp(`^Passant 2mm = ${LABO_N} % → ${LABO_C}\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_N} % > ${LABO_N} % → sol fin → famille A\\.$`),
  new RegExp(`^Ip = ${LABO_N} \\(préférentiel\\) → ${LABO_C}\\.$`),
  new RegExp(`^Ip absent → VBS = ${LABO_N} → ${LABO_C}\\.$`),
  new RegExp(`^Passant 80µm = ${LABO_N} % ≤ ${LABO_N} % → famille B\\.$`),
  new RegExp(
    `^Passant 2mm = ${LABO_N} % \\((?:sables|graves)\\), VBS = ${LABO_N} → ${LABO_C}\\.$`,
  ),
  new RegExp(
    `^Passant 80µm entre ${LABO_N}–${LABO_N} %, VBS = ${LABO_N} → ${LABO_C}\\.$`,
  ),
  new RegExp(
    `^État hydrique ${LABO_ST} \\((?:forcé|wn/wOPN = ${LABO_N})\\) → ${LABO_C}(?: ${LABO_ST})?\\.$`,
  ),
  /^Famille D insensible : pas d'indice d'état\.$/,
];

/** Filtre fail-closed : ne garde que les libellés de path matchant un gabarit connu. */
function safeLaboPath(path: unknown): string[] {
  if (!Array.isArray(path)) return [];
  const out: string[] = [];
  for (const s of path) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t && LABO_PATH_PATTERNS.some((re) => re.test(t))) out.push(t);
  }
  return out;
}

function buildLaboRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  const cl = o.classe;
  if (cl != null && typeof cl === 'object') {
    const c = cl as Record<string, unknown>;
    // `code`/`full` contiennent DÉJÀ la lettre de famille (ex. code='A2', full='A2 h') :
    // concaténer `fam` la dupliquerait ('A'+'A2'='AA2'). On prend le libellé canonique.
    // `desc` (description normative NF P 11-300, statique) et `path` (chemin de décision,
    // seuils publics + valeurs déjà exposées) SONT client-safe (avis ingenieur-securite).
    // path passe par l'allowlist fail-closed `safeLaboPath`. `caveats` (= encart « Points
    // à vérifier ») et `rNote` (assistant famille R) sont désormais AFFICHÉS verbatim
    // comme le client (décision « zéro écart » 14/07) — libellés normatifs, sans valeur
    // confidentielle (cf. test warnings-leak du moteur).
    const full = typeof c.full === 'string' ? c.full.trim() : '';
    const code = c.code != null && c.code !== '' ? String(c.code).trim() : '';
    const label = full || code;
    if (label) rows.push({ label: 'Classe GTR', value: label, unit: '' });
    const desc = safeLaboDesc(c.desc);
    if (desc) rows.push({ label: 'Description', value: desc, unit: '' });
    let step = 0;
    for (const s of safeLaboPath(c.path)) {
      step += 1;
      rows.push({ label: `Justification du classement ${step}`, value: s, unit: '' });
    }
    // Encart « Points à vérifier » (classify().warn), verbatim client.
    for (const w of asStrList(c.caveats)) {
      rows.push({ label: 'Point à vérifier', value: w, unit: '' });
    }
    // Assistant famille R (rocheux) — libellés d'aide au classement R.
    for (const n of asStrList(c.rNote)) {
      rows.push({ label: 'Assistant famille R', value: n, unit: '' });
    }
  }
  // Nature vis-à-vis de la ligne A (readout « Nature » de l'onglet Atterberg).
  pushText(rows, 'Nature (ligne A)', o.natureLigneA);
  // COMPLÉTUDE : tous les résultats client-safe (multi-essais). pushRow saute les null.
  // — Identification (granulo / Atterberg / bleu)
  pushRow(rows, 'Dmax', o.dmax, 'mm');
  pushRow(rows, 'Passant à 80 µm', o.p80, '%');
  pushRow(rows, 'Passant à 2 mm', o.p2, '%');
  pushRow(rows, "Coefficient d'uniformité Cu", o.Cu, '');
  pushRow(rows, 'Coefficient de courbure Cc', o.Cc, '');
  // Module de finesse avec qualificatif accolé, format client renderRecap :
  // « 2.41 (idéal) ». mfq (très fin/idéal/grossier) = résultat, pas méthode.
  const mfNum = finiteOrNull(o.mf);
  if (mfNum !== null) {
    const mfq = typeof o.mfq === 'string' && o.mfq.trim() ? ` (${o.mfq.trim()})` : '';
    rows.push({
      label: 'Module de finesse',
      value: `${mfNum.toFixed(2)}${mfq}`,
      unit: '',
    });
  }
  pushRow(rows, 'Teneur en eau naturelle w_n', o.wn, '%');
  pushRow(rows, 'Limite de liquidité w_L', o.wl, '%');
  pushRow(rows, 'Limite de plasticité w_P', o.wp, '%');
  pushRow(rows, 'Indice de plasticité I_P', o.ip, '');
  pushRow(rows, 'Indice de consistance I_C', o.ic, '');
  pushRow(rows, 'Valeur au bleu VBS', o.vbs, '');
  // — Masses volumiques
  pushRow(rows, 'Masse volumique des grains ρ_s', o.rhos, 'Mg/m³');
  pushRow(rows, 'Masse volumique apparente ρ', o.rho_app, 'Mg/m³');
  pushRow(rows, 'Masse volumique sèche apparente ρ_d', o.rhod_app, 'Mg/m³');
  // — Proctor / portance
  pushRow(rows, 'Teneur en eau optimale w_OPN', o.wopn, '%');
  pushRow(rows, 'Densité sèche max ρ_d;max', o.rdmax, 't/m³');
  // Le libellé reflète le type d'essai (CBR après immersion / IPI immédiat) — cbrType
  // est client-safe (résultat, pas méthode) : les deux alimentent la même valeur `cbr`.
  // Libellé aligné sur le PV (apps/api/src/pv/pdf/pv-pdf.ts) — « Indice IPI » divergeait.
  pushRow(
    rows,
    o.cbrType === 'ipi' ? 'IPI (Indice Portant Immédiat)' : 'Indice CBR',
    o.cbr,
    '',
  );
  pushRow(rows, 'Gonflement', o.gonfl, '%');
  // — Granulats
  pushRow(rows, 'Équivalent de sable ES', o.es, '%');
  pushRow(rows, 'Los Angeles LA', o.la, '');
  pushRow(rows, 'Fragmentation SZ', o.sz, '%');
  pushRow(rows, 'Micro-Deval MDE', o.mde, '');
  pushRow(rows, "Absorption d'eau WA24", o.wa, '%');
  pushRow(rows, 'Teneur en sulfates SO₃', o.so3, '%');
  // — Essais mécaniques
  pushRow(rows, 'Résistance à la compression simple q_u', o.qu, 'MPa');
  pushRow(rows, "Cohésion c' (cisaillement)", o.c_cis, 'kPa');
  pushRow(rows, "Angle de frottement φ' (cisaillement)", o.phi_cis, '°');
  pushRow(rows, "Angle de frottement résiduel φ'_R", o.phiR_cis, '°');
  pushRow(rows, "Cohésion c' (triaxial)", o.c, 'kPa');
  pushRow(rows, "Angle de frottement φ' (triaxial)", o.phi, '°');
  pushRow(rows, 'Cohésion non drainée c_u (UU)', o.cu_uu, 'kPa');
  // — Œdomètre
  pushRow(rows, 'Indice des vides initial e₀', o.e0_oedo, '');
  pushRow(rows, 'Indice de compression Cc (œdo)', o.Cc_oedo, '');
  pushRow(rows, 'Indice de gonflement Cs', o.Cs_oedo, '');
  pushRow(rows, 'Perméabilité k', o.k, 'cm/s');
  return rows;
}

/** Convertit une valeur interne (bar) en MPa d'affichage (×0,1) ; null si non finie. */
function bar2mpa(v: unknown): number | null {
  const n = finiteOrNull(v);
  return n === null ? null : n * 0.1;
}
/** Multiplie une valeur finie par un facteur d'affichage ; null si non finie. */
function scaleOrNull(v: unknown, k: number): number | null {
  const n = finiteOrNull(v);
  return n === null ? null : n * k;
}
/** Lit un sous-objet whitelisté (Record) ou {} (fail-closed). */
function asObj(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
/** Nombre fini ou 0 (structures pressio : grandeur toujours présente côté moteur). */
function num0(v: unknown): number {
  const n = finiteOrNull(v);
  return n === null ? 0 : n;
}

/**
 * pressiomètre Ménard — dépouillement (p_L, E_M, catégorie de sol) + grandeurs
 * AFFICHÉES par renderResults (« zéro écart » 14/07) : p_f/pE/p₀/σ_h0 en MPa comme le
 * client (interne en bar → ×0,1), description de catégorie. Les STRUCTURES (courbe,
 * volumes, extrapolation, synthèse) partent dans `NormalizedCalcOutput.pressio` (cf.
 * buildPressioDepouillement). Clés nommées (fail-closed §8).
 */
function buildPressiometreRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  // CORRECTIF (14/07) : o.pL/pLNette/pfNette sont internes en BAR (contract.ts) — le
  // client affiche TOUJOURS ces 3 grandeurs en MPa (kg4 : p_L, P*_LM, P*_f — cf.
  // renderResults). L'ancien code les laissait en bar par erreur (divergence interne :
  // pf/pE/p0/σh0 juste en-dessous étaient déjà convertis). ×0,1 comme le reste de la page.
  pushRow(rows, 'Pression limite p_L', bar2mpa(o.pL), 'MPa');
  pushRow(rows, 'Pression limite nette p_L*', bar2mpa(o.pLNette), 'MPa');
  pushRow(rows, 'Pression de fluage nette p_f*', bar2mpa(o.pfNette), 'MPa');
  // Grandeurs de tête AFFICHÉES en MPa par le client (KPI / table normalisée).
  pushRow(rows, 'Pression de fluage p_f', bar2mpa(o.pf), 'MPa');
  pushRow(rows, 'Pression pE (restitution)', bar2mpa(o.pE), 'MPa');
  pushRow(rows, 'Pression p₀ (début pseudo-élastique)', bar2mpa(o.p0), 'MPa');
  pushRow(rows, 'Contrainte horizontale au repos σ_h0', bar2mpa(o.sigmaH0), 'MPa');
  pushRow(rows, 'Module pressiométrique E_M', o.EM, 'MPa');
  pushRow(rows, 'Rapport E_M / p_L*', o.ratioEMpL, '');
  // Grandeurs publiques du dépouillement (décision titulaire — mémoire
  // roadsen-details-transparents-rescope-s8) : coefficient rhéologique α (Ménard)
  // et module d'Young Ey = E_M/α, calculés SERVEUR et whitelistés (contract.ts).
  pushRow(rows, 'Coefficient rhéologique α (Ménard)', o.alpha, '');
  pushRow(rows, 'Module d’Young E_y = E_M/α', o.Ey, 'MPa');
  pushText(rows, 'Catégorie de sol', o.categorieLibelle);
  pushText(rows, 'Description de la catégorie', o.categorieDescription);
  pushText(rows, 'État de consolidation', o.consolidation);
  // p_L méthode (direct mesuré vs extrapolé §D.4.3.2) — booléen whitelisté du contrat
  // (pLDirect), non exposé jusqu'ici ; le client l'affiche dans la table « paramètres
  // normalisés » (« p_L méthode »). Verbatim client (pas de valeur confidentielle).
  if (typeof o.pLDirect === 'boolean') {
    pushText(
      rows,
      'p_L méthode',
      o.pLDirect ? 'Direct (mesuré)' : 'Extrapolé (§D.4.3.2)',
    );
  }
  return rows;
}

/**
 * pressiomètre — STRUCTURES d'affichage (« zéro écart ») en UNITÉS CLIENT : la courbe
 * corrigée, les volumes de référence (cm³), l'extrapolation (A/B bruts, pLM en MPa,
 * errV en cm³) et la synthèse (β, mE en cm³/MPa, plage auto en n° de ligne « L… »).
 * Reprend VERBATIM les conversions d'affichage du HTML (renderResults). Construction
 * champ à champ à partir de la sortie whitelistée du moteur (aucun intermédiaire non
 * affiché — pS/v15/v30/σ décomposée restent absents en amont, cf. contract moteur).
 */
function buildPressioDepouillement(o: Record<string, unknown>): PressioDepouillement {
  const vol = asObj(o.volumes);
  const ext = asObj(o.extrapolation);
  const syn = asObj(o.synthese);
  const courbeSrc = Array.isArray(o.courbe) ? o.courbe : [];
  const courbe: PressioCourbePoint[] = courbeSrc.map((c) => {
    const p = asObj(c);
    const phase =
      p.phase === 'Recompression' ||
      p.phase === 'Pseudo-élast.' ||
      p.phase === 'Plastique'
        ? p.phase
        : 'Recompression';
    return {
      p: num0(p.p),
      pCorr: num0(p.pCorr),
      v60: num0(p.v60),
      d6030: num0(p.d6030),
      phase,
    };
  });
  return {
    pf: num0(bar2mpa(o.pf)),
    pE: num0(bar2mpa(o.pE)),
    p0: num0(bar2mpa(o.p0)),
    sigmaH0: num0(bar2mpa(o.sigmaH0)),
    z: num0(o.z),
    categorieDescription:
      typeof o.categorieDescription === 'string' ? o.categorieDescription : '',
    volumes: {
      vE: num0(vol.vE),
      v0: num0(vol.v0),
      vf: num0(vol.vf),
      vLim: num0(vol.vLim),
    },
    extrapolation: {
      a: num0(ext.a),
      b: num0(ext.b),
      plmVLim: num0(bar2mpa(ext.plmVLim)),
      plmAsymptote: num0(bar2mpa(ext.plmAsymptote)),
      errV: finiteOrNull(ext.errV), // null si non défini (client « — »)
    },
    synthese: {
      beta: num0(syn.beta),
      mE: num0(scaleOrNull(syn.mE, 10)), // cm³/bar → cm³/MPa
      // Plage auto en n° de ligne (indice 0-based + 1), comme « L1→L7 » du client.
      plageAutoDebutL: num0(syn.plageAutoDebut) + 1,
      plageAutoFinL: num0(syn.plageAutoFin) + 1,
    },
    courbe,
  };
}

/**
 * PressioPro — ÉTALONNAGE (sonde dans l'air) : coefficients d'appareillage Vs / Pe et
 * pente d'air a, réutilisables dans le dépouillement. Clés NOMMÉES (fail-closed §8) :
 * on ne lit QUE les champs whitelistés par PressioEtalonnageOutputSchema (Vs/Pe/a/R²/RMS),
 * jamais les intermédiaires de régression (pts/residuals/V_pe/Vs_reel, strippés serveur).
 * a est en cm³/bar (valeur interne) ; a×10 en cm³/MPa est affiché à titre indicatif.
 */
function buildEtalonnageRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Vs — volume à l’origine (droite ajustée)', o.Vs, 'cm³');
  pushRow(rows, 'Vs réel — 1er palier mesuré', o.vsReel, 'cm³');
  pushRow(rows, 'V_pe = 1,2 × Vs réel', o.vPe, 'cm³');
  pushRow(rows, 'Pe — pression à V=1,2·Vs', o.Pe, 'bar');
  pushRow(rows, 'Pente d’air a (≠ coefficient de correction)', o.a, 'cm³/bar');
  const aNum = finiteOrNull(o.a);
  if (aNum !== null) pushRow(rows, 'Pente d’air a (indicatif)', aNum * 10, 'cm³/MPa');
  pushRow(rows, 'Coefficient de détermination R²', o.R2, '');
  pushRow(rows, 'RMS des résidus', o.rms, 'cm³');
  return rows;
}

/** PressioPro — ÉTALONNAGE : structure d'affichage (Vs réel, V_pe, table des résidus). */
function buildEtalonnageStruct(
  o: Record<string, unknown>,
): NonNullable<PressioNormalized['etalonnage']> {
  const src = Array.isArray(o.residus) ? o.residus : [];
  const residus: PressioEtalonnageResidu[] = src.map((r) => {
    const e = asObj(r);
    return {
      p: num0(e.p),
      vMesure: num0(e.vMesure),
      vAjuste: num0(e.vAjuste),
      residu: num0(e.residu),
    };
  });
  return { vsReel: num0(o.vsReel), vPe: num0(o.vPe), residus };
}

/**
 * PressioPro — CALIBRAGE (forage indéformable) : coefficient de correction de volume a,
 * réutilisable dans le dépouillement (Vc = Vr − a·Pr). Clés NOMMÉES (fail-closed §8) : on
 * ne lit QUE a / R² / RMS (whitelist PressioCalibrageOutputSchema) ; les coefficients de la
 * courbe polynomiale c0/c1/c2 (méthode) et les intermédiaires sont strippés serveur.
 * a est en cm³/bar (valeur interne) ; a×10 en cm³/MPa est affiché à titre indicatif.
 */
function buildCalibrageRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];
  pushRow(rows, 'Coefficient de calibrage a', o.a, 'cm³/bar');
  const aNum = finiteOrNull(o.a);
  if (aNum !== null)
    pushRow(rows, 'Coefficient de calibrage a (indicatif)', aNum * 10, 'cm³/MPa');
  // Coefficients de la courbe Pc = c0 + c1·V + c2·V² (AFFICHÉS par le client, « zéro écart »).
  pushRow(rows, 'c₀ (constante)', o.c0, '');
  pushRow(rows, 'c₁ (×V)', o.c1, '');
  pushRow(rows, 'c₂ (×V²)', o.c2, '');
  pushRow(rows, 'Coefficient de détermination R²', o.R2, '');
  pushRow(rows, 'RMS des résidus', o.rms, 'bar');
  return rows;
}

/** PressioPro — CALIBRAGE : structure d'affichage (coefficients c0/c1/c2 + résidus). */
function buildCalibrageStruct(
  o: Record<string, unknown>,
): NonNullable<PressioNormalized['calibrage']> {
  const src = Array.isArray(o.residus) ? o.residus : [];
  const residus: PressioCalibrageResidu[] = src.map((r) => {
    const e = asObj(r);
    return {
      p: num0(e.p),
      v60Mesure: num0(e.v60Mesure),
      v60Ajuste: num0(e.v60Ajuste),
      residu: num0(e.residu),
    };
  });
  return { c0: num0(o.c0), c1: num0(o.c1), c2: num0(o.c2), residus };
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
    if (value === null || typeof o.label !== 'string' || typeof o.unit !== 'string')
      continue;
    const status = o.status === 'ok' || o.status === 'fail' ? o.status : undefined;
    out.push(
      status
        ? { label: o.label, value, unit: o.unit, status }
        : { label: o.label, value, unit: o.unit },
    );
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
    return {
      verdict: o.conforme === true ? 'PASS' : 'FAIL',
      rows: buildBurmisterRows(o),
      details: buildBurmisterDetails(o),
    };
  }
  if (typeof o.verdict === 'string' && Array.isArray(o.rows)) {
    return {
      verdict: o.verdict === 'PASS' ? 'PASS' : 'FAIL',
      rows: sanitizeRows(o.rows),
    };
  }
  // terzaghi (fondation superficielle) : sortie {cas:[…]} → whitelist par cas
  if (Array.isArray(o.cas)) {
    return {
      verdict: terzaghiVerdict(o),
      rows: buildTerzaghiRows(o),
      details: buildTerzaghiDetails(o),
    };
  }
  // pieux (fondation profonde) : verdict global booléen `allOk` + résistances
  if (typeof o.allOk === 'boolean') {
    return {
      verdict: o.allOk === true ? 'PASS' : 'FAIL',
      rows: buildPieuxRows(o),
      details: buildPieuxDetails(o),
    };
  }
  // radier (plaque/sol multicouche) : déflexions/distorsions — pas de verdict (NA).
  // `heatmap` legacy = carte de déflexion (compat) ; `heatmaps` = cartes étendues étiquetées.
  if (typeof o.betaGov === 'number' || 'nRafts' in o) {
    return {
      verdict: 'NA',
      rows: buildRadierRows(o),
      heatmap: buildRadierHeatmap(o),
      heatmaps: buildFieldMaps(o.champs),
    };
  }
  // labo (classification GTR) : classe + paramètres — pas de verdict (NA)
  if (o.classe != null && typeof o.classe === 'object') {
    return { verdict: 'NA', rows: buildLaboRows(o) };
  }
  // pressiomètre Ménard (dépouillement) : pL/EM/catégorie — pas de verdict (NA).
  // « Zéro écart » : les structures affichées (courbe, volumes, extrapolation, synthèse)
  // partent dans `pressio.depouillement` (unités client) pour un rendu 1:1 du HTML.
  if ('categorie' in o && ('pL' in o || 'ratioEMpL' in o)) {
    return {
      verdict: 'NA',
      rows: buildPressiometreRows(o),
      pressio: { depouillement: buildPressioDepouillement(o) },
    };
  }
  // PressioPro — ÉTALONNAGE : Vs + Pe (combinaison propre à l'étalonnage) — coefficients
  // d'appareillage, pas de verdict (NA). Structure (Vs réel, V_pe, résidus) dans `pressio`.
  if ('Vs' in o && 'Pe' in o) {
    return {
      verdict: 'NA',
      rows: buildEtalonnageRows(o),
      pressio: { etalonnage: buildEtalonnageStruct(o) },
    };
  }
  // PressioPro — CALIBRAGE : a + R² + rms sans Vs (rms est propre aux modules PressioPro
  // d'appareillage) — coefficient de correction de volume, pas de verdict (NA). Structure
  // (c0/c1/c2, résidus) dans `pressio.calibrage`.
  if ('a' in o && 'R2' in o && 'rms' in o && !('Vs' in o)) {
    return {
      verdict: 'NA',
      rows: buildCalibrageRows(o),
      pressio: { calibrage: buildCalibrageStruct(o) },
    };
  }
  // GEOPLAQUE — variantes (clés de diagnostic DISJOINTES du radier ACM et entre elles) :
  // axisymétrique (wc/wEdge), déformations planes (decolN+mMax), triangulaire (reactionMax+
  // nRaft — singulier, distinct de `nRafts` du radier ACM). Analyses → verdict NA.
  if ('wc' in o && 'wEdge' in o) {
    return { verdict: 'NA', rows: buildAxiRows(o), profils: buildProfils(o.profils) };
  }
  if ('decolN' in o && 'mMax' in o) {
    return {
      verdict: 'NA',
      rows: buildPlaneStrainRows(o),
      profils: buildProfils(o.profils),
    };
  }
  if ('reactionMax' in o && 'nRaft' in o) {
    // tri-raft : heatmap de déflexion (grille découplée du maillage triangulaire).
    return {
      verdict: 'NA',
      rows: buildTriRaftRows(o),
      heatmap: buildRadierHeatmap(o),
      heatmaps: buildFieldMaps({
        deflexion: { ...(o.champDeflexion as object), unit: 'mm', label: 'Tassement' },
      }),
    };
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
    sealValid,
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
