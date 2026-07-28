// @vitest-environment node
/**
 * Tests — pressio-export : reproduction FIDÈLE des 3 exports du logiciel client
 * PressioPro (pg-export : exportCSV / exportAllCSV / exportJSON).
 *
 * DoD §9 (golden-master + given/when/then) + §8 (confidentialité) :
 *  - GOLDEN de FORMAT : chaque export est comparé OCTET-À-OCTET à un attendu
 *    hand-codé depuis les fonctions du HTML client (l.1737-1753) — séparateurs `;`,
 *    en-têtes exacts, précisions toFixed, sauts de ligne, nom de fichier ;
 *  - §8 : l'export ne se construit QUE depuis `params` (entrées) + le sous-ensemble
 *    whitelisté de la sortie ; aucun intermédiaire moteur non exporté par l'outil
 *    ne fuit, même si la sortie brute en contient (pressioResultFrom ne retient
 *    que 6 champs) ;
 *  - chemins négatifs : sortie en erreur / incomplète → pas de ligne de résultat
 *    (parité du `if(d._res)` client).
 *
 * Référence client (pressiometre__1_.html) :
 *   exportCSV()    l.1738-1744   exportAllCSV() l.1745-1753   exportJSON()/gatherAll() l.1732-1737
 */

import { describe, it, expect } from 'vitest';

import {
  buildPressioEssaiCsv,
  buildPressioGlobalCsv,
  buildPressioJsonExport,
  pressioResultFrom,
  type PressioExportParams,
  type PressioExportResult,
} from '../pressio-export';

// --- Fixture : un dépouillement persisté (entrée moteur, forme `S`). ---
const PARAMS: PressioExportParams = {
  projet: 'Chantier Nord',
  label: '2.0 m',
  params: { a: 0.5, Ph: 0.177, Pe: 1.25, V0: 535, k0: 0.5 },
  gamma: 19,
  nappe: 3,
  rows: [
    { p: 0.5, v15: 20, v30: 25, v60: 30 },
    { p: 1.0, v15: 40, v30: 46, v60: 52 },
    { p: 1.5, v15: 60, v30: 68, v60: 76 },
    { p: 2.0, v15: 90, v30: 105, v60: 120 },
  ],
  pf_idx: 2,
  plm_idx: 3,
};

// Sous-ensemble whitelisté de la sortie serveur (le `_res` que l'outil exporte).
const RESULT: PressioExportResult = {
  EM: 12.3456,
  pL: 25.4,
  pf: 18.2,
  alpha: 0.5,
  ratioEMpL: 6.7,
  categorie: 'C',
};

describe('buildPressioEssaiCsv — GOLDEN exportCSV() (essai courant)', () => {
  it('GIVEN un essai + résultat WHEN buildPressioEssaiCsv THEN le CSV est identique octet-à-octet à exportCSV() du client', () => {
    const expected =
      'Sondage;BH\n' +
      'Profondeur;2.0 m\n' +
      '\n' +
      'N;P_bar;V15_cm3;V30_cm3;V60_cm3;Delta60_30\n' +
      '1;0.5;20;25;30;5\n' +
      '2;1;40;46;52;6\n' +
      '3;1.5;60;68;76;8\n' +
      '4;2;90;105;120;15\n' +
      '\n' +
      'EM_MPa;12.346;PLM_MPa;2.5400;Pf_MPa;1.8200;alpha;0.50\n';
    const file = buildPressioEssaiCsv(PARAMS, RESULT);
    expect(file.content).toBe(expected);
    // Nom de fichier : `pressio_${sondage||'BH'}_${label.replace(' ','')}.csv`
    // (le .replace(' ','') du client ne retire QUE le premier espace).
    expect(file.filename).toBe('pressio_BH_2.0m.csv');
  });

  it('GIVEN aucun résultat (dépouillement non calculé) WHEN buildPressioEssaiCsv THEN la ligne EM/PLM/Pf/alpha est OMISE (parité if(d._res))', () => {
    const file = buildPressioEssaiCsv(PARAMS, null);
    expect(file.content).toBe(
      'Sondage;BH\n' +
        'Profondeur;2.0 m\n' +
        '\n' +
        'N;P_bar;V15_cm3;V30_cm3;V60_cm3;Delta60_30\n' +
        '1;0.5;20;25;30;5\n' +
        '2;1;40;46;52;6\n' +
        '3;1.5;60;68;76;8\n' +
        '4;2;90;105;120;15\n',
    );
    expect(file.content).not.toContain('EM_MPa');
  });
});

