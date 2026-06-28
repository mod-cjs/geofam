/**
 * MAJEUR-1 (DoD §8) — FUITE par le canal `warnings` / `erreur` (texte libre).
 *
 * Le moteur interpole des VALEURS d'intermediaires CONFIDENTIELS dans le texte
 * de ses warnings (ex. « q_ce = 1,23 MPa faible... », « p_le* = 0,15 MPa... »).
 * `ple`/`qce` sont dans FUITES_INTERDITES : leur VALEUR ne doit pas fuir par le
 * texte plus que par une cle structuree. La whitelist ne couvrait QUE les cles.
 *
 * Ce test :
 *   1. PROUVE que la fuite existe dans le brut (le warning d'origine contient
 *      bien `<label> = <nombre> MPa`) — sinon le test serait vide (faux-vert) ;
 *   2. EXIGE qu'apres projection (runTerzaghi), aucun warning n'expose la VALEUR
 *      accolee a une etiquette confidentielle ;
 *   3. verifie que le redacteur lui-meme MORD (test direct).
 *
 * Couvre racine ET sous-chaines (grep sur le texte joint), pas seulement les cles.
 */
import { describe, expect, it } from 'vitest';

import type { TerzaghiInput } from './contract.js';
import { computeTerzaghi } from './engine.js';
import { TERZAGHI_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runTerzaghi,
} from './index.js';

/** Sondage pressio a TRES FAIBLE pl* (declenche le warning « p_le* faible »). */
const INPUT_PLE_FAIBLE: TerzaghiInput = {
  sondage: [
    { z: '1', pl: '0,15', em: '3', al: '0,5' },
    { z: '3', pl: '0,18', em: '4', al: '0,5' },
    { z: '6', pl: '0,2', em: '5', al: '0,5' },
  ],
  solCat: 'sables',
  gAvant: '19',
  gApres: '19',
  essai: 'pressio',
  profilMode: 'essais',
  forme: 'carree',
  B: '2',
  D: '1',
  charges: [{ etat: 'ELS_QP', fz: '300' }],
};

/** Sondage penetro a TRES FAIBLE qc (declenche le warning « q_ce faible »). */
const INPUT_QCE_FAIBLE: TerzaghiInput = {
  sondage: [
    { z: '1', qc: '0,8' },
    { z: '3', qc: '1' },
    { z: '6', qc: '1,1' },
  ],
  solCat: 'sables',
  gAvant: '19',
  gApres: '19',
  essai: 'penetro',
  alphaSang: '2',
  profilMode: 'essais',
  forme: 'carree',
  B: '2',
  D: '1',
  charges: [{ etat: 'ELS_QP', fz: '300' }],
};

/**
 * Repere une VALEUR confidentielle dans un texte : une etiquette confidentielle
 * (ple* / qce, formes HTML ou brutes) SUIVIE de `= <nombre>`. C'est exactement le
 * motif que le redacteur doit eliminer. (Le SEUIL normatif « < 1,5 MPa » n'a pas
 * d'etiquette confidentielle a sa gauche : il n'est pas vise.)
 */
const VALEUR_CONFIDENTIELLE =
  /(?:p<sub>le<\/sub>\*|ple\*?|q<sub>ce<\/sub>|qce)\s*=\s*-?[0-9]/;

describe('MAJEUR-1 — pas de fuite d intermediaire confidentiel par les warnings', () => {
  it('PRECONDITION : le warning BRUT du moteur contient bien la valeur (sinon test vide)', () => {
    const rawPle = computeTerzaghi(INPUT_PLE_FAIBLE) as { warn?: unknown[] };
    const rawQce = computeTerzaghi(INPUT_QCE_FAIBLE) as { warn?: unknown[] };
    const joinPle = (rawPle.warn ?? []).filter((w) => typeof w === 'string').join(' || ');
    const joinQce = (rawQce.warn ?? []).filter((w) => typeof w === 'string').join(' || ');
    // La fuite EXISTE dans le brut : c'est ce que la redaction doit fermer.
    expect(joinPle).toMatch(VALEUR_CONFIDENTIELLE);
    expect(joinQce).toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('[ple* faible] la sortie projetee n expose AUCUNE valeur confidentielle dans les warnings', () => {
    const env = runTerzaghi(INPUT_PLE_FAIBLE);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    // Le warning est conserve (sens preserve) mais SANS la valeur.
    expect(joined.length).toBeGreaterThan(0);
    expect(joined).not.toMatch(VALEUR_CONFIDENTIELLE);
    // Le seuil normatif et la citation restent (le warning n'est pas supprime).
    expect(joined).toMatch(/NF P94-261/);
  });

  it('[qce faible] la sortie projetee n expose AUCUNE valeur confidentielle dans les warnings', () => {
    const env = runTerzaghi(INPUT_QCE_FAIBLE);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    expect(joined.length).toBeGreaterThan(0);
    expect(joined).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(joined).toMatch(/NF P94-261/);
  });

  it('aucune valeur confidentielle dans les warnings sur TOUT le jeu de fixtures', () => {
    for (const fx of TERZAGHI_FIXTURES) {
      const env = runTerzaghi(fx.input);
      if (!env.ok) continue;
      const joined = env.output.warnings.join(' || ');
      expect(joined, `fuite warning sur fixture ${fx.id}`).not.toMatch(
        VALEUR_CONFIDENTIELLE,
      );
    }
  });

  it('le redacteur MORD : il retire la valeur mais garde l etiquette et le seuil', () => {
    const fuite =
      'q<sub>ce</sub> = 1,23 MPa faible (< 1,5 MPa) : pérennité ... (NF P94-261, E.2.3(2)).';
    const propre = redactConfidentialWarning(fuite);
    expect(propre).not.toMatch(VALEUR_CONFIDENTIELLE);
    // L'etiquette demeure (sens du warning conserve).
    expect(propre).toMatch(/q<sub>ce<\/sub>/);
    // Le seuil normatif « < 1,5 MPa » reste (constante, pas un intermediaire).
    expect(propre).toMatch(/< 1,5 MPa/);
    expect(propre).toMatch(/NF P94-261/);
  });

  it('le redacteur traite la forme BRUTE (ple/qce sans balise HTML)', () => {
    expect(redactConfidentialWarning('ple* = 0,15 MPa faible')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('qce = 1,1 MPa')).not.toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur NE touche PAS aux nombres NON confidentiels (profondeurs, geometrie)', () => {
    // Un warning de profondeur de sondage (m) ne porte pas d'intermediaire de
    // calcul : il doit etre PRESERVE tel quel.
    const profondeur =
      'Sondage limité à 13,5 m : modules E9 à E16 supposés ... (H.2.1.2.6).';
    expect(redactConfidentialWarnings([profondeur])[0]).toBe(profondeur);
  });
});
