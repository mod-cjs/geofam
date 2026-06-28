import { RADIER_FIXTURES } from '@roadsen/engines';

/**
 * Branche ok:false / SafeEngineError du RadierController (#54, leçon MINEUR-2 de #48).
 *
 * --- POURQUOI ce test mocke runRadier (honnetete) ---
 * Le moteur radier est DEFENSIF : `computeRadier` enveloppe tout dans un try/catch et
 * renvoie `{ err }` (jamais une exception) ; `shapeOutput`/`projectEngineOutput`
 * COERCENT toute valeur non conforme. Une entree VALIDE au schema ne peut donc PAS faire
 * lever `runRadier` par le chemin HTTP normal — la branche catch du controleur est
 * inatteignable via un POST valide. Pour COUVRIR ce code anti-fuite, on mocke
 * `@roadsen/engines` pour forcer `runRadier` a LEVER, et on verifie le mapping
 * SafeEngineError SANS fuite (ni stack, ni intermediaire EF, ni texte libre).
 *
 * NB : fichier en `.e2e-spec.ts` car seule la config jest-e2e mappe `@roadsen/engines`
 * vers la source. On n'instancie QUE le controleur (pas d'AppModule) : aucune base requise.
 */
jest.mock('@roadsen/engines', () => {
  const actual =
    jest.requireActual<typeof import('@roadsen/engines')>('@roadsen/engines');
  return {
    ...actual,
    runRadier: jest.fn(() => {
      // Exception PORTEUSE d'un secret + d'un intermediaire EF (ce qui NE doit PAS fuiter).
      throw new Error(
        'Echec interne solveur: w[12]=0.041 m, kr=18500 kN/m³, stack /src/radier/engine.ts:512',
      );
    }),
  };
});

import { RadierController } from '../src/calc/radier.controller';

describe('RadierController — branche SafeEngineError (anti-fuite, MINEUR-2)', () => {
  it('mappe une exception moteur en enveloppe ok:false bornee, sans fuite', () => {
    const controller = new RadierController();
    const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-charge-centree');
    expect(fx).toBeDefined();
    if (!fx) return;

    const env = controller.radier(fx.input);

    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.meta.engineId).toBe('radier-plaque');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const serialized = JSON.stringify(env.error);
    expect(typeof env.error.code).toBe('string');
    expect(serialized).not.toMatch(/stack|engine\.ts|\/src\//i);
    expect(serialized).not.toMatch(/w\[12\]|kr|18500|0\.041/);
  });
});
