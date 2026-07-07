/* eslint-disable */
// @ts-nocheck -- TRANSCRIPTION FIDELE de JS non type (cf. en-tete) : on ne type PAS
// les internes du moteur (cela imposerait de modifier la science pour satisfaire
// noUncheckedIndexedAccess / no-var / no-unused-vars). Le TYPAGE STRICT vit a la
// frontiere (contract.ts, verifie). La sortie brute est volontairement opaque puis
// projetee via le schema strict.
/**
 * MOTEUR ETALONNAGE PRESSIOMETRIQUE (sonde dans l'air) — coefficients d'appareillage
 * Vs / Pe / pente d'air, par regression lineaire V = Vs + a·P.
 *
 * --- ETAT (transcription, science FIGEE) ---
 * Code SCIENTIFIQUE transcrit TEL QUEL depuis le HTML d'origine
 * (03-Moteurs-client/GeoSuite/source/tools/pressiometre__1_.html, fonction
 * `calcEtalonnage`, l.2078). On NE reordonne RIEN, on NE corrige RIEN : l'arbitre est
 * l'equivalence-PORTAGE (module == HTML, rel serree). `@ts-nocheck` est ASSUME :
 * science transcrite (moindres carres + interpolation), pas du code maison.
 *
 * --- CE QUE FAIT LE CALCUL ---
 * A partir de N points (P, V60) mesures sonde dans l'air (>= 3) :
 *   - regression lineaire des moindres carres V = Vs + a·P (pente a, ordonnee Vs) ;
 *   - coefficient de determination R² et RMS des residus ;
 *   - Pe = pression sur la courbe quand V = 1,2 × Vs_reel (Vs_reel = volume au 1er
 *     palier MESURE, pas la droite ajustee — methode NF EN ISO 22476-4), interpolee
 *     LINEAIREMENT entre deux paliers encadrants ; a defaut (aucun encadrement et
 *     a>0), extrapolee sur la droite ajustee ; bornee a >= 0 et arrondie a 4 decimales.
 * Vs et Pe sont ensuite reutilisables comme coefficients d'appareillage en ENTREE du
 * depouillement pressiometrique (Annexe D). La pente d'air `a` N'est PAS le coefficient
 * de correction de volume (celui-ci vient du CALIBRAGE, forage indeformable).
 *
 * --- DIFFERENCE STRUCTURELLE AVEC LE HTML ---
 * `calcEtalonnage()` du HTML lit ses points dans la GLOBALE `etalRows`, PUIS appelle
 * `renderEtalResult(e)` / `drawEtalChart(e)` (DOM) avec l'objet de resultat `e`. On
 * EXTRAIT ici la science dans une fonction PURE `calcEtalonnage(input)` : les points
 * sont PASSES EN PARAMETRE (`input.rows`) et on RETOURNE l'objet `e` (au lieu de le
 * rendre). Aucune fonction UI (`renderEtalResult`, `drawEtalChart`, `toast`) n'est
 * transcrite. Aucun acces DOM, aucune horloge, aucun hasard.
 *
 * --- DETERMINISME ---
 * Sommations dans l'ordre VERBATIM, interpolation deterministe, arrondis identiques.
 * Aucune iteration d'objet a ordre instable (`for..in`), aucun `Date`/`Math.random`.
 *
 * --- UNITES ---
 * P en bar, V60 en cm³. Sorties : Vs en cm³, Pe en bar, a (pente d'air) en cm³/bar.
 * (Le HTML AFFICHE a×10 en cm³/MPa ; on conserve la valeur BRUTE cm³/bar, unite interne
 * consommee par l'appareillage — cf. contract.ts.)
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
export const PRESSIO_ETALONNAGE_CONFIDENTIAL_MARKER = ENGINE_BUNDLE_MARKER;

// ===========================================================================
// CALCUL D'ETALONNAGE — extraction PURE de calcEtalonnage (rows injectes)
// ===========================================================================
//
// Transcription FIDELE de calcEtalonnage(). Les seules differences avec le HTML :
//   - la globale `etalRows` est PASSEE EN PARAMETRE (`input.rows`) ;
//   - on RETOURNE l'objet `e` (au lieu d'appeler renderEtalResult/drawEtalChart) ;
//   - le cas « < 3 points » renvoie `{ err }` (au lieu d'un `toast` UI).
// Aucune formule, aucun ordre de sommation, aucun seuil, aucun arrondi n'est modifie.

function calcEtalonnage(input) {
  const rows = (input && input.rows) || [];
  const pts = rows
    .filter((r) => r.p !== '' && r.v60 !== '' && r.v60 !== undefined)
    .map((r) => ({ p: +r.p, v: +r.v60 }));
  if (pts.length < 3) {
    return { err: 'Saisissez au moins 3 points.' };
  }

  /* ── Régression linéaire V = Vs + a×P ────────────── */
  const n = pts.length;
  let sP = 0,
    sV = 0,
    sPP = 0,
    sPV = 0;
  pts.forEach((r) => {
    sP += r.p;
    sV += r.v;
    sPP += r.p * r.p;
    sPV += r.p * r.v;
  });
  const a_calc = (n * sPV - sP * sV) / (n * sPP - sP * sP);
  const Vs_calc = (sV - a_calc * sP) / n;

  /* ── R² ──────────────────────────────────────────── */
  const Vmoy = sV / n;
  let SStot = 0,
    SSres = 0;
  pts.forEach((r) => {
    const Vhat = Vs_calc + a_calc * r.p;
    SStot += (r.v - Vmoy) ** 2;
    SSres += (r.v - Vhat) ** 2;
  });
  const R2 = 1 - SSres / SStot;

  /* ── Pe = P quand V = 1,2 × Vs ─────────────────────────────
     Méthode NF EN ISO 22476-4 : Pe = pression sur courbe quand V = 1,2 × Vs réel
     Vs réel = volume au premier palier mesuré (pas la droite ajustée) ────── */
  const Vs_reel = pts[0].v;
  const V_pe = 1.2 * Vs_reel;
  let Pe_calc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].v <= V_pe && pts[i + 1].v >= V_pe) {
      const t = (V_pe - pts[i].v) / (pts[i + 1].v - pts[i].v);
      Pe_calc = pts[i].p + t * (pts[i + 1].p - pts[i].p);
      break;
    }
  }
  if (Pe_calc === 0 && a_calc > 0) Pe_calc = (V_pe - Vs_calc) / a_calc;
  Pe_calc = Math.max(0, +Pe_calc.toFixed(4));

  /* ── Résidus ─────────────────────────────────────── */
  const residuals = pts.map((r) => ({
    p: r.p,
    v: r.v,
    vhat: +(Vs_calc + a_calc * r.p).toFixed(2),
    res: +(r.v - (Vs_calc + a_calc * r.p)).toFixed(2),
  }));
  const rmsError = Math.sqrt(SSres / n);

  // L'objet `e` PASSE A renderEtalResult(e) dans le HTML (valeur de retour = ce `e`).
  return {
    a: a_calc,
    Vs: Vs_calc,
    Pe: Pe_calc,
    R2,
    rmsError,
    pts,
    residuals,
    V_pe,
    Vs_reel,
  };
}

// ===========================================================================
// ENTREE PURE DU MODULE
// ===========================================================================

/**
 * Calcule les coefficients d'etalonnage (sonde dans l'air) a partir des points
 * mesures (P, V60), sans DOM, sans globale.
 *   - `input` : { rows: [{ p (bar), v60 (cm³), ... }] }.
 *
 * Renvoie l'objet de RESULTAT BRUT `e` (identique a l'argument passe a
 * `renderEtalResult` du HTML) : { a, Vs, Pe, R2, rmsError, pts, residuals, V_pe,
 * Vs_reel }, OU `{ err }` si moins de 3 points valides (garde du moteur). La
 * PROJECTION client-safe est faite en aval par index.ts (hors de ce fichier).
 */
export function computeEtalonnage(input) {
  try {
    return calcEtalonnage(input || {});
  } catch (e) {
    return { err: e && e.message ? String(e.message) : 'Erreur de calcul' };
  }
}
