/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type
// PAS les internes du moteur (cela imposerait de modifier la science pour
// satisfaire noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE
// STRICT vit a la frontiere (contract.ts/index.ts, eux verifies). La sortie brute
// est volontairement opaque puis projetee via le schema strict.
/**
 * MOTEUR PIEUX — fondations profondes (NF P 94-262, Eurocode 7).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/casagrande_V5.html — title « CASAGRANDE
 * — Calcul de fondations profondes (NF P 94-262) » ; le NOM de fichier
 * « casagrande » est TROMPEUR, c'est bien le moteur PIEUX, cf. registre +
 * memoire geosuite-engine-mapping). On NE reordonne RIEN, on NE corrige RIEN :
 * l'arbitre est l'equivalence-PORTAGE (module == HTML, rel 1e-9). `@ts-nocheck`
 * est ASSUME : science transcrite, pas du code maison a typer.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'expose PAS de fonction de calcul pure : `compute()` lit son etat dans
 * des CHAMPS DE SAISIE du DOM (`num('g_D')`, `num('c_G')`, coefficients
 * editables...), dans la GLOBALE `state` (section/sens/meth/da/essais/layers/cpt)
 * et via `curPile()` (catalogue PILES selon `g_pieu`), puis APPELLE
 * `renderResults(R)` + des fonctions de dessin (drawCoupe/drawQcLog/drawBeton/
 * drawPortance). On EXTRAIT ici la science de `compute()` dans une fonction PURE
 * `computePieuxCore(state)` : geometrie, charges, coefficients, profil de couches,
 * penetrogramme CPT et choix de methode sont PASSES EN PARAMETRE ; on RETOURNE le
 * meme objet `R` que le HTML passe a `renderResults`, au lieu de l'afficher. Les
 * fonctions de DESSIN (presentation) ne sont PAS transcrites (elles n'influencent
 * aucun resultat — cf. tableau de decision dans le rapport #48). Aucun acces a la
 * page, aucune horloge, aucun hasard : deterministe.
 *
 * --- AUCUN NON-DETERMINISME DANS LE CHEMIN DE CALCUL ---
 * `compute()` et ses dependances de calcul (pileGeom/layerTops/soilAt/arithMean/
 * qcAt/computeQce/qsCPT/groupCe/effLen/xiFactors/settlement, tables NF P 94-262) ne
 * contiennent NI horloge NI hasard NI iteration d'objet a ordre instable. Le HTML
 * d'origine ecrit un detail de penetrogramme dans une globale de rendu (effet de
 * bord de PRESENTATION, hors calcul) ; on ne le transcrit PAS (capture en variable
 * locale). Le module est par construction sans acces global, sans horloge ni hasard
 * ni for..in (test anti-non-determinisme vert).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#48) ---
 * Equivalence-PORTAGE prouvee (module == HTML, tolerance rel 1e-9). JUSTESSE
 * scientifique NON validee tant que le kit cas-tests STARFIRE n'est pas
 * disponible : @science-unsigned. MJ-6 : pas de prod sans conformite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale
 * stable : si du code moteur fuyait dans le bundle navigateur, le controle CI
 * (grep) la detecterait. Reference inerte cote calcul.
 */
export const PIEUX_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// TABLES & CONSTANTES NF P 94-262 (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

/* --- 20 categories de pieux -> 8 classes (Tableau A.1, NF P 94-262) --- */
const PILES = [
  { cat: 1, ab: 'FS', name: 'Foré simple (pieux et barrettes)', cls: 1, refoule: false },
  { cat: 2, ab: 'FB', name: 'Foré boue (pieux et barrettes)', cls: 1, refoule: false },
  { cat: 3, ab: 'FTP', name: 'Foré tubé (virole perdue)', cls: 1, refoule: false },
  { cat: 4, ab: 'FTR', name: 'Foré tubé (virole récupérée)', cls: 1, refoule: false },
  {
    cat: 5,
    ab: 'FSR/FBR/PU',
    name: 'Foré simple/boue avec rainurage ou puits',
    cls: 1,
    refoule: false,
  },
  {
    cat: 6,
    ab: 'FTC/FTCD',
    name: 'Foré tarière creuse simple/double rotation',
    cls: 2,
    refoule: false,
  },
  { cat: 7, ab: 'VM', name: 'Vissé moulé', cls: 3, refoule: true },
  { cat: 8, ab: 'VT', name: 'Vissé tubé', cls: 3, refoule: true },
  {
    cat: 9,
    ab: 'BPF/BPR',
    name: 'Battu béton préfabriqué ou précontraint',
    cls: 4,
    refoule: true,
  },
  {
    cat: 10,
    ab: 'BE',
    name: 'Battu enrobé (béton/mortier/coulis)',
    cls: 4,
    refoule: true,
  },
  { cat: 11, ab: 'BM', name: 'Battu moulé', cls: 4, refoule: true },
  { cat: 12, ab: 'BAF', name: 'Battu acier fermé', cls: 4, refoule: true },
  { cat: 13, ab: 'BAO', name: 'Battu acier ouvert', cls: 5, refoule: true },
  { cat: 14, ab: 'HB', name: 'Profilé H battu', cls: 6, refoule: true },
  { cat: 15, ab: 'HBi', name: 'Profilé H battu injecté', cls: 6, refoule: true },
  { cat: 16, ab: 'PP', name: 'Palplanches battues', cls: 7, refoule: true },
  { cat: 17, ab: 'M1', name: 'Micropieu type I', cls: 1, refoule: false, micro: true },
  { cat: 18, ab: 'M2', name: 'Micropieu type II', cls: 1, refoule: false, micro: true },
  {
    cat: 19,
    ab: 'PIGU/MIGU',
    name: 'Pieu/micropieu injecté IGU (type III)',
    cls: 8,
    refoule: false,
  },
  {
    cat: 20,
    ab: 'PIRS/MIRS',
    name: 'Pieu/micropieu injecté IRS (type IV)',
    cls: 8,
    refoule: false,
  },
];

/* === Facteur de portance pressiometrique kp,max — Tableau F.4.2.1 [classe][sol] === */
const KP_MAX = {
  1: { argile: 1.15, sable: 1.1, craie: 1.45, marne: 1.45, roche: 1.45 },
  2: { argile: 1.3, sable: 1.65, craie: 1.6, marne: 1.6, roche: 2.0 },
  3: { argile: 1.55, sable: 3.2, craie: 2.35, marne: 2.1, roche: 2.1 },
  4: { argile: 1.35, sable: 3.1, craie: 2.3, marne: 2.3, roche: 2.3 },
  5: { argile: 1.0, sable: 1.9, craie: 1.4, marne: 1.4, roche: 1.2 },
  6: { argile: 1.2, sable: 3.1, craie: 1.7, marne: 2.2, roche: 1.5 },
  7: { argile: 1.0, sable: 1.0, craie: 1.0, marne: 1.0, roche: 1.2 },
  8: { argile: 1.15, sable: 1.1, craie: 1.45, marne: 1.45, roche: 1.45 },
};
/* === Facteur de portance penetrometrique kc,max — Tableau G.4.2.1 [classe][sol] === */
const KC_MAX = {
  1: { argile: 0.4, sable: 0.2, craie: 0.3, marne: 0.3, roche: 0.3 },
  2: { argile: 0.45, sable: 0.25, craie: 0.3, marne: 0.3, roche: 0.3 },
  3: { argile: 0.5, sable: 0.5, craie: 0.4, marne: 0.35, roche: 0.35 },
  4: { argile: 0.45, sable: 0.4, craie: 0.4, marne: 0.4, roche: 0.4 },
  5: { argile: 0.35, sable: 0.25, craie: 0.15, marne: 0.15, roche: 0.15 },
  6: { argile: 0.4, sable: 0.4, craie: 0.35, marne: 0.2, roche: 0.2 },
  7: { argile: 0.35, sable: 0.15, craie: 0.15, marne: 0.15, roche: 0.15 },
  8: { argile: 0.45, sable: 0.2, craie: 0.3, marne: 0.3, roche: 0.25 },
};
/* === Courbes de frottement fsol(x)=(a·x+b)(1-e^(-c·x)) ===
   Pressio (Tableau F.5.2.2, x=pl* en MPa) et Penetro (Tableau G.5.2.2, x=qc en MPa) */
