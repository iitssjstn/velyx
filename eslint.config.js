import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'backend/drizzle/**', 'cloud/drizzle/**', 'app/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['backend/**/*.ts', 'cloud/**/*.ts', 'scripts/**/*.mjs', 'frontend/scripts/**/*.mjs', 'backend/scripts/**/*.mjs', 'cloud/scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/public/offline.js', 'cloud/web/account.js', 'cloud/web/ceo.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    files: ['frontend/public/sw.js'],
    languageOptions: { globals: globals.serviceworker, sourceType: 'script' },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
