/**
 * Jeux d'ENTREES FASTLAB (essais de labo + classification GTR) pour l'equivalence-
 * portage et l'e2e (#49-53).
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML d'origine via
 * jsdom (provenance 'HTML-origine'). Anti faux-vert.
 *
 * --- FORME D'ENTREE : miroir de `readForm()` du HTML ---
 * L'entree est un objet plat : valeurs des champs `.save` par leur id (string ou
 * nombre — le moteur fait `parseFloat(String(v).replace(',','.'))` comme `num('id')`),
 * + toggles de mode (prType/ciMethod/densMethod/laVar/mdeVar/forcedState…) + `m_geo`
 * (famille geologique) + `cfg` (seuils surchargeables, optionnel).
 *
 * --- PIEGES UNITE (transcrits verbatim) ---
 * w en % (wcalc=(h-s)/(s-t)·100) ; wL/wP arrondis a l'entier ; Dmax seuil 50mm fam C ;
 * seuils Atterberg (Ip A1-A4, VBS). Pas de re-division a la lecture.
 *
 * Couverture :
 *   - DEMO : limon argileux → A2 (exemple worked du HTML, `loadDemo`) ;
 *   - sol fin argileux plastique → A3/A4 ;
 *   - grave propre insensible → D (granulo + VBS faible) ;
 *   - sable silteux → B ;
 *   - gros elements Dmax>50 → famille C ;
 *   - etat hydrique force ;
 *   - essais granulaires (LA/MDE/SZ) + famille R geologique ;
 *   - HORS-DOMAINE : aucune donnee classable (ni p80 ni VBS/Ip).
 */
import type { LaboInput } from './contract.js';

export interface LaboFixture {
  id: string;
  description: string;
  /** true si l'on attend une classe indeterminee (pas de code GTR). */
  indetermine?: boolean;
  input: LaboInput;
}

