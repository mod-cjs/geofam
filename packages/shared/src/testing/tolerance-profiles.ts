/**
 * Profils de tolerance nommes, reutilisables par le harnais golden.
 *
 * Un profil = un jeu de tolerances par defaut + par chemin, marque par un nom, a
 * appliquer a un cas-test via le MEME comparateur golden. Cela evite de re-saisir
 * (et de diverger sur) les memes tolerances entre cas d un meme moteur.
 *
 * IMPORTANT — un profil n est qu un ECART ADMISSIBLE convenu : il ne valide aucun
 * calcul. Une tolerance trop large produit des faux-verts sur l equivalence
 * module<->HTML et client<->serveur ; on ne l ouvre que la ou la METHODE de calcul
 * l exige (ex. methode aux elements finis), et on le documente comme tel.
 *
 * AUCUN symbole moteur ici : ce fichier ne contient que des CONSTANTES de tolerance.
 */
import type { NumericTolerance } from './golden.js';

/** Un profil de tolerance nomme, applicable a un cas golden. */
export interface ToleranceProfile {
  /** Nom du profil (apparait dans les diagnostics). */
  name: string;
  /** Justification de l ecart admissible (pourquoi cette largeur ?). */
  rationale: string;
  /** Tolerance par defaut appliquee a tout champ numerique. */
  defaultTolerance: NumericTolerance;
  /** Tolerances specifiques par chemin de champ. */
  toleranceByPath?: Record<string, NumericTolerance>;
}

/**
 * Profil "FEM" — pour GEOPLAQUE (radier/plaque, methode aux elements finis).
 *
 * Pourquoi plus large : une resolution par elements finis depend du maillage et
 * d une convergence iterative ; le resultat n est pas reproductible au bit pres
 * comme une formule fermee. On retient une tolerance RELATIVE de 1 % par defaut
 * (ecart admissible a CONFIRMER avec STARFIRE pour chaque grandeur), avec bascule
 * rel->abs pres de zero geree par golden.ts.
 *
 * Marque comme PROFIL FEM : ce n est PAS le moteur GEOPLAQUE, seulement l ecart
 * admissible a lui appliquer. La valeur 1 % est un point de depart documente, pas
 * une verite scientifique : `expert-genie-civil`/STARFIRE doivent l arbitrer par
 * grandeur avant de figer un cas-test.
 */
export const FEM_TOLERANCE_PROFILE: ToleranceProfile = {
  name: 'FEM',
  rationale:
    'Methode aux elements finis (GEOPLAQUE radier/plaque) : sensible au maillage ' +
    'et a la convergence -> tolerance relative plus large (1 % par defaut, a ' +
    'confirmer par grandeur avec STARFIRE). Ne pas reutiliser pour un moteur en ' +
    'formule fermee.',
  defaultTolerance: { rel: 0.01 },
};

/**
 * Profil "EXACT" — egalite stricte pour les moteurs en formule fermee deterministe.
 * Sert de profil par defaut sur : tout champ numerique doit etre reproduit a l
 * identique (aucune tolerance), sauf champ explicitement assoupli par le cas.
 */
export const EXACT_TOLERANCE_PROFILE: ToleranceProfile = {
  name: 'EXACT',
  rationale:
    'Moteur deterministe en formule fermee : la transcription TS doit reproduire ' +
    'la reference au plus pres ; on n ouvre une tolerance que la ou un cas la fournit.',
  defaultTolerance: { exact: true },
};

/** Profils disponibles, indexes par nom (pour resolution par cas-test). */
export const TOLERANCE_PROFILES: Record<string, ToleranceProfile> = {
  [FEM_TOLERANCE_PROFILE.name]: FEM_TOLERANCE_PROFILE,
  [EXACT_TOLERANCE_PROFILE.name]: EXACT_TOLERANCE_PROFILE,
};
