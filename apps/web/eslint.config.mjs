import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import { baseConfig, configFiles, zeroDataTransferRules } from '../../eslint.base.mjs';

export default [
  { ignores: ['.next/**', 'out/**', 'coverage/**', 'public/**', 'node_modules/**'] },
  ...baseConfig,

  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  {
    // A Regra de Ouro 1 vale para todo o codigo da aplicacao.
    files: ['src/**/*.{ts,tsx}'],
    rules: zeroDataTransferRules,
  },

  {
    // Rotas de API sao proibidas por construcao: `output: 'export'` ja as impede, e esta
    // regra falha antes, no arquivo, se alguem tentar cria-las.
    files: ['src/app/api/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Regra de Ouro 1: nao existem rotas de API neste produto. Todo o processamento e ' +
            'client-side, e nenhum PDF pode ser enviado a um servidor.',
        },
      ],
    },
  },

  {
    // Os testes E2E tem projeto TypeScript proprio: usam APIs de Node e os tipos do
    // Playwright, que nao cabem no tsconfig da aplicacao.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.e2e.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // A proibicao de rede nao se aplica ao codigo que verifica justamente a ausencia dela.
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },

  ...configFiles,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },

  {
    // Os verificadores rodam em Node, mas o corpo dos `page.evaluate` executa dentro do
    // WebView — entao esses arquivos contem, legitimamente, globais dos dois lados.
    files: ['scripts/verify-desktop.mjs', 'scripts/verify-android.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
