/**
 * MAJEUR-1 (DoD §8) — FUITE par le canal TEXTE LIBRE (`warnings` / `erreur`).
 *
 * Leçon de #45 : la whitelist protege les CLES, pas le TEXTE LIBRE. Un message
 * qui interpolerait la VALEUR d'un intermediaire CONFIDENTIEL de burmister
 * (contrainte brute σ_z/σ_r/σ_θ, coefficient de fatigue kr/ks/kc/Sh, ε₆/σ₆)
 * fuirait cette valeur aussi surement qu'une cle. La projection (index.ts:
 * redactConfidentialWarning) REDACTE donc la valeur accolee a une etiquette
 * confidentielle AVANT exposition.
 *
 * --- ETAT REEL DU MOTEUR (honnetete) ---
 * Le moteur burmister ne produit, en fonctionnement normal, AUCUN warning texte
 * (l'objet `_D` n'a pas de champ `warn`) ; sur exception il ne pose qu'un `err`
 * SANS valeur d'intermediaire. Il n'y a donc PAS aujourd'hui de fuite averee a
 * fermer (contrairement a terzaghi). Ce test installe neanmoins la BARRIERE et
 * en prouve la MORSURE (defense en profondeur, fail-closed) : si une evolution du
 * moteur se mettait a interpoler une contrainte/un coefficient dans un message,
 * la redaction la masquerait et ce test le verrouille.
 *
 * Ce test :
 *   1. PROUVE que le motif de fuite est bien DETECTE dans un texte brut temoin
 *      (sinon le test serait vide / faux-vert) ;
 *   2. PROUVE que le redacteur RETIRE la valeur confidentielle mais GARDE le sens ;
 *   3. EXERCE le PIPELINE REEL `runBurmister` (M2 de la revue adverse) : on force
 *      le moteur a renvoyer un `_D` porteur d'un warning confidentiel (mock de
 *      `computeBurmister`), on prouve que le BRUT fuit, puis qu'apres projection
 *      la sortie ne fuit plus — la redaction est bien CABLEE sur le vrai chemin,
 *      pas seulement testee en redacteur isole ;
 *   4. EXIGE qu'aucune sortie de fixture REELLE n'expose une valeur confidentielle
 *      dans le canal texte (erreur + warnings joints), racine ET sous-chaines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runBurmister,
} from './index.js';

/**
 * Repere une VALEUR confidentielle dans un texte : une etiquette confidentielle
 * (contrainte brute ou coefficient de fatigue) SUIVIE de `= <nombre>`. C'est
 * exactement le motif que le redacteur doit eliminer. (Un SEUIL/une classe
 * normative — « NE < 3·10⁶ » — n'a pas d'etiquette confidentielle a sa gauche :
 * il n'est pas vise.)
 */
const VALEUR_CONFIDENTIELLE =
  /(?:σ_?[zrθ]|σ<sub>[zrθ]<\/sub>|kr|ks|kc|kθ|\bkth\b|Sh|ε₆|σ₆|\bet0\b|\betM\b|\bE1\b)\s*=\s*-?[0-9]/;

describe('MAJEUR-1 — pas de fuite d intermediaire confidentiel par les messages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('PRECONDITION : le motif de fuite est bien DETECTE dans un texte temoin (sinon test vide)', () => {
    // Temoins fabriques representant ce qu'un message FUYANT contiendrait.
    const fuiteContrainte = 'σ_z = 0,1234 MPa a la base du paquet lie';
    const fuiteCoef = 'kr = 0,742 (risque 5 %) applique a la loi de fatigue';
    expect(fuiteContrainte).toMatch(VALEUR_CONFIDENTIELLE);
    expect(fuiteCoef).toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur MORD : il retire la VALEUR de contrainte mais garde l etiquette', () => {
    const propre = redactConfidentialWarning('σ_z = 0,1234 MPa a la base du paquet lie');
    expect(propre).not.toMatch(VALEUR_CONFIDENTIELLE);
    // L'etiquette demeure (sens conserve), la valeur a disparu.
    expect(propre).toMatch(/σ_?z/);
    expect(propre).toMatch(/valeur confidentielle masquee/);
  });

  it('le redacteur MORD sur les COEFFICIENTS de fatigue (kr/ks/kc/Sh/ε₆/σ₆)', () => {
    expect(redactConfidentialWarning('kr = 0,742 applique')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('ks = 0,95')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('kc = 1,3')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('Sh = 2,5 cm')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('ε₆ = 100 μdef')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('σ₆ = 2,15 MPa')).not.toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur MORD sur les intermediaires de STRUCTURE chaussee (et0/etM/kθ/E1)', () => {
    // Defense en profondeur : si une evolution future interpolait ces
    // intermediaires (deformations sollicitantes par position, calage kθ, module
    // pondere du paquet lie) dans un message, la redaction DOIT les masquer.
    expect(redactConfidentialWarning('et0 = 0,000123 a la base')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('etM = 0,000098')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('kθ = 1,07 (calage)')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('E1 = 9200 MPa module pondere')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
  });

  it('le redacteur NE touche PAS aux nombres NON confidentiels (epaisseurs, NE, classes)', () => {
    // Une mention d'epaisseur (cm), de NE ou de classe ne porte pas d'etiquette
    // confidentielle : elle doit etre PRESERVEE telle quelle.
    const benin = 'Structure inverse §4.5 : He = 41,0 cm, NE < 3·10⁶, classe C4.';
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);
  });

  // --- M2 : exercer le PIPELINE REEL runBurmister, pas seulement le redacteur ---
  it('PIPELINE REEL : un warning confidentiel renvoye par le moteur est NETTOYE par runBurmister', async () => {
    // On force le moteur a poser, dans son _D, un warning porteur de DEUX valeurs
    // confidentielles (contrainte + coefficient). C'est le scenario qu'une
    // evolution du moteur pourrait introduire. On mock UNIQUEMENT computeBurmister
    // (les autres exports — marqueur, materiaux — restent reels via importActual).
    const FUITE_BRUTE = 'σ_z = -0,1234 MPa et kr = 0,742 a la base du paquet lie (C2).';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeBurmister: () => ({
          // _D minimal mais COMPLET pour le chemin non-erreur de shapeOutput,
          // PORTEUR d'un warning confidentiel (le canal a assainir).
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

    // Import FRAIS de l'index APRES le mock (sinon il garde le vrai engine).
    const { runBurmister: runMocked } = await import('./index.js');

    // Anti faux-vert : le BRUT injecte fuit BIEN (sinon le test ne prouverait rien).
    expect(FUITE_BRUTE).toMatch(VALEUR_CONFIDENTIELLE);

    const fx0 = BURMISTER_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // Le warning a TRAVERSE le vrai pipeline (shapeOutput -> projectEngineOutput)
    // et en ressort REDACTE : la valeur a disparu, le sens (etiquette) demeure.
    const joined = env.output.warnings.join(' || ');
    expect(joined.length).toBeGreaterThan(0); // le warning n'est pas SUPPRIME
    expect(joined).not.toMatch(VALEUR_CONFIDENTIELLE); // mais NETTOYE
    expect(joined).toMatch(/valeur confidentielle masquee/);
  });

  it('aucune valeur confidentielle dans le canal texte sur TOUT le jeu de fixtures REELLES', () => {
    for (const fx of BURMISTER_FIXTURES) {
      const env = runBurmister(fx.input);
      if (!env.ok) continue;
      // Canal texte libre = erreur (peut etre null) + warnings joints.
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(
        VALEUR_CONFIDENTIELLE,
      );
    }
  });
});
