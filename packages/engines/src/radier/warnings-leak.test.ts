/**
 * MAJEUR-1 / fail-closed (DoD §8) — FUITE par le canal TEXTE LIBRE (`warnings` /
 * `erreur`). Patron durci de #48 : ALLOWLIST fail-closed (jamais une blacklist).
 *
 * --- ETAT REEL DU MOTEUR RADIER (honnetete) ---
 * Le moteur radier NE POSE AUCUN champ `warn` dans son resultat `R` : ses messages
 * sont des `console.warn` d'auto-verification ACM et des `toast` d'erreur cote UI —
 * aucun n'atteint le resultat structure. `warnings` ressort donc STRUCTURELLEMENT
 * VIDE en fonctionnement normal ; seul `erreur` (message de garde) peut etre non vide
 * et il ne contient pas d'intermediaire. La redaction est une defense en profondeur
 * fail-closed, pas le correctif d'une fuite averee.
 *
 * Ce test installe et PROUVE la barriere fail-closed :
 *   1. un intermediaire NU INCONNU (jamais liste) est REDACTE (defaut sur) ;
 *   2. les grandeurs DEJA EXPOSEES au PV (allowlist benigne) gardent leur valeur ;
 *   3. PIPELINE REEL : un warning confidentiel renvoye par le moteur est NETTOYE par
 *      runRadier (mock de computeRadier) ;
 *   4. aucune valeur confidentielle dans le canal texte sur tout le jeu de fixtures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { RADIER_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runRadier,
} from './index.js';

/** Une valeur survivante = une etiquette suivie de `= <nombre>`. */
const VALEUR_NUMERIQUE = /=\s*-?[0-9]/;

describe('radier — fail-closed : pas de fuite d intermediaire par les messages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('FAIL-CLOSED : un intermediaire NU INCONNU (non liste) est REDACTE (sentinelle)', () => {
    // Etiquettes EF confidentielles / inconnues : la seule raison qui les masque est
    // le DEFAUT fail-closed. ROUGE si on revenait a une blacklist (fail-open).
    const inconnus = [
      'w[42] = 0,031 m', // champ nodal
      'kr = 18500 kN/m³', // coefficient de reaction local
      'residuACM = 1,2e-9', // residu d'auto-verification ACM
      'CsubInv = 0,0042', // intermediaire d'inversion
      'sext = 0,008 m', // tassement champ libre interne
    ];
    for (const txt of inconnus) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `non redacte : ${txt}`).toMatch(/valeur confidentielle masquee/);
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(VALEUR_NUMERIQUE);
    }
  });

  it('FAIL-CLOSED : les DIAGNOSTICS exposes (allowlist benigne) gardent leur valeur', () => {
    expect(redactConfidentialWarning('wMax = 0,031 m')).toMatch(/=\s*0,031/);
    expect(redactConfidentialWarning('diff = 0,012 m')).toMatch(/=\s*0,012/);
    expect(redactConfidentialWarning('betaGov = 0,0021')).toMatch(/=\s*0,0021/);
    expect(redactConfidentialWarning('tiltMax = 0,0009')).toMatch(/=\s*0,0009/);
    // Geometrie / identite legitime.
    expect(redactConfidentialWarning('mesh = 0,8 m')).toMatch(/=\s*0,8/);
    expect(redactConfidentialWarning('nRafts = 2')).toMatch(/=\s*2/);
  });

  it('NE touche PAS aux nombres NON precedes d une etiquette `=` (profondeurs, comptes)', () => {
    const benin = 'Maillage : 441 nœuds sur la plaque de 6 m, 2 couches.';
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);
  });

  it('PIPELINE REEL : un warning confidentiel renvoye par le moteur est NETTOYE par runRadier', async () => {
    const FUITE_BRUTE =
      'Auto-verification ACM : residu = 3,2e-7 ; w[12] = 0,041 m au nœud.';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeRadier: () => ({
          // R minimal mais COMPLET pour le chemin non-erreur de shapeOutput, PORTEUR
          // d'un warning confidentiel (le canal a assainir).
          warn: [FUITE_BRUTE],
          diag: {
            wMax: 0.031,
            wMaxAt: { x: 3, y: 3 },
            wMin: 0.001,
            wMinAt: { x: 0, y: 0 },
            diff: 0.03,
            slopeMax: 0.002,
            slopeMaxAt: { x: 1, y: 1 },
            tiltMax: 0.001,
            tiltAt: { x: 3, y: 3 },
            betaIntra: 0.0015,
            interBeta: 0,
            interDiff: 0,
            betaGov: 0.0015,
            betaGovAt: { x: 1, y: 1 },
            nRafts: 1,
            loadPairs: null,
          },
        }),
      };
    });

    const { runRadier: runMocked } = await import('./index.js');

    // Anti faux-vert : le BRUT injecte fuit BIEN.
    expect(FUITE_BRUTE).toMatch(VALEUR_NUMERIQUE);

    const fx0 = RADIER_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    expect(joined.length).toBeGreaterThan(0); // pas supprime
    expect(joined).not.toMatch(VALEUR_NUMERIQUE); // mais nettoye (residu/w[12] masques)
    expect(joined).toMatch(/valeur confidentielle masquee/);
  });

  it('aucune valeur confidentielle dans le canal texte sur TOUT le jeu de fixtures REELLES', () => {
    for (const fx of RADIER_FIXTURES) {
      const env = runRadier(fx.input);
      if (!env.ok) continue;
      // warnings est structurellement vide ; erreur (garde) ne porte pas d'intermediaire.
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      // Un message de garde ne doit pas contenir d'etiquette EF suivie d'un nombre.
      // (les messages de garde du moteur n'interpolent aucune valeur calculee).
      const suspect = /(w\[|kr|residu|CsubInv|sext|nodeX|nodeY)\s*=\s*-?[0-9]/i;
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(suspect);
    }
  });
});
