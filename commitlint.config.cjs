/**
 * Commits conventionnels (Conventional Commits).
 * Format : type(scope): sujet     ex. feat(api): ajoute le recalcul Burmister
 *
 * Scopes usuels ROADSEN : api, web, engines, shared, ci, infra, db, deps, docs.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      1,
      'always',
      ['api', 'web', 'engines', 'shared', 'ci', 'infra', 'db', 'deps', 'docs', 'release'],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
