/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS ES5 non type (cf. en-tete) : on ne
// type PAS les internes du moteur (cela imposerait de modifier la science pour
// satisfaire noUncheckedIndexedAccess, ce que la consigne #45 interdit). Le
// TYPAGE STRICT vit a la frontiere (contract.ts/index.ts, eux verifies). La
// sortie brute est volontairement opaque puis projetee via le schema strict.
/**
 * MOTEUR terzaghi — Fondations superficielles, NF P 94-261 (CONFIDENTIEL, COTE
 * SERVEUR UNIQUEMENT).
 *
 * --- PROVENANCE & PORTAGE (incrément #45) ---
 * Transcription FIDELE du bloc « ENGINE » du HTML d'origine fourni par le client
 * (STARFIRE) : `03-Moteurs-client/GeoSuite/source/tools/terzaghi_V13.html`,
 * lignes 575->1529 (de `function num(` a `END ENGINE`). Le HTML separe deja
 * proprement le calcul PUR (ce bloc) de l'interface (gardee derriere
 * `if(typeof document!=='undefined')`, NON reprise ici).
 *
 * Regle de portage (cf. methode integrateur-moteurs) : on NE refait PAS la
 * science, on NE reordonne RIEN (sommations couche par couche, moyennes
 * geometriques/harmoniques, tris : ordre PRESERVE bit-a-bit). La seule
 * transformation est la SUPPRESSION du couplage DOM : aucune reference a
 * `document`, `window`, `fetch`, ni a l'horloge/au hasard dans ce module
 * (verifie par grep + temoin de determinisme). L'equivalence module<->HTML est
 * prouvee par le harnais d'equivalence-portage (engine.equivalence.test.ts).
 *
 * --- DETERMINISME ---
 * Le bloc d'origine ne contient AUCUNE source de non-determinisme (l'horloge
 * systeme n'etait sollicitee que dans le rendu de note DOM, hors moteur). Sortie
 * strictement reproductible pour une meme entree.
 *
 * --- CONFIDENTIALITE (DoD §8) ---
 * Ce module EST de la propriete intellectuelle confidentielle : il n'est importe
 * QUE par apps/api (recalcul serveur), JAMAIS par apps/web (garde-fou ESLint +
 * controle de bundle CI). Il embarque ENGINE_BUNDLE_MARKER : si du code moteur
 * fuyait dans un bundle navigateur, la chaine litterale fuirait avec lui et la CI
 * mordrait.
 *
 * --- TYPAGE ---
 * Le bloc d'origine est du JS ES5 non type. On le garde TEL QUEL (eslint-disable
 * en tete) pour ne pas alterer la science par une « modernisation » involontaire.
 * Le TYPAGE STRICT (DTO Input/Output, pas d'any) vit a la FRONTIERE, dans
 * `contract.ts` / `index.ts` : le calcul reste la transcription brute, le contrat
 * borne ce qui entre et ce qui sort.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8). Reference reelle dans le code du
 * module (pas seulement un import inerte) : un tree-shaker pourrait sinon l'eliminer.
 */
export const TERZAGHI_CONFIDENTIAL_MARKER: string = ENGINE_BUNDLE_MARKER;

/* ===================== ENGINE (transcription fidele) ===================== */

function num(v: any) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
  const x = Number(s);
  return Number.isFinite(x) ? x : NaN;
}
function fmt(x: any, d?: any) {
  if (d === undefined) d = 2;
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 / Math.pow(10, d))
    x = 0; /* évite « -0,00 » et les négatifs négligeables */
  return x.toLocaleString('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
function clamp(x: any, a: any, b: any) {
  return Math.min(b, Math.max(a, x));
}

/* ---- profil en escalier : la valeur s'applique de sa profondeur vers le bas ---- */
function parsedSondage(state: any) {
  return state.sondage
    .map(function (r: any) {
      return { z: num(r.z), pl: num(r.pl), em: num(r.em), al: num(r.al), qc: num(r.qc) };
    })
    .filter(function (r: any) {
      return Number.isFinite(r.z);
    })
    .sort(function (a: any, b: any) {
      return a.z - b.z;
    });
}
function valAt(rows: any, key: any, z: any) {
  let v = NaN;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.z <= z + 1e-9 && Number.isFinite(r[key])) v = r[key];
  }
  if (!Number.isFinite(v)) {
    for (let i = 0; i < rows.length; i++) {
      if (Number.isFinite(rows[i][key])) {
        v = rows[i][key];
        break;
      }
    }
  }
  return v;
}
function integ(rows: any, key: any, z1: any, z2: any, f: any) {
  if (!(z2 > z1)) return 0;
  const cuts = [z1, z2];
  for (let i = 0; i < rows.length; i++) {
    const z = rows[i].z;
    if (z > z1 + 1e-9 && z < z2 - 1e-9) cuts.push(z);
  }
  cuts.sort(function (a: any, b: any) {
    return a - b;
  });
  let s = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i],
      b = cuts[i + 1];
    if (b - a < 1e-9) continue;
    s += f(valAt(rows, key, (a + b) / 2)) * (b - a);
  }
  return s;
}
function nodesFor(rows: any, key: any) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][key];
    if (Number.isFinite(v)) out.push({ z: rows[i].z, v: v });
  }
  return out;
}
/* Intégrale de f(valeur) avec f(v) interpolé LINÉAIREMENT entre essais
   (log pl*, pl*, 1/E... linéaires entre points — convention GEOFOND),
   extension constante au-delà du premier / dernier essai. */
function integLin(rows: any, key: any, z1: any, z2: any, f: any) {
  if (!(z2 > z1)) return 0;
  const N = nodesFor(rows, key);
  if (!N.length) return NaN;
  const F = N.map(function (n: any) {
    return f(n.v);
  });
  function g(z: any) {
    if (z <= N[0].z) return F[0];
    if (z >= N[N.length - 1].z) return F[F.length - 1];
    for (let i = 0; i < N.length - 1; i++) {
      if (z >= N[i].z && z <= N[i + 1].z) {
        const k = (z - N[i].z) / (N[i + 1].z - N[i].z);
        return F[i] + k * (F[i + 1] - F[i]);
      }
    }
    return F[F.length - 1];
  }
  const cuts = [z1, z2];
  N.forEach(function (n: any) {
    if (n.z > z1 + 1e-9 && n.z < z2 - 1e-9) cuts.push(n.z);
  });
  cuts.sort(function (a: any, b: any) {
    return a - b;
  });
  let sI = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i],
      b = cuts[i + 1];
    if (b - a < 1e-9) continue;
    sI += ((g(a) + g(b)) / 2) * (b - a);
  }
  return sI;
}
function harmMean(rows: any, key: any, z1: any, z2: any, mode: any) {
  if (mode === 'essais') {
    if (!(z2 > z1)) return NaN;
    const I = integLin(rows, key, z1, z2, function (v: any) {
      return v > 0 ? 1 / v : NaN;
    });
    if (!Number.isFinite(I) || I <= 0) return NaN;
    return (z2 - z1) / I;
  }
  return harmMeanStep(rows, key, z1, z2);
}
function harmMeanStep(rows: any, key: any, z1: any, z2: any) {
  if (!(z2 > z1)) return NaN;
  const I = integ(rows, key, z1, z2, function (v: any) {
    return v > 0 ? 1 / v : NaN;
  });
  if (!Number.isFinite(I) || I <= 0) return NaN;
  return (z2 - z1) / I;
}

/* ---- ple* et De ---- */
/* Résistance de pointe équivalente qce (E.2.2) : moyenne arithmétique de qcc sur hr,
   qcc = qc écrêté à 1,3·qcm (qcm = moyenne de qc sur [D ; D+hr]). MPa. */
function qceCalc(rows: any, zb: any, hr: any, mode: any) {
  if (!(hr > 0)) return NaN;
  const raw =
    mode === 'essais'
      ? integLin(rows, 'qc', zb, zb + hr, function (v: any) {
          return v;
        }) / hr
      : integ(rows, 'qc', zb, zb + hr, function (v: any) {
          return v;
        }) / hr;
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  const cap = 1.3 * raw;
  const I =
    mode === 'essais'
      ? integLin(rows, 'qc', zb, zb + hr, function (v: any) {
          return Math.min(v, cap);
        })
      : integ(rows, 'qc', zb, zb + hr, function (v: any) {
          return Math.min(v, cap);
        });
  if (!Number.isFinite(I)) return NaN;
  return I / hr;
}
/* De pénétrométrique (C.2.2) : (1/qce)·∫ qcc dz de d(=0) à D, qcc écrêté à 1,3·qcm sur [0;D]. */
function deCalcP(rows: any, D: any, qce: any, mode: any) {
  if (!(D > 0) || !(qce > 0)) return 0;
  const z0 = mode === 'essais' ? deStart(rows, mode, D) : 0;
  if (z0 >= D) return 0;
  const raw =
    mode === 'essais'
      ? integLin(rows, 'qc', z0, D, function (v: any) {
          return v;
        }) /
        (D - z0)
      : integ(rows, 'qc', z0, D, function (v: any) {
          return v;
        }) /
        (D - z0);
  const cap = Number.isFinite(raw) && raw > 0 ? 1.3 * raw : Infinity;
  const I =
    mode === 'essais'
      ? integLin(rows, 'qc', z0, D, function (v: any) {
          return Math.min(v, cap);
        })
      : integ(rows, 'qc', z0, D, function (v: any) {
          return Math.min(v, cap);
        });
  return Number.isFinite(I) ? I / qce : 0;
}
function pleStar(rows: any, zb: any, hr: any, mode: any) {
  if (!(hr > 0)) return NaN;
  let okp = true;
  const f = function (v: any) {
    if (!(v > 0)) {
      okp = false;
      return 0;
    }
    return Math.log(v);
  };
  const I =
    mode === 'essais'
      ? integLin(rows, 'pl', zb, zb + hr, f)
      : integ(rows, 'pl', zb, zb + hr, f);
  if (!okp || !Number.isFinite(I)) return NaN;
  return Math.exp(I / hr);
}
function deStart(rows: any, mode: any, D: any) {
  if (mode !== 'essais') return 0;
  for (let i = 0; i < rows.length; i++) {
    if (Number.isFinite(rows[i].pl) && rows[i].pl > 0)
      return Math.max(0, Math.min(rows[i].z, D));
  }
  return 0;
}
function deCalc(rows: any, D: any, ple: any, mode: any) {
  if (!(D > 0) || !(ple > 0)) return 0;
  if (mode === 'essais') {
    const z0 = deStart(rows, mode, D);
    if (z0 >= D) return 0;
    const I = integLin(rows, 'pl', z0, D, function (v: any) {
      return v > 0 ? v : 0;
    });
    return Number.isFinite(I) ? I / ple : 0;
  }
  return (
    integ(rows, 'pl', 0, D, function (v: any) {
      return v > 0 ? v : 0;
    }) / ple
  );
}

