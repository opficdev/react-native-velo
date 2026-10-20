import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// TypeScript와 JavaScript만 검사한다. 네이티브 폴더는 각 언어의 린트가 맡고 생성 코드는 검사하지 않는다.
// 서식은 Prettier가 따로 검사하므로 ESLint의 서식 규칙은 eslint-config-prettier로 끈다.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'lib/**',
      'nitrogen/**',
      'android/**',
      'ios/**',
      'cpp/**',
      'example/android/**',
      'example/ios/**',
      'example/vendor/**',
      'example/producer/android/**',
      'example/producer/ios/**',
      'example/producer/nitrogen/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
  },
  {
    // Nitro 인터페이스 정의 파일은 기능이 없는 단계에서 HybridObject를 그대로 확장하는 빈 인터페이스를 허용한다.
    files: ['src/specs/*.nitro.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
    },
  },
  {
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  prettier,
);
