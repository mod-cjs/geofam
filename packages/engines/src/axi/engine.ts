/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. radier/engine.ts) : on ne
// type PAS les internes du moteur (cela imposerait de modifier la science pour
// satisfaire noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit
// a la frontiere (contract.ts, verifie). La sortie brute est volontairement opaque puis
// projetee via le schema strict.
/**
 * MOTEUR AXISYMETRIQUE (§2.4.1) — plaque annulaire (radier/dallage CIRCULAIRE) couplee
 * au sol multicouche elastique par integration de Boussinesq.
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html — title « GEOPLAQUE —
 * plaques sur sol multicouche elastique », solveur `solveAxi`, l. ~1664). On NE
 * reordonne RIEN, on NE corrige RIEN : l'arbitre est l'equivalence-PORTAGE (module ==
 * HTML, rel serree). `@ts-nocheck` est ASSUME : science transcrite (algebre dense,
 * integrales elliptiques par AGM, quadrature de Gauss), pas du code maison.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Dans le HTML, `solveAxi(o)` lit les couches de sol dans la GLOBALE `state.layers` et
 * `o` (rayon/epaisseur/module/charges/nb d'elements/profondeur d'assise) est lu depuis
 * des CHAMPS DE SAISIE par le handler `#ax-run`, qui AFFICHE ensuite le resultat
 * (statistiques + trace radial `axiPlot`). On EXTRAIT ici la science dans une fonction
 * PURE `solveAxi(state, o)` : `state` (les couches) et `o` sont PASSES EN PARAMETRE ; on
 * RETOURNE l'objet `R` (identique a ce que le handler consomme) au lieu de l'afficher.
 * Les fonctions de DESSIN/UI (`axiPlot`, statistiques, `×1000` d'affichage) ne sont PAS
 * transcrites — presentation pure, aucun effet sur `R`. Aucun acces a la page, aucune
 * horloge, aucun hasard.
 *
 * --- DEPENDANCES REELLES DE solveAxi (transcrites a l'identique) ---
 *   - integrales elliptiques completes K(k), E(k) par AGM : `ellipKE` ;
 *   - noyaux de Boussinesq axisymetriques : `I1I3axi` (profondeur), `fCircAxi` (surface) ;
 *   - tassements sous patch annulaire : `sAnnDepth`, `sAnnSurf`, `cornerAxi` (superposition
 *     de couches, cote d'assise z0) ;
 *   - element annulaire de Kirchhoff : `annKe` (quadrature de Gauss 5 points) ;
 *   - algebre dense : `inv` (Gauss-Jordan a pivot partiel), `solveDense` (LU a pivot
 *     partiel + regularisation), IDENTIQUES a radier/engine.ts (memes flottants).
 * solveAxi n'emprunte NI `matMul`/`transpose`, NI la geometrie 2D (`pointInPoly`,
 * `distToSeg`), NI les solveurs de coupe/DKT — non transcrits ici.
 *
 * --- DETERMINISME ---
 * Le chemin de calcul (assemblage annulaire, souplesse C nn×nn par integration radiale,
 * inv, solveDense, recuperation des moments) ne contient NI horloge NI hasard NI
 * iteration d'objet a ordre instable (seuls des `for` indexes et `for..of` sur des
 * tableaux). Meme entree -> meme sortie BRUTE, bit-a-bit. NB : l'algebre dense reste
 * sensible a l'ordre des operations — on PRESERVE l'ordre VERBATIM (pas de
 * reordonnancement des sommations, boucles de quadrature, ni du tri des couches).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce module
 * (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- UNITES (meme decision que le radier — cf. contract.ts) ---
 * Entree E en MPa cote contrat (comme radier : beton ~32000, sol ~8..50). Le solveur
 * retourne `w`/`wc`/`wEdge`/`wMax`/`wMin` dans la MEME convention numerique que le radier
 * (effet d'echelle E-MPa × charges-kN × geometrie-m ~ mm ; `Mr`/`Mt` ~ kN·m/m ; `p` ~
 * kPa). On NE reproduit PAS le `×1000` d'AFFICHAGE du HTML (`R.wc*1000` dans le handler) :
 * c'est un facteur de RENDU, hors solveur. Unite definitive a figer avec STARFIRE.
 *
 * --- ETAT SCIENTIFIQUE ---
 * Equivalence-PORTAGE prouvee (module == HTML). JUSTESSE scientifique validee cote
 * STARFIRE (science signee) ; l'equivalence de portage reste la preuve de fidelite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale stable :
 * si du code moteur fuyait dans le bundle navigateur, le controle CI (grep) la
 * detecterait. Reference inerte cote calcul.
 */
export const AXI_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// ALGEBRE DENSE (HTML d'origine — IDENTIQUE a radier/engine.ts — NE RIEN MODIFIER)
// ===========================================================================

