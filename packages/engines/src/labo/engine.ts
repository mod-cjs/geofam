/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur. Le TYPAGE STRICT vit a la frontiere (contract.ts/index.ts).
/**
 * MOTEUR FASTLAB — traitement des essais de laboratoire & classification GTR
 * (NF P 11-300).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/FASTLAB7.html — title « FASTLAB »). On NE
 * reordonne RIEN, on NE corrige RIEN : l'arbitre est l'equivalence-PORTAGE (module ==
 * HTML, rel 1e-9 + egalite stricte des libelles).
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'a PAS de `compute()` unique : c'est une SUITE de calculateurs de labo
 * INDEPENDANTS (`calcW`, `calcGranulo`, `calcAtt`, `calcVbs`, `calcRhos`,
 * `calcProctor`, `calcCbr`, `calcCisail`, `calcDens`, `calcOedo`, `calcUcs`,
 * `calcTriUU`, `calcTriCU`, `calcPerm`, `calcEs`, `calcLa`, `calcSZ`, `calcMde`,
 * `calcRho`, `calcSulf`) qui lisent le DOM via `num('id')`, ECRIVENT dans une GLOBALE
 * `D={}`, et RENDENT du DOM/canvas. `recalc()` lance tous les calc PUIS `classify()`
 * (arbre GTR A/B/C/D + R + etat hydrique) qui lit `D` + les seuils `CFG` + l'etat
 * force + la famille geologique.
 *
 * On EXTRAIT ici chaque kernel en fonction PURE qui ECRIT dans un `D` LOCAL en lisant
 * un `state` injecte (au lieu du DOM) : `num(state, id)` lit `state[id]`. Tout le
 * rendu (`$(...).textContent`, `chip`, `setv`, `draw*`, `toast`/setTimeout) est
 * RETIRE (presentation, aucun effet sur `D` ni la classe). `recalc()` est extrait en
 * `computeLaboCore(state)` : memes appels, meme ordre (l'ordre IMPORTE — CBR lit
 * `D.rdmax`/`D.wopn` produits par Proctor). Aucun acces DOM, aucune horloge, aucun
 * hasard.
 *
 * --- DETERMINISME ---
 * Les kernels et `classify` ne contiennent NI horloge NI hasard NI iteration d'objet
 * a ordre instable. Le seul `setTimeout` du HTML est dans `toast` (presentation) ;
 * non transcrit. `Date` n'apparait que dans le rendu PV/DB (hors calcul). Module sans
 * horloge/hasard/for..in (test anti-non-determinisme vert).
 *
 * --- CONFIDENTIALITE (DoD §8) ---
 * Les RESULTATS de labo (granulo, Atterberg, VBS, Proctor, CBR, etc.) et la CLASSE
 * GTR sont le LIVRABLE de l'essai, PAS une methode confidentielle : tout est
 * client-safe. On whiteliste neanmoins la sortie (`.strict()`) + redaction fail-closed
 * par COHERENCE avec les autres moteurs (defense en profondeur).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#49-53) ---
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
export const LABO_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// CONSTANTES & SEUILS (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

const DEFAULTS = {
  routeD: true,
  A_fines: 35,
  A_ip: [12, 25, 40],
  A_vbs: [2.5, 6, 8],
  B_p2: 70,
  B_fines: 12,
  B_vbs01: 0.1,
  B_vbs56: 1.5,
  C_dmax: 50,
  D_fines: 12,
  D_vbs: 0.1,
  st: [0.7, 0.9, 1.1, 1.3],
  FR: 7,
  DG: 5,
};

const SIEVES = [
  100, 80, 63, 50, 40, 31.5, 20, 16, 10, 8, 6.3, 5, 4, 2, 1, 0.5, 0.2, 0.08,
];
const SZS = [8, 5, 2, 0.63, 0.2];

const DESC = {
  A1: 'Limons peu plastiques, loess, sables fins argileux, arènes',
  A2: 'Sables fins argileux, limons, argiles peu plastiques',
  A3: 'Argiles et argiles marneuses, limons très plastiques',
  A4: 'Argiles très plastiques',
  B1: 'Sables silteux',
  B2: 'Sables argileux (peu argileux)',
  B3: 'Graves silteuses',
  B4: 'Graves argileuses (peu argileuses)',
  B5: 'Sables et graves très silteux',
  B6: 'Sables et graves argileux à très argileux',
  D1: "Sables propres insensibles à l'eau",
  D2: "Graves propres insensibles à l'eau",
  D3: 'Matériaux grossiers insensibles',
  C1: 'Gros éléments — comportement régi par le squelette',
  C2: 'Gros éléments — comportement régi par la fraction 0/50',
};

/* Dimensions nominales internes (cm) — EN 13286-2 */
const MOULES = { A: [10.16, 11.64], B: [15.2, 11.64], C: [25.0, 20.0] };
/* Procedure normative EN 13286-2 Tableau 5 */
const PRPROC = {
  n_A: { m: 2.5, h: 305, L: 3, N: 25, E: 0.6 },
  n_B: { m: 2.5, h: 305, L: 3, N: 56, E: 0.6 },
  n_C: { m: 15.0, h: 600, L: 3, N: 22, E: 0.6 },
  m45_A: { m: 4.5, h: 457, L: 5, N: 25, E: 2.7 },
  m45_B: { m: 4.5, h: 457, L: 5, N: 56, E: 2.7 },
  m15_C: { m: 15.0, h: 600, L: 3, N: 98, E: 2.7 },
};
const CBR_MOULDS = [55, 25, 10];
const CBR_ENF = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
const MDE_CLASS = {
  '10/14': {
    charge: 5000,
    M: 500,
    eau: 2.5,
    tours: 12000,
    ti: 11.2,
    lo: 30,
    hi: 40,
    alt2: [12.5, 60, 70],
  },
  '4/6.3': { charge: 2000, M: 500, eau: 2.5, tours: 12000, ti: 5, lo: 30, hi: 40 },
  '4/8': { charge: 2800, M: 500, eau: 2.5, tours: 12000, ti: 6.3, lo: 60, hi: 70 },
  '6.3/10': { charge: 4000, M: 500, eau: 2.5, tours: 12000, ti: 8, lo: 30, hi: 40 },
  '8/11.2': { charge: 4400, M: 500, eau: 2.5, tours: 12000, ti: 10, lo: 60, hi: 70 },
  '11.2/16': { charge: 5400, M: 500, eau: 2.5, tours: 12000, ti: 14, lo: 60, hi: 70 },
  '31.5/50': { charge: 0, M: 10000, eau: 2.0, tours: 14000, ti: null },
};

