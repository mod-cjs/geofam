/**
 * Reproduction FIDÈLE des 3 exports du logiciel client PressioPro, portés sur un
 * calcul PERSISTÉ de l'historique (décision titulaire « proposer tous les exports »).
 *
 * L'outil client (pg-export) expose :
 *  - `exportCSV()`      → CSV de l'essai courant (mesures + KPI de dépouillement) ;
 *  - `exportAllCSV()`   → CSV global (synthèse par profondeur + blocs de mesures) ;
 *  - `exportJSON()`     → sauvegarde de projet ré-importable (ENTRÉES seules).
 *
 * On rejoue ces 3 formats à partir des SEULES données déjà persistées :
 *  - `params`  = l'entrée moteur (état `S` de l'outil : label, params sonde, gamma,
 *    nappe, rows, pf_idx/plm_idx, projet) ;
 *  - `result`  = le sous-ensemble de la sortie serveur whitelistée que le client
 *    AFFICHE ET exporte (EM, pL, pf, alpha, ratio E/p, catégorie) — jamais un
 *    recalcul moteur, jamais un intermédiaire non exporté par l'outil (DoD §8).
 *
 * PÉRIMÈTRE DE MAPPAGE (écarts assumés vs l'outil, tracés) :
 *  - `sondage` : l'outil lit un champ `p_sondage` NON persisté par calcul → on
 *    retombe sur son PROPRE fallback 'BH' (comportement client quand le champ est
 *    vide). Idem le nom de fichier.
 *  - CSV global « toutes profondeurs » : notre modèle persiste UNE profondeur par
 *    calcul → le CSV global porte cette seule profondeur (format identique, une
 *    ligne de synthèse + un bloc). L'agrégat multi-profondeurs d'un sondage
 *    complet n'existe pas côté plateforme (calculs indépendants).
 *  - JSON : les métadonnées de projet non persistées par calcul (chantier, équipe,
 *    opérateur, date, sonde, gaine…) ressortent VIDES (champ blanc), et le
 *    coefficient d'inertie `a` est reconstitué en saisie (cm³/MPa = a_interne×10).
 *    `logLayers`/`etalRows`/`calibRows` (autres onglets) ressortent vides.
 *
 * Aucun symbole/formule moteur ici : pur formatage de valeurs déjà persistées.
 */

/** Un palier de mesure persisté (entrée moteur, déjà en nombres). */
export interface PressioExportRow {
  p: number;
  v15: number;
  v30: number;
  v60: number;
}

/** Entrée moteur persistée d'un dépouillement (PressiometreInput, forme `S`). */
export interface PressioExportParams {
  projet?: string;
  label: string;
  params: { a: number; Ph: number; Pe: number; V0: number; k0: number };
  gamma: number;
  nappe: number;
  rows: PressioExportRow[];
  pf_idx?: number;
  plm_idx?: number;
}

/**
 * Sous-ensemble de la sortie serveur whitelistée que le client EXPORTE (le `_res`
 * de l'outil, réduit aux seules grandeurs sorties par exportCSV/exportAllCSV).
 */
export interface PressioExportResult {
  /** Module pressiométrique EM (MPa). */
  EM: number;
  /** Pression limite pL (bar) — affichée ×0,1 en MPa. */
  pL: number;
  /** Pression de fluage brute pf (bar) — affichée ×0,1 en MPa. */
  pf: number;
  /** Coefficient rhéologique alpha. */
  alpha: number;
  /** Rapport EM/pL* (colonne « EM_sur_PLM » du CSV global). */
  ratioEMpL: number;
  /** Catégorie de sol (A..E). */
  categorie: string;
}

/** Résultat d'un export : contenu + nom de fichier calqué sur l'outil. */
export interface PressioExportFile {
  content: string;
  filename: string;
}

/**
 * Extrait, depuis la sortie serveur BRUTE whitelistée (`rawOutput`), le seul
 * sous-ensemble que le client exporte — jamais l'objet entier (défense §8).
 * Renvoie `null` si la sortie est absente, en erreur (champ `erreur` non nul,
 * comme le `if(d._res)` du client) ou incomplète : l'appelant OMET alors la ligne
 * de résultats, exactement comme l'outil quand `d._res` est absent.
 */
export function pressioResultFrom(rawOutput: unknown): PressioExportResult | null {
  if (rawOutput == null || typeof rawOutput !== 'object') return null;
  const o = rawOutput as Record<string, unknown>;
  // Erreur de dépouillement encodée en bande (output.erreur) → pas de résultat.
  if (typeof o.erreur === 'string' && o.erreur.length > 0) return null;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const EM = num(o.EM);
  const pL = num(o.pL);
  const pf = num(o.pf);
  const alpha = num(o.alpha);
  const ratioEMpL = num(o.ratioEMpL);
  const categorie = typeof o.categorie === 'string' ? o.categorie : null;
  if (
    EM == null ||
    pL == null ||
    pf == null ||
    alpha == null ||
    ratioEMpL == null ||
    categorie == null
  ) {
    return null;
  }
  return { EM, pL, pf, alpha, ratioEMpL, categorie };
}

/** Sondage : non persisté par calcul → fallback 'BH' de l'outil (champ vide). */
function sondageOf(_params: PressioExportParams): string {
  return 'BH';
}

