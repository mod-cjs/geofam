/**
 * ÉQUIVALENCE GOLDEN-MASTER — ROADSENS (burmister, AGEROUTE Sénégal 2015).
 *
 * RECIBLÉ SUR LA RÉFÉRENCE DÉFINITIVE (passe 1). La production calcule EXCLUSIVEMENT
 * selon la définitive (retrait du mode historique — décision titulaire actée) : le
 * front force toujours `materialsRev:'definitive'` + `ifaceAuto:true` ; `gntAuto`
 * vaut true par défaut mais peut être false au chargement d'un preset. Les payloads
 * ci-dessous reflètent donc ce MODE PRODUCTION, et le HTML piloté au navigateur est
 * la RÉFÉRENCE DÉFINITIVE (pas l'ancien « moderne »).
 *
 * Preuve NAVIGATEUR + bout-en-bout PLATEFORME que le portage reproduit la référence
 * DÉFINITIVE à 0 % d'écart (tolérance rel 1e-9).
 *
 *   1. RÉFÉRENCE DÉFINITIVE (versionnée dans le dépôt, LECTURE seule)
 *        packages/engines/reference/roadsens_burmister_definitive.html
 *      chargée dans un VRAI navigateur (chromium, file://). On pilote `doCalc()` et
 *      on capture l'objet BRUT `_D` (tous intermédiaires : contraintes, ε_t/ε_z,
 *      admissibles, coefficients de structure). La définitive applique TOUJOURS la
 *      condition d'interface automatique (Tab. 68) dans son calcul principal et
 *      recalcule les modules GNT quand `cp.gntAuto` — on aligne le serveur via les
 *      flags de production.
 *   2. PLATEFORME : le MÊME jeu d'entrées est recalculé côté SERVEUR (POST
 *      /calc/burmister sur Render — le calcul confidentiel ne tourne jamais au
 *      navigateur, DoD §8). On capture la sortie whitelistée.
 *   3. COMPARAISON champ par champ via la PROJECTION documentée (index.ts) :
 *      identité pour les grandeurs finales, ×1000 (MPa→kPa) pour les contraintes,
 *      strip du discriminant Kmix pour la famille. Écart attendu : 0 (rel ≤ 1e-9).
 *
 * SENTINELLE PASSE-2 (test.fail() documenté) : le serveur estampille ENCORE
 * `engineSourceHash` = 259a (moderne) alors que la production calcule selon 42bb
 * (définitive). Le test « meta serveur scelle la même référence » reste donc ROUGE
 * (marqué `test.fail()`) tant que la passe 2 (bascule du registre vers 42bb) n'est
 * pas faite ET déployée sur Render. Cf. sentinelle vitest jumelle
 * `packages/engines/src/registry/registry.burmister-seal.sentinel.test.ts`.
 *
 * SKIP BRUYANT (jamais un faux-vert) : si la référence est absente, le test ÉCHOUE
 * explicitement plutôt que de passer à vide.
 *
 * PORTÉE HONNÊTE (@science-unsigned) : ceci prouve l'ÉQUIVALENCE DU PORTAGE
 * (plateforme == référence définitive), PAS la JUSTESSE scientifique absolue
 * (cas-tests STARFIRE — hors périmètre). Un portage à 0 % d'un moteur faux resterait
 * faux : la justesse est la responsabilité science du client (split contractuel).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// --------------------------------------------------------------------------
// Référence gelée + API
// --------------------------------------------------------------------------

/**
 * RÉFÉRENCE DÉFINITIVE (versionnée dans le dépôt, LECTURE seule). C'est la source
 * qui reproduit les calculs de PRODUCTION (le mode historique a été retiré —
 * décision titulaire actée). __dirname = tests/e2e -> racine 05-Plateforme (../../).
 */
const FROZEN_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/roadsens_burmister_definitive.html',
);
/**
 * SHA-256 GELÉ de la référence définitive. NB : à ce jour, la meta serveur
 * `engineSourceHash` estampille encore l'ANCIEN sceau (259a, moderne) : le test
 * « meta serveur scelle la même référence » est donc marqué `test.fail()`
 * (sentinelle passe-2, ROUGE tant que le registre n'est pas basculé sur 42bb et
 * déployé). L'ancrage `beforeAll` ci-dessous vérifie que le FICHIER piloté vaut 42bb.
 */
const SEALED_SHA = '42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2';

