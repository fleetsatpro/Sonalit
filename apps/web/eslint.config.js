import react from '@sonalit/eslint-config/react';

export default [
  ...react,
  { ignores: ['dist/**', 'public/**'] },
];
