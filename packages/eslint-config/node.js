// @ts-check
const base = require('./index.js');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...base,
  {
    files: ['**/*.{ts,js,mjs,cjs}'],
    rules: {
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-process-exit': 'error',
    },
  },
];
