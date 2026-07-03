/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type
// PAS les internes du moteur (cela imposerait de modifier la science pour
// satisfaire noUncheckedIndexedAccess / no-var / no-unused-vars, ce que la
// consigne #46 interdit — `var`/variables mortes `xy`/`v2s` sont DANS le code
// d'origine, on ne les retire pas). Le TYPAGE STRICT vit a la frontiere
// (contract.ts/index.ts, eux verifies). La sortie brute est volontairement
// opaque puis projetee via le schema strict.
/**
 * MOTEUR BURMISTER (chaussees — methode rationnelle / AGEROUTE Senegal 2015).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/roadsens_burmister_LCPC_VF_moderne.html,
 * fonctions J0/J1, krLCPC/shLCPC/ksLCPC, inv4/matmul4/_P/_P0/_mul42,
 * burIntegrateMLWithPSC, doCalc). On NE reordonne RIEN, on NE corrige RIEN :
 * l'arbitre est l'equivalence-PORTAGE (module == HTML, rel 1e-9). `@ts-nocheck`
 * est ASSUME : c'est de la science transcrite, pas du code maison a typer.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'expose PAS de fonction de calcul pure : `doCalc()` lit l'etat dans
 * des VARIABLES GLOBALES (`ly`, `pf`, `tr`, `cp`) et le referentiel materiaux
 * `M`, calcule, ECRIT le resultat dans la globale `_D`, puis appelle `renderRes`
 * (DOM). On EXTRAIT ici la science de `doCalc` dans une fonction PURE
 * `computeBurmister(state)` : l'etat (couches, plateforme, trafic, charge) ET le
 * referentiel materiaux sont PASSES EN PARAMETRE (le referentiel AGEROUTE n'est
 * donc PAS code en dur cote calcul — voir AGEROUTE_MATERIALS, defaut/fixture).
 * Aucun DOM, aucune horloge, aucun hasard : deterministe.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#46) ---
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
export const BURMISTER_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// REFERENTIEL MATERIAUX AGEROUTE 2015 (defaut / fixture — INJECTE en parametre)
// ===========================================================================
//
// Valeurs telles que dans le HTML d'origine (const M). L'architecture #46 est
// preservee : la science pure (`doCalcPure`) recoit le referentiel en PARAMETRE
// `M` (il n'est pas code en dur dans le propagateur). Mais — integrite PV — ce
// parametre est desormais FIGE a cette table de REFERENCE ; il n'est plus jamais
// fourni par l'entree client (cf. `computeBurmister` + en-tete de contract.ts).
export const AGEROUTE_MATERIALS = {
  BBSG1: {
    n: 'BBSG classe 1  (E = 1 512 MPa — T.54)',
    E: 1512,
    E10: 7200,
    nu: 0.45,
    bit: 1,
    e6: 100,
    b: 5,
    kc: 1.1,
    sn: 0.3,
    c: '#1e1e1e',
    s: 'T.54',
  },
  BBSG2: {
    n: 'BBSG classe 2/3  (E = 1 896 MPa — T.54)',
    E: 1896,
    E10: 7200,
    nu: 0.45,
    bit: 1,
    e6: 100,
    b: 5,
    kc: 1.1,
    sn: 0.3,
    c: '#0a0a0a',
    s: 'T.54',
  },
  BBTM: {
    n: 'BB Très Mince (BBTM)',
    E: 2500,
    E10: 7200,
    nu: 0.45,
    bit: 1,
    e6: 100,
    b: 5,
    kc: 1.1,
    sn: 0.3,
    c: '#2a2a2a',
    s: 'T.54',
  },
  BBM: {
    n: 'BB Mince (BBM)',
    E: 2500,
    E10: 7200,
    nu: 0.45,
    bit: 1,
    e6: 100,
    b: 5,
    kc: 1.1,
    sn: 0.3,
    c: '#2f2f2f',
    s: 'T.54',
  },
  GB2: {
    n: 'Grave Bitume GB2',
    E: 2588,
    E10: 11880,
    nu: 0.45,
    bit: 1,
    e6: 80,
    b: 5,
    kc: 1.3,
    sn: 0.3,
    c: '#383838',
    s: 'T.44',
  },
  GB3: {
    n: 'Grave Bitume GB3',
    E: 2588,
    E10: 11880,
    nu: 0.45,
    bit: 1,
    e6: 90,
    b: 5,
    kc: 1.3,
    sn: 0.3,
    c: '#303030',
    s: 'T.44',
  },
  EME2: {
    n: 'EME2',
    E: 6151,
    E10: 16940,
    nu: 0.45,
    bit: 1,
    e6: 130,
    b: 5,
    kc: 1.0,
    sn: 0.25,
    c: '#1c1c1c',
    s: 'T.50',
  },
  GL1: { n: 'Latérite GL1', E: 200, nu: 0.35, c: '#c8a040' },
  GL2: { n: 'Latérite GL2', E: 400, nu: 0.35, c: '#c09030' },
  GLli: { n: 'Latérite litho-stabilisée', E: 400, nu: 0.35, c: '#b89838' },
  GLa: { n: 'Latérite améliorée (GLa)', E: 400, nu: 0.35, c: '#b0a040' },
  GLc1: {
    n: 'Latérite ciment GLc1',
    E: 2500,
    nu: 0.25,
    rig: 1,
    s6: 0.19,
    b: 11,
    kc: 1.4,
    sn: 1,
    c: '#8a7830',
    s: 'T.19',
  },
  GLc2: {
    n: 'Latérite ciment GLc2',
    E: 3000,
    nu: 0.25,
    rig: 1,
    s6: 0.37,
    b: 11,
    kc: 1.4,
    sn: 1,
    c: '#807030',
    s: 'T.19',
  },
  GNT1: { n: 'GNT1', E: 200, nu: 0.35, c: '#c8b06a' },
  GNT2: { n: 'GNT2', E: 150, nu: 0.35, c: '#c0a860' },
  GC3: {
    n: 'Grave Ciment GC-T3',
    E: 23000,
    nu: 0.25,
    rig: 1,
    s6: 0.75,
    b: 15,
    kc: 1.4,
    sn: 1,
    c: '#b0b098',
    s: 'T.33',
  },
  SC2: {
    n: 'Sable Ciment SC-T2',
    E: 12000,
    nu: 0.25,
    rig: 1,
    s6: 0.5,
    b: 12,
    kc: 1.5,
    sn: 0.8,
    Sh: 2.5,
    c: '#c0c0a0',
    s: 'T.33',
  },
  BQc: {
    n: 'Banco-coquillage (BQc)',
    E: 10000,
    nu: 0.25,
    rig: 1,
    s6: 0.3,
    b: 11,
    kc: 1.4,
    sn: 1,
    c: '#c8c0a8',
    s: 'T.35',
  },
  BC5: {
    n: 'Béton BC5',
    E: 35000,
    nu: 0.25,
    rig: 1,
    s6: 2.15,
    b: 16,
    kc: 1.5,
    sn: 1,
    Sh: 1,
    kd: 1 / 1.7,
    c: '#e0e0d0',
    s: 'T.37',
  }, // Kd non goujonne (goujonne : 1/1,47)
  BC2: {
    n: 'Béton Maigre BC2',
    E: 20000,
    nu: 0.25,
    rig: 1,
    s6: 1.37,
    b: 14,
    kc: 1.5,
    sn: 1,
    c: '#d0d0c8',
    s: 'T.37',
  },
} as const;

// ===========================================================================
// SCIENCE TRANSCRITE VERBATIM (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

// Fonctions de Bessel J0, J1 (Numerical Recipes — precision < 1e-7)
function J0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    return (
      (57568490574 +
        y *
          (-13362590354 +
            y *
              (651619640.7 +
                y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))))) /
      (57568490411 +
        y * (1029532985 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y)))))
    );
  }
  const z = 8 / ax,
    y = z * z,
    xx = ax - 0.785398164;
  const p1 =
    1 +
    y *
      (-0.1098628627e-2 +
        y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const q1 =
    -0.1562499995e-1 +
    y *
      (0.1430488765e-3 +
        y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * q1);
}
function J1(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const p =
      x *
      (72362614232 +
        y *
          (-7895059235 +
            y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.1611636)))));
    const q =
      144725228442 +
      y * (2300535178 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return p / q;
  }
  const z = 8 / ax,
    y = z * z,
    xx = ax - 2.356194491;
  const p1 =
    1 +
    y *
      (0.183105e-2 +
        y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const q1 =
    0.04687499995 +
    y *
      (-0.2002690873e-3 +
        y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * q1);
  return x < 0 ? -ans : ans;
}

const U_RISK = { 5: 1.645, 10: 1.282, 15: 1.036, 25: 0.674, 50: 0.0 };
// kr — LCPC 1994 (VI.4.2) : kr = 10^(-u·b·δ), δ = √(SN² + (c²/b²)·Sh²), c = 0,02 cm⁻¹
// b = pente de la loi de fatigue = -1/B (B = valeur stockee positive), Sh en cm
function krLCPC(r, sn, B, sh) {
  var u = U_RISK[r] !== undefined ? U_RISK[r] : 1.282;
  var delta = Math.sqrt(sn * sn + Math.pow(0.02 * B * sh, 2));
  return Math.pow(10, (-u * delta) / B);
}
// Sh (cm) — Tableau VI.2.4 LCPC : couches bitumineuses, e = epaisseur totale liee en cm
function shLCPC(e) {
  return e < 10 ? 1 : e < 15 ? 1 + 0.3 * (e - 10) : 2.5;
}
// ks — Tableau 69 AGEROUTE : module (MPa) de la couche sous-jacente au paquet lie
function ksLCPC(E) {
  return E < 50 ? 1 / 1.2 : E < 80 ? 1 / 1.1 : E < 120 ? 1 / 1.065 : 1;
}

// ── Algebre matricielle minimale ─────────────────────────────────────────

// Inverse 4×4 par Gauss-Jordan — retourne null si singulier
function inv4(A) {
  const n = 4;
  const M = A.map((row) => [...row]);
  const I = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
    [M[col], M[piv]] = [M[piv], M[col]];
    [I[col], I[piv]] = [I[piv], I[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-30) return null;
    for (let j = 0; j < n; j++) {
      M[col][j] /= d;
      I[col][j] /= d;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = 0; j < n; j++) {
        M[row][j] -= f * M[col][j];
        I[row][j] -= f * I[col][j];
      }
    }
  }
  return I;
}

// Produit 4×4 × 4×4
function matmul4(A, B) {
  const C = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

// Matrice P_local(z_loc) : Y(z_loc) = P @ [A,B,C,D]
// z_loc = profondeur locale depuis le sommet de la couche (z_loc ∈ [0, h])
function _P(m, zl, E, nu) {
  const f = (1 + nu) / E,
    v12 = 1 - 2 * nu,
    v2 = 2 * nu,
    mz = m * zl;
  const ep = Math.exp(mz),
    em = Math.exp(-mz);
  return [
    [m * m * ep, m * m * em, -m * (v12 - mz) * ep, m * (v12 + mz) * em],
    [m * m * ep, -m * m * em, m * (v2 + mz) * ep, m * (v2 - mz) * em],
    [
      f * m * m * ep,
      -f * m * m * em,
      -f * m * (2 - 4 * nu - mz) * ep,
      -f * m * (2 - 4 * nu + mz) * em,
    ],
    [f * m * m * ep, f * m * m * em, f * m * (1 + mz) * ep, -f * m * (1 - mz) * em],
  ];
}

// P_local(0) — sommet de couche
function _P0(m, E, nu) {
  const f = (1 + nu) / E,
    v12 = 1 - 2 * nu,
    v2 = 2 * nu;
  return [
    [m * m, m * m, -m * v12, m * v12],
    [m * m, -m * m, m * v2, m * v2],
    [f * m * m, -f * m * m, -f * m * (2 - 4 * nu), -f * m * (2 - 4 * nu)],
    [f * m * m, f * m * m, f * m, -f * m],
  ];
}

// Produit 4×2 = 4×4 @ 4×2
function _mul42(A, B) {
  const C = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 2; j++) for (let k = 0; k < 4; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

function burIntegrateMLWithPSC(r, layers, subgrade, a, q, Np) {
  Np = Np || 400;
  const n = layers.length;
  const H_tot = layers.reduce((s, l) => s + l.h, 0);
  const mMax = 100 / Math.max(H_tot, a); // mMax eleve pour convergence
  const dm = mMax / Np;

  const sz_acc = new Float64Array(n + 1);
  const sr_acc = new Float64Array(n + 1);
  const sth_acc = new Float64Array(n + 1);
  const srT_acc = new Float64Array(n + 1); // σ_r au SOMMET de la couche i (z_loc=0)
  const sthT_acc = new Float64Array(n + 1); // σ_θ au SOMMET de la couche i

  for (let ip = 0; ip < Np; ip++) {
    const m = (ip + 0.5) * dm;
    const nu_s = subgrade.nu,
      E_s = subgrade.E;
    const v12s = 1 - 2 * nu_s,
      v2s = 2 * nu_s;

    // PSC : colonnes B,D de P_local(0,E_s,nu_s)
    const P0s = _P0(m, E_s, nu_s);
    // 4×2 : colonnes 1 et 3 de P0s (indices B et D)
    let S = [
      [P0s[0][1], P0s[0][3]],
      [P0s[1][1], P0s[1][3]],
      [P0s[2][1], P0s[2][3]],
      [P0s[3][1], P0s[3][3]],
    ];

    const base_states = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      base_states[i] = S;
      const li = layers[i];
      const Ei = li.E,
        nui = li.nu,
        hi = li.h;
      const P0i = _P0(m, Ei, nui);
      const Phi = _P(m, hi, Ei, nui);
      const Phi_inv = inv4(Phi);
      if (!Phi_inv) {
        S = [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ];
        break;
      }
      S = _mul42(matmul4(P0i, Phi_inv), S);
    }

    // CL surface : F_z=1, F_r=0
    const a00 = S[0][0],
      a01 = S[0][1],
      a10 = S[1][0],
      a11 = S[1][1];
    const det = a00 * a11 - a01 * a10;
    if (Math.abs(det) < 1e-30) continue;
    const Bs = a11 / det; // resolution : [Bs,Ds] tel que S[:2]@[Bs,Ds]=[1,0]
    const Ds = -a10 / det;
    const xy = [Bs, Ds];

    const kern = a * J1(m * a);
    if (Math.abs(kern) < 1e-16) continue;
    const mr = m * r;
    const J0mr = J0(mr),
      J1mr_r = mr > 1e-8 ? J1(mr) / mr : 0.5;

    // Interfaces (base de chaque couche)
    for (let i = 0; i < n; i++) {
      const Si = base_states[i];
      const f1 = Si[0][0] * Bs + Si[0][1] * Ds;
      sz_acc[i] += kern * f1 * J0mr * dm;

      // σ_r via ABCD a la base de la couche i (z_loc=h_i)
      const li = layers[i];
      const Ei = li.E,
        nui = li.nu,
        hi = li.h;
      const Phi = _P(m, hi, Ei, nui);
      const Phi_inv = inv4(Phi);
      if (!Phi_inv) continue;
      const sv = [
        Si[0][0] * Bs + Si[0][1] * Ds,
        Si[1][0] * Bs + Si[1][1] * Ds,
        Si[2][0] * Bs + Si[2][1] * Ds,
        Si[3][0] * Bs + Si[3][1] * Ds,
      ];
      const ABCD = [0, 0, 0, 0];
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) ABCD[row] += Phi_inv[row][col] * sv[col];
      const Ai = ABCD[0],
        Bi = ABCD[1],
        Ci = ABCD[2],
        Di = ABCD[3];
      const mh = m * hi,
        ep = Math.exp(mh),
        em = Math.exp(-mh);
      const v21 = 1 + 2 * nui;
      const p0 =
        Ai * m * m * ep +
        Bi * m * m * em +
        Ci * m * (v21 + mh) * ep -
        Di * m * (v21 - mh) * em;
      const p1 =
        Ai * m * m * ep +
        Bi * m * m * em +
        Ci * m * (1 + mh) * ep -
        Di * m * (1 - mh) * em;
      sr_acc[i] += kern * (p0 * J0mr - p1 * J1mr_r) * dm;
      // σ_θ BISAR : noyau = (p0−p1)·J₀ + p1·J₁mr_r
      // Derive de la decomposition en harmoniques spheriques (de Jong 1973)
      sth_acc[i] += kern * ((p0 - p1) * J0mr + p1 * J1mr_r) * dm;
      // σ_r/σ_θ au SOMMET de la couche i (z_loc=0, memes ABCD) — necessaire pour
      // le critere ε_z au sommet des couches non liees (§4.1.2 LCPC) : σ_r/σ_θ
      // sont discontinus aux interfaces, il faut la valeur cote couche inferieure
      const p0t = (Ai + Bi) * m * m + (Ci - Di) * m * v21;
      const p1t = (Ai + Bi) * m * m + (Ci - Di) * m;
      srT_acc[i] += kern * (p0t * J0mr - p1t * J1mr_r) * dm;
      sthT_acc[i] += kern * ((p0t - p1t) * J0mr + p1t * J1mr_r) * dm;
    }

    // Sommet PSC (z_loc=0, A=C=0)
    const sz_psc = Bs * m * m + Ds * m * v12s;
    sz_acc[n] += kern * sz_psc * J0mr * dm;
    const v21s = 1 + 2 * nu_s;
    const sr_psc_p0 = Bs * m * m - Ds * m * v21s;
    const sr_psc_p1 = Bs * m * m - Ds * m;
    sr_acc[n] += kern * (sr_psc_p0 * J0mr - sr_psc_p1 * J1mr_r) * dm;
    // σ_θ PSC — meme noyau BISAR que les interfaces : (p0−p1)·J₀ + p1·J₁/mr
    // (valide contre Alize-LCPC : σθ sommet PF = -0,7 kPa vs -1 kPa Alize)
    sth_acc[n] += kern * ((sr_psc_p0 - sr_psc_p1) * J0mr + sr_psc_p1 * J1mr_r) * dm;
  }

  // Signes : σ_z = +q·sz_acc, σ_r = −q·sr_acc, σ_θ = −q·sth_acc
  const result = [];
  // srT/sthT : sommet de couche (pour le PSC, les valeurs d'interface SONT deja le sommet)
  for (let i = 0; i <= n; i++) {
    result.push({
      sz: q * sz_acc[i],
      sr: -q * sr_acc[i],
      sth: -q * sth_acc[i],
      srT: i < n ? -q * srT_acc[i] : -q * sr_acc[n],
      sthT: i < n ? -q * sthT_acc[i] : -q * sth_acc[n],
    });
  }
  return result; // index 0..n-1 = base couches, index n = sommet PSC
}

// ===========================================================================
// CALCUL PRINCIPAL — extraction PURE de doCalc (etat injecte, pas de DOM)
// ===========================================================================
//
// Transcription FIDELE de doCalc(). Les seules differences avec le HTML :
//   - `M`, `ly`, `pf`, `tr`, `cp` ne sont plus des GLOBALES mais des PARAMETRES
//     (deballes ici depuis `state`) ;
//   - on RETOURNE l'objet `_D` au lieu de l'ecrire dans une globale et d'appeler
//     `renderRes`/`renderDetails` (DOM). Le calcul de `_D` est IDENTIQUE.
//   - `calcNE()` est inline (il ne lit que `tr`).
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

function doCalcPure(M, ly, pf, tr, cp) {
  // calcNE() inline (HTML : lit la globale tr)
  const NE = (() => {
    const t = tr.tau / 100,
      C = Math.abs(t) < 1e-4 ? tr.N : (Math.pow(1 + t, tr.N) - 1) / t;
    return 365 * tr.T * C * tr.C * tr.dir * tr.tv;
  })();
  const { p, a, d } = cp;
  const nL = ly.length;
  // Risque effectif — Tableau 70 AGEROUTE : 25 % si NE < 3 millions (C1-C4), 5 % au-dela (C5-C8)
  const rEff = cp.r === 'auto' ? (NE < 3e6 ? 25 : 5) : +cp.r;

  // ── Identifier la fin du paquet bitumineux/MTLH ──────────
  let bitEnd = nL;
  for (let i = 0; i < nL; i++) {
    const m = M[ly[i].mat];
    if (m && !m.bit && !m.rig) {
      bitEnd = i;
      break;
    }
  }
  const hasBit = bitEnd > 0;

  // ── Famille de structure (LCPC 1994 §1.2) → criteres a verifier (§4.2-4.5) ──
  const isBit = (i) => {
    const m = M[ly[i].mat];
    return m && m.bit;
  };
  const isRig = (i) => {
    const m = M[ly[i].mat];
    return m && m.rig;
  };
  let h_bitP = 0,
    h_rigP = 0; // epaisseurs dans le paquet de surface
  for (let i = 0; i < bitEnd; i++) {
    if (isBit(i)) h_bitP += ly[i].h;
    else if (isRig(i)) h_rigP += ly[i].h;
  }
  // Segment MTLH PROFOND (sous une couche granulaire) → structure inverse (§4.5)
  let dR0 = -1,
    dR1 = -1;
  for (let i = bitEnd; i < nL; i++) {
    if (isRig(i)) {
      if (dR0 < 0) dR0 = i;
      dR1 = i;
    } else if (dR0 >= 0) break;
  }
  const Kmix = h_bitP + h_rigP > 0 ? h_bitP / (h_bitP + h_rigP) : 0;
  let famille, etRequis;
  if (dR0 >= 0) {
    famille = 'inverse (§4.5)';
    etRequis = true;
  } else if (h_rigP > 0 && h_bitP > 0) {
    if (Kmix >= 0.5) {
      famille = 'mixte (§4.4, K=' + Kmix.toFixed(2) + ')';
      etRequis = true;
    } else {
      famille = 'semi-rigide (§4.3, K=' + Kmix.toFixed(2) + '<0,5)';
      etRequis = false;
    }
  } else if (h_rigP > 0) {
    famille = 'semi-rigide (§4.3)';
    etRequis = false;
  } else if (h_bitP > 0 && h_bitP <= 0.15 && NE < 250000) {
    famille = 'souple à faible trafic (§4.2.2)';
    etRequis = false;
  } else if (h_bitP > 0 && h_bitP < 0.15) {
    famille = 'souple (§4.2)';
    etRequis = true;
  } else if (h_bitP > 0) {
    famille = 'bitumineuse épaisse (§4.2)';
    etRequis = true;
  } else {
    famille = 'granulaire';
    etRequis = false;
  }

  // ── Preparer les couches pour le moteur multi-couche ─────
  const subgrade = { E: pf.E, nu: pf.nu };
  const layers = ly.map((l) => ({ E: l.E, nu: l.nu, h: l.h, mat: l.mat }));

  // ── ε_t : Burmister multi-couche exact + dual wheels ──────
  // Critere fatigue = fond du PREMIER paquet lie (base de couche bitEnd-1)
  // = interface index bitEnd-1 dans le resultat de burIntegrateMLWithPSC
  let et_val = null,
    et_adm = null,
    et2_val = null,
    et2_adm = null,
    et2_i = -1,
    st2_val = null,
    st2_adm = null,
    st2_i = -1,
    rigL = null;
  let s0 = { sz: 0, sr: 0 },
    sd2 = { sz: 0, sr: 0 };
  let et_r0 = 0,
    et_rd2 = 0;
  var minE6 = Infinity,
    useB = 5,
    useKc = 1.3,
    useSN = 0.3,
    useKth = 1,
    useRig = 0,
    Sh_b = 2.5,
    ks_b = 1,
    kr_b = 1;
  let bz = { sz: 0, sr: 0 }; // sommet PSC

  const nu_bit = hasBit ? ly[bitEnd - 1].nu : 0;
  const E_bit = hasBit ? ly[bitEnd - 1].E : 1;

  // ── Burmister aux 3 positions + superposition jumelage ─────
  // r=0 : σ_total = σ(r=0) + σ(r=d)   [roue1 + roue2]
  // r=d/2 : σ_total = 2·σ(r=d/2)       [symetrie entre-roues]
  const _r0 = burIntegrateMLWithPSC(0, layers, subgrade, a, p, 400);
  const _rd2 = burIntegrateMLWithPSC(d / 2, layers, subgrade, a, p, 400);
  const _rd = burIntegrateMLWithPSC(d, layers, subgrade, a, p, 400);
  function _sup(i) {
    return { sz: _r0[i].sz + _rd[i].sz, sr: _r0[i].sr + _rd[i].sr };
  }
  function _mid(i) {
    return { sz: 2 * _rd2[i].sz, sr: 2 * _rd2[i].sr };
  }
  bz = _sup(nL);

  if (hasBit) {
    const idx = bitEnd - 1; // base du dernier bitumineux = interface critique fatigue
    // Decomposition 3D cartesienne (BISAR, de Jong 1973) :
    // Au point (0,0,z) sous la roue 1, direction x = axe de l'essieu :
    //   σ_xx = σ_r(roue1,r=0) + σ_r(roue2,r=d)    [radial des deux roues]
    //   σ_yy = σ_r(roue1,r=0) + σ_θ(roue2,r=d)    [tangentiel roue2]
    //   σ_zz = σ_z(r=0) + σ_z(r=d)
    // Au point (d/2,0,z) entre les roues :
    //   σ_xx = 2·σ_r(r=d/2)    σ_yy = 2·σ_θ(r=d/2)
    const sxx_r0 = _r0[idx].sr + _rd[idx].sr;
    const syy_r0 = _r0[idx].sr + _rd[idx].sth;
    const szz_r0 = _r0[idx].sz + _rd[idx].sz;
    const sxx_rd2 = 2 * _rd2[idx].sr;
    const syy_rd2 = 2 * _rd2[idx].sth;
    const szz_rd2 = 2 * _rd2[idx].sz;

    // Loi de Hooke 3D : ε_xx = (σ_xx - ν·(σ_yy+σ_zz)) / E
    et_r0 = ((sxx_r0 - nu_bit * (syy_r0 + szz_r0)) / E_bit) * 1e6;
    et_rd2 = ((syy_rd2 - nu_bit * (sxx_rd2 + szz_rd2)) / E_bit) * 1e6;
    const et_r0_yy = ((syy_r0 - nu_bit * (sxx_r0 + szz_r0)) / E_bit) * 1e6;
    const et_rd2_xx = ((sxx_rd2 - nu_bit * (syy_rd2 + szz_rd2)) / E_bit) * 1e6;
    // Extension maximale (traction = negatif dans cette convention) — comme la
    // « traction principale majeure » d'Alize ; la compression ne fatigue pas en flexion
    et_val = Math.max(0, -Math.min(et_r0, et_r0_yy, et_rd2, et_rd2_xx));

    // σ aux interfaces critiques pour affichage
    s0 = _sup(idx);
    sd2 = _mid(idx);

    // Materiau dimensionnant = couche la plus profonde du paquet lie
    // (le critere s'applique a SA base — pas le min des ε₆ du paquet)
    const mD = M[ly[idx].mat] || {};
    useB = mD.b || 5;
    useKc = mD.kc || 1.3;
    useSN = mD.sn || 0.3;
    useRig = mD.rig ? 1 : 0;
    useKth = mD.bit && mD.E10 ? Math.sqrt(mD.E10 / ly[idx].E) : 1;
    minE6 = mD.bit ? mD.e6 : mD.rig ? mD.s6 : Infinity; // ε₆ [μdef] ou σ₆ [MPa]
    // Sh : manuel si defini, sinon Tab. VI.2.4 (bitumineux) ou 3 cm (MTLH, §VI.2.5.3)
    Sh_b =
      cp.sh !== 'auto'
        ? +cp.sh
        : useRig
          ? mD.Sh || 3
          : shLCPC(ly.slice(0, bitEnd).reduce((s, l) => s + l.h, 0) * 100);
    // ks : manuel si defini, sinon module de la couche sous-jacente (Nota Tab. VI.4.3)
    ks_b = cp.ks !== 'auto' ? +cp.ks : ksLCPC(bitEnd < nL ? ly[bitEnd].E : pf.E);
    kr_b = krLCPC(rEff, useSN, useB, Sh_b);
    if (minE6 < Infinity) {
      if (useRig) {
        // Critere MTLH/beton (§4.3.3 LCPC) : CONTRAINTE de traction σ_t a la base [MPa]
        // σ_t,adm = σ₆·(NE/10⁶)^b·kr·kc·ks·kd — kd=1 pour graves traitees ≤ classe G3
        et_val = Math.max(0, -Math.min(sxx_r0, syy_r0, sxx_rd2, syy_rd2)); // traction = negatif
        // kd = 1/1,25 pour graves G4/G5 et BCR (champ kd du materiau), 1 sinon
        et_adm =
          minE6 * Math.pow(1e6 / NE, 1 / useB) * kr_b * useKc * ks_b * (mD.kd || 1);

        // ── Tableau 68 AGEROUTE : interfaces entre couches traitees ──
        // GC/SC/GLc/BQc base/fondation : SEMI-COLLEE (demi-somme colle + glissant)
        // BC5/BC2 : GLISSANTE · σ_t verifie a la base de CHAQUE couche (LCPC §4.3.2)
        const rigs = [];
        for (let i = 0; i < bitEnd; i++) if (isRig(i)) rigs.push(i);
        if (rigs.length >= 2 && rigs[rigs.length - 1] === rigs[0] + rigs.length - 1) {
          const allBC = rigs.every((i) => String(ly[i].mat).indexOf('BC') === 0);
          const modeI = allBC ? 'glissante' : 'semi-collée';
          // Configuration glissante : inter-couche mince quasi-incompressible
          // (E=1 MPa, ν=0,499, h=5 mm) a chaque interface rigide/rigide
          const layG = [];
          const map = {};
          let off = 0;
          for (let i = 0; i < layers.length; i++) {
            map[i] = i + off;
            layG.push({ E: layers[i].E, nu: layers[i].nu, h: layers[i].h });
            if (rigs.indexOf(i) >= 0 && rigs.indexOf(i + 1) >= 0) {
              layG.push({ E: 1, nu: 0.499, h: 0.005 });
              off++;
            }
          }
          const _g0 = burIntegrateMLWithPSC(0, layG, subgrade, a, p, 400);
          const _gd2 = burIntegrateMLWithPSC(d / 2, layG, subgrade, a, p, 400);
          const _gd = burIntegrateMLWithPSC(d, layG, subgrade, a, p, 400);
          const stOf = (R0, R2, RD, j) =>
            Math.max(
              0,
              -Math.min(
                R0[j].sr + RD[j].sr,
                R0[j].sr + RD[j].sth,
                2 * R2[j].sr,
                2 * R2[j].sth,
              ),
            );
          rigL = [];
          let worst = 0;
          for (const i of rigs) {
            const mi = M[ly[i].mat];
            if (!mi) continue;
            const stC = stOf(_r0, _rd2, _rd, i);
            const stG = stOf(_g0, _gd2, _gd, map[i]);
            const st = modeI === 'glissante' ? stG : (stC + stG) / 2;
            const ksI =
              cp.ks !== 'auto'
                ? +cp.ks
                : ksLCPC(i + 1 < bitEnd ? 1e9 : i + 1 < nL ? ly[i + 1].E : pf.E);
            const ShI = cp.sh !== 'auto' ? +cp.sh : mi.Sh || 3;
            const admI =
              mi.s6 *
              Math.pow(1e6 / NE, 1 / mi.b) *
              krLCPC(rEff, mi.sn || 0.3, mi.b, ShI) *
              mi.kc *
              ksI *
              (mi.kd || 1);
            rigL.push({ i: i, mode: modeI, stC: stC, stG: stG, st: st, adm: admI });
            if (st / admI > worst) {
              worst = st / admI;
              et_val = st;
              et_adm = admI;
            }
          }
        }
      } else {
        // Critere bitumineux (VI.4.2) : ε_t,adm = ε₆·kθ·(NE/10⁶)^b·kr·kc·ks
        et_adm = minE6 * useKth * Math.pow(1e6 / NE, 1 / useB) * kr_b * useKc * ks_b;
      }
    }

    // ── Mixte/semi-rigide : ε_t a la base de la derniere couche bitumineuse ──
    // §4.4.1 PHASE 2 : MTLH fissure (module residuel E/5) ET interface
    // bitumineux/MTLH GLISSANTE, emulee par une inter-couche mince quasi-
    // incompressible (E=1 MPa, ν=0,499, h=5 mm) : transmet σ_z, glisse en
    // cisaillement. Valide : bicouche test colle 21,5 → glissant 317 μdef.
    if (useRig) {
      let i2 = -1;
      for (let i = idx - 1; i >= 0; i--) {
        const m2 = M[ly[i].mat];
        if (m2 && m2.bit) {
          i2 = i;
          break;
        }
      }
      if (i2 >= 0) {
        const m2 = M[ly[i2].mat];
        // Phase 2 : MTLH a E/5 + inter-couche glissante apres la derniere couche bitumineuse
        const layP2 = [];
        for (let i = 0; i < layers.length; i++) {
          const l = layers[i];
          layP2.push(
            i < bitEnd && isRig(i)
              ? { E: l.E / 5, nu: l.nu, h: l.h }
              : { E: l.E, nu: l.nu, h: l.h },
          );
          if (i === i2) layP2.push({ E: 1, nu: 0.499, h: 0.005 });
        }
        const _q0 = burIntegrateMLWithPSC(0, layP2, subgrade, a, p, 400);
        const _qd2 = burIntegrateMLWithPSC(d / 2, layP2, subgrade, a, p, 400);
        const _qd = burIntegrateMLWithPSC(d, layP2, subgrade, a, p, 400);
        const sx0 = _q0[i2].sr + _qd[i2].sr,
          sy0 = _q0[i2].sr + _qd[i2].sth,
          sz0 = _q0[i2].sz + _qd[i2].sz;
        const sxM = 2 * _qd2[i2].sr,
          syM = 2 * _qd2[i2].sth,
          szM = 2 * _qd2[i2].sz;
        const nu2 = ly[i2].nu,
          E2 = ly[i2].E;
        et2_val = Math.max(
          0,
          -Math.min(
            ((sx0 - nu2 * (sy0 + sz0)) / E2) * 1e6,
            ((sy0 - nu2 * (sx0 + sz0)) / E2) * 1e6,
            ((sxM - nu2 * (syM + szM)) / E2) * 1e6,
            ((syM - nu2 * (sxM + szM)) / E2) * 1e6,
          ),
        );
        const Sh2 =
          cp.sh !== 'auto'
            ? +cp.sh
            : shLCPC(ly.slice(0, i2 + 1).reduce((s, l) => s + l.h, 0) * 100);
        const ks2 = cp.ks !== 'auto' ? +cp.ks : ksLCPC(ly[i2 + 1].E / 5); // support = MTLH fissure
        const kth2 = m2.E10 ? Math.sqrt(m2.E10 / ly[i2].E) : 1;
        et2_adm =
          m2.e6 *
          kth2 *
          Math.pow(1e6 / NE, 1 / m2.b) *
          krLCPC(rEff, m2.sn || 0.3, m2.b, Sh2) *
          m2.kc *
          ks2;
        et2_i = i2;
      }
    }

    // ── Structure inverse (§4.5) : σ_t a la base du segment MTLH PROFOND ──
    if (dR0 >= 0) {
      const mR = M[ly[dR1].mat];
      if (mR && mR.rig) {
        const rx0 = _r0[dR1].sr + _rd[dR1].sr,
          ry0 = _r0[dR1].sr + _rd[dR1].sth;
        const rxM = 2 * _rd2[dR1].sr,
          ryM = 2 * _rd2[dR1].sth;
        st2_val = Math.max(0, -Math.min(rx0, ry0, rxM, ryM));
        const ksR =
          cp.ks !== 'auto' ? +cp.ks : ksLCPC(dR1 + 1 < nL ? ly[dR1 + 1].E : pf.E);
        const ShR = cp.sh !== 'auto' ? +cp.sh : mR.Sh || 3;
        st2_adm =
          mR.s6 *
          Math.pow(1e6 / NE, 1 / mR.b) *
          krLCPC(rEff, mR.sn || 0.3, mR.b, ShR) *
          mR.kc *
          ksR *
          (mR.kd || 1);
        st2_i = dR1;
      }
    }
  }

  // ── ε_z au sommet PSC — formule 3D exacte ──────
  // σ_xx_psc = σ_r(r=0)+σ_r(r=d),  σ_yy_psc = σ_r(r=0)+σ_θ(r=d) [formule exacte PSC]
  const bz_syy = _r0[nL].sr + _rd[nL].sth;
  const ez_axe = ((bz.sz - pf.nu * (bz.sr + bz_syy)) / pf.E) * 1e6;
  // Vertical entre-jumelage (Alize retient le max des deux verticales)
  const ez_mid =
    ((2 * _rd2[nL].sz - pf.nu * (2 * _rd2[nL].sr + 2 * _rd2[nL].sth)) / pf.E) * 1e6;

  // ── ε_z au sommet des couches granulaires non liees (§4.1.2 LCPC, comme Alize) ──
  // σ_z continu (= base couche i-1) · σ_r/σ_θ cote couche i via srT/sthT
  let ezL = [];
  for (let i = Math.max(bitEnd, 1); i < nL; i++) {
    const m = M[ly[i].mat];
    if (!m || m.bit || m.rig) continue;
    const Ei = ly[i].E,
      nui = ly[i].nu;
    const szA = _r0[i - 1].sz + _rd[i - 1].sz,
      sxA = _r0[i].srT + _rd[i].srT,
      syA = _r0[i].srT + _rd[i].sthT;
    const szM = 2 * _rd2[i - 1].sz,
      sxM = 2 * _rd2[i].srT,
      syM = 2 * _rd2[i].sthT;
    const eA = ((szA - nui * (sxA + syA)) / Ei) * 1e6,
      eM = ((szM - nui * (sxM + syM)) / Ei) * 1e6;
    ezL.push({ i: i, axe: eA, mid: eM, val: Math.max(eA, eM) });
  }
  // §4.1.2 : exemption UNIQUEMENT pour les chaussees souples a faible trafic
  // (NE < 250 000 ET couverture bitumineuse mince sur assise granulaire).
  // « Autres cas » du guide (bitumineuse epaisse sur fondation GNT, inverse...) : toujours verifie.
  const gntReq = !(NE < 250000 && h_bitP <= 0.15 && h_rigP === 0 && dR0 < 0);
  const ezGNT = ezL.length
    ? Math.max.apply(
        null,
        ezL.map((x) => x.val),
      )
    : null;
  const ez_val = Math.max(ez_axe, ez_mid, gntReq && ezGNT != null ? ezGNT : -Infinity);
  // Catalogue AGEROUTE p.124 : ε_z,adm = A·NE^(−1/4,5) — A = 16 000 si NE ≤ 250 000, 12 000 sinon
  const ez_adm = (NE <= 250000 ? 16000 : 12000) * Math.pow(NE, -1 / 4.5);

  // Verdicts selon la famille (§4.2-4.5) : ε_t exige seulement si la famille le requiert
  const okMain = et_val === null || et_adm === null || et_val <= et_adm;
  const okEt2 = et2_val === null || et2_val <= et2_adm;
  const okSt2 = st2_val === null || st2_val <= st2_adm;
  // semi-rigide : seul σ_t (critere principal) est exige ; souple faible trafic : ε_t informatif
  const passT =
    (useRig ? okMain && (etRequis ? okEt2 : true) : etRequis ? okMain : true) && okSt2;
  const passZ = ez_val <= ez_adm;
  const PASS = passT && passZ;

  // Epaisseur reelle du paquet bitumineux (sans Odemark)
  const H_bit_reel = hasBit ? ly.slice(0, bitEnd).reduce((s, l) => s + l.h, 0) : 0;
  const H_tot_reel = ly.reduce((s, l) => s + l.h, 0);
  const h_bit = H_bit_reel > 0 ? H_bit_reel : 0;
  const E1_pond =
    hasBit && h_bit > 0
      ? ly.slice(0, bitEnd).reduce((s, l) => s + l.E * l.h, 0) / h_bit
      : 0;
  const nu1_pond =
    hasBit && h_bit > 0
      ? ly.slice(0, bitEnd).reduce((s, l) => s + l.nu * l.h, 0) / h_bit
      : 0;

  const _D = {
    NE: NE,
    H_bit: H_bit_reel,
    H_tot: H_tot_reel,
    E1: E1_pond,
    nu1: nu1_pond,
    Eref: pf.E,
    nuRef: pf.nu,
    K: null,
    L: null,
    nkl: null,
    et: et_val,
    etA: et_adm,
    et0: et_r0,
    etM: et_rd2,
    s0: s0,
    sd2: sd2,
    ez: ez_val,
    ez0: ez_axe,
    ezM: ez_mid,
    ezA: ez_adm,
    passT: passT,
    passZ: passZ,
    PASS: PASS,
    hasBit: hasBit,
    e6: minE6,
    ub: useB,
    ukc: useKc,
    usn: useSN,
    ukth: useKth,
    sig: useRig,
    kr: kr_b,
    sh: Sh_b,
    ks: ks_b,
    bz: bz,
    be: bitEnd,
    ezL: ezL,
    gq: gntReq,
    et2: et2_val,
    et2A: et2_adm,
    et2i: et2_i,
    rEff: rEff,
    st2: st2_val,
    st2A: st2_adm,
    st2i: st2_i,
    fam: famille,
    etReq: etRequis,
    rigL: rigL,
    lys: JSON.parse(JSON.stringify(ly)),
    pfs: { cls: pf.cls, E: pf.E, nu: pf.nu },
    cps: { p: cp.p, a: cp.a, d: cp.d, r: cp.r },
    trs: { T: tr.T, C: tr.C, N: tr.N, tau: tr.tau },
  };
  return _D;
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule le dimensionnement Burmister a partir d'un ETAT complet (pas de DOM,
 * pas de globale).
 *
 * CALIBRATION VERROUILLEE (integrite PV, defense en profondeur) : le referentiel
 * materiaux `M` est TOUJOURS la table de REFERENCE `AGEROUTE_MATERIALS` (θ=34 °C).
 * On n'accepte JAMAIS `state.materials` : le contrat d'entree rejette deja cette
 * cle (400, `.strict()`) — cette ligne est la 2e barriere (si un appelant court-
 * circuitait le parse, aucune calibration client ne peut atteindre le calcul ni
 * le PV). `doCalcPure` conserve `M` en parametre (#46 : pas de codage en dur dans
 * la science) ; c'est la VALEUR injectee qui est figee, pas l'architecture.
 *
 * Renvoie l'objet de resultat BRUT `_D` (identique au HTML), OU `{ err }` si la
 * science leve (parite avec le `try/catch` du HTML : `runCalc` affiche e.message).
 * La PROJECTION client-safe est faite par index.ts (whitelist + redaction).
 */
export function computeBurmister(state) {
  const M = AGEROUTE_MATERIALS;
  const ly = state && Array.isArray(state.layers) ? state.layers : [];
  const pf = state && state.subgrade ? state.subgrade : {};
  const tr = state && state.traffic ? state.traffic : {};
  const cp = state && state.load ? state.load : {};
  try {
    return doCalcPure(M, ly, pf, tr, cp);
  } catch (e) {
    // Parite avec le HTML : runCalc capture l'exception de doCalc et n'affiche que
    // e.message. On expose donc UNIQUEMENT le message (borne plus loin), jamais la
    // stack ni un intermediaire.
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
