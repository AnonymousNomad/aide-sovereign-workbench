import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'desktop/',
      'dist/',
      'models/',
      'coverage/',
      '**/*.mjs',
      'app.js',
      'fixtures/'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['browser/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fs', 'child_process', 'path', 'os', 'node:*'],
              message: 'browser code must not import Node builtins (renderer rule)'
            }
          ]
        }
      ]
    }
  }
);