describe('buildPressioGlobalCsv — GOLDEN exportAllCSV() (toutes profondeurs)', () => {
  it('GIVEN un essai + résultat WHEN buildPressioGlobalCsv THEN le CSV est identique octet-à-octet à exportAllCSV() du client', () => {
    const expected =
      'Sondage;BH\n' +
      'Projet;Chantier Nord\n' +
      '\n' +
      'Profondeur;EM_MPa;PLM_MPa;Pf_MPa;EM_sur_PLM;alpha;Cat\n' +
      '2.0 m;12.346;2.5400;1.8200;6.70;0.50;C\n' +
      '\n' +
      'Profondeur;2.0 m\n' +
      'N;P_bar;V15;V30;V60;Dv\n' +
      '1;0.5;20;25;30;5\n' +
      '2;1;40;46;52;6\n' +
      '3;1.5;60;68;76;8\n' +
      '4;2;90;105;120;15\n';
    const file = buildPressioGlobalCsv(PARAMS, RESULT);
    expect(file.content).toBe(expected);
    expect(file.filename).toBe('pressio_BH_global.csv');
  });

  it('GIVEN aucun résultat WHEN buildPressioGlobalCsv THEN la ligne de synthèse est OMISE mais le bloc de mesures demeure', () => {
    const file = buildPressioGlobalCsv(PARAMS, null);
    expect(file.content).toBe(
      'Sondage;BH\n' +
        'Projet;Chantier Nord\n' +
        '\n' +
        'Profondeur;EM_MPa;PLM_MPa;Pf_MPa;EM_sur_PLM;alpha;Cat\n' +
        '\n' +
        'Profondeur;2.0 m\n' +
        'N;P_bar;V15;V30;V60;Dv\n' +
        '1;0.5;20;25;30;5\n' +
        '2;1;40;46;52;6\n' +
        '3;1.5;60;68;76;8\n' +
        '4;2;90;105;120;15\n',
    );
  });
});

describe('buildPressioJsonExport — GOLDEN exportJSON()/gatherAll()', () => {
  it('GIVEN un essai persisté WHEN buildPressioJsonExport THEN le JSON est identique octet-à-octet à exportJSON() du client', () => {
    const expected =
      '{\n' +
      '  "projet": {\n' +
      '    "projet": "Chantier Nord",\n' +
      '    "chantier": "",\n' +
      '    "sondage": "",\n' +
      '    "equipe": "",\n' +
      '    "operateur": "",\n' +
      '    "date": "",\n' +
      '    "sonde": "",\n' +
      '    "gaine": "",\n' +
      '    "passe": "",\n' +
      '    "zc": "",\n' +
      '    "nappe": "3",\n' +
      '    "pdiff": "",\n' +
      '    "calib": "",\n' +
      '    "a": "5",\n' +
      '    "ph": "0.177",\n' +
      '    "pe": "1.25",\n' +
      '    "v0": "535",\n' +
      '    "k0": "0.5",\n' +
      '    "gamma": "19"\n' +
      '  },\n' +
      '  "depths": [\n' +
      '    {\n' +
      '      "label": "2.0 m",\n' +
      '      "pf_idx": 2,\n' +
      '      "plm_idx": 3,\n' +
      '      "rows": [\n' +
      '        {\n' +
      '          "p": 0.5,\n' +
      '          "v15": 20,\n' +
      '          "v30": 25,\n' +
      '          "v60": 30\n' +
      '        },\n' +
      '        {\n' +
      '          "p": 1,\n' +
      '          "v15": 40,\n' +
      '          "v30": 46,\n' +
      '          "v60": 52\n' +
      '        },\n' +
      '        {\n' +
      '          "p": 1.5,\n' +
      '          "v15": 60,\n' +
      '          "v30": 68,\n' +
      '          "v60": 76\n' +
      '        },\n' +
      '        {\n' +
      '          "p": 2,\n' +
      '          "v15": 90,\n' +
      '          "v30": 105,\n' +
      '          "v60": 120\n' +
      '        }\n' +
      '      ]\n' +
      '    }\n' +
      '  ],\n' +
      '  "logLayers": [],\n' +
      '  "etalRows": [],\n' +
      '  "calibRows": []\n' +
      '}';
    const file = buildPressioJsonExport(PARAMS);
    expect(file.content).toBe(expected);
    // exportJSON() nomme le fichier `pressio_${sondage||'BH'}.json`.
    expect(file.filename).toBe('pressio_BH.json');
  });

  it("GIVEN `a` interne à décimales (0,12) WHEN buildPressioJsonExport THEN la saisie restituée est \"1.2\" (aucun artefact IEEE754)", () => {
    // a_interne × 10 = 0.12 × 10 = 1.2000000000000002 en flottant natif ;
    // l'outil client réécrit la saisie exacte de l'opérateur (« 1.2 »).
    // Sans normalisation, le JSON divergerait octet-à-octet du client.
    const parsed = JSON.parse(
      buildPressioJsonExport({ ...PARAMS, params: { ...PARAMS.params, a: 0.12 } })
        .content,
    ) as { projet: Record<string, unknown> };
    expect(parsed.projet.a).toBe('1.2');
  });

  it("GIVEN le JSON WHEN on lit l'ordre des clés `projet` THEN c'est EXACTEMENT l'ordre des 19 champs de gatherAll()", () => {
    const parsed = JSON.parse(buildPressioJsonExport(PARAMS).content) as {
      projet: Record<string, unknown>;
    };
    expect(Object.keys(parsed.projet)).toEqual([
      'projet',
      'chantier',
      'sondage',
      'equipe',
      'operateur',
      'date',
      'sonde',
      'gaine',
      'passe',
      'zc',
      'nappe',
      'pdiff',
      'calib',
      'a',
      'ph',
      'pe',
      'v0',
      'k0',
      'gamma',
    ]);
  });
});

