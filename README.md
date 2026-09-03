# PDFKitty

Suíte de manipulação de PDF que **nunca envia seus documentos para lugar nenhum**.

Unir, extrair, dividir, compactar, reconhecer texto (OCR), assinar com certificado ICP-Brasil e
ofuscar trechos sensíveis — tudo executado dentro do próprio aparelho, em Web Workers e
WebAssembly. Não existe servidor para receber um arquivo, porque não existe servidor.

Distribuída como aplicativo **Windows** e **Android**, a partir de uma única base de código.

---

## Por que isso importa

Serviços de PDF online pedem que você envie o documento. Para um contrato, um laudo médico ou a
lista de matrículas de uma escola, isso é um problema de LGPD antes de ser um problema técnico.

O PDFKitty parte do princípio oposto: **o documento não sai do aparelho**. Não é uma promessa de
política de privacidade — é uma propriedade da arquitetura, sustentada por cinco barreiras
independentes, nesta ordem:

| #   | Barreira                                    | O que ela impede                                                                             |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Disciplina de projeto                       | Ninguém escreve código que envie arquivos                                                    |
| 2   | Regras de lint                              | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` e URLs externas são erro de compilação |
| 3   | Teste E2E                                   | Uma requisição de saída é tentada de propósito e precisa falhar                              |
| 4   | CSP do Tauri                                | `connect-src` restrito a `'self'` e ao canal IPC local                                       |
| 5   | Ausência da permissão `INTERNET` no Android | O sistema operacional recusa qualquer socket, mesmo que tudo acima falhe                     |

A quinta é a mais forte: ela continua valendo se alguém afrouxar o CSP por engano. Está verificada
no aparelho real — com o CSP desligado via depuração remota, a requisição **continua bloqueada**.

O único acesso à rede previsto no futuro é o carimbo de tempo AD-RT da assinatura digital, que
**ainda não existe**. Quando entrar: desligado por padrão, com consentimento informado e indicador
permanente, e sai apenas o _hash_ — nunca o documento, nunca a chave privada.

---

## O que a suíte faz

| Ferramenta    | O que resolve                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Unir**      | Junta páginas de vários PDFs numa composição só, reordenando por arraste, por botão ou pelo teclado             |
| **Extrair**   | Recorta as páginas escolhidas para **um** arquivo                                                               |
| **Dividir**   | Quebra o documento em **vários** arquivos, por intervalo ou por tamanho, entregues num `.zip`                   |
| **Compactar** | Reduz o arquivo sem perda (removendo a camada de OCR) ou rasterizando, com modo "caber em N MB"                 |
| **OCR**       | Reconhece texto localmente com Tesseract em português, tornando digitalizações pesquisáveis                     |
| **Assinar**   | Assina com certificado A1 ICP-Brasil; a chave existe apenas em memória, num worker que morre junto com a sessão |
| **Ofuscar**   | Remove o conteúdo do _content stream_ — irreversível, não um retângulo preto por cima                           |

Além disso: **busca de campo aberto** que destaca páginas com ocorrências atravessando PDFs
distintos, e uma **lupa** em cada página para identificar o documento sem precisar gerá-lo.

---

## Tecnologias

### Aplicação

| Área              | Escolha                                         | Por quê                                                         |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Framework         | **Next.js 16** (App Router, `output: 'export'`) | Export estático elimina a superfície de servidor por construção |
| UI                | **React 19** + **Tailwind 4** + Radix (Shadcn)  | Design limpo com primitivas acessíveis                          |
| Estado            | **Zustand 5**                                   | Baixo acoplamento, sem _provider hell_                          |
| Arrastar e soltar | **@dnd-kit**                                    | Sensores separados para mouse, toque e teclado                  |
| Linguagem         | **TypeScript 5.9.3** (pinado)                   | `latest` já é o 7.x, um port nativo ainda em transição          |

### Núcleo de PDF

| Biblioteca                                        | Uso                               | Por quê esta                                                       |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| **@cantoo/pdf-lib**                               | Leitura e escrita de PDF          | Fork MIT ativo; o upstream está parado desde 2022                  |
| **pdfjs-dist**                                    | Renderização e geometria do texto | Miniaturas, lupa e rasterização                                    |
| **tesseract.js**                                  | OCR local                         | WebAssembly, sem chamar serviço externo                            |
| **@signpdf** + `signer-p12` + `placeholder-plain` | Assinatura                        | **Nunca** `placeholder-pdf-lib`, que depende do pdf-lib abandonado |
| **fflate**                                        | Empacotamento ZIP                 | PDF já vem comprimido; o ZIP agrupa, não encolhe                   |

Ofuscação é **implementação própria**: o MuPDF é AGPL-3.0 e exigiria abrir o produto ou pagar
licença comercial.

### Empacotamento e testes

| Área                    | Ferramenta                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Desktop e mobile        | **Tauri v2** (WebView2 no Windows, WebView no Android) + plugin próprio em Rust/Kotlin |
| Monorepo                | **pnpm workspaces** + **Turborepo**                                                    |
| Testes unitários        | **Vitest** + Testing Library                                                           |
| Testes de ponta a ponta | **Playwright** (Chromium e WebKit)                                                     |
| Qualidade               | **ESLint** com análise de tipos + **Prettier**                                         |

---

## Estrutura

```
apps/web/              Next.js 16, export estático
  src/app/             uma rota por ferramenta: /unir /extrair /dividir /compactar /ocr /assinar /ofuscar
  src/components/      ui/ (primitivas) + workspace/ (casca, grade, painel, barra, lupa)
  src/workspace/       modelo puro, store Zustand, provedor dos workers, busca
  src/workers/         envelope comum + documentos + renderização + assinatura
  src/lib/             gravação de arquivo, fluxo de geração, capacidades
  src/i18n/            dicionários, registro, store, hook
  e2e/                 Playwright contra o export estático
  scripts/             verificadores de desktop e Android (fora do produto)

