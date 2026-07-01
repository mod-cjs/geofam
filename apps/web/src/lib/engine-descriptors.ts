/**
 * Descripteurs CLIENT-SAFE des 6 moteurs de calcul ROADSEN.
 *
 * Ce fichier contient uniquement des métadonnées statiques de formulaire :
 * libellés, types de champs, valeurs d'exemple. Il ne contient aucune formule,
 * aucun symbole de calcul, aucun import de @roadsen/engines.
 *
 * Le calcul reste 100 % serveur. Ce descripteur sert uniquement à afficher
 * un formulaire de saisie et à construire le corps JSON du POST vers l'API.
 *
 * Conformité DoD §8 : zéro logique de calcul côté navigateur.
 */

export type FieldType =
  | 'number'
  | 'text'
  | 'select'
  | 'boolean'
  | 'section'
  | 'array-rows';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
  /** Valeur d'exemple pré-remplie dans le formulaire. */
  example?: string | number | boolean;
  /** Pour type 'select'. */
  options?: SelectOption[];
  /** Pour type 'number'. */
  min?: number;
  max?: number;
  step?: number;
  /** Unité affichée à côté du champ. */
  unit?: string;
  /** Champ non obligatoire (peut être omis). */
  optional?: boolean;
  /** Indication contextuelle affichée sous le champ. */
  hint?: string;
}

