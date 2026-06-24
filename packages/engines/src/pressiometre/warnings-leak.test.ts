/**
 * MAJEUR-1 (DoD §8) — FUITE par le canal TEXTE LIBRE (`warnings` / `erreur`).
 *
 * Leçon de #45 : la whitelist protege les CLES, pas le TEXTE LIBRE. Un message qui
 * interpolerait la VALEUR d'un intermediaire CONFIDENTIEL du depouillement
 * pressiometrique (decomposition de contrainte sigH0/sigV0/u0, pression/volume de
 * calage brut pE/p0/Pf/VE/V0c/Vf, analyse de pente mE/beta) fuirait cette valeur
 * aussi surement qu'une cle. La projection (index.ts: redactConfidentialWarning)
 * REDACTE donc la valeur accolee a une etiquette confidentielle AVANT exposition.
 *
 * --- ETAT REEL DU MOTEUR (honnetete) ---
 * Le moteur pressiometre emet des `console.warn` (a force / dV-dP) mais ne pose
 * AUCUN champ `warn` dans `_res` ; sur exception / donnees insuffisantes il ne pose
 * qu'un `err` SANS valeur d'intermediaire. Il n'y a donc PAS aujourd'hui de fuite
 * averee a fermer. Ce test installe neanmoins la BARRIERE et en prouve la MORSURE
 * (defense en profondeur, fail-closed) : si une evolution du moteur se mettait a
 * interpoler une contrainte/une pression de calage dans un message, la redaction la
 * masquerait et ce test le verrouille.
 *
 * --- Ce que l'on NE redacte PAS (et pourquoi) ---
 * pL / pL* / pf* / EM / EM/pL* / alpha sont les RESULTATS exposes au PV : leur
 * valeur figure deja dans la sortie whitelistee, donc on ne les masque pas dans un
 * message. Idem les SEUILS/classes normatifs.
 *
 * Ce test :
 *   1. PROUVE que le motif de fuite est bien DETECTE dans un texte brut temoin ;
 *   2. PROUVE que le redacteur RETIRE la valeur confidentielle mais GARDE le sens ;
 *   3. EXERCE le PIPELINE REEL `runPressiometre` (M2) : on force le moteur a
 *      renvoyer un `_res` porteur d'un warning confidentiel (mock de
 *      `computePressiometre`), on prouve que le BRUT fuit, puis qu'apres projection
 *      la sortie ne fuit plus — la redaction est bien CABLEE sur le vrai chemin ;
 *   4. EXIGE qu'aucune sortie de fixture REELLE n'expose une valeur confidentielle
 *      dans le canal texte (erreur + warnings joints).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PRESSIOMETRE_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runPressiometre,
} from './index.js';

/**
 * Repere une VALEUR confidentielle dans un texte : une etiquette confidentielle
 * (decomposition de contrainte, pression/volume de calage, analyse de pente) SUIVIE
 * de `= <nombre>`. C'est exactement le motif que le redacteur doit eliminer. (Un
 * SEUIL/une classe — « ratio < 5 », « pL < 0,2 MPa » — n'a pas d'etiquette
 * confidentielle a sa gauche : il n'est pas vise.)
 */