/* ---- facteur de portance kp (NF P94-261, tab. annexe D) ---- */
const KP: any = {
  argiles: {
    f: [0.2, 0.02, 1.3, 0.8],
    c: [0.3, 0.02, 1.5, 0.8],
    lib: 'Argiles et limons',
  },
  sables: {
    f: [0.3, 0.05, 2.0, 1.0],
    c: [0.22, 0.18, 5.0, 1.0],
    lib: 'Sables et graves',
  },
  craies: { f: [0.28, 0.22, 2.8, 0.8], c: [0.35, 0.31, 3.0, 0.8], lib: 'Craies' },
  marnes: {
    f: [0.2, 0.2, 3.0, 0.8],
    c: [0.2, 0.3, 3.0, 0.8],
    lib: 'Marnes et marno-calcaires',
  },
  roches: { f: [0.2, 0.2, 3.0, 0.8], c: [0.2, 0.3, 3.0, 0.8], lib: 'Roches altérées' },
};
/* Facteur de portance pénétrométrique kc (tableau E.2.3).
   NB : marnes et roches altérées suivent les courbes des craies (Q5/Q6). */
const KC: any = {
  argiles: {
    f: [0.07, 0.007, 1.3, 0.27],
    c: [0.1, 0.007, 1.5, 0.27],
    lib: 'Argiles et limons',
  },
  sables: {
    f: [0.04, 0.006, 2.0, 0.09],
    c: [0.03, 0.02, 5.0, 0.09],
    lib: 'Sables et graves',
  },
  craies: { f: [0.04, 0.03, 3.0, 0.11], c: [0.05, 0.04, 3.0, 0.11], lib: 'Craies' },
  marnes: {
    f: [0.04, 0.03, 3.0, 0.11],
    c: [0.05, 0.04, 3.0, 0.11],
    lib: 'Marnes et marno-calcaires',
  },
  roches: {
    f: [0.04, 0.03, 3.0, 0.11],
    c: [0.05, 0.04, 3.0, 0.11],
    lib: 'Roches altérées',
  },
};
function kpCurve(p: any, x: any) {
  return p[3] + (p[0] + p[1] * x) * (1 - Math.exp(-p[2] * x));
}

/**
 * Surface les COEFFICIENTS DE COURBE k_p/k_c de la SEULE categorie utilisee (table
 * publiee annexe D/E — ADR 0015 reco A : valeurs d'affichage du deroule pas-a-pas,
 * pas la table complete). Lecture PURE des tables KP/KC ; ne touche PAS computeAll
 * (l'equivalence-portage compare le R brut, inchange). Server-only (engine.ts).
 * Renvoie null si categorie inconnue (fail-closed : rien a afficher).
 */
export function terzaghiKpCurveCoeffs(
  cat: unknown,
  essai: unknown,
): { f: number[]; c: number[] } | null {
  const table = essai === 'penetro' ? KC : KP;
  const t = (cat != null && (table as Record<string, any>)[cat as string]) || null;
  if (!t || !Array.isArray(t.f) || !Array.isArray(t.c)) return null;
  const finite4 = (a: unknown[]): a is number[] =>
    a.length === 4 && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!finite4(t.f) || !finite4(t.c)) return null;
  return { f: t.f.slice(), c: t.c.slice() };
}
function kcCalc(cat: any, forme: any, B: any, L: any, DeB: any) {
  const t = KC[cat] || KC.sables;
  const x = Math.min(Math.max(DeB, 0), 2);
  const kf = kpCurve(t.f, x),
    kc = kpCurve(t.c, x);
  let kp;
  if (forme === 'filante') kp = kf;
  else if (forme === 'rect') {
    const r = clamp(B / L, 0, 1);
    kp = kf * (1 - r) + kc * r;
  } else kp = kc;
  return { kp: kp, kf: kf, kc: kc, x: x, cap: DeB > 2 };
}
function kpCalc(cat: any, forme: any, B: any, L: any, DeB: any) {
  const t = KP[cat] || KP.sables;
  const x = Math.min(Math.max(DeB, 0), 2);
  const kf = kpCurve(t.f, x),
    kc = kpCurve(t.c, x);
  let kp;
  if (forme === 'filante') kp = kf;
  else if (forme === 'rect') {
    const r = clamp(B / L, 0, 1);
    kp = kf * (1 - r) + kc * r;
  } else kp = kc; /* carrée et circulaire : courbe carrée */
  return { kp: kp, kf: kf, kc: kc, x: x, cap: DeB > 2 };
}

/* ---- coefficient d'inclinaison iδ (annexe F) ---- */
function soilBlend(c: any, phiDeg: any, gamma: any, B: any) {
  /* 1 → cohérent ; 0 → frottant */
  if (!(phiDeg > 0)) return 1;
  if (!(c > 0)) return 0;
  const phi = (phiDeg * Math.PI) / 180;
  return 1 - Math.exp((-0.6 * c) / (gamma * B * Math.tan(phi)));
}
function iDelta(deltaDeg: any, DeB: any, c: any, phiDeg: any, gamma: any, B: any) {
  if (!(deltaDeg > 0)) return { i: 1, ic: 1, iff: 1 };
  const t = clamp(deltaDeg / 90, 0, 1);
  const ic = Math.pow(1 - t, 2);
  let iff;
  if (deltaDeg < 45) iff = Math.pow(1 - t, 2) - t * (2 - 3 * t) * Math.exp(-DeB);
  else iff = Math.pow(1 - t, 2) * (1 - Math.exp(-DeB));
  iff = clamp(iff, 0, 1);
  const k = soilBlend(c, phiDeg, gamma, B);
  return { i: clamp(iff + (ic - iff) * k, 0, 1), ic: ic, iff: iff };
}

/* ---- coefficient de talus iβ (annexe F) ---- */
function iBeta(betaDeg: any, d: any, B: any, DeB: any, c: any, phiDeg: any, gamma: any) {
  if (!(betaDeg > 0)) return { i: 1, ic: 1, iff: 1 };
  /* domaine de validité D.2.5(2) : β < 45°. Au-delà, on gèle à la valeur à 45°
     (la relation frottante n'est plus monotone et renverrait à tort iβ ≈ 1). */
  const bUse = Math.min(betaDeg, 45),
    capped = betaDeg > 45;
  const De = DeB * B,
    tb = Math.tan((bUse * Math.PI) / 180);
  let ic = 1,
    iff = 1;
  if (d < 8 * B) ic = 1 - (bUse / 180) * Math.pow(1 - d / (8 * B), 2);
  const dd = d + (tb > 1e-9 ? De / tb : 1e9);
  if (dd < 8 * B)
    iff = 1 - 0.9 * tb * (2 - tb) * Math.pow(clamp(1 - dd / (8 * B), 0, 1), 2);
  ic = clamp(ic, 0, 1);
  iff = clamp(iff, 0, 1);
  const k = soilBlend(c, phiDeg, gamma, B);
  return { i: clamp(iff + (ic - iff) * k, 0, 1), ic: ic, iff: iff, capped: capped };
}

/* ---- géométrie / surface comprimée (Meyerhof) ---- */
function geomCase(forme: any, B: any, L: any, eB: any, eL: any) {
  if (forme === 'filante') {
    const Bp = Math.max(B - 2 * eB, 0);
    return { A: B, Ap: Bp, Bp: Bp, Lp: 1, exc: 1 - (2 * eB) / B, perML: true };
  }
  if (forme === 'circ') {
    const R = B / 2,
      e = Math.hypot(eB, eL),
      A = Math.PI * R * R;
    let Ap = 0;
    if (e < R) Ap = 2 * (R * R * Math.acos(e / R) - e * Math.sqrt(R * R - e * e));
    return { A: A, Ap: Ap, e: e, exc: 1 - (2 * e) / B };
  }
  const LL = forme === 'carree' ? B : L;
  const Bp = Math.max(B - 2 * eB, 0),
    Lp = Math.max(LL - 2 * eL, 0);
  return {
    A: B * LL,
    Ap: Bp * Lp,
    Bp: Bp,
    Lp: Lp,
    exc: (1 - (2 * eB) / B) * (1 - (2 * eL) / LL),
  };
}

/* ---- limites d'excentrement (tab. 5.5) ---- */
function excLimit(forme: any, etat: any) {
  if (etat === 'ELU_A') return null; /* non requis */
  const fam = etat === 'ELU_F' ? 'ELU' : etat === 'ELS_C' ? 'C' : 'FQ';
  const T: any = {
    filante: { ELU: 1 / 15, C: 1 / 2, FQ: 2 / 3 },
    circ: { ELU: 3 / 40, C: 9 / 16, FQ: 3 / 4 },
    rect: { ELU: 1 / 15, C: 1 / 2, FQ: 2 / 3 },
  };
  const key = forme === 'filante' ? 'filante' : forme === 'circ' ? 'circ' : 'rect';
  return T[key][fam];
}
function excLimitLib(forme: any, etat: any) {
  const L = excLimit(forme, etat);
  if (L === null) return '—';
  const map: any = {};
  map[1 / 15] = '1/15';
  map[3 / 40] = '3/40';
  map[1 / 2] = '1/2';
  map[3 / 4] = '3/4';
  map[2 / 3] = '2/3';
  map[9 / 16] = '9/16';
  return map[L] || fmt(L, 3);
}

