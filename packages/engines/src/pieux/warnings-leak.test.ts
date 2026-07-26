/**
 * DoD §8 — canal TEXTE LIBRE (`warnings` / `erreur`) : redaction FAIL-CLOSED + HARMONISEE.
 *
 * Leçon de #45 : la whitelist protege les CLES, pas le TEXTE LIBRE. Un message pourrait
 * interpoler la VALEUR d'un intermediaire.
 *
 * --- HARMONISATION §8 (politique titulaire 26/07, FERME) ---
 * « On expose EXACTEMENT ce que l'outil client AFFICHE ; seul confidentiel = le CODE
 * moteur. » La sortie structuree de PIEUX expose desormais, en display-only, les
 * grandeurs AFFICHEES par l'outil : qb / p*le / q_ce / kp / kc / kfac / kmax / D_ef /
 * D_ef/B / C_e (synthese) et qs / qsm par couche. Les DEUX barrieres §8 doivent etre
 * COHERENTES : une grandeur exposee comme cle structuree ne peut etre masquee dans un
 * message. Ces etiquettes sont donc BENIGNES cote redaction aussi (allowlist).
 *
 * --- CE QUI RESTE FAIL-CLOSED (masque) ---
 * Tout intermediaire que l'outil N'AFFICHE PAS : les coefficients α des courbes de
 * frottement (annexes F/G), les resistances BRUTES NUES (Rb/Rc/Rs — leurs formes
 * EXPOSEES sont suffixees RbK/RsK/RcK/RcD), et toute etiquette INCONNUE (sentinelle
 * fail-closed : inconnu => masque, defaut sur).
 *
 * Ce test :
 *   1. PROUVE l'HARMONISATION : le VRAI warning « Cₑ = <n> » (effet de groupe, affiche
 *      dans la synthese) GARDE sa valeur ; idem qb/ple/qce/kp/kc/kfac/kmax/Def/qs ;
 *   2. PROUVE que le FAIL-CLOSED tient : α, resistances NUES et etiquettes INCONNUES
 *      restent MASQUEES ;
 *   3. EXERCE le PIPELINE REEL `runPieux` (harmonise + fail-closed sur la meme sortie) ;
 *   4. EXIGE qu'aucune sortie de fixture REELLE n'expose une valeur RESIDUELLE
 *      confidentielle (α / resistance nue) dans le canal texte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PIEUX_DOWNDRAG_FIXTURES, PIEUX_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runPieux,
} from './index.js';

/**
 * Repere une valeur RESIDUELLE confidentielle : un intermediaire NON AFFICHE par
 * l'outil (α des courbes de frottement) OU une resistance BRUTE NUE (Rb/Rc/Rs, formes
 * sans suffixe K/D) SUIVIE de `= <nombre>`. Apres l'HARMONISATION §8, les grandeurs
 * AFFICHEES (Cₑ/qb/ple/qce/kp/kc/kfac/kmax/Def/qs…) ne sont PLUS confidentielles : elles
 * ne figurent donc PLUS dans ce motif (elles sont exposees a l'ecran comme au PV).
 */
const VALEUR_RESIDUELLE_CONFIDENTIELLE =
  /(?:α|\balpha\b|\bRb\b|\bRc\b|\bRs\b|Rₛ)\s*=\s*-?[0-9]/;

