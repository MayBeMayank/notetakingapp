module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'test', 'chore', 'docs']],
    'scope-enum': [2, 'always', ['auth', 'notes', 'tags', 'search', 'share', 'versions', 'shared', 'db', 'infra']],
    'scope-empty': [2, 'never'],
  },
}