/** Δ60/30 brut, exactement comme le client : `(+r.v60||0) - (+r.v30||0)`. */
function delta6030(r: PressioExportRow): number {
  return (Number(r.v60) || 0) - (Number(r.v30) || 0);
}

/** Bloc de mesures d'une profondeur (en-tête `essai` ou `global`) + lignes. */
function mesuresBlock(rows: PressioExportRow[], header: string): string {
  let c = header;
  rows.forEach((r, i) => {
    c += `${i + 1};${r.p};${r.v15 ?? ''};${r.v30 ?? ''};${r.v60 ?? ''};${delta6030(r)}\n`;
  });
  return c;
}

/**
 * CSV de l'essai courant — reproduit exportCSV() : en-tête sondage/profondeur,
 * table des mesures brutes, puis (si résultat) la ligne EM/PLM/Pf/alpha.
 */
export function buildPressioEssaiCsv(
  params: PressioExportParams,
  result: PressioExportResult | null,
): PressioExportFile {
  const s = sondageOf(params);
  let c =
    `Sondage;${s}\nProfondeur;${params.label}\n\n` +
    mesuresBlock(params.rows, 'N;P_bar;V15_cm3;V30_cm3;V60_cm3;Delta60_30\n');
  if (result) {
    c +=
      `\nEM_MPa;${result.EM.toFixed(3)};` +
      `PLM_MPa;${(result.pL * 0.1).toFixed(4)};` +
      `Pf_MPa;${(result.pf * 0.1).toFixed(4)};` +
      `alpha;${result.alpha.toFixed(2)}\n`;
  }
  // `.replace(' ', '')` du client ne retire QUE le premier espace (pas de flag /g).
  return { content: c, filename: `pressio_${s}_${params.label.replace(' ', '')}.csv` };
}

/**
 * CSV global — reproduit exportAllCSV() : synthèse par profondeur puis blocs de
 * mesures. Notre modèle ne persiste qu'UNE profondeur par calcul (cf. en-tête).
 */
export function buildPressioGlobalCsv(
  params: PressioExportParams,
  result: PressioExportResult | null,
): PressioExportFile {
  const s = sondageOf(params);
  // `p_projet` n'a pas de fallback côté client (champ vide → chaîne vide).
  const projet = typeof params.projet === 'string' ? params.projet : '';
  let c =
    `Sondage;${s}\nProjet;${projet}\n\n` +
    'Profondeur;EM_MPa;PLM_MPa;Pf_MPa;EM_sur_PLM;alpha;Cat\n';
  if (result) {
    c +=
      `${params.label};${result.EM.toFixed(3)};` +
      `${(result.pL * 0.1).toFixed(4)};` +
      `${(result.pf * 0.1).toFixed(4)};` +
      `${result.ratioEMpL.toFixed(2)};` +
      `${result.alpha.toFixed(2)};${result.categorie}\n`;
  }
  c += mesuresBlock(
    params.rows,
    `\nProfondeur;${params.label}\nN;P_bar;V15;V30;V60;Dv\n`,
  );
  return { content: c, filename: `pressio_${s}_global.csv` };
}

/**
 * JSON de sauvegarde — reproduit gatherAll()/exportJSON() : enveloppe
 * `{ projet, depths, logLayers, etalRows, calibRows }`, ENTRÉES seules.
 *
 * L'objet `projet` reprend les 19 clés de l'outil DANS LE MÊME ORDRE (valeurs de
 * saisie = chaînes). Les champs non persistés par calcul ressortent vides ; `a`
 * est reconverti en saisie cm³/MPa (a_interne × 10, l'outil divise par 10 à la
 * lecture). Aucune sortie moteur (gatherAll ne lit jamais `_res`).
 */
export function buildPressioJsonExport(params: PressioExportParams): PressioExportFile {
  const str = (v: number): string => String(v);
  const projet = {
    projet: typeof params.projet === 'string' ? params.projet : '',
    chantier: '',
    sondage: '',
    equipe: '',
    operateur: '',
    date: '',
    sonde: '',
    gaine: '',
    passe: '',
    zc: '',
    nappe: str(params.nappe),
    pdiff: '',
    calib: '',
    // cm³/bar interne → saisie cm³/MPa. `toPrecision(12)` neutralise l'artefact
    // IEEE754 de la remultiplication (0,12·10 = 1,2000000000000002) pour
    // restituer la saisie octet-à-octet comme l'outil client.
    a: str(Number((params.params.a * 10).toPrecision(12))),
    ph: str(params.params.Ph),
    pe: str(params.params.Pe),
    v0: str(params.params.V0),
    k0: str(params.params.k0),
    gamma: str(params.gamma),
  };
  const depth: Record<string, unknown> = {
    label: params.label,
    pf_idx: params.pf_idx ?? 2,
    plm_idx: params.plm_idx ?? params.rows.length - 1,
    rows: params.rows,
  };
  const envelope = {
    projet,
    depths: [depth],
    logLayers: [] as unknown[],
    etalRows: [] as unknown[],
    calibRows: [] as unknown[],
  };
  return {
    content: JSON.stringify(envelope, null, 2),
    // exportJSON() nomme le fichier `pressio_${sondage||'BH'}.json`.
    filename: `pressio_${sondageOf(params)}.json`,
  };
}
