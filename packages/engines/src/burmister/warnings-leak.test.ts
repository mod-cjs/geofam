/**
 * FUITE #2 (issue #82, DoD §8) — le canal `warnings` etait une BLACKLIST fail-OPEN.
 *
 * Leçon de #45 : la whitelist protege les CLES, pas le TEXTE LIBRE. L'ancienne
 * redaction masquait la VALEUR (`kc=1.3` → masque) mais LAISSAIT passer l'etiquette
 * `kc` ET le texte `(§ confidentiel)` (reference d'un doc PRIVE STARFIRE). On passe
 * donc a une ALLOWLIST fail-CLOSED : `curateWarnings` n'expose au client QUE des
 * warnings EXACTEMENT reconnus (ensemble ferme de messages cures) ; tout texte
 * moteur libre non reconnu est ECARTE.
 *
 * ETAT REEL DU MOTEUR (honnetete) : `computeBurmister` ne pose AUCUN warning en
 * fonctionnement normal (`_D` n'a pas de champ `warn`) → l'ensemble cure est VIDE →
 * tout warning est ECARTE. La redaction (`redactConfidentialWarning`) demeure sur le
 * CANAL ERREUR uniquement (message d'exception, texte destine a etre lu).
 *
 * Ce test :
 *   1. ALLOWLIST — prouve le mecanisme de lookup (reconnu → garde, inconnu → ECARTE) ;
 *   2. SENTINELLE #82 — un warning porteur d'un intermediaire non liste (« foo=2.5
 *      (§ confidentiel) ») n'atteint JAMAIS la sortie projetee (ni etiquette, ni §) ;
 *   3. PIPELINE REEL — un warning confidentiel renvoye par le moteur est ECARTE par
 *      runBurmister (la sortie ne le contient plus, meme redacte) ;
 *   4. CANAL ERREUR — la redaction mord toujours sur un message d'erreur porteur de
 *      valeur confidentielle (defense en profondeur, inchangee) ;
 *   5. FIXTURES REELLES — aucun texte confidentiel dans erreur+warnings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import { curateWarnings, redactConfidentialWarning, runBurmister } from './index.js';

/**
 * Repere une VALEUR confidentielle dans un texte : une etiquette confidentielle
 * (contrainte brute ou coefficient de fatigue) SUIVIE de `= <nombre>`.
 */
const VALEUR_CONFIDENTIELLE =
  /(?:σ_?[zrθ]|σ<sub>[zrθ]<\/sub>|kr|ks|kc|kθ|\bkth\b|Sh|ε₆|σ₆|\bet0\b|\betM\b|\bE1\b)\s*=\s*-?[0-9]/;

/** Marqueur d'une reference de section (doc privE STARFIRE) — jamais expose. */
const SECTION_PRIVEE = /§\s*confidentiel/i;

