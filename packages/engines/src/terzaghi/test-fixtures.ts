/**
 * Jeux d'ENTREES terzaghi pour l'equivalence-portage et l'e2e (#45).
 *
 * Ces fixtures ne contiennent QUE des entrees (`state`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML
 * d'origine via jsdom dans le harnais d'equivalence (provenance 'HTML-origine').
 * On ne se compare donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * Couverture : nominal (pressio/penetro/labo), formes (carree/rect/filante/circ),
 * bornes (charge excentree, talus, double cas de charge ELU+ELS) et >=1 cas
 * HORS-DOMAINE (sondage vide -> le moteur renvoie une erreur de saisie).
 *
 * Les nombres sont en CHAINE a virgule FR (« 1,5 »), comme la saisie reelle : le
 * moteur d'origine les parse via num(). On reste fidele a ce comportement.
 */
import type { TerzaghiInput } from './contract.js';

export interface TerzaghiFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de saisie (hors-domaine). */
  horsDomaine?: boolean;
  input: TerzaghiInput;
}

/** Sondage pressiometrique de reference (essais ponctuels). */
const SONDAGE_PRESSIO: TerzaghiInput['sondage'] = [
  { z: '1,5', pl: '', em: '2,5', al: '0,5' },
  { z: '3', pl: '0,5', em: '7', al: '0,5' },
  { z: '4,5', pl: '0,6', em: '6', al: '0,5' },
  { z: '6', pl: '0,6', em: '6', al: '0,5' },
  { z: '7,5', pl: '0,7', em: '6', al: '0,5' },
  { z: '9', pl: '5', em: '150', al: '0,5' },
  { z: '10,5', pl: '5', em: '200', al: '0,5' },
  { z: '12', pl: '5', em: '198', al: '0,5' },
  { z: '13,5', pl: '5', em: '202', al: '0,5' },
];

/** Sondage penetrometrique (qc en MPa). */
const SONDAGE_PENETRO: TerzaghiInput['sondage'] = [
  { z: '1', qc: '3' },
  { z: '2', qc: '5' },
  { z: '4', qc: '8' },
  { z: '6', qc: '10' },
  { z: '9', qc: '12' },
  { z: '12', qc: '14' },
];