const PMT_CURVE = {
  argile: { q: 'Q1', a: 0.003, b: 0.04, c: 3.5 },
  sable: { q: 'Q2', a: 0.01, b: 0.06, c: 1.2 },
  craie: { q: 'Q3', a: 0.007, b: 0.07, c: 1.3 },
  marne: { q: 'Q4', a: 0.008, b: 0.08, c: 3.0 },
  roche: { q: 'Q5', a: 0.01, b: 0.08, c: 3.0 },
};
const CPT_CURVE = {
  argile: { q: 'Q1', a: 0.1, b: 0.0018, c: 0.4 },
  sable: { q: 'Q3', a: 0.1, b: 0.0012, c: 0.15 },
  craie: { q: 'Q2', a: 0.1, b: 0.0015, c: 0.25 },
  marne: { q: 'Q2', a: 0.1, b: 0.0015, c: 0.25 },
  roche: { q: 'Q2', a: 0.1, b: 0.0015, c: 0.25 },
};
/* === alpha(pieu-sol) par categorie [cat] = {argile,sable,craie,marne,roche} ===
   Pressio : Tableau F.5.2.1 · Penetro : Tableau G.5.2.1 (null = non couvert) */
const ALPHA_PMT = {
  1: { argile: 1.1, sable: 1.0, craie: 1.8, marne: 1.5, roche: 1.6 },
  2: { argile: 1.25, sable: 1.4, craie: 1.8, marne: 1.5, roche: 1.6 },
  3: { argile: 0.7, sable: 0.6, craie: 0.5, marne: 0.9, roche: null },
  4: { argile: 1.25, sable: 1.4, craie: 1.7, marne: 1.4, roche: null },
  5: { argile: 1.3, sable: null, craie: null, marne: null, roche: null },
  6: { argile: 1.5, sable: 1.8, craie: 2.1, marne: 1.6, roche: 1.6 },
  7: { argile: 1.9, sable: 2.1, craie: 1.7, marne: 1.7, roche: null },
  8: { argile: 0.6, sable: 0.6, craie: 1.0, marne: 0.7, roche: null },
  9: { argile: 1.1, sable: 1.4, craie: 1.0, marne: 0.9, roche: null },
  10: { argile: 2.0, sable: 2.1, craie: 1.9, marne: 1.6, roche: null },
  11: { argile: 1.2, sable: 1.4, craie: 2.1, marne: 1.0, roche: null },
  12: { argile: 0.8, sable: 1.2, craie: 0.4, marne: 0.9, roche: null },
  13: { argile: 1.2, sable: 0.7, craie: 0.5, marne: 1.0, roche: 1.0 },
  14: { argile: 1.1, sable: 1.0, craie: 0.4, marne: 1.0, roche: 0.9 },
  15: { argile: 2.7, sable: 2.9, craie: 2.4, marne: 2.4, roche: 2.4 },
  16: { argile: 0.9, sable: 0.8, craie: 0.4, marne: 1.2, roche: 1.2 },
  17: { argile: null, sable: null, craie: null, marne: null, roche: null },
  18: { argile: null, sable: null, craie: null, marne: null, roche: null },
  19: { argile: 2.7, sable: 2.9, craie: 2.4, marne: 2.4, roche: 2.4 },
  20: { argile: 3.4, sable: 3.8, craie: 3.1, marne: 3.1, roche: 3.1 },
};
const ALPHA_CPT = {
  1: { argile: 0.55, sable: 0.7, craie: 0.8, marne: 1.4, roche: 1.5 },
  2: { argile: 0.65, sable: 1.0, craie: 0.8, marne: 1.4, roche: 1.5 },
  3: { argile: 0.35, sable: 0.4, craie: 0.25, marne: 0.85, roche: null },
  4: { argile: 0.65, sable: 1.0, craie: 0.75, marne: 0.13, roche: null },
  5: { argile: 0.7, sable: null, craie: null, marne: null, roche: null },
  6: { argile: 0.75, sable: 1.25, craie: 0.95, marne: 1.5, roche: 1.5 },
  7: { argile: 0.95, sable: 1.45, craie: 0.75, marne: 1.6, roche: null },
  8: { argile: 0.3, sable: 0.4, craie: 0.45, marne: 0.65, roche: null },
  9: { argile: 0.55, sable: 1.0, craie: 0.45, marne: 0.85, roche: null },
  10: { argile: 1.0, sable: 1.45, craie: 0.85, marne: 1.5, roche: null },
  11: { argile: 0.6, sable: 1.0, craie: 0.95, marne: 0.95, roche: null },
  12: { argile: 0.4, sable: 0.85, craie: 0.2, marne: 0.85, roche: null },
  13: { argile: 0.6, sable: 0.5, craie: 0.25, marne: 0.95, roche: 0.95 },
  14: { argile: 0.55, sable: 0.7, craie: 0.2, marne: 0.95, roche: 0.85 },
  15: { argile: 1.35, sable: 2.0, craie: 1.1, marne: 2.25, roche: 2.25 },
  16: { argile: 0.45, sable: 0.55, craie: 0.2, marne: 1.25, roche: 1.15 },
  17: { argile: null, sable: null, craie: null, marne: null, roche: null },
  18: { argile: null, sable: null, craie: null, marne: null, roche: null },
  19: { argile: 1.35, sable: 2.0, craie: 1.1, marne: 2.25, roche: 2.25 },
  20: { argile: 1.7, sable: 2.65, craie: 1.4, marne: 2.9, roche: 2.9 },
};
/* === q_s,max (kPa) par categorie — Tableaux F.5.2.3 / G.5.2.3 (identiques) === */
const QSMAX = {
  1: { argile: 90, sable: 90, craie: 200, marne: 170, roche: 200 },
  2: { argile: 90, sable: 90, craie: 200, marne: 170, roche: 200 },
  3: { argile: 50, sable: 50, craie: 50, marne: 90, roche: null },
  4: { argile: 90, sable: 90, craie: 170, marne: 170, roche: null },
  5: { argile: 90, sable: null, craie: null, marne: null, roche: null },
  6: { argile: 90, sable: 170, craie: 200, marne: 200, roche: 200 },
  7: { argile: 130, sable: 200, craie: 170, marne: 170, roche: null },
  8: { argile: 50, sable: 90, craie: 90, marne: 90, roche: null },
  9: { argile: 130, sable: 130, craie: 90, marne: 90, roche: null },
  10: { argile: 170, sable: 260, craie: 200, marne: 200, roche: null },
  11: { argile: 90, sable: 130, craie: 260, marne: 200, roche: null },
  12: { argile: 90, sable: 90, craie: 50, marne: 90, roche: null },
  13: { argile: 90, sable: 50, craie: 50, marne: 90, roche: 90 },
  14: { argile: 90, sable: 130, craie: 50, marne: 90, roche: 90 },
  15: { argile: 200, sable: 380, craie: 320, marne: 320, roche: 320 },
  16: { argile: 90, sable: 50, craie: 50, marne: 90, roche: 90 },
  17: { argile: null, sable: null, craie: null, marne: null, roche: null },
  18: { argile: null, sable: null, craie: null, marne: null, roche: null },
  19: { argile: 200, sable: 380, craie: 320, marne: 320, roche: 320 },
  20: { argile: 200, sable: 440, craie: 440, marne: 440, roche: 500 },
};

