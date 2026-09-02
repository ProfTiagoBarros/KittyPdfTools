import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Base compartilhada pelos pacotes do monorepo.
 *
 * As regras com análise de tipos existem para pegar o que o `tsc` não pega: promessa não
 * aguardada, `any` atravessando fronteira, condição sempre verdadeira. Num produto cheio de
 * operação assíncrona em worker, promessa esquecida é a classe de defeito mais provável.
 */
export const baseConfig = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Uma promessa esquecida num worker vira operação que nunca termina, sem erro visível.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // O parâmetro não usado é sinal de intenção incompleta; o prefixo `_` diz que é de propósito.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Conversões perigosas com `as` são o caminho por onde tipo errado atravessa a fronteira
      // do worker. Onde forem inevitáveis, ficam com comentário explicando o porquê.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },
);

/**
 * Arquivos de configuração e scripts de build ficam fora do projeto TypeScript, então as
 * regras com análise de tipos não têm o que analisar neles.
 */
export const configFiles = tseslint.config({
  files: ['**/*.config.{mjs,mts,ts}', '**/eslint.config.mjs', 'scripts/**/*.mjs'],
  extends: [tseslint.configs.disableTypeChecked],
});

/**
 * Regras que impõem a Regra de Ouro 1 (Zero-Data Transfer).
 *
 * Até agora a promessa de privacidade dependia de disciplina e de um teste E2E que verifica
 * ausência de requisições externas. O teste continua valendo, mas ele acusa tarde e sem dizer
 * onde. Estas regras falham no arquivo e na linha em que a violação foi escrita.
 */
export const zeroDataTransferRules = {
  'no-restricted-globals': [
    'error',
    {
      name: 'fetch',
      message:
        'Regra de Ouro 1: nenhum payload do usuário pode deixar o cliente. Buscar assets ' +
        'locais também é proibido aqui — eles são copiados para public/ no build.',
    },
    {
      name: 'XMLHttpRequest',
      message: 'Regra de Ouro 1: nenhum payload do usuário pode deixar o cliente.',
    },
    {
      name: 'WebSocket',
      message: 'Regra de Ouro 1: nenhum payload do usuário pode deixar o cliente.',
    },
    {
      name: 'EventSource',
      message: 'Regra de Ouro 1: nenhum payload do usuário pode deixar o cliente.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      // Endereço de terceiro em literal denuncia CDN, telemetria ou serviço externo. Assets
      // precisam ser servidos pela própria aplicação (Regra de Ouro 4, offline no Desktop).
      selector: 'Literal[value=/^https?:\\/\\/(?!127\\.0\\.0\\.1|localhost)/]',
      message:
        'Regra de Ouro 1 e 4: nada de CDN ou serviço externo. Assets vão para public/ pelo ' +
        'script de sincronização, e são servidos pela própria aplicação.',
    },
  ],
};
