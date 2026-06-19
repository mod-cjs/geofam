/**
 * Configuration ESLint racine (monorepo).
 *
 * Regle de confidentialite ROADSEN (NON NEGOCIABLE) :
 *   les 6 moteurs de calcul sont confidentiels et ne doivent jamais
 *   atteindre le navigateur. Le package `@roadsen/engines` ne peut etre
 *   importe QUE par `apps/api`. Toute tentative d'import depuis `apps/web`
 *   (ou tout code front) est bloquee en lint -> echec CI -> pas de merge.
 *
 * Cette regle est un garde-fou structurel ; elle complete (mais ne remplace
 * pas) la separation par package et la revue `ingenieur-securite`.
 */

/** Cibles interdites pour le front (web). */
const ENGINE_IMPORT_GUARD = {
  patterns: [
    {
      group: ['@roadsen/engines', '@roadsen/engines/*', '**/packages/engines/**'],
      message:
        'CONFIDENTIALITE : apps/web ne doit JAMAIS importer @roadsen/engines. ' +
        'Les moteurs s executent cote serveur uniquement (apps/api). ' +
        'Le front envoie des entrees et recoit des resultats via l API.',
    },
  ],
};

module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: { project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
    },
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    '.next',
    'coverage',
    'build',
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'import/order': [
      'warn',
      { 'newlines-between': 'always', alphabetize: { order: 'asc' } },
    ],
  },
  overrides: [
    {
      /* Garde-fou confidentialite : tout le front. */
      files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
      rules: {
        'no-restricted-imports': ['error', ENGINE_IMPORT_GUARD],
      },
    },
    {
      /* Package partage : front + back -> ne doit pas tirer les moteurs. */
      files: ['packages/shared/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', ENGINE_IMPORT_GUARD],
      },
    },
    {
      /* Tests : on assouplit quelques regles bruyantes. */
      files: ['**/*.test.ts', '**/*.spec.ts', '**/*.e2e.ts', '**/tests/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
};