/* ---------- lookups dans les tables NF P 94-262 ---------- */
function kpMax(cls, soil) {
  return (KP_MAX[cls] || KP_MAX[1])[soil];
}
function kcMax(cls, soil) {
  return (KC_MAX[cls] || KC_MAX[1])[soil];
}
function alphaPMT(cat, soil) {
  const r = ALPHA_PMT[cat];
  return r ? r[soil] : null;
}
function alphaCPT(cat, soil) {
  const r = ALPHA_CPT[cat];
  return r ? r[soil] : null;
}
function qsMaxOf(cat, soil) {
  const r = QSMAX[cat];
  return r ? r[soil] : null;
}
/* reduction kp pour Def/B < 5 (F.4.2) : kp = 1 + (kpmax-1)·(Def/B)/5 */
function kpReduced(kpmax, deb) {
  return deb >= 5 ? kpmax : 1.0 + ((kpmax - 1.0) * deb) / 5;
}
/* reduction kc pour Def/B < 5 (G.4.2) selon la nature du sol */
function kcReduced(kcmax, deb, soil) {
  if (deb >= 5) return kcmax;
  const base = soil === 'argile' ? 0.3 : soil === 'sable' ? 0.1 : 0.15; // craie/marne/roche=0.15
  return base + ((kcmax - base) * deb) / 5;
}
/* coefficient de modele gammaR;d1 — Tableau F.2.1 / G.2.1 */
function gammaRd1(cat, baseSoil, traction) {
  if ([10, 15, 17, 18, 19, 20].includes(cat)) return 2.0; // pieux a injection
  if (baseSoil === 'craie') return traction ? 1.7 : 1.4; // ancres dans la craie
  return traction ? 1.4 : 1.15; // cas courant
}

/* ===== EUROCODE 7 — NF EN 1997-1 : Annexe A (valeurs recommandees) ===== */
const EC7 = {
  A: { A1: { gG: 1.35, gGfav: 1.0, gQ: 1.5 }, A2: { gG: 1.0, gGfav: 1.0, gQ: 1.3 } }, // Tableau A.3
  M: {
    M1: { phi: 1.0, c: 1.0, cu: 1.0, g: 1.0 },
    M2: { phi: 1.25, c: 1.25, cu: 1.4, g: 1.0 },
  }, // Tableau A.4
  R: {
    // {b:pointe, s:frottement, t:total, st:traction}
    battu: {
      R1: { b: 1.0, s: 1.0, t: 1.0, st: 1.25 },
      R2: { b: 1.1, s: 1.1, t: 1.1, st: 1.15 },
      R3: { b: 1.0, s: 1.0, t: 1.0, st: 1.1 },
      R4: { b: 1.3, s: 1.3, t: 1.3, st: 1.6 },
    }, // A.6
    fore: {
      R1: { b: 1.25, s: 1.0, t: 1.15, st: 1.25 },
      R2: { b: 1.1, s: 1.1, t: 1.1, st: 1.15 },
      R3: { b: 1.0, s: 1.0, t: 1.0, st: 1.1 },
      R4: { b: 1.6, s: 1.3, t: 1.5, st: 1.6 },
    }, // A.7
    cfa: {
      R1: { b: 1.1, s: 1.0, t: 1.1, st: 1.25 },
      R2: { b: 1.1, s: 1.1, t: 1.1, st: 1.15 },
      R3: { b: 1.0, s: 1.0, t: 1.0, st: 1.1 },
      R4: { b: 1.45, s: 1.3, t: 1.4, st: 1.6 },
    }, // A.8
  },
};
/* combinaisons par approche de calcul (§ 2.4.7.3.4) — pieux sous charge axiale */
const DA_COMBOS = {
  da1: [
    { lab: 'DA1·C1', A: 'A1', M: 'M1', R: 'R1' },
    { lab: 'DA1·C2', A: 'A2', M: 'M1', R: 'R4' },
  ], // A1+M1+R1  /  A2+(M1)+R4
  da2: [{ lab: 'DA2', A: 'A1', M: 'M1', R: 'R2' }], // A1+M1+R2 (France)
  da3: [{ lab: 'DA3', A: 'A1', M: 'M2', R: 'R3' }], // (A1/A2)+M2+R3
};
/* famille de pieu au sens EN 1997-1 (A.6 battu / A.7 fore / A.8 CFA) */
function pileFamily(pile) {
  return pile.cat === 6 ? 'cfa' : pile.refoule ? 'battu' : 'fore';
}
/* facteurs M appliques a la resistance (parametres de sol) selon l'approche */
function mResist(da) {
  return da === 'da3' ? EC7.M.M2 : EC7.M.M1;
}

// ===========================================================================
// DEPENDANCES DE CALCUL DE compute() — extraites SANS DOM (state injecte)
// ===========================================================================
//
// Differences avec le HTML, UNIQUEMENT de couplage (PAS de science) :
//   - les fonctions qui lisaient `state.layers` / `state.cpt` recoivent ces
//     donnees en PARAMETRE (`layers`, `cpt`) ;
//   - les lookups DOM (`num('id')`, `$('id').value`) deviennent des champs de
//     l'objet `state` injecte (cf. en-tete + contract.ts).
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

/* profil de couches avec cotes (ztop/zbot) — HTML : layerTops() lit state.layers */
function layerTops(stateLayers) {
  let z = 0,
    arr = [];
  stateLayers.forEach((L) => {
    arr.push({ ...L, ztop: z, zbot: z + L.th });
    z += L.th;
  });
  return arr;
}
function soilAt(z, layers) {
  return (
    layers.find((L) => z >= L.ztop - 1e-9 && z < L.zbot + 1e-9) ||
    layers[layers.length - 1]
  );
}

/* ---------- pression / resistance equivalente sous la pointe ---------- */
function arithMean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

/* ========== PENETROMETRE STATIQUE (CPT) — NF P 94-262 ========== */
/* penetrogramme q_c(z) : interpolation lineaire sur les points saisis ; cpt = state.cpt */
function qcAt(z, cpt) {
  const p = cpt.pts;
  if (!p.length) return 0;
  if (z <= p[0].z) return p[0].qc;
  if (z >= p[p.length - 1].z) return p[p.length - 1].qc;
  for (let i = 1; i < p.length; i++) {
    if (z <= p[i].z) {
      const a = p[i - 1],
        b = p[i];
      const t = (z - a.z) / (b.z - a.z || 1);
      return a.qc + t * (b.qc - a.qc);
    }
  }
  return p[p.length - 1].qc;
}
/* genere un penetrogramme a partir des q_c de couches (au pas cpt.step) — mute cpt.pts */
function genPenetrogram(layers, cpt) {
  const lt = layerTops(layers);
  const H = lt.length ? lt[lt.length - 1].zbot : 0;
  const step = Math.max(0.05, cpt.step || 0.2);
  const pts = [];
  for (let z = 0; z <= H + 1e-9; z += step) {
    const L = soilAt(Math.min(z, H - 1e-6), lt);
    pts.push({ z: +z.toFixed(2), qc: L ? L.qc : 0 });
  }
  cpt.pts = pts;
}
/* q_ce : resistance de pointe equivalente NF P 94-262 — moyenne ecretee a 1,3·q_ce,moy */
function computeQce(D, a, b, cpt) {
  const z0 = D - b,
    z1 = D + 3 * a,
    n = 60,
    raw = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    raw.push(qcAt(Math.max(0, z), cpt));
  }
  const mean0 = arithMean(raw); // q_ce,moy initiale
  const cap = 1.3 * mean0; // plafond d'ecretage
  const clipped = raw.map((x) => Math.min(x, cap)); // q_cc(z) ecrete
  return { qce: arithMean(clipped), mean0, cap, raw, clipped, z0, z1 };
}
/* frottement penetrometrique q_s(z) = alpha(pieu-sol)·f_sol(q_c(z)) <= q_s,max */
function qsCPT(z, soil, cat, cpt) {
  const cu = CPT_CURVE[soil];
  const a = alphaCPT(cat, soil);
  const qsm = qsMaxOf(cat, soil);
  if (a == null || qsm == null) return 0; // combinaison non couverte par la norme
  const qc = qcAt(z, cpt);
  const f = (cu.a * qc + cu.b) * (1 - Math.exp(-cu.c * qc)); // MPa
  return Math.min(a * f * 1000, qsm); // kPa
}