export interface EngineDescriptor {
  /** Identifiant logique du moteur (= path de l'endpoint : /calc/<path>). */
  id: string;
  /** Libellé long affiché dans le sélecteur. */
  label: string;
  /** Description courte. */
  description: string;
  /** Norme de référence. */
  norme: string;
  /** Champs de saisie du formulaire (dans l'ordre d'affichage). */
  fields: FieldDescriptor[];
  /**
   * Fonction de transformation de l'objet formulaire (clé/valeur plates)
   * vers le corps JSON attendu par l'API. Les valeurs numériques sont
   * déjà converties en nombres par le formulaire générique.
   */
  buildPayload: (flat: Record<string, unknown>) => unknown;
  /**
   * Jeux d'essai préchargeables (facilite les tests) : chaque scénario est un
   * ensemble de valeurs de champ (clés `flat`) appliquées sur les exemples, pour
   * produire un cas CONFORME ou NON CONFORME. Optionnel (moteurs à verdict).
   */
  scenarios?: {
    conforme?: Record<string, string>;
    nonConforme?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Burmister — dimensionnement de chaussées (AGEROUTE Sénégal 2015)
// ---------------------------------------------------------------------------

const burmisterDescriptor: EngineDescriptor = {
  id: 'burmister',
  label: 'Chaussée — méthode rationnelle (Burmister / AGEROUTE 2015)',
  description: 'Dimensionnement de chaussées souples, semi-rigides et rigides.',
  norme: 'AGEROUTE Sénégal 2015 / LCPC-SETRA',
  fields: [
    { key: 'projet', label: 'Référence projet', type: 'text', example: 'Structure test', optional: true },
    // Trafic
    { key: '_section_trafic', label: 'Trafic', type: 'section' },
    { key: 'traffic_T', label: 'TMJA poids lourds (PL/j/sens)', type: 'number', example: 150, min: 0, max: 1000000, unit: 'PL/j/sens', hint: 'Trafic moyen journalier annuel de poids lourds, par sens de circulation.' },
    { key: 'traffic_C', label: "Coefficient d'agressivité moyen (CAM)", type: 'number', example: 0.9, min: 0, max: 100, hint: "Rapport à l'essieu de référence 13 t (AGEROUTE). Indicatif : 0.5 trafic léger, 0.9 trafic ordinaire, 1.5 trafic lourd." },
    { key: 'traffic_N', label: 'Durée de service', type: 'number', example: 20, min: 1, max: 100, unit: 'ans' },
    { key: 'traffic_tau', label: 'Taux de croissance annuel', type: 'number', example: 4.0, min: -50, max: 50, unit: '%', hint: "Taux d'augmentation annuelle du trafic PL. 0 = trafic constant. Valeur négative admise." },
    { key: 'traffic_dir', label: 'Coefficient directionnel f_dir', type: 'number', example: 1.0, min: 0, max: 2, hint: "Fraction du trafic sur le sens le plus chargé. 1.0 si voie unique ; 0.5 à 0.6 sur route à 2 voies bidirectionnelles." },
    { key: 'traffic_tv', label: 'Coefficient de répartition transversale f_tv', type: 'number', example: 1.0, min: 0, max: 2, hint: 'Fraction du trafic sur la voie de rive (voie la plus chargée). 1.0 par défaut pour une seule voie PL.' },
    // Charge
    { key: '_section_charge', label: 'Charge (jumelage)', type: 'section' },
    { key: 'load_p', label: 'Pression de contact', type: 'number', example: 0.662, min: 0.01, max: 5, unit: 'MPa', hint: 'Pression standard : 0.662 MPa pour essieu de référence 13 t (AGEROUTE 2015).' },
    { key: 'load_a', label: 'Rayon de la surface chargée', type: 'number', example: 0.125, min: 0.01, max: 1, unit: 'm', hint: 'Rayon du cercle équivalent pour une demi-charge d\'essieu. Valeur standard : 0.125 m.' },
    { key: 'load_d', label: 'Entraxe du jumelage', type: 'number', example: 0.375, min: 0, max: 2, unit: 'm', hint: 'Distance entre centres des deux pneumatiques jumelés. 0.375 m = standard essieu 13 t.' },
    // Plateforme support
    { key: '_section_psc', label: 'Plateforme support (PSC)', type: 'section' },
    { key: 'subgrade_cls', label: 'Classe PSC', type: 'text', example: 'PF2', optional: true, hint: 'Classe de plateforme support : PF1, PF2, PF3 ou PF4 (AGEROUTE 2015). Facultatif — informatif uniquement.' },
    { key: 'subgrade_E', label: 'Module E du support', type: 'number', example: 50, min: 1, max: 60000, unit: 'MPa', hint: 'Module de déformation de la plateforme support : PF1 = 20 MPa, PF2 = 50 MPa, PF3 = 120 MPa, PF4 = 200 MPa (AGEROUTE 2015).' },
    { key: 'subgrade_nu', label: 'Coefficient de Poisson ν', type: 'number', example: 0.35, min: 0.1, max: 0.5, hint: 'Valeur usuelle : 0.35 pour sols grenus, 0.40–0.45 pour sols fins saturés.' },
    // Couche 1
    { key: '_section_couche1', label: 'Couche 1 (surface)', type: 'section' },
    { key: 'layer1_mat', label: 'Matériau', type: 'select', example: 'BBSG1', options: [
      { value: 'BBSG1', label: 'BBSG1 — Béton bitumineux semi-grenu classe 1' },
      { value: 'BBSG2', label: 'BBSG2 — Béton bitumineux semi-grenu classe 2' },
      { value: 'GB3', label: 'GB3 — Grave-bitume classe 3' },
      { value: 'GB2', label: 'GB2 — Grave-bitume classe 2' },
      { value: 'EME2', label: 'EME2 — Enrobé à module élevé classe 2' },
      { value: 'GL1', label: 'GL1 — Grave-laitier classe 1' },
      { value: 'GL2', label: 'GL2 — Grave-laitier classe 2' },
      { value: 'GNT1', label: 'GNT1 — Grave non traitée classe 1' },
      { value: 'GNT2', label: 'GNT2 — Grave non traitée classe 2' },
      { value: 'GC3', label: 'GC3 — Grave-ciment classe 3' },
    ]},
    { key: 'layer1_E', label: 'Module E couche 1', type: 'number', example: 5400, min: 1, max: 60000, unit: 'MPa' },
    { key: 'layer1_nu', label: 'Poisson ν couche 1', type: 'number', example: 0.35, min: 0.1, max: 0.5 },
    { key: 'layer1_h', label: 'Épaisseur couche 1', type: 'number', example: 0.06, min: 0.001, max: 2, unit: 'm' },
    // Couche 2
    { key: '_section_couche2', label: 'Couche 2 (base)', type: 'section' },
    { key: 'layer2_mat', label: 'Matériau', type: 'select', example: 'GB3', options: [
      { value: 'GB3', label: 'GB3 — Grave-bitume classe 3' },
      { value: 'GB2', label: 'GB2 — Grave-bitume classe 2' },
      { value: 'EME2', label: 'EME2 — Enrobé à module élevé classe 2' },
      { value: 'GL1', label: 'GL1 — Grave-laitier classe 1' },
      { value: 'GL2', label: 'GL2 — Grave-laitier classe 2' },
      { value: 'GNT1', label: 'GNT1 — Grave non traitée classe 1' },
      { value: 'GNT2', label: 'GNT2 — Grave non traitée classe 2' },
      { value: 'GC3', label: 'GC3 — Grave-ciment classe 3' },
    ]},
    { key: 'layer2_E', label: 'Module E couche 2', type: 'number', example: 5400, min: 1, max: 60000, unit: 'MPa' },
    { key: 'layer2_nu', label: 'Poisson ν couche 2', type: 'number', example: 0.35, min: 0.1, max: 0.5 },
    { key: 'layer2_h', label: 'Épaisseur couche 2', type: 'number', example: 0.10, min: 0.001, max: 2, unit: 'm' },
    // Couche 3
    { key: '_section_couche3', label: 'Couche 3 (fondation)', type: 'section' },
    { key: 'layer3_mat', label: 'Matériau', type: 'select', example: 'GL1', options: [
      { value: 'GL1', label: 'GL1 — Grave-laitier classe 1' },
      { value: 'GL2', label: 'GL2 — Grave-laitier classe 2' },
      { value: 'GNT1', label: 'GNT1 — Grave non traitée classe 1' },
      { value: 'GNT2', label: 'GNT2 — Grave non traitée classe 2' },
      { value: 'GC3', label: 'GC3 — Grave-ciment classe 3' },
    ], optional: true },
    { key: 'layer3_E', label: 'Module E couche 3', type: 'number', example: 800, min: 1, max: 60000, unit: 'MPa', optional: true },
    { key: 'layer3_nu', label: 'Poisson ν couche 3', type: 'number', example: 0.35, min: 0.1, max: 0.5, optional: true },
    { key: 'layer3_h', label: 'Épaisseur couche 3', type: 'number', example: 0.20, min: 0.001, max: 2, unit: 'm', optional: true },
  ],
  buildPayload(flat) {
    const layers: unknown[] = [];
    for (let i = 1; i <= 3; i++) {
      const mat = flat[`layer${i}_mat`];
      const E = flat[`layer${i}_E`];
      const nu = flat[`layer${i}_nu`];
      const h = flat[`layer${i}_h`];
      if (mat && E !== undefined && nu !== undefined && h !== undefined) {
        layers.push({ mat, E: Number(E), nu: Number(nu), h: Number(h) });
      }
    }
    return {
      projet: flat['projet'] || undefined,
      layers,
      subgrade: {
        cls: flat['subgrade_cls'] || undefined,
        E: Number(flat['subgrade_E']),
        nu: Number(flat['subgrade_nu']),
      },
      traffic: {
        T: Number(flat['traffic_T']),
        C: Number(flat['traffic_C']),
        N: Number(flat['traffic_N']),
        tau: Number(flat['traffic_tau']),
        dir: Number(flat['traffic_dir']),
        tv: Number(flat['traffic_tv']),
      },
      load: {
        p: Number(flat['load_p']),
        a: Number(flat['load_a']),
        d: Number(flat['load_d']),
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
      },
    };
  },
  scenarios: {
    conforme: { traffic_T: '10', layer1_h: '0.08', layer2_h: '0.20', layer3_h: '0.40' },
    nonConforme: { traffic_T: '150', layer1_h: '0.06', layer2_h: '0.10', layer3_h: '0.20' },
  },
};

// ---------------------------------------------------------------------------
// Terzaghi — fondation superficielle (NF P 94-261)
// ---------------------------------------------------------------------------

const terzaghiDescriptor: EngineDescriptor = {
  id: 'terzaghi',
  label: 'Fondation superficielle (Terzaghi / NF P 94-261)',
  description: 'Calcul de portance et tassement de fondations superficielles.',
  norme: 'NF P 94-261 (EC7)',
  fields: [
    { key: 'projet', label: 'Référence projet', type: 'text', example: 'Fondation test', optional: true },
    // Géométrie
    { key: '_section_geo', label: 'Géométrie de la fondation', type: 'section' },
    { key: 'forme', label: 'Forme', type: 'select', example: 'rect', options: [
      { value: 'filante', label: 'Filante' },
      { value: 'carree', label: 'Carrée' },
      { value: 'rect', label: 'Rectangulaire' },
      { value: 'circ', label: 'Circulaire' },
    ]},
    { key: 'B', label: 'Largeur B', type: 'number', example: 1.5, unit: 'm' },
    { key: 'L', label: 'Longueur L', type: 'number', example: 2.0, unit: 'm', optional: true, hint: 'Inutile pour filante/carrée' },
    { key: 'D', label: "Profondeur d'encastrement D", type: 'number', example: 1.0, unit: 'm' },
    // Sol
    { key: '_section_sol', label: 'Sol', type: 'section' },
    { key: 'solCat', label: 'Catégorie de sol', type: 'select', example: 'argiles', options: [
      { value: 'argiles', label: 'Argiles' },
      { value: 'sables', label: 'Sables' },
      { value: 'craies', label: 'Craies' },
      { value: 'marnes', label: 'Marnes' },
      { value: 'roches', label: 'Roches' },
    ]},
    { key: 'essai', label: "Type d'essai", type: 'select', example: 'pressio', options: [
      { value: 'pressio', label: 'Pressiomètre Ménard' },
      { value: 'penetro', label: 'Pénétromètre statique (CPT)' },
      { value: 'labo', label: 'Paramètres labo (c–φ)' },
    ]},
    { key: 'profilMode', label: 'Mode de profil', type: 'select', example: 'essais', options: [
      { value: 'essais', label: 'Par essais in situ' },
      { value: 'couches', label: 'Par couches' },
    ]},
    { key: 'nappe', label: 'Profondeur nappe', type: 'number', example: '', optional: true, unit: 'm', hint: '0 ou vide = absente' },
    { key: 'gAvant', label: 'Poids volumique avant fondation γ', type: 'number', example: 18, unit: 'kN/m³', optional: true },
    { key: 'gApres', label: 'Poids volumique après fondation γ', type: 'number', example: 20, unit: 'kN/m³', optional: true },
    { key: 'alphaSang', label: 'Coefficient α Ménard', type: 'number', example: 0.33, optional: true, hint: 'Coefficient rhéologique de Ménard selon catégorie de sol : argile = 0.33, sable = 0.5, craie = 0.5, grave = 1.0.' },
    // Sondage (une ligne)
    { key: '_section_sondage', label: 'Sondage in situ (profondeur 1)', type: 'section' },
    { key: 'sondage_z', label: 'Profondeur z', type: 'number', example: 1.5, unit: 'm' },
    { key: 'sondage_pl', label: 'Pression limite pl* (MPa)', type: 'number', example: 0.8, optional: true },
    { key: 'sondage_em', label: 'Module EM (MPa)', type: 'number', example: 8.0, optional: true },
    { key: 'sondage_qc', label: 'Résistance de pointe qc (MPa)', type: 'number', example: '', optional: true },
    // Cas de charge
    { key: '_section_charges', label: 'Cas de charge ELU fondamental', type: 'section' },
    { key: 'charge_etat', label: 'État-limite', type: 'select', example: 'ELU_F', options: [
      { value: 'ELU_F', label: 'ELU fondamental' },
      { value: 'ELU_A', label: 'ELU accidentel' },
      { value: 'ELS_C', label: 'ELS caractéristique' },
      { value: 'ELS_F', label: 'ELS fréquent' },
      { value: 'ELS_QP', label: 'ELS quasi-permanent' },
    ]},
    { key: 'charge_fz', label: 'Effort vertical Fz', type: 'number', example: 500, unit: 'kN' },
    { key: 'charge_fx', label: 'Effort horizontal Fx', type: 'number', example: 0, unit: 'kN', optional: true },
    { key: 'charge_fy', label: 'Effort horizontal Fy', type: 'number', example: 0, unit: 'kN', optional: true },
  ],
  buildPayload(flat) {
    return {
      projet: flat['projet'] || undefined,
      forme: flat['forme'],
      B: flat['B'],
      L: flat['L'] || undefined,
      D: flat['D'],
      solCat: flat['solCat'],
      essai: flat['essai'],
      profilMode: flat['profilMode'],
      nappe: flat['nappe'] || undefined,
      gAvant: flat['gAvant'] || undefined,
      gApres: flat['gApres'] || undefined,
      alphaSang: flat['alphaSang'] || undefined,
      sondage: [{
        z: flat['sondage_z'],
        // Champs numériques optionnels : `|| undefined` transformerait un 0 légitime en absent.
        // Pattern explicite : vide ou absent → undefined, sinon Number (préserve 0).
        pl: Number.isFinite(Number(flat['sondage_pl'])) ? Number(flat['sondage_pl']) : undefined,
        em: Number.isFinite(Number(flat['sondage_em'])) ? Number(flat['sondage_em']) : undefined,
        qc: Number.isFinite(Number(flat['sondage_qc'])) ? Number(flat['sondage_qc']) : undefined,
        al: undefined,
      }],
      charges: [{
        etat: flat['charge_etat'],
        fz: flat['charge_fz'],
        // fx/fy : 0 est une valeur valide (pas d'effort horizontal) — `|| undefined` interdirait cette saisie.
        fx: Number.isFinite(Number(flat['charge_fx'])) ? Number(flat['charge_fx']) : undefined,
        fy: Number.isFinite(Number(flat['charge_fy'])) ? Number(flat['charge_fy']) : undefined,
      }],
    };
  },
  scenarios: {
    conforme: { charge_fz: '500' },
    nonConforme: { charge_fz: '8000' },
  },
};

// ---------------------------------------------------------------------------
// Pressiomètre Ménard (NF EN ISO 22476-4)
// ---------------------------------------------------------------------------

const pressiometreDescriptor: EngineDescriptor = {
  id: 'pressiometre',
  label: 'Pressiomètre Ménard (NF EN ISO 22476-4)',
  description: "Dépouillement d'un essai pressiométrique à une profondeur donnée.",
  norme: 'NF EN ISO 22476-4',
  fields: [
    { key: 'projet', label: 'Référence projet', type: 'text', example: 'PMT-01', optional: true },
    { key: 'label', label: 'Profondeur (libellé)', type: 'text', example: '5.0 m', hint: 'Exemple : « 5.0 m » — la profondeur est extraite par le moteur' },
    // Paramètres sonde
    { key: '_section_sonde', label: 'Paramètres sonde (unités internes)', type: 'section' },
    { key: 'params_a', label: 'Inertie appareillage a (cm³/bar)', type: 'number', example: 4.5, min: 0, max: 100, hint: 'Valeur déjà divisée par 10 vs saisie en cm³/MPa' },
    { key: 'params_Ph', label: 'Pression hydrostatique Ph (bar)', type: 'number', example: 0.5, min: 0, max: 50 },
    { key: 'params_Pe', label: 'Résistance propre sonde Pe (bar)', type: 'number', example: 0.3, min: 0, max: 50 },
    { key: 'params_V0', label: 'Volume initial V0 (cm³)', type: 'number', example: 535, min: 1, max: 10000 },
    { key: 'params_k0', label: 'Coefficient K0', type: 'number', example: 0.5, min: 0, max: 5 },
    // Sol
    { key: '_section_sol', label: 'Sol', type: 'section' },
    { key: 'gamma', label: 'Poids volumique γ (kN/m³)', type: 'number', example: 19, min: 0, max: 40 },
    { key: 'nappe', label: 'Profondeur nappe (m, 0 = absente)', type: 'number', example: 0, min: 0, max: 1000 },
    // Paliers de mesure (4 paliers minimum)
    { key: '_section_paliers', label: 'Paliers de mesure (4 minimum)', type: 'section' },
    ...([1, 2, 3, 4, 5, 6].flatMap(i => [
      { key: `row${i}_p`, label: `Palier ${i} — Pression P (bar)`, type: 'number' as FieldType, example: i * 2, min: 0, max: 500, optional: i > 4 },
      { key: `row${i}_v15`, label: `Palier ${i} — Volume V15 (cm³)`, type: 'number' as FieldType, example: 535 + i * 20, min: 0, max: 10000, optional: i > 4 },
      { key: `row${i}_v30`, label: `Palier ${i} — Volume V30 (cm³)`, type: 'number' as FieldType, example: 540 + i * 20, min: 0, max: 10000, optional: i > 4 },
      { key: `row${i}_v60`, label: `Palier ${i} — Volume V60 (cm³)`, type: 'number' as FieldType, example: 548 + i * 20, min: 0, max: 10000, optional: i > 4 },
    ])),
  ],
  buildPayload(flat) {
    const rows: unknown[] = [];
    for (let i = 1; i <= 6; i++) {
      const p = flat[`row${i}_p`];
      const v15 = flat[`row${i}_v15`];
      const v30 = flat[`row${i}_v30`];
      const v60 = flat[`row${i}_v60`];
      if (p !== undefined && p !== '' && v15 !== undefined && v30 !== undefined && v60 !== undefined) {
        rows.push({ p: Number(p), v15: Number(v15), v30: Number(v30), v60: Number(v60) });
      }
    }
    return {
      projet: flat['projet'] || undefined,
      label: flat['label'],
      params: {
        a: Number(flat['params_a']),
        Ph: Number(flat['params_Ph']),
        Pe: Number(flat['params_Pe']),
        V0: Number(flat['params_V0']),
        k0: Number(flat['params_k0']),
      },
      gamma: Number(flat['gamma']),
      nappe: Number(flat['nappe']),
      rows,
    };
  },
};

// ---------------------------------------------------------------------------
// Pieux — fondation profonde (NF P 94-262 / EC7)
//
// ID canonique : 'pieux' = slug backend (dispatch + entitlements).
// Moteur GeoSuite source : casagrande.js (cf. mémoire geosuite-engine-mapping).
// registryId backend : 'fondation-profonde-pieux'.
// ---------------------------------------------------------------------------

const pieuxDescriptor: EngineDescriptor = {
  id: 'pieux',
  label: 'Fondation profonde — pieux (NF P 94-262)',
  description: 'Calcul de portance et vérification ELU/ELS de pieux isolés ou en groupe.',
  norme: 'NF P 94-262 (EC7 DA2 NA France)',
  fields: [
    { key: 'projet', label: 'Référence projet', type: 'text', example: 'Pieu P1', optional: true },
    { key: 'pieu', label: 'Libellé pieu', type: 'text', example: 'Pieu foré Ø600', optional: true },
    // Géométrie
    { key: '_section_geo', label: 'Géométrie du pieu', type: 'section' },
    { key: 'geom_section', label: 'Type de section', type: 'select', example: 'circ', options: [
      { value: 'circ', label: 'Circulaire' },
      { value: 'carre', label: 'Carrée' },
      { value: 'rect', label: 'Rectangulaire' },
      { value: 'quel', label: 'Quelconque (Ap, P fournis)' },
    ]},
    { key: 'geom_g_B', label: 'Diamètre / côté B (m)', type: 'number', example: 0.6, min: 0, max: 10 },
    { key: 'g_z0', label: 'Profondeur de tête z₀ (m)', type: 'number', example: 0.5, min: 0, max: 500 },
    { key: 'g_D', label: 'Profondeur de base D (m)', type: 'number', example: 12.0, min: 0, max: 500 },
    { key: 'cat', label: 'Catégorie de pieu (Tableau A.1)', type: 'number', example: 2, min: 1, max: 20 },
    // Méthode et options
    { key: '_section_meth', label: 'Méthode et hypothèses', type: 'section' },
    { key: 'meth', label: 'Méthode de portance', type: 'select', example: 'pmt', options: [
      { value: 'pmt', label: 'Pressiométrique (PMT)' },
      { value: 'cpt', label: 'Pénétrométrique (CPT)' },
      { value: 'cphi', label: 'Paramètres c–φ' },
    ]},
    { key: 'da', label: "Approche de calcul EC7", type: 'select', example: 'da2', options: [
      { value: 'da1', label: 'DA1' },
      { value: 'da2', label: 'DA2 (NA France)' },
      { value: 'da3', label: 'DA3' },
    ]},
    { key: 'sens', label: 'Sens de sollicitation', type: 'select', example: 'comp', options: [
      { value: 'comp', label: 'Compression' },
      { value: 'trac', label: 'Traction' },
    ]},
    { key: 'essais', label: 'Essais de chargement disponibles', type: 'select', example: 'non', options: [
      { value: 'oui', label: 'Oui' },
      { value: 'non', label: 'Non' },
    ]},
    // Charges
    { key: '_section_charges', label: 'Charges', type: 'section' },
    { key: 'c_G', label: 'Charge permanente caractéristique G (kN)', type: 'number', example: 800, min: 0 },
    { key: 'c_Q', label: 'Charge variable caractéristique Q (kN)', type: 'number', example: 200, min: 0 },
    { key: 'o_nappe', label: 'Profondeur nappe (m)', type: 'number', example: 3.0, min: 0, max: 500 },
    // Investigation
    { key: '_section_invest', label: 'Investigation', type: 'section' },
    { key: 'o_nprofil', label: 'Nombre de profils de sol N', type: 'number', example: 2, min: 1, max: 10000 },
    { key: 'o_surf', label: 'Surface investiguée (m²)', type: 'number', example: 500, min: 0 },
    { key: 'o_redis', label: 'Redistribution par structure rigide', type: 'select', example: 'non', options: [
      { value: 'oui', label: 'Oui' },
      { value: 'non', label: 'Non' },
    ]},
    // Couche de sol 1
    { key: '_section_sol1', label: 'Couche 1 (profil de sol)', type: 'section' },
    { key: 'layer1_soil', label: 'Nature du sol', type: 'select', example: 'argile', options: [
      { value: 'argile', label: 'Argile' },
      { value: 'sable', label: 'Sable' },
      { value: 'craie', label: 'Craie' },
      { value: 'marne', label: 'Marne' },
      { value: 'roche', label: 'Roche' },
    ]},
    { key: 'layer1_th', label: 'Épaisseur (m)', type: 'number', example: 5.0, min: 0, max: 200 },
    { key: 'layer1_pl', label: 'Pression limite nette pl* (MPa)', type: 'number', example: 0.6, min: 0, max: 100, optional: true },
    { key: 'layer1_em', label: 'Module EM (MPa)', type: 'number', example: 6.0, min: 0, max: 100000, optional: true },
    // Couche 2
    { key: '_section_sol2', label: 'Couche 2 (profil de sol)', type: 'section' },
    { key: 'layer2_soil', label: 'Nature du sol', type: 'select', example: 'argile', options: [
      { value: 'argile', label: 'Argile' },
      { value: 'sable', label: 'Sable' },
      { value: 'craie', label: 'Craie' },
      { value: 'marne', label: 'Marne' },
      { value: 'roche', label: 'Roche' },
    ], optional: true},
    { key: 'layer2_th', label: 'Épaisseur (m)', type: 'number', example: 7.0, min: 0, max: 200, optional: true },
    { key: 'layer2_pl', label: 'Pression limite nette pl* (MPa)', type: 'number', example: 1.2, min: 0, max: 100, optional: true },
    { key: 'layer2_em', label: 'Module EM (MPa)', type: 'number', example: 12.0, min: 0, max: 100000, optional: true },
  ],
  buildPayload(flat) {
    const layers: unknown[] = [];
    for (let i = 1; i <= 2; i++) {
      const soil = flat[`layer${i}_soil`];
      const th = flat[`layer${i}_th`];
      if (soil && th !== undefined && th !== '') {
        layers.push({
          soil,
          th: Number(th),
          pl: flat[`layer${i}_pl`] !== '' && flat[`layer${i}_pl`] !== undefined ? Number(flat[`layer${i}_pl`]) : undefined,
          em: flat[`layer${i}_em`] !== '' && flat[`layer${i}_em`] !== undefined ? Number(flat[`layer${i}_em`]) : undefined,
        });
      }
    }
    return {
      projet: flat['projet'] || undefined,
      pieu: flat['pieu'] || undefined,
      geom: {
        section: flat['geom_section'],
        g_B: flat['geom_g_B'] !== '' ? Number(flat['geom_g_B']) : undefined,
      },
      g_z0: Number(flat['g_z0']),
      g_D: Number(flat['g_D']),
      cat: Number(flat['cat']),
      meth: flat['meth'],
      da: flat['da'],
      sens: flat['sens'],
      essais: flat['essais'],
      c_G: Number(flat['c_G']),
      c_Q: Number(flat['c_Q']),
      o_nappe: Number(flat['o_nappe']),
      o_nprofil: Number(flat['o_nprofil']),
      o_surf: Number(flat['o_surf']),
      o_redis: flat['o_redis'],
      grp: { grp_n: 1, grp_m: 1, grp_s: 0 },
      coeffs: {
        k_gG: 1.35, k_gQ: 1.5, k_gb: 1.1, k_gs: 1.1, k_gst: 1.15,
        k_psi2: 0.3, cr_b_b: 0.7, cr_b_s: 0.7, cr_f_b: 0.5, cr_f_s: 0.7,
        cr_car: 0.9, cr_qp: 1.1, cr_car_t: 1.1, cr_qp_t: 1.5,
      },
      layers,
      cpt: { step: 0.2, pts: [] },
    };
  },
  scenarios: {
    conforme: { c_G: '150', c_Q: '50' },
    nonConforme: { c_G: '800', c_Q: '200' },
  },
};

// ---------------------------------------------------------------------------
// Radier / plaque sur sol élastique multicouche (EF)
//
// ID canonique : 'radier' = slug backend (dispatch + entitlements).
// Moteur GeoSuite source : GEOPLAQUE.js (cf. mémoire geosuite-engine-mapping).
// registryId backend : 'radier-plaque'.
// ---------------------------------------------------------------------------

const radierDescriptor: EngineDescriptor = {
  id: 'radier',
  label: 'Radier / plaque sur sol élastique (EF)',
  description: "Tassements et diagnostics d'une fondation sur radier par éléments finis.",
  norme: 'Méthode Ménard — EF plaque de Winkler généralisé',
  fields: [
    { key: 'projet', label: 'Référence projet', type: 'text', example: 'Radier R1', optional: true },
    // Géométrie plaque
    { key: '_section_plaque', label: 'Plaque (radier rectangulaire simplifié)', type: 'section' },
    { key: 'raft_E', label: 'Module béton E (MPa)', type: 'number', example: 30000, min: 0.001, max: 1000000 },
    { key: 'raft_nu', label: 'Poisson béton ν', type: 'number', example: 0.2, min: 0, max: 0.499 },
    { key: 'raft_e', label: 'Épaisseur radier e (m)', type: 'number', example: 0.5, min: 0.001, max: 100 },
    { key: 'raft_Lx', label: 'Longueur Lx (m)', type: 'number', example: 10.0, min: 0.1, max: 10000 },
    { key: 'raft_Ly', label: 'Largeur Ly (m)', type: 'number', example: 6.0, min: 0.1, max: 10000 },
    // Charge ponctuelle
    { key: '_section_charge', label: 'Charge ponctuelle (centre du radier)', type: 'section' },
    { key: 'load_Fz', label: 'Effort vertical Fz (kN)', type: 'number', example: 2000 },
    { key: 'load_x', label: 'Position x (m)', type: 'number', example: 5.0 },
    { key: 'load_y', label: 'Position y (m)', type: 'number', example: 3.0 },
    // Sol
    { key: '_section_sol', label: 'Sol (couche unique)', type: 'section' },
    { key: 'soil_E', label: 'Module sol E (MPa)', type: 'number', example: 20, min: 0.001, max: 1000000 },
    { key: 'soil_nu', label: 'Poisson sol ν', type: 'number', example: 0.33, min: 0, max: 0.499 },
    { key: 'soil_zBase', label: 'Base couche zBase (m, négatif vers le bas)', type: 'number', example: -20, max: 10000 },
    // Options
    { key: '_section_opts', label: 'Options de calcul', type: 'section' },
    { key: 'opts_mesh', label: 'Pas de maillage (m)', type: 'number', example: 1.0, min: 0.01, max: 100 },
  ],
  buildPayload(flat) {
    const Lx = Number(flat['raft_Lx']);
    const Ly = Number(flat['raft_Ly']);
    return {
      projet: flat['projet'] || undefined,
      rafts: [{
        pts: [
          { x: 0, y: 0 },
          { x: Lx, y: 0 },
          { x: Lx, y: Ly },
          { x: 0, y: Ly },
        ],
        E: Number(flat['raft_E']),
        nu: Number(flat['raft_nu']),
        e: Number(flat['raft_e']),
      }],
      pointLoads: [{
        x: Number(flat['load_x']),
        y: Number(flat['load_y']),
        Fz: Number(flat['load_Fz']),
      }],
      layers: [{
        zBase: Number(flat['soil_zBase']),
        E: Number(flat['soil_E']),
        nu: Number(flat['soil_nu']),
      }],
      opts: {
        mesh: Number(flat['opts_mesh']),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// FASTLAB — essais de labo & classification GTR (NF P 11-300)
//
// ID canonique : 'labo' = slug backend (dispatch + entitlements).
// Moteur GeoSuite source : FASTLAB.js (cf. mémoire geosuite-engine-mapping).
// registryId backend : 'labo-classification-gtr'.
// ---------------------------------------------------------------------------

const laboDescriptor: EngineDescriptor = {
  id: 'labo',
  label: 'Labo & classification GTR (FASTLAB / NF P 11-300)',
  description: 'Classification GTR des sols à partir des résultats de laboratoire.',
  norme: 'NF P 11-300 (GTR)',
  fields: [
    // Identification
    { key: 'm_ref', label: 'Référence échantillon', type: 'text', example: 'ECH-001', optional: true },
    { key: 'm_chantier', label: 'Chantier', type: 'text', example: 'RN1 - PK 12+500', optional: true },
    { key: 'm_nature', label: 'Nature du sol', type: 'text', example: 'Argile sableuse', optional: true },
    // Granulométrie
    { key: '_section_granulo', label: 'Granulométrie', type: 'section' },
    { key: 'gr_0_08', label: 'Passant 80 µm (%)', type: 'number', example: 35, min: 0, max: 100, unit: '%' },
    { key: 'gr_2', label: 'Passant 2 mm (%)', type: 'number', example: 80, min: 0, max: 100, unit: '%', optional: true },
    { key: 'gr_M', label: 'Masse totale M (g)', type: 'number', example: 500, optional: true },
    // Atterberg
    { key: '_section_atterberg', label: 'Limites d\'Atterberg', type: 'section' },
    { key: 'll_x1', label: "Coups N1 (limite de liquidité)", type: 'number', example: 25, optional: true },
    { key: 'll_t1', label: 'Tare T1 (g)', type: 'number', example: 10.5, optional: true },
    { key: 'll_h1', label: 'Masse humide H1 (g)', type: 'number', example: 30.2, optional: true },
    { key: 'll_s1', label: 'Masse sèche S1 (g)', type: 'number', example: 22.1, optional: true },
    { key: 'pl_t1', label: 'Tare plasticité T1 (g)', type: 'number', example: 10.2, optional: true },
    { key: 'pl_h1', label: 'Masse humide plasticité H1 (g)', type: 'number', example: 20.5, optional: true },
    { key: 'pl_s1', label: 'Masse sèche plasticité S1 (g)', type: 'number', example: 18.0, optional: true },
    // VBS
    { key: '_section_vbs', label: 'Valeur de bleu VBS', type: 'section' },
    { key: 'v_conc', label: 'Concentration bleu (g/l)', type: 'number', example: 10, optional: true },
    { key: 'v_prise1', label: 'Prise 1 (ml)', type: 'number', example: 5.0, optional: true },
    { key: 'v_frac1', label: 'Fraction 1 (g)', type: 'number', example: 50, optional: true },
  ],
  buildPayload(flat) {
    const out: Record<string, unknown> = {};
    // On transmet tous les champs non-section directement
    for (const [k, v] of Object.entries(flat)) {
      if (!k.startsWith('_section_') && v !== '' && v !== undefined) {
        out[k] = typeof v === 'string' && !isNaN(Number(v)) && v !== '' ? Number(v) : v;
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Registre des 6 moteurs
// ---------------------------------------------------------------------------

export const ENGINE_DESCRIPTORS: readonly EngineDescriptor[] = [
  burmisterDescriptor,
  terzaghiDescriptor,
  pressiometreDescriptor,
  pieuxDescriptor,
  radierDescriptor,
  laboDescriptor,
];

export function findDescriptor(id: string): EngineDescriptor | undefined {
  return ENGINE_DESCRIPTORS.find((d) => d.id === id);
}