/* ---- small dense linear algebra ---- */
function inv(A) {
  const n = A.length;
  const M = A.map((r, i) => {
    const row = Array.from(r);
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    return row;
  });
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) throw new Error('matrice singulière');
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r) => r.slice(n));
}
// solve dense A x = b  (LU partial pivot), A array of Float64Array
function solveDense(A, b) {
  const n = b.length;
  const M = A;
  const x = b.slice();
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let col = 0; col < n; col++) {
    let piv = col,
      mx = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > mx) {
        mx = v;
        piv = r;
      }
    }
    if (mx < 1e-13) {
      M[col][col] += 1e-9;
    } // regularize
    if (piv !== col) {
      [M[col], M[piv]] = [M[piv], M[col]];
      [x[col], x[piv]] = [x[piv], x[col]];
    }
    const d = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      const Mr = M[r],
        Mc = M[col];
      for (let j = col; j < n; j++) Mr[j] -= f * Mc[j];
      x[r] -= f * x[col];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    const Mi = M[i];
    for (let j = i + 1; j < n; j++) s -= Mi[j] * x[j];
    x[i] = s / Mi[i];
  }
  return x;
}

// ===========================================================================
// AXISYMETRIE (§2.4.1) — HTML d'origine — NE RIEN MODIFIER
// ===========================================================================