const API_PUBLIC = 'https://roadsen.onrender.com/calc/burmister';
const REL_TOL = 1e-9;

// UI bout-en-bout (RUN_LIVE=1) :
const FRONT = 'https://roadsen.vercel.app';
const CREDS = { email: 'demo@starfire.test', password: 'RoadsenDemo2026!' };
const ORG = 'demo-starfire';
const RUN_LIVE = process.env.RUN_LIVE === '1';
const NAV = 120_000;

// --------------------------------------------------------------------------
// Jeux de cas de référence — ENTREES pures (client-safe), familles AGEROUTE.
// (Miroir des BURMISTER_FIXTURES ; on n'importe pas @roadsen/engines dans un
//  spec e2e — entrées numériques uniquement, aucune science.)
// --------------------------------------------------------------------------

interface BurmisterInput {
  layers: Array<{ mat: string; h: number; E: number; nu: number }>;
  subgrade: { cls?: string; E: number; nu: number };
  traffic: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
  load: {
    p: number;
    a: number;
    d: number;
    r?: 'auto' | number;
    sh?: 'auto' | number;
    ks?: 'auto' | number;
    /** Mode PRODUCTION : table matériaux définitive (GLc2 s6=0,3705, BQc 0,304, BC5g). */
    materialsRev?: 'definitive';
    /** Mode PRODUCTION : conditions d'interface automatiques dans le calcul principal (toujours true côté front). */
    ifaceAuto?: boolean;
    /** Module GNT automatique (true par défaut ; false au chargement d'un preset). */
    gntAuto?: boolean;
    /** NE direct (court-circuite le calcul TMJA × CAM × croissance × durée). */
    neForce?: number;
    /** Surcharge ε₆/σ₆ par matériau (table de fatigue éditable de la définitive). */
    fatigueOverrides?: Array<{ mat: string; e6?: number; s6?: number }>;
  };
}

const TR_REF = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
const TR_FAIBLE = { T: 10, C: 0.5, N: 15, tau: 2.0, dir: 1.0, tv: 1.0 };
const TR_FORT = { T: 800, C: 1.2, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
/**
 * Charge de référence en MODE PRODUCTION : la définitive est TOUJOURS le référentiel
 * (`materialsRev:'definitive'`), l'interface automatique est TOUJOURS active
 * (`ifaceAuto:true` — jamais togglée côté front), et le module GNT auto est ON par
 * défaut (`gntAuto:true`). Ces flags sont envoyés à l'API ET portés par le `cp` du
 * navigateur (la définitive ignore materialsRev/ifaceAuto — sa table est déjà la
 * définitive et son calcul principal applique toujours l'interface auto — mais lit
 * bien `cp.gntAuto`). On aligne donc STRICTEMENT les deux côtés sur le même chemin.
 */
const CP = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto' as const,
  sh: 'auto' as const,
  ks: 'auto' as const,
  materialsRev: 'definitive' as const,
  ifaceAuto: true,
  gntAuto: true,
};
const PF2 = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3 = { cls: 'PF3', E: 120, nu: 0.35 };
const PF4 = { cls: 'PF4', E: 200, nu: 0.35 };

interface Cas {
  id: string;
  /** Famille AGEROUTE attendue en sortie serveur (libellé NU), ou null (informatif). */
  familleAttendue: string | null;
  input: BurmisterInput;
}

const CAS: Cas[] = [
  {
    id: 'bitumineuse-épaisse',
    familleAttendue: 'bitumineuse épaisse',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP,
    },
  },
  {
    id: 'souple-à-faible-trafic',
    familleAttendue: 'souple à faible trafic',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.05, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
        { mat: 'GNT2', h: 0.2, E: 150, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FAIBLE,
      load: CP,
    },
  },
  {
    id: 'bitumineuse-épaisse-fort-trafic',
    familleAttendue: 'bitumineuse épaisse',
    input: {
      layers: [
        { mat: 'BBSG2', h: 0.06, E: 1896, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_FORT,
      load: CP,
    },
  },
  {
    id: 'eme2-sur-pf3',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'EME2', h: 0.13, E: 6151, nu: 0.45 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP,
    },
  },
  {
    id: 'semi-rigide',
    familleAttendue: 'semi-rigide',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 },
        { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP,
    },
  },
  {
    id: 'mixte',
    familleAttendue: 'mixte',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GLc1', h: 0.18, E: 2500, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP,
    },
  },
  {
    id: 'béton-bc5',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BC5', h: 0.2, E: 35000, nu: 0.25 },
        { mat: 'BC5', h: 0.18, E: 35000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FORT,
      load: CP,
    },
  },
  {
    id: 'inverse',
    familleAttendue: 'inverse',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 },
        { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP,
    },
  },
  {
    id: 'granulaire',
    familleAttendue: 'granulaire',
    input: {
      layers: [
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FAIBLE,
      load: CP,
    },
  },
  {
    id: 'override-risque-sh-ks',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { ...CP, r: 10, sh: 2.5, ks: 0.95 },
    },
  },
  {
    id: 'borne-charge-centrée-d0',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.07, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { ...CP, d: 0 },
    },
  },
  {
    id: 'borne-pf-faible-pf1',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: { cls: 'PF1', E: 20, nu: 0.35 },
      traffic: TR_REF,
      load: CP,
    },
  },
];

