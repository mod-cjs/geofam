import { LABO_FIXTURES } from '@roadsen/engines';

/**
 * Branche ok:false / SafeEngineError du LaboController (#49-53, leçon MINEUR-2 de #48).
 *
 * Le moteur est DEFENSIF : `computeLabo` enveloppe tout dans un try/catch et renvoie
 * `{ err }` ; la projection coerce. Une entree VALIDE ne peut donc PAS faire lever
 * `runLabo` par le chemin HTTP normal. Pour COUVRIR le code anti-fuite, on mocke
 * `@roadsen/engines` pour forcer `runLabo` a LEVER, et on verifie le mapping
 * SafeEngineError SANS fuite (ni stack, ni texte libre).
 */
jest.mock('@roadsen/engines', () => {
  const actual =
    jest.requireActual<typeof import('@roadsen/engines')>('@roadsen/engines');
  return {
    ...actual,
    runLabo: jest.fn(() => {
      throw new Error(
        'Echec interne moteur: stack interne /src/labo/engine.ts:512',
      );
    }),
  };
});

import { LaboController } from '../src/calc/labo.controller';

describe('LaboController — branche SafeEngineError (anti-fuite, MINEUR-2)', () => {
  it('mappe une exception moteur en enveloppe ok:false bornee, sans fuite', () => {
    const controller = new LaboController();
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;

    const env = controller.labo(fx.input);

    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.meta.engineId).toBe('labo-classification-gtr');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const serialized = JSON.stringify(env.error);
    expect(typeof env.error.code).toBe('string');
    expect(serialized).not.toMatch(/stack|engine\.ts|\/src\//i);
  });
});