/* ---------- geometrie centralisee (circ/carre/rect/quelconque avec B_eq) ----------
   HTML : pileGeom() lit state.section + num('g_*'). On injecte `geom`. */
function pileGeom(geom) {
  const sec = geom.section;
  if (sec === 'quel') {
    const Ap = geom.g_Ap || 0,
      P = geom.g_P || 0;
    const Beq = Ap > 0 ? 2 * Math.sqrt(Ap / Math.PI) : 0.6;
    return { sec, B: Beq, Bsurf: Beq, Ab: Ap, perim: P };
  }
  const Bsurf = geom.g_B || 0.6,
    b2 = geom.g_b2 || Bsurf;
  const B = sec === 'rect' ? Math.min(Bsurf, b2) : Bsurf;
  const Ab =
    sec === 'circ'
      ? (Math.PI * Bsurf * Bsurf) / 4
      : sec === 'rect'
        ? Bsurf * b2
        : Bsurf * Bsurf;
  const perim =
    sec === 'circ' ? Math.PI * Bsurf : sec === 'rect' ? 2 * (Bsurf + b2) : 4 * Bsurf;
  return { sec, B, Bsurf, Ab, perim };
}
/* ---------- effet de groupe Ce sur Rs (§4.3.2) — HTML lit num('grp_*'). ---------- */
function groupCe(B, grp) {
  const n = Math.max(1, Math.round(grp.grp_n || 1)),
    m = Math.max(1, Math.round(grp.grp_m || 1)),
    S = grp.grp_s || 0;
  if (n <= 1 && m <= 1) return 1;
  if (!(S > 0) || !(B > 0) || S / B >= 3) return 1;
  const Cd = 1 - 0.25 * (1 + S / B);
  return Math.max(0, Math.min(1, 1 - Cd * (2 - (1 / m + 1 / n))));
}
/* ---------- longueur effective d'un troncon (qs degradee au-dela de 25 m, §4.3.1) ---------- */
function effLen(top, bot, D) {
  const zB = D - 25; // au-dessus de zB (> 25 m de la pointe) : qs/2
  const beyond = Math.max(0, Math.min(bot, zB) - top);
  return 0.5 * beyond + (bot - top - beyond);
}

/* ---------- facteurs de correlation xi (Tableau C.2.4.2 / E.2.1 / §9.2.3) ---------- */
function xiFactors(N, S, redistrib) {
  const t = {
    1: [1.4, 1.4],
    2: [1.35, 1.27],
    3: [1.33, 1.23],
    4: [1.31, 1.2],
    5: [1.29, 1.15],
    7: [1.27, 1.12],
    10: [1.25, 1.08],
  };
  const keys = Object.keys(t)
    .map(Number)
    .sort((a, b) => a - b);
  let k = keys[0];
  keys.forEach((x) => {
    if (N >= x) k = x;
  });
  let [x3, x4] = t[k];
  // E.2.1 : xi(N,S) = 1 + (xi'-1)·sqrt(S/Sref) avec Sref = 2500 m²
  const Sref = 2500,
    Su = Math.min(2500, Math.max(100, S > 0 ? S : 2500));
  const f = Math.sqrt(Su / Sref);
  x3 = 1 + (x3 - 1) * f;
  x4 = 1 + (x4 - 1) * f;
  // §9.2.3 : structure rigide redistribuant les charges -> xi / 1,1 (jamais < 1,0)
  if (redistrib) {
    x3 = Math.max(1.0, x3 / 1.1);
    x4 = Math.max(1.0, x4 / 1.1);
  }
  return [x3, x4];
}

/* ---------- tassement (Frank & Zhao simplifie) ---------- */
function settlement(layers, B, D, z0, Ab, perim, qbLim, fric, baseLayer, Fels) {
  if (!baseLayer || !fric || !fric.length) return null;
  const Ep = 2.0e7; // module du pieu ~ 20 GPa (beton), kPa
  const isFine = (s) => s === 'argile'; // fins : argiles/limons ; autres : granulaires
  function segAt(z) {
    const f =
      fric.find((e) => z >= e.top - 1e-9 && z < e.bot + 1e-9) || fric[fric.length - 1];
    const L = layers.find((l) => z >= l.ztop - 1e-9 && z < l.zbot + 1e-9) || baseLayer;
    const EM = L.em || 10;
    return { qsLim: f ? f.qs : 0, ktau: ((isFine(L.soil) ? 2.0 : 0.8) * EM * 1000) / B };
  }
  const EMb = baseLayer.em || 10;
  const kq = ((isFine(baseLayer.soil) ? 11 : 4.8) * EMb * 1000) / B; // kPa/m
  const mob = (w, lim, k) => {
    if (lim <= 0 || w <= 0) return 0;
    const w1 = lim / 2 / k;
    if (w <= w1) return k * w;
    const wc = w1 + lim / 2 / (k / 5);
    return w <= wc ? lim / 2 + (k / 5) * (w - w1) : lim;
  };
  const nseg = Math.max(40, Math.ceil((D - z0) / 0.25)),
    dz = (D - z0) / nseg;
  const pts = [];
  const wbMax = Math.max(B * 0.12, 0.05);
  let Fmax = 0;
  for (let s = 0; s <= 60; s++) {
    const wb = (wbMax * s) / 60;
    let w = wb,
      N = mob(wb, qbLim, kq) * Ab; // effort de pointe (kN)
    for (let i = 0; i < nseg; i++) {
      const z = Math.max(z0, D - (i + 0.5) * dz);
      const sg = segAt(z);
      N += mob(w, sg.qsLim, sg.ktau) * perim * dz; // l'effort axial croit vers la tete
      w += (N / (Ep * Ab)) * dz; // raccourcissement elastique cumule
    }
    pts.push({ F: N, s: w * 1000 });
    Fmax = Math.max(Fmax, N);
  }
  let sEls = 0;
  if (Fels <= pts[0].F) sEls = pts[0].s;
  else if (Fels >= pts[pts.length - 1].F) sEls = pts[pts.length - 1].s;
  else
    for (let i = 1; i < pts.length; i++) {
      if (Fels <= pts[i].F) {
        const a = pts[i - 1],
          b = pts[i],
          t = (Fels - a.F) / (b.F - a.F || 1);
        sEls = a.s + t * (b.s - a.s);
        break;
      }
    }
  return {
    pts,
    sEls,
    EM: EMb,
    fine: isFine(baseLayer.soil),
    ktau: ((isFine(baseLayer.soil) ? 2 : 0.8) * EMb * 1000) / B,
    kq,
    Fmax,
  };
}

