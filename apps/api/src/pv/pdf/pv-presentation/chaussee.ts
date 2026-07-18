import type { PresentationModel } from './types';

/**
 * MODÈLE DE PRÉSENTATION — moteur CHAUSSÉE (burmister / AGEROUTE 2015), #71.
 *
 * EXTERNALISÉ pour que STARFIRE confirme/ajuste les libellés science SANS toucher
 * au renderer. Marqueurs de provenance des libellés :
 *   [std]      = standard incontestable, codé maintenant.
 *   [STARFIRE] = libellé/unité PROVISOIRE (science) à confirmer par l'expert client.
 *                (Aucun tag « provisoire » n'est rendu sur le document — c'est une
 *                note interne ; la question part avec le rapport.)
 *
 * CONFIDENTIALITÉ (DoD §8) : on ne mappe QUE des champs de la sortie scellée
 * whitelistée. `hiddenKeys` masque le bruit ET les flags de branche de méthode
 * (fatigue.requis/rigide) + les coefficients de calage (load.ks/sh/r détail).
 *
 * UNITÉS / FORMAT (table expert + designer) : E en MPa, ν sans unité, épaisseurs
 * stockées en MÈTRES mais AFFICHÉES en CM (scale 100), p en MPa, a/d en m, NE
 * adimensionnel (notation scientifique), εt/εz (fatigue/orniérage) en µdef
 * [STARFIRE]. Résultats à 2-3 chiffres significatifs.
 *
 * COLONNE « RÔLE » de la structure : OMISE — le mapping rôle↔couche
 * (roulement/base/fondation) n'est pas une donnée scellée et reste incertain ;
 * l'expert a dit « si pas sûr, omets ». À rouvrir avec STARFIRE.
 */