// integrales elliptiques completes K(k), E(k) (module k) par AGM
function ellipKE(k) {
  k = Math.min(Math.abs(k), 1 - 1e-15);
  let a = 1,
    b = Math.sqrt(1 - k * k),
    c = k,
    sum = (k * k) / 2,
    pw = 1;
  for (let n = 0; n < 60; n++) {
    if (Math.abs(c) < 1e-16) break;
    const a1 = (a + b) / 2,
      b1 = Math.sqrt(a * b),
      c1 = (a - b) / 2;
    a = a1;
    b = b1;
    c = c1;
    pw *= 2;
    sum += (pw * c * c) / 2;
  }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - sum) };
}
function I1I3axi(A, B) {
  const apb = A + B;
  const k = Math.sqrt(Math.max(0, (2 * B) / apb));
  const { K, E } = ellipKE(k);
  const I1 = (4 / Math.sqrt(apb)) * K;
  const amb = A - B;
  const I3 = amb <= 1e-12 ? 1e18 : (4 / (amb * Math.sqrt(apb))) * E;
  return { I1, I3 };
}
// tassement de surface d'un disque uniforme rayon c a la distance r (par q, sans (1−ν²)/E)
function fCircAxi(r, c) {
  if (c <= 0) return 0;
  if (r <= c) {
    const { E } = ellipKE(r / c);
    return ((4 * c) / Math.PI) * E;
  }
  const m = c / r;
  const { K, E } = ellipKE(m);
  return ((4 * r) / Math.PI) * (E - (1 - m * m) * K);
}
// tassement a la profondeur z>0 sous patch annulaire [a,b] (integration radiale de Boussinesq)
function sAnnDepth(r, z, a, b, E, nu) {
  if (z <= 0 || b <= a) return 0;
  let s = 0;
  const np = 60;
  const gp = [-0.5773502692, 0.5773502692];
  for (let pnl = 0; pnl < np; pnl++) {
    const rho0 = a + ((b - a) * pnl) / np,
      rho1 = a + ((b - a) * (pnl + 1)) / np,
      hl = (rho1 - rho0) / 2,
      mid = (rho0 + rho1) / 2;
    for (let g = 0; g < 2; g++) {
      const rho = mid + hl * gp[g];
      const A = r * r + rho * rho + z * z,
        B = 2 * r * rho;
      const t = I1I3axi(A, B);
      s += hl * (z * z * t.I3 + 2 * (1 - nu) * t.I1) * rho;
    }
  }
  return ((1 + nu) / (2 * Math.PI * E)) * s;
}
function sAnnSurf(r, a, b, E, nu) {
  return ((1 - nu * nu) / E) * (fCircAxi(r, b) - fCircAxi(r, a));
}
function cornerAxi(r, a, b, layers, z0) {
  let s = 0,
    dPrevRel = 0;
  for (const ly of layers) {
    const dBotAbs = Math.abs(ly.zBase);
    if (dBotAbs <= z0) continue;
    const dBotRel = dBotAbs - z0;
    if (dBotRel <= dPrevRel) continue;
    const sTop =
      dPrevRel <= 1e-9
        ? sAnnSurf(r, a, b, ly.E, ly.nu)
        : sAnnDepth(r, dPrevRel, a, b, ly.E, ly.nu);
    const sBot = sAnnDepth(r, dBotRel, a, b, ly.E, ly.nu);
    s += sTop - sBot;
    dPrevRel = dBotRel;
  }
  return s;
}
// element annulaire de Kirchhoff [r1,r2], DDL [w1,θ1,w2,θ2], θ=dw/dr
function annKe(r1, r2, E, t, nu) {
  const L = r2 - r1;
  const D = (E * t * t * t) / (12 * (1 - nu * nu));
  const Dm = [
    [D, D * nu],
    [D * nu, D],
  ];
  const gp = [-0.9061798459, -0.5384693101, 0, 0.5384693101, 0.9061798459],
    gw = [0.2369268851, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268851];
  const Ke = Array.from({ length: 4 }, () => new Float64Array(4));
  const fU = new Float64Array(4);
  for (let g = 0; g < 5; g++) {
    const xi = (gp[g] + 1) / 2,
      wgt = gw[g] / 2,
      r = r1 + xi * L;
    const H1pp = -6 + 12 * xi,
      H2pp = L * (-4 + 6 * xi),
      H3pp = 6 - 12 * xi,
      H4pp = L * (-2 + 6 * xi);
    const H1p = -6 * xi + 6 * xi * xi,
      H2p = L * (1 - 4 * xi + 3 * xi * xi),
      H3p = 6 * xi - 6 * xi * xi,
      H4p = L * (-2 * xi + 3 * xi * xi);
    const H1 = 1 - 3 * xi * xi + 2 * xi * xi * xi,
      H2 = L * (xi - 2 * xi * xi + xi * xi * xi),
      H3 = 3 * xi * xi - 2 * xi * xi * xi,
      H4 = L * (-xi * xi + xi * xi * xi);
    const Br = [
      -(1 / (L * L)) * H1pp,
      -(1 / (L * L)) * H2pp,
      -(1 / (L * L)) * H3pp,
      -(1 / (L * L)) * H4pp,
    ];
    const Bt = [
      -(1 / (r * L)) * H1p,
      -(1 / (r * L)) * H2p,
      -(1 / (r * L)) * H3p,
      -(1 / (r * L)) * H4p,
    ];
    const fac = 2 * Math.PI * r * L * wgt;
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        const DB0 = Dm[0][0] * Br[b] + Dm[0][1] * Bt[b],
          DB1 = Dm[1][0] * Br[b] + Dm[1][1] * Bt[b];
        Ke[a][b] += fac * (Br[a] * DB0 + Bt[a] * DB1);
      }
    const Hs = [H1, H2, H3, H4];
    for (let a = 0; a < 4; a++) fU[a] += fac * Hs[a];
  }
  return { Ke, fU };
}
// solveur axisymetrique : plaque annulaire couplee au sol (Boussinesq)
// (transcription : `state.layers` -> parametre `st` ; alias `state` pour rester VERBATIM)
function solveAxi(st, o) {
  const state = st; // alias : le corps ci-dessous reste VERBATIM (references `state.layers`)
  const R = o.R,
    t = o.e,
    E = o.E,
    nu = o.nu,
    ne = Math.max(6, Math.min(300, o.ne || 50));
  if (!state.layers.length)
    throw new Error('Définis au moins une couche de sol (onglet Sol).');
  const layers = state.layers.slice().sort((p, q) => q.zBase - p.zBase);
  const deepest = Math.abs(layers[layers.length - 1].zBase);
  let z0 = Math.max(0, o.foundD || 0);
  if (z0 >= deepest - 1e-6) z0 = Math.max(0, deepest - 0.5);
  const nn = ne + 1,
    dx = R / ne,
    dof = 2 * nn;
  const r = [];
  for (let i = 0; i < nn; i++) r.push(i * dx);
  const K = Array.from({ length: dof }, () => new Float64Array(dof));
  const F = new Float64Array(dof);
  for (let el = 0; el < ne; el++) {
    const { Ke, fU } = annKe(r[el], r[el + 1], E, t, nu);
    const map = [2 * el, 2 * el + 1, 2 * el + 2, 2 * el + 3];
    for (let a = 0; a < 4; a++) {
      if (o.q) F[map[a]] += o.q * fU[a];
      for (let b = 0; b < 4; b++) K[map[a]][map[b]] += Ke[a][b];
    }
  }
  if (o.Pc) F[0] += o.Pc;
  const aa = new Float64Array(nn),
    bb = new Float64Array(nn),
    A = new Float64Array(nn);
  for (let i = 0; i < nn; i++) {
    aa[i] = Math.max(0, r[i] - dx / 2);
    bb[i] = Math.min(R, r[i] + dx / 2);
    A[i] = Math.PI * (bb[i] * bb[i] - aa[i] * aa[i]);
  }
  const C = Array.from({ length: nn }, () => new Float64Array(nn));
  for (let j = 0; j < nn; j++)
    for (let i = 0; i < nn; i++) C[i][j] = cornerAxi(r[i], aa[j], bb[j], layers, z0);
  const totalLoad = (o.q ? o.q * Math.PI * R * R : 0) + (o.Pc || 0);
  const Cinv = inv(C.map((x) => Array.from(x)));
  const Asys = K.map((x) => Float64Array.from(x));
  const rhs = Float64Array.from(F);
  for (let a = 0; a < nn; a++) {
    const ia = 2 * a,
      Aa = A[a];
    for (let b = 0; b < nn; b++) Asys[ia][2 * b] += Aa * Cinv[a][b];
  }
  const fixed = new Set([1]);
  const free = [];
  for (let i = 0; i < dof; i++) if (!fixed.has(i)) free.push(i);
  const Kr = free.map((a) => free.map((b) => Asys[a][b]));
  const Fr = free.map((a) => rhs[a]);
  const ur = solveDense(Kr, Fr);
  const u = new Float64Array(dof);
  free.forEach((idx, k) => (u[idx] = ur[k]));
  const w = new Float64Array(nn);
  for (let i = 0; i < nn; i++) w[i] = u[2 * i];
  const p = new Float64Array(nn);
  for (let a = 0; a < nn; a++) {
    let s = 0;
    for (let b = 0; b < nn; b++) s += Cinv[a][b] * w[b];
    p[a] = s;
  }
  const sumReact = p.reduce((s, v, i) => s + v * A[i], 0);
  const D = (E * t * t * t) / (12 * (1 - nu * nu));
  const Mr = new Float64Array(nn),
    Mt = new Float64Array(nn),
    cnt = new Float64Array(nn);
  for (let el = 0; el < ne; el++) {
    const L = dx;
    const w1 = u[2 * el],
      t1 = u[2 * el + 1],
      w2 = u[2 * el + 2],
      t2 = u[2 * el + 3];
    [
      [0, el],
      [1, el + 1],
    ].forEach(([xi, nd]) => {
      const rr = r[nd] || 1e-6;
      const wpp =
        (1 / (L * L)) *
        ((-6 + 12 * xi) * w1 +
          L * (-4 + 6 * xi) * t1 +
          (6 - 12 * xi) * w2 +
          L * (-2 + 6 * xi) * t2);
      const wp =
        (1 / L) *
        ((-6 * xi + 6 * xi * xi) * w1 +
          L * (1 - 4 * xi + 3 * xi * xi) * t1 +
          (6 * xi - 6 * xi * xi) * w2 +
          L * (-2 * xi + 3 * xi * xi) * t2);
      const kr = -wpp,
        kt = nd === 0 ? -wpp : -(wp / rr);
      Mr[nd] += D * (kr + nu * kt);
      Mt[nd] += D * (kt + nu * kr);
      cnt[nd]++;
    });
  }
  for (let i = 0; i < nn; i++) {
    Mr[i] /= Math.max(1, cnt[i]);
    Mt[i] /= Math.max(1, cnt[i]);
  }
  let wMax = -1e9,
    wMin = 1e9,
    mrMax = 0,
    mtMax = 0,
    pMax = -1e9;
  for (let i = 0; i < nn; i++) {
    if (w[i] > wMax) wMax = w[i];
    if (w[i] < wMin) wMin = w[i];
    if (Math.abs(Mr[i]) > Math.abs(mrMax)) mrMax = Mr[i];
    if (Math.abs(Mt[i]) > Math.abs(mtMax)) mtMax = Mt[i];
    if (p[i] > pMax) pMax = p[i];
  }
  return {
    r,
    w,
    p,
    Mr,
    Mt,
    totalLoad,
    sumReact,
    wMax,
    wMin,
    mrMax,
    mtMax,
    pMax,
    nn,
    wc: w[0],
    wEdge: w[nn - 1],
    z0,
    D,
    EI: D,
  };
}

/**
 * ENTREE PUBLIQUE du moteur axisymetrique. Renvoie l'objet de RESULTAT BRUT `R` (celui
 * consomme par le handler `#ax-run` du HTML), OU `{ err }` si une garde du moteur rejette
 * l'entree (aucune couche de sol) OU si la science leve (matrice singuliere...).
 *
 *   - `state` : { layers: [{ zBase, E, nu }] } — les couches de sol (onglet Sol) ;
 *   - `o`     : { R, e, E, nu, q, Pc, ne, foundD } — rayon/epaisseur/module/Poisson du
 *     dallage, charge repartie q (kPa), charge centrale Pc (kN), nb d'elements annulaires,
 *     profondeur d'assise D (m).
 *
 * La PROJECTION client-safe (diagnostics uniquement) est faite au cablage (contract.ts).
 */
export function computeAxi(state, o) {
  try {
    return solveAxi(state || {}, o || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