// ===========================================================================
// HELPERS (HTML d'origine — adaptes a la lecture d'un `state` injecte)
// ===========================================================================

// num(state,id) : lit state[id] (au lieu de num('id') sur le DOM). Meme semantique :
// parseFloat avec virgule->point ; null si absent/NaN. (Le HTML : num=id=>parseFloat(
// ($(id).value||'').replace(',','.')) ; isNaN?null:v.)
function makeNum(state) {
  return (id) => {
    const raw = state[id];
    if (raw === undefined || raw === null || raw === '') return null;
    const v = parseFloat(String(raw).replace(',', '.'));
    return isNaN(v) ? null : v;
  };
}
// chk(state,id) : equivalent de `$(id).checked` (cases a cocher : pl_np, cfg_routeD).
function makeChk(state) {
  return (id) => state[id] === true || state[id] === 'true' || state[id] === 1;
}
const wcalc = (t, h, s) =>
  t != null && h != null && s != null && s - t > 0 ? ((h - s) / (s - t)) * 100 : null;
function lreg(pts) {
  let n = pts.length;
  if (n < 2) return null;
  let Sx = 0,
    Sy = 0,
    Sxy = 0,
    Sxx = 0;
  for (const [x, y] of pts) {
    Sx += x;
    Sy += y;
    Sxy += x * y;
    Sxx += x * x;
  }
  const den = n * Sxx - Sx * Sx;
  if (Math.abs(den) < 1e-9) return null;
  const a = (n * Sxy - Sx * Sy) / den,
    b = (Sy - a * Sx) / n;
  return { a, b };
}
function rsq(pts, reg) {
  if (!reg || pts.length < 2) return null;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let ss = 0,
    sr = 0;
  for (const [x, y] of pts) {
    const yp = reg.a * x + reg.b;
    ss += (y - my) * (y - my);
    sr += (y - yp) * (y - yp);
  }
  return ss > 0 ? 1 - sr / ss : null;
}

// ===========================================================================
// KERNELS DE CALCUL (HTML d'origine — math VERBATIM, rendu/DOM RETIRE)
// ===========================================================================
// Chaque kernel recoit (state, D, num, chk, modes) et ECRIT dans D, comme l'original.
// Les lignes `$(...).textContent=...`, `chip(...)`, `setv(...)`, `draw*(...)`,
// `$(...).innerHTML=...` (PRESENTATION) sont OMISES : aucun effet sur D.

function calcW(state, D, num) {
  let s = 0,
    n = 0;
  for (let i = 1; i <= 3; i++) {
    const w = wcalc(num('w_t' + i), num('w_h' + i), num('w_s' + i));
    if (w != null) {
      s += w;
      n++;
    }
  }
  D.wn = n ? s / n : null;
}

