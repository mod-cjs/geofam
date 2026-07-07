/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur (cela imposerait de modifier la science pour satisfaire
// noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit a la
// frontiere (contract.ts, verifie). La sortie brute est volontairement opaque puis
// projetee via le schema strict.
/**
 * MOTEUR CALIBRAGE PRESSIOMETRIQUE (forage indeformable) — coefficient de correction
 * de volume `a`, par regression et moindres carres (solve3).
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/pressiometre__1_.html, fonctions
 * `calcCalibrage` (l.1885) et `solve3` (l.1925)). On NE reordonne RIEN, on NE corrige
 * RIEN : l'arbitre est l'equivalence-PORTAGE (module == HTML, rel serree).
 * `@ts-nocheck` est ASSUME : science transcrite (Gauss 3×3 + moindres carres), pas du
 * code maison.
 *
 * --- CE QUE FAIT LE CALCUL ---
 * A partir de N points (P, V60) mesures en tube indeformable (>= 3), tries par P
 * croissant :
 *   - AJUSTEMENT POLYNOMIAL degre 2 (systeme normal 3×3 resolu par `solve3`, Gauss a
 *     pivot partiel) donnant c0, c1, c2 (courbe de calibrage) ;
 *   - residus, R² et RMS ;
 *   - le COEFFICIENT DE CALIBRAGE `a_calib` = pente moyenne dV/dP par regression
 *     LINEAIRE simple (moindres carres) — c'est la sortie METIER (correction
 *     Vc = Vr − a·Pr). Le HTML AFFICHE a_calib×10 en cm³/MPa ; on conserve la valeur
 *     BRUTE cm³/bar (unite interne consommee par l'appareillage — cf. contract.ts).
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * `calcCalibrage()` du HTML lit ses points dans la GLOBALE `calibRows`, PUIS appelle
 * `renderCalibResult(e)` / `drawCalibChart(...)` (DOM) avec l'objet de resultat `e`. On
 * EXTRAIT ici la science dans une fonction PURE `calcCalibrage(input)` : les points sont
 * PASSES EN PARAMETRE (`input.rows`) et on RETOURNE l'objet `e` (au lieu de le rendre).
 * Aucune fonction UI n'est transcrite. Aucun acces DOM, aucune horloge, aucun hasard.
 *
 * --- DETERMINISME ---
 * Le tri est un tri NUMERIQUE stable sur P (`(a,b)=>a.p-b.p`), transcrit VERBATIM ;
 * sommations dans l'ordre d'origine ; `solve3` (elimination de Gauss a pivot partiel)
 * a chemin fixe. Aucune iteration d'objet a ordre instable, aucun `Date`/`Math.random`.
 *
 * --- UNITES ---
 * P en bar, V60 en cm³. Sortie `a` (a_calib) en cm³/bar (le HTML affiche ×10 en cm³/MPa).
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit jamais ce
 * module (garde-fou ESLint + controle de bundle CI, DoD §8).
 *
 * --- ETAT SCIENTIFIQUE ---
 * Equivalence-PORTAGE prouvee (module == HTML). SCIENCE-SIGNEE (STARFIRE a valide les
 * moteurs GeoSuite) ; l'equivalence de portage reste la preuve de fidelite obligatoire.
 * MJ-6 : pas de prod sans conformite.
 */
import { ENGINE_BUNDLE_MARKER } from '../marker.js';

/**
 * Marqueur de confidentialite embarque (DoD §8, 2e barriere). Chaine litterale
 * stable : si du code moteur fuyait dans le bundle navigateur, le controle CI (grep)
 * la detecterait. Reference inerte cote calcul.
 */
export const PRESSIO_CALIBRAGE_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// RESOLUTION SYSTEME 3×3 (HTML d'origine — NE RIEN MODIFIER)
// ===========================================================================

// Résolution système 3×3 par élimination de Gauss
function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < 3; col++) {
    let maxR = col;
    for (let r = col + 1; r < 3; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[maxR][col])) maxR = r;
    [M[col], M[maxR]] = [M[maxR], M[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= 3; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    x[i] = M[i][3];
    for (let j = i + 1; j < 3; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ===========================================================================
// CALCUL DE CALIBRAGE — extraction PURE de calcCalibrage (rows injectes)
// ===========================================================================
//
// Transcription FIDELE de calcCalibrage(). Les seules differences avec le HTML :
//   - la globale `calibRows` est PASSEE EN PARAMETRE (`input.rows`) ;
//   - on RETOURNE l'objet `e` (au lieu d'appeler renderCalibResult/drawCalibChart) ;
//   - le cas « < 3 points » renvoie `{ err }` (au lieu d'un `toast` UI).
// Aucune formule, aucun ordre de sommation, aucun tri, aucun arrondi n'est modifie.

function calcCalibrage(input) {
  const calibRows = (input && input.rows) || [];
  const pts = calibRows
    .filter((r) => r.p !== '' && r.v60 !== '' && r.v60 !== undefined)
    .map((r) => ({ p: +r.p, v: +r.v60 }));
  if (pts.length < 3) {
    return { err: 'Saisissez au moins 3 points.' };
  }
  // Trier par P croissant
  pts.sort((a, b) => a.p - b.p);

  // Régression polynomiale deg 2 : Pc = c0 + c1*P + c2*P²
  const n = pts.length;
  let s0 = n,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0,
    t0 = 0,
    t1 = 0,
    t2 = 0;
  pts.forEach((r) => {
    const v = r.p,
      p = r.v; // v=pression, p=volume (variable de régression)
    s1 += v;
    s2 += v * v;
    s3 += v * v * v;
    s4 += v * v * v * v;
    t0 += p;
    t1 += p * v;
    t2 += p * v * v;
  });
  // Système 3x3 : [[s0,s1,s2],[s1,s2,s3],[s2,s3,s4]] * [c0,c1,c2] = [t0,t1,t2]
  const A = [
    [s0, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const b = [t0, t1, t2];
  const [c0, c1, c2] = solve3(A, b);

  // Calcul des résidus et R²
  let SSres = 0,
    SStot = 0;
  const Pmoy = t0 / n;
  const residuals = pts.map((r) => {
    const phat = c0 + c1 * r.p + c2 * r.p * r.p;
    SSres += (r.v - phat) ** 2;
    SStot += (r.v - Pmoy) ** 2;
    return { v: r.p, pc: r.v, phat: +phat.toFixed(2), res: +(r.v - phat).toFixed(2) };
  });
  const R2 = SStot > 0 ? 1 - SSres / SStot : 1;
  const rms = Math.sqrt(SSres / n);

  // a_calib = pente moyenne dV60/dP = régression linéaire simple
  let sP2 = 0,
    sV2 = 0,
    sPP2 = 0,
    sPV2 = 0,
    n2 = pts.length;
  pts.forEach((r) => {
    sP2 += r.p;
    sV2 += r.v;
    sPP2 += r.p * r.p;
    sPV2 += r.p * r.v;
  });
  const a_calib = (n2 * sPV2 - sP2 * sV2) / (n2 * sPP2 - sP2 * sP2);

  // L'objet `e` PASSE A renderCalibResult(e) dans le HTML (valeur de retour = ce `e`).
  return { pts, residuals, c0, c1, c2, R2, rms, a_calib };
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule le coefficient de calibrage (forage indeformable) a partir des points
 * mesures (P, V60), sans DOM, sans globale.
 *   - `input` : { rows: [{ p (bar), v60 (cm³), ... }] }.
 *
 * Renvoie l'objet de RESULTAT BRUT `e` (identique a l'argument passe a
 * `renderCalibResult` du HTML) : { pts, residuals, c0, c1, c2, R2, rms, a_calib },
 * OU `{ err }` si moins de 3 points valides (garde du moteur). La PROJECTION
 * client-safe est faite en aval par index.ts (hors de ce fichier).
 */
export function computeCalibrage(input) {
  try {
    return calcCalibrage(input || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
