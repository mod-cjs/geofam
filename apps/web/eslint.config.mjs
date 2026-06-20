import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Garde-fou de confidentialite ROADSEN (NON NEGOCIABLE — DoD §8, 1ere barriere).
 *
 * Les 6 moteurs de calcul sont confidentiels et ne doivent JAMAIS atteindre le
 * navigateur. apps/web ne peut donc importer ni @roadsen/engines ni le code
 * sous packages/engines, sous aucune forme. Toute tentative -> echec lint ->
 * echec CI -> pas de merge.
 *
 * Cette regle DOIT vivre ici (flat config ESLint 9) : apps/web utilise eslint@9
 * + eslint.config.mjs et IGNORE le .eslintrc.cjs racine (legacy ESLint 8). Sans
 * ce bloc, le garde-fou racine ne s applique pas au front (regression detectee
 * le 20/06/2026). La 2e barriere reste le controle de bundle CI.
 */
const ENGINE_IMPORT_GUARD = {
  patterns: [
    {
      group: ['@roadsen/engines', '@roadsen/engines/*', '**/packages/engines/**'],
      message:
        'CONFIDENTIALITE (DoD 8) : apps/web ne doit JAMAIS importer @roadsen/engines. ' +
        'Les moteurs s executent cote serveur uniquement (apps/api). ' +
        'Le front envoie des entrees et recoit des resultats via l API.',
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  // Garde-fou confidentialite moteurs -> front (voir en-tete).
  {
    rules: {
      'no-restricted-imports': ['error', ENGINE_IMPORT_GUARD],
    },
  },
]);

export default eslintConfig;