/** Exemple worked du HTML (DEMO / loadDemo) — limon argileux brun → A2. */
const DEMO: LaboInput = {
  m_geo: '',
  // IDENTIFICATION (verbatim DEMO du HTML, FASTLAB7.html ~1567-1570) : metadonnees PV
  // serialisees par readForm — un readForm() COMPLET doit PASSER (MAJEUR 1 #49-53).
  m_ref: 'SC2 — 1,20 m',
  m_chantier: 'Aménagement RN1 — Lot 3',
  m_client: 'DGTP / SAPCO',
  m_dossier: '2026-014',
  m_pk: 'PK 12+300',
  m_prof: '1,20 m',
  m_date: '2026-03-10',
  m_dessai: '2026-03-18',
  m_op: 'A. Diop',
  m_ing: 'M. NDIAYE',
  m_labo: 'GEOTEST LABO',
  m_nature: 'Limon argileux brun',
  m_obs:
    'Exemple fictif de démonstration — données simulées, non issues d’un essai réel.',
  // Teneur en eau (≈ 18 %)
  w_t1: '20.00',
  w_h1: '138.00',
  w_s1: '120.00',
  w_t2: '21.50',
  w_h2: '149.50',
  w_s2: '130.00',
  w_t3: '19.80',
  w_h3: '126.60',
  w_s3: '110.30',
  // Granulometrie — M=1000 g
  gr_M: '1000',
  gr_20: '5',
  gr_16: '15',
  gr_10: '30',
  gr_8: '25',
  gr_6_3: '30',
  gr_5: '35',
  gr_4: '40',
  gr_2: '90',
  gr_1: '80',
  gr_0_5: '60',
  gr_0_2: '40',
  gr_0_08: '30',
  // Atterberg — wL≈38, wP≈20, Ip≈18 → A2
  ll_x1: '15',
  ll_t1: '15.00',
  ll_h1: '29.05',
  ll_s1: '25.00',
  ll_x2: '22',
  ll_t2: '15.00',
  ll_h2: '28.88',
  ll_s2: '25.00',
  ll_x3: '28',
  ll_t3: '15.00',
  ll_h3: '28.72',
  ll_s3: '25.00',
  ll_x4: '33',
  ll_t4: '15.00',
  ll_h4: '28.60',
  ll_s4: '25.00',
  pl_t1: '15.00',
  pl_h1: '21.00',
  pl_s1: '20.00',
  pl_t2: '14.50',
  pl_h2: '20.14',
  pl_s2: '19.20',
  // VBS
  v_conc: '10',
  v_prise1: '30',
  v_frac1: '100',
  v_w1: '4.0',
  v_V1: '101',
  v_prise2: '30',
  v_frac2: '100',
  v_w2: '4.0',
  v_V2: '101',
  // Proctor normal, moule A
  pr_mould: 'A',
  prType: 'n',
  pr_mh1: '1836.6',
  pr_t1: '18.0',
  pr_h1: '74.0',
  pr_s1: '68.0',
  pr_mh2: '1944.8',
  pr_t2: '18.0',
  pr_h2: '75.0',
  pr_s2: '68.0',
  pr_mh3: '2022.6',
  pr_t3: '18.0',
  pr_h3: '76.0',
  pr_s3: '68.0',
  pr_mh4: '2024.1',
  pr_t4: '18.0',
  pr_h4: '77.0',
  pr_s4: '68.0',
  pr_mh5: '1990.6',
  pr_t5: '18.0',
  pr_h5: '78.0',
  pr_s5: '68.0',
  // Cisaillement direct — boite carree 60 mm
  ciMethod: 'box',
  ci_shape: 'sq',
  ci_dim: '60',
  ci_N1: '0.36',
  ci_P1: '0.197',
  ci_N2: '0.72',
  ci_P2: '0.365',
  ci_N3: '1.08',
  ci_P3: '0.533',
  ci_N4: '1.44',
  ci_P4: '0.700',
  ci_rs: '2.65',
  ci_rho1: '1950',
  ci_w1: '18.5',
  ci_rho2: '1965',
  ci_w2: '18.0',
  ci_rho3: '1940',
  ci_w3: '18.8',
  ci_rho4: '1970',
  ci_w4: '17.6',
  // Oedometre
  oe_H0: '20.0',
  oe_D: '70.0',
  oe_md: '119.3',
  oe_rs: '2.70',
  oe_s1: '10',
  oe_dh1: '0.05',
  oe_s2: '20',
  oe_dh2: '0.12',
  oe_s3: '40',
  oe_dh3: '0.24',
  oe_s4: '80',
  oe_dh4: '0.45',
  oe_s5: '160',
  oe_dh5: '0.78',
  oe_s6: '320',
  oe_dh6: '1.18',
  oe_s7: '640',
  oe_dh7: '1.60',
  oe_s8: '160',
  oe_dh8: '1.52',
  oe_s9: '40',
  oe_dh9: '1.40',
};

/** Argile tres plastique : p80 eleve + Ip eleve → A3/A4. */
const ARGILE_A4: LaboInput = {
  m_geo: '',
  gr_M: '500',
  gr_2: '5',
  gr_1: '10',
  gr_0_5: '20',
  gr_0_2: '60',
  gr_0_08: '80',
  // wL eleve (~70), wP ~25 → Ip ~45 → A4
  ll_x1: '18',
  ll_t1: '10.00',
  ll_h1: '52.00',
  ll_s1: '40.00',
  ll_x2: '24',
  ll_t2: '10.00',
  ll_h2: '51.40',
  ll_s2: '40.00',
  ll_x3: '30',
  ll_t3: '10.00',
  ll_h3: '50.90',
  ll_s3: '40.00',
  ll_x4: '33',
  ll_t4: '10.00',
  ll_h4: '50.65',
  ll_s4: '40.00',
  pl_t1: '10.00',
  pl_h1: '32.50',
  pl_s1: '28.00',
  pl_t2: '10.00',
  pl_h2: '32.40',
  pl_s2: '28.00',
};

