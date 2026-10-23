/**
 * FONTE UNICA da rastreabilidade: requisito -> funcionalidade -> codigo -> testes.
 *
 * Toda vez que um arquivo nasce, muda de lugar ou ganha um teste, ESTE arquivo muda junto — e o
 * teste de integridade (`integridade.test.ts`) falha ate que mude. A pagina em
 * `docs/rastreabilidade.html` e o `docs/RASTREABILIDADE.md` sao gerados daqui
 * (`pnpm rastreabilidade`); nunca edite os gerados a mao.
 *
 * Regra de dono unico: cada arquivo de produto pertence a EXATAMENTE um item. Se dois itens
 * parecem donos do mesmo arquivo, o arquivo esta fazendo duas coisas — e o sinal de que ele
 * precisa ser dividido, nao de que a regra deve ceder.
 */
import type { Componente, Funcionalidade, Matriz, Requisito, Testes } from './modelo.ts';

const WEB = 'apps/web/src';
const CORE = 'packages/pdf-core/src';
const E2E = 'apps/web/e2e';
const PLUGIN = 'apps/desktop/plugins/saf-save';
const TAURI = 'apps/desktop/src-tauri';

function testes(
  unitarios: readonly string[] = [],
  e2e: readonly string[] = [],
  nativos: readonly string[] = [],
): Testes {
  return { unitarios, e2e: e2e.map((spec) => `${E2E}/${spec}`), nativos };
}

// ------------------------------------------------------------------------------- requisitos

const requisitos: readonly Requisito[] = [
  {
    id: 'US-01',
    titulo: 'Organizacao de paginas',
    restricao: 'Multi-arquivo; mesclar paginas ENTRE PDFs; reordenar por arraste E por botao.',
  },
  {
    id: 'US-02',
    titulo: 'Fusao, divisao e extracao',
    restricao: 'Extrair entrega 1 arquivo; dividir entrega varios num pacote; a selecao da grade preenche o campo.',
  },
  {
    id: 'US-03',
    titulo: 'Ofuscacao',
    restricao: 'Remover do content stream, irreversivel. Retangulo preto nao e ofuscacao.',
  },
  {
    id: 'US-04',
    titulo: 'OCR local',
    restricao: 'Tesseract em worker, PT-BR, barra de progresso obrigatoria.',
  },
  {
    id: 'US-05',
    titulo: 'Assinatura ICP-Brasil',
    restricao: 'A1 .pfx so em memoria; chave nunca persistida, logada ou transmitida.',
  },
  {
    id: 'US-06',
    titulo: 'Busca de campo aberto',
    restricao: 'Destaca (nao filtra) paginas com pelo menos uma ocorrencia, entre PDFs distintos.',
  },
  {
    id: 'US-07',
    titulo: 'Compactar',
    restricao: 'Sem perda ou forte; avisar antes de degradar; alvo de tamanho; avisar quando crescer.',
  },
  {
    id: 'US-08',
    titulo: 'Lupa na pagina',
    restricao: 'Ler nome e matricula sem gerar o PDF; navega e reordena; segue a chave, nao a posicao.',
  },
  {
    id: 'RNF-01',
    titulo: 'Zero-Data Transfer',
    restricao: 'Nenhum byte de documento sai do aparelho. Android sem a permissao INTERNET.',
  },
  {
    id: 'RNF-02',
    titulo: 'Processamento em workers',
    restricao: 'Trabalho pesado fora da main thread, com progresso e buffers transferidos.',
  },
  {
    id: 'RNF-03',
    titulo: 'Orcamento de memoria',
    restricao: 'Caber em ~2 GB por processo (Windows 32 bits): tela e workers dividem o processo.',
  },
  {
    id: 'RNF-04',
    titulo: 'Offline-first',
    restricao: 'Fontes, workers, wasm e traineddata viajam no pacote.',
  },
  {
    id: 'RNF-05',
    titulo: 'Internacionalizacao',
    restricao: 'Sem texto fixo na interface; dicionarios completos; erros traduzidos por codigo.',
  },
];

// ------------------------------------------------------------------------------- componentes

