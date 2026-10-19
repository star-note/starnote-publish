import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Browser-safe sources (SPEC-r8 §13): only `node.ts` / `electron.ts` entries may reach runtime-specific modules.
    files: ['packages/**/src/**/*.ts'],
    ignores: ['packages/**/src/node.ts', 'packages/**/src/node/**', 'packages/**/src/electron.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: '浏览器入口不能引入 Node 模块；放到 ./node 子入口' },
            {
              group: ['electron', 'electron/*'],
              message: '浏览器入口不能引入 electron；放到 ./electron 子入口',
            },
          ],
          paths: [
            'fs',
            'path',
            'crypto',
            'os',
            'child_process',
            'http',
            'https',
            'stream',
            'url',
            'buffer',
          ],
        },
      ],
    },
  },
  prettier
);
