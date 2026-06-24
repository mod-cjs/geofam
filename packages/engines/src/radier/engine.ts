/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur (cela imposerait de modifier la science pour satisfaire
// noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit a la
// frontiere (contract.ts/index.ts, eux verifies). La sortie brute est volontairement
// opaque puis projetee via le schema strict.
/**
 * MOTEUR RADIER / PLAQUE sur sol multicouche elastique (elements finis).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html — title « GEOPLAQUE —
 * plaques sur sol multicouche elastique »). On NE reordonne RIEN, on NE corrige
 * RIEN : l'arbitre est l'equivalence-PORTAGE (module == HTML, rel serree).
 * `@ts-nocheck` est ASSUME : science transcrite (algebre dense), pas du code maison.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'expose PAS de fonction de calcul pure : `solveModel(opts)` lit son etat
 * dans la GLOBALE `state` (rafts/pointLoads/lineLoads/areaLoads/pointSprings/
 * lineSprings/layers) et `opts` est lu depuis des CHAMPS DE SAISIE par `doSolve()`,
 * qui ECRIT le resultat dans `state.results` puis DESSINE (bakeField/draw/toast).
 * On EXTRAIT ici la science de `solveModel` dans une fonction PURE
 * `solveModel(state, opts)` : `state` et `opts` sont PASSES EN PARAMETRE ; on
 * RETOURNE l'objet `R` (identique a ce que `doSolve` affecte a `state.results`) au
 * lieu de l'afficher. Les fonctions de DESSIN/UI (bakeField/draw/toast/spin, et le
 * chrono d'affichage du HTML) ne sont PAS transcrites — presentation pure, aucun
 * effet sur `R`. Aucun acces a la page, aucune horloge, aucun hasard.
 *
 * --- SOLVEURS HORS PERIMETRE (honnetete) ---
 * Le HTML contient AUSSI trois solveurs de COUPE/variante non empruntes par
 * `doSolve` : `solvePlaneStrain` (deformations planes), `solveAxi` (axisymetrique),
 * `solveTriRaft` (plaque triangulaire DKT). Le chemin `doSolve` n'utilise QUE
 * `solveModel` (grille ACM rectangulaire + souplesse multicouche). On ne transcrit
 * donc QUE `solveModel` et ses dependances reelles (buildACM, solveDense, inv,
 * transpose, matMul, rectSettle/cornerSettle/steinG, pointInPoly, distToSeg) — pas
 * les trois variantes, qui ne contribuent pas a la sortie de ce moteur.
 *
 * --- DETERMINISME ---
 * Le chemin de calcul (assemblage ACM, souplesse C N×N, solveDense LU a pivot
 * partiel, inv, iterations de contact/Winkler) ne contient NI horloge NI hasard NI
 * iteration d'objet a ordre instable. Le seul chrono du HTML (mesure de duree
 * d'affichage) est hors calcul ; non transcrit. Module sans horloge ni hasard ni
 * iteration cle-a-cle (test anti-non-determinisme vert). NB : l'algebre dense reste
 * sensible a l'ordre des operations — on PRESERVE l'ordre VERBATIM (pas de
 * reordonnancement).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#54) ---
 * Equivalence-PORTAGE prouvee (module == HTML). JUSTESSE scientifique NON validee
 * tant que le kit cas-tests STARFIRE n'est pas disponible : @science-unsigned.
 * MJ-6 : pas de prod sans conformite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale
 * stable : si du code moteur fuyait dans le bundle navigateur, le controle CI (grep)
 * la detecterait. Reference inerte cote calcul.
 */
export const RADIER_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// GEOMETRIE & ALGEBRE DENSE (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

function pointInPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x,
      yi = pts[i].y,
      xj = pts[j].x,
      yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

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
function transpose(A) {
  const r = A.length,
    c = A[0].length;
  const T = Array.from({ length: c }, () => new Float64Array(r));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j];
  return T;
}
function matMul(A, B) {
  const n = A.length,
    m = B[0].length,
    k = B.length;
  const C = Array.from({ length: n }, () => new Float64Array(m));
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      const Bp = B[p];
      for (let j = 0; j < m; j++) C[i][j] += a * Bp[j];
    }
  return C;
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
// SOUPLESSE DU SOL MULTICOUCHE (Steinbrenner — HTML d'origine)
// ===========================================================================

function steinG(m, n, nu) {
  if (n <= 1e-9) return 0;
  const s1 = Math.sqrt(m * m + 1),
    s2 = Math.sqrt(m * m + n * n),
    s3 = Math.sqrt(m * m + n * n + 1);
  const F1 =
    (1 / Math.PI) *
    (m * Math.log(((1 + s1) * s2) / (m * (1 + s3))) +
      Math.log(((m + s1) * Math.sqrt(1 + n * n)) / (m + s3)));
  const F2 = (n / (2 * Math.PI)) * Math.atan(m / (n * s3));
  return (1 - nu * nu) * F1 + (1 - nu - 2 * nu * nu) * F2;
}
function cornerSettle(B, L, layers, z0 = 0) {
  if (B <= 1e-9 || L <= 1e-9) return 0;
  const m = L / B;
  let s = 0,
    dPrevRel = 0;
  for (const ly of layers) {
    const dBotAbs = Math.abs(ly.zBase);
    if (dBotAbs <= z0) {
      continue;
    }
    const dBotRel = dBotAbs - z0;
    if (dBotRel <= dPrevRel) {
      continue;
    }
    const Gb = steinG(m, dBotRel / B, ly.nu),
      Gt = steinG(m, dPrevRel / B, ly.nu);
    s += (B / ly.E) * (Gb - Gt);
    dPrevRel = dBotRel;
  }
  return s; // m per kPa
}
function rectSettle(px, py, x1, y1, x2, y2, layers, z0 = 0) {
  const G = (u, v) => {
    const su = u < 0 ? -1 : 1,
      sv = v < 0 ? -1 : 1;
    return su * sv * cornerSettle(Math.abs(u), Math.abs(v), layers, z0);
  };
  const u1 = x1 - px,
    u2 = x2 - px,
    v1 = y1 - py,
    v2 = y2 - py;
  return G(u2, v2) - G(u1, v2) - G(u2, v1) + G(u1, v1);
}