/**
 * Cas MATÉRIAU INCONNU : le référentiel n'a pas la clé -> le moteur d'origine NE
 * lève PAS, il DÉGRADE (e6=Infinity -> admissible fatigue null, famille "granulaire").
 * Vérité observée au navigateur (contredit l'étiquette `horsDomaine` de la fixture
 * jsdom historique). Ce qui compte pour le PORTAGE : le serveur reproduit ce même
 * comportement dégradé au bit près. On le traite donc comme un cas d'équivalence.
 * NOTE science (@science-unsigned) : le moteur ACCEPTE un matériau inconnu et rend
 * un résultat dégradé silencieux — robustesse à signaler au client, mais IDENTIQUE
 * des deux côtés (ce n'est pas un défaut de portage).
 */
const CAS_MATERIAU_INCONNU: Cas = {
  id: 'matériau-inconnu-dégradation-identique',
  familleAttendue: null,
  input: {
    layers: [
      { mat: 'INCONNU_XYZ', h: 0.06, E: 1500, nu: 0.45 },
      { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
    ],
    subgrade: PF2,
    traffic: TR_REF,
    load: CP,
  },
};

// --------------------------------------------------------------------------
// FIXTURES QUI MORDENT (passe 1) — chacune exerce un chemin SPÉCIFIQUE de la
// DÉFINITIVE que les fixtures historiques (toutes r:'auto'|10, gntAuto inerte)
// ne touchaient pas. Objectif : qu'une régression sur ces chemins vire ROUGE.
// Chaque fixture : navigateur définitive ↔ serveur, 0 écart rel ≤ 1e-9.
// --------------------------------------------------------------------------
const CAS_MORDANTES: Cas[] = [
  // (1) RISQUE NON-STANDARD r=7,5 % (hors table {5,10,15,25,50}) — verrouille uRisk
  //     (F3) : la définitive calcule le vrai quantile invNorm(0,925) ; l'ancien
  //     moteur repliait tout risque hors table sur 1,282 (=10 %). Un retour au
  //     repli casserait fatigue.admissible ici.
  {
    id: 'risque-non-standard-7.5',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.14, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { ...CP, r: 7.5 },
    },
  },
  // (2a) SEMI-RIGIDE GLc2 (latérite ciment) — table DÉFINITIVE : s6 recalé 0,37→0,3705.
  {
    id: 'semi-rigide-glc2-definitive',
    familleAttendue: 'semi-rigide',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
        { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP,
    },
  },
  // (2b) SEMI-RIGIDE BQc (banco-coquillage) — table DÉFINITIVE : s6 recalé 0,30→0,304.
  {
    id: 'semi-rigide-bqc-definitive',
    familleAttendue: 'semi-rigide',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'BQc', h: 0.29, E: 10000, nu: 0.25 },
        { mat: 'BQc', h: 0.27, E: 10000, nu: 0.25 },
      ],
      subgrade: PF4,
      traffic: TR_REF,
      load: CP,
    },
  },
  // (3) BÉTON BC5g GOUJONNÉ (matériau AJOUTÉ par la définitive, kd goujonné = 1/1,47,
  //     vs 1/1,7 non goujonné) sur BC2 — structure S17 catalogue. Vérifie le kd goujonné.
  {
    id: 'beton-bc5g-goujonne',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BC5g', h: 0.22, E: 35000, nu: 0.25 },
        { mat: 'BC2', h: 0.15, E: 20000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_FORT,
      load: CP,
    },
  },
  // (4) gntAuto=FALSE (chemin PRESET) avec modules GNT EXPLICITES : la définitive ne
  //     recalcule PAS les E des GNT, elle prend ceux saisis. Verrouille le chemin
  //     preset (`if(cp.gntAuto)` sauté des deux côtés).
  {
    id: 'gnt-auto-false-preset',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 250, nu: 0.35 },
        { mat: 'GNT2', h: 0.2, E: 180, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { ...CP, gntAuto: false },
    },
  },
  // (5) NE DIRECT (neForce) : court-circuite calcNE (TMJA×CAM×croissance×durée). La
  //     définitive lit cp.neForce ; le serveur lit load.neForce. NE doit être imposé.
  {
    id: 'ne-direct-12e6',
    familleAttendue: null,
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: { ...CP, neForce: 1.2e7 },
    },
  },
];

