import globals from 'globals';
import { baseConfig, configFiles } from '../../eslint.base.mjs';

/**
 * Ferramenta de desenvolvimento, nao produto: le o git e dispara os testes. Nao acessa a rede, e
 * por isso nao herda as regras de Zero-Data Transfer — elas protegem o documento do usuario, que
 * nunca passa por aqui.
 */
export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  ...configFiles,
];
