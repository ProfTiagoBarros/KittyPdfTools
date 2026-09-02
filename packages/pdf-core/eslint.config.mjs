import globals from 'globals';
import { baseConfig, configFiles, zeroDataTransferRules } from '../../eslint.base.mjs';

/**
 * O nucleo nao conhece rede: as regras da Regra de Ouro 1 valem aqui sem excecao alguma.
 */
export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: zeroDataTransferRules,
  },
  ...configFiles,
  {
    // Scripts de build rodam em Node e podem baixar um asset uma unica vez, no build.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
];