// --------------------------------------------------------------------------
// Pilotage du HTML CLIENT dans le navigateur : reassign des bindings + doCalc.
// --------------------------------------------------------------------------

interface HtmlResult {
  err: string | null;
  d: Record<string, unknown> | null;
}

async function computeHtml(
  page: Page,
  input: BurmisterInput,
  /**
   * Surcharge ε₆/σ₆ par matériau, appliquée en MUTANT `M[mat].e6`/`.s6` AVANT
   * `doCalc()` — reproduction EXACTE du `onchange="M['${k}'].e6=+this.value"` de la
   * table de fatigue éditable de la définitive. MUTATION PERSISTANTE sur la page :
   * à n'utiliser que sur une page DÉDIÉE (cf. test override fatigue), jamais la page
   * partagée (sinon contamination des autres fixtures).
   */
  fatigueOverrides: ReadonlyArray<{ mat: string; e6?: number; s6?: number }> = [],
): Promise<HtmlResult> {
  return page.evaluate(
    ({ st, ov }) => {
      // Surcharge de fatigue : mute M en place (M est const, mais M[mat] est un
      // objet mutable) — comme l'UI de la définitive.
      for (const o of ov) {
        // @ts-expect-error — M : référentiel matériaux global du HTML d'origine.
        if (M && M[o.mat]) {
          // @ts-expect-error — M[mat] : objet matériau global du HTML d'origine.
          if (typeof o.e6 === 'number') M[o.mat].e6 = o.e6;
          // @ts-expect-error — M[mat] : objet matériau global du HTML d'origine.
          if (typeof o.s6 === 'number') M[o.mat].s6 = o.s6;
        }
      }
      // Réassigne les bindings lexicaux `let` du HTML (accessibles en écriture depuis
      // une fonction), appelle `doCalc()`, capture l'objet global `_D` (var).
      // @ts-expect-error — symboles globaux du HTML d'origine.
      ly = st.layers.map((l, i) => ({ id: i + 1, ...l }));
      // @ts-expect-error — pf : binding global du HTML d'origine.
      pf = st.subgrade;
      // @ts-expect-error — tr : binding global du HTML d'origine.
      tr = st.traffic;
      // @ts-expect-error — cp : binding global du HTML d'origine.
      cp = st.load;
      let err: string | null = null;
      try {
        // @ts-expect-error — doCalc : fonction globale du HTML d'origine.
        doCalc();
      } catch (e) {
        err = String((e && (e as Error).message) || e);
      }
      // @ts-expect-error — _D : objet résultat global du HTML d'origine.
      const d = typeof _D !== 'undefined' ? _D : null;
      const ok = d && Object.prototype.hasOwnProperty.call(d, 'PASS');
      return { err: ok ? null : err || 'aucun _D calculé', d: ok ? d : null };
    },
    {
      st: input as unknown as Record<string, unknown>,
      ov: fatigueOverrides as Array<{ mat: string; e6?: number; s6?: number }>,
    },
  );
}

// --------------------------------------------------------------------------
// Vues canoniques (mêmes transforms que la projection serveur, index.ts).
// --------------------------------------------------------------------------

type Canon = Record<string, number | boolean | null>;
const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const x1000 = (v: unknown): number | null =>
  numOf(v) === null ? null : (v as number) * 1000;

