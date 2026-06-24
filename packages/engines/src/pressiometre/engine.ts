/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type
// PAS les internes du moteur (cela imposerait de modifier la science pour
// satisfaire noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE
// STRICT vit a la frontiere (contract.ts/index.ts, eux verifies). La sortie brute
// est volontairement opaque puis projetee via le schema strict.
/**
 * MOTEUR PRESSIOMETRE MENARD (essai pressiometrique — NF EN ISO 22476-4).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/pressiometre__1_.html, fonctions
 * `calcDepth`, `getAlpha`, `fitAll`, `fitRecip`, `linReg`). On NE reordonne RIEN,
 * on NE corrige RIEN : l'arbitre est l'equivalence-PORTAGE (module == HTML,
 * rel 1e-9). `@ts-nocheck` est ASSUME : c'est de la science transcrite, pas du
 * code maison a typer.
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * Le HTML n'expose PAS de fonction de calcul pure : `calcDepth(idx)` lit l'etat
 * dans la GLOBALE `depths[idx]` et dans des CHAMPS DE SAISIE de la page
 * (`getParams()` lit p_a/p_ph/p_pe/p_v0/p_k0 ; les champs p_gamma/p_nappe — ce
 * dernier via `nappeVal()` ; `d.label` porte la profondeur z), puis ECRIT le
 * resultat dans `d._res`. On EXTRAIT ici la science de `calcDepth` dans une
 * fonction PURE `computePressiometre(state)` : params, gamma, nappe, profondeur z
 * et lignes de mesures sont PASSES EN PARAMETRE. Aucun acces a la page, aucune
 * horloge, aucun hasard : deterministe.
 *
 * --- 3 MARQUEURS DE NON-DETERMINISME DANS L'ORIGINAL (#47) ---
 * Le HTML d'origine contient 3 appels d'horloge (construction de date) :
 *   1. ligne 657  : init du champ de date de l'UI (p_date)              (init UI)
 *   2. ligne 1709 : formatage de date FR pour l'entete / le rendu PDF   (rendu PDF)
 *   3. ligne 2373 : date du jeu de demonstration (loadExempleFictif)    (exemple)
 * Les TROIS sont de la PRESENTATION (horodatage d'affichage du PV / champ de
 * date) ; AUCUN n'apparait dans `calcDepth`/`getAlpha`/`fitAll`/`fitRecip`/
 * `linReg` ni n'influence un resultat de calcul. Ils sont donc RETIRES du module
 * pur (non transcrits) — voir le tableau de decision dans le rapport #47. Le
 * module est par construction sans horloge / hasard / iteration d'objet instable
 * (test anti-non-determinisme vert).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE (#47) ---
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
export const PRESSIOMETRE_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// SCIENCE TRANSCRITE VERBATIM (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

// --- Coefficient rheologique alpha (Menard) — getAlpha (HTML) -------------
function getAlpha(ratio, PLM_MPa) {
  if (PLM_MPa < 0.3) return 1.0;
  if (PLM_MPa < 0.6) {
    return ratio < 5 ? 1.0 : ratio < 10 ? 0.67 : 0.5;
  }
  if (PLM_MPa < 2.0) {
    return ratio < 5 ? 0.67 : ratio < 12 ? 0.5 : 0.33;
  }
  return ratio < 8 ? 0.5 : ratio < 15 ? 0.33 : 0.25;
}

// --- Extrapolations hyperboliques — fitAll / fitRecip / linReg (HTML) ------
function fitAll(plast, V0) {
  if (plast.length < 2)
    return { recip: { A: 0, B: 0, err: 0, PLM: 0, PLMasym: 0, gen: () => null } };
  return { recip: fitRecip(plast, V0) };
}

// Methode de la courbe inverse (§D.4.3.2) : 1/(V-Vs) = A + B·P (relation lineaire).
// pL est lue au volume conventionnel Vs+2·V(p0) dans calcDepth ; l'asymptote (V->inf) = -A/B
// est conservee en reference sous PLMasym.
function fitRecip(pts, V0) {
  const xs = [],
    ys = [];
  pts.forEach((c) => {
    const v = c.v60 + V0;
    if (v > V0) {
      xs.push(c.p);
      ys.push(1 / (v - V0));
    }
  });
  if (xs.length < 2) return { A: 0, B: 0, err: 0, PLM: 0, PLMasym: 0, gen: () => null };
  const { a, b } = linReg(xs, ys);
  const PLMasym = b !== 0 ? -a / b : 0;
  let err = 0;
  ys.forEach((y, i) => {
    err += Math.abs(y - (a + b * xs[i]));
  });
  err /= ys.length;
  const gen = (p) => {
    const inv = a + b * p;
    return inv > 0 ? V0 + 1 / inv : null;
  };
  return { A: a, B: b, err, PLM: PLMasym, PLMasym, gen };
}

function linReg(xs, ys) {
  const n = xs.length;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sx2 = 0;
  xs.forEach((x, i) => {
    sx += x;
    sy += ys[i];
    sxy += x * ys[i];
    sx2 += x * x;
  });
  const b = (n * sxy - sx * sy) / (n * sx2 - sx * sx || 1);
  const a = (sy - b * sx) / n;
  return { a, b };
}

// ===========================================================================
// CALCUL PRINCIPAL — extraction PURE de calcDepth (etat injecte, pas de DOM)
// ===========================================================================
//
// Transcription FIDELE de calcDepth(idx). Les seules differences avec le HTML :
//   - `params` (a/Ph/Pe/V0/k0), `_gamma`, `_zw` (nappe) et `_z` (profondeur) ne
//     sont plus lus dans le DOM / `getParams()` / `nappeVal()` mais DEBALLES ici
//     depuis `state` ;
//   - `rows` est `state.rows` (au lieu de `depths[idx].rows`), `pf_idx`/`plm_idx`
//     sont `state.pf_idx`/`state.plm_idx` ;
//   - on RETOURNE l'objet `_res` au lieu de l'ecrire dans `depths[idx]._res`.
//     Le calcul de `_res` est IDENTIQUE.
//   - les `console.warn` du HTML (a force / dV-dP) sont CONSERVES tels quels :
//     ils n'affectent pas le resultat ; le module pur les emet aussi (effet de
//     bord neutre, deterministe). [verifie : equivalence-portage]
// Aucune formule, aucun ordre de sommation, aucun seuil n'est modifie.

function calcDepthPure(state) {
  const params = state.params;
  const { V0 } = params;
  const rows = state.rows.filter(
    (r) => r.p !== '' && r.p !== undefined && r.v60 !== '' && r.v60 !== undefined,
  );
  if (rows.length < 4) return undefined; // parite : calcDepth retourne sans ecrire _res

  // -- CORRECTIONS NF EN ISO 22476-4 Annexe D --
  const { Ph, Pe, k0 } = params;
  // -- CONTRAINTE HORIZONTALE TOTALE AU REPOS sigH0 (base des pressions nettes) --
  const _z = parseFloat(state.label) || 0; // profondeur de l'essai (m) — HTML : parseFloat(d.label)
  const _gamma = state.gamma || 19; // poids volumique (kN/m³) — HTML : p_gamma ?? 19
  const _zw = state.nappe; // profondeur nappe (m) — HTML : nappeVal()
  const _sigV = _gamma * _z * 0.01; // sigv0 total (bar) : kN/m³·m -> ×0.01
  const _u0 = _zw > 0 && _z > _zw ? (_z - _zw) * 0.0981 : 0; // u0 (bar), gamw ~ 9,81 kN/m³
  const _sigVp = Math.max(0, _sigV - _u0); // sig'v0 (bar)
  const sigH0 = k0 * _sigVp + _u0; // sigH0 total au repos (bar)
  // Validation : a ne doit pas etre si grand que les volumes corriges deviennent negatifs
  const rows_valid = rows.filter((r) => +r.v60 > 0);
  const V60_moy = rows_valid.reduce((s, r) => s + +r.v60, 0) / (rows_valid.length || 1);
  const P_max = Math.max(...rows_valid.map((r) => +r.p));
  const a_raw = params.a;
  const a = a_raw * P_max > 0.5 * V60_moy ? 0 : a_raw;
  if (a !== a_raw && a_raw > 0) {
    console.warn(
      'a=' +
        a_raw +
        ' trop grand (a×Pmax=' +
        (a_raw * P_max).toFixed(1) +
        ' > 0.5×V60_moy=' +
        (0.5 * V60_moy).toFixed(1) +
        ') → a=0 utilisé',
    );
  }
  const C = rows.map((r) => {
    const Pr = +r.p;
    const p_corr = +(Pr + Ph - Pe).toFixed(5);
    const v60_c = +(+r.v60 - a * Pr).toFixed(3);
    const v30_c = +(+r.v30 - a * Pr).toFixed(3);
    const v15_c = +(+r.v15 - a * Pr).toFixed(3);
    return {
      pRaw: Pr,
      v15r: +r.v15 || 0,
      v30r: +r.v30 || 0,
      v60r: +r.v60,
      p: p_corr,
      pS: +(p_corr - sigH0).toFixed(5), // pression nette = p - sigH0
      v15: v15_c,
      v30: v30_c,
      v60: v60_c,
      dv: +(+r.v60 - +r.v30), // Delta60/30 brut
    };
  });

  // -- PLAGE PSEUDO-ELASTIQUE — NF EN ISO 22476-4 §D.5.1 --
  const dVtol = 3; // deltaV : tolerance de volume (cm³) — NF EN ISO 22476-4 §D.5.1
  const _slopes = [];
  for (let _i = 1; _i < C.length; _i++) {
    const _dp = C[_i].p - C[_i - 1].p;
    const _dv = C[_i].v60 - C[_i - 1].v60;
    _slopes.push(_dp > 0 ? _dv / _dp : Infinity);
  }
  const _validS = _slopes.filter((s) => s > 0 && s < Infinity);
  const mE = _validS.length ? Math.min(..._validS) : 1;
  const _iE = _slopes.indexOf(mE);
  const _PE = C[_iE].p,
    _VE = C[_iE].v60;
  const _PEp = C[_iE + 1] ? C[_iE + 1].p : _PE + 0.1;
  const _VEp = C[_iE + 1] ? C[_iE + 1].v60 : _VE + 1;
  const _dPE = _PEp - _PE,
    _dVE = _VEp - _VE;
  const _beta =
    _dPE > 0 && _dVE > 0 ? 1 + (_PEp + _PE) / (100 * _dPE) + dVtol / _dVE : 2.0;
  const betaFinal = Math.min(Math.max(_beta, 1.5), 4.0);
  const _thresh = betaFinal * mE;
  let _ap0 = _iE,
    _apf = _iE + 1;
  for (let _i = _iE - 1; _i >= 0; _i--) {
    if (_slopes[_i] <= _thresh) _ap0 = _i;
    else break;
  }
  for (let _i = _iE + 1; _i < _slopes.length; _i++) {
    if (_slopes[_i] <= _thresh) _apf = _i + 1;
    else break;
  }
  const auto_p0I = _ap0,
    auto_pfI = _apf;

  const _p0Man =
    state.pf_idx !== undefined && state.pf_idx >= 0
      ? Math.min(state.pf_idx, C.length - 1)
      : -1;
  const _pfMan =
    state.plm_idx !== undefined && state.plm_idx >= 0
      ? Math.min(state.plm_idx, C.length - 1)
      : -1;
  const p0I = _p0Man >= 0 ? _p0Man : auto_p0I;
  const pfI = _pfMan >= 0 && _pfMan > p0I ? _pfMan : auto_pfI;

  const pE = C[0].p;
  const VE = C[0].v60; // pression de restitution
  const p0 = C[p0I].p;
  const V0c = C[p0I].v60; // p0 = debut pseudo-elastique
  const Pf = C[pfI].p;
  const Vf = C[pfI].v60; // pf = fin zone plate = fluage

  // -- MODULE EM (NF EN ISO 22476-4) --
  const nu = 0.33;
  const _dV = Vf - V0c;
  const _dP = Pf - p0;
  if (_dV <= 0 || _dP <= 0) {
    console.warn(
      'calcDepth: _dV=' +
        _dV +
        ' _dP=' +
        _dP +
        ' → EM=0. Vérifiez p0I=' +
        p0I +
        ' pfI=' +
        pfI,
    );
  }
  const EM =
    _dV > 0 && _dP > 0 ? (2 * (1 + nu) * (V0 + (V0c + Vf) / 2) * _dP * 0.1) / _dV : 0; // MPa

  // -- PRESSION LIMITE pL --
  const VLimit = V0 + 2 * V0c; // Vs + 2×DeltaV(p0)
  let pL = null;
  for (let i = 0; i < C.length - 1; i++) {
    if (C[i].v60 <= VLimit && C[i + 1].v60 >= VLimit) {
      const t = (VLimit - C[i].v60) / (C[i + 1].v60 - C[i].v60);
      pL = C[i].p + t * (C[i + 1].p - C[i].p);
      break;
    }
    if (C[i].v60 >= VLimit && i === 0) {
      pL = C[0].p;
      break;
    }
  }
  const pL_direct = pL; // null si non atteint

  const plast = C.slice(pfI); // zone plastique = apres pf
  const ext = fitAll(plast, V0); // methode de la courbe inverse (§D.4.3.2)

  const _volErr = (m) => {
    if (!m || !m.gen) return Infinity;
    let s = 0,
      n = 0;
    plast.forEach((c) => {
      const vh = m.gen(c.p);
      if (vh != null && isFinite(vh)) {
        s += Math.abs(vh - (c.v60 + V0));
        n++;
      }
    });
    return n ? s / n : Infinity;
  };
  ext.recip.errV = _volErr(ext.recip);

  const _invTarget = VLimit > 0 ? 1 / VLimit : 0;
  const recipPLM = ext.recip.B !== 0 ? (_invTarget - ext.recip.A) / ext.recip.B : 0;
  ext.recip.PLM = recipPLM; // pLM extrapolee conventionnelle (pour affichage)

  let extChoice = null;
  if (pL === null) {
    if (isFinite(recipPLM) && recipPLM > Pf) {
      extChoice = 'recip';
      pL = recipPLM;
    } else pL = Pf * 2;
    const lastP = C[C.length - 1].p;
    if (pL < lastP) pL = lastP;
  }

  // -- PRESSIONS NETTES --
  const PfS = Math.max(0, Pf - sigH0); // pf* = pf - sigH0
  const pLS = Math.max(0, pL - sigH0); // pL* = pL - sigH0

  // -- CLASSIFICATION --
  const ratio = pL > 0 ? EM / (pL * 0.1) : 0;
  const alpha = getAlpha(ratio, pLS * 0.1);

  let cat, catName, catDesc;
  const _pLM = pL * 0.1; // pL en MPa
  if (_pLM < 0.2) {
    cat = 'A';
    catName = 'Sol très mou (cat. A)';
    catDesc = 'Vase, tourbe, argile très molle. pL < 0,2 MPa.';
  } else if (_pLM < 0.6) {
    cat = 'B';
    catName = 'Sol mou (cat. B)';
    catDesc = 'Argile molle, limon. 0,2 ≤ pL < 0,6 MPa.';
  } else if (_pLM < 2) {
    cat = 'C';
    catName = 'Sol ferme (cat. C)';
    catDesc = 'Argile raide, sable. 0,6 ≤ pL < 2 MPa.';
  } else if (_pLM < 4) {
    cat = 'D';
    catName = 'Sol dense / raide (D)';
    catDesc = 'Sable dense, marne. 2 ≤ pL < 4 MPa.';
  } else {
    cat = 'E';
    catName = 'Roche (cat. E)';
    catDesc = 'Roche, sol très raide. pL ≥ 4 MPa.';
  }

  let consol =
    ratio < 5
      ? 'Sol remanié ou perturbé'
      : ratio < 12
        ? 'Sol normalement consolidé'
        : 'Sol préconsolidé';

  // -- VOLUMES DE REFERENCE --
  const VsP2V1 = VLimit; // Vs + 2×V(p0) = volume limite
  const fluage = C.map((c) => ({ p: c.p, dv: c.dv }));

  const _res = {
    C,
    pfI: p0I,
    plmI: pfI, // indices : pfI=p0, plmI=pf
    pE,
    p0,
    Pf,
    pL, // pressions corrigees
    pL_direct, // pL direct (null si extrapole)
    PfS,
    pLS, // pressions nettes
    VE,
    V0c,
    Vf,
    VsP2V1, // volumes cles
    EM,
    ratio,
    alpha,
    cat,
    catName,
    catDesc,
    consol,
    fluage,
    ext,
    extChoice,
    a: params.a,
    aUsed: a,
    aForced: a_raw > 0 && a !== a_raw,
    Ph: params.Ph,
    Pe: params.Pe,
    V0,
    sigH0,
    sigV0: _sigV,
    sigVp: _sigVp,
    u0: _u0,
    z: _z,
    gamma: _gamma,
    beta: betaFinal,
    mE,
    iE: _iE,
    auto_p0I,
    auto_pfI,
  };
  return _res;
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule le depouillement pressiometrique d'UNE profondeur a partir d'un ETAT
 * complet (pas de DOM, pas de globale). `state` porte :
 *   - `params`  : { a, Ph, Pe, V0, k0 } (deja convertis : `a` en cm³/bar interne) ;
 *   - `gamma`   : poids volumique du sol (kN/m³) ;
 *   - `nappe`   : profondeur de la nappe (m), 0 si absente ;
 *   - `label`   : libelle de profondeur (le HTML parse `parseFloat(label)` = z) ;
 *   - `rows`    : lignes de mesures [{ p, v15, v30, v60 }] ;
 *   - `pf_idx` / `plm_idx` : indices de selection manuelle des seuils (-1/absents = auto).
 *
 * Renvoie l'objet de resultat BRUT `_res` (identique au HTML), `undefined` si
 * moins de 4 lignes valides (parite avec `calcDepth` qui retourne sans ecrire
 * `_res`), OU `{ err }` si la science leve. La PROJECTION client-safe est faite
 * par index.ts (whitelist + redaction).
 */
export function computePressiometre(state) {
  try {
    const res = calcDepthPure(state || {});
    if (res === undefined) {
      // Parite HTML : calcDepth ne pose pas _res (donnees insuffisantes). On
      // signale explicitement le cas (le HTML laisse alors l'ancien _res / rien) ;
      // cote module on renvoie un marqueur que index.ts mappe en erreur bornee.
      return { err: 'Données insuffisantes : au moins 4 paliers de mesure requis.' };
    }
    return res;
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
