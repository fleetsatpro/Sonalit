// ESLint config for ai-copilot-svc.
//
// No v4 service had one, so `pnpm lint` failed repo-wide with "couldn't
// find an eslint.config.js" — the script existed but had never run.
//
// The .cjs extension is required: this package is "type": "module", and
// @sonalit/eslint-config is CommonJS, so a plain .js config is loaded as
// ESM and fails on `require`. The same file works for the sibling
// services, which share both traits.
const node = require('@sonalit/eslint-config/node');

module.exports = [
  ...node,
  {
    // tsconfig.json is rootDir-constrained to src for the build, so it
    // cannot include tests. This wider project covers both, and is what
    // `pnpm typecheck` uses too — otherwise test files are linted and
    // type-checked by nothing.
    languageOptions: {
      parserOptions: { project: ['./tsconfig.eslint.json'] },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.cjs'],
  },
];
