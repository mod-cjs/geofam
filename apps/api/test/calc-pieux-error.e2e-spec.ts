import { PIEUX_FIXTURES } from '@roadsen/engines';

/**
 * Branche ok:false / SafeEngineError du PieuxController (#48, MINEUR-2 du challenge).
 *
 * --- POURQUOI ce test mocke runPieux (honnetete) ---
 * Le moteur pieux est DEFENSIF : `computePieux` enveloppe tout dans un try/catch et
 * renvoie `{ err }` (jamais une exception) ; `shapeOutput`/`projectEngineOutput`
 * COERCENT toute valeur non conforme (fin()->0). Une entree VALIDE au schema ne peut
 * donc PAS faire lever `runPieux` par le chemin HTTP normal — la branche catch du
 * controleur est inatteignable via un simple POST valide (c'est en soi un constat de
 * robustesse). Pour COUVRIR malgre tout ce code anti-fuite (exigence MINEUR-2), on
 * mocke `@roadsen/engines` pour forcer `runPieux` a LEVER, et on verifie le mapping
 * SafeEngineError SANS fuite (ni stack, ni intermediaire, ni texte libre du message
 * d'origine). C'est la branche reelle du controleur (try/catch), exercee directement.
 *
 * NB : fichier en `.e2e-spec.ts` car seule la config jest-e2e mappe `@roadsen/engines`
 * vers la source (la config unit ne resout pas ce package ESM). On n'instancie QUE le
 * controleur (pas d'AppModule) : aucune base requise.
 */
jest.mock('@roadsen/engines', () => {
  const actual =
    jest.requireActual<typeof import('@roadsen/engines')>('@roadsen/engines');
  return {
    ...actual,
    runPieux: jest.fn(() => {
      // Exception PORTEUSE d'un secret + d'un intermediaire (ce qui NE doit PAS fuiter).
      throw new Error(
        'Echec interne moteur: qb=4200 kPa, ple=1.8 MPa, stack interne /src/pieux/engine.ts:512',
      );
    }),
  };
});

import { PieuxController } from '../src/calc/pieux.controller';

describe('PieuxController — branche SafeEngineError (anti-fuite, MINEUR-2)', () => {
  it('mappe une exception moteur en enveloppe ok:false bornee, sans fuite', () => {
    const controller = new PieuxController();
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
    expect(fx).toBeDefined();
    if (!fx) return;

    // Le body est deja valide (la validation Zod du pipe est testee en e2e HTTP) ;
    // ici on exerce la branche catch : runPieux (mocke) leve.
    const env = controller.pieux(fx.input);

    expect(env.ok).toBe(false);
    if (env.ok) return;
    // Meta de version reelle conservee (tracabilite PV).
    expect(env.meta.engineId).toBe('fondation-profonde-pieux');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Erreur BORNEE : un code d'enumeration, aucun detail/stack/intermediaire.
    const serialized = JSON.stringify(env.error);
    expect(typeof env.error.code).toBe('string');
    expect(serialized).not.toMatch(/stack|engine\.ts|\/src\//i);
    expect(serialized).not.toMatch(/qb|ple|4200|1\.8/);
  });
});