/* ---- hauteur de calcul hr de ple* ---- */
function hrCalc(forme: any, etat: any, B: any, L: any, eB: any, eL: any) {
  if (etat.indexOf('ELS') === 0) return { hr: 1.5 * B, red: false };
  if (forme === 'circ') {
    const e = Math.hypot(eB, eL);
    if (1 - (2 * e) / B >= 9 / 16) return { hr: 1.5 * B, red: false };
    return { hr: Math.max((8 * B) / 3 - (16 * e) / 3, 0), red: true };
  }
  if (forme === 'filante') {
    if (1 - (2 * eB) / B >= 0.5) return { hr: 1.5 * B, red: false };
    return { hr: Math.max(Math.min(1.5 * B, 3 * B - 6 * eB), 0), red: true };
  }
  const LL = forme === 'carree' ? B : L;
  if ((1 - (2 * eB) / B) * (1 - (2 * eL) / LL) >= 0.5) return { hr: 1.5 * B, red: false };
  return {
    hr: Math.max(Math.min(1.5 * B, 3 * B - 6 * eB, 3 * LL - 6 * eL), 0),
    red: true,
  };
}

/* ---- coefficients de forme λc / λd ---- */
const LAMB = [
  [1, 1.1, 1.12],
  [2, 1.2, 1.53],
  [3, 1.3, 1.78],
  [5, 1.4, 2.14],
  [20, 1.5, 2.65],
];
function lambdas(forme: any, B: any, L: any) {
  if (forme === 'circ') return { lc: 1.0, ld: 1.0, lib: 'cercle' };
  if (forme === 'carree') return { lc: 1.1, ld: 1.12, lib: 'carré' };
  if (forme === 'filante') return { lc: 1.5, ld: 2.65, lib: 'filante (L/B ≥ 20)' };
  let r = L / B;
  if (!(r >= 1)) r = 1;
  if (r >= 20) return { lc: 1.5, ld: 2.65, lib: 'L/B ≥ 20' };
  for (let i = 0; i < LAMB.length - 1; i++) {
    const a = LAMB[i],
      b = LAMB[i + 1];
    if (r >= a[0] && r <= b[0]) {
      const k = (r - a[0]) / (b[0] - a[0]);
      return {
        lc: a[1] + k * (b[1] - a[1]),
        ld: a[2] + k * (b[2] - a[2]),
        lib: 'L/B = ' + fmt(r, 2),
      };
    }
  }
  return { lc: 1.1, ld: 1.12, lib: 'carré' };
}

/* ---- tassement Ménard (NF P94-261, annexe H) ---- */
function tassement(
  rows: any,
  forme: any,
  B: any,
  L: any,
  D: any,
  qref: any,
  sv0: any,
  zmaxSond: any,
  mode: any,
) {
  const out: any = { ok: false, warn: [] };
  const h = B / 2;
  const dq = Math.max(qref - sv0, 0);
  /* modules par groupes de tranches (moy. harmoniques sur l'épaisseur) */
  const E1 = harmMean(rows, 'em', D, D + h, mode);
  const E2 = harmMean(rows, 'em', D + h, D + 2 * h, mode);
  const E35 = harmMean(rows, 'em', D + 2 * h, D + 5 * h, mode);
  const E68 = harmMean(rows, 'em', D + 5 * h, D + 8 * h, mode);
  const E916 = harmMean(rows, 'em', D + 8 * h, D + 16 * h, mode);
  const a1 = harmMean(rows, 'al', D, D + h, mode);
  const a2 = harmMean(rows, 'al', D + h, D + 2 * h, mode);
  const a35 = harmMean(rows, 'al', D + 2 * h, D + 5 * h, mode);
  const a68 = harmMean(rows, 'al', D + 5 * h, D + 8 * h, mode);
  const a916 = harmMean(rows, 'al', D + 8 * h, D + 16 * h, mode);
  if (![E1, E2, E35].every(Number.isFinite)) {
    out.warn.push('Modules EM ou coefficients α invalides sous la base.');
    return out;
  }

  /* couverture du sondage → choix de la formule Ed (renormalisation H.2) */
  const eps = 1e-6;
  let terms: any, wsum, edMode;
  if (zmaxSond + eps >= D + 8 * B && Number.isFinite(E916)) {
    terms = [
      [0.25, E1, a1],
      [0.3, E2, a2],
      [0.25, E35, a35],
      [0.1, E68, a68],
      [0.1, E916, a916],
    ];
    edMode = 'complet, 16 tranches (H.2.1.2.4)';
  } else if (zmaxSond + eps >= D + 4 * B && Number.isFinite(E68)) {
    terms = [
      [0.25, E1, a1],
      [0.3, E2, a2],
      [0.25, E35, a35],
      [0.2, E68, a68],
    ];
    edMode = 'réduit à E6;8 (H.2.1.2.6)';
    out.warn.push(
      'Sondage limité à ' +
        fmt(zmaxSond, 1) +
        ' m : modules E9 à E16 supposés au moins équivalents aux valeurs sus-jacentes — formule H.2.1.2.6 (NF P94-261).',
    );
  } else {
    terms = [
      [0.25, E1, a1],
      [0.3, E2, a2],
      [0.45, E35, a35],
    ];
    edMode = 'réduit à E3;5 (H.2.1.2.7)';
    if (zmaxSond + eps >= D + 2.5 * B) {
      out.warn.push(
        'Sondage limité à ' +
          fmt(zmaxSond, 1) +
          ' m : modules E6 à E16 supposés au moins équivalents aux valeurs sus-jacentes — formule H.2.1.2.7 (NF P94-261).',
      );
    } else {
      out.warn.push(
        'Sondage très court (' +
          fmt(zmaxSond, 1) +
          ' m < D + 2,5·B = ' +
          fmt(D + 2.5 * B, 1) +
          ' m) : modules profonds extrapolés depuis la dernière valeur — tassement indicatif (formule H.2.1.2.7).',
      );
    }
  }
  wsum = 0;
  let sE = 0,
    sA = 0;
  for (let i = 0; i < terms.length; i++) {
    wsum += terms[i][0];
    sE += terms[i][0] / terms[i][1];
    if (Number.isFinite(terms[i][2])) sA += terms[i][0] / terms[i][2];
    else sA = NaN;
  }
  const Ed = wsum / sE;
  const Ec = E1;
  const alc = a1;
  const ald = Number.isFinite(sA) ? wsum / sA : NaN;
  if (!Number.isFinite(alc) || !Number.isFinite(ald)) {
    out.warn.push('Coefficient rhéologique α manquant.');
    return out;
  }

  const lam = lambdas(forme, B, L);
  const B0 = 0.6;
  const sc = (alc / (9 * Ec * 1000)) * dq * lam.lc * B;
  let sd;
  if (B > B0) sd = (2 / (9 * Ed * 1000)) * dq * B0 * Math.pow((lam.ld * B) / B0, ald);
  else sd = (2 / (9 * Ed * 1000)) * dq * B * Math.pow(lam.ld, ald);

  out.ok = true;
  out.Ec = Ec;
  out.Ed = Ed;
  out.alc = alc;
  out.ald = ald;
  out.lc = lam.lc;
  out.ld = lam.ld;
  out.lamLib = lam.lib;
  out.mode = edMode;
  out.dq = dq;
  out.sc = sc;
  out.sd = sd;
  out.sf = sc + sd;
  return out;
}

/* ---- portance analytique c–φ (annexe F) ---- */
function gammaEffF(gSous: any, hasW: any, zw: any, D: any, B: any) {
  /* poids volumique effectif pour le terme 0,5·γ′·B′·Nγ (F.3.3.1) :
     humide si nappe > 1,5·B sous la base, déjaugé si nappe à la base, interpolé entre les deux */
  if (!hasW || !(zw < D + 1.5 * B)) return gSous;
  const gd = Math.max(gSous - 10, 0);
  if (zw <= D) return gd;
  return gd + ((zw - D) / (1.5 * B)) * (gSous - gd);
}
function cphiCalc(o: any) {
  /* o = {drained,c,phi,Bp,Lp,Ap,V,H,theta,q0eff,gEff,alpha} — filante : Lp=Infinity, grandeurs par ml */
  const out: any = { drained: o.drained };
  const rBL = o.Lp === Infinity ? 0 : o.Bp / o.Lp;
  if (!o.drained) {
    if (!(o.c > 0))
      return { err: 'c<sub>u</sub> nul : portance non drainée incalculable.' };
    out.bc = 1 - (2 * o.alpha) / (Math.PI + 2);
    out.sc = 1 + 0.2 * rBL;
    const ratio = o.H / (o.Ap * o.c);
    if (ratio > 1 + 1e-9)
      return {
        err: 'H > A′·c<sub>u</sub> : condition du coefficient i<sub>c</sub> non satisfaite (F.3.2).',
      };
    out.ic = 0.5 * (1 + Math.sqrt(Math.max(0, 1 - ratio)));
    out.qnet =
      (Math.PI + 2) * o.c * out.bc * out.sc * out.ic; /* surcharge latérale q = 0 */
    return out;
  }
  if (!(o.phi > 0)) return { err: 'φ′ nul : utilisez le comportement non drainé.' };
  const pr = (o.phi * Math.PI) / 180,
    t = Math.tan(pr);
  out.Nq = Math.exp(Math.PI * t) * Math.pow(Math.tan(Math.PI / 4 + pr / 2), 2);
  out.Nc = (out.Nq - 1) / t;
  out.Ng = 2 * (out.Nq - 1) * t; /* base rugueuse (δ ≥ φ′/2) */
  out.sq = 1 + rBL * Math.sin(pr);
  out.sc = (out.sq * out.Nq - 1) / (out.Nq - 1);
  out.sg = 1 - 0.3 * rBL;
  out.bq = Math.pow(1 - o.alpha * t, 2);
  out.bg = out.bq;
  out.bc = out.bq - (1 - out.bq) / (out.Nc * t);
  const mB = (2 + rBL) / (1 + rBL);
  const mL = o.Lp === Infinity ? 1 : (2 + o.Lp / o.Bp) / (1 + o.Lp / o.Bp);
  out.m = mL * Math.pow(Math.cos(o.theta), 2) + mB * Math.pow(Math.sin(o.theta), 2);
  out.iq = 1;
  out.ig = 1;
  if (o.H > 1e-9) {
    const base = 1 - o.H / (o.V + (o.Ap * o.c) / t);
    if (base <= 0)
      return { err: 'H ≥ V + A′·c′/tanφ′ : coefficients d’inclinaison nuls (F.3.3).' };
    out.iq = Math.pow(base, out.m);
    out.ig = Math.pow(base, out.m + 1);
  }
  out.ic = out.iq - (1 - out.iq) / (out.Nc * t);
  out.qnet =
    o.c * out.Nc * out.bc * out.sc * out.ic +
    o.q0eff * (out.Nq * out.bq * out.sq * out.iq - 1) +
    0.5 * o.gEff * o.Bp * out.Ng * out.bg * out.sg * out.ig;
  return out;
}

