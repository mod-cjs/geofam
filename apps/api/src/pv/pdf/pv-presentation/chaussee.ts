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
    },
    {
      label: 'Déformation du sol support (εz)', // [STARFIRE] εz = orniérage / déformation permanente
      valuePath: 'ornierage.valeur',
      admissiblePath: 'ornierage.admissible',
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
