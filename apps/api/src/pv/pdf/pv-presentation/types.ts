/**
 * MODÈLE DE PRÉSENTATION du PV (#71) — interface OPTIONNELLE par moteur.
 *
 * Le renderer détecte : modèle présent -> présentation MÉTIER riche (bandeau
 * verdict, structure en couches, vérifications dimensionnantes, unités) ; absent
 * -> FALLBACK table clé-valeur propre. Les 6 moteurs marchent en Phase 1 ; seule
 * la chaussée a son modèle riche pour l'instant.
 *
 * CONFIDENTIALITÉ (DoD §8) : le modèle ne fait que (a) TRADUIRE des libellés et
 * (b) un calcul TRIVIAL (taux de travail = valeur/admissible). Il N'AJOUTE AUCUN
 * champ moteur ; il ne présente QUE des champs déjà dans la sortie scellée
 * whitelistée.
 *
 * FAIL-CLOSED (B-1, DoD §8) : la voie riche est une VRAIE WHITELIST. Seuls les
 * champs EXPLICITEMENT mappés (structure/groups/criteria/verdict) sont rendus ;
 * AUCUN champ non mappé n'est affiché automatiquement. `hiddenKeys` documente en
 * plus les champs sciemment masqués (bruit, flags de branche de méthode,
 * coefficients de calage). La garantie « ne jamais OMETTRE silencieusement » est
 * tenue par un TEST DE COMPLÉTUDE (toute clé scellée = mappée OU masquée, sinon
 * test ROUGE), pas par un rendu fourre-tout sur le document.
 *
 * EXTERNALISÉ : la config (libellés/unités/groupes/format) vit dans un fichier
 * dédié par moteur (ex. pv-presentation/chaussee.ts) pour que STARFIRE confirme /
 * ajuste les libellés science SANS toucher au renderer.
 */

/** Chemin pointé vers une valeur de la donnée scellée (ex. "fatigue.valeur"). */
export type FieldPath = string;

/**
 * Format d'affichage PAR GRANDEUR. `decimals` = nombre de décimales (après
 * nettoyage du bruit binaire) ; `unit` = unité affichée (ex. "MPa", "cm", "µdef").
 * `scale` = facteur d'échelle d'AFFICHAGE (ex. 100 pour m->cm) — la valeur SCELLÉE
 * reste inchangée, on ne formate qu'à l'affichage. `thousands` = séparateur de
 * milliers (espace fine) pour les grands adimensionnels (NE).
 */
export interface NumberFormat {
  decimals?: number;
  unit?: string;
  scale?: number;
  thousands?: boolean;
  /** Notation scientifique « 1,47×10⁶ » (pour NE par ex.). Prioritaire sur thousands. */
  scientific?: boolean;
}

/** Un champ affiché dans un groupe : chemin + libellé + format optionnel. */
export interface PresentedField {
  path: FieldPath;
  label: string;
  /** Si absent, on cherche dans `numberFormat[path]` puis on tombe en intérim. */
  format?: NumberFormat;
  /** Valeur littérale de repli si le champ est absent (ex. note « auto »). */
  fallbackText?: string;
}

/** Un groupe d'entrées/résultats (sous-titre + champs). */
export interface PresentedGroup {
  title: string;
  fields: PresentedField[];
}

/**
 * Définition de la TABLE STRUCTURE (couches haut->bas + sol support). Chaque
 * colonne pointe un sous-chemin de l'élément de couche ; le sol support (subgrade)
 * forme la dernière ligne « semi-infini ».
 */
export interface StructureTableSpec {
  title: string;
  /** Chemin du tableau de couches dans l'entrée (ex. "layers"). */
  layersPath: FieldPath;
  /** Chemin du sol support (ex. "subgrade"). */
  subgradePath: FieldPath;
  /** Colonnes : en-tête + sous-chemin relatif à la couche + format. */
  columns: Array<{
    header: string;
    /** Sous-clé dans l'élément de couche / subgrade (ex. "mat", "E", "nu", "h"). */
    key: string;
    format?: NumberFormat;
    align?: 'left' | 'right';
  }>;
  /** Libellé de la cellule « épaisseur » du sol support (semi-infini). */
  subgradeThicknessLabel: string;
}

