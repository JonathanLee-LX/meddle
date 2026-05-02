import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'web', 'node_modules']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      // Project uses CommonJS — require() is intentional
      '@typescript-eslint/no-require-imports': 'off',
      // Too many existing instances to fix at once; demote to warn
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow _ prefix convention for intentionally unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Demote noisy style rules to warn for gradual improvement
      'prefer-const': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
    },
  },
])
