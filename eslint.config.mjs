// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,

  // ─── Base: lenguaje y resolución de tipos ───────────────────────────────
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
  },

  // ─── Hexagonal Architecture: boundaries entre capas ─────────────────────
  // Estructura esperada:
  //   src/modules/<module>/domain/       → solo entidades/errores/value objects puros
  //   src/modules/<module>/application/  → interfaces (puertos) + casos de uso
  //   src/modules/<module>/infrastructure/ → controllers, repos, adapters externos
  //   src/shared/domain/                 → tipos/errores compartidos
  //   src/shared/infrastructure/         → utilidades transversales (logger, crypto, etc.)
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        {
          type: 'domain',
          pattern: 'src/modules/*/domain/**/*',
          capture: ['moduleName'],
        },
        {
          type: 'application',
          pattern: 'src/modules/*/application/**/*',
          capture: ['moduleName'],
        },
        {
          type: 'infrastructure',
          pattern: 'src/modules/*/infrastructure/**/*',
          capture: ['moduleName'],
        },
        {
          type: 'shared-domain',
          pattern: 'src/shared/domain/**/*',
        },
        {
          type: 'shared-infrastructure',
          pattern: 'src/shared/infrastructure/**/*',
        },
      ],
      'boundaries/ignore': [
        '**/main.ts',
        '**/app.module.ts',
        '**/*.module.ts',
      ],
    },
    rules: {
      'boundaries/element-types': [
        'warn', // Cambiar a 'error' cuando el equipo esté acomodado
        {
          default: 'disallow',
          rules: [
            // domain: pureza total, solo se puede importar a sí mismo y shared-domain
            { from: ['domain'], allow: ['domain', 'shared-domain'] },
            // application: puede importar domain (ports/use-cases dependen de entidades)
            { from: ['application'], allow: ['domain', 'application', 'shared-domain'] },
            // infrastructure: puede usar todo (implementa los puertos de application)
            {
              from: ['infrastructure'],
              allow: [
                'domain',
                'application',
                'infrastructure',
                'shared-domain',
                'shared-infrastructure',
              ],
            },
            // shared-domain: solo sí mismo
            { from: ['shared-domain'], allow: ['shared-domain'] },
            // shared-infrastructure: shared-domain + sí mismo
            { from: ['shared-infrastructure'], allow: ['shared-domain', 'shared-infrastructure'] },
          ],
        },
      ],
    },
  },

  // ─── Reglas generales TypeScript ─────────────────────────────────────────
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'eqeqeq': ['warn', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      // Fuerza `import type` para imports solo de tipos (reduce coupling en runtime)
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
