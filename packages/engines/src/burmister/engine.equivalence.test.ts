/**
 * EQUIVALENCE-PORTAGE burmister : module TS extrait <-> reference DEFINITIVE (jsdom).
 *
 * @science-unsigned — prouve le PORTAGE (le module reproduit l'origine), PAS la
 * justesse scientifique (kit cas-tests STARFIRE indisponible, #36). MJ-6 : pas de
 * prod sans conformite.
 *
 * REFERENCE = DEFINITIVE (ADR 0013) : `loadOriginalCompute` resout la source via le
 * REGISTRE (`burmisterSourcePath`), qui pointe desormais la reference definitive
 * versionnee dans le depot (`packages/engines/reference/...`, sha256 42bb). C'est
 * donc contre la DEFINITIVE que l'equivalence-portage est prouvee — coherent avec la
 * production (100 % du trafic en definitive) et avec le golden navigateur.
 *
 * MODE PRODUCTION (`ifaceAuto:true`) : la definitive applique TOUJOURS la condition
 * d'interface automatique (Tab. 68) dans son calcul principal ; le front l'envoie
 * toujours. On aligne donc le pilotage HTML ET le module sur `ifaceAuto:true` (cf.
 * `toProduction`) — sinon le module resterait au chemin "collee" historique et
 * divergerait de la definitive sur les structures a couches rigides adjacentes
 * (semi-rigide, beton). `materialsRev` est inerte (table definitive unique).
 *
 * Methode : pour chaque jeu d'entrees, on pilote la reference via jsdon
 * (provenance 'HTML-origine' — voir loadOriginalCompute) ET le module TS, et on
 * compare les resultats BRUTS `_D` (tous champs, intermediaires compris) a une
 * tolerance de portage SERREE (rel 1e-9). Le harnais golden @roadsen/shared est
 * l'arbitre (anti auto-reference : provenance != module sous test).
 *
 * NORMALISATION : le resultat HTML traverse un aller-retour JSON (eval renvoie une
 * chaine). On impose au module la MEME serialisation (jsonRoundTrip) pour comparer
 * a perimetre identique (Infinity/NaN -> null, undefined omis) — sinon un Infinity
 * numerique cote module vs null cote HTML serait un FAUX ecart.
 *
 * GATE : la reference definitive est VERSIONNEE dans le depot (presente y compris en
 * CI). Le SKIP BRUYANT ci-dessous ne se declenche donc en principe jamais ; il reste
 * comme filet anti faux-vert (si le fichier venait a manquer, ECHEC visible, pas de
 * vert a vide). « 0 cas execute » (fichier present mais aucun cas) serait un echec :
 * on l'assert.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeBurmister } from './engine.js';
import {
  burmisterSourceAvailable,
  jsonRoundTrip,
  loadOriginalCompute,
  sanitizeResult,
} from './equivalence-harness.js';
import { BURMISTER_FIXTURES, type BurmisterFixture } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister';
/** Tolerance de PORTAGE serree : module et origine sont le MEME code, on vise l'egalite. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

/**
 * MODE PRODUCTION (ADR 0013) : force `ifaceAuto:true` sur la charge d'une fixture,
 * pour le PILOTAGE HTML (la definitive applique deja l'interface auto) ET le module
 * (qui sinon resterait au chemin collee historique). Le MEME objet est passe aux
 * deux cotes -> comparaison a chemin d'interface identique.
 */
const toProduction = (fx: BurmisterFixture): BurmisterFixture => ({
  ...fx,
  input: { ...fx.input, load: { ...fx.input.load, ifaceAuto: true } },
});

const SOURCE_OK = burmisterSourceAvailable();

describe('burmister — equivalence-portage module <-> HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[ADR 0013] AVERTISSEMENT : reference roadsens_burmister_definitive.html ABSENTE ' +
      '(packages/engines/reference/ — normalement VERSIONNEE dans le depot). ' +
      'L equivalence-portage N A PAS ete verifiee. Ce skip n est PAS un succes ' +
      '(la reference doit etre presente y compris en CI).';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  // On charge le moteur d'origine UNE fois (jsdom couteux). cleanup en fin de suite.
  const { computeHtml, cleanup } = loadOriginalCompute();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares. Fixtures en
  // MODE PRODUCTION (ifaceAuto:true) — cf. toProduction / ADR 0013.
  const cmpFixtures = BURMISTER_FIXTURES.filter((f) => !f.horsDomaine).map(toProduction);
  const horsDomaine = BURMISTER_FIXTURES.filter((f) => f.horsDomaine).map(toProduction);

  it('compare AU MOINS 10 jeux d entrees nominaux/bornes (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('couvre au moins un cas HORS-DOMAINE', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // REFERENCE : _D BRUT du HTML d'origine (provenance externe au module).
      const reference = sanitizeResult(computeHtml(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-origine',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      // run = module TS extrait. MEME normalisation (jsonRoundTrip puis sanitize)
      // que la reference (qui a deja traverse un JSON via eval).
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(jsonRoundTrip(computeBurmister(inputs))),
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
          `Ecart de PORTAGE sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  for (const fx of horsDomaine) {
    it(`[${fx.id}] resultat IDENTIQUE origine/module — ${fx.description}`, () => {
      // Cas hors-domaine : selon le materiau, le HTML peut soit lever (capture en
      // { err }), soit produire un _D degenere. Dans les DEUX cas, le module doit
      // se comporter A L'IDENTIQUE. On compare donc le resultat complet (sanitise).
      const ref = sanitizeResult(computeHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computeBurmister(fx.input)));
      expect(mod).toEqual(ref);
    });
  }

  // Liberation jsdom (apres definition des tests ; appel synchrone au teardown).
  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