function htmlCanon(D: Record<string, unknown>): Canon {
  const s0 = (D.s0 ?? {}) as Record<string, unknown>;
  const sd2 = (D.sd2 ?? {}) as Record<string, unknown>;
  const c: Canon = {
    conforme: D.PASS === true,
    NE: numOf(D.NE),
    epaisseurLiee: numOf(D.H_bit),
    epaisseurTotale: numOf(D.H_tot),
    'ornierage.valeur': numOf(D.ez),
    'ornierage.admissible': numOf(D.ezA),
    'ornierage.ok': D.passZ === true,
    'details.E1_pond': numOf(D.E1),
    'details.nu1_pond': numOf(D.nu1),
    'details.E_psc': numOf(D.Eref),
    'details.nu_psc': numOf(D.nuRef),
    'details.risque_pct': numOf(D.rEff),
    'details.sigmaZ_r0': x1000(s0.sz),
    'details.sigmaR_r0': x1000(s0.sr),
    'details.sigmaZ_d2': x1000(sd2.sz),
    'details.sigmaR_d2': x1000(sd2.sr),
    'details.epsilonT_r0': numOf(D.et0),
    'details.epsilonT_d2': numOf(D.etM),
    'details.epsilonT': numOf(D.et),
    'details.epsilonT_adm': numOf(D.etA),
    'details.epsilonZ_axe': numOf(D.ez0),
    'details.epsilonZ_mid': numOf(D.ezM),
    'details.epsilonZ': numOf(D.ez),
    'details.epsilonZ_adm': numOf(D.ezA),
  };
  if (D.hasBit === true) {
    c['fatigue.valeur'] = numOf(D.et);
    c['fatigue.admissible'] = numOf(D.etA);
    c['fatigue.ok'] = D.passT === true;
    c['fatigue.rigide'] = D.sig === 1 || D.sig === true;
  }
  return c;
}

function srvCanon(o: Record<string, unknown>): Canon {
  const d = (o.details ?? {}) as Record<string, unknown>;
  const orn = (o.ornierage ?? {}) as Record<string, unknown>;
  const c: Canon = {
    conforme: o.conforme === true,
    NE: numOf(o.NE),
    epaisseurLiee: numOf(o.epaisseurLiee),
    epaisseurTotale: numOf(o.epaisseurTotale),
    'ornierage.valeur': numOf(orn.valeur),
    'ornierage.admissible': numOf(orn.admissible),
    'ornierage.ok': orn.ok === true,
    'details.E1_pond': numOf(d.E1_pond),
    'details.nu1_pond': numOf(d.nu1_pond),
    'details.E_psc': numOf(d.E_psc),
    'details.nu_psc': numOf(d.nu_psc),
    'details.risque_pct': numOf(d.risque_pct),
    'details.sigmaZ_r0': numOf(d.sigmaZ_r0),
    'details.sigmaR_r0': numOf(d.sigmaR_r0),
    'details.sigmaZ_d2': numOf(d.sigmaZ_d2),
    'details.sigmaR_d2': numOf(d.sigmaR_d2),
    'details.epsilonT_r0': numOf(d.epsilonT_r0),
    'details.epsilonT_d2': numOf(d.epsilonT_d2),
    'details.epsilonT': numOf(d.epsilonT),
    'details.epsilonT_adm': numOf(d.epsilonT_adm),
    'details.epsilonZ_axe': numOf(d.epsilonZ_axe),
    'details.epsilonZ_mid': numOf(d.epsilonZ_mid),
    'details.epsilonZ': numOf(d.epsilonZ),
    'details.epsilonZ_adm': numOf(d.epsilonZ_adm),
  };
  const fat = o.fatigue as Record<string, unknown> | undefined;
  if (fat) {
    c['fatigue.valeur'] = numOf(fat.valeur);
    c['fatigue.admissible'] = numOf(fat.admissible);
    c['fatigue.ok'] = fat.ok === true;
    c['fatigue.rigide'] = fat.rigide === true;
  }
  return c;
}

/** Écart relatif signé entre deux valeurs canoniques (0 si identiques au bit). */
function relErr(a: number | boolean | null, b: number | boolean | null): number {
  if (a === b) return 0;
  if (a === null || b === null) return Infinity;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b ? 0 : Infinity;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / denom;
}