// ===========================================================================
// CALCUL PRINCIPAL — extraction PURE de compute() (etat injecte, pas de DOM)
// ===========================================================================
//
// Transcription FIDELE de compute(). Les seules differences avec le HTML :
//   - geometrie/charges/coefficients/profil/penetrogramme/methode ne sont plus
//     lus dans le DOM (`num('id')`, `$('id').value`), la globale `state` ou
//     `curPile()`, mais DEBALLES depuis `state` (cf. en-tete + contract.ts) ;
//   - on RETOURNE l'objet `R` (l'argument que le HTML passe a `renderResults`) au
//     lieu de l'afficher ; les fonctions de DESSIN (presentation) ne sont PAS
//     appelees (drawCoupe/drawQcLog/drawBeton/drawPortance — aucun effet sur R) ;
//   - les cas d'erreur que le HTML rend via `renderResults({err:...})` sont
//     RETOURNES sous la meme forme `{ err }`.
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

function computePieuxCore(state) {
  const coeffs = state.coeffs;
  // resolution du catalogue PILES selon la categorie demandee (HTML : curPile()).
  const pile = PILES.find((p) => p.cat == state.cat) || PILES[0];

  const PG = pileGeom(state.geom);
  const B = PG.B,
    Bsurf = PG.Bsurf;
  const D = state.g_D,
    z0 = state.g_z0;
  const layers = layerTops(state.layers);
  const Hsol = layers.length ? layers[layers.length - 1].zbot : 0;
  const meth = state.meth;

  // garde-fous
  let warn = [];
  if (!layers.length) {
    return { err: 'Aucune couche de sol définie (onglet 02).' };
  }
  if (D > Hsol + 1e-6) {
    warn.push(
      `La base D = ${fmt(D, 1)} m dépasse le profil de sol (${fmt(Hsol, 1)} m). Ajoutez une couche porteuse.`,
    );
  }
  if (D <= z0) {
    return {
      err: 'La profondeur de base D doit être supérieure à la profondeur de tête z₀.',
    };
  }

  // sections
  const Ab = PG.Ab,
    perim = PG.perim;

  // zone d'influence pointe
  const a = Math.max(B / 2, 0.5);
  const baseLayer = soilAt(D - 0.01, layers);
  const hInLayer = baseLayer ? D - baseLayer.ztop : 0;
  const b = Math.min(a, Math.max(hInLayer, 0.001));
  const cls = pile.cls,
    cat = pile.cat,
    traction = state.sens === 'trac';

  // ancrage minimal dans la couche porteuse (NF P 94-262 §F.4.2/G.4.2 Note 1)
  if (!pile.micro && hInLayer > 1e-6 && hInLayer < 3 * B - 1e-6)
    warn.push(
      `Ancrage dans la couche porteuse h = ${fmt(hInLayer, 2)} m &lt; 3·B = ${fmt(3 * B, 2)} m recommandé (NF P 94-262, Note 1 de F.4.2/G.4.2). Réductible à 0,50 m si l'exécution de l'encastrement de pointe est garantie (prélèvements, trépan ou carottier).`,
    );

  // ---- hauteur d'encastrement equivalente Def et terme de pointe qb ----
  let qb = 0,
    ple = 0,
    qce = 0,
    kfac = 0,
    kmax = 0,
    Def = 0,
    debR = 0,
    qbDetail = '';
  let qceDetail = null;
  // Penetrogramme effectivement utilise pour le frottement CPT (renseigne dans la
  // branche 'cpt'). Variable LOCALE (jamais ecrite dans `state` : purete preservee).
  let cptUsed = null;
  const hD = 10 * B; // longueur d'encastrement de reference (F.4.2.6 / G.4.2) : hD = 10·B
  if (meth === 'pmt') {
    // p*le = pression limite nette equivalente = moyenne integrale sur [D-b ; D+3a]  (eq. F.4.2.3)
    {
      const w = b + 3 * a;
      let s = 0;
      const ns = Math.max(40, Math.ceil(w / 0.05));
      for (let i = 0; i < ns; i++) {
        const z = D - b + (w * (i + 0.5)) / ns;
        const L = soilAt(Math.max(0, z), layers);
        s += L ? L.pl : 0;
      }
      ple = ns ? s / ns : 0;
    } // MPa
    // Def = (1/p*le)·integ_{D-hD}^{D} pl*(z) dz  avec hD = 10·B  (eq. F.4.2.6)
    const zlo = Math.max(0, D - hD),
      Lw = D - zlo;
    let integ = 0;
    const ns = Math.max(20, Math.ceil(Lw / 0.1));
    for (let i = 0; i < ns; i++) {
      const z = zlo + (Lw * (i + 0.5)) / ns;
      const L = soilAt(z, layers);
      integ += (L ? L.pl : 0) * (Lw / ns);
    }
    Def = ple > 0 ? integ / ple : 0;
    debR = Def / B;
    kmax = kpMax(cls, baseLayer.soil);
    kfac = kpReduced(kmax, debR);
    qb = pile.micro ? 0 : kfac * ple * 1000; // kPa (micropieu : pas de pointe)
    qbDetail = `p<sub>le</sub>* = ${fmt(ple, 2)} MPa (zone D−b…D+3a) · D<sub>ef</sub>/B = ${fmt(debR, 1)} (intégré sur 10B au‑dessus de la pointe) · k<sub>p</sub> = ${fmt(kfac, 2)} (k<sub>p,max</sub>=${fmt(kmax, 2)})`;
  } else if (meth === 'cpt') {
    // cpt local au calcul (HTML : state.cpt, mute si vide). On clone pour ne pas
    // muter l'entree (le HTML mute state.cpt ; ici on garde la PURETE de l'appel).
    const cpt = { step: state.cpt.step, pts: state.cpt.pts.slice() };
    if (!cpt.pts.length) genPenetrogram(state.layers, cpt);
    const qq = computeQce(D, a, b, cpt);
    qce = qq.qce;
    qceDetail = qq; // HTML : detail ecrit dans une globale de rendu ; ici capture locale interne. MPa
    // Def = (1/qce)·integ_{D-hD}^{D} qc(z) dz  avec hD = 10·B  (annexe G, §4.2)
    const zlo = Math.max(0, D - hD),
      Lw = D - zlo;
    let integ = 0;
    const ns = Math.max(20, Math.ceil(Lw / 0.1));
    for (let i = 0; i < ns; i++) {
      const z = zlo + (Lw * (i + 0.5)) / ns;
      integ += qcAt(z, cpt) * (Lw / ns);
    }
    Def = qce > 0 ? integ / qce : 0;
    debR = Def / B;
    kmax = kcMax(cls, baseLayer.soil);
    kfac = kcReduced(kmax, debR, baseLayer.soil);
    qb = pile.micro ? 0 : kfac * qce * 1000;
    qbDetail = `q<sub>ce</sub> = ${fmt(qce, 2)} MPa (écrêté à ${fmt(qq.cap, 1)}) · D<sub>ef</sub>/B = ${fmt(debR, 1)} (intégré sur 10B au‑dessus de la pointe) · k<sub>c</sub> = ${fmt(kfac, 2)} (k<sub>c,max</sub>=${fmt(kmax, 2)})`;
    // penetrogramme effectivement utilise pour le frottement CPT (local, pas de mutation de state).
    cptUsed = cpt;
  } else {
    // c-phi : Nq, Nc effectifs (parametres reduits par le jeu M selon l'approche)
    const mR = mResist(state.da);
    const phi = Math.atan(Math.tan((baseLayer.phi * Math.PI) / 180) / mR.phi),
      c = baseLayer.c / mR.c;
    const Nq =
      Math.exp(Math.PI * Math.tan(phi)) * Math.pow(Math.tan(Math.PI / 4 + phi / 2), 2);
    const Nc = Math.abs(phi) < 1e-6 ? 5.14 : (Nq - 1) / Math.tan(phi);
    let sv = 0;
    layers.forEach((L) => {
      const dz = Math.min(L.zbot, D) - Math.min(L.ztop, D);
      if (dz > 0) sv += L.gamma * dz;
    });
    const nappe = state.o_nappe;
    const uBase = D > nappe ? 9.81 * (D - nappe) : 0;
    const svEff = Math.max(sv - uBase, 0);
    qb = pile.micro ? 0 : c * Nc + svEff * Nq; // kPa
    kfac = Nq;
    Def = D;
    debR = Def / B;
    qbDetail = `N<sub>q</sub> = ${fmt(Nq, 1)} · N<sub>c</sub> = ${fmt(Nc, 1)} · σ'<sub>v</sub> = ${fmt(svEff, 0)} kPa${state.da === 'da3' ? ' · jeu M2 sur c′/φ′' : ''}`;
  }
  const Rb = qb * Ab; // kN

  // ---- frottement lateral Rs ----
  let Rs = 0,
    RsKsum = 0;
  const fric = [];
  let frThin = false,
    frUncov = false;
  const cptForQs = cptUsed || state.cpt;
  layers.forEach((L) => {
    const top = Math.max(L.ztop, z0),
      bot = Math.min(L.zbot, D);
    if (bot <= top) return;
    const dz = bot - top;
    let qs = 0,
      qsm = null;
    if (meth === 'pmt') {
      const cu = PMT_CURVE[L.soil];
      const al = alphaPMT(cat, L.soil);
      qsm = qsMaxOf(cat, L.soil);
      if (al == null || qsm == null) {
        frUncov = true;
      } else {
        const f = (cu.a * L.pl + cu.b) * (1 - Math.exp(-cu.c * L.pl));
        qs = Math.min(al * f * 1000, qsm);
      }
    } else if (meth === 'cpt') {
      qsm = qsMaxOf(cat, L.soil);
      if (alphaCPT(cat, L.soil) == null || qsm == null) {
        frUncov = true;
      } else {
        const nss = Math.max(4, Math.ceil(dz / 0.2));
        let acc = 0;
        for (let i = 0; i < nss; i++) {
          const z = top + (dz * (i + 0.5)) / nss;
          acc += qsCPT(z, L.soil, cat, cptForQs);
        }
        qs = acc / nss;
      }
    } else {
      const mR = mResist(state.da);
      const mid = (top + bot) / 2;
      let sv = 0;
      layers.forEach((M) => {
        const d2 = Math.min(M.zbot, mid) - Math.min(M.ztop, mid);
        if (d2 > 0) sv += M.gamma * d2;
      });
      const nappe = state.o_nappe;
      const u = mid > nappe ? 9.81 * (mid - nappe) : 0;
      const svEff = Math.max(sv - u, 0);
      const phi = Math.atan(Math.tan((L.phi * Math.PI) / 180) / mR.phi);
      const K = 1 - Math.sin(phi);
      const beta = K * Math.tan((phi * 2) / 3);
      qs = beta * svEff + 0.7 * (L.c / mR.c);
    }
    const eLen = effLen(top, bot, D);
    const dRs = qs * perim * eLen;
    Rs += dRs;
    RsKsum += dRs / gammaRd1(cat, L.soil, traction);
    fric.push({ soil: L.soil, top, bot, dz, qs, dRs, qsm, deg: eLen < dz - 1e-9 });
  });
  if (frUncov)
    warn.push(
      'Certaines couches ne sont pas couvertes par la norme pour ce type de pieu (α non défini) — frottement pris nul, étude particulière requise.',
    );
  if (pile.micro)
    warn.push(
      'Micropieu (catégorie ' +
        cat +
        ') : résistance de pointe non prise en compte ; les α de frottement ne sont pas tabulés (cf. essais de conformité).',
    );

  // ---- resistances caracteristiques (xi, gammaR;d1 par couche, effet de groupe) ----
  const CeF = groupCe(B, state.grp);
  const floating = Rs > Rb;
  const Ce = floating ? CeF : 1;
  Rs *= Ce;
  RsKsum *= Ce;
  if (CeF < 1 && !floating)
    warn.push(
      'Effet de groupe non appliqué : pieu non flottant (résistance de pointe ≥ frottement) — Cₑ = 1 admis (NF P 94-262, J.2(3)).',
    );
  const N = Math.max(1, Math.round(state.o_nprofil));
  const Sinv = state.o_surf,
    redis = state.o_redis === 'oui';
  const [xi3, xi4] = xiFactors(N, Sinv, redis);
  const xi = Math.min(xi3, xi4); // 1 profil -> identique
  const grd = gammaRd1(cat, baseLayer.soil, traction);
  const RbK = Rb / (xi * grd),
    RsK = RsKsum / xi;
  const RcK = RbK + RsK;

  // ---- sollicitations & verifications ELU selon l'approche de calcul (EC7) ----
  const G = state.c_G,
    Q = state.c_Q;
  const fam = pileFamily(pile);
  const combos = DA_COMBOS[state.da] || DA_COMBOS.da2;
  const eluChecks = [];
  combos.forEach((cb) => {
    let aG, aQ, Rbf, Rsf, Rtf, rlab;
    if (state.da === 'da2') {
      // NA francaise = A1 «+» R2 (valeurs editables)
      aG = coeffs.k_gG;
      aQ = coeffs.k_gQ;
      Rbf = coeffs.k_gb;
      Rsf = coeffs.k_gs;
      Rtf = coeffs.k_gst;
      rlab = 'R2 (NA)';
    } else {
      // EN 1997-1 Annexe A (valeurs recommandees)
      const A = EC7.A[cb.A],
        R = EC7.R[fam][cb.R];
      aG = A.gG;
      aQ = A.gQ;
      Rbf = R.b;
      Rsf = R.s;
      Rtf = R.st;
      rlab = cb.A + '+' + cb.M + '+' + cb.R;
    }
    const Fd = aG * G + aQ * Q;
    const Rd = traction ? RsK / Rtf : RbK / Rbf + RsK / Rsf;
    eluChecks.push({
      nom: (traction ? 'ELU traction' : 'ELU portance') + ' — ' + cb.lab,
      comb: `${fmt(aG, 2)}·G + ${fmt(aQ, 2)}·Q · ${rlab}`,
      Fd,
      Rd,
      crit: traction ? 'R<sub>t;d</sub>' : 'R<sub>c;d</sub>',
      Rbf,
      Rsf,
    });
  });
  // combinaison ELU gouvernante (taux le plus eleve)
  let govElu = eluChecks[0];
  eluChecks.forEach((c) => {
    if (c.Fd / c.Rd > govElu.Fd / govElu.Rd) govElu = c;
  });
  const RcD = govElu.Rd;
  const RbD = traction ? 0 : RbK / govElu.Rbf,
    RsD = traction ? RsK / coeffs.k_gst : RsK / govElu.Rsf;

  // ---- charge de fluage ELS (14.2.2) — independant de l'approche ----
  let RcrK;
  if (traction) {
    RcrK = (pile.refoule ? coeffs.cr_b_s : coeffs.cr_f_s) * RsK;
  } // Rt;cr;k = 0,7·Rs;k
  else if (pile.refoule) {
    RcrK = coeffs.cr_b_b * RbK + coeffs.cr_b_s * RsK;
  } // 0,7·Rb + 0,7·Rs
  else {
    RcrK = coeffs.cr_f_b * RbK + coeffs.cr_f_s * RsK;
  } // 0,5·Rb + 0,7·Rs
  const gCar = traction ? coeffs.cr_car_t : coeffs.cr_car;
  const gQp = traction ? coeffs.cr_qp_t : coeffs.cr_qp;
  let RcrCar = RcrK / gCar,
    RcrQp = RcrK / gQp;
  if (traction && state.essais !== 'oui') RcrQp = Math.min(RcrQp, 0.15 * Rs); // §4.3.3 sans essais
  if (fric.some((f) => f.deg))
    warn.push(
      'Pieu de grande longueur : qₛ divisé par 2 au-delà de 25 m de la pointe (§4.3.1).',
    );
  if (Ce < 1)
    warn.push(
      'Effet de groupe : Rₛ réduit par Cₑ = ' + fmt(Ce, 2) + ' (entraxe < 3·B, §4.3.2).',
    );
  if (traction && state.essais !== 'oui')
    warn.push(
      'Traction sans essais de chargement : résistance ELS quasi-permanente plafonnée à 0,15·Rₛ (§4.3.3).',
    );

  const FdCar = G + Q; // ELS caracteristique
  const FdQp = G + coeffs.k_psi2 * Q; // ELS quasi-permanent
  const FduELU = govElu.Fd;

  // ---- verifications ----
  const sCrit = traction ? 'R<sub>t;cr;d</sub>' : 'R<sub>c;cr;d</sub>';
  const checks = [
    ...eluChecks,
    { nom: 'ELS caractéristique', comb: 'G + Q', Fd: FdCar, Rd: RcrCar, crit: sCrit },
    { nom: 'ELS quasi-permanent', comb: 'G + ψ₂·Q', Fd: FdQp, Rd: RcrQp, crit: sCrit },
  ];
  const allOk = checks.every((c) => c.Fd <= c.Rd);
  const govern = checks.map((c) => c.Fd / c.Rd).reduce((a, b) => Math.max(a, b), 0);

  // ---- tassement (Frank & Zhao simplifie) ----
  const settle = settlement(layers, B, D, z0, Ab, perim, qb, fric, baseLayer, FdCar);

  return {
    B,
    Bsurf,
    D,
    z0,
    Ab,
    perim,
    a,
    b,
    hInLayer,
    baseLayer,
    pile,
    meth,
    sens: state.sens,
    da: state.da,
    fam,
    Def,
    debR,
    cls,
    cat,
    kmax,
    qb,
    Rb,
    RbK,
    RbD,
    ple,
    qce,
    kfac,
    qbDetail,
    Rs,
    RsK,
    RsD,
    fric,
    xi3,
    xi4,
    N,
    grd,
    RcK,
    RcD,
    Ce,
    CeF,
    floating,
    Sinv: Math.min(2500, Math.max(100, Sinv > 0 ? Sinv : 2500)),
    redis,
    RcrK,
    RcrCar,
    RcrQp,
    gCar,
    gQp,
    G,
    Q,
    FduELU,
    FdCar,
    FdQp,
    checks,
    allOk,
    govern,
    settle,
    warn,
    layers,
  };
}