const componentes: readonly Componente[] = [
  {
    id: 'C-NUCLEO',
    nome: 'Nucleo de PDF: erros, API e utilitarios',
    descricao:
      'Taxonomia de erros por codigo, a API publica do pdf-core, geometria, cessao do laco de eventos e fixtures.',
    arquivos: [
      `${CORE}/errors.ts`,
      `${CORE}/index.ts`,
      `${CORE}/geometry.ts`,
      `${CORE}/async.ts`,
      `${CORE}/fixtures.ts`,
    ],
    usa: [],
    testes: testes([`${WEB}/i18n/__tests__/core-errors.test.ts`]),
    requisitos: ['RNF-05'],
    verificacaoManual: [],
  },
  {
    id: 'C-COMPOSICAO',
    nome: 'Composicao de paginas (pdf-lib)',
    descricao: 'Materializa a lista de paginas num PDF, carregando uma origem por vez.',
    arquivos: [`${CORE}/composition/**`],
    usa: ['C-NUCLEO'],
    testes: testes([`${CORE}/composition/build.test.ts`]),
    requisitos: ['RNF-03'],
    verificacaoManual: [],
  },
  {
    id: 'C-VERIFICACAO',
    nome: 'Verificacao de vazamento',
    descricao: 'Extrai texto e procura bytes num PDF: e como se prova que uma ofuscacao e real.',
    arquivos: [`${CORE}/verification/**`, `${CORE}/browser/verification.ts`],
    usa: ['C-NUCLEO'],
    testes: testes([], ['redaction-worker.spec.ts']),
    requisitos: [],
    verificacaoManual: [],
  },
  {
    id: 'C-MENSAGENS',
    nome: 'Envelope de mensagens entre threads',
    descricao: 'Formato comum das mensagens dos workers, transporte de erros por codigo e de buffers.',
    arquivos: [`${WEB}/workers/messages.ts`],
    usa: ['C-NUCLEO'],
    testes: testes([`${WEB}/workers/__tests__/messages.test.ts`]),
    requisitos: ['RNF-02'],
    verificacaoManual: [],
  },
  {
    id: 'C-RENDERIZACAO',
    nome: 'Renderizacao (pdf.js)',
    descricao:
      'Worker que desenha paginas, extrai texto, rasteriza e orquestra ofuscar, OCR e compactar; cliente com cache LRU e liberacao de memoria.',
    arquivos: [
      `${WEB}/workers/render-client.ts`,
      `${WEB}/workers/render-protocol.ts`,
      `${WEB}/workers/render.worker.ts`,
      `${CORE}/browser/index.ts`,
      `${CORE}/browser/pdfjs-setup.ts`,
      `${CORE}/browser/renderer.ts`,
      'packages/pdf-core/scripts/copy-pdfjs-assets.mjs',
    ],
    usa: ['C-MENSAGENS', 'C-NUCLEO'],
    testes: testes([], ['workspace.spec.ts', 'preview.spec.ts']),
    requisitos: ['RNF-02', 'RNF-03', 'RNF-04'],
    verificacaoManual: ['verify:desktop -> CARREGAR, LUPA', 'verify:android -> CARREGAR, LUPA'],
  },
  {
    id: 'C-DOCUMENTOS',
    nome: 'Worker de documentos (pdf-lib)',
    descricao: 'Dono dos bytes de cada arquivo aberto: compoe, extrai e divide.',
    arquivos: [
      `${WEB}/workers/documents-client.ts`,
      `${WEB}/workers/documents-protocol.ts`,
      `${WEB}/workers/documents.worker.ts`,
    ],
    usa: ['C-MENSAGENS', 'C-COMPOSICAO', 'C-NUCLEO'],
    testes: testes([], ['documents-worker.spec.ts']),
    requisitos: ['RNF-02', 'RNF-03'],
    verificacaoManual: [],
  },
  {
    id: 'C-ESTADO',
    nome: 'Estado da composicao',
    descricao: 'Modelo puro da grade e store Zustand: paginas, selecao, historico de desfazer.',
    arquivos: [`${WEB}/workspace/model.ts`, `${WEB}/workspace/store.ts`],
    usa: [],
    testes: testes([`${WEB}/workspace/store.test.ts`]),
    requisitos: [],
    verificacaoManual: [],
  },
  {
    id: 'C-I18N',
    nome: 'Internacionalizacao',
    descricao: 'Dicionarios, deteccao de idioma e traducao de erros do nucleo.',
    arquivos: [
      `${WEB}/i18n/core-errors.ts`,
      `${WEB}/i18n/index.ts`,
      `${WEB}/i18n/locale-hydrator.tsx`,
      `${WEB}/i18n/messages/**`,
      `${WEB}/i18n/registry.ts`,
      `${WEB}/i18n/store.ts`,
      `${WEB}/i18n/use-translation.ts`,
    ],
    usa: ['C-NUCLEO'],
    testes: testes([
      `${WEB}/i18n/__tests__/core-errors.test.ts`,
      `${WEB}/i18n/__tests__/registry.test.ts`,
      `${WEB}/i18n/__tests__/use-translation.test.tsx`,
    ]),
    requisitos: ['RNF-05'],
    verificacaoManual: [],
  },
  {
    id: 'C-GERACAO',
    nome: 'Fluxo de geracao e gravacao',
    descricao:
      'Destino antes de gerar, progresso, ultima geracao, gravacao pelo plugin proprio (Rust + Kotlin) e copia do arquivo ja salvo.',
    arquivos: [
      `${WEB}/lib/generation.ts`,
      `${WEB}/lib/save-pdf.ts`,
      `${WEB}/components/workspace/generation-action.tsx`,
      `${PLUGIN}/src/**`,
      `${PLUGIN}/android/src/**`,
      `${PLUGIN}/android/{build.gradle.kts,settings.gradle,consumer-rules.pro}`,
      `${PLUGIN}/{Cargo.toml,build.rs}`,
      `${PLUGIN}/permissions/default.toml`,
    ],
    usa: ['C-I18N', 'C-NUCLEO'],
    testes: testes(
      [`${WEB}/lib/__tests__/save-pdf.test.ts`, `${WEB}/lib/__tests__/generation.test.tsx`],
      ['workspace.spec.ts'],
      [`${PLUGIN}/Cargo.toml`],
    ),
    requisitos: ['RNF-03'],
    verificacaoManual: [
      'verify:desktop -> ARQUIVO (seletor Salvar como)',
      'verify:android -> UNIR SELETOR/ARQUIVO/INTEGRO (gravacao pelo SAF)',
    ],
  },
  {
    id: 'C-SERVICOS',
    nome: 'Workers da sessao e liberacao de memoria',
    descricao:
      'Cria os workers uma vez por sessao e solta as paginas da renderizacao durante operacoes pesadas.',
    arquivos: [`${WEB}/workspace/services.tsx`],
    usa: ['C-RENDERIZACAO', 'C-DOCUMENTOS', 'C-ESTADO', 'C-GERACAO'],
    testes: testes([], ['workspace.spec.ts', 'preview.spec.ts']),
    requisitos: ['RNF-03'],
    verificacaoManual: [],
  },
  {
    id: 'C-INTERVALOS',
    nome: 'Intervalos de paginas e selecao',
    descricao:
      'Gramatica `1-3, 7-8` (base 1 na entrada, base 0 na saida) e o vinculo de mao dupla entre campo e grade.',
    arquivos: [
      `${CORE}/split/page-ranges.ts`,
      `${WEB}/workspace/page-spec.ts`,
      `${WEB}/components/workspace/page-range-field.tsx`,
    ],
    usa: ['C-NUCLEO', 'C-ESTADO', 'C-I18N'],
    testes: testes(
      [`${CORE}/split/page-ranges.test.ts`, `${WEB}/workspace/__tests__/page-spec.test.ts`],
      ['extract.spec.ts', 'split.spec.ts'],
    ),
    requisitos: ['US-02'],
    verificacaoManual: [],
  },
  {
    id: 'C-GRADE',
    nome: 'Grade de paginas e miniaturas',
    descricao:
      'Cartoes reordenaveis, miniaturas sob demanda e nunca vazias, desenho com rotacao compartilhado com a lupa.',
    arquivos: [
      `${WEB}/components/workspace/page-grid.tsx`,
      `${WEB}/components/workspace/page-card.tsx`,
      `${WEB}/components/workspace/page-thumbnail.tsx`,
      `${WEB}/lib/draw-page.ts`,
    ],
    usa: ['C-ESTADO', 'C-SERVICOS', 'C-I18N'],
    testes: testes(
      [`${WEB}/components/workspace/__tests__/page-thumbnail.test.tsx`],
      ['workspace.spec.ts'],
    ),
    requisitos: ['US-01', 'RNF-03'],
    verificacaoManual: ['verify:android -> LUPA ALVO (alvo de toque de 44 px)'],
  },
  {
    id: 'C-CASCA',
    nome: 'Casca do workspace e navegacao',
    descricao:
      'Layout, pagina inicial, barra lateral, area de arquivos, barra inferior com area segura, registro de ferramentas.',
    arquivos: [
      `${WEB}/app/layout.tsx`,
      `${WEB}/app/page.tsx`,
      `${WEB}/app/globals.css`,
      `${WEB}/components/workspace/workspace-shell.tsx`,
      `${WEB}/components/workspace/tool-sidebar.tsx`,
      `${WEB}/components/workspace/bottom-bar.tsx`,
      `${WEB}/components/workspace/dropzone.tsx`,
      `${WEB}/components/workspace/properties-panel.tsx`,
      `${WEB}/components/ui/**`,
      `${WEB}/tools/registry.ts`,
      `${WEB}/lib/capabilities.ts`,
      `${WEB}/lib/cn.ts`,
    ],
    usa: ['C-GRADE', 'C-SERVICOS', 'C-ESTADO', 'C-I18N'],
    testes: testes([`${WEB}/tools/registry.test.ts`], ['smoke.spec.ts', 'workspace.spec.ts']),
    requisitos: ['RNF-01'],
    verificacaoManual: [
      'verify:desktop -> CAPACIDADES, WORKERS',
      'verify:android -> AREA SEG (barra inferior acima da area do sistema)',
    ],
  },
  {
    id: 'C-PROTOTIPOS',
    nome: 'Rotas de prototipo (spikes)',
    descricao: 'Paginas que exercitam os workers isolados; so viram rota com PDFKITTY_SPIKE=1.',
    arquivos: [
      `${WEB}/app/spike/**`,
      `${WEB}/config/page-extensions.ts`,
      'apps/web/scripts/verify-spike-excluded.mjs',
    ],
    usa: ['C-DOCUMENTOS', 'C-RENDERIZACAO', 'C-VERIFICACAO'],
    testes: testes(
      [`${WEB}/config/page-extensions.test.ts`],
      ['documents-worker.spec.ts', 'redaction-worker.spec.ts', 'sign-spike.spec.ts'],
    ),
    requisitos: [],
    verificacaoManual: ['pnpm verify:spike-excluded (build limpo sem rotas de spike)'],
  },
  {
    id: 'C-PLATAFORMA',
    nome: 'Empacotamento Tauri (Windows e Android)',
    descricao:
      'Configuracao do Tauri e CSP, capacidades da ponte nativa e o projeto Android sem a permissao INTERNET.',
    arquivos: [
      `${TAURI}/tauri.conf.json`,
      `${TAURI}/capabilities/**`,
      `${TAURI}/{Cargo.toml,Cargo.lock,build.rs}`,
      `${TAURI}/src/**`,
      `${TAURI}/gen/**`,
    ],
    usa: [],
    testes: testes(['packages/rastreabilidade/src/invariantes.test.ts']),
    requisitos: ['RNF-01', 'RNF-04'],
    verificacaoManual: [
      'pnpm --filter desktop package + verify:desktop (pacote Windows inteiro)',
      'android.ps1 build --debug --apk + verify:android (REDE e REDE s/CSP bloqueadas)',
    ],
  },
  {
    id: 'C-RASTREABILIDADE',
    nome: 'Matriz de rastreabilidade',
    descricao: 'Esta matriz, o calculo de impacto, o hook de pre-push e a pagina gerada.',
    arquivos: ['packages/rastreabilidade/src/**'],
    usa: [],
    testes: testes([
      'packages/rastreabilidade/src/modelo.test.ts',
      'packages/rastreabilidade/src/integridade.test.ts',
    ]),
    requisitos: [],
    verificacaoManual: [],
  },
];