function granuloPts(state, num) {
  const M = num('gr_M');
  const pts = [];
  let cum = 0;
  for (const sv of SIEVES) {
    const rp = num('gr_' + String(sv).replace('.', '_'));
    if (M && rp != null) {
      cum += rp;
      const pass = 100 - (cum / M) * 100;
      pts.push([sv, Math.max(0, pass)]);
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}
function interpP(pts, size) {
  if (!pts.length) return null;
  const ex = pts.find((p) => Math.abs(p[0] - size) < 1e-9);
  if (ex) return ex[1];
  let lo = null,
    hi = null;
  for (const p of pts) {
    if (p[0] <= size) lo = p;
    if (p[0] >= size && !hi) hi = p;
  }
  if (lo && hi && lo !== hi) {
    const t =
      (Math.log10(size) - Math.log10(lo[0])) / (Math.log10(hi[0]) - Math.log10(lo[0]));
    return lo[1] + t * (hi[1] - lo[1]);
  }
  return null;
}
function dAt(pts, pass) {
  if (pts.length < 2) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if ((a[1] <= pass && b[1] >= pass) || (a[1] >= pass && b[1] <= pass)) {
      if (b[1] === a[1]) return a[0];
      const t = (pass - a[1]) / (b[1] - a[1]);
      return Math.pow(10, Math.log10(a[0]) + t * (Math.log10(b[0]) - Math.log10(a[0])));
    }
  }
  return null;
}
function calcGranulo(state, D, num) {
  const pts = granuloPts(state, num);
  D.granPts = pts;
  D.p80 = interpP(pts, 0.08);
  D.p2 = interpP(pts, 2);
  let dmax = null;
  for (const p of pts) {
    if (p[1] >= 99.5) {
      dmax = p[0];
      break;
    }
  }
  if (dmax == null && pts.length) dmax = pts[pts.length - 1][0];
  D.dmax = dmax;
  const d10 = dAt(pts, 10),
    d30 = dAt(pts, 30),
    d60 = dAt(pts, 60);
  D.Cu = d10 && d60 ? d60 / d10 : null;
  D.Cc = d10 && d30 && d60 ? (d30 * d30) / (d10 * d60) : null;
  // Module de finesse (NF P 18-540) — sables uniquement.
  const MFS = [0.16, 0.315, 0.63, 1.25, 2.5, 5];
  let mf = null;
  const sableux = D.p80 != null && D.p80 <= 12 && dmax != null && dmax <= 8;
  if (sableux && pts.length > 1) {
    let s = 0,
      ok = true;
    const maxSize = pts[pts.length - 1][0];
    for (const tsz of MFS) {
      let pa = interpP(pts, tsz);
      if (pa == null) {
        if (tsz > maxSize) pa = 100;
        else {
          ok = false;
          break;
        }
      }
      s += 100 - pa;
    }
    if (ok) mf = s / 100;
  }
  D.mf = mf;
  D.mfq = mf == null ? null : mf <= 2.2 ? 'très fin' : mf <= 2.8 ? 'idéal' : 'grossier';
}

function calcAtt(state, D, num, chk) {
  const pts = [],
    raw = [];
  for (let i = 1; i <= 5; i++) {
    const N = num('ll_x' + i),
      w = wcalc(num('ll_t' + i), num('ll_h' + i), num('ll_s' + i));
    if (N != null && w != null && N > 0) {
      pts.push([Math.log10(N), w]);
      raw.push([N, w]);
    }
  }
  const reg = lreg(pts);
  let wLraw = null;
  if (reg) wLraw = reg.a * Math.log10(25) + reg.b;
  const wL = wLraw != null ? Math.round(wLraw) : null; // arrondi entier (§6.1)
  D.wl = wL;
  D.wl_raw = wLraw;
  // plasticite (rouleau Ø3 mm, 2 determinations)
  let wp = [],
    np = chk('pl_np');
  for (let i = 1; i <= 2; i++) {
    const w = wcalc(num('pl_t' + i), num('pl_h' + i), num('pl_s' + i));
    if (w != null) wp.push(w);
  }
  let wPmean = wp.length ? wp.reduce((a, b) => a + b, 0) / wp.length : null;
  let wP = np ? null : wPmean != null ? Math.round(wPmean) : null; // arrondi entier (§6.2)
  D.wp = wP;
  let ip = wL != null && wP != null ? wL - wP : null;
  if (np) ip = null;
  D.ip = ip;
  // indice de consistance Ic = (wL - w)/Ip
  let ic = ip != null && ip > 0 && D.wn != null ? (wL - D.wn) / ip : null;
  D.ic = ic;
}

function calcVbs(state, D, num) {
  const C = num('v_conc') || 10;
  const vsol = [];
  for (let i = 1; i <= 2; i++) {
    const prise = num('v_prise' + i),
      frac = num('v_frac' + i),
      w = num('v_w' + i),
      V = num('v_V' + i);
    const M1 = prise != null ? prise / (1 + (w || 0) / 100) : null;
    const Mb = V != null ? (V * C) / 1000 : null;
    const v05 = Mb != null && M1 ? (Mb / M1) * 100 : null;
    const vs = v05 != null ? v05 * ((frac != null ? frac : 100) / 100) : null;
    if (vs != null) vsol.push(vs);
  }
  const moy = vsol.length ? vsol.reduce((a, b) => a + b, 0) / vsol.length : null;
  const man = num('v_manual');
  const vbs = man != null ? man : moy != null ? +moy.toFixed(2) : null;
  D.vbs = vbs;
}

function rhoWaterT(T) {
  return T == null ? null : 1 / (1 + (Math.pow(2.31 * T - 2, 2) - 182) * 1e-6);
}
function calcRhos(state, D, num, modes) {
  const T = num('rs_T'),
    liq = state['rs_liq'] || 'water';
  const rwT = rhoWaterT(T);
  let rL = num('rs_rL');
  if (liq === 'water') {
    rL = rwT;
  }
  const rLeff = rL != null ? rL : rwT || 0.998;
  const vals = [];
  for (let i = 1; i <= 3; i++) {
    const m0 = num('rs2_m0_' + i),
      m1 = num('rs2_m1_' + i),
      mx = num('rs2_mx_' + i),
      m3 = num('rs2_m3_' + i);
    let md = null,
      m2 = null,
      rs = null;
    if (m0 != null && mx != null) {
      if (modes.rsMethod === 'B') {
        md = mx;
        m2 = mx + m0;
      } else {
        m2 = mx;
        md = mx - m0;
      }
    }
    if (md != null && m1 != null && m2 != null && m3 != null) {
      const den = m1 - m0 - (m3 - m2);
      if (md > 0 && den > 0) {
        rs = (rLeff * md) / den;
        vals.push(rs);
      }
    }
  }
  let mean = null;
  if (vals.length) mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  D.rhos = mean == null ? null : +mean.toFixed(2);
}

function fitPar(pts) {
  if (pts.length < 3) return null;
  let n = pts.length,
    Sx = 0,
    Sx2 = 0,
    Sx3 = 0,
    Sx4 = 0,
    Sy = 0,
    Sxy = 0,
    Sx2y = 0;
  for (const [x, y] of pts) {
    Sx += x;
    Sx2 += x * x;
    Sx3 += x ** 3;
    Sx4 += x ** 4;
    Sy += y;
    Sxy += x * y;
    Sx2y += x * x * y;
  }
  const A = [
      [Sx4, Sx3, Sx2],
      [Sx3, Sx2, Sx],
      [Sx2, Sx, n],
    ],
    B = [Sx2y, Sxy, Sy];
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const Dt = det(A);
  if (Math.abs(Dt) < 1e-9) return null;
  const rep = (c) => {
    const m = A.map((r) => r.slice());
    for (let i = 0; i < 3; i++) m[i][c] = B[i];
    return det(m) / Dt;
  };
  const a = rep(0),
    b = rep(1),
    c = rep(2);
  if (a >= 0) return null;
  return { a, b, c, wopn: -b / (2 * a), rdmax: c - (b * b) / (4 * a) };
}
function calcProctor(state, D, num, modes) {
  // setMould() du HTML : si pr_d/pr_hh absents, writeForm les derive de MOULES[pr_mould]
  // (`if(!o||!o.pr_d)setMould()` -> setv pr_d/pr_hh = MOULES[mould]). On reproduit ce
  // defaut ICI pour la fidelite du chemin UI : un echantillon ne saisit que pr_mould.
  let d = num('pr_d'),
    h = num('pr_hh');
  if (d == null || h == null) {
    const mould = state['pr_mould'] || 'A';
    const dims = MOULES[mould];
    if (dims) {
      if (d == null) d = dims[0];
      if (h == null) h = dims[1];
    }
  }
  let V = null;
  if (d && h) V = (Math.PI / 4) * d * d * h;
  const pts = [];
  for (let i = 1; i <= 7; i++) {
    const mh = num('pr_mh' + i),
      w = wcalc(num('pr_t' + i), num('pr_h' + i), num('pr_s' + i));
    let rd = null;
    if (mh != null && w != null && V) {
      rd = mh / V / (1 + w / 100);
      pts.push([w, rd]);
    }
  }
  const fit = fitPar(pts);
  let wopn = null,
    rdmax = null;
  if (fit) {
    wopn = fit.wopn;
    rdmax = fit.rdmax;
  } else if (pts.length) {
    let best = pts[0];
    for (const p of pts) if (p[1] > best[1]) best = p;
    wopn = best[0];
    rdmax = best[1];
  }
  D.wopn = wopn;
  D.rdmax = rdmax;
}

function calcCbr(state, D, num, modes) {
  // reference OPM (auto depuis Proctor si vide)
  let ydmax = num('cb_ydmax');
  if (ydmax == null) ydmax = D.rdmax;
  let wopt = num('cb_wopt');
  if (wopt == null) wopt = D.wopn;
  const cible = num('cb_cible') || 95;
  const Fr25 = num('cb_s25') || 13.35,
    Fr5 = num('cb_s5') || 20,
    K = num('cb_K') || 1;
  const i25 = CBR_ENF.indexOf(2.5),
    i5 = CBR_ENF.indexOf(5);
  const pts = [];
  const moulds = [];
  for (let m = 0; m < 3; m++) {
    const tot = num('cb_tot' + m),
      moule = num('cb_moule' + m),
      vol = num('cb_vol' + m),
      w = num('cb_w' + m);
    let net = null,
      dh = null,
      ds = null,
      comp = null;
    if (tot != null && moule != null) net = tot - moule;
    if (net != null && vol) dh = net / vol;
    if (dh != null && w != null) ds = dh / (1 + w / 100);
    if (ds != null && ydmax) comp = (ds / ydmax) * 100;
    // gonflement
    const H0 = num('cb_H0' + m),
      g = num('cb_gonf' + m);
    let gp = null;
    if (g != null && H0 && H0 > 0) gp = (g / H0) * 100;
    // poinconnement -> CBR
    const f25 = num('cb_pen_' + m + '_' + i25),
      f5 = num('cb_pen_' + m + '_' + i5);
    const c25 = f25 != null ? ((f25 * K) / Fr25) * 100 : null,
      c5 = f5 != null ? ((f5 * K) / Fr5) * 100 : null;
    let maxi = null;
    if (c25 != null || c5 != null) maxi = Math.max(c25 || 0, c5 || 0);
    moulds.push({ coups: CBR_MOULDS[m], comp, maxi, c25, c5, gp });
    if (comp != null && maxi != null) pts.push([comp, maxi]);
  }
  let icbr = null;
  const reg = lreg(pts);
  if (reg) icbr = reg.a * cible + reg.b;
  else if (pts.length === 1) icbr = pts[0][1];
  if (icbr != null && icbr < 0) icbr = 0;
  D.cbr = icbr == null ? null : +icbr.toFixed(1);
  D.cbrType = modes.cbType;
  let gmax = null;
  moulds.forEach((o) => {
    if (o.gp != null) gmax = Math.max(gmax == null ? -1 : gmax, o.gp);
  });
  D.gonfl = modes.cbType === 'cbr' ? gmax : null;
}

function calcCisail(state, D, num, modes) {
  const box = modes.ciMethod === 'box';
  let A_m2 = null;
  if (box) {
    const dim = num('ci_dim');
    if (dim) {
      const shp = state['ci_shape'] || 'sq';
      A_m2 = (shp === 'sq' ? dim * dim : (Math.PI / 4) * dim * dim) * 1e-6;
    }
  } else {
    const Ra2 = num('ci_Ra'),
      Ri2 = num('ci_Ri');
    if (Ra2 && Ri2 != null && Ra2 > Ri2) {
      A_m2 = Math.PI * (Ra2 * Ra2 - Ri2 * Ri2) * 1e-6;
    }
  }
  const Ra = num('ci_Ra'),
    Ri = num('ci_Ri');
  const ptsP = [],
    ptsR = [];
  for (let i = 1; i <= 4; i++) {
    const N = num('ci_N' + i),
      P = num('ci_P' + i),
      R = num('ci_R' + i);
    let sv = null,
      tp = null,
      tr = null;
    if (N != null && A_m2) {
      sv = (N * 1000) / A_m2 / 1000;
    }
    if (box) {
      if (P != null && A_m2) tp = (P * 1000) / A_m2 / 1000;
      if (R != null && A_m2) tr = (R * 1000) / A_m2 / 1000;
    } else if (Ra && Ri != null && Ra > Ri) {
      const denom = 2 * Math.PI * (Math.pow(Ra / 1000, 3) - Math.pow(Ri / 1000, 3));
      if (P != null) tp = (3 * P) / denom / 1000;
      if (R != null) tr = (3 * R) / denom / 1000;
    }
    if (sv != null && tp != null) ptsP.push([sv, tp]);
    if (sv != null && tr != null) ptsR.push([sv, tr]);
  }
  const regP = lreg(ptsP),
    regR = lreg(ptsR);
  let phi = null,
    c = null,
    phiR = null;
  if (regP && regP.a > 0) {
    phi = (Math.atan(regP.a) * 180) / Math.PI;
    c = Math.max(0, regP.b);
  }
  if (regR && regR.a > 0) {
    phiR = (Math.atan(regR.a) * 180) / Math.PI;
  }
  D.phi_cis = phi;
  D.c_cis = c;
  D.phiR_cis = phiR;
}

function calcDens(state, D, num, modes) {
  let V = null,
    m = null;
  if (modes.densMethod === 'lin') {
    if (modes.densShape === 'prism') {
      const L = num('d_L'),
        Wd = num('d_W'),
        Hd = num('d_H');
      m = num('d_m');
      if (L && Wd && Hd) V = L * Wd * Hd * 1e-9;
    } else {
      const d = num('d_d'),
        L = num('d_Lc');
      m = num('d_mc');
      if (d && L) V = (Math.PI / 4) * d * d * L * 1e-9;
    }
  } else if (modes.densMethod === 'imm') {
    m = num('di_m');
    const mf = num('di_mf'),
      mc = num('di_mc'),
      mg = num('di_mg'),
      rfl = num('di_rfl') || 0.998,
      rp = num('di_rp') || 0.9;
    if (mc != null && mg != null) {
      const t1 = (mc - mg) / rfl,
        t2 = mf != null && mc != null ? (mc - mf) / rp : 0;
      V = (t1 - t2) * 1e-6;
    }
  } else {
    m = num('dd_m');
    const mf = num('dd_mf'),
      mc = num('dd_mc'),
      m1 = num('dd_m1'),
      m2 = num('dd_m2'),
      rfl = num('dd_rfl') || 0.998,
      rp = num('dd_rp') || 0.9;
    if (m1 != null && m2 != null) {
      const t1 = (m2 - m1) / rfl,
        t2 = mf != null && mc != null ? (mc - mf) / rp : 0;
      V = (t1 - t2) * 1e-6;
    }
  }
  let rho = null,
    rhod = null;
  if (m != null && V && V > 0) rho = (m / V) * 1e-6;
  const w = num('d_w') != null ? num('d_w') : D.wn;
  if (rho != null && w != null) rhod = rho / (1 + w / 100);
  D.rho_app = rho;
  D.rhod_app = rhod;
}

function calcOedo(state, D, num) {
  const H0 = num('oe_H0'),
    Dia = num('oe_D'),
    md = num('oe_md'),
    rs = num('oe_rs'),
    e0man = num('oe_e0');
  const A = Dia ? (Math.PI * Dia * Dia) / 4 : null;
  const rd = md && A && H0 ? (md / (A * H0)) * 1000 : null;
  const Hs = md && rs && A ? (md / (rs * A)) * 1000 : null;
  const e0calc = Hs && H0 ? (H0 - Hs) / Hs : null;
  const e0 = e0calc != null ? e0calc : e0man;
  const rows = [];
  for (let i = 1; i <= 12; i++) {
    const s = num('oe_s' + i),
      dh = num('oe_dh' + i);
    let Hf = null,
      ev = null,
      e = null;
    if (s != null && dh != null && H0) {
      Hf = H0 - dh;
      ev = (dh / H0) * 100;
      if (Hs != null) e = (Hf - Hs) / Hs;
      else if (e0 != null) e = e0 - ((1 + e0) * dh) / H0;
      if (e != null) rows.push([s, e]);
    }
  }
  let Cc = null,
    Cs = null;
  const csVals = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (b[0] > a[0] && a[0] > 0) {
      const sl = (a[1] - b[1]) / Math.log10(b[0] / a[0]);
      if (sl > 0 && (Cc == null || sl > Cc)) Cc = sl;
    } else if (b[0] < a[0] && b[0] > 0) {
      const sl = (b[1] - a[1]) / Math.log10(a[0] / b[0]);
      if (sl > 0) csVals.push(sl);
    }
  }
  if (csVals.length) Cs = csVals.reduce((x, y) => x + y, 0) / csVals.length;
  D.Cc_oedo = Cc;
  D.Cs_oedo = Cs;
  D.e0_oedo = e0;
}