export const CHAUSSEE_PRESENTATION: PresentationModel = {
  engineLabel:
    'Dimensionnement de chaussée (méthode rationnelle — AGEROUTE 2015)',
  objectSentence:
    'Vérification du dimensionnement de la structure de chaussée {projet} ' +
    'par la méthode rationnelle (modèle multicouche élastique, référentiel AGEROUTE 2015).',

  // VERDICT : le booléen SCELLÉ `conforme` (jamais recalculé) -> bandeau.
  verdict: {
    key: 'conforme',
    labelTrue: 'CONFORME',
    labelFalse: 'NON CONFORME',
  },

  // CRITÈRES dimensionnants : fatigue (couche liée) + orniérage (sol support).
  // valeur/admissible en µdef [STARFIRE]. Le taux de travail (=valeur/admissible)
  // est calculé par le renderer (enrichissement trivial autorisé).
  criteria: [
    {
      label: 'Fatigue des couches liées (εt)', // [STARFIRE] εt = déformation de fatigue
      valuePath: 'fatigue.valeur',
      admissiblePath: 'fatigue.admissible',
      format: { decimals: 0, unit: 'µdef' },
      // OPTIONNEL : une chaussee TOUTE GRANULAIRE (piste non revetue) n'a pas de couche
      // liee -> `out.fatigue` ABSENT (pas juste le flag). Sans `optional`, le renderer
      // affichait quand meme le critere -> taux null -> ✗ sous bandeau CONFORME (re-revue
      // MAJEUR : le defaut « flag absent => requis » ne couvre pas l'objet critere entier
      // manquant). `optional` -> `activeCriteria` l'omet quand fatigue.valeur n'est pas fini,
      // alignant le PV sur le web (qui omet deja la ligne).
      optional: true,
      // Verdict public : requis=false (souple à faible trafic) -> rendu informatif.
      requisPath: 'fatigue.requis',
      // MAJEUR-2 : familles RIGIDES (fatigue.rigide=true) -> σt en MPa (pas µdef).
      rigideFlagPath: 'fatigue.rigide',
      rigideLabel: 'Fatigue des couches traitées (σt)',
      rigideFormat: { decimals: 3, unit: 'MPa' },
    },
    {
      label: 'Déformation du sol support (εz)', // [STARFIRE] εz = orniérage / déformation permanente
      valuePath: 'ornierage.valeur',
      admissiblePath: 'ornierage.admissible',
      format: { decimals: 0, unit: 'µdef' },
    },
    // Critères SECONDAIRES (affichés SEULEMENT pour les familles concernées —
    // `optional`) : phase 2 des structures mixtes (§4.4.1, εt µdef) et structures
    // inverses (§4.5, σt MPa). Le n° de couche est masqué de la ligne (hiddenKeys)
    // et documenté par le libellé ; le verdict est porté par le picto.
    {
      label: 'Fatigue phase 2 — base bitumineuse (εt)', // [STARFIRE] structures mixtes §4.4.1
      valuePath: 'fatiguePhase2.valeur',
      admissiblePath: 'fatiguePhase2.admissible',
      format: { decimals: 0, unit: 'µdef' },
      optional: true,
      // MAJEUR-1 : non requis pour un semi-rigide Kmix<0,5 -> informatif (jamais ✗
      // sous CONFORME). requis=true (mixte Kmix>=0,5) -> verdict normal.
      requisPath: 'fatiguePhase2.requis',
    },
    {
      label: 'Structure inverse — base MTLH profond (σt)', // [STARFIRE] §4.5
      valuePath: 'fatigueInverse.valeur',
      admissiblePath: 'fatigueInverse.admissible',
      format: { decimals: 3, unit: 'MPa' },
      optional: true,
      // Toujours requis (okSt2 toujours plié) — chemin symétrique, verdict normal.
      requisPath: 'fatigueInverse.requis',
    },
  ],

  // TABLES de vérification PAR COUCHE (rendues seulement si non vides) :
  //  - σt par couche traitée + mode d'interface (Tab. 68 AGEROUTE) ;
  //  - détail εz par couche granulaire non liée (§4.1.2).
  layerTables: [
    {
      title: 'Contrainte σt par couche traitée (interface — Tab. 68)',
      arrayPath: 'couchesTraitees',
      coucheKey: 'couche',
      modeKey: 'mode',
      valueKey: 'valeur',
      admissibleKey: 'admissible',
      okKey: 'ok',
      // Critère σt rigide principal : toujours requis (verdict normal) ; le drapeau
      // est lu pour rester cohérent si une évolution du moteur l'exemptait.
      requisKey: 'requis',
      format: { decimals: 3, unit: 'MPa' },
    },
    {
      title: 'Déformation εz par couche granulaire (§4.1.2)',
      arrayPath: 'couchesGranulaires',
      coucheKey: 'couche',
      valueKey: 'valeur',
      admissibleKey: 'admissible',
      okKey: 'ok',
      // MAJEUR-1 : couche granulaire EXEMPTÉE (§4.1.2, requis=false) -> informatif,
      // jamais un ✗ sous CONFORME même si ε_z dépasse le seuil.
      requisKey: 'requis',
      format: { decimals: 0, unit: 'µdef' },
    },
  ],

  // STRUCTURE : couches haut->bas + sol support en dernière ligne (semi-infini).
  structure: {
    title: 'Structure de chaussée',
    layersPath: 'layers',
    subgradePath: 'subgrade',
    columns: [
      { header: 'Matériau', key: 'mat', align: 'left' }, // mat -> Matériau [std]
      {
        header: 'E (MPa)',
        key: 'E',
        format: { decimals: 0, unit: '' },
        align: 'right',
      }, // [std]
      {
        header: 'ν',
        key: 'nu',
        format: { decimals: 2, unit: '' },
        align: 'right',
      }, // Poisson [std]
      {
        header: 'Épaisseur (cm)',
        key: 'h',
        format: { decimals: 1, unit: '', scale: 100 }, // m -> cm (affichage seul)
        align: 'right',
      },
    ],
    subgradeThicknessLabel: 'semi-infini',
  },

  // ENTRÉES hors structure : trafic (hypothèses + coefficients), charge de référence.
  inputGroups: [
    {
      title: 'Trafic',
      // ⚠️ LIBELLÉS TRAFIC = LECTURE EXPERT (autorité métier, cohérente avec
      // NE ≈ 1,47×10⁶). On N'utilise PAS les libellés du designer (faux : il
      // intervertit T/N). [STARFIRE] = à confirmer par l'expert client.
      fields: [
        // Hypothèses de trafic :
        { path: 'traffic.T', label: 'Trafic poids lourds journalier (MJA)' }, // [STARFIRE]
        { path: 'traffic.N', label: 'Durée de service' }, // [STARFIRE]
        { path: 'traffic.tau', label: 'Taux de croissance du trafic' }, // [STARFIRE]
        // Coefficients (sens incertain -> libellés génériques sûrs) :
        { path: 'traffic.C', label: 'Coefficient de trafic C' }, // générique [STARFIRE]
        { path: 'traffic.tv', label: 'Coefficient de répartition (voie)' }, // générique
        // #71-titulaire(4) : « Sens de circulation = 1 » était gênant (un sens
        // n'est pas un nombre). dir = coefficient adimensionnel (valeur 1 naturelle).
        { path: 'traffic.dir', label: 'Coefficient directionnel' }, // générique [STARFIRE]
      ],
    },
    {
      title: 'Charge de référence (essieu standard 130 kN)',
      fields: [
        { path: 'load.p', label: 'Pression de contact' }, // [std]
        { path: 'load.a', label: 'Rayon d’empreinte' }, // [std]
        { path: 'load.d', label: 'Entraxe des roues jumelées' }, // [std]
        // ks / sh / r : NON détaillés (confidentialité). Note « auto » seulement.
        {
          path: 'load.r',
          label: 'Paramètres de sécurité',
          fallbackText: 'déterminés par le moteur (auto)',
        },
      ],
    },
  ],

  // RÉSULTATS hors verdict/critères.
  resultGroups: [
    {
      title: 'Synthèse du dimensionnement',
      fields: [
        { path: 'famille', label: 'Famille de structure (AGEROUTE)' }, // [std]
        {
          path: 'NE',
          label: 'Nombre d’essieux équivalents cumulés (NE)',
          format: { decimals: 0, unit: '', scientific: true },
        },
        {
          path: 'epaisseurTotale',
          label: 'Épaisseur totale',
          format: { decimals: 1, unit: 'cm', scale: 100 },
        },
        {
          path: 'epaisseurLiee',
          label: 'Épaisseur des couches liées',
          format: { decimals: 1, unit: 'cm', scale: 100 },
        },
      ],
    },
  ],

  // RAPPORT DÉTAILLÉ DE CALCUL (annexe) — équivalent du « Rapport détaillé »
  // (renderDetails) de l'outil client ROADSENS. Rend les GRANDEURS de sortie
  // whitelistées `details.*` (contraintes σ, déformations ε, coefficients de la loi
  // de fatigue LCPC) — EXACTEMENT ce que renderDetails affiche à l'écran
  // (détails-transparents, ADR 0014 / décision titulaire 13/07). Ce sont des VALEURS
  // de sortie de la méthode publiée ; le CALAGE (tables e6/σ6/b par matériau, θ_eq) et
  // le CODE du propagateur restent SERVEUR — on ne rend AUCUNE formule de méthode ni
  // la matrice de transfert 4×4 (non portées par la sortie scellée, cf. §8).
  // Ordre & libellés alignés sur renderDetails (l.1481-1585). Les admissibles
  // basculent µdef->MPa pour les familles rigides (rigideFormat, miroir de `d.sig`).
  detailReport: {
    title: 'Rapport détaillé de calcul',
    subtitle:
      'Grandeurs de la méthode Burmister multicouche exacte — référentiel ' +
      'AGEROUTE Sénégal 2015 (LCPC/SETRA 1994). Valeurs de sortie ; le calage et ' +
      'l’algorithme restent internes.',
    rootPath: 'details',
    rigideFlagPath: 'fatigue.rigide',
    sections: [
      {
        // renderDetails §3 (modules pondérés) + plateforme (§1).
        title: 'Modules pondérés et plateforme',
        fields: [
          {
            path: 'details.E1_pond',
            label: 'Ē pondérée du paquet lié',
            format: { decimals: 0, unit: 'MPa' },
          },
          {
            path: 'details.nu1_pond',
            label: 'ν̄ pondérée du paquet lié',
            format: { decimals: 3, unit: '' },
          },
          {
            path: 'details.E_psc',
            label: 'Module de la plateforme (PSC)',
            format: { decimals: 0, unit: 'MPa' },
          },
          {
            path: 'details.nu_psc',
            label: 'ν de la plateforme',
            format: { decimals: 2, unit: '' },
          },
          {
            path: 'details.risque_pct',
            label: 'Risque de calcul r',
            format: { decimals: 0, unit: '%' },
          },
        ],
      },
      {
        // renderDetails §5 (interface critique) + §8 (sommet PSC). σ en kPa (×1000).
        title: 'Contraintes à l’interface critique (Burmister exact)',
        fields: [
          {
            path: 'details.sigmaZ_r0',
            label: 'σ_z à l’interface critique · r=0',
            format: { decimals: 2, unit: 'kPa' },
          },
          {
            path: 'details.sigmaR_r0',
            label: 'σ_r à l’interface critique · r=0',
            format: { decimals: 2, unit: 'kPa' },
          },
          {
            path: 'details.sigmaZ_d2',
            label: 'σ_z à l’interface critique · r=d/2',
            format: { decimals: 2, unit: 'kPa' },
          },
          {
            path: 'details.sigmaR_d2',
            label: 'σ_r à l’interface critique · r=d/2',
            format: { decimals: 2, unit: 'kPa' },
          },
          {
            path: 'details.sigmaZ_psc_kpa',
            label: 'σ_z au sommet de la plateforme',
            format: { decimals: 2, unit: 'kPa' },
          },
          {
            path: 'details.sigmaR_psc_kpa',
            label: 'σ_r au sommet de la plateforme',
            format: { decimals: 2, unit: 'kPa' },
          },
        ],
      },
      {
        // renderDetails §6 (déformation de fatigue ε_t).
        title: 'Déformation de fatigue ε_t',
        fields: [
          {
            path: 'details.epsilonT_r0',
            label: 'ε_t à r=0',
            format: { decimals: 2, unit: 'µdef' },
          },
          {
            path: 'details.epsilonT_d2',
            label: 'ε_t à r=d/2 (roues jumelées)',
            format: { decimals: 2, unit: 'µdef' },
          },
          {
            path: 'details.epsilonT',
            label: 'ε_t retenue (max)',
            format: { decimals: 2, unit: 'µdef' },
          },
        ],
      },
      {
        // renderDetails §7 (loi de fatigue LCPC 1994). Les admissibles basculent
        // µdef->MPa pour les familles rigides (rigideFormat, miroir de `d.sig`).
        title: 'Coefficients de la loi de fatigue (LCPC 1994, VI.4.2)',
        fields: [
          {
            path: 'details.ktheta',
            label: 'kθ (température)',
            format: { decimals: 3, unit: '' },
          },
          {
            path: 'details.sn',
            label: 'SN (écart-type des essais de fatigue)',
            format: { decimals: 2, unit: '' },
          },
          {
            path: 'details.sh_cm',
            label: 'Sh (écart-type de construction)',
            format: { decimals: 2, unit: 'cm' },
          },
          {
            path: 'details.delta',
            label: 'δ',
            format: { decimals: 4, unit: '' },
          },
          {
            path: 'details.kr',
            label: 'kr (risque)',
            format: { decimals: 4, unit: '' },
          },
          {
            path: 'details.kc',
            label: 'kc (calage)',
            format: { decimals: 2, unit: '' },
          },
          {
            path: 'details.ks',
            label: 'ks (support)',
            format: { decimals: 4, unit: '' },
          },
          {
            path: 'details.ub',
            label: '1/b (pente de la loi de fatigue)',
            format: { decimals: 1, unit: '' },
          },
          {
            path: 'details.epsilonT_adm',
            label: 'ε_t admissible (au risque r)',
            format: { decimals: 2, unit: 'µdef' },
            rigideFormat: { decimals: 3, unit: 'MPa' },
          },
          {
            path: 'details.adm_r50',
            label: 'ε_t admissible à r=50 %',
            format: { decimals: 2, unit: 'µdef' },
            rigideFormat: { decimals: 3, unit: 'MPa' },
          },
        ],
      },
      {
        // renderDetails §8 (orniérage ε_z au sommet PSC).
        title: 'Déformation d’orniérage ε_z',
        fields: [
          {
            path: 'details.epsilonZ_axe',
            label: 'ε_z à l’axe de la roue',
            format: { decimals: 2, unit: 'µdef' },
          },
          {
            path: 'details.epsilonZ_mid',
            label: 'ε_z entre jumelage',
            format: { decimals: 2, unit: 'µdef' },
          },
          {
            path: 'details.epsilonZ',
            label: 'ε_z retenue (max)',
            format: { decimals: 2, unit: 'µdef' },
          },
          {
            path: 'details.epsilonZ_adm',
            label: 'ε_z admissible',
            format: { decimals: 2, unit: 'µdef' },
          },
        ],
      },
    ],
  },

  // MASQUÉS : bruit + confidentialité (fail-closed).
  //  - erreur (si vide) : masqué dynamiquement par le renderer ; listé ici pour
  //    n'être jamais rendu en ligne brute.
  //  - warnings : géré À PART (encadré d'alerte si NON vide, rien si vide) — un
  //    array, donc jamais en clé-valeur ni en « Autres paramètres » de toute façon.
  //  - *.ok : booléens -> pictos dans la table vérifications, pas en ligne ;
  //  - fatigue.requis / fatigue.rigide : FLAGS DE BRANCHE DE MÉTHODE -> anti-fuite ;
  //  - conforme : consommé par le bandeau, pas affiché en ligne ;
  //  - load.ks / load.sh / load.r : coefficients de calage -> JAMAIS détaillés
  //    (la note « déterminés par le moteur (auto) » s'affiche via fallbackText, la
  //    valeur brute est masquée ; load.r listé ici en défense « Autres paramètres »).
  hiddenKeys: [
    // projet : clé moteur redondante avec le projet de l'en-tête (valeur distincte
    // de identity.projectName) -> MASQUÉE (B-1 : sans ça, l'ancien rendu auto
    // « Autres paramètres » fuyait « Structure de reference ROADSENS »). Le projet
    // affiché vient de l'identité scellée, pas de cette clé d'entrée moteur.
    'projet',
    'erreur',
    'conforme',
    'fatigue.ok',
    'fatigue.requis',
    'fatigue.rigide',
    'ornierage.ok',
    // Critères secondaires : verdict porté par le picto (ok) et n° de couche baké
    // dans le libellé / la colonne « Couche » -> non rendus en ligne clé-valeur.
    'fatiguePhase2.ok',
    'fatiguePhase2.couche',
    'fatigueInverse.ok',
    'fatigueInverse.couche',
    'load.ks',
    'load.sh',
    'load.r',
  ],

  // FORMATS par chemin (fallback si pas de format inline).
  numberFormat: {
    'traffic.T': { decimals: 0, unit: 'PL/j' }, // [STARFIRE]
    'traffic.N': { decimals: 0, unit: 'ans' }, // [STARFIRE]
    'traffic.tau': { decimals: 0, unit: '%/an' }, // [STARFIRE]
    'traffic.C': { decimals: 2, unit: '' }, // générique
    'traffic.tv': { decimals: 2, unit: '' }, // générique
    'traffic.dir': { decimals: 0, unit: '' }, // générique (sens de circulation)
    'load.p': { decimals: 3, unit: 'MPa' },
    'load.a': { decimals: 3, unit: 'm' },
    'load.d': { decimals: 3, unit: 'm' },
  },
};