/** Grave propre insensible a l'eau (VBS tres faible, p80 faible) → famille D. */
const GRAVE_D: LaboInput = {
  m_geo: '',
  gr_M: '1000',
  gr_20: '50',
  gr_10: '150',
  gr_5: '250',
  gr_2: '300',
  gr_1: '120',
  gr_0_5: '70',
  gr_0_2: '40',
  gr_0_08: '15',
  v_conc: '10',
  v_prise1: '60',
  v_frac1: '100',
  v_w1: '2.0',
  v_V1: '3',
  v_prise2: '60',
  v_frac2: '100',
  v_w2: '2.0',
  v_V2: '3',
};

/** Sable silteux → famille B. */
const SABLE_B: LaboInput = {
  m_geo: '',
  gr_M: '1000',
  gr_5: '40',
  gr_2: '120',
  gr_1: '250',
  gr_0_5: '300',
  gr_0_2: '200',
  gr_0_08: '60',
  v_conc: '10',
  v_prise1: '40',
  v_frac1: '100',
  v_w1: '3.0',
  v_V1: '8',
  v_prise2: '40',
  v_frac2: '100',
  v_w2: '3.0',
  v_V2: '8',
};

/** Gros elements Dmax > 50 mm → famille C. */
const GROS_C: LaboInput = {
  m_geo: '',
  gr_M: '5000',
  gr_100: '600',
  gr_80: '700',
  gr_63: '900',
  gr_50: '800',
  gr_40: '600',
  gr_20: '500',
  gr_10: '350',
  gr_5: '250',
  gr_2: '150',
  gr_1: '90',
  gr_0_5: '40',
  gr_0_08: '20',
  v_conc: '10',
  v_prise1: '50',
  v_frac1: '100',
  v_w1: '2.0',
  v_V1: '6',
  v_prise2: '50',
  v_frac2: '100',
  v_w2: '2.0',
  v_V2: '6',
};

