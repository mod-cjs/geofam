/**
 * Vitest — package @roadsen/shema partage (contrats Zod, utilitaires de test).
 * Strict : ce package CONTIENT des tests (temoin de determinisme, helpers).
 * Un run sans test ici serait une regression -> passWithNoTests = false.
 */
import { baseVitestConfig } from '../../vitest.shared.js';

export default baseVitestConfig({
  test: {
    passWithNoTests: false,
  },
});