function calcUcs(state, D, num) {
  const d = num('uc_d'),
    h = num('uc_h'),
    F = num('uc_f'),
    dl = num('uc_dl');
  let qu = null;
  if (d && h && F != null) {
    const A0 = (Math.PI * d * d) / 4;
    const eps = dl != null ? dl / h : 0;
    const Ac = A0 / (1 - eps);
    qu = (F * 1000) / Ac;
  }
  D.qu = qu;
}

function calcTriUU(state, D, num) {
  let s = 0,
    n = 0;
  for (let i = 1; i <= 3; i++) {
    const s3 = num('tu_s3_' + i),
      df = num('tu_df_' + i);
    let cu = null;
    if (s3 != null && df != null) {
      cu = df / 2;
      s += cu;
      n++;
    }
  }
  D.cu_uu = n ? s / n : null;
}

function calcTriCU(state, D, num) {
  const pts = [];
  for (let i = 1; i <= 3; i++) {
    const s3 = num('tc_s3_' + i),
      s1 = num('tc_s1_' + i);
    if (s3 != null && s1 != null) {
      const sMid = (s1 + s3) / 2,
        t = (s1 - s3) / 2;
      pts.push([sMid, t]);
    }
  }
  let phi = null,
    c = null;
  const reg = lreg(pts);
  if (reg && Math.abs(reg.a) < 1) {
    phi = (Math.asin(reg.a) * 180) / Math.PI;
    c = reg.b / Math.cos(Math.asin(reg.a));
  }
  D.phi = phi;
  D.c = c;
}