/* ---- raideurs (élasticité linéaire isotrope, annexe J.3) ---- */
function raideurs(forme: any, B: any, L: any, E: any, nu: any) {
  if (!(E > 0) || !(nu >= 0) || !(nu < 0.5)) return null;
  if (forme === 'circ') {
    const Kv = (E * B) / (1 - nu * nu);
    const Kh = (4 * E * B) / ((2 - nu) * (1 + nu));
    const Kt = (Kv * B * B) / 6;
    return { shape: 'circ', Kv: Kv, KhB: Kh, KhL: Kh, KtB: Kt, KtL: Kt };
  }
  if (forme === 'filante') {
    const Kv = (0.73 * E) / (2 * (1 - nu * nu));
    const KhB = E / ((2 - nu) * (1 + nu));
    return {
      shape: 'filante',
      Kv: Kv,
      KhB: KhB,
      KhL: NaN,
      KtB: NaN,
      KtL: Kv * 2.15 * B * B,
      perML: true,
    };
  }
  const LL = forme === 'carree' ? B : L;
  const r = LL / B,
    ir = B / LL,
    S = Math.sqrt(B * LL);
  const bv = 1.55 * Math.pow(r, 0.25) + 0.8 * Math.sqrt(ir);
  const bB = 3.4 * Math.pow(r, 0.15) + 1.2 * Math.sqrt(ir);
  const bL = 3.4 * Math.pow(r, 0.15) + 0.4 * Math.sqrt(r) + 0.8 * Math.sqrt(ir);
  const Kv = (E / (2 * (1 - nu * nu))) * bv * S;
  const KhB = (E / (2 * (2 - nu) * (1 + nu))) * bB * S;
  const KhL = (E / (2 * (2 - nu) * (1 + nu))) * bL * S;
  const KtB = (Kv * B * B * (0.4 * Math.sqrt(r) + 0.1 * Math.sqrt(ir))) / (bv * r);
  const KtL = (Kv * B * B * (0.4 * Math.pow(r, 1.9) + 0.034 * Math.sqrt(ir))) / (bv * r);
  return {
    shape: 'rect',
    Kv: Kv,
    KhB: KhB,
    KhL: KhL,
    KtB: KtB,
    KtL: KtL,
    bv: bv,
    bB: bB,
    bL: bL,
  };
}

/* ---- facteurs d'influence de Boussinesq (contrainte verticale sous le centre) ---- */
function newmarkCorner(m: any, n: any) {
  const m2 = m * m,
    n2 = n * n,
    s = Math.sqrt(m2 + n2 + 1);
  const A = (((2 * m * n * s) / (m2 + n2 + 1 + m2 * n2)) * (m2 + n2 + 2)) / (m2 + n2 + 1);
  const ang = Math.atan2(
    2 * m * n * s,
    m2 + n2 + 1 - m2 * n2,
  ); /* atan2 gère le +π quand le dénominateur < 0 */
  return (A + ang) / (4 * Math.PI);
}
function boussRect(B: any, L: any, z: any) {
  if (!(z > 0)) return 1;
  return 4 * newmarkCorner(B / 2 / z, L / 2 / z);
}
function boussCirc(B: any, z: any) {
  if (!(z > 0)) return 1;
  const R = B / 2;
  return 1 - Math.pow(1 / (1 + (R / z) * (R / z)), 1.5);
}
function boussStrip(B: any, z: any) {
  if (!(z > 0)) return 1;
  const beta = Math.atan2(B / 2, z);
  return (2 * beta + Math.sin(2 * beta)) / Math.PI;
}
function boussIz(forme: any, B: any, L: any, z: any) {
  if (forme === 'circ') return boussCirc(B, z);
  if (forme === 'filante') return boussStrip(B, z);
  return boussRect(B, forme === 'carree' ? B : L, z);
}
function qcAt(rows: any, z: any, mode: any) {
  if (mode === 'essais') {
    const N = nodesFor(rows, 'qc');
    if (!N.length) return NaN;
    if (z <= N[0].z) return N[0].v;
    if (z >= N[N.length - 1].z) return N[N.length - 1].v;
    for (let i = 0; i < N.length - 1; i++) {
      if (z >= N[i].z && z <= N[i + 1].z) {
        const k = (z - N[i].z) / (N[i + 1].z - N[i].z);
        return N[i].v + k * (N[i + 1].v - N[i].v);
      }
    }
    return N[N.length - 1].v;
  }
  return valAt(rows, 'qc', z);
}
/* ---- tassement par déformation unidimensionnelle (annexe J.4.1, module œdométrique Sanglerat M = α·qc) ---- */
function tassementOed(
  rows: any,
  forme: any,
  B: any,
  L: any,
  D: any,
  qref: any,
  alphaSang: any,
  mode: any,
  zmaxSond: any,
) {
  const out: any = { ok: false, warn: [] };
  if (!(alphaSang > 0)) {
    out.err = 'Renseignez le coefficient α de Sanglerat (M = α·q<sub>c</sub>).';
    return out;
  }
  const zfac =
    forme === 'filante' ? 4 : 2.5; /* zone d’influence : 4·B (filante) sinon 2,5·B */
  const zInf = zfac * B; /* profondeur d’intégration sous la base */
  const zlbl = fmt(zfac, zfac === 2.5 ? 1 : 0) + '·B';
  const N = Math.max(240, Math.ceil(zInf / (B * 0.01)));
  const dz = zInf / N;
  let integ = 0,
    minM = Infinity,
    maxM = 0;
  for (let i = 0; i < N; i++) {
    const zm = (i + 0.5) * dz; /* profondeur sous la base */
    const Iz = boussIz(forme, B, L, zm);
    const qc = qcAt(rows, D + zm, mode);
    if (!(qc > 0)) {
      out.err =
        'q<sub>c</sub> manquant ou nul sur la zone d’influence (jusqu’à D + ' +
        zlbl +
        ') — tassement œdométrique incalculable.';
      return out;
    }
    const Mm = alphaSang * qc; /* MPa */
    minM = Math.min(minM, Mm);
    maxM = Math.max(maxM, Mm);
    integ += (Iz / (Mm * 1000)) * dz /* M en kPa */;
  }
  out.ok = true;
  out.s = qref * integ;
  out.depth = zInf;
  out.zfac = zfac;
  out.zlbl = zlbl;
  out.alphaSang = alphaSang;
  out.Mmin = minM;
  out.Mmax = maxM;
  out.qref = qref;
  if (zmaxSond + 1e-6 < D + zInf)
    out.warn.push(
      'Sondage pénétrométrique limité à ' +
        fmt(zmaxSond, 1) +
        ' m (< D + ' +
        zlbl +
        ' = ' +
        fmt(D + zInf, 1) +
        ' m) : q<sub>c</sub> extrapolé en profondeur — tassement œdométrique indicatif.',
    );
  return out;
}

/* ---- tassement élastique linéaire isotrope (annexe J.3.1, fondation rigide) ---- */
const CF_GIROUD = [
  [1, 0.88],
  [2, 1.21],
  [3, 1.43],
  [5, 1.72],
  [10, 2.18],
]; /* L/B → cf (rigide, Giroud) */
function cfGiroud(forme: any, B: any, L: any) {
  let r =
    forme === 'filante'
      ? 10
      : forme === 'circ' || forme === 'carree'
        ? 1
        : Math.max(L / B, 1);
  if (r >= 10) return { cf: 2.18, lib: 'L/B ≥ 10' };
  if (r <= 1) return { cf: 0.88, lib: forme === 'circ' ? 'circulaire' : 'L/B = 1' };
  for (let i = 0; i < CF_GIROUD.length - 1; i++) {
    const a = CF_GIROUD[i],
      b = CF_GIROUD[i + 1];
    if (r >= a[0] && r <= b[0]) {
      const k = (r - a[0]) / (b[0] - a[0]);
      return { cf: a[1] + k * (b[1] - a[1]), lib: 'L/B = ' + fmt(r, 2) };
    }
  }
  return { cf: 0.88, lib: 'L/B = 1' };
}
function tassementElastique(forme: any, B: any, L: any, E: any, nu: any, dq: any) {
  const out: any = { ok: false, warn: [] };
  if (!(E > 0)) {
    out.err = 'Module d’Young E manquant : tassement élastique (J.3.1) incalculable.';
    return out;
  }
  if (!(nu >= 0 && nu < 0.5)) {
    out.err =
      'Coefficient de Poisson ν invalide (0 ≤ ν < 0,5) pour le tassement élastique.';
    return out;
  }
  const g = cfGiroud(forme, B, L);
  out.ok = true;
  out.cf = g.cf;
  out.cfLib = g.lib;
  out.E = E;
  out.nu = nu;
  out.dq = dq;
  out.s =
    (g.cf * (1 - nu * nu) * B * dq) / (E * 1000) /* E MPa→kPa ; dq kPa ; B m → s m */;
  return out;
}

