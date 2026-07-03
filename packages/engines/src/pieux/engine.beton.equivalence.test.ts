/**
 * EQUIVALENCE-PORTAGE de la VERIFICATION STRUCTURALE DU BETON (§4.4, #95) : module TS
 * extrait (computeBeton) <-> HTML d'origine (betonCheck() piloté via jsdom, capturé
 * par interception de drawBeton).
 *
 * C'EST LA PREUVE que notre port de la vérification structurale == l'outil STARFIRE
 * validé. Science SIGNÉE (STARFIRE a validé les moteurs) : une extraction FIDELE
 * prouvée par cette équivalence (rel 1e-9) est science-signée — ce test est
 * OBLIGATOIRE et doit être VERT. Sans lui, la revendication de fidélité tombe.
 *
 * Méthode : pour chaque jeu d'entrées, on pilote le HTML d'ORIGINE via jsdom
 * (référence, provenance 'HTML-origine' — compute() calcule la portance PUIS appelle
 * `drawBeton(betonCheck(pile, Ab, FduELU, FdCar, traction))`, qu'on intercepte, cf.
 * loadOriginalBeton) ET le module TS (computeBeton), et on compare les objets BRUTS
 * retournés par betonCheck (TOUS champs : na/reason OU Cmax/k1/k2/fck/fckStar/acc/k3/
 * gc/fcd/sELU/sELS/limELS/okELU/okELS/tauxELU/tauxELS) à une tolérance de portage
 * SERRÉE (rel 1e-9). Le harnais golden @roadsen/shared est l'arbitre (anti
 * auto-référence : provenance != module sous test).
 *
 * NORMALISATION : le résultat HTML traverse un aller-retour JSON (eval renvoie une
 * chaîne). On impose au module la MÊME sérialisation (jsonRoundTrip) pour comparer à
 * périmètre identique (Infinity/NaN -> null, undefined/fonctions omis).
 *
 * GATE LOCAL : les sources moteur sont HORS dépôt git (03-Moteurs-client). En CI elles
 * sont absentes -> SKIP BRUYANT (jamais un faux-vert). « 0 cas exécuté » localement
 * (sources présentes mais aucun cas comparé) serait un échec : on l'assert (>= 8).
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeBeton } from './engine.js';
import {
  jsonRoundTrip,
  loadOriginalBeton,
  pieuxRegistrySha256,
  pieuxSourceAvailable,
  pieuxSourceSha256,
  sanitizeResult,
} from './equivalence-harness.js';
import { PIEUX_BETON_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'fondation-profonde-pieux';
/** Tolérance de PORTAGE serrée : module et origine sont le MÊME code, on vise l'égalité. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = pieuxSourceAvailable();

describe('pieux — équivalence-portage VÉRIFICATION BÉTON module <-> HTML d origine (#95)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#95] AVERTISSEMENT : source casagrande_V5.html ABSENTE ' +
      '(03-Moteurs-client/ hors depot git). L equivalence-portage beton N A PAS ete ' +
      'verifiee — gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage beton NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  // On charge le moteur d'origine UNE fois (jsdom coûteux). cleanup en fin de suite.
  const { computeBetonHtml, cleanup } = loadOriginalBeton();

  const cmpFixtures = PIEUX_BETON_FIXTURES.filter((f) => !f.horsDomaine);
  const horsDomaine = PIEUX_BETON_FIXTURES.filter((f) => f.horsDomaine);

  // Un cas béton est NUMÉRIQUE (verdict f_cd/σ/taux -> tolérance rel 1e-9 via le golden
  // runner) ou NON APPLICABLE (na:true : compression non gouvernante en traction, ou
  // catégorie hors Tableau 12 -> pas de valeur numérique, comparaison stricte na+reason).
  // On DÉRIVE la nature de chaque cas de la RÉFÉRENCE HTML (pas d'une étiquette de
  // fixture) : c'est l'origine qui décide si betonCheck a calculé ou renvoyé na:true.
  const isNa = (ref: unknown): boolean =>
    ref !== null &&
    typeof ref === 'object' &&
    (ref as Record<string, unknown>).na === true;

  const references = cmpFixtures.map((fx) => ({
    fx,
    ref: sanitizeResult(computeBetonHtml(fx.input)) as Record<string, unknown>,
  }));
  const numeric = references.filter((r) => !isNa(r.ref));
  const naCases = references.filter((r) => isNa(r.ref));

  // Filet anti faux-vert : on EXIGE >= 8 cas NUMÉRIQUES effectivement comparés à la
  // tolérance rel 1e-9 (« 0 cas = rouge » ; un na:true ne prouve aucune grandeur calée).
  it('compare AU MOINS 8 jeux béton NUMÉRIQUES (verdict f_cd/σ/taux, rel 1e-9)', () => {
    expect(numeric.length).toBeGreaterThanOrEqual(8);
  });

  it('couvre au moins 2 cas NON APPLICABLES (na:true — traction et catégorie hors map)', () => {
    expect(naCases.length).toBeGreaterThanOrEqual(2);
  });

  it('couvre au moins un cas HORS-DOMAINE (garde D <= z0)', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  it('le SHA-256 de la source testée == sha256 scellé au registre (pas un autre moteur)', () => {
    expect(pieuxSourceSha256()).toBe(pieuxRegistrySha256());
  });

  for (const { fx } of numeric) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // RÉFÉRENCE : objet BRUT de betonCheck du HTML d'origine (provenance externe).
      const reference = sanitizeResult(computeBetonHtml(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-origine',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      // run = module TS extrait. MÊME normalisation (jsonRoundTrip puis sanitize) que
      // la référence (qui a déjà traversé un JSON via eval).
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(jsonRoundTrip(computeBeton(inputs))),
      );
      if (!result.equal) {
        const lignes = result.diffs
          .map(
            (d: { path: string; expected: unknown; actual: unknown; reason: string }) =>
              `  - ${d.path || '(racine)'} : origine=${JSON.stringify(d.expected)} ` +
              `module=${JSON.stringify(d.actual)} [${d.reason}]`,
          )
          .join('\n');
        throw new Error(
          `Écart de PORTAGE béton sur "${fx.id}" (défaut d intégration, à NOTRE charge) :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  for (const { fx } of naCases) {
    it(`[${fx.id}] na:true IDENTIQUE origine/module (na + reason verbatim) — ${fx.description}`, () => {
      // betonCheck renvoie { na:true, reason:<texte> } (aucune grandeur numérique) : on
      // compare STRICTEMENT l'objet (drapeau + texte du motif, transcrit verbatim).
      const ref = sanitizeResult(computeBetonHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computeBeton(fx.input)));
      expect(mod).toEqual(ref);
      // Sanity : c'est bien un na:true (pas un cas numérique masqué).
      expect((ref as Record<string, unknown>).na).toBe(true);
    });
  }

  for (const fx of horsDomaine) {
    it(`[${fx.id}] résultat IDENTIQUE origine/module (garde) — ${fx.description}`, () => {
      // Cas hors-domaine : compute() renvoie renderResults({err}) et RETOURNE avant
      // betonCheck (drawBeton non appelé) ; le harnais renvoie { err }. Le module
      // renvoie { err } avec le MÊME texte (court-circuit de portance).
      const ref = sanitizeResult(computeBetonHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computeBeton(fx.input)));
      expect(mod).toEqual(ref);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