// ===========================================================================
// ELEMENT DE PLAQUE ACM 12 DDL (HTML d'origine)
// ===========================================================================

function buildACM(a, b, E, nu, t) {
  const D0 = (E * t * t * t) / (12 * (1 - nu * nu));
  const Dm = [
    [D0, D0 * nu, 0],
    [D0 * nu, D0, 0],
    [0, 0, (D0 * (1 - nu)) / 2],
  ];
  const nodes = [
    [0, 0],
    [a, 0],
    [a, b],
    [0, b],
  ];
  const P = (x, y) => [
    1,
    x,
    y,
    x * x,
    x * y,
    y * y,
    x * x * x,
    x * x * y,
    x * y * y,
    y * y * y,
    x * x * x * y,
    x * y * y * y,
  ];
  const Px = (x, y) => [
    0,
    1,
    0,
    2 * x,
    y,
    0,
    3 * x * x,
    2 * x * y,
    y * y,
    0,
    3 * x * x * y,
    y * y * y,
  ];
  const Py = (x, y) => [
    0,
    0,
    1,
    0,
    x,
    2 * y,
    0,
    x * x,
    2 * x * y,
    3 * y * y,
    x * x * x,
    3 * x * y * y,
  ];
  const Pxx = (x, y) => [0, 0, 0, 2, 0, 0, 6 * x, 2 * y, 0, 0, 6 * x * y, 0];
  const Pyy = (x, y) => [0, 0, 0, 0, 0, 2, 0, 0, 2 * x, 6 * y, 0, 6 * x * y];
  const Pxy = (x, y) => [0, 0, 0, 0, 1, 0, 0, 2 * x, 2 * y, 0, 3 * x * x, 3 * y * y];
  // coefficient matrix Cmat (12×12): rows = dof equations
  const Cm = [];
  for (const [x, y] of nodes) {
    Cm.push(P(x, y));
    Cm.push(Py(x, y)); // θx = ∂w/∂y
    Cm.push(Px(x, y).map((v) => -v)); // θy = −∂w/∂x
  }
  const Cinv = inv(Cm); // 12×12
  // K_e = Cinv^T · (∫ Q^T D Q) · Cinv ; Q rows [Pxx,Pyy,2Pxy]
  const gp = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)],
    gw = [5 / 9, 8 / 9, 5 / 9];
  const KQ = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = (a * (gp[i] + 1)) / 2,
        y = (b * (gp[j] + 1)) / 2,
        wgt = gw[i] * gw[j] * (a / 2) * (b / 2);
      const q0 = Pxx(x, y),
        q1 = Pyy(x, y),
        q2 = Pxy(x, y).map((v) => 2 * v);
      const Q = [q0, q1, q2];
      // DQ = D·Q (3×12)
      const DQ = [new Float64Array(12), new Float64Array(12), new Float64Array(12)];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 12; c++) {
          DQ[r][c] = Dm[r][0] * Q[0][c] + Dm[r][1] * Q[1][c] + Dm[r][2] * Q[2][c];
        }
      for (let r = 0; r < 12; r++)
        for (let c = 0; c < 12; c++) {
          KQ[r][c] +=
            wgt * (Q[0][r] * DQ[0][c] + Q[1][r] * DQ[1][c] + Q[2][r] * DQ[2][c]);
        }
    }
  // Ke = Cinv^T KQ Cinv
  const tmp = matMul(transpose(Cinv), KQ);
  const Ke = matMul(tmp, Cinv);
  // also keep B at center for moment recovery: B = Q(center)·Cinv
  const xc = a / 2,
    yc = b / 2;
  const Qc = [Pxx(xc, yc), Pyy(xc, yc), Pxy(xc, yc).map((v) => 2 * v)];
  const Bc = matMul(Qc, Cinv); // 3×12
  return { Ke, Bc, Dm };
}

// ===========================================================================
// ASSEMBLAGE + SOLVE — extraction PURE de solveModel (state + opts injectes)
// ===========================================================================
//
// Transcription FIDELE de solveModel(opts). Les seules differences avec le HTML :
//   - la globale `state` est PASSEE EN PARAMETRE (`st`) ; les inner functions
//     (raftIdxAt/insideEarlier) et les boucles `for(const ... of state.X)` lisent
//     desormais `st.X` ;
//   - `opts` est passe en parametre (au lieu d'etre lu dans le DOM par doSolve) ;
//   - on RETOURNE l'objet `R` (au lieu de l'affecter a state.results et de dessiner).
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

