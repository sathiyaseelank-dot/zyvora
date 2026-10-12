import js from '@eslint/js';
import globals from 'globals';

/**
 * Globals come from the `globals` package rather than a hand-maintained list.
 * The hand list silently omitted modern web APIs (AbortSignal, AbortController,
 * URLSearchParams, Response), which produced spurious `no-undef` errors that
 * had to be patched one symbol at a time.
 */
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: (await import('typescript-eslint')).parser,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': (await import('typescript-eslint')).plugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // JSX parsing for the React surfaces.
    files: ['**/*.{ts,tsx,jsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