// ------------------------------------------------------------------------------- funcionalidades

/** Componentes que toda ferramenta da lateral usa. */
const FERRAMENTA = ['C-CASCA', 'C-GRADE', 'C-ESTADO', 'C-SERVICOS', 'C-GERACAO', 'C-I18N'];

const funcionalidades: readonly Funcionalidade[] = [
  {
    id: 'F-UNIR',
    nome: 'Unir e organizar',
    rota: '/unir/',
    descricao: 'Junta paginas de varios PDFs, reordena, gira, duplica, exclui e desfaz.',
    arquivos: [`${WEB}/app/unir/**`, `${WEB}/components/workspace/organize-tool.tsx`],
    usa: [...FERRAMENTA, 'C-DOCUMENTOS', 'C-COMPOSICAO'],
    testes: testes([], ['workspace.spec.ts']),
    requisitos: ['US-01', 'US-02', 'RNF-03'],
    verificacaoManual: [
      'verify:desktop -> CARREGAR, SELETOR, ARQUIVO',
      'verify:android -> UNIR SELETOR/ARQUIVO/INTEGRO, REABRIR',
    ],
  },
  {
    id: 'F-EXTRAIR',
    nome: 'Extrair',
    rota: '/extrair/',
    descricao: 'Recorta as paginas escolhidas para UM arquivo PDF.',
    arquivos: [`${WEB}/app/extrair/**`, `${WEB}/components/workspace/extract-tool.tsx`],
    usa: [...FERRAMENTA, 'C-INTERVALOS', 'C-DOCUMENTOS', 'C-COMPOSICAO'],
    testes: testes([], ['extract.spec.ts']),
    requisitos: ['US-02'],
    verificacaoManual: ['verify:desktop -> EXTRAIR', 'verify:android -> LIGACAO, EXTRAIR CONTEUDO'],
  },
  {
    id: 'F-DIVIDIR',
    nome: 'Dividir',
    rota: '/dividir/',
    descricao: 'Quebra o documento em varios arquivos, por faixa ou por tamanho, num pacote .zip.',
    arquivos: [
      `${WEB}/app/dividir/**`,
      `${WEB}/components/workspace/split-tool.tsx`,
      `${CORE}/split/{split.ts,archive.ts,index.ts}`,
    ],
    usa: [...FERRAMENTA, 'C-INTERVALOS', 'C-DOCUMENTOS', 'C-COMPOSICAO', 'C-NUCLEO'],
    testes: testes(
      [`${CORE}/split/split.test.ts`, `${CORE}/split/archive.test.ts`],
      ['split.spec.ts'],
    ),
    requisitos: ['US-02'],
    verificacaoManual: ['verify:desktop -> DIVIDIR', 'verify:android -> DIVIDIR CONTEUDO'],
  },
  {
    id: 'F-COMPACTAR',
    nome: 'Compactar',
    rota: '/compactar/',
    descricao:
      'Sem perda (reempacota e tira a camada de OCR) ou forte (rasteriza em JPEG), com alvo de tamanho.',
    arquivos: [
      `${WEB}/app/compactar/**`,
      `${WEB}/components/workspace/compress-tool.tsx`,
      `${CORE}/compression/**`,
    ],
    usa: [...FERRAMENTA, 'C-DOCUMENTOS', 'C-COMPOSICAO', 'C-RENDERIZACAO', 'C-NUCLEO'],
    testes: testes(
      [
        `${CORE}/compression/invisible-text.test.ts`,
        `${CORE}/compression/repack.test.ts`,
        `${CORE}/compression/rasterize-compression.test.ts`,
      ],
      ['compress.spec.ts'],
    ),
    requisitos: ['US-07', 'RNF-03'],
    verificacaoManual: [
      'verify:desktop -> COMPACTAR',
      'verify:android -> SEM PERDA, FORTE AVISO, FORTE x S/PERDA',
    ],
  },
  {
    id: 'F-OCR',
    nome: 'Reconhecer texto (OCR)',
    rota: '/ocr/',
    descricao: 'Tesseract local em portugues; grava uma camada de texto invisivel e pesquisavel.',
    arquivos: [
      `${WEB}/app/ocr/**`,
      `${WEB}/components/workspace/ocr-tool.tsx`,
      `${WEB}/workers/ocr.ts`,
      `${CORE}/ocr/**`,
      'apps/web/scripts/sync-tesseract.mjs',
      'apps/web/por.traineddata',
    ],
    usa: [...FERRAMENTA, 'C-RENDERIZACAO', 'C-NUCLEO'],
    testes: testes([`${CORE}/ocr/text-layer.test.ts`], ['ocr.spec.ts']),
    requisitos: ['US-04', 'RNF-02', 'RNF-04'],
    verificacaoManual: ['OCR num documento escaneado real, no aparelho, com a barra de progresso'],
  },
  {
    id: 'F-ASSINAR',
    nome: 'Assinar (ICP-Brasil A1)',
    rota: '/assinar/',
    descricao: 'Assina com certificado A1; chave e senha vivem so num worker descartavel.',
    arquivos: [
      `${WEB}/app/assinar/**`,
      `${WEB}/components/workspace/sign-tool.tsx`,
      `${WEB}/workers/{sign-client.ts,sign-protocol.ts,sign.worker.ts}`,
      `${WEB}/i18n/sign-errors.ts`,
    ],
    usa: [...FERRAMENTA, 'C-MENSAGENS'],
    testes: testes([`${WEB}/i18n/__tests__/sign-errors.test.ts`], ['sign.spec.ts', 'sign-spike.spec.ts']),
    requisitos: ['US-05', 'RNF-01'],
    verificacaoManual: ['Assinar com um A1 real e conferir no validador do ITI'],
  },
  {
    id: 'F-OFUSCAR',
    nome: 'Ofuscar',
    rota: '/ofuscar/',
    descricao: 'Marca regioes e as destroi no nivel do pixel; o texto nao e mais extraivel.',
    arquivos: [
      `${WEB}/app/ofuscar/**`,
      `${WEB}/components/workspace/redact-tool.tsx`,
      `${WEB}/components/workspace/page-viewer.tsx`,
      `${CORE}/redaction/**`,
    ],
    usa: [...FERRAMENTA, 'C-RENDERIZACAO', 'C-VERIFICACAO', 'C-NUCLEO'],
    testes: testes(
      [`${CORE}/redaction/rasterize-redaction.test.ts`],
      ['redact.spec.ts', 'redaction-worker.spec.ts'],
    ),
    requisitos: ['US-03'],
    verificacaoManual: [],
  },
  {
    id: 'F-BUSCA',
    nome: 'Busca de campo aberto',
    rota: null,
    descricao: 'Destaca em amarelo as paginas com o termo, sem acento e sem caixa, entre PDFs.',
    arquivos: [`${WEB}/components/workspace/search-field.tsx`, `${WEB}/workspace/search.ts`],
    usa: ['C-GRADE', 'C-RENDERIZACAO', 'C-ESTADO', 'C-SERVICOS', 'C-I18N'],
    testes: testes([`${WEB}/workspace/__tests__/search.test.ts`], ['workspace.spec.ts']),
    requisitos: ['US-06'],
    verificacaoManual: [],
  },
  {
    id: 'F-LUPA',
    nome: 'Lupa na pagina',
    rota: null,
    descricao: 'Abre a pagina a 1400 px, navega com setas e move/gira de dentro.',
    arquivos: [`${WEB}/components/workspace/page-preview.tsx`],
    usa: ['C-GRADE', 'C-RENDERIZACAO', 'C-ESTADO', 'C-SERVICOS', 'C-I18N'],
    testes: testes([], ['preview.spec.ts']),
    requisitos: ['US-08'],
    verificacaoManual: [
      'verify:desktop -> LUPA',
      'verify:android -> LUPA ALVO, LUPA PAG, LUPA ACAO, LUPA AREA',
    ],
  },
];