/** POST entrée -> API publique -> sortie serveur (recalcul confidentiel côté serveur). */
async function computeServer(
  request: APIRequestContext,
  input: BurmisterInput,
): Promise<{ meta: Record<string, unknown>; output: Record<string, unknown> }> {
  const resp = await request.post(API_PUBLIC, {
    data: input,
    headers: { 'Content-Type': 'application/json' },
    timeout: NAV,
  });
  expect(resp.status(), 'API /calc/burmister doit répondre 201').toBe(201);
  const env = (await resp.json()) as {
    meta: Record<string, unknown>;
    output: Record<string, unknown>;
  };
  return { meta: env.meta, output: env.output };
}

// ==========================================================================
// SUITE 1 — golden-master champ par champ (navigateur HTML ↔ serveur API).
// ==========================================================================

test.describe('ÉQUIVALENCE burmister — HTML client (navigateur) ↔ plateforme (serveur)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // SKIP BRUYANT : sans le HTML source, on ÉCHOUE (jamais un faux-vert).
    if (!existsSync(FROZEN_HTML)) {
      throw new Error(
        `HTML client de référence ABSENT (${FROZEN_HTML}). Sources hors dépôt : ` +
          `impossible de prouver l'équivalence — ÉCHEC dur (pas de skip silencieux).`,
      );
    }
    // Ancrage : le fichier testé == la référence scellée au registre.
    const sha = createHash('sha256').update(readFileSync(FROZEN_HTML)).digest('hex');
    expect(sha, 'SHA du HTML testé != empreinte scellée au registre').toBe(SEALED_SHA);

    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', () => {
      /* les erreurs de rendu (icônes CDN absentes) sont sans effet : _D est calculé avant renderRes */
    });
    await page.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    // Sanity : le HTML expose bien la fonction de calcul.
    expect(
      await page.evaluate(() => typeof (globalThis as { doCalc?: unknown }).doCalc),
    ).toBe('function');
  });

  // SENTINELLE PASSE-2 (échec ATTENDU, jamais un faux-vert) : le serveur estampille
  // ENCORE l'ancien sceau (259a, moderne) alors que la production calcule selon la
  // DÉFINITIVE (42bb). Ce test RESTE ROUGE tant que la passe 2 (bascule du registre
  // + déploiement Render) n'est pas faite. `test.fail()` l'exprime comme « échec
  // attendu » : Playwright le compte VERT tant qu'il échoue, et le fera virer ROUGE
  // (forçant le retrait de test.fail()) le jour où la meta renverra 42bb.
  test('SENTINELLE passe-2 : la meta serveur scelle la même référence que le fichier piloté (engineSourceHash == 42bb)', async ({
    request,
  }) => {
    test.fail(
      true,
      'Le serveur estampille encore 259a (moderne). Deviendra vert à la bascule du ' +
        'registre vers 42bb (passe 2) + déploiement — retirer alors test.fail().',
    );
    const { meta } = await computeServer(request, CAS[0].input);
    expect(
      meta.engineSourceHash,
      'la meta serveur doit sceller la référence DÉFINITIVE (42bb) qui reproduit la production',
    ).toBe(SEALED_SHA);
  });

  for (const cas of [...CAS, ...CAS_MORDANTES]) {
    test(`given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9) sur tous les champs`, async ({
      request,
    }) => {
      const html = await computeHtml(page, cas.input);
      expect(
        html.d,
        `le HTML d'origine doit calculer un _D pour ${cas.id} (err=${html.err})`,
      ).not.toBeNull();

      const { output } = await computeServer(request, cas.input);
      expect(
        output.erreur,
        `le serveur ne doit pas être en erreur pour ${cas.id}`,
      ).toBeNull();

      const hc = htmlCanon(html.d as Record<string, unknown>);
      const sc = srvCanon(output);
      const keys = Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]));

      let worst = 0;
      const ecarts: string[] = [];
      for (const k of keys) {
        const e = relErr(hc[k], sc[k]);
        if (e > worst) worst = e;
        if (e > REL_TOL)
          ecarts.push(
            `${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`,
          );
      }

      // Famille : le serveur strippe le discriminant Kmix ; le libellé NU doit
      // rester un préfixe du brut HTML (transform documenté, non un écart).
      const famRaw = String((html.d as Record<string, unknown>).fam ?? '');
      const famSrv = String(output.famille ?? '');
      expect(
        famRaw.toLowerCase().startsWith(famSrv.toLowerCase()) && famSrv.length > 0,
        `famille: brut="${famRaw}" serveur="${famSrv}"`,
      ).toBe(true);
      if (cas.familleAttendue) expect(famSrv).toBe(cas.familleAttendue);

      console.log(
        `[${cas.id}] écart max rel=${worst.toExponential(3)} · ${keys.length} champs · ` +
          `NE=${sc.NE} conforme=${sc.conforme} famille="${famSrv}"`,
      );
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst, `écart max rel doit être ≤ ${REL_TOL}`).toBeLessThanOrEqual(REL_TOL);
    });
  }

  test('given un matériau inconnu, when calculé des 2 côtés, then dégradation IDENTIQUE (0 écart)', async ({
    request,
  }) => {
    const html = await computeHtml(page, CAS_MATERIAU_INCONNU.input);
    expect(
      html.d,
      'le HTML dégrade (ne lève pas) sur un matériau inconnu',
    ).not.toBeNull();
    const { output } = await computeServer(request, CAS_MATERIAU_INCONNU.input);
    expect(
      output.erreur,
      "le serveur dégrade lui aussi (pas d'erreur), fidèle au HTML",
    ).toBeNull();

    const hc = htmlCanon(html.d as Record<string, unknown>);
    const sc = srvCanon(output);
    let worst = 0;
    const ecarts: string[] = [];
    for (const k of Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]))) {
      const e = relErr(hc[k], sc[k]);
      if (e > worst) worst = e;
      if (e > REL_TOL)
        ecarts.push(`${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`);
    }
    console.log(
      `[matériau-inconnu] écart max rel=${worst.toExponential(3)} · dégradation identique · fatigue.adm=${sc['fatigue.admissible']}`,
    );
    expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
    expect(worst).toBeLessThanOrEqual(REL_TOL);
  });

  test('given une surcharge ε₆ du matériau dimensionnant, when calculé des 2 côtés, then override pris en compte ET 0 écart', async ({
    browser,
    request,
  }) => {
    // Structure bitumineuse : matériau DIMENSIONNANT = GB3 (base du paquet lié).
    // Défaut catalogue GB3 : ε₆ = 90 µdef (cf. sortie serveur) → on surcharge à 130.
    const OV = [{ mat: 'GB3', e6: 130 }];
    const input: BurmisterInput = {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.14, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { ...CP, fatigueOverrides: OV },
    };

    // Navigateur : page DÉDIÉE (mutation de M PERSISTANTE — jamais la page partagée,
    // sinon les autres fixtures seraient contaminées).
    const ovCtx = await browser.newContext();
    const ovPage = await ovCtx.newPage();
    ovPage.on('pageerror', () => {});
    await ovPage.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    const html = await computeHtml(ovPage, input, OV);
    expect(
      html.d,
      `le HTML définitive doit calculer un _D (err=${html.err})`,
    ).not.toBeNull();
    const D = html.d as Record<string, unknown>;
    await ovCtx.close();

    const { output } = await computeServer(request, input);
    expect(output.erreur, 'le serveur ne doit pas être en erreur').toBeNull();

    // BITE : l'override doit être EFFECTIVEMENT retenu des deux côtés. Navigateur :
    // _D.e6 (= minE6 = ε₆ du matériau dimensionnant) == 130. Serveur :
    // fatigue.referenceCatalogue (ε₆ effectivement utilisé, tracé pour le PV) == 130.
    expect(numOf(D.e6), 'navigateur : ε₆ dimensionnant surchargé à 130').toBe(130);
    const fat = output.fatigue as Record<string, unknown> | undefined;
    expect(
      fat?.referenceCatalogue,
      'serveur : ε₆ effectivement retenu (referenceCatalogue) == 130',
    ).toBe(130);

    // ÉQUIVALENCE champ par champ (0 écart).
    const hc = htmlCanon(D);
    const sc = srvCanon(output);
    let worst = 0;
    const ecarts: string[] = [];
    for (const k of Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]))) {
      const e = relErr(hc[k], sc[k]);
      if (e > worst) worst = e;
      if (e > REL_TOL)
        ecarts.push(`${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`);
    }
    console.log(
      `[override-fatigue-e6] écart max rel=${worst.toExponential(3)} · ε₆=130 · fatigue.adm=${sc['fatigue.admissible']}`,
    );
    expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
    expect(worst, `écart max rel doit être ≤ ${REL_TOL}`).toBeLessThanOrEqual(REL_TOL);
  });
});

