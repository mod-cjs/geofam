/**
 * MAJEUR-1 (DoD §8) — FUITE par le canal TEXTE LIBRE (`warnings` / `erreur`).
 *
 * Leçon de #45 : la whitelist protege les CLES, pas le TEXTE LIBRE.
 *
 * --- ETAT REEL DU MOTEUR PIEUX (honnetete — DIFFERENT de pressiometre) ---
 * Contrairement au moteur pressiometre (ou `warn` etait STRUCTURELLEMENT VIDE et la
 * redaction purement dormante), ce moteur POSE un tableau `warn` dans son resultat
 * `R`, et on l'EXPOSE via `warnings`. La redaction est donc une barriere ACTIVE.
 *
 * Parmi les warnings REELS du moteur (cf. liste exhaustive dans index.ts), UN SEUL
 * interpole une valeur d'INTERMEDIAIRE de methode calcule : « Effet de groupe : Rₛ
 * réduit par Cₑ = <n> (entraxe < 3·B) ». Cₑ (coefficient de reduction de groupe,
 * Annexe J.2) est un intermediaire ; c'est la cible PRINCIPALE de la redaction. Les
 * autres warnings n'interpolent que des profondeurs (m), le numero de categorie, B
 * (expose) ou des coefficients normatifs LITTERAUX (« 0,15·Rₛ », « 3·B ») — non vises.
 * Les intermediaires les plus sensibles (qb/ple/qce/kp/kc/qs) vivent dans `qbDetail`
 * et `fric`, qui ne sont JAMAIS exposes (whitelist de cles).
 *
 * Ce test :
 *   1. PROUVE que le motif de fuite est bien DETECTE dans un texte temoin ;
 *   2. PROUVE que le redacteur RETIRE la valeur confidentielle mais GARDE le sens ;
 *   3. EXERCE le PIPELINE REEL `runPieux` (M2) : on force le moteur a renvoyer un
 *      `R` porteur d'un warning confidentiel (mock de `computePieux`), on prouve que
 *      le BRUT fuit, puis qu'apres projection la sortie ne fuit plus — la redaction
 *      est bien CABLEE sur le vrai chemin ;
 *   4. EXIGE qu'aucune sortie de fixture REELLE n'expose une valeur confidentielle
 *      dans le canal texte (erreur + warnings joints).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PIEUX_FIXTURES } from './test-fixtures.js';

import {
  redactConfidentialWarning,
  redactConfidentialWarnings,
  runPieux,
} from './index.js';

/**
 * Repere une VALEUR confidentielle dans un texte : une etiquette confidentielle
 * (Cₑ/Ce ou un intermediaire de methode) SUIVIE de `= <nombre>`. C'est exactement le
 * motif que le redacteur doit eliminer. (Un coefficient normatif litteral — « 0,15·Rₛ »,
 * « 3·B » — n'a pas d'etiquette confidentielle suivie de `=` : il n'est pas vise.)
 */
const VALEUR_CONFIDENTIELLE =
  /(?:Cₑ|\bCe\b|\bqb\b|p\*le|\bple\b|\bqce\b|\bkp\b|\bkc\b|\bkfac\b|\bkmax\b|Def\/B|\bDef\b|\bqs\b|\bqsm\b|α)\s*=\s*-?[0-9]/;