function solveModel(st, opts) {
  const state = st; // alias : le corps ci-dessous reste VERBATIM (references `state.*`)
  if (!state.rafts.length) throw new Error('Aucune plaque à calculer.');
  if (!state.layers.length) throw new Error('Définis au moins une couche de sol.');
  const layers = state.layers.slice().sort((p, q) => q.zBase - p.zBase); // surface→profond
  const h = Math.max(0.3, opts.mesh);
  // cote d'assise (§2.3.2) : profondeur de fondation D ; souplesse calculée pour les couches sous D
  const deepest = Math.abs(layers[layers.length - 1].zBase);
  let foundD = Math.max(0, opts.foundD || 0);
  const foundTooDeep = foundD > 0 && foundD >= deepest - 1e-6; // assise sous le substratum → pas de sol compressible
  if (foundTooDeep) foundD = Math.max(0, deepest - 0.5); // garde-fou : laisse une fine couche compressible
  const foundOn = foundD > 1e-6;

  // ---- maillage : une grille structurée PAR plaque, alignée sur sa propre boîte ----
  function onEdge(x, y, pts) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (distToSeg(x, y, pts[j].x, pts[j].y, pts[i].x, pts[i].y) < 1e-6) return true;
    return false;
  }
  function inRaftPts(x, y, pts) {
    return pointInPoly(x, y, pts) || onEdge(x, y, pts);
  }
  function insideEarlier(x, y, bi) {
    for (let r = 0; r < bi; r++) if (inRaftPts(x, y, state.rafts[r].pts)) return true;
    return false;
  }

  const nodeX = [],
    nodeY = [],
    nodeCW = [],
    nodeCH = [];
  let N = 0;
  const blocks = [];
  state.rafts.forEach((rf, bi) => {
    const xs = rf.pts.map((p) => p.x),
      ys = rf.pts.map((p) => p.y);
    const X0 = Math.min(...xs),
      X1 = Math.max(...xs),
      Y0 = Math.min(...ys),
      Y1 = Math.max(...ys);
    const nx = Math.max(2, Math.round((X1 - X0) / h)),
      ny = Math.max(2, Math.round((Y1 - Y0) / h));
    const dx = (X1 - X0) / nx,
      dy = (Y1 - Y0) / ny,
      NX = nx + 1,
      NY = ny + 1;
    const loc = new Int32Array(NX * NY).fill(-1);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const x = X0 + i * dx,
          y = Y0 + j * dy;
        if (inRaftPts(x, y, rf.pts) && !insideEarlier(x, y, bi)) {
          loc[j * NX + i] = N;
          nodeX.push(x);
          nodeY.push(y);
          nodeCW.push(dx);
          nodeCH.push(dy);
          N++;
        }
      }
    blocks.push({ rf, X0, Y0, X1, Y1, nx, ny, dx, dy, NX, NY, loc });
    if (N > 1500)
      throw new Error(
        'Maillage trop fin (' + N + ' nœuds). Augmente le pas de maillage.',
      );
  });
  if (N < 4)
    throw new Error('Maillage insuffisant : affine le pas ou agrandis la plaque.');

  const dof = 3 * N;
  // aire nodale tributaire (control-volume) : accumulation des quarts de chaque maille valide
  const Acell = new Float64Array(N);
  blocks.forEach((bl) => {
    const qa = (bl.dx * bl.dy) / 4;
    for (let j = 0; j < bl.ny; j++)
      for (let i = 0; i < bl.nx; i++) {
        const a = bl.loc[j * bl.NX + i],
          b = bl.loc[j * bl.NX + i + 1],
          c = bl.loc[(j + 1) * bl.NX + i + 1],
          d = bl.loc[(j + 1) * bl.NX + i];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        Acell[a] += qa;
        Acell[b] += qa;
        Acell[c] += qa;
        Acell[d] += qa;
      }
  });
  for (let n = 0; n < N; n++) if (Acell[n] <= 0) Acell[n] = nodeCW[n] * nodeCH[n] * 0.25; // garde-fou nœud isolé

  // ---- éléments de plaque (ACM 12 DDL) par plaque ----
  const K = Array.from({ length: dof }, () => new Float64Array(dof));
  const elements = [];
  blocks.forEach((bl) => {
    const { Ke, Bc, Dm } = buildACM(bl.dx, bl.dy, bl.rf.E, bl.rf.nu, bl.rf.e);
    for (let j = 0; j < bl.ny; j++)
      for (let i = 0; i < bl.nx; i++) {
        const a = bl.loc[j * bl.NX + i],
          b = bl.loc[j * bl.NX + i + 1],
          c = bl.loc[(j + 1) * bl.NX + i + 1],
          d = bl.loc[(j + 1) * bl.NX + i];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        const en = [a, b, c, d],
          map = [];
        for (const nn of en) map.push(3 * nn, 3 * nn + 1, 3 * nn + 2);
        for (let r = 0; r < 12; r++) {
          const Kr = K[map[r]],
            Ker = Ke[r];
          for (let cc = 0; cc < 12; cc++) Kr[map[cc]] += Ker[cc];
        }
        elements.push({ en, Bc, Dm });
      }
  });
  if (!elements.length)
    throw new Error('Aucune maille de plaque générée : affine le pas de maillage.');

  // ---- souplesse du sol C (N×N), cellule = nodeCW×nodeCH autour de chaque nœud ----
  const dipX = opts.dipX || 0,
    dipY = opts.dipY || 0,
    dipOn = dipX !== 0 || dipY !== 0;
  const nodeLayers = new Array(N);
  for (let i = 0; i < N; i++) {
    if (!dipOn) {
      nodeLayers[i] = layers;
      continue;
    }
    const sh = dipX * nodeX[i] + dipY * nodeY[i]; // décalage de profondeur au nœud
    const arr = layers.map((L) => ({ ...L, zBase: Math.min(-0.01, L.zBase - sh) }));
    arr.sort((p, q) => q.zBase - p.zBase); // surface→profond
    nodeLayers[i] = arr;
  }
  const C = Array.from({ length: N }, () => new Float64Array(N));
  for (let j = 0; j < N; j++) {
    const cx = nodeX[j],
      cy = nodeY[j];
    const sc = Math.sqrt(Acell[j] / (nodeCW[j] * nodeCH[j])) || 1; // facteur tributaire
    const hw = (nodeCW[j] / 2) * sc,
      hh = (nodeCH[j] / 2) * sc;
    const x1 = cx - hw,
      x2 = cx + hw,
      y1 = cy - hh,
      y2 = cy + hh;
    for (let i = 0; i < N; i++)
      C[i][j] = rectSettle(nodeX[i], nodeY[i], x1, y1, x2, y2, nodeLayers[i], foundD);
  }

  // ---- tassement champ libre : charges extérieures sur le sol + mouvement imposé g(x,y) (§2.3.3) ----
  const sext = new Float64Array(N);
  for (const a of state.areaLoads) {
    if (a.on !== 'soil') continue;
    for (let i = 0; i < N; i++)
      sext[i] +=
        a.q *
        rectSettle(nodeX[i], nodeY[i], a.x1, a.y1, a.x2, a.y2, nodeLayers[i], foundD);
  }
  const ffG0 = (opts.ffG0 || 0) / 1000,
    ffGx = (opts.ffGx || 0) / 1000,
    ffGy = (opts.ffGy || 0) / 1000; // mm,mm/m → m
  const ffOn = ffG0 !== 0 || ffGx !== 0 || ffGy !== 0;
  if (ffOn)
    for (let i = 0; i < N; i++) sext[i] += ffG0 + ffGx * nodeX[i] + ffGy * nodeY[i];

  // ---- vecteur des charges (vertical → DDL w, moments → DDL θ) ----
  const F = new Float64Array(dof);
  function nearestNode(x, y) {
    let best = -1,
      bd = 1e9;
    for (let n = 0; n < N; n++) {
      const d = (nodeX[n] - x) ** 2 + (nodeY[n] - y) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  function raftIdxAt(x, y) {
    for (let r = state.rafts.length - 1; r >= 0; r--)
      if (inRaftPts(x, y, state.rafts[r].pts)) return r;
    return -1;
  }
  function addNodalForce(x, y, Fz) {
    const bi = raftIdxAt(x, y);
    if (bi < 0) {
      const n = nearestNode(x, y);
      if (n >= 0) F[3 * n] += Fz;
      return;
    }
    const bl = blocks[bi];
    const fi = (x - bl.X0) / bl.dx,
      fj = (y - bl.Y0) / bl.dy;
    let i = Math.floor(fi),
      j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= bl.nx || j >= bl.ny) {
      const n = nearestNode(x, y);
      if (n >= 0) F[3 * n] += Fz;
      return;
    }
    const u = fi - i,
      v = fj - j;
    const cand = [
      [bl.loc[j * bl.NX + i], (1 - u) * (1 - v)],
      [bl.loc[j * bl.NX + i + 1], u * (1 - v)],
      [bl.loc[(j + 1) * bl.NX + i + 1], u * v],
      [bl.loc[(j + 1) * bl.NX + i], (1 - u) * v],
    ];
    let tot = 0;
    cand.forEach((c) => {
      if (c[0] >= 0) tot += c[1];
    });
    if (tot < 1e-9) {
      const n = nearestNode(x, y);
      if (n >= 0) F[3 * n] += Fz;
      return;
    }
    cand.forEach((c) => {
      if (c[0] >= 0) F[3 * c[0]] += (Fz * c[1]) / tot;
    });
  }
  for (const p of state.pointLoads) {
    addNodalForce(p.x, p.y, p.Fz);
    if (p.Mx || p.My) {
      const n = nearestNode(p.x, p.y);
      if (n >= 0) {
        F[3 * n + 1] += p.Mx || 0;
        F[3 * n + 2] += p.My || 0;
      }
    }
  }
  for (const l of state.lineLoads) {
    const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    const minc = Math.min(...blocks.map((b) => Math.min(b.dx, b.dy)));
    const ns = Math.max(2, Math.ceil(len / (minc / 2)));
    const dl = len / ns;
    for (let s = 0; s < ns; s++) {
      const t = (s + 0.5) / ns;
      addNodalForce(l.x1 + (l.x2 - l.x1) * t, l.y1 + (l.y2 - l.y1) * t, l.q * dl);
    }
  }
  for (const a of state.areaLoads) {
    if (a.on !== 'raft') continue;
    for (let n = 0; n < N; n++) {
      const hwx = nodeCW[n] / 2,
        hhy = nodeCH[n] / 2; // recouvrement de la cellule du nœud avec le patch
      const ox = Math.max(
        0,
        Math.min(nodeX[n] + hwx, a.x2) - Math.max(nodeX[n] - hwx, a.x1),
      );
      const oy = Math.max(
        0,
        Math.min(nodeY[n] + hhy, a.y2) - Math.max(nodeY[n] - hhy, a.y1),
      );
      let ov = ox * oy;
      if (ov > Acell[n]) ov = Acell[n]; // borné à l'aire tributaire (bords/coins)
      if (ov > 0) F[3 * n] += a.q * ov;
    }
  }

  const totalLoad = F.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0);

  // ---- contact / couplage (décollement + plastification + recompression fond de fouille) ----
  const sv0 = Math.max(0, opts.sigV0 || 0); // poids des terres excavées σv0 (kPa)
  const kRec = opts.kRec && opts.kRec > 1 ? opts.kRec : 1; // rapport de recompression
  const recOn = sv0 > 0 && kRec > 1;
  const qLim = opts.qLim && opts.qLim > 0 ? opts.qLim : Infinity; // seuil de plastification (kPa)
  const plastOn = isFinite(qLim);
  const decolOn = !!opts.decol;
  const kWink = Math.max(0, opts.kWink || 0); // module de réaction additionnel (Winkler) kN/m³
  const winkOn = kWink > 0;
  const winkDecol = winkOn && !!opts.winkDecol; // ressort surfacique en compression seule
  const pLimWink = winkOn && opts.pLimWink > 0 ? opts.pLimWink : Infinity; // plastification Winkler (kPa)
  const winkPlast = winkOn && isFinite(pLimWink);

  // ---- ressorts ponctuels : raideur verticale localisée, rattachée au nœud le plus proche ----
  const kNodeSpr = new Float64Array(N);
  const sprMap = [];
  for (const s of state.pointSprings || []) {
    const ks = Math.max(0, s.k || 0);
    if (ks <= 0) continue;
    const nn = nearestNode(s.x, s.y);
    if (nn >= 0) {
      kNodeSpr[nn] += ks;
      sprMap.push({ x: s.x, y: s.y, k: ks, node: nn });
    }
  }
  // ---- ressorts linéiques : raideur k (kN/m par m) répartie le long d'une ligne ----
  function addNodalSpring(x, y, ks) {
    const bi = raftIdxAt(x, y);
    if (bi < 0) {
      const n = nearestNode(x, y);
      if (n >= 0) kNodeSpr[n] += ks;
      return;
    }
    const bl = blocks[bi];
    const fi = (x - bl.X0) / bl.dx,
      fj = (y - bl.Y0) / bl.dy;
    let i = Math.floor(fi),
      j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= bl.nx || j >= bl.ny) {
      const n = nearestNode(x, y);
      if (n >= 0) kNodeSpr[n] += ks;
      return;
    }
    const u = fi - i,
      v = fj - j;
    const cand = [
      [bl.loc[j * bl.NX + i], (1 - u) * (1 - v)],
      [bl.loc[j * bl.NX + i + 1], u * (1 - v)],
      [bl.loc[(j + 1) * bl.NX + i + 1], u * v],
      [bl.loc[(j + 1) * bl.NX + i], (1 - u) * v],
    ];
    let tot = 0;
    cand.forEach((c) => {
      if (c[0] >= 0) tot += c[1];
    });
    if (tot < 1e-9) {
      const n = nearestNode(x, y);
      if (n >= 0) kNodeSpr[n] += ks;
      return;
    }
    cand.forEach((c) => {
      if (c[0] >= 0) kNodeSpr[c[0]] += (ks * c[1]) / tot;
    });
  }
  let lineSprK = 0;
  for (const ls of state.lineSprings || []) {
    const kl = Math.max(0, ls.k || 0);
    if (kl <= 0) continue;
    const len = Math.hypot(ls.x2 - ls.x1, ls.y2 - ls.y1);
    if (len <= 1e-9) continue;
    lineSprK += kl * len;
    const minc = Math.min(...blocks.map((b) => Math.min(b.dx, b.dy)));
    const ns = Math.max(2, Math.ceil(len / (minc / 2)));
    const dl = len / ns;
    for (let s = 0; s < ns; s++) {
      const t = (s + 0.5) / ns;
      addNodalSpring(ls.x1 + (ls.x2 - ls.x1) * t, ls.y1 + (ls.y2 - ls.y1) * t, kl * dl);
    }
  }
  const nLine = (state.lineSprings || []).filter(
    (l) => (l.k || 0) > 0 && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 1e-9,
  ).length;
  let sprOn = false;
  for (let n = 0; n < N; n++)
    if (kNodeSpr[n] > 0) {
      sprOn = true;
      break;
    }

  const stateN = new Uint8Array(N).fill(1);
  const winkState = new Uint8Array(N).fill(1); // 1 élastique, 0 décollé, 2 plastique (Winkler)
  const p0 = new Float64Array(N);

  function assembleAndSolve() {
    const act = [];
    for (let n = 0; n < N; n++) if (stateN[n] === 1) act.push(n);
    const A = K.map((r) => Float64Array.from(r));
    const rhs = Float64Array.from(F);
    if (winkOn)
      for (let n = 0; n < N; n++) {
        if (winkState[n] === 1) A[3 * n][3 * n] += kWink * Acell[n];
        else if (winkState[n] === 2) rhs[3 * n] -= pLimWink * Acell[n];
      }
    if (sprOn)
      for (let n = 0; n < N; n++) if (kNodeSpr[n] > 0) A[3 * n][3 * n] += kNodeSpr[n];
    let CsubInv = null;
    if (act.length) {
      const Csub = Array.from({ length: act.length }, () => new Float64Array(act.length));
      for (let a = 0; a < act.length; a++)
        for (let b = 0; b < act.length; b++) Csub[a][b] = C[act[a]][act[b]];
      CsubInv = inv(Csub);
      for (let a = 0; a < act.length; a++) {
        const ia = 3 * act[a],
          Aa = Acell[act[a]];
        let acc = 0;
        for (let b = 0; b < act.length; b++) {
          const k = Aa * CsubInv[a][b];
          A[ia][3 * act[b]] += k;
          acc += k * sext[act[b]];
        }
        rhs[ia] += acc - Aa * p0[act[a]]; // + M·T⁻¹·sext − M·p0
      }
    }
    for (let n = 0; n < N; n++) if (stateN[n] === 2) rhs[3 * n] -= qLim * Acell[n]; // réaction plastique imposée
    const u = solveDense(A, rhs);
    const w = new Float64Array(N),
      p = new Float64Array(N);
    for (let n = 0; n < N; n++) w[n] = u[3 * n];
    if (CsubInv) {
      const wm = act.map((n) => w[n] - sext[n]);
      for (let a = 0; a < act.length; a++) {
        let s = 0;
        for (let b = 0; b < act.length; b++) s += CsubInv[a][b] * wm[b];
        p[act[a]] = s + p0[act[a]];
      }
    }
    for (let n = 0; n < N; n++) {
      if (stateN[n] === 2) p[n] = qLim;
      else if (stateN[n] === 0) p[n] = 0;
    }
    return { u, w, p };
  }

  let sol = assembleAndSolve();
  let iters = 1;
  let overCap = false;
  if (decolOn || plastOn || recOn || winkDecol || winkPlast) {
    for (let it = 0; it < 40; it++) {
      let changed = false;
      if (recOn) {
        for (let n = 0; n < N; n++) {
          const tgt =
            stateN[n] === 0 ? 0 : (1 - 1 / kRec) * Math.min(sv0, Math.max(0, sol.p[n]));
          if (Math.abs(tgt - p0[n]) > 1e-4 * Math.max(1, Math.abs(sol.p[n])))
            changed = true;
          p0[n] = tgt;
        }
      }
      if (decolOn) {
        for (let n = 0; n < N; n++) {
          if (stateN[n] === 1 && sol.p[n] < -1e-6) {
            stateN[n] = 0;
            changed = true;
          }
        }
        for (let n = 0; n < N; n++) {
          if (stateN[n] === 0 && sol.w[n] - sext[n] > 1e-6) {
            stateN[n] = 1;
            changed = true;
          }
        }
      }
      if (plastOn) {
        for (let n = 0; n < N; n++) {
          if (stateN[n] === 1 && sol.p[n] > qLim + 1e-6) {
            stateN[n] = 2;
            changed = true;
          }
        }
        for (let n = 0; n < N; n++) {
          if (stateN[n] === 2) {
            const wm = sol.w[n] - sext[n];
            if (wm < C[n][n] * qLim - 1e-9) {
              stateN[n] = decolOn && wm <= 1e-9 ? 0 : 1;
              changed = true;
            }
          }
        }
      }
      if (winkPlast) {
        for (let n = 0; n < N; n++) {
          if (winkState[n] === 1 && kWink * sol.w[n] > pLimWink + 1e-9) {
            winkState[n] = 2;
            changed = true;
          }
        }
      }
      if (winkDecol) {
        for (let n = 0; n < N; n++) {
          if (winkState[n] === 1 && sol.w[n] < 0) {
            winkState[n] = 0;
            changed = true;
          }
        }
      }
      let cnt = 0;
      for (let n = 0; n < N; n++) if (stateN[n] === 1) cnt++;
      if (cnt < 1) {
        overCap = true;
        break;
      } // capacité plastique insuffisante (poinçonnement)
      if (!changed) break;
      sol = assembleAndSolve();
      iters++;
    }
  }
  const active = new Uint8Array(N);
  for (let n = 0; n < N; n++) active[n] = stateN[n] !== 0 ? 1 : 0;
  let nPlast = 0;
  for (let n = 0; n < N; n++) if (stateN[n] === 2) nPlast++;
  let nWinkDecol = 0,
    nWinkPlast = 0;
  if (winkOn)
    for (let n = 0; n < N; n++) {
      if (winkState[n] === 0) nWinkDecol++;
      else if (winkState[n] === 2) nWinkPlast++;
    }

  // ---- moments par nœud (moyenne des valeurs au centre des éléments) ----
  const Mx = new Float64Array(N),
    My = new Float64Array(N),
    Mxy = new Float64Array(N),
    cntN = new Float64Array(N);
  for (const el of elements) {
    const de = new Float64Array(12);
    const en = el.en;
    for (let k = 0; k < 4; k++) {
      de[3 * k] = sol.u[3 * en[k]];
      de[3 * k + 1] = sol.u[3 * en[k] + 1];
      de[3 * k + 2] = sol.u[3 * en[k] + 2];
    }
    const k0 = el.Bc[0].reduce((s, b, i) => s + b * de[i], 0);
    const k1 = el.Bc[1].reduce((s, b, i) => s + b * de[i], 0);
    const k2 = el.Bc[2].reduce((s, b, i) => s + b * de[i], 0);
    const Dm = el.Dm;
    const mx = -(Dm[0][0] * k0 + Dm[0][1] * k1);
    const my = -(Dm[1][0] * k0 + Dm[1][1] * k1);
    const mxy = -(Dm[2][2] * k2);
    for (const n of en) {
      Mx[n] += mx;
      My[n] += my;
      Mxy[n] += mxy;
      cntN[n]++;
    }
  }
  for (let n = 0; n < N; n++) {
    if (cntN[n]) {
      Mx[n] /= cntN[n];
      My[n] /= cntN[n];
      Mxy[n] /= cntN[n];
    }
  }

  const kr = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    kr[n] = Math.abs(sol.w[n]) > 1e-9 ? sol.p[n] / sol.w[n] : 0;
  }

  // ---- rotations (DDL de la plaque) : θx = ∂w/∂y, θy = −∂w/∂x ; pente locale = |∇w| ----
  const tx = new Float64Array(N),
    ty = new Float64Array(N),
    slope = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    tx[n] = sol.u[3 * n + 1];
    ty[n] = sol.u[3 * n + 2];
    const dwdx = -ty[n],
      dwdy = tx[n];
    slope[n] = Math.hypot(dwdx, dwdy);
  }

  // ---- diagnostics (tassements, différentiel, distorsion angulaire, inter-plaques) ----
  let iMax = 0,
    iMin = 0,
    iSlope = 0;
  for (let n = 1; n < N; n++) {
    if (sol.w[n] > sol.w[iMax]) iMax = n;
    if (sol.w[n] < sol.w[iMin]) iMin = n;
    if (slope[n] > slope[iSlope]) iSlope = n;
  }
  const rmean = [],
    rcx = [],
    rcy = [];
  let tiltMax = 0,
    tiltAt = null,
    betaIntra = 0,
    betaIntraAt = null;
  blocks.forEach((bl) => {
    const ids = [];
    for (const v of bl.loc) if (v >= 0) ids.push(v);
    let S1 = 0,
      Sx = 0,
      Sy = 0,
      Sxx = 0,
      Sxy = 0,
      Syy = 0,
      Sw = 0,
      Sxw = 0,
      Syw = 0;
    for (const v of ids) {
      const x = nodeX[v],
        y = nodeY[v],
        w = sol.w[v];
      S1++;
      Sx += x;
      Sy += y;
      Sxx += x * x;
      Sxy += x * y;
      Syy += y * y;
      Sw += w;
      Sxw += x * w;
      Syw += y * w;
    }
    rmean.push(ids.length ? Sw / S1 : 0);
    rcx.push(ids.length ? Sx / S1 : 0);
    rcy.push(ids.length ? Sy / S1 : 0);
    let b = 0,
      c = 0;
    try {
      const sol3 = solveDense(
        [
          Float64Array.from([S1, Sx, Sy]),
          Float64Array.from([Sx, Sxx, Sxy]),
          Float64Array.from([Sy, Sxy, Syy]),
        ],
        Float64Array.from([Sw, Sxw, Syw]),
      );
      b = sol3[1];
      c = sol3[2];
    } catch (_) {}
    const tilt = Math.hypot(b, c);
    if (tilt > tiltMax) {
      tiltMax = tilt;
      tiltAt = { x: rcx[rcx.length - 1], y: rcy[rcy.length - 1] };
    }
    for (const v of ids) {
      const rs = Math.hypot(-ty[v] - b, tx[v] - c);
      if (rs > betaIntra) {
        betaIntra = rs;
        betaIntraAt = { x: nodeX[v], y: nodeY[v] };
      }
    }
  });
  let interBeta = 0,
    interDiff = 0,
    interPair = null,
    interAt = null,
    interEnds = null,
    interDiffEnds = null,
    interDiffVal = 0;
  for (let a = 0; a < blocks.length; a++)
    for (let b = a + 1; b < blocks.length; b++) {
      const L = Math.hypot(rcx[a] - rcx[b], rcy[a] - rcy[b]);
      if (L < 1e-6) continue;
      const ds = Math.abs(rmean[a] - rmean[b]);
      const beta = ds / L;
      if (beta > interBeta) {
        interBeta = beta;
        interPair = [a, b];
        interAt = { x: (rcx[a] + rcx[b]) / 2, y: (rcy[a] + rcy[b]) / 2 };
        interEnds = [
          { x: rcx[a], y: rcy[a] },
          { x: rcx[b], y: rcy[b] },
        ];
      }
      if (ds > interDiff) {
        interDiff = ds;
        interDiffEnds = [
          { x: rcx[a], y: rcy[a] },
          { x: rcx[b], y: rcy[b] },
        ];
        interDiffVal = ds;
      }
    }
  const betaGov = Math.max(betaIntra, interBeta);
  const betaGovAt = interBeta >= betaIntra ? interAt : betaIntraAt;
  const diag = {
    wMax: sol.w[iMax],
    wMaxAt: { x: nodeX[iMax], y: nodeY[iMax] },
    wMin: sol.w[iMin],
    wMinAt: { x: nodeX[iMin], y: nodeY[iMin] },
    diff: sol.w[iMax] - sol.w[iMin],
    slopeMax: slope[iSlope],
    slopeMaxAt: { x: nodeX[iSlope], y: nodeY[iSlope] },
    txMax: Math.max(...Array.from(tx, Math.abs)),
    tyMax: Math.max(...Array.from(ty, Math.abs)),
    tiltMax,
    tiltAt,
    betaIntra,
    betaIntraAt,
    interBeta,
    interDiff,
    interPair,
    interAt,
    interEnds,
    interDiffEnds,
    betaGov,
    betaGovAt,
    nRafts: blocks.length,
  };

  // ---- tassement différentiel ENTRE CHARGES voisines (distorsion colonne à colonne) ----
  function wAtXY(x, y) {
    for (const bl of blocks) {
      if (x < bl.X0 - 1e-9 || x > bl.X1 + 1e-9 || y < bl.Y0 - 1e-9 || y > bl.Y1 + 1e-9)
        continue;
      if (!inRaftPts(x, y, bl.rf.pts)) continue;
      let fi = (x - bl.X0) / bl.dx,
        fj = (y - bl.Y0) / bl.dy;
      let i = Math.max(0, Math.min(bl.nx - 1, Math.floor(fi))),
        j = Math.max(0, Math.min(bl.ny - 1, Math.floor(fj)));
      const a = bl.loc[j * bl.NX + i],
        b = bl.loc[j * bl.NX + i + 1],
        c = bl.loc[(j + 1) * bl.NX + i + 1],
        d = bl.loc[(j + 1) * bl.NX + i];
      if (a < 0 || b < 0 || c < 0 || d < 0) break;
      const u = Math.max(0, Math.min(1, fi - i)),
        v = Math.max(0, Math.min(1, fj - j));
      return (
        (1 - u) * (1 - v) * sol.w[a] +
        u * (1 - v) * sol.w[b] +
        u * v * sol.w[c] +
        (1 - u) * v * sol.w[d]
      );
    }
    let best = -1,
      bd = 1e9;
    for (let n = 0; n < N; n++) {
      const dd = (nodeX[n] - x) ** 2 + (nodeY[n] - y) ** 2;
      if (dd < bd) {
        bd = dd;
        best = n;
      }
    }
    return best >= 0 ? sol.w[best] : 0;
  }
  const pls = state.pointLoads.map((p, k) => ({
    k: k + 1,
    x: p.x,
    y: p.y,
    Fz: p.Fz,
    s: wAtXY(p.x, p.y),
  }));
  let loadPairs = null;
  if (pls.length >= 2) {
    const K = 4;
    const edgeSet = new Set();
    for (let i = 0; i < pls.length; i++) {
      const order = pls
        .map((q, j) => ({ j, d: Math.hypot(pls[i].x - q.x, pls[i].y - q.y) }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.d - b.d);
      for (let kk = 0; kk < Math.min(K, order.length); kk++) {
        const j = order[kk].j;
        edgeSet.add(i < j ? i + '_' + j : j + '_' + i);
      }
    }
    const edges = [];
    edgeSet.forEach((key) => {
      const [i, j] = key.split('_').map(Number);
      const L = Math.hypot(pls[i].x - pls[j].x, pls[i].y - pls[j].y);
      const ds = Math.abs(pls[i].s - pls[j].s);
      const beta = L > 1e-6 ? ds / L : 0;
      edges.push({
        i,
        j,
        ki: pls[i].k,
        kj: pls[j].k,
        L,
        ds,
        beta,
        p1: { x: pls[i].x, y: pls[i].y },
        p2: { x: pls[j].x, y: pls[j].y },
      });
    });
    edges.sort((a, b) => b.beta - a.beta);
    const perLoad = pls.map((p) => {
      let wb = 0,
        we = null;
      edges.forEach((e) => {
        if ((e.ki === p.k || e.kj === p.k) && e.beta > wb) {
          wb = e.beta;
          we = e;
        }
      });
      return { k: p.k, x: p.x, y: p.y, beta: wb, edge: we };
    });
    loadPairs = { edges, worst: edges[0] || null, perLoad, n: pls.length };
  }
  diag.loadPairs = loadPairs;

  return {
    N,
    nodeX,
    nodeY,
    blocks,
    w: sol.w,
    p: sol.p,
    Mx,
    My,
    Mxy,
    kr,
    tx,
    ty,
    slope,
    active,
    totalLoad,
    sumReact: sol.p.reduce((s, v, n) => s + v * Acell[n], 0),
    sumWink: winkOn
      ? (() => {
          let s = 0;
          for (let n = 0; n < N; n++) {
            if (winkState[n] === 1) s += kWink * sol.w[n] * Acell[n];
            else if (winkState[n] === 2) s += pLimWink * Acell[n];
          }
          return s;
        })()
      : 0,
    winkOn,
    kWink: winkOn ? kWink : 0,
    winkDecol,
    winkPlast,
    pLimWink: winkPlast ? pLimWink : null,
    nWinkDecol,
    nWinkPlast,
    sprOn,
    nSpr: sprMap.length,
    nLine,
    sumSpr: sprOn
      ? (() => {
          let s = 0;
          for (let n = 0; n < N; n++) s += kNodeSpr[n] * sol.w[n];
          return s;
        })()
      : 0,
    sumSprPt: sprMap.reduce((s, sp) => s + sp.k * sol.w[sp.node], 0),
    springs: sprMap.map((sp) => ({
      x: sp.x,
      y: sp.y,
      k: sp.k,
      w: sol.w[sp.node],
      R: sp.k * sol.w[sp.node],
    })),
    ffOn,
    ffG0: opts.ffG0 || 0,
    ffGx: opts.ffGx || 0,
    ffGy: opts.ffGy || 0,
    decolNodes: opts.decol ? N - active.reduce((s, v) => s + v, 0) : 0,
    plastNodes: plastOn ? nPlast : 0,
    plastOn,
    qLim: plastOn ? qLim : null,
    overCap,
    recOn,
    sigV0: recOn ? sv0 : 0,
    kRec: recOn ? kRec : 1,
    foundD,
    foundOn,
    foundTooDeep,
    dipOn,
    dipX,
    dipY,
    iters,
    diag,
  };
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule la reponse d'un radier/plaque sur sol multicouche elastique a partir d'un
 * ETAT complet et d'OPTIONS (pas de DOM, pas de globale).
 *   - `state` : { rafts, pointLoads, lineLoads, areaLoads, pointSprings, lineSprings,
 *     layers } (cf. contract.ts) ;
 *   - `opts`  : options de calcul (mesh, decol, qLim, sigV0/kRec/foundD, kWink/
 *     winkDecol/pLimWink, ffG0/ffGx/ffGy, dipX/dipY).
 *
 * Renvoie l'objet de RESULTAT BRUT `R` (identique a `state.results` du HTML), OU
 * `{ err }` si une garde du moteur rejette l'entree (aucune plaque, pas de couche,
 * maillage insuffisant/trop fin) OU si la science leve. La PROJECTION client-safe
 * (diag.* uniquement) est faite par index.ts.
 */
export function computeRadier(state, opts) {
  try {
    return solveModel(state || {}, opts || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