/* formatage FR (HTML : fmt) — utilise UNIQUEMENT pour les chaines d'affichage de R
   (qbDetail + messages warn), strictement comme l'original. N'influence aucun
   NOMBRE de resultat. Reproduit verbatim, y compris toLocaleString('fr-FR'). */
function fmt(v, d = 0) {
  return v == null || isNaN(v)
    ? '—'
    : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule la portance d'un pieu a partir d'un ETAT complet (pas de DOM, pas de
 * globale). `state` porte toutes les valeurs que `compute()` lisait dans la page :
 * geometrie (`geom`), profondeurs `g_D`/`g_z0`, charges `c_G`/`c_Q`, methode
 * `meth`, approche `da`, sens `sens`, essais `essais`, nappe `o_nappe`, options de
 * groupe `grp`, profils `o_nprofil`/`o_surf`/`o_redis`, categorie de pieu `cat`,
 * coefficients partiels editables `coeffs`, profil `layers` et penetrogramme `cpt`.
 *
 * Renvoie l'objet de RESULTAT BRUT `R` (identique a l'argument que le HTML passe a
 * `renderResults`), OU `{ err }` si une garde du moteur rejette l'entree (profil
 * vide, D <= z0), OU `{ err }` si la science leve. La PROJECTION client-safe est
 * faite par index.ts (whitelist + redaction).
 */
