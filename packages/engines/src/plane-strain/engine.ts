/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur (cela imposerait de modifier la science pour satisfaire
// noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit a la
// frontiere (contract.ts, verifie). La sortie brute est volontairement opaque puis
// projetee via le schema strict.
/**
 * MOTEUR DEFORMATIONS PLANES / POUTRE (coupe 2D, tranche unitaire) sur sol
 * multicouche elastique — variante « bande » du solveur GEOPLAQUE.
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html — title « GEOPLAQUE —
 * plaques sur sol multicouche elastique », fonction `solvePlaneStrain`, l.1580).
 * On NE reordonne RIEN, on NE corrige RIEN : l'arbitre est l'equivalence-PORTAGE
 * (module == HTML, rel serree). `@ts-nocheck` est ASSUME : science transcrite
 * (algebre dense + poutre Euler-Bernoulli), pas du code maison.
 *
 * --- CE QUE FAIT LE SOLVEUR ---
 * Coupe transversale 2D « deformations planes » (§2.4.2 du HTML) : une POUTRE
 * Euler-Bernoulli de largeur Bw (rigidite par metre D = E·e³/(12(1−ν²))) reposant
 * sur un sol multicouche modelise par sa matrice de souplesse C (bande semi-infinie
 * Ly→∞, eq. 23). Couplage plaque↔sol par C⁻¹, contact unilateral optionnel
 * (decollement, relachement monotone). Charge repartie `q` + charges lineiques
 * `loads` (P au point x, interpolees lineairement sur l'element).
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * `solvePlaneStrain(o)` du HTML lit son sol dans la GLOBALE `state.layers` et ses
 * options `o` depuis des champs de saisie ; le resultat `R` est ensuite dessine.
 * On EXTRAIT ici la science dans une fonction PURE `solvePlaneStrain(state, opts)` :
 * `state` (uniquement `state.layers` est lu) et `opts` sont PASSES EN PARAMETRE, et
 * on RETOURNE l'objet `R` (au lieu de l'afficher). Aucune fonction de DESSIN/UI n'est
 * transcrite. Aucun acces a la page, aucune horloge, aucun hasard.
 *
 * --- ALGEBRE PARTAGEE ---
 * `inv` (inversion Gauss-Jordan a pivot partiel) et `solveDense` (LU a pivot partiel,
 * regularisation +1e-9 sur pivot < 1e-13) sont transcrits A L'IDENTIQUE depuis le
 * MEME HTML (fonctions communes a solveModel/solveAxi/solvePlaneStrain). Elles ne sont
 * pas exportees par le module radier ; on les re-transcrit verbatim ici (memes
 * operations, meme ordre) pour rester autonome.
 *
 * --- DETERMINISME ---
 * Le chemin de calcul (assemblage poutre, souplesse C nn×nn, solveDense LU, inv,
 * iterations de decollement monotones) ne contient NI horloge NI hasard NI iteration
 * d'objet a ordre instable. Module sans horloge ni hasard ni for..in. On PRESERVE
 * l'ordre VERBATIM (l'algebre dense reste sensible a l'ordre des operations).
 *
 * --- UNITES (meme decision que le radier — TRANCHE, cf. mémoire roadsen-radier-units) ---
 * E de la poutre en MPa, e/Bw/zBase en m, q en kPa, P (charge lineique) en kN/ml,
 * foundD en m. La sortie NUMERIQUE des tassements (w/wMax/wMin) est en **mm** et les
 * moments/efforts dans les unites derivees coherentes (piege d'unite E-en-MPa ×
 * charges-en-kN × geometrie-en-m). On NE reproduit PAS le ×1000 d'AFFICHAGE de l'outil
 * d'origine (sur-rapport). Confirmation STARFIRE/expert en attente pour figer l'unite
 * sur un PV opposable.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE ---
 * Equivalence-PORTAGE prouvee (module == HTML). JUSTESSE scientifique NON validee tant
 * que le kit cas-tests STARFIRE n'est pas disponible : @science-unsigned.
 * MJ-6 : pas de prod sans conformite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale
 * stable : si du code moteur fuyait dans le bundle navigateur, le controle CI (grep)
 * la detecterait. Reference inerte cote calcul.
 */
export const PLANE_STRAIN_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// ALGEBRE DENSE (HTML d'origine — NE RIEN MODIFIER)
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
// SOUPLESSE DU SOL EN BANDE (deformations planes, §2.4.2 — HTML d'origine)
// ===========================================================================

// tassement cumule sous le bord d'une bande de largeur L a la profondeur z (eq. 23,
// Ly→∞), par kPa et /E factorise
function stripFactor(L, z, nu) {
  if (L <= 1e-12 || z <= 0) return 0;
  return (
    ((1 + nu) * L) /
    Math.PI *
    ((1 - nu) * Math.log(1 + (z * z) / (L * L)) +
      (1 - 2 * nu) * (z / L) * Math.atan(L / z))
  );
}
function stripEdgeCum(L, layers, z0) {
  if (L <= 1e-9) return 0;
  let s = 0,
    dPrevRel = 0;
  for (const ly of layers) {
    const dBotAbs = Math.abs(ly.zBase);
    if (dBotAbs <= z0) continue;
    const dBotRel = dBotAbs - z0;
    if (dBotRel <= dPrevRel) continue;
    s += (1 / ly.E) * (stripFactor(L, dBotRel, ly.nu) - stripFactor(L, dPrevRel, ly.nu));
    dPrevRel = dBotRel;
  }
  return s;
} // m par kPa
function stripSettle(px, x1, x2, layers, z0) {
  const g = (u) => {
    const su = u < 0 ? -1 : 1;
    return su * stripEdgeCum(Math.abs(u), layers, z0);
  };
  return g(x2 - px) - g(x1 - px);
}

// ===========================================================================
// ELEMENT DE POUTRE EULER-BERNOULLI 4 DDL (HTML d'origine)
// ===========================================================================

function beamKe(L, EI) {
  const c = EI / (L * L * L);
  return [
    [12 * c, 6 * L * c, -12 * c, 6 * L * c],
    [6 * L * c, 4 * L * L * c, -6 * L * c, 2 * L * L * c],
    [-12 * c, -6 * L * c, 12 * c, -6 * L * c],
    [6 * L * c, 2 * L * L * c, -6 * L * c, 4 * L * L * c],
  ];
}

// ===========================================================================
// SOLVEUR PLAN — extraction PURE de solvePlaneStrain (state + opts injectes)
// ===========================================================================
//
// Transcription FIDELE de solvePlaneStrain(o). Les seules differences avec le HTML :
//   - la globale `state` est PASSEE EN PARAMETRE (`st`) ; la seule reference lue
//     (`state.layers`) pointe desormais sur `st.layers` ;
//   - `o` (options) est passe en parametre (au lieu d'etre lu dans le DOM) ;
//   - on RETOURNE l'objet `R` (au lieu de l'afficher).
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

// solveur plan : poutre (Euler-Bernoulli, rigidité D = E·e³/(12(1−ν²)) par mètre) couplée au sol plan
function solvePlaneStrain(st, o) {
  const state = st; // alias : le corps ci-dessous reste VERBATIM (references `state.layers`)
  const Bw = o.Bw,
    e = o.e,
    E = o.E,
    nu = o.nu;
  const EI = (E * e * e * e) / (12 * (1 - nu * nu));
  if (!state.layers.length)
    throw new Error('Définis au moins une couche de sol (onglet Sol).');
  const layers = state.layers.slice().sort((p, q) => q.zBase - p.zBase);
  const deepest = Math.abs(layers[layers.length - 1].zBase);
  let z0 = Math.max(0, o.foundD || 0);
  if (z0 >= deepest - 1e-6) z0 = Math.max(0, deepest - 0.5);
  const ne = Math.max(6, Math.min(400, o.ne || 60)),
    nn = ne + 1,
    dx = Bw / ne,
    dof = 2 * nn;
  const X = [];
  for (let i = 0; i < nn; i++) X.push(i * dx);
  const K = Array.from({ length: dof }, () => new Float64Array(dof));
  const Ke = beamKe(dx, EI);
  for (let el = 0; el < ne; el++) {
    const map = [2 * el, 2 * el + 1, 2 * el + 2, 2 * el + 3];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) K[map[r]][map[c]] += Ke[r][c];
  }
  const A = new Float64Array(nn);
  for (let i = 0; i < nn; i++) A[i] = i === 0 || i === nn - 1 ? dx / 2 : dx;
  const C = Array.from({ length: nn }, () => new Float64Array(nn));
  for (let j = 0; j < nn; j++) {
    const x1 = X[j] - A[j] / 2,
      x2 = X[j] + A[j] / 2;
    for (let i = 0; i < nn; i++) C[i][j] = stripSettle(X[i], x1, x2, layers, z0);
  }
  const F = new Float64Array(dof);
  if (o.q) for (let i = 0; i < nn; i++) F[2 * i] += o.q * A[i];
  for (const pl of o.loads || []) {
    let xi = Math.max(0, Math.min(Bw, pl.x));
    let i = Math.floor(xi / dx);
    if (i < 0) i = 0;
    if (i >= ne) i = ne - 1;
    const u = xi / dx - i;
    F[2 * i] += pl.P * (1 - u);
    F[2 * (i + 1)] += pl.P * u;
  }
  const totalLoad = F.reduce((s, v, k) => (k % 2 === 0 ? s + v : s), 0);
  const Cinv = inv(C.map((r) => Array.from(r)));
  const decol = !!o.decol;
  const stateN = new Uint8Array(nn).fill(1);
  function solveOnce() {
    const act = [];
    for (let i = 0; i < nn; i++) if (stateN[i] === 1) act.push(i);
    const Asys = K.map((r) => Float64Array.from(r));
    const rhs = Float64Array.from(F);
    let CsubInv = null;
    if (act.length) {
      const Csub = Array.from({ length: act.length }, () => new Float64Array(act.length));
      for (let a = 0; a < act.length; a++)
        for (let b = 0; b < act.length; b++) Csub[a][b] = C[act[a]][act[b]];
      CsubInv = inv(Csub);
      for (let a = 0; a < act.length; a++) {
        const ia = 2 * act[a],
          Aa = A[act[a]];
        for (let b = 0; b < act.length; b++) Asys[ia][2 * act[b]] += Aa * CsubInv[a][b];
      }
    }
    const u = solveDense(Asys, rhs);
    const w = new Float64Array(nn),
      p = new Float64Array(nn);
    for (let i = 0; i < nn; i++) w[i] = u[2 * i];
    if (CsubInv) {
      const wm = act.map((i) => w[i]);
      for (let a = 0; a < act.length; a++) {
        let s = 0;
        for (let b = 0; b < act.length; b++) s += CsubInv[a][b] * wm[b];
        p[act[a]] = s;
      }
    }
    for (let i = 0; i < nn; i++) if (stateN[i] === 0) p[i] = 0;
    return { u, w, p };
  }
  let sol = solveOnce(),
    iters = 1;
  if (decol) {
    for (let it = 0; it < 30; it++) {
      let ch = false; // relâchement monotone (robuste, convergence garantie)
      for (let i = 0; i < nn; i++) {
        if (stateN[i] === 1 && sol.p[i] < -1e-6) {
          stateN[i] = 0;
          ch = true;
        }
      }
      let cnt = 0;
      for (let i = 0; i < nn; i++) if (stateN[i] === 1) cnt++;
      if (cnt < 1) break;
      if (!ch) break;
      sol = solveOnce();
      iters++;
    }
  }
  const Mn = new Float64Array(nn),
    Vn = new Float64Array(nn),
    cnt = new Float64Array(nn);
  for (let el = 0; el < ne; el++) {
    const w1 = sol.u[2 * el],
      t1 = sol.u[2 * el + 1],
      w2 = sol.u[2 * el + 2],
      t2 = sol.u[2 * el + 3];
    const L = dx;
    const m1 = -EI * ((6 * (w2 - w1)) / (L * L) - (4 * t1 + 2 * t2) / L),
      m2 = -EI * ((-6 * (w2 - w1)) / (L * L) + (2 * t1 + 4 * t2) / L);
    const v = -EI * ((12 * (w1 - w2)) / (L * L * L) + (6 * (t1 + t2)) / (L * L));
    Mn[el] += m1;
    cnt[el]++;
    Mn[el + 1] += m2;
    cnt[el + 1]++;
    Vn[el] += v;
    Vn[el + 1] += v;
  }
  for (let i = 0; i < nn; i++) {
    Mn[i] /= Math.max(1, cnt[i]);
    Vn[i] /= Math.max(1, i === 0 || i === nn - 1 ? 1 : 2);
  }
  const sumReact = sol.p.reduce((s, v, i) => s + v * A[i], 0);
  let wMax = -1e9,
    wMin = 1e9,
    mMax = 0,
    mMin = 0,
    pMax = -1e9,
    decolN = 0;
  for (let i = 0; i < nn; i++) {
    if (sol.w[i] > wMax) wMax = sol.w[i];
    if (sol.w[i] < wMin) wMin = sol.w[i];
    if (Mn[i] > mMax) mMax = Mn[i];
    if (Mn[i] < mMin) mMin = Mn[i];
    if (sol.p[i] > pMax) pMax = sol.p[i];
    if (stateN[i] === 0) decolN++;
  }
  return {
    X,
    w: sol.w,
    p: sol.p,
    M: Mn,
    V: Vn,
    totalLoad,
    sumReact,
    wMax,
    wMin,
    mMax,
    mMin,
    pMax,
    nn,
    z0,
    decolN,
    iters,
    EI,
    dx,
  };
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule la reponse d'une COUPE en deformations planes (poutre sur sol multicouche)
 * a partir d'un ETAT (uniquement `state.layers` est lu) et d'OPTIONS (pas de DOM, pas
 * de globale).
 *   - `state` : { layers: [{ zBase (m), E (MPa), nu }] } ;
 *   - `opts`  : { Bw (m), e (m), E (MPa), nu, foundD (m), ne, q (kPa),
 *     loads: [{ x (m), P (kN/ml) }], decol }.
 *
 * Renvoie l'objet de RESULTAT BRUT `R` (identique a la valeur de retour de
 * `solvePlaneStrain` du HTML), OU `{ err }` si une garde du moteur rejette l'entree
 * (pas de couche) OU si la science leve (matrice singuliere). La PROJECTION
 * client-safe est faite en aval par le dispatch/index (hors de ce fichier).
 */
export function computePlaneStrain(state, opts) {
  try {
    return solvePlaneStrain(state || {}, opts || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