function calcPerm(state, D, num, modes) {
  let k = null;
  if (modes.permMode === 'const') {
    const V = num('pe_V'),
      L = num('pe_L'),
      A = num('pe_A'),
      dh = num('pe_dh'),
      t = num('pe_t');
    if (V && L && A && dh && t) k = (V * L) / (A * dh * t);
  } else {
    const a = num('pe_a'),
      L = num('pe_Lv'),
      A = num('pe_Av'),
      t = num('pe_tv'),
      h1 = num('pe_h1'),
      h2 = num('pe_h2');
    if (a && L && A && t && h1 && h2 && h2 > 0)
      k = ((a * L) / (A * t)) * Math.log(h1 / h2);
  }
  D.k = k;
}

function calcEs(state, D, num) {
  let s = 0,
    n = 0;
  for (let i = 1; i <= 2; i++) {
    const h1 = num('es_h1_' + i),
      h2 = num('es_h2_' + i);
    if (h1 && h2 != null && h1 > 0) {
      const se = (h2 / h1) * 100;
      s += se;
      n++;
    }
  }
  D.es = n ? s / n : null;
}

function calcLa(state, D, num) {
  const M = num('la_M'),
    m = num('la_m');
  let la = null;
  if (M && m != null && M > 0) la = Math.round(((M - m) / M) * 100);
  D.la = la;
}

