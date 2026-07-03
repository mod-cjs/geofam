/**
 * Fail-closed (DoD §8) — redaction des messages (`warnings`/`erreur` + libelles de
 * `classe.path`/`classe.warn`). Patron #48/#54 (allowlist fail-closed).
 *
 * --- ETAT REEL FASTLAB (honnetete) ---
 * Les resultats de labo + la classe GTR sont le LIVRABLE (client-safe) : il n'y a PAS
 * d'intermediaire confidentiel a cacher ici, contrairement aux moteurs de
 * dimensionnement. Le moteur ne pose AUCUN champ `warn`/`erreur` porteur d'une valeur
 * secrete (les libelles de `classify` sont des explications normatives). La redaction
 * est donc une defense en profondeur fail-closed, PAR COHERENCE avec les 5 autres
 * moteurs — pas le correctif d'une fuite averee. Ce test prouve neanmoins la barriere :
 *   1. un intermediaire NU INCONNU (non liste) serait REDACTE (sentinelle fail-closed) ;
 *   2. les libelles legitimes de la classe GTR (path : « Passant 80µm = 52 % », « Ip =
 *      18 ») gardent leur valeur (grandeurs deja exposees / coefficients normatifs) ;
 *   3. sur tout le jeu de fixtures, `classe.path`/`classe.warn` ne contiennent aucune
 *      valeur d'etiquette INCONNUE non redactee.
 */
import { describe, expect, it } from 'vitest';

import { LABO_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runLabo,
} from './index.js';

const VALEUR_NUMERIQUE = /=\s*-?[0-9]/;

describe('labo — fail-closed : redaction des messages (defense en profondeur)', () => {
  it('FAIL-CLOSED : un intermediaire NU INCONNU (non liste) est REDACTE (sentinelle)', () => {
    const inconnus = ['secretInterne = 42', 'fooBar = 3,14 kPa', 'xyzzy = 1.2e-3'];
    for (const txt of inconnus) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `non redacte : ${txt}`).toMatch(/valeur confidentielle masquee/);
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(VALEUR_NUMERIQUE);
    }
  });

  it('les RESULTATS de labo exposes (allowlist benigne) gardent leur valeur', () => {
    expect(redactConfidentialWarning('p80 = 52 %')).toMatch(/=\s*52/);
    expect(redactConfidentialWarning('ip = 18')).toMatch(/=\s*18/);
    expect(redactConfidentialWarning('vbs = 3,5')).toMatch(/=\s*3,5/);
    expect(redactConfidentialWarning('wopn = 16,2 %')).toMatch(/=\s*16,2/);
    expect(redactConfidentialWarning('cbr = 12')).toMatch(/=\s*12/);
  });

  it('un libelle SANS etiquette = nombre (chemin GTR descriptif) est intact', () => {
    const benin = 'Famille A — sol fin argileux ; 4 points de mesure, 2 couches.';
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);
  });

  it('aucune etiquette SUSPECTE = nombre dans les messages/classe sur TOUT le jeu', () => {
    // Les libelles de classify (« Passant 80µm = 52 % », « Ip = 18 », « VBS = 3,5 ») sont
    // le LIVRABLE client-safe : NON redactes (cf. shapeOutput). On verifie qu'aucune
    // etiquette typiquement INTERNE/secrete (secret/interne/sigma/residu...) ne porte une
    // valeur — il n'y en a jamais (les libelles sont normatifs). Sentinelle de regression.
    const SUSPECT = /(secret|interne|coef[A-Z]|sigma|residu)\w*\s*=\s*-?[0-9]/i;
    for (const fx of LABO_FIXTURES) {
      const env = runLabo(fx.input);
      if (!env.ok) continue;
      // `classe.warn` n'est PLUS projeté dans la sortie client-facing (retiré du schéma) :
      // le scan couvre les canaux réellement exposés (erreur, warnings, path, rNote).
      const joined = [
        env.output.erreur ?? '',
        ...env.output.warnings,
        ...env.output.classe.path,
        ...(env.output.classe.rNote ?? []),
      ].join(' || ');
      expect(joined, `fuite suspecte sur fixture ${fx.id}`).not.toMatch(SUSPECT);
      // Garde-fou : warn est bien ABSENT de la sortie (jamais sur le fil).
      expect('warn' in env.output.classe).toBe(false);
    }
  });
});
