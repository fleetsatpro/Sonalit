/** @type {import("prettier").Config} */
module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  proseWrap: 'preserve',
  overrides: [
    {
      files: ['*.yaml', '*.yml'],
      options: { singleQuote: false },
    },
    {
      files: ['*.md'],
      options: { proseWrap: 'always', printWidth: 80 },
    },
  ],
};
