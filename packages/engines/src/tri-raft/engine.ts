/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur (cela imposerait de modifier la science pour satisfaire
// noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit a la
// frontiere (contract.ts, verifie). La sortie brute est volontairement opaque.
/**
 * MOTEUR RADIER TRIANGULAIRE (DKT) sur sol multicouche elastique (elements finis).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html — solveur `solveTriRaft`,
 * l.1748, maillage triangulaire DKT couple au sol par patch carre equivalent par nœud).
 * On NE reordonne RIEN, on NE corrige RIEN : l'arbitre est l'equivalence-PORTAGE
 * (module == HTML, rel serree). `@ts-nocheck` est ASSUME : science transcrite (algebre
 * dense, geometrie de maillage), pas du code maison.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'expose PAS de fonction de calcul pure : `solveTriRaft(o)` lit son etat dans
 * la GLOBALE `state` (rafts/pointLoads/lineLoads/areaLoads/layers) et `o` est lu depuis
 * des CHAMPS DE SAISIE par le handler `tri-run.onclick`, qui AFFICHE le resultat
 * (triMeshSvg/toast). On EXTRAIT ici la science de `solveTriRaft` dans une fonction PURE
 * `solveTriRaft(state, opts)` : `state` et `opts` sont PASSES EN PARAMETRE ; on RETOURNE
 * l'objet `R` (identique a ce que le handler affecte a `R`) au lieu de l'afficher. Les
 * fonctions de DESSIN/UI (triMeshSvg, jet, toast) ne sont PAS transcrites — presentation
 * pure, aucun effet sur `R`. Aucun acces a la page, aucune horloge, aucun hasard.
 *
 * --- SOLVEURS/BRANCHES HORS PERIMETRE (honnetete) ---
 * Le HTML contient d'AUTRES solveurs (solveModel = grille rectangulaire ACM ; solvePlaneStrain ;
 * solveAxi) transcrits ailleurs OU non empruntes par ce chemin. On ne transcrit ICI que
 * `solveTriRaft` et ses dependances REELLES : `meshPoly`/`earClip`/`refine1to4`/`triArea`
 * (mailleur triangulaire par ear-clipping + raffinement 1->4), `dktKe` (element de plaque
 * DKT Batoz-Bathe-Ho 1980), `_triBary`/`_distribTri` (repartition barycentrique des charges),
 * `rectSettle`/`cornerSettle`/`steinG` (souplesse Steinbrenner multicouche), `inv`/`solveDense`
 * (algebre dense). Note : `solveTriRaft` N'utilise NI pointSprings/lineSprings, NI le champ
 * libre/decollement/plastification de solveModel ; les charges surfaciques sur le SOL
 * (`al.on==='soil'`) sont IGNOREES (pas de tassement champ-libre dans ce solveur — a la
 * difference de solveModel). Transcrit VERBATIM.
 *
 * --- DETERMINISME ---
 * Le chemin de calcul (ear-clipping, raffinement, assemblage K, souplesse C N×N,
 * inv(C), solveDense LU a pivot partiel) ne contient NI horloge NI hasard NI iteration
 * d'objet a ordre instable. Module sans horloge ni hasard ni iteration cle-a-cle. NB :
 * l'algebre dense reste sensible a l'ordre des operations — on PRESERVE l'ordre VERBATIM.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce module
 * (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE ---
 * Equivalence-PORTAGE prouvee (module == HTML). Science signee par STARFIRE (cf. memoire
 * roadsen-science-signed) ; l'equivalence de portage reste la preuve de fidelite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale stable :
 * si du code moteur fuyait dans le bundle navigateur, le controle CI (grep) la
 * detecterait. Reference inerte cote calcul.
 */
export const TRI_RAFT_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// ALGEBRE DENSE (HTML d'origine — IDENTIQUE a solveModel/radier — NE RIEN MODIFIER)
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
// SOUPLESSE DU SOL MULTICOUCHE (Steinbrenner — HTML d'origine, IDENTIQUE a radier)
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
// ELEMENT DE PLAQUE DKT (Batoz, Bathe & Ho 1980) — HTML l.1701
// ===========================================================================

function dktKe(xy, E, t, nu) {
  const [x1, y1] = xy[0],
    [x2, y2] = xy[1],
    [x3, y3] = xy[2];
  const x23 = x2 - x3,
    x31 = x3 - x1,
    x12 = x1 - x2,
    y23 = y2 - y3,
    y31 = y3 - y1,
    y12 = y1 - y2;
  const A = 0.5 * (x31 * y12 - x12 * y31);
  const l23 = x23 * x23 + y23 * y23,
    l31 = x31 * x31 + y31 * y31,
    l12 = x12 * x12 + y12 * y12;
  const cf = (xij, yij, l) => ({
    P: (-6 * xij) / l,
    t: (-6 * yij) / l,
    q: (3 * xij * yij) / l,
    r: (3 * yij * yij) / l,
  });
  const c4 = cf(x23, y23, l23),
    c5 = cf(x31, y31, l31),
    c6 = cf(x12, y12, l12);
  const P4 = c4.P,
    P5 = c5.P,
    P6 = c6.P,
    t4 = c4.t,
    t5 = c5.t,
    t6 = c6.t,
    q4 = c4.q,
    q5 = c5.q,
    q6 = c6.q,
    r4 = c4.r,
    r5 = c5.r,
    r6 = c6.r;
  const Hxxi = (xi, e) => [
    P6 * (1 - 2 * xi) + (P5 - P6) * e,
    q6 * (1 - 2 * xi) - (q5 + q6) * e,
    -4 + 6 * (xi + e) + r6 * (1 - 2 * xi) - (r5 + r6) * e,
    -P6 * (1 - 2 * xi) + (P4 + P6) * e,
    q6 * (1 - 2 * xi) + (q4 - q6) * e,
    -2 + 6 * xi + r6 * (1 - 2 * xi) + (r4 - r6) * e,
    -(P4 + P5) * e,
    (q4 - q5) * e,
    (r4 - r5) * e,
  ];
  const Hyxi = (xi, e) => [
    t6 * (1 - 2 * xi) + (t5 - t6) * e,
    1 + r6 * (1 - 2 * xi) - (r5 + r6) * e,
    -q6 * (1 - 2 * xi) + (q5 + q6) * e,
    -t6 * (1 - 2 * xi) + (t4 + t6) * e,
    -1 + r6 * (1 - 2 * xi) + (r4 - r6) * e,
    -q6 * (1 - 2 * xi) - (q4 - q6) * e,
    -(t4 + t5) * e,
    (r4 - r5) * e,
    -(q4 - q5) * e,
  ];
  const Hxet = (xi, e) => [
    -P5 * (1 - 2 * e) - (P6 - P5) * xi,
    q5 * (1 - 2 * e) - (q5 + q6) * xi,
    -4 + 6 * (xi + e) + r5 * (1 - 2 * e) - (r5 + r6) * xi,
    (P4 + P6) * xi,
    (q4 - q6) * xi,
    (r4 - r6) * xi,
    P5 * (1 - 2 * e) - (P4 + P5) * xi,
    q5 * (1 - 2 * e) + (q4 - q5) * xi,
    -2 + 6 * e + r5 * (1 - 2 * e) + (r4 - r5) * xi,
  ];
  const Hyet = (xi, e) => [
    -t5 * (1 - 2 * e) - (t6 - t5) * xi,
    1 + r5 * (1 - 2 * e) - (r5 + r6) * xi,
    -q5 * (1 - 2 * e) + (q5 + q6) * xi,
    (t4 + t6) * xi,
    (r4 - r6) * xi,
    -(q4 - q6) * xi,
    t5 * (1 - 2 * e) - (t4 + t5) * xi,
    -1 + r5 * (1 - 2 * e) + (r4 - r5) * xi,
    -q5 * (1 - 2 * e) - (q4 - q5) * xi,
  ];
  const D = (E * t * t * t) / (12 * (1 - nu * nu));
  const Db = [
    [D, D * nu, 0],
    [D * nu, D, 0],
    [0, 0, (D * (1 - nu)) / 2],
  ];
  const Ke = Array.from({ length: 9 }, () => new Float64Array(9));
  const gp = [
    [0.5, 0],
    [0.5, 0.5],
    [0, 0.5],
  ];
  const wgt = Math.abs(A) / 3;
  for (const [xi, e] of gp) {
    const hxx = Hxxi(xi, e),
      hxe = Hxet(xi, e),
      hyx = Hyxi(xi, e),
      hye = Hyet(xi, e);
    const B = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
    for (let i = 0; i < 9; i++) {
      B[0][i] = (y31 * hxx[i] + y12 * hxe[i]) / (2 * A);
      B[1][i] = (-x31 * hyx[i] - x12 * hye[i]) / (2 * A);
      B[2][i] = (-x31 * hxx[i] - x12 * hxe[i] + y31 * hyx[i] + y12 * hye[i]) / (2 * A);
    }
    for (let a = 0; a < 9; a++)
      for (let b = 0; b < 9; b++) {
        let v = 0;
        for (let r = 0; r < 3; r++) {
          let db = 0;
          for (let s = 0; s < 3; s++) db += Db[r][s] * B[s][b];
          v += B[r][a] * db;
        }
        Ke[a][b] += wgt * v;
      }
  }
  return { Ke, A };
}

// ===========================================================================
// MAILLAGE TRIANGULAIRE (§2.2.2) — ear-clipping + raffinement 1->4 — HTML l.1721
// ===========================================================================

function triArea(P, a, b, c) {
  return 0.5 * ((P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[c][0] - P[a][0]) * (P[b][1] - P[a][1]));
}
function earClip(poly) {
  let V = poly.map((p, i) => i);
  const P = poly.slice();
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  if (area < 0) V.reverse();
  const tris = [];
  let guard = 0;
  while (V.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const a = V[(i + V.length - 1) % V.length],
        b = V[i],
        c = V[(i + 1) % V.length];
      if (triArea(P, a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const vk of V) {
        if (vk === a || vk === b || vk === c) continue;
        const d1 = triArea(P, a, b, vk),
          d2 = triArea(P, b, c, vk),
          d3 = triArea(P, c, a, vk);
        if (d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12) {
          ear = false;
          break;
        }
      }
      if (ear) {
        tris.push([a, b, c]);
        V.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
  }
  if (V.length === 3) tris.push([V[0], V[1], V[2]]);
  return { P: P.map((p) => p.slice()), tris };
}
function refine1to4(P, tris) {
  const mid = {};
  const midNode = (i, j) => {
    const k = i < j ? i + '_' + j : j + '_' + i;
    if (mid[k] != null) return mid[k];
    const n = P.length;
    P.push([(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2]);
    mid[k] = n;
    return n;
  };
  const nt = [];
  for (const [a, b, c] of tris) {
    const ab = midNode(a, b),
      bc = midNode(b, c),
      ca = midNode(c, a);
    nt.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { P, tris: nt };
}
function meshPoly(poly, target) {
  let { P, tris } = earClip(poly);
  for (let lvl = 0; lvl < 7; lvl++) {
    let amax = 0;
    for (const t of tris) amax = Math.max(amax, Math.abs(triArea(P, t[0], t[1], t[2])));
    if (amax <= target) break;
    ({ P, tris } = refine1to4(P, tris));
  }
  return { P, tris };
}

// ===========================================================================
// SOLVEUR TRIANGULAIRE COUPLE : DKT + sol (patch carre equivalent par nœud) — HTML l.1741
// ===========================================================================

function _triBary(P, a, b, c, x, y) {
  const A =
    (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[c][0] - P[a][0]) * (P[b][1] - P[a][1]);
  const la =
      ((P[b][0] - x) * (P[c][1] - y) - (P[c][0] - x) * (P[b][1] - y)) / A,
    lb = ((P[c][0] - x) * (P[a][1] - y) - (P[a][0] - x) * (P[c][1] - y)) / A;
  return [la, lb, 1 - la - lb];
}
function _distribTri(P, tris, F, x, y, Fz) {
  let best = null,
    bestMin = -1e9;
  for (const tr of tris) {
    const [la, lb, lc] = _triBary(P, tr[0], tr[1], tr[2], x, y);
    const mn = Math.min(la, lb, lc);
    if (mn >= -1e-9) {
      F[3 * tr[0]] += Fz * la;
      F[3 * tr[1]] += Fz * lb;
      F[3 * tr[2]] += Fz * lc;
      return;
    }
    if (mn > bestMin) {
      bestMin = mn;
      best = [tr, la, lb, lc];
    }
  }
  if (best) {
    const [tr, la, lb, lc] = best;
    F[3 * tr[0]] += Fz * la;
    F[3 * tr[1]] += Fz * lb;
    F[3 * tr[2]] += Fz * lc;
  }
}

// Transcription FIDELE de solveTriRaft(o). Les seules differences avec le HTML :
//   - la globale `state` est PASSEE EN PARAMETRE (`st`) ; les boucles `for(const ... of
//     state.X)` lisent desormais `st.X` (via l'alias `state = st`) ;
//   - `o` (options) est passe en parametre (au lieu d'etre lu dans le DOM par le handler) ;
//   - on RETOURNE l'objet `R` (au lieu de l'afficher). Aucune formule/ordre/seuil modifie.

function solveTriRaft(st, o) {
  const state = st; // alias : le corps ci-dessous reste VERBATIM (references `state.*`)
  if (!state.layers.length) throw new Error('Définis au moins une couche de sol (onglet Sol).');
  if (!state.rafts.length) throw new Error('Aucune plaque dans le modèle.');
  const layers = state.layers.slice().sort((p, q) => q.zBase - p.zBase);
  const deepest = Math.abs(layers[layers.length - 1].zBase);
  let z0 = Math.max(0, o.foundD || 0);
  if (z0 >= deepest - 1e-6) z0 = Math.max(0, deepest - 0.5);
  // maille TOUTES les plaques (matériaux propres à chaque plaque, repli sur l'UI) ; couplage par le sol
  const P = [],
    tris = [],
    triMat = [];
  let off = 0,
    nRaft = 0;
  for (const rf of state.rafts) {
    const poly = rf.pts.map((pt) => [pt.x, pt.y]);
    if (poly.length < 3) continue;
    const m = meshPoly(poly, o.target);
    for (const pt of m.P) P.push(pt);
    for (const t of m.tris) {
      tris.push([t[0] + off, t[1] + off, t[2] + off]);
      triMat.push({ E: rf.E || o.E, nu: rf.nu != null ? rf.nu : o.nu, e: rf.e || o.e });
    }
    off += m.P.length;
    nRaft++;
  }
  const N = P.length,
    dof = 3 * N;
  if (N < 3) throw new Error('Plaque(s) invalide(s).');
  if (N > 1200) throw new Error('Maillage trop fin (' + N + ' nœuds) — augmente la taille cible.');
  const K = Array.from({ length: dof }, () => new Float64Array(dof));
  const F = new Float64Array(dof);
  const Anode = new Float64Array(N);
  tris.forEach((tr, ti) => {
    const mt = triMat[ti];
    const { Ke, A } = dktKe([P[tr[0]], P[tr[1]], P[tr[2]]], mt.E, mt.e, mt.nu);
    const aA = Math.abs(A);
    const map = [];
    for (const n of tr) {
      map.push(3 * n, 3 * n + 1, 3 * n + 2);
      Anode[n] += aA / 3;
    }
    for (let a = 0; a < 9; a++) {
      if (a % 3 === 0 && o.q) F[map[a]] += (o.q * aA) / 3;
      for (let b = 0; b < 9; b++) K[map[a]][map[b]] += Ke[a][b];
    }
  });
  // charges du modèle réparties barycentriquement (effort vertical uniquement) — sur l'ensemble des plaques
  const tgt = o.target;
  for (const pl of state.pointLoads) _distribTri(P, tris, F, pl.x, pl.y, pl.Fz || 0);
  for (const ll of state.lineLoads) {
    const len = Math.hypot(ll.x2 - ll.x1, ll.y2 - ll.y1);
    if (len <= 1e-9) continue;
    const ns = Math.max(2, Math.ceil(len / Math.sqrt(tgt)));
    const dl = len / ns;
    for (let s = 0; s < ns; s++) {
      const tt = (s + 0.5) / ns;
      _distribTri(P, tris, F, ll.x1 + (ll.x2 - ll.x1) * tt, ll.y1 + (ll.y2 - ll.y1) * tt, (ll.q || 0) * dl);
    }
  }
  for (const al of state.areaLoads) {
    if (al.on === 'soil') continue;
    const ax = Math.abs(al.x2 - al.x1),
      ay = Math.abs(al.y2 - al.y1);
    if (ax < 1e-9 || ay < 1e-9) continue;
    const nx = Math.max(2, Math.ceil(ax / Math.sqrt(tgt))),
      ny = Math.max(2, Math.ceil(ay / Math.sqrt(tgt)));
    const da = (ax * ay) / (nx * ny);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const xx = al.x1 + (al.x2 - al.x1) * (i + 0.5) / nx,
          yy = al.y1 + (al.y2 - al.y1) * (j + 0.5) / ny;
        _distribTri(P, tris, F, xx, yy, (al.q || 0) * da);
      }
  }
  const C = Array.from({ length: N }, () => new Float64Array(N));
  for (let j = 0; j < N; j++) {
    const s = Math.sqrt(Anode[j]);
    const x1 = P[j][0] - s / 2,
      x2 = P[j][0] + s / 2,
      y1 = P[j][1] - s / 2,
      y2 = P[j][1] + s / 2;
    for (let i = 0; i < N; i++) C[i][j] = rectSettle(P[i][0], P[i][1], x1, y1, x2, y2, layers, z0);
  }
  const totalLoad = F.reduce((s, v, k) => (k % 3 === 0 ? s + v : s), 0);
  const Cinv = inv(C.map((r) => Array.from(r)));
  const Asys = K.map((r) => Float64Array.from(r));
  const rhs = Float64Array.from(F);
  for (let a = 0; a < N; a++) {
    const ia = 3 * a,
      Aa = Anode[a];
    for (let b = 0; b < N; b++) Asys[ia][3 * b] += Aa * Cinv[a][b];
  }
  const u = solveDense(Asys, rhs);
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = u[3 * i];
  const p = new Float64Array(N);
  for (let a = 0; a < N; a++) {
    let s = 0;
    for (let b = 0; b < N; b++) s += Cinv[a][b] * w[b];
    p[a] = s;
  }
  const sumReact = p.reduce((s, v, i) => s + v * Anode[i], 0);
  let wMax = -1e9,
    wMin = 1e9,
    pMax = -1e9;
  for (let i = 0; i < N; i++) {
    if (w[i] > wMax) wMax = w[i];
    if (w[i] < wMin) wMin = w[i];
    if (p[i] > pMax) pMax = p[i];
  }
  return { P, tris, w, p, N, nt: tris.length, nRaft, totalLoad, sumReact, wMax, wMin, pMax, z0 };
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule la reponse d'un radier maille en TRIANGLES (DKT) sur sol multicouche
 * elastique a partir d'un ETAT complet et d'OPTIONS (pas de DOM, pas de globale).
 *   - `state` : { rafts, pointLoads, lineLoads, areaLoads, layers } (cf. contract.ts) ;
 *   - `opts`  : options de calcul (target [aire cible du triangle, m²], e [ep. m],
 *     E, nu, q [charge repartie kPa], foundD [cote d'assise m]).
 *
 * Renvoie l'objet de RESULTAT BRUT `R` (identique a ce que le handler `tri-run` du HTML
 * affecte), OU `{ err }` si une garde du moteur rejette l'entree (aucune couche, aucune
 * plaque, plaque invalide N<3, maillage trop fin N>1200) OU si la science leve. La
 * PROJECTION client-safe est faite par le dispatch (index.ts, hors de ce fichier).
 */
export function computeTriRaft(state, opts) {
  try {
    return solveTriRaft(state || {}, opts || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