export const LABO_FIXTURES: readonly LaboFixture[] = [
  {
    id: 'demo-A2-limon',
    description: 'Exemple DEMO du HTML — limon argileux brun → A2 (essais complets)',
    input: DEMO,
  },
  {
    id: 'argile-A4',
    description: 'Argile très plastique (Ip élevé) → A3/A4',
    input: ARGILE_A4,
  },
  {
    id: 'demo-A2-etat-force',
    description: 'DEMO avec état hydrique FORCÉ (forcedState=h)',
    input: { ...DEMO, forcedState: 'h' },
  },
  {
    id: 'grave-D-insensible',
    description: 'Grave propre insensible à l’eau (VBS faible) → famille D',
    input: GRAVE_D,
  },
  { id: 'sable-B-silteux', description: 'Sable silteux → famille B', input: SABLE_B },
  {
    id: 'gros-C-dmax',
    description: 'Gros éléments Dmax > 50 mm → famille C',
    input: GROS_C,
  },
  {
    id: 'granulaire-R-LA-MDE',
    description: 'Matériau rocheux : LA + MDE + SZ + famille géologique R',
    input: {
      ...GRAVE_D,
      m_geo: 'R4', // R4 — Roches siliceuses (valeur valide du select m_geo)
      la_M: '5000',
      la_m: '4100',
      laVar: 'std',
      la_ti: '12.5',
      la_pi: '65',
      md_M1: '500',
      md_m1: '60',
      md_M2: '500',
      md_m2: '62',
      mdeVar: 'std',
      mdeMode: 'norme',
      sz_M: '2000',
      sz_8: '100',
      sz_5: '200',
      sz_2: '400',
      sz_0_63: '600',
      sz_0_2: '700',
    },
  },
  {
    id: 'sable-B-mf',
    description: 'Sable propre (module de finesse) — p80 faible, Dmax ≤ 8 mm',
    input: {
      m_geo: '',
      gr_M: '1000',
      gr_8: '20',
      gr_5: '80',
      gr_2: '200',
      gr_1: '300',
      gr_0_5: '250',
      gr_0_2: '120',
      gr_0_08: '25',
      v_conc: '10',
      v_prise1: '40',
      v_frac1: '100',
      v_w1: '1.0',
      v_V1: '5',
      v_prise2: '40',
      v_frac2: '100',
      v_w2: '1.0',
      v_V2: '5',
    },
  },
  {
    id: 'perm-tricu-divers',
    description:
      'Essais variés : perméabilité charge variable, triaxial CU, UCS, sulfates',
    input: {
      ...DEMO,
      permMode: 'var',
      pe_a: '1.0',
      pe_Lv: '10',
      pe_Av: '20',
      pe_tv: '120',
      pe_h1: '100',
      pe_h2: '40',
      tc_s3_1: '50',
      tc_s1_1: '180',
      tc_s3_2: '100',
      tc_s1_2: '300',
      tc_s3_3: '200',
      tc_s1_3: '520',
      uc_d: '50',
      uc_h: '100',
      uc_f: '0.18',
      uc_dl: '1.5',
      su_ba: '0.5',
      su_M: '10',
      su_f: '0.343',
    },
  },
  {
    id: 'tri-uu-es',
    description: 'Triaxial UU + équivalent de sable',
    input: {
      ...SABLE_B,
      tu_s3_1: '50',
      tu_df_1: '120',
      tu_s3_2: '100',
      tu_df_2: '124',
      tu_s3_3: '150',
      tu_df_3: '118',
      es_h1_1: '120',
      es_h2_1: '78',
      es_h1_2: '122',
      es_h2_2: '80',
    },
  },
  // --- COUVERTURE KERNELS (MAJEUR 2 #49-53) : chaque fixture produit un resultat NON-null
  // pour un kernel jusqu'ici non exerce, afin que l'equivalence prouve REELLEMENT son
  // portage (pas null==null). Chacune passe par l'equivalence jsdom (rel 1e-9). ---
  {
    id: 'kernel-rhos-methodeA',
    description: 'calcRhos méthode A (pycnomètre) → D.rhos non-null',
    input: {
      ...SABLE_B,
      rsMethod: 'A',
      rs_T: '20',
      rs_liq: 'water',
      rs2_m0_1: '650',
      rs2_m1_1: '1500',
      rs2_mx_1: '750',
      rs2_m3_1: '1560',
      rs2_m0_2: '650',
      rs2_m1_2: '1500',
      rs2_mx_2: '751',
      rs2_m3_2: '1561',
    },
  },
  {
    id: 'kernel-rhos-methodeB',
    description: 'calcRhos méthode B (formule 2) → D.rhos non-null',
    input: {
      ...SABLE_B,
      rsMethod: 'B',
      rs_T: '20',
      rs_liq: 'water',
      rs2_m0_1: '650',
      rs2_m1_1: '1500',
      rs2_mx_1: '100',
      rs2_m3_1: '1560',
      rs2_m0_2: '650',
      rs2_m1_2: '1500',
      rs2_mx_2: '101',
      rs2_m3_2: '1561',
    },
  },
  {
    id: 'kernel-cbr-complet',
    description:
      'calcCbr COMPLET : 3 moules (densités) + poinçonnement i25/i5 + gonflement → D.cbr + gonfl non-null (sentinelle cbType=cbr, MINEUR 2)',
    input: {
      ...DEMO,
      cbType: 'cbr',
      cb_cible: '95',
      cb_s25: '13.35',
      cb_s5: '20',
      cb_K: '1',
      // 3 moules : masse totale/moule, volume, teneur en eau.
      cb_tot0: '11500',
      cb_moule0: '7500',
      cb_vol0: '2305',
      cb_w0: '16',
      cb_tot1: '11300',
      cb_moule1: '7500',
      cb_vol1: '2305',
      cb_w1: '16',
      cb_tot2: '11000',
      cb_moule2: '7500',
      cb_vol2: '2305',
      cb_w2: '16',
      // poinconnement a 2,5 mm (index 6) et 5,0 mm (index 9) par moule.
      // CBR_ENF=[0.25,0.5,0.75,1,1.5,2,2.5,3,4,5] -> 5,0 mm = INDEX 9 (l'index 8 = 4 mm).
      // Le moteur lit f5=num('cb_pen_'+m+'_'+indexOf(5)=9) : il FAUT cb_pen_*_9 pour
      // exercer la branche CBR 5 mm (MINEUR A #49-53).
      cb_pen_0_6: '12',
      cb_pen_0_9: '18',
      cb_pen_1_6: '9',
      cb_pen_1_9: '14',
      cb_pen_2_6: '6',
      cb_pen_2_9: '9',
      // gonflement (immersion) — ids cb_H0+m (cf. cell('cb_H0'+m) du HTML) : cb_H00/cb_H01.
      cb_H00: '127',
      cb_gonf0: '0.8',
      cb_H01: '127',
      cb_gonf1: '1.0',
    },
  },
  {
    id: 'kernel-dens-lin-prism',
    description: 'calcDens méthode linéaire/prisme → rho_app/rhod_app non-null',
    input: {
      ...SABLE_B,
      densMethod: 'lin',
      densShape: 'prism',
      d_L: '50',
      d_W: '50',
      d_H: '100',
      d_m: '480',
      d_w: '12',
    },
  },
  {
    id: 'kernel-dens-immersion',
    description: 'calcDens méthode immersion → rho_app non-null',
    input: {
      ...SABLE_B,
      densMethod: 'imm',
      // V = (mc-mg)/rfl - (mc-mf)/rp doit etre > 0 : mf ≈ mc (mc-mf = masse d'enrobage,
      // PETITE), mg buoyant. mc=500 enrobé, mf=485 non enrobé (15 g d'enrobage), mg=200.
      // t1=(500-200)/0.998≈300.6 ; t2=(500-485)/0.9≈16.7 ; V≈2.84e-4 m³ ; m=di_m=485 g.
      di_m: '485',
      di_mf: '485',
      di_mc: '500',
      di_mg: '200',
      di_rfl: '0.998',
      di_rp: '0.9',
      d_w: '12',
    },
  },
  {
    id: 'kernel-dens-deplacement',
    description: 'calcDens méthode déplacement → rho_app non-null',
    input: {
      ...SABLE_B,
      densMethod: 'dep',
      // V = (m2-m1)/rfl - (mc-mf)/rp > 0 : m2-m1 = fluide deplace (grand), (mc-mf) = enrobage.
      // m2=1800, m1=1000 -> (800)/0.998≈801.6 ; mc=500, mf=485 -> 15/0.9≈16.7 ; V≈7.85e-4.
      dd_m: '485',
      dd_mf: '485',
      dd_mc: '500',
      dd_m1: '1000',
      dd_m2: '1800',
      dd_rfl: '0.998',
      dd_rp: '0.9',
      d_w: '12',
    },
  },
  {
    id: 'kernel-rho-absorption',
    description: 'calcRho (granulats) → D.wa (absorption WA24) non-null',
    input: {
      ...GRAVE_D,
      ra_M1: '1010',
      ra_M2: '1500',
      ra_M3: '930',
      ra_M4: '1000',
      ra_rw: '0.998',
    },
  },
  {
    id: 'kernel-mde-campagne',
    description: 'calcMdeCamp (Micro-Deval campagne, mdeMode=camp) → D.mde non-null',
    input: {
      ...GRAVE_D,
      mdeMode: 'camp',
      mc_A0: '500',
      mc_B0: '440',
      mc_A1: '500',
      mc_B1: '442',
      mc_A2: '500',
      mc_B2: '380',
      mc_A3: '500',
      mc_B3: '382',
    },
  },
  {
    id: 'kernel-cisail-ring',
    description: 'calcCisail mode ANNULAIRE (ring) : couples Mt → c′/φ′ non-null',
    input: {
      ...SABLE_B,
      ciMethod: 'ring',
      ci_Ra: '50',
      ci_Ri: '30',
      ci_rs: '2.65',
      ci_N1: '0.36',
      ci_P1: '12',
      ci_N2: '0.72',
      ci_P2: '20',
      ci_N3: '1.08',
      ci_P3: '28',
      ci_N4: '1.44',
      ci_P4: '36',
    },
  },
  {
    id: 'kernel-perm-const',
    description: 'calcPerm mode CHARGE CONSTANTE → D.k non-null',
    input: {
      ...SABLE_B,
      permMode: 'const',
      pe_V: '250',
      pe_L: '10',
      pe_A: '20',
      pe_dh: '30',
      pe_t: '120',
    },
  },
  // --- DEGENERES PARTIELS : l'echantillon PASSE (avec warning classify), ne plante PAS.
  // Le lead (#49-53) : un profil partiel doit produire une classe indeterminee/partielle
  // + un `warn`, comme le HTML — JAMAIS une exception dure. Ces cas portent >=1 grandeur
  // numerique (granulo/œdo/CBR) -> golden-runner (rel 1e-9 + egalite stricte des `warn`).
  {
    id: 'degenere-ip-vbs-absents',
    description:
      'Sol fin (p80 > 35 %) SANS Ip ni VBS : famille A mais sous-classe INDETERMINEE (warn classify), ne plante pas',
    input: {
      m_geo: '',
      // granulo fine (p80 eleve) -> famille A ; ni Atterberg ni VBS saisis.
      gr_M: '500',
      gr_2: '10',
      gr_1: '20',
      gr_0_5: '40',
      gr_0_2: '120',
      gr_0_08: '200',
    },
  },
  {
    id: 'degenere-cbr-sans-proctor',
    description:
      'CBR saisi SANS Proctor (ρd max OPM absent) : compacités/I.CBR non calculables, classify avertit, ne plante pas',
    input: {
      ...SABLE_B,
      cbType: 'cbr',
      // poinçonnement saisi mais aucune masse/volume de moule + pas de Proctor -> ydmax null.
      cb_pen_0_6: '8',
      cb_pen_0_9: '12',
      cb_cible: '95',
    },
  },
  {
    id: 'degenere-oedo-peu-paliers',
    description:
      'Œdomètre avec < 7 paliers : Cc/Cs calculés sur peu de points (note « min. 7 conseillés »), ne plante pas',
    input: {
      ...SABLE_B,
      oe_H0: '20.0',
      oe_D: '70.0',
      oe_md: '119.3',
      oe_rs: '2.70',
      oe_s1: '25',
      oe_dh1: '0.08',
      oe_s2: '50',
      oe_dh2: '0.18',
      oe_s3: '100',
      oe_dh3: '0.35',
      oe_s4: '200',
      oe_dh4: '0.60',
    },
  },
  {
    id: 'degenere-atterberg-1-point',
    description:
      'Atterberg avec 1 SEUL point (fit log-lin impossible : wL null), classify avertit, ne plante pas',
    input: {
      m_geo: '',
      gr_M: '500',
      gr_2: '10',
      gr_0_5: '60',
      gr_0_2: '120',
      gr_0_08: '200',
      ll_x1: '25',
      ll_t1: '15.00',
      ll_h1: '40.00',
      ll_s1: '32.00',
      // VBS presente -> permet quand meme un classement A par VBS (Ip absent).
      v_conc: '10',
      v_prise1: '30',
      v_frac1: '100',
      v_w1: '4.0',
      v_V1: '120',
      v_prise2: '30',
      v_frac2: '100',
      v_w2: '4.0',
      v_V2: '120',
    },
  },
  // --- HORS-DOMAINE : rien de classable -----------------------------------------
  {
    id: 'indetermine-p80-absent',
    description:
      'Passant 80µm ABSENT (granulo sans tamis fins) : famille INDETERMINEE (warn « passant 80µm manquant »)',
    indetermine: true,
    input: {
      m_geo: '',
      // granulo grossiere SANS le tamis 0.08 -> p80 non interpolable -> indetermine.
      gr_M: '1000',
      gr_20: '100',
      gr_10: '200',
      gr_5: '300',
      gr_2: '400',
    },
  },
  {
    id: 'indetermine-vide',
    description:
      'Aucune donnée classable (ni passant 80µm, ni VBS/Ip) → classe indéterminée',
    indetermine: true,
    input: { m_geo: '' },
  },
];