/* ---- tassement de Schmertmann (NF P94-261, §6.2 / annexe I) ---- */
/* Paramètres de forme : axisymétrique (carré/circ, L/B=1) ↔ déformation plane (filante, L/B≥10),
   interpolés linéairement en L/B. zI : 2B (axisym) → 4B (plane). Peak de Iz à zp = B/2 → B. */
function schmParams(forme: any, B: any, L: any) {
  let r;
  if (forme === 'filante') r = 10;
  else if (forme === 'circ' || forme === 'carree') r = 1;
  else r = Math.max(L > 0 ? L / B : 1, 1);
  const t = Math.min(Math.max((r - 1) / 9, 0), 1);
  return {
    zI: (2 + 2 * t) * B,
    zp: (0.5 + 0.5 * t) * B,
    Iz0: 0.1 + 0.1 * t,
    C3: 1.25 + 0.5 * t,
    Efac: 2.5 + 1.0 * t,
    r: r,
    t: t,
  };
}
/* s = C1·C2·(q−σ'v)·∫ Iz/(C3·E) dz ; E = Efac·qc (MPa) ; Izp = 0,5 + 0,1·√((q−σ'v)/σ'vp). */
function tassementSchmertmann(
  rows: any,
  forme: any,
  B: any,
  L: any,
  D: any,
  q: any,
  sv0: any,
  gAv: any,
  zw: any,
  hasW: any,
  zmaxSond: any,
  mode: any,
) {
  const out: any = { ok: false, warn: [] };
  if (!(q > sv0)) {
    out.err =
      'q ≤ σ′<sub>v</sub> : tassement de Schmertmann non défini (charge nette ≤ 0).';
    return out;
  }
  const P = schmParams(forme, B, L);
  function sigEff(zabs: any) {
    let s = gAv * zabs;
    if (hasW && zabs > zw) s -= (zabs - zw) * 10;
    return Math.max(s, 1e-6);
  } /* σ'v effective à la cote zabs */
  const svp = sigEff(D + P.zp);
  const dq = q - sv0;
  const Izp = 0.5 + 0.1 * Math.sqrt(dq / svp);
  const C1 = Math.max(1 - (0.5 * sv0) / dq, 0); /* facteur d'encastrement */
  const C2 = 1.4; /* 1,2 + 0,2·log10(t), t = 10 ans */
  function IzAt(z: any) {
    if (z <= 0) return P.Iz0;
    if (z <= P.zp) return P.Iz0 + (Izp - P.Iz0) * (z / P.zp);
    if (z < P.zI) return (Izp * (P.zI - z)) / (P.zI - P.zp);
    return 0;
  }
  const Nn = Math.max(400, Math.ceil(P.zI / (B * 0.005)));
  const dz = P.zI / Nn;
  let integ = 0,
    minE = Infinity,
    maxE = 0,
    qcMiss = false;
  for (let i = 0; i < Nn; i++) {
    const z = (i + 0.5) * dz;
    const qc = qcAt(rows, D + z, mode);
    if (!(qc > 0)) {
      qcMiss = true;
      break;
    }
    const Ei = P.Efac * qc; /* MPa */
    minE = Math.min(minE, Ei);
    maxE = Math.max(maxE, Ei);
    integ += (IzAt(z) / (P.C3 * Ei * 1000)) * dz /* Ei MPa→kPa ; 1/kPa ; ×m */;
  }
  if (qcMiss) {
    out.err =
      'q<sub>c</sub> manquant ou nul sur la zone d’influence de Schmertmann (jusqu’à D + ' +
      fmt(P.zI / B, 0) +
      '·B) — tassement incalculable.';
    return out;
  }
  out.ok = true;
  out.s = C1 * C2 * dq * integ /* m */;
  out.integral = integ /* m/kPa : ∫ Iz/(C3·E) dz */;
  out.C1 = C1;
  out.C2 = C2;
  out.Izp = Izp;
  out.zI = P.zI;
  out.zp = P.zp;
  out.C3 = P.C3;
  out.Efac = P.Efac;
  out.dq = dq;
  out.svp = svp;
  out.Emin = minE;
  out.Emax = maxE;
  out.q = q;
  out.zfac = P.zI / B;
  out.r = P.r;
  if (zmaxSond + 1e-6 < D + P.zI)
    out.warn.push(
      'Sondage pénétrométrique limité à ' +
        fmt(zmaxSond, 1) +
        ' m (< D + ' +
        fmt(P.zI / B, 0) +
        '·B = ' +
        fmt(D + P.zI, 1) +
        ' m) : q<sub>c</sub> extrapolé en profondeur — tassement de Schmertmann indicatif.',
    );
  return out;
}

/* ---- raideur verticale native depuis le modèle pressiométrique (Ménard, §7.2.1) ---- */
/* Kv = (charge nette)/(tassement de Ménard) ; modèle linéaire → indépendant du niveau de charge.
   Calculée à partir de la fonction tassement() pour rester exactement cohérente avec le tassement affiché. */
function raideurMenardKv(
  rows: any,
  forme: any,
  B: any,
  L: any,
  D: any,
  A: any,
  sv0: any,
  zmaxSond: any,
  mode: any,
) {
  const tt = tassement(
    rows,
    forme,
    B,
    L,
    D,
    sv0 + 100,
    sv0,
    zmaxSond,
    mode,
  ); /* charge nette d'essai : 100 kPa */
  if (!tt.ok || !(tt.sf > 0)) return { ok: false };
  return {
    ok: true,
    Kv: (100 * A) / tt.sf / 1000,
    Ec: tt.Ec,
    Ed: tt.Ed,
    alc: tt.alc,
    ald: tt.ald,
    lc: tt.lc,
    ld: tt.ld,
    smodeLib: tt.mode,
  } /* MN/m */;
}
/* ---- raideur verticale native depuis le modèle pénétrométrique (Schmertmann, §7.2.2) ---- */
/* Kv = A / [C1·C2·∫ Iz/(C3·E) dz], évalué pour q = qELS = kc·qce/Fs (Fs = 2,76, ELS QP) : sécant à l'ELS. */
function raideurSchmertmannKv(
  rows: any,
  forme: any,
  B: any,
  L: any,
  D: any,
  A: any,
  sv0: any,
  gAv: any,
  zw: any,
  hasW: any,
  zmaxSond: any,
  mode: any,
  qELS: any,
) {
  const sm = tassementSchmertmann(
    rows,
    forme,
    B,
    L,
    D,
    qELS,
    sv0,
    gAv,
    zw,
    hasW,
    zmaxSond,
    mode,
  );
  if (!sm.ok) return { ok: false };
  return {
    ok: true,
    Kv: A / (sm.C1 * sm.C2 * sm.integral) / 1000,
    qELS: qELS,
    sm: sm,
  } /* MN/m */;
}
/* ---- Kh / Kθ déduites de Kv par les ratios de Gazetas (1991), NF P94-261 §7.3 ---- */
function gazetasFromKv(forme: any, B: any, L: any, Kv: any, method: any, methodLib: any) {
  if (!(Kv > 0)) return null;
  if (forme === 'filante') {
    /* par ml : ratios de bande cohérents avec le strip de raideurs() (Kh ≈ 1,10·Kv ; Kθ;L ≈ 2,15·B²·Kv) */
    return {
      Kv: Kv,
      KhB: 1.1 * Kv,
      KhL: NaN,
      KtB: NaN,
      KtL: 2.15 * B * B * Kv,
      perML: true,
      method: method,
      methodLib: methodLib,
    };
  }
  let Bx, Lx;
  if (forme === 'circ') {
    const a = (B * Math.sqrt(Math.PI)) / 2;
    Bx = a;
    Lx = a;
  } /* carré équivalent de même aire */ else if (forme === 'carree') {
    Bx = B;
    Lx = B;
  } else {
    Bx = B;
    Lx = Math.max(L, B);
  }
  const rBL = Bx / Lx,
    rLB = Lx / Bx;
  const den = 0.73 + 1.54 * Math.pow(rBL, 0.75);
  const KhB = ((0.4 * (2 + 2.5 * Math.pow(rBL, 0.85))) / den) * Kv;
  const KhL = ((0.4 * rBL * (1.2 + 3.3 * Math.pow(rLB, 0.65))) / den) * Kv;
  const KtB = (((Math.pow(Bx, 3) / (8 * Lx)) * (0.4 + 3.2 * rLB)) / den) * Kv;
  const KtL = (((Math.pow(Bx, 3) / (8 * Lx)) * (3.6 * Math.pow(rLB, 2.4))) / den) * Kv;
  return {
    Kv: Kv,
    KhB: KhB,
    KhL: KhL,
    KtB: KtB,
    KtL: KtL,
    perML: false,
    method: method,
    methodLib: methodLib,
  };
}

/* ---- calcul complet ---- */
const ETATS = [
  ['ELU_F', 'ELU fondamental (durable / transitoire)'],
  ['ELU_A', 'ELU accidentel'],
  ['ELS_C', 'ELS caractéristique'],
  ['ELS_F', 'ELS fréquent'],
  ['ELS_QP', 'ELS quasi-permanent'],
];
function etatLib(code: any) {
  for (let i = 0; i < ETATS.length; i++) if (ETATS[i][0] === code) return ETATS[i][1];
  return code;
}
function gammaRv(etat: any) {
  return etat === 'ELU_F' ? 1.4 : etat === 'ELU_A' ? 1.2 : 2.3;
}