// ------------------------------------------------------------------------------- a matriz

export const matriz: Matriz = {
  requisitos,
  funcionalidades,
  componentes,

  produto: [
    `${WEB}/**`,
    `${CORE}/**`,
    'packages/pdf-core/scripts/**',
    'apps/web/scripts/{sync-tesseract.mjs,verify-spike-excluded.mjs}',
    'apps/web/por.traineddata',
    `${PLUGIN}/{src,android/src}/**`,
    `${PLUGIN}/android/{build.gradle.kts,settings.gradle,consumer-rules.pro}`,
    `${PLUGIN}/{Cargo.toml,build.rs}`,
    `${PLUGIN}/permissions/default.toml`,
    `${TAURI}/{tauri.conf.json,Cargo.toml,Cargo.lock,build.rs}`,
    `${TAURI}/{src,capabilities,gen}/**`,
    'packages/rastreabilidade/src/**',
  ],

  testesDescobertos: ['**/*.test.{ts,tsx}', `${E2E}/*.spec.ts`],

  exigemTudo: [
    '**/package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'turbo.json',
    '.npmrc',
    'tsconfig.base.json',
    'eslint.base.mjs',
    '**/eslint.config.mjs',
    '**/tsconfig*.json',
    '**/vitest.config.{ts,mts}',
    'apps/web/vitest.setup.ts',
    'apps/web/playwright.config.ts',
    'apps/web/next.config.ts',
    'apps/web/next-env.d.ts',
    'apps/web/postcss.config.mjs',
    `${E2E}/{capabilities.ts,minimal-pdf.ts}`,
    `${CORE}/testing/**`,
  ],

  semTeste: [
    '**/*.md',
    'docs/**',
    '.claude/**',
    'referencias/**',
    'tools/**',
    '.githooks/**',
    '**/.gitignore',
    '.gitattributes',
    '.prettierrc.json',
    '.prettierignore',
    'apps/web/scripts/{verify-desktop.mjs,verify-android.mjs}',
    'apps/desktop/scripts/**',
    `${TAURI}/icons/**`,
    `${PLUGIN}/android/.tauri/**`,
    `${PLUGIN}/permissions/{autogenerated,schemas}/**`,
  ],
};