describe('pressioResultFrom — §8 : whitelist stricte de la sortie exportée', () => {
  it('GIVEN une sortie serveur RICHE (avec intermédiaires confidentiels) WHEN pressioResultFrom THEN SEULS les 6 champs exportés sont retenus', () => {
    const raw = {
      erreur: null,
      EM: 12.3456,
      pL: 25.4,
      pf: 18.2,
      alpha: 0.5,
      ratioEMpL: 6.7,
      categorie: 'C',
      // Intermédiaires NON exportés par l'outil (confidentiels ou hors format export) :
      sigmaV0p: 999.123,
      iE: 42,
      slopes: [0.1, 0.2, 0.3],
      pE: 3.14,
      volumes: { vE: 1, v0: 2, vf: 3, vLim: 4 },
    };
    const res = pressioResultFrom(raw);
    expect(res).toEqual({
      EM: 12.3456,
      pL: 25.4,
      pf: 18.2,
      alpha: 0.5,
      ratioEMpL: 6.7,
      categorie: 'C',
    });
  });

  it('GIVEN une sortie riche WHEN on construit le CSV global THEN AUCUN intermédiaire non exporté ne fuit dans le fichier (§8)', () => {
    const raw = {
      erreur: null,
      EM: 12.3456,
      pL: 25.4,
      pf: 18.2,
      alpha: 0.5,
      ratioEMpL: 6.7,
      categorie: 'C',
      sigmaV0p: 999.123,
      iE: 42,
      pE: 3.14159,
    };
    const res = pressioResultFrom(raw);
    const csv = buildPressioGlobalCsv(PARAMS, res).content;
    expect(csv).not.toContain('999.123');
    expect(csv).not.toContain('3.14159');
    expect(csv).not.toContain('sigma');
    expect(csv).not.toContain('iE');
  });

  it('GIVEN une sortie en erreur (champ erreur non vide) WHEN pressioResultFrom THEN null (parité if(d._res))', () => {
    expect(
      pressioResultFrom({ erreur: 'Paliers insuffisants', EM: 1, pL: 2 }),
    ).toBeNull();
  });

  it('GIVEN une sortie incomplète (EM manquant) WHEN pressioResultFrom THEN null', () => {
    expect(
      pressioResultFrom({
        erreur: null,
        pL: 25.4,
        pf: 18.2,
        alpha: 0.5,
        ratioEMpL: 6.7,
        categorie: 'C',
      }),
    ).toBeNull();
  });

  it('GIVEN une sortie absente/non-objet WHEN pressioResultFrom THEN null', () => {
    expect(pressioResultFrom(null)).toBeNull();
    expect(pressioResultFrom(undefined)).toBeNull();
    expect(pressioResultFrom('EM=12')).toBeNull();
  });
});