export const TERZAGHI_FIXTURES: readonly TerzaghiFixture[] = [
  {
    id: 'nominal-pressio-rect',
    description: 'Pressiometre, semelle rectangulaire, ELS QP (exemple GEOFOND)',
    input: {
      projet: 'Bâtiment R+5 — exemple',
      sondage: SONDAGE_PRESSIO,
      solCat: 'marnes',
      nappe: '',
      gAvant: '20',
      gApres: '20',
      c: '0',
      phi: '30',
      eYoung: '50',
      nuSol: '0,33',
      cphiOn: false,
      cphiMode: 'auto',
      gSous: '',
      essai: 'pressio',
      alphaSang: '',
      profilMode: 'essais',
      forme: 'rect',
      B: '6',
      L: '10',
      D: '4,5',
      talusOn: false,
      beta: '',
      dTalus: '',
      talusDir: 'ext',
      beton: 'coule',
      alphaConst: true,
      alphaConstVal: '0,5',
      charges: [{ etat: 'ELS_QP', fz: '12240', fx: '0', fy: '0', mx: '0', my: '0' }],
    },
  },
  {
    id: 'pressio-carree-centree',
    description: 'Pressiometre, semelle carree, charge centree ELU_F',
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'sables',
      nappe: '',
      gAvant: '19',
      gApres: '19',
      c: '0',
      phi: '32',
      eYoung: '',
      nuSol: '',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'carree',
      B: '2',
      L: '',
      D: '1,5',
      talusOn: false,
      beton: 'coule',
      charges: [{ etat: 'ELU_F', fz: '1500' }],
    },
  },
  {
    id: 'pressio-carree-excentree',
    description: 'Pressiometre, semelle carree, charge excentree (My, Mx) + effort H',
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'sables',
      gAvant: '19',
      gApres: '19',
      c: '5',
      phi: '30',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'carree',
      B: '3',
      D: '2',
      charges: [{ etat: 'ELU_F', fz: '2000', fx: '150', fy: '0', mx: '200', my: '400' }],
    },
  },
  {
    id: 'pressio-filante',
    description: 'Pressiometre, semelle filante, charge par ml ELS caracteristique',
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'marnes',
      gAvant: '20',
      gApres: '20',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'filante',
      B: '1,5',
      D: '1',
      charges: [{ etat: 'ELS_C', fz: '300', mx: '50' }],
    },
  },
  {
    id: 'pressio-circulaire',
    description: 'Pressiometre, semelle circulaire, charge centree ELS QP',
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'sables',
      gAvant: '19',
      gApres: '19',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'circ',
      B: '2,5',
      D: '1,2',
      charges: [{ etat: 'ELS_QP', fz: '1800' }],
    },
  },
  {
    id: 'pressio-couches-talus',
    description: 'Pressiometre, lecture couches, talus, charge inclinee',
    input: {
      sondage: [
        { z: '0', pl: '0,8', em: '8', al: '0,5' },
        { z: '3', pl: '1,2', em: '12', al: '0,5' },
        { z: '6', pl: '2', em: '20', al: '0,5' },
        { z: '10', pl: '3', em: '30', al: '0,5' },
      ],
      solCat: 'argiles',
      gAvant: '18',
      gApres: '18',
      c: '10',
      phi: '25',
      essai: 'pressio',
      profilMode: 'couches',
      forme: 'rect',
      B: '2',
      L: '4',
      D: '1,5',
      talusOn: true,
      beta: '20',
      dTalus: '3',
      talusDir: 'ext',
      charges: [{ etat: 'ELU_F', fz: '1200', fx: '100' }],
    },
  },
  {
    id: 'penetro-carree',
    description: 'Penetrometre statique, semelle carree, ELS QP + Sanglerat',
    input: {
      sondage: SONDAGE_PENETRO,
      solCat: 'sables',
      gAvant: '19',
      gApres: '19',
      essai: 'penetro',
      alphaSang: '2',
      profilMode: 'essais',
      forme: 'carree',
      B: '2',
      D: '1,5',
      charges: [{ etat: 'ELS_QP', fz: '1400' }],
    },
  },
  {
    id: 'penetro-rect-multi',
    description: 'Penetrometre, semelle rect, deux cas (ELU_F + ELS_C)',
    input: {
      sondage: SONDAGE_PENETRO,
      solCat: 'argiles',
      gAvant: '18',
      gApres: '18',
      essai: 'penetro',
      alphaSang: '3',
      profilMode: 'essais',
      forme: 'rect',
      B: '2,5',
      L: '5',
      D: '2',
      charges: [
        { etat: 'ELU_F', fz: '3000', fx: '200' },
        { etat: 'ELS_C', fz: '2200' },
      ],
    },
  },
  {
    id: 'labo-cphi-draine',
    description: 'Methode c–φ (labo), comportement draine, semelle carree',
    input: {
      sondage: [],
      solCat: 'sables',
      gAvant: '20',
      gApres: '20',
      c: '5',
      phi: '32',
      eYoung: '40',
      nuSol: '0,3',
      cphiMode: 'd',
      essai: 'labo',
      profilMode: 'couches',
      forme: 'carree',
      B: '2',
      D: '1,5',
      charges: [{ etat: 'ELU_F', fz: '1600' }],
    },
  },
  {
    id: 'labo-cphi-nondraine',
    description: 'Methode c–φ (labo), non draine (cu), semelle filante',
    input: {
      sondage: [],
      solCat: 'argiles',
      gAvant: '18',
      gApres: '18',
      c: '40',
      phi: '0',
      eYoung: '15',
      nuSol: '0,45',
      cphiMode: 'nd',
      essai: 'labo',
      profilMode: 'couches',
      forme: 'filante',
      B: '1,2',
      D: '1',
      charges: [{ etat: 'ELS_QP', fz: '180' }],
    },
  },
  {
    id: 'pressio-nappe',
    description: 'Pressiometre avec nappe a 2 m, semelle carree',
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'sables',
      nappe: '2',
      gAvant: '20',
      gApres: '20',
      c: '0',
      phi: '30',
      cphiOn: true,
      cphiMode: 'auto',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'carree',
      B: '2,5',
      D: '2',
      charges: [{ etat: 'ELU_F', fz: '1700', fx: '120' }],
    },
  },
  // --- HORS-DOMAINE : sondage vide en pressio -> erreur de saisie ---
  {
    id: 'hors-domaine-sondage-vide',
    description: 'Pressiometre sans sondage valide : le moteur renvoie une erreur',
    horsDomaine: true,
    input: {
      sondage: [],
      solCat: 'sables',
      gAvant: '19',
      gApres: '19',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'carree',
      B: '2',
      D: '1,5',
      charges: [{ etat: 'ELS_QP', fz: '1000' }],
    },
  },
  // --- BORNE : largeur B nulle -> erreur de saisie ---
  {
    id: 'hors-domaine-B-nul',
    description: 'Largeur B nulle : erreur « B doit être strictement positive »',
    horsDomaine: true,
    input: {
      sondage: SONDAGE_PRESSIO,
      solCat: 'sables',
      gAvant: '19',
      gApres: '19',
      essai: 'pressio',
      profilMode: 'essais',
      forme: 'carree',
      B: '0',
      D: '1',
      charges: [{ etat: 'ELS_QP', fz: '1000' }],
    },
  },
];