describe('MAJEUR-1 — pas de fuite d intermediaire confidentiel par les messages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('PRECONDITION : le motif de fuite est bien DETECTE dans un texte temoin (sinon test vide)', () => {
    // Le VRAI warning emis par le moteur (warning #7) + des intermediaires de methode.
    const fuiteGroupe =
      'Effet de groupe : Rₛ réduit par Cₑ = 0,75 (entraxe < 3·B, §4.3.2).';
    const fuitePointe = 'qb = 4200 kPa sous la pointe';
    const fuitePortance = 'kp = 1,15 (kp,max=1,15) appliqué';
    expect(fuiteGroupe).toMatch(VALEUR_CONFIDENTIELLE);
    expect(fuitePointe).toMatch(VALEUR_CONFIDENTIELLE);
    expect(fuitePortance).toMatch(VALEUR_CONFIDENTIELLE);
  });

  it('le redacteur MORD sur le VRAI warning « Cₑ = <n> » (effet de groupe) mais garde le sens', () => {
    const propre = redactConfidentialWarning(
      'Effet de groupe : Rₛ réduit par Cₑ = 0,75 (entraxe < 3·B, §4.3.2).',
    );
    expect(propre).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(propre).toMatch(/Cₑ/);
    expect(propre).toMatch(/valeur confidentielle masquee/);
    // Le coefficient normatif litteral « 3·B » et la reference de § sont preserves.
    expect(propre).toMatch(/3·B/);
    expect(propre).toMatch(/§4\.3\.2/);
  });

  it('le redacteur MORD sur les intermediaires de METHODE (qb/ple/qce/kp/kc/Def/qs)', () => {
    expect(redactConfidentialWarning('qb = 4200 kPa')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('ple = 1,80 MPa')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('qce = 12,3 MPa')).not.toMatch(
      VALEUR_CONFIDENTIELLE,
    );
    expect(redactConfidentialWarning('kp = 1,15')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('kc = 0,40')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('Def = 5,2 m')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('Def/B = 8,7')).not.toMatch(VALEUR_CONFIDENTIELLE);
    expect(redactConfidentialWarning('qs = 130 kPa')).not.toMatch(VALEUR_CONFIDENTIELLE);
  });

  // --- MAJEUR-2 (challenge #48) : FAIL-CLOSED par ALLOWLIST -----------------------
  // La redaction n'est PAS une blacklist d'etiquettes connues : elle masque TOUTE
  // valeur `<token> = <nombre>` SAUF si <token> est dans l'allowlist benigne. Un
  // intermediaire NU INCONNU (jamais liste) DOIT donc etre masque. Ce test devient
  // ROUGE si l'on revenait a une logique fail-OPEN (blacklist) : sentinelle de la
  // propriete fail-closed claimee dans l'en-tete d'index.ts.
  it('FAIL-CLOSED : un intermediaire NU INCONNU (non liste) est tout de meme REDACTE', () => {
    const inconnus = [
      'Xyz = 42 kN',
      'facteurInterne = 3,14',
      'sigmaPointe = 1850 kPa',
      'coefMaison = 0,87 MPa',
    ];
    for (const txt of inconnus) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `non redacte : ${txt}`).toMatch(/valeur confidentielle masquee/);
      // La VALEUR numerique a disparu (plus de « = <nombre> » apres l'etiquette).
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(/=\s*-?[0-9]/);
    }
  });

  it('FAIL-CLOSED : les resistances BRUTES NUES (Rb/Rc/Rs) sont REDACTEES (collision d allowlist, MAJEUR-2 2e passe)', () => {
    // Rb (terme de pointe brut), Rc (total brut), Rs (frottement brut) sont des
    // intermediaires CONFIDENTIELS (FUITES_INTERDITES). Leurs formes EXPOSEES portent
    // un suffixe (RbK/RsK/RcK/RcD). Les formes NUES NE doivent PAS etre allowlistees :
    // sinon un futur warning « Rb = 4200 kN » fuirait. Cette sentinelle devient ROUGE
    // si rb/rc/rs reapparaissent dans l'allowlist benigne.
    const brutes = ['Rb = 4200 kN', 'Rc = 5300 kN', 'Rs = 3100 kN', 'Rₛ = 3100 kN'];
    for (const txt of brutes) {
      const propre = redactConfidentialWarning(txt);
      expect(propre, `resistance brute non redactee : ${txt}`).toMatch(
        /valeur confidentielle masquee/,
      );
      expect(propre, `valeur survivante : ${txt}`).not.toMatch(/=\s*-?[0-9]/);
    }
  });

  it('FAIL-CLOSED : les grandeurs EXPOSEES au PV (allowlist benigne) gardent leur valeur', () => {
    // Symetrie de l'allowlist : ces etiquettes SONT deja dans la sortie whitelistee
    // (RbK/RsK/RcK/RcD/Rcr*/Fd*/B/D) -> on NE les masque pas (message legitime).
    expect(redactConfidentialWarning('RcK = 1800 kN')).toMatch(/=\s*1800/);
    expect(redactConfidentialWarning('RcD = 1400 kN')).toMatch(/=\s*1400/);
    expect(redactConfidentialWarning('D = 15 m')).toMatch(/=\s*15/);
    expect(redactConfidentialWarning('B = 0,60 m')).toMatch(/=\s*0,60/);
  });

  it('le redacteur NE touche PAS aux nombres NON confidentiels (profondeur, categorie, coefficients normatifs litteraux)', () => {
    // Une mention de profondeur (m), de categorie ou de coefficient normatif litteral
    // ne porte pas d'etiquette confidentielle suivie de `=` : elle doit etre PRESERVEE.
    const benin =
      'Ancrage dans la couche porteuse h = 1,20 m < 3·B = 1,80 m recommandé (Note 1).';
    // NB : « h = » et « 3·B = » ne sont PAS des etiquettes confidentielles -> intacts.
    expect(redactConfidentialWarnings([benin])[0]).toBe(benin);

    const benin2 = 'Micropieu (catégorie 17) : résistance de pointe non prise en compte.';
    expect(redactConfidentialWarnings([benin2])[0]).toBe(benin2);

    const benin3 = 'Traction sans essais : résistance ELS plafonnée à 0,15·Rₛ (§4.3.3).';
    expect(redactConfidentialWarnings([benin3])[0]).toBe(benin3);
  });

  // --- M2 : exercer le PIPELINE REEL runPieux, pas seulement le redacteur ----------
  it('PIPELINE REEL : un warning confidentiel renvoye par le moteur est NETTOYE par runPieux', async () => {
    // On force le moteur a poser, dans son R, le VRAI warning porteur de Cₑ + un
    // intermediaire de methode. On mock UNIQUEMENT computePieux.
    const FUITE_BRUTE =
      'Effet de groupe : Rₛ réduit par Cₑ = 0,75 (entraxe < 3·B) ; qb = 4200 kPa.';

    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computePieux: () => ({
          // R minimal mais COMPLET pour le chemin non-erreur de shapeOutput,
          // PORTEUR d'un warning confidentiel (le canal a assainir).
          warn: [FUITE_BRUTE],
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

    // Import FRAIS de l'index APRES le mock (sinon il garde le vrai engine).
    const { runPieux: runMocked } = await import('./index.js');

    // Anti faux-vert : le BRUT injecte fuit BIEN (sinon le test ne prouverait rien).
    expect(FUITE_BRUTE).toMatch(VALEUR_CONFIDENTIELLE);

    const fx0 = PIEUX_FIXTURES[0];
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
    for (const fx of PIEUX_FIXTURES) {
      const env = runPieux(fx.input);
      if (!env.ok) continue;
      const joined = [env.output.erreur ?? '', ...env.output.warnings].join(' || ');
      expect(joined, `fuite texte sur fixture ${fx.id}`).not.toMatch(
        VALEUR_CONFIDENTIELLE,
      );
    }
  });
});