export function computePieux(state) {
  try {
    return computePieuxCore(state || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}

// ===========================================================================
// FROTTEMENT NEGATIF (downdrag) — extraction PURE de computeDowndrag() (#94)
// ===========================================================================
//
// Transcription FIDELE de `computeDowndrag()` du HTML d'origine (casagrande_V5.html,
// lignes 1704-1763), onglet « 02 Frottement négatif ». Comme pour compute(), les
// seules differences avec le HTML sont de COUPLAGE (PAS de science) :
//   - les lookups DOM (`num('fn_s0')`, `num('g_D')`, `num('o_nappe')`...) et la
//     globale `state.fnmode` deviennent des champs de l'objet `state` injecte :
//     `state.frottementNegatif.fn_*` / `state.frottementNegatif.mode`, `state.g_D`,
//     `state.o_nappe`, `state.meth`, `state.layers`, `state.geom`, `state.cat` ;
//   - `curPile()` -> `PILES.find(p=>p.cat==state.cat)||PILES[0]` (comme compute()) ;
//   - la downdrag lit `state.cpt` TEL QUEL (elle NE regenere PAS le penetrogramme) ;
//     on passe un CLONE a qsCPT/qcAt pour ne pas muter l'entree (purete de l'appel) ;
//   - au lieu d'APPELER `drawDowndrag(prof, m)` (presentation, NON transcrite), on
//     RETOURNE l'objet exact qui lui etait passe, MIS A PLAT : `{ prof, ...m }` ;
//   - les gardes que le HTML rend en `host.innerHTML` (profil vide / D<=z0) sont
//     RETOURNEES sous forme `{ err }` avec le MEME texte que la carte d'origine.
// Aucune formule, aucun ordre de sommation, aucune borne de bissection, aucun pas
// n'est modifie (bornes lo=0 / hi=max(0,30 ; s0·1,5+0,05), 46 tours ; nseg=
// max(60, ⌈(D−z0)/0,15⌉)). Deterministe : ni horloge ni hasard ni for..in.
//
// --- ETAT SCIENTIFIQUE (decision titulaire, #94) ---
// STARFIRE a valide les moteurs ; une EXTRACTION FIDELE prouvee par l'equivalence
// module<->HTML (rel 1e-9) est SCIENCE-SIGNEE. Ce module downdrag n'est donc PAS
// tague @science-unsigned. L'equivalence verte reste l'arbitre OBLIGATOIRE de la
// fidelite : sans elle, la revendication de fidelite tombe.

function computeDowndragCore(state) {
  const fn = state.frottementNegatif;
  const layers = layerTops(state.layers);
  if (!layers.length) {
    return {
      err: "Définissez d'abord un profil de sol (onglet 02) et la géométrie du pieu (onglet 01), puis revenez ici. Le bouton « Reprendre Q et la coupe du projet » initialise les données.",
    };
  }
  const z0 = state.g_z0,
    D = state.g_D;
  if (!(D > z0)) {
    return {
      err: 'Géométrie incomplète : la base D doit être sous la tête z₀ (onglet 01).',
    };
  }
  const PG = pileGeom(state.geom),
    B = PG.B,
    Ab = PG.Ab,
    perim = PG.perim;
  const pile = PILES.find((p) => p.cat == state.cat) || PILES[0],
    cat = pile.cat,
    cls = pile.cls,
    meth = state.meth;
  const baseLayer = soilAt(D - 1e-6, layers) || layers[layers.length - 1];
  const nappe = state.o_nappe;
  // cpt LOCAL (clone) : la downdrag lit state.cpt tel quel, sans regeneration ni
  // mutation (le HTML lit la globale state.cpt via qcAt ; ici on clone pour la purete).
  const cpt = { step: state.cpt.step, pts: state.cpt.pts.slice() };
  const s0 = (fn.fn_s0 || 0) / 1000,
    Hc = fn.fn_hc || 0,
    Q = fn.fn_Q || 0,
    KtanD = fn.fn_ktd || 0;
  const mode = fn.mode || 'auto';
  let zt = Math.max(z0, fn.fn_zt || z0),
    zb = Math.min(D, fn.fn_zb || 0);
  if (mode === 'impose' && zb <= zt) zb = Math.min(D, zt + 0.01);
  const isFine = (s) => s === 'argile';
  function sigmaV(z) {
    let sv = 0;
    layers.forEach((L) => {
      const d = Math.min(L.zbot, z) - Math.min(L.ztop, z);
      if (d > 0) sv += L.gamma * d;
    });
    const u = z > nappe ? 9.81 * (z - nappe) : 0;
    return Math.max(sv - u, 0);
  }
  function gsoil(z) {
    return Hc > 0 && z < Hc ? s0 * (1 - z / Hc) : 0;
  }
  function qsPosLayer(L) {
    if (meth === 'pmt') {
      const cu = PMT_CURVE[L.soil],
        al = alphaPMT(cat, L.soil),
        qsm = qsMaxOf(cat, L.soil);
      if (al == null || qsm == null) return 0;
      const f = (cu.a * L.pl + cu.b) * (1 - Math.exp(-cu.c * L.pl));
      return Math.min(al * f * 1000, qsm);
    }
    if (meth === 'cpt') {
      const qsm = qsMaxOf(cat, L.soil);
      if (alphaCPT(cat, L.soil) == null || qsm == null) return 0;
      const z = (Math.max(L.ztop, z0) + Math.min(L.zbot, D)) / 2;
      return qsCPT(z, L.soil, cat, cpt);
    }
    const mid = (Math.max(L.ztop, z0) + Math.min(L.zbot, D)) / 2,
      sv = sigmaV(mid);
    const phi = (L.phi * Math.PI) / 180,
      K = 1 - Math.sin(phi),
      beta = K * Math.tan((phi * 2) / 3);
    return beta * sv + 0.7 * L.c;
  }
  let qbLim = 0;
  if (!pile.micro) {
    if (meth === 'pmt') {
      qbLim = kpMax(cls, baseLayer.soil) * (baseLayer.pl || 1) * 1000;
    } else if (meth === 'cpt') {
      qbLim = kcMax(cls, baseLayer.soil) * (baseLayer.qc || 5) * 1000;
    } else {
      const phi = (baseLayer.phi * Math.PI) / 180,
        Nq =
          Math.exp(Math.PI * Math.tan(phi)) *
          Math.pow(Math.tan(Math.PI / 4 + phi / 2), 2);
      qbLim =
        baseLayer.c * (Math.abs(phi) < 1e-6 ? 5.14 : (Nq - 1) / Math.tan(phi)) +
        sigmaV(D) * Nq;
    }
  }
  const EMb = baseLayer.em || 10,
    kq = ((isFine(baseLayer.soil) ? 11 : 4.8) * EMb * 1000) / B,
    Ep = 2.0e7;
  const mob = (a, lim, k) => {
    if (lim <= 0 || a <= 0) return 0;
    const w1 = lim / 2 / k;
    if (a <= w1) return k * a;
    const wc = w1 + lim / 2 / (k / 5);
    return a <= wc ? lim / 2 + (k / 5) * (a - w1) : lim;
  };
  const mobSig = (delta, lim, k) => Math.sign(delta) * mob(Math.abs(delta), lim, k);
  const nseg = Math.max(60, Math.ceil((D - z0) / 0.15)),
    dz = (D - z0) / nseg;
  function march(w0, rec) {
    let w = w0,
      N = Q;
    const prof = [];
    for (let i = 0; i < nseg; i++) {
      const z = z0 + (i + 0.5) * dz,
        L = soilAt(z, layers) || baseLayer;
      const ktau = ((isFine(L.soil) ? 2.0 : 0.8) * (L.em || 10) * 1000) / B;
      const qsP = qsPosLayer(L),
        qsN = KtanD * sigmaV(z);
      let g, f;
      if (mode === 'impose') {
        g = 0;
        if (z >= zt && z <= zb)
          f = -qsN; // frottement negatif a la limite (Combarieu)
        else f = mob(Math.max(0, w), qsP, ktau); // frottement positif mobilise en dessous
      } else {
        g = gsoil(z);
        const delta = w - g,
          lim = delta >= 0 ? qsP : qsN;
        f = mobSig(delta, lim, ktau);
      }
      if (rec) prof.push({ z, w, g, f, qsP: qsP, qsN: -qsN, N });
      N -= f * perim * dz;
      w -= (N / (Ep * Ab)) * dz;
    }
    const wtip = w,
      qbM = mob(Math.max(0, wtip), qbLim, kq) * Ab;
    if (rec)
      prof.push({
        z: D,
        w: wtip,
        g: gsoil(D),
        f: 0,
        qsP: qsPosLayer(baseLayer),
        qsN: -KtanD * sigmaV(D),
        N,
      });
    return { prof, Ntip: N, qbM, wtip };
  }
  let lo = 0,
    hi = Math.max(0.3, s0 * 1.5 + 0.05),
    r;
  for (let it = 0; it < 46; it++) {
    const mid = (lo + hi) / 2;
    r = march(mid, false);
    if (r.Ntip - r.qbM > 0) lo = mid;
    else hi = mid;
  }
  const sol = march((lo + hi) / 2, true),
    prof = sol.prof;
  let zN = null,
    Nmax = Q;
  prof.forEach((p, i) => {
    if (p.N > Nmax) Nmax = p.N;
    if (i > 0) {
      const a = prof[i - 1],
        da = a.w - a.g,
        db = p.w - p.g;
      if (da * db < 0 && zN == null) {
        const t = da / (da - db);
        zN = a.z + t * (p.z - a.z);
      }
    }
  });
  if (mode === 'impose') zN = zb;
  const Gsn = Math.max(0, Nmax - Q),
    wHead = prof[0].w * 1000,
    wTip = sol.wtip * 1000;
  return {
    prof,
    z0,
    D,
    B,
    Q,
    Nmax,
    Gsn,
    zN,
    wHead,
    wTip,
    s0: s0 * 1000,
    Hc,
    KtanD,
    meth,
    pile,
    mode,
    zt,
    zb,
  };
}

/**
 * Calcule le FROTTEMENT NEGATIF (downdrag) d'un pieu a partir de l'ETAT complet
 * (meme `state` que computePieux, plus le groupe `frottementNegatif`). Renvoie
 * l'objet BRUT mis a plat `{ prof, z0, D, B, Q, Nmax, Gsn, zN, wHead, wTip, s0, Hc,
 * KtanD, meth, pile, mode, zt, zb }` (identique a l'argument que le HTML passe a
 * `drawDowndrag`), OU `{ err }` si une garde rejette l'entree (profil vide, D<=z0)
 * ou si la science leve. La PROJECTION client-safe (Gsn/Nmax/pointNeutre uniquement)
 * est faite par index.ts ; `prof`/`qsN`/rigidites restent SERVEUR (DoD §8).
 */
export function computeDowndrag(state) {
  try {
    return computeDowndragCore(state || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