/** Critère dimensionnant mis en avant dans le bandeau verdict. */
export interface CriterionSpec {
  label: string;
  /** Chemins valeur sollicitante / admissible (ex. "fatigue.valeur"). */
  valuePath: FieldPath;
  admissiblePath: FieldPath;
  format?: NumberFormat;
  /**
   * Critère SECONDAIRE, présent SEULEMENT pour certaines familles (phase 2 mixte,
   * inverse). Si `true` et que la valeur sollicitante résout vers null/absent, le
   * critère est OMIS (banner + table vérifications) — pas de ligne « — » trompeuse.
   */
  optional?: boolean;
  /**
   * Chemin d'un booléen de VERDICT (§8, public) indiquant si le critère est PLIÉ
   * dans `conforme` pour cette structure (ex. "fatigue.requis"). Quand il résout
   * vers `false`, le critère est rendu INFORMATIF : PAS de picto ✓/✗, exclu du
   * bandeau, jamais dominant — il ne peut donc JAMAIS contredire le verdict scellé.
   * Absent / undefined -> critère traité comme requis (rendu verdict normal).
   */
  requisPath?: FieldPath;
  /**
   * VARIANTE RIGIDE (MTLH/béton) : chemin d'un booléen (ex. "fatigue.rigide") qui,
   * lorsqu'il résout vers `true`, bascule le critère sur `rigideLabel`/`rigideFormat`
   * (σ_t en MPa) au lieu du libellé/format bitumineux (ε_t en µdef). Aligné sur le
   * web (adapters.ts). Le flag lui-même n'est PAS rendu (§8) — seul le libellé change.
   */
  rigideFlagPath?: FieldPath;
  /** Libellé alternatif quand `rigideFlagPath` résout `true` (ne contient pas le flag). */
  rigideLabel?: string;
  /** Format alternatif quand `rigideFlagPath` résout `true` (ex. MPa / 3 décimales). */
  rigideFormat?: NumberFormat;
}

/**
 * TABLE de vérification PAR COUCHE (σ_t par couche traitée, ε_z par couche
 * granulaire). Rendue SEULEMENT si le tableau est non vide (sinon omise). Chaque
 * ligne = un élément du tableau scellé ; on ne lit que des sous-clés NOMMÉES
 * (fail-closed, DoD §8) — jamais de copie d'objet brut.
 */
export interface LayerTableSpec {
  title: string;
  /** Chemin du tableau dans la sortie (ex. "couchesTraitees"). */
  arrayPath: FieldPath;
  /** Sous-clé du n° de couche (1-based). */
  coucheKey: string;
  /** Sous-clé du mode d'interface (colonne optionnelle, ex. "mode"). */
  modeKey?: string;
  /** Sous-clé de la valeur sollicitante. */
  valueKey: string;
  /** Sous-clé de l'admissible (colonne optionnelle). */
  admissibleKey?: string;
  /** Sous-clé du booléen de verdict (picto ✓/✗). */
  okKey: string;
  /**
   * Sous-clé d'un booléen de VERDICT public (§8) indiquant si l'élément est PLIÉ
   * dans `conforme` (ex. "requis"). Quand il résout `false` sur un élément, sa
   * ligne est rendue INFORMATIVE (pas de picto ✓/✗) : un ε_z granulaire exempté
   * (§4.1.2) ne peut PAS contredire le bandeau. Absent -> élément traité requis.
   */
  requisKey?: string;
  /** Format d'affichage de valeur/admissible (unité). */
  format?: NumberFormat;
}

/**
 * MODÈLE DE PRÉSENTATION complet d'un moteur.
 */
export interface PresentationModel {
  /** Libellé moteur lisible (ex. « Dimensionnement de chaussée (AGEROUTE 2015) »). */
  engineLabel: string;
  /** Phrase d'objet rédigée (gabarit ; {projet} remplacé par le libellé projet). */
  objectSentence: string;
  /** Verdict global : booléen scellé -> libellés (consommé par le bandeau). */
  verdict: {
    key: FieldPath; // ex. "conforme"
    labelTrue: string; // « CONFORME »
    labelFalse: string; // « NON CONFORME »
  };
  /** Critères dimensionnants (fatigue/orniérage) du bandeau + table vérifications. */
  criteria: CriterionSpec[];
  /**
   * Tables de vérification PAR COUCHE (σ_t par couche traitée, ε_z par couche
   * granulaire) — rendues après la table vérifications, omises si le tableau est
   * vide. Optionnelles.
   */
  layerTables?: LayerTableSpec[];
  /** Table structure (couches + sol support). Optionnelle. */
  structure?: StructureTableSpec;
  /** Groupes d'entrées NON-structure (trafic, charge…). */
  inputGroups: PresentedGroup[];
  /** Groupes de résultats hors verdict/critères (famille, épaisseurs, NE…). */
  resultGroups: PresentedGroup[];
  /** Chemins MASQUÉS (bruit + confidentialité fail-closed). */
  hiddenKeys: FieldPath[];
  /** Formats par chemin (fallback si un champ n'a pas de format inline). */
  numberFormat: Record<FieldPath, NumberFormat>;
}