apps/desktop/          Tauri v2 (Windows + Android); sem lógica de PDF
  plugins/saf-save/    plugin próprio de gravação (Rust + Kotlin)
  src-tauri/           configuração, capacidades, projeto Android gerado

packages/pdf-core/     Lógica de PDF pura: sem React, sem DOM
  src/composition/ src/split/ src/compression/ src/ocr/ src/redaction/ src/verification/
  src/browser/         rasterizador OffscreenCanvas e adaptadores
  src/testing/         rasterizador Node para os testes

tools/                 diagnóstico de motor, fora do produto
```

**Direção de dependência:** `web` e `desktop` dependem de `pdf-core`, nunca o contrário.

---

## Arquivos de configuração

### Raiz do repositório

#### `package.json`

Raiz privada do workspace. Não tem código: só orquestra o Turborepo (`pnpm test` dispara
`turbo run test` em todos os pacotes). Fixa o gerenciador em `pnpm@11.24.0` e exige Node
`>=20.19.0` — combinado com o `.npmrc`, isso falha cedo em vez de produzir erro obscuro depois.

#### `pnpm-workspace.yaml`

Declara os workspaces (`apps/*`, `packages/*`) e libera explicitamente a compilação de scripts do
`tesseract.js`. O pnpm bloqueia scripts de instalação por padrão; a liberação é nominal, e não
global, para que uma dependência nova não ganhe execução por tabela.

#### `turbo.json`

O grafo de tarefas. O que importa aqui:

- `dependsOn: ["^build"]` — testes e verificações esperam as dependências estarem construídas.
- `outputs` — o que entra no cache (`out/`, `dist/`, `.next/`, menos `.next/cache`).
- `cache: false` em `dev` e `test:e2e` — o E2E sobe navegador e escreve fora do diretório; cachear
  daria falso verde.
- `globalDependencies: ["tsconfig.base.json", ".npmrc"]` — mexer nesses dois invalida tudo.

#### `tsconfig.base.json`

Herdado por todos os pacotes. Além de `strict`, liga três opções que a maioria dos projetos deixa
de fora e que aqui pegam defeitos reais:

- `noUncheckedIndexedAccess` — `array[i]` passa a ser `T | undefined`, que é a verdade.
- `exactOptionalPropertyTypes` — distingue "propriedade ausente" de "propriedade igual a
  `undefined`", diferença que importa ao repassar opções entre workers.
- `verbatimModuleSyntax` — obriga `import type` explícito, evitando import de valor que só existia
  para tipagem.

`noEmit: true`: quem transpila é o bundler; o `tsc` aqui só verifica.

#### `eslint.base.mjs`

Base compartilhada, com **análise de tipos** ligada. Existe para pegar o que o `tsc` não pega —
promessa não aguardada, `any` atravessando fronteira, condição sempre verdadeira. Exporta
`zeroDataTransferRules`, o conjunto que transforma a Regra de Ouro 1 em erro de lint.

#### `.npmrc`

Três linhas, cada uma com consequência arquitetural:

- `engine-strict=true` — instala apenas na versão de Node suportada.
- `node-linker=isolated` (padrão do pnpm) — **impede importar dependência não declarada**. É o que
  garante, na prática, que `pdf-core` não passe a depender de React sem que alguém perceba.
- `auto-install-peers=true` com `strict-peer-dependencies=false` — resolve peers sem travar a
  instalação por _ranges_ divergentes.

#### `.gitignore`

Duas exceções deliberadas, ambas comentadas no próprio arquivo:

- `apps/desktop/src-tauri/gen/*` é ignorado, **menos `gen/android/`**. Esse projeto gerado carrega
  a remoção da permissão `INTERNET`. Deixá-lo fora do versionamento faria a barreira mais forte da
  Regra de Ouro 1 voltar sozinha ao padrão do Tauri na próxima geração.
- `*.pfx`, `*.p12`, `*.key`, `*.pem` — material de assinatura ICP-Brasil **nunca** é versionado.

#### `.gitattributes`

`eol=lf` para tudo, e marcação binária explícita para `*.pdf`, `*.traineddata` e `*.wasm` — sem
isso, o Git corromperia esses arquivos ao normalizar fim de linha.

#### `.prettierrc.json` e `.prettierignore`

Formatação única (aspas simples, vírgula final, 100 colunas). O `referencias/` fica de fora: são
documentos de origem, não código.

---

### `apps/web`

#### `next.config.ts`

O arquivo mais importante do projeto do ponto de vista da privacidade:

- **`output: 'export'`** — remove qualquer _runtime_ de servidor. Sem servidor, não existe rota
  capaz de receber um PDF. A restrição passa a ser garantida por construção, não por revisão.
- `trailingSlash: true` — faz `/unir/` ser servido como `unir/index.html` por qualquer host
  estático.
- `images: { unoptimized: true }` — o otimizador de imagens exigiria servidor.
- `pageExtensions` dinâmico — rotas de protótipo (`*.spike.tsx`) só viram rota com
  `PDFKITTY_SPIKE=1`, e um script de verificação falha o build se alguma vazar.

#### `eslint.config.mjs`

Onde as Regras de Ouro viram erro de compilação:

- `zeroDataTransferRules` aplicado a todo `src/**` — rede proibida.
- Qualquer arquivo em `src/app/api/**` falha imediatamente, com mensagem explicando o motivo.
- Os testes E2E são **isentos** dessa proibição: é neles que se verifica a ausência de rede, e o
  código que testa a barreira precisa poder tentar atravessá-la.

#### `playwright.config.ts`

Roda contra o **export estático** servido na porta `4173`, e não contra o `next dev`: é exatamente
o artefato que será publicado e empacotado no Tauri, e Workers e WASM se comportam de forma
diferente sob o servidor de desenvolvimento.

Espera das asserções em 15 s em vez dos 5 s padrão — tudo ali é estado eventual (subir dois
workers, abrir o PDF, desenhar), e 5 s produzia falha intermitente. Chromium e WebKit por padrão;
Firefox é opcional via `PDFKITTY_FIREFOX=1`.

#### `vitest.config.mts` e `vitest.setup.ts`

Ambiente `jsdom` com o alias `@` para `src/`. Exclui `e2e/` explicitamente: aqueles arquivos são do
Playwright, e deixar o Vitest coletá-los produz uma falha confusa.

#### `tsconfig.json` e `tsconfig.e2e.json`

Dois projetos de propósito: os testes E2E usam APIs de Node e tipos do Playwright, que não cabem no
projeto da aplicação. O script `typecheck` verifica os dois.

---

### `apps/desktop`

#### `src-tauri/tauri.conf.json`

- `identifier: "com.pdfkitty.app"` — um só para todas as plataformas. Depois da primeira publicação
  na Play Store, **não pode mudar**.
- `frontendDist: "../../web/out"` — o desktop consome o mesmo export estático da web.
- **`app.security.csp`** — a quarta barreira. `connect-src` limitado a `'self'` e ao IPC local;
  `object-src: 'none'`; `frame-ancestors: 'none'`. `wasm-unsafe-eval` está liberado porque o
  Tesseract e o pdf.js precisam dele.
- `bundle.android.minSdkVersion: 26` — a configuração é o que sobrevive a uma regeneração do
  projeto Android; o valor no `build.gradle.kts` gerado, não.

#### `src-tauri/capabilities/default.json`

Permissões concedidas ao WebView. Reduzida ao mínimo: `dialog:allow-save` e `saf-save:default`.
**O `tauri-plugin-fs` foi removido do produto** — a gravação dele no Android usava um descritor
destacado e registrava o documento com **zero bytes**, ilegível para qualquer aplicativo.

#### `plugins/saf-save/`

Plugin próprio em Rust + Kotlin que substitui o `fs`, gravando pelo _content resolver_ do Android.
É a correção do defeito acima, e a razão de o produto conseguir salvar de fato no aparelho.

#### `scripts/android.ps1`

Resolve SDK, NDK e JDK por **versão medida**, não por suposição. Existe porque o erro nativo dessas
situações nunca diz "variável de ambiente faltando": diz `Unsupported class file major version 69`
(Gradle 8 sobre JDK 25) ou simplesmente não encontra o NDK.

---

### `packages/pdf-core`

#### `package.json`

Três pontos de entrada separados, e essa separação é arquitetural:

- `.` — lógica pura de PDF, sem DOM.
- `./browser` — o que depende de `OffscreenCanvas` e do pdf.js.
- `./testing` — rasterizador Node e utilitários de teste, que nunca entram no pacote final.

---

## Comandos

```bash
pnpm install
pnpm dev                       # desenvolvimento
pnpm build                     # export estático
pnpm test                      # unitários (Vitest)
pnpm test:e2e                  # ponta a ponta (Playwright)
pnpm typecheck
pnpm lint

pnpm --filter web sync:assets          # copia pdf.js e Tesseract para public/
pnpm --filter desktop package          # .exe portátil, .msi e instalador NSIS
pnpm --filter desktop android:apk      # APK (android:aab, android:dev, android:init)
```

Verificação por dentro do aplicativo empacotado — compilar não prova que a interface carregou, que
o CSP não quebrou os workers, nem que o arquivo chegou ao disco:

```bash
pnpm --filter web verify:desktop       # inspeciona o app Windows em execução
pnpm --filter web verify:android       # inspeciona o app Android no aparelho
```

**Requisitos:** Node ≥ 20.19, pnpm 11.24. Para os pacotes nativos: Rust, Android SDK/NDK e um JDK
entre 17 e 24 (o Gradle 8 não compila sobre o JDK 25).

---

## Estado atual

Backlog funcional completo, verificado no Windows e num aparelho Android real.

**Ainda não existe:** APK de release assinado, builds para macOS e Linux, carimbo de tempo AD-RT,
conformidade DOC-ICP-15 e via cirúrgica de ofuscação. O suporte a Apple foi adiado por falta de
aparelho para medir, **não por limitação técnica** — o Safari 16.4+ oferece `OffscreenCanvas`
inclusive em worker, e nada precisaria ser reescrito.

---

## Licença

Software proprietário, distribuído sob licença vitalícia por usuário. Não há arquivo `LICENSE`
neste repositório, e o `Cargo.toml` declara `UNLICENSED` — este código **não** é aberto e não está
liberado para redistribuição.