function calcSZ(state, D, num) {
  const M = num('sz_M');
  let sumPass = 0,
    n = 0;
  for (const sv of SZS) {
    const r = num('sz_' + String(sv).replace('.', '_'));
    if (M && r != null) {
      const pp = 100 - (r / M) * 100;
      sumPass += pp;
      n++;
    }
  }
  let sz = n === 5 ? sumPass / 5 : null;
  D.sz = sz;
}

function mdeClassKey(state, modes) {
  return modes.mdeVar === 'std'
    ? '10/14'
    : modes.mdeVar === 'rb'
      ? '31.5/50'
      : state['mde_class'] || '4/6.3';
}
function calcMde(state, D, num, modes) {
  if (modes.mdeMode === 'camp') {
    calcMdeCamp(state, D, num);
    return;
  }
  const vals = [];
  for (let i = 1; i <= 2; i++) {
    const M = num('md_M' + i),
      m = num('md_m' + i);
    if (M && m != null && M > 0) {
      vals.push(((M - m) / M) * 100);
    }
  }
  const mde = vals.length
    ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    : null;
  D.mde = mde;
}
function calcMdeCamp(state, D, num) {
  const pertes = [];
  for (let i = 0; i < 4; i++) {
    const A = num('mc_A' + i),
      B = num('mc_B' + i);
    let p = A && B != null && A > 0 ? ((A - B) / A) * 100 : null;
    pertes.push(p);
  }
  const mean = (arr) => {
    const v = arr.filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const cmde = mean([pertes[2], pertes[3]]);
  D.mde = cmde != null ? Math.round(cmde) : null;
}

function calcRho(state, D, num) {
  const M1 = num('ra_M1'),
    M2 = num('ra_M2'),
    M3 = num('ra_M3'),
    M4 = num('ra_M4'),
    rw = num('ra_rw') || 0.998;
  let ra = null,
    wa = null;
  const den = M2 != null && M3 != null ? M2 - M3 : null;
  if (M4 && den != null && M4 - den > 0) ra = (rw * M4) / (M4 - den);
  if (M4 && M1 && den != null && M1 - den > 0) {
    wa = (100 * (M1 - M4)) / M4;
  }
  D.wa = wa;
}

function calcSulf(state, D, num) {
  const ba = num('su_ba'),
    M = num('su_M'),
    fac = num('su_f') || 0.343;
  let so3 = null;
  if (ba != null && M) {
    so3 = ((fac * ba) / M) * 100;
  }
  D.so3 = so3;
}

// ===========================================================================
// CLASSIFICATION GTR (HTML d'origine — classify, sous-classes, etat)
// ===========================================================================

function subFine(ip, vbs, CFG) {
  if (ip != null)
    return ip <= CFG.A_ip[0]
      ? 'A1'
      : ip <= CFG.A_ip[1]
        ? 'A2'
        : ip <= CFG.A_ip[2]
          ? 'A3'
          : 'A4';
  if (vbs != null)
    return vbs <= CFG.A_vbs[0]
      ? 'A1'
      : vbs <= CFG.A_vbs[1]
        ? 'A2'
        : vbs <= CFG.A_vbs[2]
          ? 'A3'
          : 'A4';
  return null;
}
function subB(p2, p80, vbs, CFG) {
  if (p80 <= CFG.B_fines) {
    if (p2 > CFG.B_p2) return vbs != null && vbs <= CFG.B_vbs01 ? 'B1' : 'B2';
    return vbs != null && vbs <= CFG.B_vbs01 ? 'B3' : 'B4';
  }
  return vbs != null && vbs <= CFG.B_vbs56 ? 'B5' : 'B6';
}
function stateFromRatio(D, CFG, forcedState) {
  if (forcedState) return { st: forcedState, how: 'forcé' };
  if (D.wn != null && D.wopn) {
    const r = D.wn / D.wopn,
      b = CFG.st;
    const st =
      r <= b[0] ? 'ts' : r <= b[1] ? 's' : r <= b[2] ? 'm' : r <= b[3] ? 'h' : 'th';
    return { st, how: `wn/wOPN = ${r.toFixed(2)}`, r };
  }
  return { st: null, how: null };
}
// `f` du HTML (formatage) utilise dans les chaines de `path`/`warn` : transcrit pour
// reproduire EXACTEMENT les libelles compares en equivalence.
function f(x, d = 1) {
  return x == null || isNaN(x) ? null : (+x).toFixed(d);
}
function classify(state, D, CFG, forcedState) {
  const path = [],
    warn = [];
  let fam = null,
    sub = null,
    code = null,
    desc = '';
  const p = { dmax: D.dmax, p80: D.p80, p2: D.p2, ip: D.ip, vbs: D.vbs };
  if (p.dmax == null) warn.push('Dmax inconnu — complétez la granulométrie.');
  if (p.dmax != null && p.dmax > CFG.C_dmax) {
    fam = 'C';
    path.push(`Dmax = ${p.dmax} mm > ${CFG.C_dmax} mm → famille C.`);
    let s050 = null;
    if (p.vbs != null && p.vbs <= CFG.D_vbs && p.p80 != null && p.p80 <= CFG.D_fines)
      s050 = p.p2 != null && p.p2 > CFG.B_p2 ? 'D1' : 'D2';
    else if (p.p80 != null && p.p80 > CFG.A_fines) s050 = subFine(p.ip, p.vbs, CFG);
    else if (p.p80 != null) s050 = subB(p.p2, p.p80, p.vbs, CFG);
    path.push(
      `Fraction 0/50 reclassée → ${s050 || '?'} (essais à réaliser sur le 0/50).`,
    );
    const c12 = p.p80 != null && p.p80 > CFG.A_fines ? 'C2' : 'C1';
    warn.push(
      "Distinction C1/C2 : heuristique provisoire — à confirmer avec l'abaque GTR.",
    );
    code = c12 + (s050 || '');
    desc = DESC[c12] + (s050 ? ` · 0/50 type ${s050}` : '');
    sub = code;
  } else if (p.dmax != null) {
    if (
      CFG.routeD &&
      p.p80 != null &&
      p.p80 <= CFG.D_fines &&
      p.vbs != null &&
      p.vbs <= CFG.D_vbs
    ) {
      fam = 'D';
      sub = p.p2 != null && p.p2 > CFG.B_p2 ? 'D1' : 'D2';
      path.push(
        `Passant 80µm = ${f(p.p80)} % ≤ ${CFG.D_fines} % et VBS = ${f(p.vbs, 2)} ≤ ${CFG.D_vbs} → insensible → famille D.`,
      );
      path.push(`Passant 2mm = ${f(p.p2)} % → ${sub}.`);
      code = sub;
      desc = DESC[sub];
    } else if (p.p80 != null && p.p80 > CFG.A_fines) {
      fam = 'A';
      sub = subFine(p.ip, p.vbs, CFG);
      path.push(`Passant 80µm = ${f(p.p80)} % > ${CFG.A_fines} % → sol fin → famille A.`);
      if (p.ip != null) path.push(`Ip = ${f(p.ip, 1)} (préférentiel) → ${sub}.`);
      else if (p.vbs != null) path.push(`Ip absent → VBS = ${f(p.vbs, 2)} → ${sub}.`);
      else warn.push('Ni Ip ni VBS : sous-classe A indéterminée.');
      code = sub;
      desc = DESC[sub] || '';
    } else if (p.p80 != null) {
      fam = 'B';
      sub = subB(p.p2, p.p80, p.vbs, CFG);
      path.push(`Passant 80µm = ${f(p.p80)} % ≤ ${CFG.A_fines} % → famille B.`);
      if (p.p80 <= CFG.B_fines)
        path.push(
          `Passant 2mm = ${f(p.p2)} % (${p.p2 > CFG.B_p2 ? 'sables' : 'graves'}), VBS = ${f(p.vbs, 2)} → ${sub}.`,
        );
      else
        path.push(
          `Passant 80µm entre ${CFG.B_fines}–${CFG.A_fines} %, VBS = ${f(p.vbs, 2)} → ${sub}.`,
        );
      code = sub;
      desc = DESC[sub] || '';
      if (p.vbs == null) warn.push('VBS manquante : sous-classe B incertaine.');
    } else warn.push('Passant à 80 µm manquant : famille indéterminée.');
  }
  const stt = stateFromRatio(D, CFG, forcedState);
  let etat = stt.st;
  const stApplies =
    fam === 'A' || (fam === 'B' && /B5|B6/.test(sub || '')) || fam === 'C';
  let full = code;
  if (code && etat && stApplies) {
    full = code + ' ' + etat;
    path.push(`État hydrique ${etat} (${stt.how}) → ${full}.`);
  } else if (code && fam === 'D')
    path.push("Famille D insensible : pas d'indice d'état.");
  let rNote = null;
  const geo = state['m_geo'] || '';
  if (geo) {
    rNote = [`Famille géologique : ${geo}`];
    if (D.la != null) rNote.push('LA=' + D.la);
    if (D.mde != null) rNote.push('MDE=' + D.mde);
  }
  return { fam, code, full: full || code, desc, path, warn, etat, stApplies, rNote };
}

// ===========================================================================
// ENTREE PURE DU MODULE — extraction de recalc() (memes appels, meme ordre)
// ===========================================================================

function computeLaboCore(state) {
  const num = makeNum(state);
  const chk = makeChk(state);
  // Toggles de mode. Defauts = ceux de `writeForm()` du HTML (chemin REEL : un
  // echantillon charge/sauve passe par writeForm, qui impose ces defauts) — NB le
  // `let cbType='ipi'` initial des pills est ECRASE par writeForm `||'cbr'` : le defaut
  // EFFECTIF de cbType est donc 'cbr' (cf. equivalence-portage). Les autres defauts de
  // writeForm coincident avec les pills.
  const modes = {
    forcedState: state['forcedState'] || '',
    permMode: state['permMode'] || 'const',
    laVar: state['laVar'] || 'std',
    mdeVar: state['mdeVar'] || 'std',
    mdeWet: state['mdeWet'] || 'h',
    mdeMode: state['mdeMode'] || 'norme',
    prType: state['prType'] || 'n',
    rsMethod: state['rsMethod'] || 'A',
    cbType: state['cbType'] || 'cbr',
    ciMethod: state['ciMethod'] || 'box',
    densMethod: state['densMethod'] || 'lin',
    densShape: state['densShape'] || 'prism',
  };
  // Seuils CFG : defauts, surchargeables par state.cfg (objet partiel).
  const CFG = { ...DEFAULTS };
  if (state.cfg && typeof state.cfg === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (state.cfg[k] !== undefined) CFG[k] = state.cfg[k];
    }
  }
  const D = {};
  // ORDRE VERBATIM de recalc() — CBR depend de D.rdmax/D.wopn (Proctor avant CBR).
  calcW(state, D, num);
  calcGranulo(state, D, num);
  calcAtt(state, D, num, chk);
  calcVbs(state, D, num);
  calcRhos(state, D, num, modes);
  calcProctor(state, D, num, modes);
  calcCbr(state, D, num, modes);
  calcCisail(state, D, num, modes);
  calcDens(state, D, num, modes);
  calcOedo(state, D, num);
  calcUcs(state, D, num);
  calcTriUU(state, D, num);
  calcTriCU(state, D, num);
  calcPerm(state, D, num, modes);
  calcEs(state, D, num);
  calcLa(state, D, num);
  calcSZ(state, D, num);
  calcMde(state, D, num, modes);
  calcRho(state, D, num);
  calcSulf(state, D, num);
  const cls = classify(state, D, CFG, modes.forcedState);
  return { D, cls };
}

/**
 * Calcule l'ensemble des essais de labo + la classification GTR a partir d'un ETAT
 * complet (pas de DOM). `state` = miroir de `readForm()` du HTML : valeurs des champs
 * `.save` par leur id (string ou nombre) + toggles de mode + `cfg` (seuils
 * surchargeables) + `m_geo` (famille geologique) + `forcedState`.
 *
 * Renvoie `{ D, cls }` BRUT (D = accumulateur de tous les resultats ; cls = objet de
 * classification GTR), OU `{ err }` si la science leve. La PROJECTION client-safe est
 * faite par index.ts.
 */
export function computeLabo(state) {
  try {
    return computeLaboCore(state || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