function computeAll(state: any) {
  const R: any = { warn: [], err: null, cases: [], ctx: null };
  const mode = state.profilMode === 'essais' ? 'essais' : 'couches';
  const essai = ['penetro', 'labo'].indexOf(state.essai) >= 0 ? state.essai : 'pressio';
  const labo = essai === 'labo';
  const rows = parsedSondage(state);
  const okRows =
    essai === 'penetro'
      ? rows.filter(function (r: any) {
          return Number.isFinite(r.qc) && r.qc > 0;
        })
      : rows.filter(function (r: any) {
          return Number.isFinite(r.pl) && r.pl > 0 && Number.isFinite(r.em) && r.em > 0;
        });
  const B = num(state.B),
    D = num(state.D),
    forme = state.forme;
  let L = forme === 'rect' ? num(state.L) : B;

  if (!labo && (rows.length === 0 || okRows.length === 0)) {
    R.err =
      essai === 'penetro'
        ? 'Renseignez au moins une ligne de sondage avec q<sub>c</sub> > 0 — ou cliquez sur « Exemple fictif » pour charger un jeu de démonstration.'
        : 'Renseignez au moins une ligne de sondage valide (pl* et E<sub>m</sub> > 0) — ou cliquez sur « Exemple fictif » pour charger un jeu de démonstration.';
    return R;
  }
  if (!(B > 0)) {
    R.err = 'La largeur B doit être strictement positive.';
    return R;
  }
  if (!(D >= 0)) {
    R.err = "L'encastrement D doit être positif ou nul.";
    return R;
  }
  if (forme === 'rect') {
    if (!(L > 0)) {
      R.err = 'La longueur L doit être strictement positive.';
      return R;
    }
    if (L < B) {
      R.warn.push(
        'L < B : les rôles de B et L ont été conservés tels que saisis, mais la convention NF P94-261 impose B ≤ L. Vérifiez la saisie.',
      );
      L = Math.max(L, B);
    }
  }

  const gAv = num(state.gAvant),
    gAp = num(state.gApres);
  if (!(gAv > 0) || !(gAp > 0)) {
    R.err = 'Renseignez les poids volumiques γ avant et après travaux.';
    return R;
  }
  const c = Math.max(num(state.c) || 0, 0);
  const phi = Math.max(num(state.phi) || 0, 0);
  const eY = num(state.eYoung),
    nuS = num(state.nuSol);
  const cphiOn = !!state.cphiOn;
  const gSousV = num(state.gSous);
  if (labo) {
    const drainedReq = state.cphiMode === 'd' || (state.cphiMode !== 'nd' && phi > 0);
    if (drainedReq && !(phi > 0)) {
      R.err =
        'Méthode c–φ (drainé) : renseignez l’angle de frottement φ′ (et la cohésion c′).';
      return R;
    }
    if (!drainedReq && !(c > 0)) {
      R.err = 'Méthode c–φ (non drainé) : renseignez la cohésion c<sub>u</sub>.';
      return R;
    }
    if (!(eY > 0))
      R.warn.push(
        'Méthode c–φ : module d’Young E non renseigné — tassement élastique (J.3.1) et raideurs (J.3) non calculés.',
      );
    if (!(Number.isFinite(nuS) && nuS >= 0 && nuS < 0.5))
      R.warn.push(
        'Méthode c–φ : coefficient de Poisson ν manquant ou ≥ 0,5 — tassement élastique non calculé.',
      );
  }
  if (Number.isFinite(nuS) && nuS >= 0.5)
    R.warn.push(
      'Coefficient de Poisson ν ≥ 0,5 : raideurs non calculables (annexe J.3).',
    );
  const zw = num(state.nappe);
  const hasW = Number.isFinite(zw);
  if (hasW && zw < 0)
    R.warn.push(
      'Profondeur de nappe négative (' +
        fmt(zw, 1) +
        ' m) : nappe au-dessus du terrain naturel — vérifiez la saisie.',
    );
  const u = hasW && zw < D ? (D - zw) * 10 : 0;
  const q0 = Math.max(
    gAp * D,
    0,
  ); /* contrainte TOTALE verticale après travaux (NF P94-261, 9.1.2 note 3) */
  const sv0 = Math.max(
    gAv * D - u,
    0,
  ); /* contrainte effective avant travaux (annexe H) */

  const talus = state.talusOn;
  const beta = talus ? Math.max(num(state.beta) || 0, 0) : 0;
  const dT = talus ? Math.max(num(state.dTalus) || 0, 0) : 0;
  if (talus && !(beta > 0))
    R.warn.push('Talus coché mais pente β nulle : coefficient iβ = 1.');
  if (talus && beta >= 45)
    R.warn.push(
      'Pente de talus β ≥ 45° : hors domaine de validité des relations de l’annexe D.2.5 (NF P94-261, D.2.5(2)).',
    );

  const zmaxSond = rows.length ? rows[rows.length - 1].z : 0;
  if (!labo) {
    if (D > zmaxSond + 1e-6) {
      R.warn.push(
        'Base de la fondation (D = ' +
          fmt(D, 1) +
          ' m) située sous le dernier point de sondage (' +
          fmt(zmaxSond, 1) +
          ' m) : ' +
          (essai === 'penetro' ? 'q<sub>c</sub>' : 'pl* et E<sub>m</sub>') +
          ' entièrement extrapolés — résultats à confirmer par une reconnaissance plus profonde.',
      );
    } else if (zmaxSond < D + 1.5 * B - 1e-6) {
      R.warn.push(
        'Le sondage (' +
          fmt(zmaxSond, 1) +
          ' m) ne couvre pas toute la zone utile D + 1,5·B = ' +
          fmt(D + 1.5 * B, 1) +
          ' m : dernières valeurs prolongées en profondeur.',
      );
    }
  }

  /* référence pour la coupe : ple*, De à l'ELS (hr = 1,5 B) */
  let pleRef = NaN,
    DeRef = NaN;
  if (!labo) {
    if (essai === 'penetro') {
      pleRef = qceCalc(rows, D, 1.5 * B, mode) /* qce de référence (MPa) */;
      DeRef = deCalcP(rows, D, pleRef, mode);
    } else {
      pleRef = pleStar(rows, D, 1.5 * B, mode);
      DeRef = deCalc(rows, D, pleRef, mode);
    }
  }

  /* raideur équivalente : K_v natif selon la méthode, puis K_h / K_θ par les ratios de Gazetas (§7.3).
     PMT → Ménard (§7.2.1) ; CPT → Schmertmann (§7.2.2) ; c–φ → élasticité (annexe J.3, inchangé).
     Repli sur les raideurs élastiques (E, ν) si la méthode in situ est indisponible. */
  const Atot = geomCase(forme, B, L, 0, 0).A;
  function elasticRaid() {
    const r: any = raideurs(forme, B, L, eY, nuS);
    if (r) {
      r.method = 'elastic';
      r.methodLib = 'élasticité linéaire isotrope (annexe J.3)';
    }
    return r;
  }
  let raidCtx: any = null;
  if (labo) {
    raidCtx = elasticRaid();
  } else if (essai === 'penetro') {
    if (Number.isFinite(pleRef) && pleRef > 0 && Number.isFinite(DeRef)) {
      const kcRef = kcCalc(state.solCat, forme, B, L, DeRef / B).kp;
      const qELS =
        ((kcRef * pleRef) / 2.76) * 1000; /* kPa : qELS = kc·qce/Fs, Fs = 2,76 (ELS QP) */
      const ks = raideurSchmertmannKv(
        rows,
        forme,
        B,
        L,
        D,
        Atot,
        sv0,
        gAv,
        zw,
        hasW,
        zmaxSond,
        mode,
        qELS,
      );
      if (ks.ok) {
        raidCtx = gazetasFromKv(forme, B, L, ks.Kv, 'schmertmann', 'Schmertmann, §7.2.2');
        if (raidCtx) raidCtx.qELS = qELS;
      }
    }
    if (!raidCtx) raidCtx = elasticRaid();
  } else {
    const km = raideurMenardKv(rows, forme, B, L, D, Atot, sv0, zmaxSond, mode);
    if (km.ok) raidCtx = gazetasFromKv(forme, B, L, km.Kv, 'menard', 'Ménard, §7.2.1');
    if (!raidCtx) raidCtx = elasticRaid();
  }
  R.ctx = {
    rows: rows,
    B: B,
    L: L,
    forme: forme,
    D: D,
    zw: hasW ? zw : NaN,
    u: u,
    q0: q0,
    sv0: sv0,
    gAv: gAv,
    gAp: gAp,
    c: c,
    phi: phi,
    beta: beta,
    dT: dT,
    talus: talus,
    talusDir: state.talusDir || 'ext',
    pleRef: pleRef,
    DeRef: DeRef,
    zmaxSond: zmaxSond,
    cat: state.solCat,
    beton: state.beton,
    profilMode: mode,
    deFrom: deStart(rows, mode, D),
    eY: eY,
    nu: nuS,
    raid: raidCtx,
    cphiOn: cphiOn || labo,
    essai: essai,
    labo: labo,
  };

  /* régime d'encastrement (annexe C, classification sur l'ELS QP) */
  const DeBref = Number.isFinite(DeRef) && B > 0 ? DeRef / B : NaN;
  R.ctx.DeBref = DeBref;
  if (Number.isFinite(DeBref)) {
    if (DeBref >= 5) {
      R.warn.push(
        'D<sub>e</sub>/B = ' +
          fmt(DeBref, 1) +
          ' ≥ 5 : la fondation n’est plus superficielle ni semi-profonde. Les méthodes des annexes D/E ne s’appliquent pas — relève des fondations profondes (NF P94-262).',
      );
    } else if (DeBref >= 1.5) {
      R.ctx.regime = 'semi-profonde';
    } else {
      R.ctx.regime = 'superficielle';
    }
  }

  /* ---------- capacité portante de référence (charge centrée, verticale) ----------
     Quand les charges ne sont pas connues, on fournit R_v;d pour une charge centrée
     verticale : e = 0 → A' = A ; H = 0 → i_δ = 1. Dans ce cas q_net ne dépend pas de
     l'état limite ; seul γ_R;v varie (ELU_F 1,4 · ELU_A 1,2 · ELS 2,3). γ_R;d;v inchangé. */
  R.refCap = (function () {
    const A = Atot,
      R0 = A * q0,
      perML = forme === 'filante';
    const statesDef = [
      ['ELU_F', 'ELU fondamental'],
      ['ELU_A', 'ELU accidentel'],
      ['ELS_C', 'ELS (caract. / fréq. / QP)'],
    ];
    const rc: any = { ok: false, A: A, R0: R0, q0: q0, perML: perML, states: [] };
    let qnet = NaN,
      gRdv = 1.2;
    if (labo) {
      const drained = state.cphiMode === 'd' || (state.cphiMode !== 'nd' && phi > 0);
      let Bp, Lp;
      if (forme === 'filante') {
        Bp = B;
        Lp = Infinity;
      } else if (forme === 'circ') {
        Bp = Math.sqrt(A);
        Lp = Math.sqrt(A);
      } else {
        Bp = B;
        Lp = forme === 'carree' ? B : L;
      }
      const gEff = gammaEffF(
        Number.isFinite(gSousV) && gSousV > 0 ? gSousV : gAp,
        hasW,
        zw,
        D,
        B,
      );
      const q0eff = Math.max(gAp * D - u, 0);
      const F = cphiCalc({
        drained: drained,
        c: c,
        phi: phi,
        Bp: Bp,
        Lp: Lp,
        Ap: A,
        V: 1,
        H: 0,
        theta: forme === 'filante' ? Math.PI / 2 : 0,
        q0eff: q0eff,
        gEff: gEff,
        alpha: 0,
      });
      if (F.err) {
        rc.err = F.err;
        return rc;
      }
      gRdv = drained ? 2.0 : 1.2;
      const ib = iBeta(beta, dT, B, Math.min(D / B, 2), c, phi, gAp).i;
      qnet = F.qnet * (talus && beta > 0 ? ib : 1);
      rc.drained = drained;
      rc.ib = ib;
      rc.q0eff = q0eff;
      rc.gEff = gEff;
      rc.cphiF = F;
      rc.Bp = Bp;
      rc.Lp = Lp;
      rc.method = 'c–φ (annexe F)';
    } else {
      if (!(pleRef > 0)) {
        rc.err =
          (essai === 'penetro' ? 'q<sub>ce</sub>' : 'p<sub>le</sub>*') +
          ' de référence incalculable (sondage insuffisant sur [D ; D + 1,5·B]).';
        return rc;
      }
      const DeB = DeRef / B;
      const kpr =
        essai === 'penetro'
          ? kcCalc(state.solCat, forme, B, L, DeB)
          : kpCalc(state.solCat, forme, B, L, DeB);
      const ib = iBeta(beta, dT, B, Math.min(DeB, 2), c, phi, gAp).i;
      qnet = kpr.kp * pleRef * ib * 1000;
      rc.ple = pleRef;
      rc.De = DeRef;
      rc.DeB = DeB;
      rc.kp = kpr.kp;
      rc.kf = kpr.kf;
      rc.kc = kpr.kc;
      rc.kpx = kpr.x;
      rc.ib = ib;
      rc.hr = 1.5 * B;
      rc.cat = state.solCat;
      rc.shapeR = forme === 'rect' ? B / L : NaN;
      rc.method =
        essai === 'penetro' ? 'pénétrométrique (annexe E)' : 'pressiométrique (annexe D)';
    }
    rc.qnet = qnet;
    rc.gRdv = gRdv;
    statesDef.forEach(function (s) {
      const gRv = gammaRv(s[0]);
      const Rvd = R0 + (A * qnet) / (gRv * gRdv);
      rc.states.push({ etat: s[0], lib: s[1], gRv: gRv, Rvd: Rvd, qRvd: Rvd / A });
    });
    rc.ok = true;

    /* tassement sous la contrainte résistante de calcul à l'ELS caractéristique.
       Charges inconnues : on prend q_ref = q_Rv;d(ELS caract.) — pression de contact
       maximale admissible à l'ELS. Le tassement obtenu est une borne supérieure de service
       (semelle chargée jusqu'à sa résistance ELS). Mêmes méthodes que sous charge réelle. */
    let qELS = 0;
    for (let i = 0; i < rc.states.length; i++) {
      if (rc.states[i].etat === 'ELS_C') {
        qELS = rc.states[i].qRvd;
        break;
      }
    }
    rc.qTass = qELS;
    rc.tassFrom = 'q_Rv;d (ELS caractéristique)';
    if (labo) {
      rc.elast = tassementElastique(forme, B, L, eY, nuS, Math.max(qELS - sv0, 0));
    } else if (essai === 'penetro') {
      rc.oed = tassementOed(
        rows,
        forme,
        B,
        L,
        D,
        qELS,
        num(state.alphaSang),
        mode,
        zmaxSond,
      );
      if (rc.oed && rc.oed.warn)
        rc.oed.warn.forEach(function (w: any) {
          if (R.warn.indexOf(w) < 0) R.warn.push(w);
        });
      rc.schm = tassementSchmertmann(
        rows,
        forme,
        B,
        L,
        D,
        qELS,
        sv0,
        gAv,
        zw,
        hasW,
        zmaxSond,
        mode,
      );
      if (rc.schm && rc.schm.warn)
        rc.schm.warn.forEach(function (w: any) {
          if (R.warn.indexOf(w) < 0) R.warn.push(w);
        });
    } else {
      rc.tass = tassement(rows, forme, B, L, D, qELS, sv0, zmaxSond, mode);
      if (rc.tass && rc.tass.warn)
        rc.tass.warn.forEach(function (w: any) {
          if (R.warn.indexOf(w) < 0) R.warn.push(w);
        });
    }
    return rc;
  })();

  let capWarned = false;
  state.charges.forEach(function (ch: any, idx: any) {
    const C: any = { idx: idx, etat: ch.etat, lib: etatLib(ch.etat), notes: [] };
    const Fz = num(ch.fz),
      Fx = num(ch.fx) || 0,
      Fy = num(ch.fy) || 0,
      Mx = num(ch.mx) || 0,
      My = num(ch.my) || 0;
    C.Fz = Fz;
    C.Fx = Fx;
    C.Fy = Fy;
    C.Mx = Mx;
    C.My = My;
    if (!(Fz > 0)) {
      C.invalid =
        String(ch.fz == null ? '' : ch.fz).trim() === ''
          ? 'Renseignez la charge verticale F<sub>z</sub> de ce cas.'
          : 'F<sub>z</sub> doit être strictement positif.';
      R.cases.push(C);
      return;
    }

    C.eB = Math.abs(My) / Fz;
    C.eL = forme === 'filante' ? 0 : Math.abs(Mx) / Fz;
    if (forme === 'filante' && Math.abs(Mx) > 1e-9)
      C.notes.push(
        'M<sub>x</sub> ignoré (semelle filante : pas d’excentrement longitudinal).',
      );
    C.H = Math.hypot(Fx, Fy);
    C.delta = (Math.atan2(C.H, Fz) * 180) / Math.PI;

    const g = geomCase(forme, B, L, C.eB, C.eL);
    C.geom = g;
    const lim = excLimit(forme, C.etat);
    C.excLim = lim;
    C.excLimLib = excLimitLib(forme, C.etat);
    C.excOk = lim === null ? null : g.exc >= lim - 1e-9;

    const hrr = hrCalc(forme, C.etat, B, L, C.eB, C.eL);
    C.hr = hrr.hr;
    C.hrRed = hrr.red;
    if (hrr.red)
      C.notes.push(
        'Excentrement fort : hauteur de moyenne h<sub>r</sub> réduite (' +
          fmt(hrr.hr, 2) +
          ' m au lieu de 1,5·B).',
      );

    /* portance par méthode in situ (pressiomètre / pénétromètre) */
    if (!labo) {
      if (essai === 'penetro') {
        C.qce = qceCalc(rows, D, C.hr, mode);
        C.ple = C.qce /* alias interne (MPa) pour la chaîne commune */;
        if (!(C.qce > 0)) {
          C.invalid =
            'q<sub>ce</sub> incalculable : qc doit être > 0 sur [D ; D + h<sub>r</sub>].';
          R.cases.push(C);
          return;
        }
        C.De = deCalcP(rows, D, C.qce, mode);
      } else {
        C.ple = pleStar(rows, D, C.hr, mode);
        if (!(C.ple > 0)) {
          C.invalid =
            'p<sub>le</sub>* incalculable : pl* doit être > 0 sur [D ; D + h<sub>r</sub>].';
          R.cases.push(C);
          return;
        }
        C.De = deCalc(rows, D, C.ple, mode);
      }
      C.DeB = C.De / B;
      const kpr =
        essai === 'penetro'
          ? kcCalc(state.solCat, forme, B, L, C.DeB)
          : kpCalc(state.solCat, forme, B, L, C.DeB);
      C.kp = kpr.kp;
      C.kf = kpr.kf;
      C.kc = kpr.kc;
      C.kpx = kpr.x;
      C.cat = state.solCat;
      if (kpr.cap && !capWarned) {
        R.warn.push(
          'D<sub>e</sub>/B > 2 : facteur k<sub>p</sub> plafonné à sa valeur pour D<sub>e</sub>/B = 2 (NF P94-261).',
        );
        capWarned = true;
      }
      if (essai === 'penetro') {
        if (
          (state.solCat === 'argiles' && C.qce < 1) ||
          (state.solCat === 'sables' && C.qce < 1.5)
        ) {
          const wl =
            'q<sub>ce</sub> = ' +
            fmt(C.qce, 2) +
            ' MPa faible (< ' +
            (state.solCat === 'argiles' ? '1' : '1,5') +
            ' MPa) : pérennité de la portance à justifier par une étude particulière (NF P94-261, E.2.3(2)).';
          if (R.warn.indexOf(wl) < 0) R.warn.push(wl);
        }
      } else if (
        (state.solCat === 'argiles' && C.ple < 0.2) ||
        (state.solCat === 'sables' && C.ple < 0.3)
      ) {
        const wlow =
          'p<sub>le</sub>* = ' +
          fmt(C.ple, 2) +
          ' MPa faible (< ' +
          (state.solCat === 'argiles' ? '0,2' : '0,3') +
          ' MPa) : pérennité de la portance à justifier par une étude particulière (NF P94-261, D.2.3(2)).';
        if (R.warn.indexOf(wlow) < 0) R.warn.push(wlow);
      }
    }
    if (forme === 'circ') {
      if (Math.hypot(C.eB, C.eL) > 0.3 * B + 1e-9)
        C.notes.push(
          'Excentricité > 0,30·B : précautions spéciales requises (raideur du sol support, tolérances d’exécution ±0,10 m) — NF P94-261, 9.5(2).',
        );
    } else if (C.eB > B / 3 + 1e-9 || (forme !== 'filante' && C.eL > L / 3 + 1e-9)) {
      C.notes.push(
        'Excentricité > B/3 (ou L/3) : précautions spéciales requises (raideur du sol support, tolérances d’exécution ±0,10 m) — NF P94-261, 9.5(2).',
      );
    }
    if (C.etat === 'ELS_F')
      C.notes.push(
        'Limitation de la charge non exigée à l’ELS fréquent (NF P94-261, 13.4 vise QP et caractéristique) — résultat de portance fourni à titre indicatif.',
      );

    /* surface comprimée, surcharge R0, contrainte de référence (tous modes) */
    C.A = g.A;
    C.Ap = g.Ap;
    C.R0 = g.A * q0;
    C.gRv = gammaRv(C.etat);
    C.gRdv = 1.2;
    if (!(g.Ap > 0)) {
      C.invalid =
        'Surface comprimée A′ nulle : excentrement supérieur à la demi-dimension.';
      R.cases.push(C);
      return;
    }
    C.qref = Fz / g.Ap;

    /* coefficients d'inclinaison / talus (en labo, De pris égal à l'encastrement géométrique D) */
    const DeBi = labo ? D / B : C.DeB;
    const id = iDelta(C.delta, Math.min(DeBi, 2), c, phi, gAp, B);
    const ib = iBeta(beta, dT, B, Math.min(DeBi, 2), c, phi, gAp);
    C.idel = id.i;
    C.ibet = ib.i;
    if (talus && beta > 0 && state.talusDir === 'int') {
      C.idb = id.i > 1e-9 ? Math.min(ib.i / id.i, id.i) : 0;
      C.notes.push(
        'Charge inclinée vers l’intérieur du talus : iδβ = min(iβ/iδ ; iδ) = ' +
          fmt(C.idb, 3) +
          ' (NF P94-261, D.2.6.1).',
      );
    } else {
      C.idb = id.i * ib.i;
      if (talus && beta > 0)
        C.notes.push(
          'Charge inclinée vers l’extérieur du talus : cumul en produit iδ·iβ (NF P94-261, D.2.6).',
        );
    }

    if (!labo) {
      C.qnet =
        C.kp * C.ple * C.idb * 1000 /* kPa — ple = pl*(pressio) ou qce(pénétro), MPa */;
      C.Rvd = (g.Ap * C.qnet) / (C.gRv * C.gRdv);
      C.Rtot = C.R0 + C.Rvd;
      C.qRvd = C.Rtot / g.Ap /* contrainte résistante de calcul : R_v;d / A' (kPa) */;
      C.portOk = Fz <= C.Rtot + 1e-9;
      C.taux = Fz / C.Rtot;
    }

    /* portance analytique c–φ (annexe F) — complémentaire en pressio/pénétro, principale en labo */
    if (cphiOn || labo) {
      const drained = state.cphiMode === 'd' || (state.cphiMode !== 'nd' && phi > 0);
      let Bp,
        Lp,
        swap = false;
      if (forme === 'filante') {
        Bp = Math.max(B - 2 * C.eB, 0);
        Lp = Infinity;
      } else if (forme === 'circ') {
        const Rr = B / 2,
          ec = Math.min(Math.hypot(C.eB, C.eL), Rr * 0.999999);
        const s2 = Math.sqrt(Math.max(Rr * Rr - ec * ec, 1e-12));
        Bp = Math.sqrt((g.Ap * (Rr - ec)) / s2);
        Lp = Math.sqrt((g.Ap * s2) / (Rr - ec));
      } else {
        Bp = Math.max(B - 2 * C.eB, 0);
        Lp = Math.max((forme === 'carree' ? B : L) - 2 * C.eL, 0);
      }
      if (Lp !== Infinity && Bp > Lp) {
        const tp = Bp;
        Bp = Lp;
        Lp = tp;
        swap = true;
      }
      let theta =
        forme === 'filante'
          ? Math.PI / 2
          : C.H > 1e-9
            ? Math.atan2(Math.abs(Fx), Math.abs(Fy))
            : 0;
      if (swap) theta = Math.PI / 2 - theta;
      const gEff = gammaEffF(
        Number.isFinite(gSousV) && gSousV > 0 ? gSousV : gAp,
        hasW,
        zw,
        D,
        B,
      );
      const q0eff = Math.max(gAp * D - u, 0);
      const F: any = cphiCalc({
        drained: drained,
        c: c,
        phi: phi,
        Bp: Bp,
        Lp: Lp,
        Ap: g.Ap,
        V: Fz,
        H: C.H,
        theta: theta,
        q0eff: q0eff,
        gEff: gEff,
        alpha: 0,
      });
      if (F.err) {
        C.cphi = { err: F.err, drained: drained };
      } else {
        F.gRdv = drained ? 2.0 : 1.2;
        if (talus && beta > 0) {
          F.qnet *= C.ibet;
          F.talus = true;
        }
        F.Rvd = (g.Ap * F.qnet) / (C.gRv * F.gRdv);
        F.Rtot = C.R0 + F.Rvd;
        F.qRvd =
          F.Rtot / g.Ap /* contrainte résistante de calcul c–φ : R_v;d;F / A' (kPa) */;
        F.ok = Fz <= F.Rtot + 1e-9;
        F.taux = Fz / F.Rtot;
        F.Bp = Bp;
        F.Lp = Lp;
        F.gEff = gEff;
        F.q0eff = q0eff;
        C.cphi = F;
      }
      if (labo) {
        if (C.cphi.err) {
          C.invalid = C.cphi.err;
          R.cases.push(C);
          return;
        }
        C.qnet = C.cphi.qnet;
        C.Rvd = C.cphi.Rvd;
        C.Rtot = C.cphi.Rtot;
        C.qRvd = C.cphi.qRvd;
        C.gRdv = C.cphi.gRdv;
        C.portOk = C.cphi.ok;
        C.taux = C.cphi.taux;
      }
    }

    if (R.ctx.raid && Number.isFinite(R.ctx.raid.Kv) && R.ctx.raid.Kv > 0)
      C.dv = Fz / 1000 / R.ctx.raid.Kv;

    /* glissement : ELU uniquement */
    if (C.etat === 'ELU_F' || C.etat === 'ELU_A') {
      if (C.H > 1e-9) {
        C.gRh = C.etat === 'ELU_F' ? 1.1 : 1.0;
        C.gRdh = 1.1;
        if (phi > 0) {
          C.da = state.beton === 'coule' ? phi : (phi * 2) / 3;
          C.Rhd = (Fz * Math.tan((C.da * Math.PI) / 180)) / (C.gRh * C.gRdh);
          C.glisMode =
            'drainé (tan δ<sub>a</sub>, δ<sub>a</sub> = ' + fmt(C.da, 1) + '°)';
        } else {
          const r1 = (g.Ap * c) / (C.gRh * C.gRdh),
            r2 = 0.4 * Fz;
          C.Rhd = Math.min(r1, r2);
          C.glisMode =
            'non drainé (min(A′·c<sub>u</sub>/γ ; 0,4·V<sub>d</sub>)' +
            (r2 < r1 ? ' — plafond 0,4·V<sub>d</sub>' : '') +
            ')';
          if (!(c > 0))
            C.notes.push(
              'Glissement non drainé avec c<sub>u</sub> = 0 : résistance nulle, renseignez c<sub>u</sub> ou φ′.',
            );
        }
        C.glisOk = C.H <= C.Rhd + 1e-9;
        C.tauxH = C.H / Math.max(C.Rhd, 1e-12);
      } else {
        C.glisOk = null /* pas d'effort horizontal */;
      }
    } else C.glisOk = undefined /* non requis aux ELS */;

    /* tassement : ELS uniquement */
    if (C.etat.indexOf('ELS') === 0) {
      if (labo) {
        C.elast = tassementElastique(forme, B, L, eY, nuS, Math.max(C.qref - sv0, 0));
      } else if (essai === 'penetro') {
        C.oed = tassementOed(
          rows,
          forme,
          B,
          L,
          D,
          C.qref,
          num(state.alphaSang),
          mode,
          zmaxSond,
        );
        if (C.oed.warn)
          C.oed.warn.forEach(function (w: any) {
            if (R.warn.indexOf(w) < 0) R.warn.push(w);
          });
        C.schm = tassementSchmertmann(
          rows,
          forme,
          B,
          L,
          D,
          C.qref,
          sv0,
          gAv,
          zw,
          hasW,
          zmaxSond,
          mode,
        );
        if (C.schm.warn)
          C.schm.warn.forEach(function (w: any) {
            if (R.warn.indexOf(w) < 0) R.warn.push(w);
          });
      } else {
        C.tass = tassement(rows, forme, B, L, D, C.qref, sv0, zmaxSond, mode);
        C.tass.warn.forEach(function (w: any) {
          if (R.warn.indexOf(w) < 0) R.warn.push(w);
        });
      }
    }
    R.cases.push(C);
  });
  return R;
}

/* ===================== END ENGINE ===================== */

/**
 * Sortie BRUTE du moteur terzaghi (objet `R` interne, riche en intermediaires).
 * Type volontairement opaque : seul le contrat (contract.ts) decide ce qui est
 * expose au client. NE PAS exposer ce type tel quel cote front.
 */
export type TerzaghiRawResult = ReturnType<typeof computeAll>;

/** Point d'entree pur du moteur : `state` -> resultat BRUT (a projeter via le contrat). */
export function computeTerzaghi(state: unknown): TerzaghiRawResult {
  return computeAll(state);
}