describe('FUITE #2 — ALLOWLIST fail-closed du canal warnings (curateWarnings)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('MECANISME : un warning RECONNU est garde, un INCONNU est ECARTE (lookup, pas un stub)', () => {
    // On injecte un ensemble cure de test avec UN message reconnu, pour prouver que
    // curateWarnings fait bien un lookup (et n'est pas un « return [] » constant).
    const cures = new Set<string>(['Message cure reconnu.']);
    const sortie = curateWarnings(
      ['Message cure reconnu.', 'Texte moteur libre non reconnu.'],
      cures,
    );
    expect(sortie).toEqual(['Message cure reconnu.']);
  });

  it('DEFAUT (production) : l ensemble cure est VIDE → TOUT warning est ECARTE', () => {
    const sortie = curateWarnings([
      'Coefficient de calage kc=1.3 appliqué (§ confidentiel)',
      'Hypothèse de trafic à confirmer',
      'foo=2.5 (§ confidentiel)',
    ]);
    expect(sortie).toEqual([]);
  });

  it('SENTINELLE #82 : « foo=2.5 (§ confidentiel) » n atteint JAMAIS la sortie', () => {
    const sortie = curateWarnings(['foo=2.5 (§ confidentiel)', 'bar=9 (§ interne 3.2)']);
    const joined = sortie.join(' || ');
    expect(sortie).toEqual([]);
    expect(joined).not.toContain('foo');
    expect(joined).not.toContain('2.5');
    expect(joined).not.toMatch(SECTION_PRIVEE);
    expect(joined).not.toContain('=');
  });

  // --- PIPELINE REEL : exercer runBurmister, pas seulement le curateur ---------
  it('PIPELINE REEL : un warning confidentiel renvoye par le moteur est ECARTE par runBurmister', async () => {
    // On force le moteur a poser, dans son _D, un warning porteur de l'etiquette `kc`
    // ET de la reference `(§ confidentiel)` — exactement la FUITE #2. L'allowlist
    // (vide) doit l'ECARTER : la sortie ne contient plus aucun warning.
    const FUITE_BRUTE = 'Coefficient de calage kc=1.3 appliqué (§ confidentiel)';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeBurmister: () => ({
          warn: [FUITE_BRUTE],
          PASS: false,
          passZ: false,
          NE: 1.5e6,
          fam: 'bitumineuse épaisse (§4.2)',
          H_bit: 0.16,
          H_tot: 0.41,
          ez: 800,
          ezA: 500,
          hasBit: true,
          sig: 0,
          et: 290.5,
          etA: 205.6,
          passT: false,
          etReq: true,
        }),
      };
    });

    const { runBurmister: runMocked } = await import('./index.js');

    // Anti faux-vert : le BRUT injecte fuit BIEN (etiquette + section privee).
    expect(FUITE_BRUTE).toContain('kc=1.3');
    expect(FUITE_BRUTE).toMatch(SECTION_PRIVEE);

    const fx0 = BURMISTER_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // Le warning non reconnu a ete ECARTE : aucun warning n'atteint le client.
    expect(env.output.warnings).toEqual([]);
    const serialized = JSON.stringify(env.output);
    // NB : depuis la decision titulaire du 13/07, `kc` est une CLE de sortie
    // whitelistee (details.kc) — on ne peut donc plus interdire la sous-chaine nue
    // « kc ». On cible ce qui constitue la FUITE : la VALEUR confidentielle
    // (`kc=1.3`, `1.3`) et la reference de section privee (`§`).
    expect(serialized).not.toContain('kc=1.3');
    expect(serialized).not.toContain('kc=');
    expect(serialized).not.toContain('1.3');
    expect(serialized).not.toMatch(SECTION_PRIVEE);
    expect(serialized).not.toContain('§');
  });

  // --- CANAL ERREUR : la redaction (defense en profondeur) mord toujours -------
  it('CANAL ERREUR : redactConfidentialWarning retire la valeur d un intermediaire confidentiel', () => {
    expect(redactConfidentialWarning('σ_z = 0,1234 MPa a la base')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('kr = 0,742 applique')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('kc = 1,3')).not.toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('CANAL ERREUR : la redaction NE touche PAS aux nombres NON confidentiels', () => {
    const benin = 'Structure inverse §4.5 : He = 41,0 cm, NE < 3·10⁶, classe C4.';
    expect(redactConfidentialWarning(benin)).toBe(benin);
  });

  it('PIPELINE REEL (erreur) : un message d erreur confidentiel est redacte par runBurmister', async () => {
    const ERR_BRUTE = 'Calcul impossible : σ_z = -0,1234 MPa hors domaine.';
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return { ...actual, computeBurmister: () => ({ err: ERR_BRUTE }) };
    });
    const { runBurmister: runMocked } = await import('./index.js');
    expect(ERR_BRUTE).toMatch(VALEUR_CONFIDENTIELLE); // le brut fuit bien
    const fx0 = BURMISTER_FIXTURES[0];
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.erreur ?? '').not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(env.output.erreur ?? '').toMatch(/valeur confidentielle masquee/);
  });

  it('aucun texte confidentiel dans le canal texte sur TOUT le jeu de fixtures REELLES', () => {
    for (const fx of BURMISTER_FIXTURES) {
      const env = runBurmister(fx.input);
      if (!env.ok) continue;
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(
        VALEUR_CONFIDENTIELLE,
      );
      expect(joined, `section privee sur fixture ${fx.id}`).not.toMatch(SECTION_PRIVEE);
    }
  });
});
