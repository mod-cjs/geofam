/**
 * EQUIVALENCE-PORTAGE du FROTTEMENT NEGATIF (downdrag, #94) : module TS extrait
 * (computeDowndrag) <-> HTML d'origine (computeDowndrag() piloté via jsdom).
 *
 * C'EST LA PREUVE que notre port du frottement négatif == l'outil STARFIRE validé.
 * Science SIGNÉE (STARFIRE a validé les moteurs) : une extraction FIDELE prouvée par
 * cette équivalence (rel 1e-9) est science-signée — ce test est OBLIGATOIRE et doit
 * être VERT. Sans lui, la revendication de fidélité tombe.
 *
 * Méthode : pour chaque jeu d'entrées, on pilote le HTML d'ORIGINE via jsdom
 * (référence, provenance 'HTML-origine' — interception de `drawDowndrag(prof, m)`,
 * cf. loadOriginalDowndrag) ET le module TS (computeDowndrag), et on compare les
 * objets BRUTS mis à plat `{ prof, ...m }` (tous champs : profil segment par segment
 * `prof[]`, efforts, rigidités, point neutre zN, Gsn, Nmax...) à une tolérance de
 * portage SERRÉE (rel 1e-9). Le harnais golden @roadsen/shared est l'arbitre (anti
 * auto-référence : provenance != module sous test).
 *
 * NORMALISATION : le résultat HTML traverse un aller-retour JSON (eval renvoie une
 * chaîne). On impose au module la MÊME sérialisation (jsonRoundTrip) pour comparer à
 * périmètre identique (Infinity/NaN -> null, undefined/fonctions omis).
 *
 * GATE LOCAL : les sources moteur sont HORS dépôt git (03-Moteurs-client). En CI elles
 * sont absentes -> SKIP BRUYANT (jamais un faux-vert). « 0 cas exécuté » localement
 * (sources présentes mais aucun cas comparé) serait un échec : on l'assert.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeDowndrag } from './engine.js';
import {
  jsonRoundTrip,
  loadOriginalDowndrag,
  pieuxRegistrySha256,
  pieuxSourceAvailable,
  pieuxSourceSha256,
  sanitizeResult,
} from './equivalence-harness.js';
import { PIEUX_DOWNDRAG_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'fondation-profonde-pieux';
/** Tolérance de PORTAGE serrée : module et origine sont le MÊME code, on vise l'égalité. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = pieuxSourceAvailable();

describe('pieux — équivalence-portage FROTTEMENT NÉGATIF module <-> HTML d origine (#94)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#94] AVERTISSEMENT : source casagrande_V5.html ABSENTE ' +
      '(03-Moteurs-client/ hors depot git). L equivalence-portage downdrag N A PAS ete ' +
      'verifiee — gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage downdrag NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  // On charge le moteur d'origine UNE fois (jsdom coûteux). cleanup en fin de suite.
  const { computeDowndragHtml, cleanup } = loadOriginalDowndrag();

  const cmpFixtures = PIEUX_DOWNDRAG_FIXTURES.filter((f) => !f.horsDomaine);
  const horsDomaine = PIEUX_DOWNDRAG_FIXTURES.filter((f) => f.horsDomaine);

  // Filet anti faux-vert : on EXIGE >= 8 cas effectivement comparés (« 0 cas = rouge »).
  it('compare AU MOINS 8 jeux d entrées downdrag (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(8);
  });

  it('couvre au moins un cas HORS-DOMAINE (garde D <= z0)', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  it('le SHA-256 de la source testée == sha256 scellé au registre (pas un autre moteur)', () => {
    expect(pieuxSourceSha256()).toBe(pieuxRegistrySha256());
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // RÉFÉRENCE : objet BRUT { prof, ...m } du HTML d'origine (provenance externe).
      const reference = sanitizeResult(computeDowndragHtml(fx.input));
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
        sanitizeResult(jsonRoundTrip(computeDowndrag(inputs))),
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
          `Écart de PORTAGE downdrag sur "${fx.id}" (défaut d intégration, à NOTRE charge) :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  for (const fx of horsDomaine) {
    it(`[${fx.id}] résultat IDENTIQUE origine/module (garde) — ${fx.description}`, () => {
      // Cas hors-domaine : le HTML pose host.innerHTML (garde) ; le harnais renvoie le
      // texte de la carte en { err }. Le module renvoie { err } avec le MÊME texte.
      const ref = sanitizeResult(computeDowndragHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computeDowndrag(fx.input)));
      expect(mod).toEqual(ref);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