const VALEUR_CONFIDENTIELLE =
  /(?:σ_?h0|σ_?v0|σ'_?v0|\bsigH0\b|\bsigV0\b|\bu0\b|\bpE\b|\bp0\b|\bPf\b|\bVE\b|\bV0c\b|\bVf\b|\bpS\b|\bmE\b|\bbeta\b|β)\s*=\s*-?[0-9]/;

describe('MAJEUR-1 — pas de fuite d intermediaire confidentiel par les messages', () => {
  // console.warn legitime du moteur (a force / dV-dP) : on le fait taire.
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('PRECONDITION : le motif de fuite est bien DETECTE dans un texte temoin (sinon test vide)', () => {
    const fuiteContrainte = 'σh0 = 0,42 bar au repos a la profondeur d essai';
    const fuiteCalage = 'p0 = 1,3 bar (debut pseudo-elastique) applique';
    const fuitePente = 'mE = 2,15 cm³/bar (pente minimale) §D.5.1';
    expect(fuiteContrainte).toMatch(VALEUR_CONFIDENTIELLE);
    expect(fuiteCalage).toMatch(VALEUR_CONFIDENTIELLE);
    expect(fuitePente).toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur MORD : il retire la VALEUR de contrainte mais garde l etiquette', () => {
    const propre = redactConfidentialWarning('sigH0 = 0,42 bar au repos');
    expect(propre).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(propre).toMatch(/sigH0/);
    expect(propre).toMatch(/valeur confidentielle masquee/);
  });

  it('le redacteur MORD sur les pressions/volumes de CALAGE (pE/p0/Pf/VE/V0c/Vf)', () => {
    expect(redactConfidentialWarning('pE = 0,5 bar')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('p0 = 1,3 bar')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('Pf = 3,2 bar')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('VE = 24 cm³')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('V0c = 70 cm³')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('Vf = 130 cm³')).not.toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur MORD sur l analyse de pente (mE/beta) et u0/sigV0', () => {
    expect(redactConfidentialWarning('mE = 2,15')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('beta = 1,8')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('β = 1,8')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('u0 = 0,18 bar')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('sigV0 = 0,38 bar')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
  });

  // --- MINEUR-4/1 : les ETIQUETTES REELLEMENT EMISES par les 2 console.warn ------
  // Ce test reproduit les CHAINES EXACTES emises par engine.ts (warn « a trop
  // grand » et warn « EM=0 »). Il prouve que le redacteur MORD sur les vraies
  // etiquettes (p0I/pfI/_dV/_dP/a×Pmax/V60_moy), pas seulement sur des formes
  // idealisees (p0/Pf...). Le piege \b est explicitement couvert : `\bp0\b` NE
  // matche PAS `p0I`, d'ou des regex litterales dediees cote redacteur. Retirer ces
  // etiquettes de CONFIDENTIAL_WARNING_LABELS rend ce test ROUGE (sentinelle).
  const FUITE_WARN_A = 'a=50 trop grand (a×Pmax=220.0 > 0.5×V60_moy=69.8) → a=0 utilisé';
  const FUITE_WARN_EM = 'calcDepth: _dV=-0.3 _dP=0.5 → EM=0. Vérifiez p0I=2 pfI=5';
  // Motif de fuite cible sur les VRAIES etiquettes (distinct de VALEUR_CONFIDENTIELLE,
  // qui visait les formes idealisees) : etiquette reelle SUIVIE de `= <nombre>`.
  const VALEUR_REELLE_EMISE =
    /(?:\ba\b|a×Pmax|\bPmax\b|0\.5×V60_moy|\bV60_moy\b|_dV|_dP|\bp0I\b|\bpfI\b)\s*=\s*-?[0-9]/;

  it('PRECONDITION : les chaines REELLES des console.warn fuiraient bien (sinon test vide)', () => {
    expect(FUITE_WARN_A).toMatch(VALEUR_REELLE_EMISE);
    expect(FUITE_WARN_EM).toMatch(VALEUR_REELLE_EMISE);
  });

  it('le redacteur MORD sur les ETIQUETTES REELLES du warn « a trop grand » (a/a×Pmax/V60_moy)', () => {
    const propre = redactConfidentialWarning(FUITE_WARN_A);
    expect(propre).not.toMatch(VALEUR_REELLE_EMISE);
    expect(propre).toMatch(/valeur confidentielle masquee/);
  });

  it('le redacteur MORD sur les ETIQUETTES REELLES du warn « EM=0 » (_dV/_dP/p0I/pfI)', () => {
    const propre = redactConfidentialWarning(FUITE_WARN_EM);
    expect(propre).not.toMatch(VALEUR_REELLE_EMISE);
    expect(propre).toMatch(/valeur confidentielle masquee/);
  });

  it('chaque etiquette reelle prise isolement est redactee (couverture fine, piege \\b)', () => {
    // `\bp0\b`/`\bpfI?\b` NE couvriraient PAS ces formes : on verifie une a une.
    expect(redactConfidentialWarning('p0I=2')).not.toMatch(VALEUR_REELLE_EMISE);
    expect(redactConfidentialWarning('pfI=5')).not.toMatch(VALEUR_REELLE_EMISE);
    expect(redactConfidentialWarning('_dV=-0.3')).not.toMatch(VALEUR_REELLE_EMISE);
    expect(redactConfidentialWarning('_dP=0.5')).not.toMatch(VALEUR_REELLE_EMISE);
    expect(redactConfidentialWarning('a×Pmax=220.0')).not.toMatch(VALEUR_REELLE_EMISE);
    expect(redactConfidentialWarning('V60_moy=69.8')).not.toMatch(VALEUR_REELLE_EMISE);
  });

  it('le redacteur NE touche PAS aux nombres NON confidentiels (profondeur, seuils, classes)', () => {
    // Une mention de profondeur (m), de seuil ou de classe ne porte pas d'etiquette
    // confidentielle : elle doit etre PRESERVEE telle quelle. (Les RESULTATS exposes
    // pL/EM/alpha ne sont pas non plus dans la liste d'etiquettes confidentielles.)
    const benin = 'Essai a 4,0 m : ratio < 5 (remanié), classe C, pL = 1,8 MPa.';
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);
  });

  // --- M2 : exercer le PIPELINE REEL runPressiometre, pas seulement le redacteur ---
  it('PIPELINE REEL : un warning confidentiel renvoye par le moteur est NETTOYE par runPressiometre', async () => {
    // On force le moteur a poser, dans son _res, un warning porteur de DEUX valeurs
    // confidentielles (contrainte + pression de calage). C'est le scenario qu'une
    // evolution du moteur pourrait introduire. On mock UNIQUEMENT computePressiometre.
    const FUITE_BRUTE = 'σh0 = 0,42 bar et p0 = 1,3 bar (debut pseudo-elastique).';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computePressiometre: () => ({
          // _res minimal mais COMPLET pour le chemin non-erreur de shapeOutput,
          // PORTEUR d'un warning confidentiel (le canal a assainir).
          warn: [FUITE_BRUTE],
          pL: 18,
          pLS: 17.5,
          PfS: 8.2,
          EM: 9.5,
          ratio: 5.4,
          alpha: 0.5,
          pL_direct: 18,
          cat: 'C',
          catName: 'Sol ferme (cat. C)',
          consol: 'Sol normalement consolidé',
        }),
      };
    });

    // Import FRAIS de l'index APRES le mock (sinon il garde le vrai engine).
    const { runPressiometre: runMocked } = await import('./index.js');

    // Anti faux-vert : le BRUT injecte fuit BIEN (sinon le test ne prouverait rien).
    expect(FUITE_BRUTE).toMatch(VALEUR_CONFIDENTIELLE);

    const fx0 = PRESSIOMETRE_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // Le warning a TRAVERSE le vrai pipeline (shapeOutput -> projectEngineOutput) et
    // en ressort REDACTE : la valeur a disparu, le sens (etiquette) demeure.
    const joined = env.output.warnings.join(' || ');
    expect(joined.length).toBeGreaterThan(0); // le warning n'est pas SUPPRIME
    expect(joined).not.toMatch(VALEUR_CONFIDENTIELLE); // mais NETTOYE
    expect(joined).toMatch(/valeur confidentielle masquee/);
  });

  it('aucune valeur confidentielle dans le canal texte sur TOUT le jeu de fixtures REELLES', () => {
    for (const fx of PRESSIOMETRE_FIXTURES) {
      const env = runPressiometre(fx.input);
      if (!env.ok) continue;
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(
        VALEUR_CONFIDENTIELLE,
      );
    }
  });
});