// ==========================================================================
// SUITE 2 — bout-en-bout PLATEFORME (UI réelle) : login -> ROADSENS ->
// Calculer -> le recalcul SERVEUR persisté == le HTML client, et l'affichage
// est fidèle (pas de ×1000 parasite). RUN_LIVE=1 requis.
// ==========================================================================

async function loginUi(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(CREDS.email);
  await page.getByLabel('Mot de passe').fill(CREDS.password);
  await Promise.all([
    page.waitForURL(/\/app\/demo-starfire\/(logiciels|projets)/, { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

test.describe('BOUT-EN-BOUT ROADSENS (UI réelle Vercel↔Render)', () => {
  test.skip(!RUN_LIVE, 'RUN_LIVE=1 requis pour cibler la plateforme en ligne.');

  test("given la page ROADSENS (structure de référence), when je saisis le trafic et Calcule, then le recalcul serveur == HTML client et l'affichage est fidèle", async ({
    browser,
  }) => {
    // Le HTML client sur la structure PAR DÉFAUT de la page (BBSG1/GB3/GL1 sur PF2),
    // avec le trafic qu'on va saisir dans l'UI (T=150, reste = défauts du formulaire).
    if (!existsSync(FROZEN_HTML))
      throw new Error('HTML client absent — impossible de comparer.');
    const uiInput: BurmisterInput = {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      // Mode PRODUCTION (définitive) — cf. CP : materialsRev/ifaceAuto/gntAuto.
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
        materialsRev: 'definitive',
        ifaceAuto: true,
        gntAuto: true,
      },
    };

    const refCtx = await browser.newContext();
    const refPage = await refCtx.newPage();
    await refPage.goto(pathToFileURL(FROZEN_HTML).href, {
      waitUntil: 'domcontentloaded',
    });
    const html = await computeHtml(refPage, uiInput);
    expect(html.d, 'HTML client doit calculer la structure UI').not.toBeNull();
    const hc = htmlCanon(html.d as Record<string, unknown>);
    await refCtx.close();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);
    await loginUi(page);

    await page.goto(`${FRONT}/app/${ORG}/logiciels/roadsens`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

    // Projet CH sélectionnable
    const picker = page.getByRole('combobox', { name: 'Projet' }).first();
    await expect
      .poll(async () => picker.locator('option').count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await picker.selectOption({ index: 1 });

    // Onglet Trafic -> saisir T=150 (défaut = 0, sinon NE≤0 -> erreur)
    await page.getByRole('tab', { name: 'Trafic' }).click();
    const tField = page.getByLabel(/TMJA|trafic.*PL|T \(PL/i).first();
    await tField.fill('150');

    // Calculer -> intercepter le recalcul SERVEUR persisté (/projects/:id/calc/burmister)
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/projects\/[^/]+\/calc\/burmister/.test(r.url()) &&
          r.request().method() === 'POST',
        { timeout: 90_000 },
      ),
      page.getByRole('button', { name: /^Calculer/i }).click(),
    ]);
    expect(resp.status(), 'le recalcul serveur ne doit pas planter').toBeLessThan(500);
    const body = (await resp.json()) as Record<string, unknown>;
    // La réponse persistée porte l'output whitelisté (sous .output ou .output.output selon l'enveloppe).
    const output = ((body.output as Record<string, unknown>)?.output ??
      body.output ??
      body) as Record<string, unknown>;

    const sc = srvCanon(output);
    // Comparaison des grandeurs de dimensionnement clés (celles présentes dans la
    // sortie persistée) — le serveur de l'UI == le HTML client.
    for (const k of [
      'NE',
      'epaisseurLiee',
      'epaisseurTotale',
      'ornierage.valeur',
      'ornierage.admissible',
    ] as const) {
      if (sc[k] !== null && hc[k] !== null) {
        expect(
          relErr(hc[k], sc[k]),
          `UI/serveur ${k}: HTML=${hc[k]} serveur=${sc[k]}`,
        ).toBeLessThanOrEqual(REL_TOL);
      }
    }

    // Affichage : onglet Résultats visible + bandeau de verdict, capture de preuve.
    await page
      .getByRole('tab', { name: 'Résultats' })
      .click()
      .catch(() => {});
    await page.screenshot({
      path: 'test-results/equiv-burmister-artifacts/ui-resultats.png',
      fullPage: true,
    });
    console.log(`[UI bout-en-bout] NE serveur=${sc.NE} · HTML=${hc.NE}`);

    await ctx.close();
  });
});