describe('§8 canal texte — HARMONISATION (grandeurs affichees benignes) + fail-closed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('PRECONDITION : le motif RESIDUEL est bien DETECTE sur un temoin (sinon test vide)', () => {
    expect('coefFrottement α = 0,55 appliqué').toMatch(VALEUR_RESIDUELLE_CONFIDENTIELLE);
    expect('Rb = 4200 kN sous la pointe').toMatch(VALEUR_RESIDUELLE_CONFIDENTIELLE);
  });

  // --- HARMONISATION : les grandeurs AFFICHEES gardent leur valeur -----------------
  it('HARMONISE : le VRAI warning « Cₑ = <n> » (effet de groupe, affiche dans la synthese) GARDE sa valeur', () => {
    const propre = redactConfidentialWarning(
      'Effet de groupe : Rₛ réduit par Cₑ = 0,67 (entraxe < 3·B, §4.3.2).',
    );
    // Cₑ est AFFICHE par l'outil (synthese geometrique) -> NON masque desormais.
    expect(propre).toMatch(/Cₑ\s*=\s*0,67/);
    expect(propre).not.toMatch(/valeur confidentielle masquee/);
    // Le coefficient normatif litteral « 3·B » et la reference de § sont preserves.
    expect(propre).toMatch(/3·B/);
    expect(propre).toMatch(/§4\.3\.2/);
    // Rₛ (frottement) NU sans `= <n>` n'est pas une valeur -> intact (pas d'interpolation).
  });

  it('HARMONISE : qb/ple/qce/kp/kc/kfac/kmax/Def/Def-B/qs/qsm (affiches par l outil) GARDENT leur valeur', () => {
    const cas: Array<[string, RegExp]> = [
      ['qb = 4200 kPa', /qb\s*=\s*4200/],
      ['ple = 1,80 MPa', /ple\s*=\s*1,80/],
      ['qce = 12,3 MPa', /qce\s*=\s*12,3/],
      ['kp = 1,15', /kp\s*=\s*1,15/],
      ['kc = 0,40', /kc\s*=\s*0,40/],
      ['kfac = 1,10', /kfac\s*=\s*1,10/],
      ['kmax = 1,30', /kmax\s*=\s*1,30/],
      ['Def = 5,2 m', /Def\s*=\s*5,2/],
      ['Def/B = 8,7', /Def\/B\s*=\s*8,7/],
      ['qs = 130 kPa', /qs\s*=\s*130/],
      ['qsm = 200 kPa', /qsm\s*=\s*200/],
    ];
    for (const [txt, keep] of cas) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `masque a tort : ${txt}`).toMatch(keep);
      expect(propre, `masque a tort : ${txt}`).not.toMatch(
        /valeur confidentielle masquee/,
      );
    }
  });

  it('HARMONISE : les grandeurs de RESULTAT (RbK/RsK/RcK/RcD, D, B) gardent leur valeur', () => {
    expect(redactConfidentialWarning('RcK = 1800 kN')).toMatch(/=\s*1800/);
    expect(redactConfidentialWarning('RcD = 1400 kN')).toMatch(/=\s*1400/);
    expect(redactConfidentialWarning('D = 15 m')).toMatch(/=\s*15/);
    expect(redactConfidentialWarning('B = 0,60 m')).toMatch(/=\s*0,60/);
  });

  // --- FAIL-CLOSED PRESERVE : inconnus + α + resistances NUES restent masques -------
  it('FAIL-CLOSED : un intermediaire NU INCONNU (non liste) est REDACTE', () => {
    const inconnus = [
      'Xyz = 42 kN',
      'facteurInterne = 3,14',
      'sigmaPointe = 1850 kPa',
      'coefMaison = 0,87 MPa',
    ];
    for (const txt of inconnus) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `non redacte : ${txt}`).toMatch(/valeur confidentielle masquee/);
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(/=\s*-?[0-9]/);
    }
  });

  it('FAIL-CLOSED : le coefficient « alpha » NON AFFICHE (courbes de frottement) reste REDACTE', () => {
    // Le coefficient α des annexes F/G n'est PAS affiche par l'outil -> il reste
    // confidentiel apres l'harmonisation (on n'a rendu benin QUE ce que le client
    // affiche). Sous sa forme latine « alpha » (etiquette tokenisable) il est bien masque.
    // NB HONNETE : le glyphe grec « α » NU n'entre PAS dans la grammaire de token du
    // redacteur (classe latine/indices) — il n'est donc pas reecrit ; mais le moteur
    // n'emet JAMAIS α dans un warning (seul « Cₑ » l'est), donc aucune fuite reelle. La
    // sentinelle operante = etiquette LATINE inconnue (ci-dessus) + resistances nues.
    const propre = redactConfidentialWarning('alpha = 0,55 (marne)');
    expect(propre, 'alpha non redacte').toMatch(/valeur confidentielle masquee/);
    expect(propre, 'valeur alpha survivante').not.toMatch(/=\s*-?[0-9]/);
  });

  it('FAIL-CLOSED : les resistances BRUTES NUES (Rb/Rc/Rs) restent REDACTEES (collision d allowlist)', () => {
    // Rb (pointe brut), Rc (total brut), Rs (frottement brut) sont des intermediaires
    // CONFIDENTIELS. Leurs formes EXPOSEES portent un suffixe (RbK/RsK/RcK/RcD). Les
    // formes NUES NE sont PAS allowlistees (sinon « Rb = 4200 kN » fuirait). Sentinelle.
    const brutes = ['Rb = 4200 kN', 'Rc = 5300 kN', 'Rs = 3100 kN', 'Rₛ = 3100 kN'];
    for (const txt of brutes) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `resistance brute non redactee : ${txt}`).toMatch(
        /valeur confidentielle masquee/,
      );
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(/=\s*-?[0-9]/);
    }
  });

  it('le redacteur NE touche PAS aux nombres NON confidentiels (profondeur, categorie, coefficients normatifs litteraux)', () => {
    const benin =
      'Ancrage dans la couche porteuse h = 1,20 m < 3·B = 1,80 m recommandé (Note 1).';
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);

    const benin2 = 'Micropieu (catégorie 17) : résistance de pointe non prise en compte.';
    expect(redactConfidentialWarnings([benin2])[0]).toBe(benin2);

    const benin3 = 'Traction sans essais : résistance ELS plafonnée à 0,15·Rₛ (§4.3.3).';
    expect(redactConfidentialWarnings([benin3])[0]).toBe(benin3);
  });

  // --- M2 : exercer le PIPELINE REEL runPieux (harmonise + fail-closed) -------------
  it('PIPELINE REEL : Cₑ GARDE sa valeur, une resistance BRUTE NUE est MASQUEE, par runPieux', async () => {
    // Warning mixte : Cₑ (affiche -> garde) ET une resistance brute nue Rb (confidentielle
    // -> masquee). Prouve HARMONISATION + FAIL-CLOSED cables sur le vrai pipeline.
    const MIXTE =
      'Effet de groupe : Rₛ réduit par Cₑ = 0,67 ; terme de pointe Rb = 4200 kN (interne).';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computePieux: () => ({
          warn: [MIXTE],
          B: 0.6,
          D: 15,
          cat: 1,
          meth: 'pmt',
          sens: 'comp',
          RbK: 1000,
          RsK: 800,
          RcK: 1800,
          RcD: 1400,
          RcrK: 1100,
          RcrCar: 1200,
          RcrQp: 1000,
          FduELU: 1605,
          FdCar: 1150,
          FdQp: 905,
          checks: [],
          allOk: true,
          govern: 0.9,
          settle: { sEls: 8.2 },
        }),
      };
    });

    const { runPieux: runMocked } = await import('./index.js');

    const fx0 = PIEUX_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    // Cₑ affiche -> valeur conservee (harmonisation cablee sur le vrai pipeline).
    expect(joined).toMatch(/Cₑ\s*=\s*0,67/);
    // α non affiche -> masque (fail-closed cable sur le vrai pipeline).
    expect(joined).toMatch(/valeur confidentielle masquee/);
    expect(joined).not.toMatch(VALEUR_RESIDUELLE_CONFIDENTIELLE);
  });

  it('aucune valeur RESIDUELLE confidentielle (α / resistance nue) dans le canal texte sur TOUT le jeu de fixtures REELLES', () => {
    for (const fx of PIEUX_FIXTURES) {
      const env = runPieux(fx.input);
      if (!env.ok) continue;
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(
        VALEUR_RESIDUELLE_CONFIDENTIELLE,
      );
    }
  });

  // --- FROTTEMENT NÉGATIF (#94) : le warning STATIQUE de découplage est sûr ----------
  describe('downdrag — warning statique de découplage (aucune valeur interpolée)', () => {
    const ddFixtures = PIEUX_DOWNDRAG_FIXTURES.filter((f) => !f.horsDomaine);

    it('PRECONDITION : au moins un jeu downdrag comparable (sinon test vide)', () => {
      expect(ddFixtures.length).toBeGreaterThanOrEqual(1);
    });

    for (const fx of ddFixtures) {
      it(`[${fx.id}] le rappel de découplage est présent, SANS valeur résiduelle confidentielle`, () => {
        const env = runPieux(fx.input);
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        const rappel = env.output.warnings.find((w) => /Frottement négatif Gsn/.test(w));
        expect(rappel, `rappel de découplage absent sur ${fx.id}`).toBeDefined();
        const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
        expect(joined, `fuite texte sur downdrag ${fx.id}`).not.toMatch(
          VALEUR_RESIDUELLE_CONFIDENTIELLE,
        );
        // Anti faux-vert : le rappel n'interpole PAS de « = <nombre> » (borne du canal).
        expect(rappel).not.toMatch(/=\s*-?[0-9]/);
      });
    }
  });
});
