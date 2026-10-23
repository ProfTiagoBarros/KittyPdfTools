# PDFKitty Suite

Suíte de manipulação de PDF **100% client-side** (unir, dividir, ofuscar, assinar via ICP-Brasil,
OCR local), focada em privacidade/LGPD, distribuída como Web (export estático), Desktop e Android
(Tauri), sob licença vitalícia.

Escopo original: `referencias/Documento de Requisitos do PDFKitty.pdf` (`pdftotext -layout`).
Como cada decisão foi tomada e o que cada defeito custou: `.claude/HISTORICO.md`.

---

## Regras de Ouro (invioláveis)

Violação aqui é defeito de produto, não de estilo.

**1. Zero-Data Transfer.** Nenhum byte de documento deixa o cliente. Sem rotas de API, sem
telemetria com nome/metadado de arquivo, sem upload de `.pfx`, sem CDN para fonte/wasm/modelo.
`output: 'export'` torna a violação impossível por construção. Cinco barreiras, nesta ordem:
disciplina → lint → teste E2E → CSP do Tauri → **ausência da permissão INTERNET no Android**.

- _Única exceção prevista:_ carimbo de tempo AD-RT (US-05), que ainda **não existe**. Quando
  entrar: desligado por padrão, consentimento informado na primeira vez, indicador passivo
  permanente que a supressão do modal **não** apaga, revogável, preferência local ao aparelho.
  Sai apenas o hash — nunca o documento, nunca a chave. Nenhuma outra função se apoia nessa
  brecha. Assinar AD-RB **não acessa a rede** e por isso não exibe alerta nenhum.

**2. Web Workers para todo processamento pesado.** `pdf-lib`, `pdfjs-dist`, `tesseract.js` e WASM
rodam em workers dedicados. Mensagens tipadas, nunca `any`. Toda operação longa relata progresso.
`ArrayBuffer` viaja por _transfer list_, não por cópia.

**3. Gerenciamento de memória.** `revokeObjectURL` no mesmo escopo do `createObjectURL`;
`ImageBitmap.close()` ao descartar. A grade de miniaturas vaza RAM rápido.

**4. Offline-first.** Desktop e Android funcionam sem conexão: fontes, workers, wasm e
`traineddata` viajam no pacote.

---

## Decisões de arquitetura

| Área          | Decisão                                         | Motivo                                                                  |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Framework     | Next.js 16, App Router, `output: 'export'`      | Export estático elimina superfície de servidor                          |
| Monorepo      | pnpm workspaces + Turborepo                     | Núcleo compartilhado entre web e desktop                                |
| Testes        | Vitest + Testing Library + Playwright           | Playwright é o único caminho para Worker+WASM reais                     |
| Estado        | Zustand                                         | Baixo acoplamento, sem provider hell                                    |
| Drag & drop   | `@dnd-kit/core`                                 | Decisão do projeto (o documento citava alternativa)                     |
| UI            | Tailwind + Shadcn (Radix)                       | Design clean exigido pelo documento                                     |
| `node-linker` | `isolated` (padrão pnpm)                        | Impede import de dependência não declarada                              |
| Base PDF      | `@cantoo/pdf-lib`                               | Fork MIT ativo; upstream parado desde 2022-05; expõe `encrypt()`        |
| Compactar     | JPEG ao rasterizar; PNG ao ofuscar              | Página digitalizada é fotografia; ofuscação é prova e não pode degradar |
| Renderização  | `pdfjs-dist`                                    | Miniaturas e geometria do texto                                         |
| Ofuscação     | Implementação própria                           | MuPDF é AGPL-3.0: exigiria abrir o produto ou licença comercial         |
| Assinatura    | `@signpdf` + `signer-p12` + `placeholder-plain` | **Nunca `placeholder-pdf-lib`**: depende do pdf-lib abandonado          |
| Empacotar     | ZIP via `fflate`, `level: 0`                    | PDF já é comprimido; o ZIP agrupa, não encolhe                          |
| TypeScript    | `5.9.3` (pinado)                                | `latest` é o 7.x (port nativo)                                          |

**Plataformas-alvo:** Windows e Android. **Apple adiada por falta de aparelho, não por defeito** —
Safari 16.4+ tem `OffscreenCanvas` inclusive em worker. Nada precisa ser reescrito para incluí-la;
falta medir (`tools/diagnostico-motor.html`) e empacotar no próprio macOS. Linux fora de escopo.

`applicationId` = **`com.pdfkitty.app`**, um só para todas as plataformas; após a primeira
publicação na Play ele não pode mudar. `minSdk` **26**, definido em `bundle.android.minSdkVersion`
(config) **e** no `build.gradle.kts` gerado — a config é o que sobrevive a uma regeneração.

---

## Estrutura

```
apps/web/           Next.js 16 (export estático)
  src/app/          rota por ferramenta: /unir /extrair /dividir /compactar /ocr /assinar /ofuscar
  src/components/   ui/ (primitivas) + workspace/ (casca, grade, painel, barra)
  src/workspace/    modelo puro, store Zustand, provedor dos workers, busca
  src/workers/      envelope comum + documentos + renderização + assinatura
  src/lib/          save-pdf, generation, capabilities
  src/i18n/         dicionários, registry, store, hook
  e2e/              Playwright contra o export estático
apps/desktop/       Tauri v2 (Windows + Android); sem lógica de PDF
  plugins/saf-save/ plugin próprio de gravação (Rust + Kotlin)
packages/pdf-core/  Lógica de PDF pura, sem React e sem DOM
  src/composition/ src/split/ src/compression/ src/ocr/ src/redaction/ src/verification/
  src/browser/      rasterizador OffscreenCanvas + adaptadores
  src/testing/      rasterizador Node
packages/rastreabilidade/  matriz requisito → código → testes, cálculo de impacto, página gerada
.githooks/pre-push  roda os testes impactados antes de todo push
docs/               rastreabilidade.html e RASTREABILIDADE.md (gerados), guia e revisão
tools/              diagnóstico de motor, fora do produto
```

**Direção de dependência:** `web`/`desktop` → `pdf-core`, nunca o inverso.

**i18n:** criar `src/i18n/messages/<codigo>.ts` e uma linha em `registry.ts`. Nenhum componente é
tocado. `pt-BR.ts` é a fonte da verdade das chaves (dicionário incompleto quebra o `typecheck`).
**Os dicionários são ASCII, sem acentos.** Componentes nunca importam dicionários — só
`useTranslation()`. O HTML é pré-renderizado só em pt-BR; os demais trocam no cliente.

---

## Comandos

```bash
pnpm install              pnpm dev              pnpm build
pnpm test                 pnpm test:e2e         pnpm typecheck        pnpm lint
pnpm --filter web sync:assets            # pdf.js + Tesseract para public/
pnpm --filter web verify:desktop         # verifica o app Windows por dentro
pnpm --filter web verify:android         # verifica o app Android por dentro
pnpm --filter desktop package            # .exe portátil, .msi e instalador NSIS
pnpm build:windows                       # 64+32 bits → Desktop\PDFKitty-builds, abre a pasta
                                         # (duplo clique: compilar-windows.cmd; -Bits 64|32)
pnpm --filter desktop android:apk        # APK (android:aab, android:dev, android:init)
pnpm test:impact [--listar|--tudo]       # testes de tudo o que a mudança pode quebrar
pnpm rastreabilidade                     # regenera docs/ a partir da matriz
```

Teste único: `pnpm --filter web test -- src/i18n -t "resolve textos"` ·
`pnpm --filter web test:e2e -- -g "deteccao de idioma"`

### Rodar para testar (Windows)

| O que                         | Comando                                               | Onde abre             |
| ----------------------------- | ----------------------------------------------------- | --------------------- |
| Navegador, com recarga        | `pnpm --filter web dev`                               | http://localhost:3000 |
| Navegador, igual ao publicado | `pnpm --filter web build` + `http-server out -p 4173` | http://localhost:4173 |
| App Windows, desenvolvimento  | `pnpm --filter desktop dev:desktop`                   | janela própria        |
| App Windows já compilado      | `apps/desktop/src-tauri/target/release/pdfkitty.exe`  | janela própria        |
| Celular por USB               | `pnpm --filter desktop android:dev`                   | instala no aparelho   |

`pnpm: command not found` → `$env:PATH = "$env:PATH;$env:APPDATA\npm"`.

---

## Como o produto funciona

**Composição (US-01).** `Composition` é uma lista de `PageRef { source, pageIndex, rotate }` — uma
_descrição_, não o documento. Reordenar, girar, excluir e duplicar manipulam esse array; nenhum
byte é tocado até `buildComposition`. Desfazer é uma pilha de arrays (teto de 50), e a seleção
fica **fora** do histórico. Fusão é o caso em que a composição tem todas as páginas de todas as
origens — não existe operação "merge" separada. **Preserva** conteúdo, tamanho e anotações;
**perde** marcadores e links internos (há teste fixando essa perda).

**Divisão e extração (US-02).** São **duas ferramentas**, porque são dois resultados:
`/extrair` entrega **um `.pdf`** com as páginas escolhidas; `/dividir` entrega **vários**, sempre
num `.zip`. Eram modos da mesma tela, e a escolha ficava escondida num grupo de opções — clicar
"Extrair" só trocava de modo, e nada acontecia. Núcleo: `extractPages` → um documento;
`splitByRanges` → um por faixa; `splitBySize` → volumes dentro do limite (empacotamento
incremental, uma geração por página, com progresso e `oversizedPages`). Intervalos são **base 1 na
entrada e base 0 na saída**, e essa tradução só acontece em `parsePageRanges` / `formatPageRanges`.
Ambas agem sobre a **composição da grade**, não sobre o arquivo original; compor e dividir
acontecem na mesma mensagem (`splitComposition`).

**OCR (US-04).** O `pdf-core` não conhece Tesseract: expõe `addInvisibleTextLayer` (modo de
renderização 3). O reconhecimento vive em `workers/ocr.ts`; o motor é criado sob demanda (~15 MB).

**Compactar (US-07).** Duas vias, porque são dois problemas. **Sem perda**
(`repackLossless`): reempacota com fluxos de objetos e, se pedido, remove a camada de texto do
OCR — a página não muda na tela. **Forte** (`compressByRasterizing`): rasteriza em **JPEG** e é o
único caminho que encolhe um documento digitalizado de verdade; perde texto pesquisável, e por
isso **confirma antes**. `compressToTarget` busca em **binária** sobre `COMPRESSION_STEPS` a maior
qualidade que cabe num limite — motivado por sistemas como o SEI; cada tentativa gera o documento
inteiro, então sete degraus custam três tentativas. Não coube nem no degrau mais agressivo? Devolve
o menor com `fitsTarget: false`, em vez de erro. Remover a camada de OCR usa um **tokenizador** de
content stream (`stripInvisibleText`), nunca expressão regular — `BT`, `ET` e `3 Tr` aparecem
dentro de strings literais e de imagens embutidas. **Na dúvida, preserva.**

**Ofuscação (US-03).** Rasteriza a página afetada já sem o conteúdo; as demais ficam intactas e
pesquisáveis. **Retângulo preto não é redaction** — há controle negativo que reprova a ofuscação
falsa. Região marcada em pixels, guardada em espaço de usuário do PDF. A confirmação diz as duas
perdas antes de executar.

**Assinatura (US-05).** Worker dedicado, vivo só enquanto o certificado estiver carregado; os
bytes do `.pfx` são **transferidos** e a senha só existe lá dentro. A sessão termina junto com a
assinatura. Só AD-RB. Erros voltam como `reason` (`INVALID_PASSWORD`…) — a mensagem crua do
node-forge nunca chega à tela. **Falta:** conformidade DOC-ICP-15 e validação de cadeia.

**Busca (US-06).** Destaca em amarelo as páginas com pelo menos uma ocorrência, atravessando PDFs
distintos. **Destaca, não filtra** — a ordem das páginas é o documento final. Sem acento e sem
caixa. Texto extraído uma vez por documento. Palavra partida por kerning escapa; página só de
imagem não tem texto até o OCR rodar.

---

## Interface: invariantes

**Um fluxo de geração só, nas cinco ferramentas** (`lib/generation.ts` + `GenerationAction`):
clicar → **escolher o destino** → progresso → arquivo pronto → **última geração** ao alcance de um
clique. O destino vem antes de gerar; se a geração falhar, o destino é descartado — senão o
produto deixaria arquivos de 0 bytes, que é o sintoma do defeito que o plugin próprio corrige. Na
web não há pergunta de nome: o navegador é dono dessa decisão.

**Dividir entrega um `.zip`**, não uma lista. Volumes nomeados a partir do nome escolhido
(`contrato.zip` → `contrato-1.pdf`). **Não pedimos pasta** porque o Tauri não implementa seletor
de pasta no Android (`FolderPickerNotImplemented`). **Extrair entrega `.pdf` direto** — embrulhar
um arquivo só num pacote é mentir sobre o resultado.

**Campo de páginas e seleção da grade são a mesma escolha** (`usePageSpec`): clicar miniaturas
escreve `1-3, 7-8`, digitar destaca as páginas. A seleção é a fonte da verdade; o texto é uma
vista dela, e um rascunho local sobrevive ao estado intermediário da digitação — **sem
`useEffect`**, comparando o que o campo espera que a seleção seja. Quem executa lê a **seleção**,
nunca o texto cru. Texto recusado mostra o **erro tipado do núcleo** no próprio campo
(`REVERSED_RANGE`, `PAGE_DOES_NOT_EXIST`), antes de pedir destino — não uma frase genérica.

**Casca com slots** (`WorkspaceShell`): sidebar, área de arquivos, grade, painel e barra inferior;
as ferramentas preenchem `panel`, `action` e, quando precisam, `main` (ofuscar troca a grade por
um visualizador de página única). **O provedor de serviços fica fora da casca.**

**Os workers são da sessão, não da rota.** Trocar de ferramenta preserva arquivos e miniaturas —
antes destruía os workers e a grade ficava listando páginas sem bytes. Não há confirmação ao
trocar: a tela foi desenhada em volta de **uma** montagem com cinco ferramentas na lateral.

**Lupa em toda página** (`PagePreview`, US-08). A miniatura da grade não responde "que página é
esta?" — o administrador da escola ordenava um documento longo, gerava o PDF, conferia e voltava
para corrigir. A lupa abre a página a **1400 px** (legível, não impressa; o worker guarda por
tamanho), **navega** entre páginas (setas, `Esc` fecha) e traz **mover e girar**, fechando o ciclo
sem voltar à grade. Segue a **chave** do item, nunca a posição: seguindo a posição, ela saltaria
para a vizinha no instante em que o usuário move a página que está olhando. O estado de desenho é
**derivado** de `chave:rotação`, não um sinalizador — senão o desenho anterior fica na tela marcado
como pronto enquanto o novo carrega, e a lupa mostra a página errada. `drawRotated` é
compartilhado com a miniatura: se divergirem, a página inspecionada deixa de ser a que sai no PDF.

**Miniaturas sob demanda e nunca vazias.** `IntersectionObserver` adia o pedido; onde não há
imagem aparece uma folha em branco com **arquivo de origem e página naquele arquivo**. O canvas
fica montado mesmo escondido — por isso **procurar `canvas` não prova nada**; o critério é a
ausência de `thumbnail-placeholder`.

**Reordenar tem dois caminhos.** Três sensores (mouse por distância, toque por pressão longa,
teclado) mais botões explícitos de mover. As ações do cartão ficam visíveis por padrão no celular:
esconder atrás do `hover` as torna inalcançáveis no toque.

**Todo `fixed` colado embaixo respeita a área segura**, não só a barra principal: o rodapé da
lupa nasceu sem ela e terminava em 693px de uma janela de 693px com inset de 48px — mover, girar
e navegar ficavam atrás dos botões do Android. **Alvo de toque mínimo 44px:** a lupa reprovou com
32px como sétimo ícone da fila e foi para cima da miniatura, com teste fixando o tamanho. A suíte
inteira passava, porque nenhum teste media dimensão.

**Barra inferior respeita a área segura** (`viewport-fit=cover` + `env(safe-area-inset-bottom)`).
Medido: inset de 48px, botão 12px acima dela.

**Diálogos vão para o `body` por portal:** `backdrop-blur` na barra cria bloco de contenção, e um
`fixed` dentro dela sai da tela.

---

## Armadilhas medidas (não repita)

**pdf.js**

- Publique **cinco coisas**, não só o worker: `pdf.worker.min.mjs`, `standard_fonts/`, `cmaps/`,
  `wasm/`, `iccs/` (4,6 MB). Faltando qualquer uma, a miniatura some **só em alguns documentos**.
- Uma chamada só: `configurePdfjs(baseUrl)`. Dentro de Worker, use URL absoluta.
- **O worker do pdf.js nunca sobe aqui** — `PDFWorker.#initialize` lê `window.location`, que lança
  em Worker; ele cai no "fake worker", e o aviso no log é **esperado**. Consequência absoluta:
  **nada no desenho pode depender de DOM** → `CanvasFactory`/`FilterFactory` próprias,
  `useSystemFonts: false`, `disableFontFace: true`, `useWorkerFetch: true` (o padrão lê
  `document.baseURI`).
- Só padrão, sombreado e transparência pedem canvas auxiliar. **Teste com _tiling pattern_** —
  uma página com JPEG passa mesmo com a fábrica quebrada.

**Android**

- `tauri-plugin-fs` grava por descritor destacado (`detachFd()`): o documento fica registrado com
  **0 bytes** e é ilegível para qualquer app. Por isso existe `plugins/saf-save`, e o `fs` **saiu
  do produto**.
- O corpo do comando chega **binário no desktop e como array JSON no Android**. Aceite os dois.
- `gen/android` é **versionado**: carrega a remoção da permissão INTERNET. Regenerar exige
  reaplicá-la.
- `android init` grava no `BuildTask.kt` o executável com que o CLI foi chamado — use `pnpm` (o
  script `android.ps1` cuida disso), senão o Gradle falha com `Cannot find module ...\tauri`.
- Gradle 8.x não compila script sobre **JDK 25** (`major version 69`), e `gradlew --version`
  funciona mesmo assim. Use Temurin 21; `android.ps1` escolhe por versão medida.
- `[Parameter()]` num script PowerShell faz o `-Debug` comum engolir o `--debug`.
- Aceite arquivo por tipo **ou** extensão: o seletor entrega PDFs com MIME vazio, e exigir só o
  tipo os descartava em silêncio.

**Verificação (medir errado é pior que não medir)**

- O evento `download` do Playwright **não prova** que o arquivo foi salvo no aparelho: por CDP ele
  recolhe o arquivo para o PC. Pergunte ao sistema de arquivos.
- Cabeçalho `%PDF` não basta: confira o fim (`%%EOF`). E espere o tamanho **estabilizar** — a
  gravação é assíncrona.
- `window.__TAURI_INTERNALS__.invoke` é `writable: false`: a substituição **não lança**, é
  ignorada em silêncio.
- `uiautomator dump` durante animação devolve árvore vazia; insista até o seletor **fechar**.
- **Meça o botão, não a caixa que o contém.** O rodapé da lupa vive num `fixed inset-0`: o fundo
  dele coincide sempre com a borda da janela, e medi-lo acusava invasão da área do sistema mesmo
  com o afastamento correto. Botão em 597px de 693px com inset 48px é o que prova.
- A janela de espera do salvamento precisa ser **generosa** (90 s): o seletor cria o documento
  antes de a geração começar, e dividir ou compactar no celular passa de 20 s. Janela curta
  relatava "NADA gravado" para operação que só estava demorando.
- Para saber se o seletor fechou, pergunte pelo `topResumedActivity`: `dumpsys activity
activities` continua listando o `documentsui` na pilha, e o relatório acusava seletor aberto
  logo abaixo de um arquivo gravado corretamente.
- Bypass de CSP por CDP **vaza entre execuções**: desligue ao terminar e reinicie o app antes de
  medir.
- **Compactar pode aumentar o arquivo.** Rasterizar página de texto vetorial produz a foto de
  uma página quase em branco: medido no aparelho, 2 kB viraram 9 kB enquanto a tela dizia "0%
  menor". A via forte é para documento digitalizado; quando o resultado cresce, a tela avisa e
  aponta a via sem perda. Um teste chamado "produz um PDF menor" passou 5,7× maior por nunca
  ter olhado o tamanho.
- Nunca deixe servidor manual na porta 4173: o Playwright o reaproveita **sem rebuildar**.
- Daemons do Gradle seguram o canal de saída depois de terminar — confira o artefato em disco em
  vez de esperar o aviso da tarefa.

**Memória** — orçamento: Windows 32 bits dá **~2 GB por processo**, e a tela e os workers
dividem o mesmo processo. Medido com dois PDFs escaneados de 200 páginas (287 MB): juntar foi de
1.547 para 969 MB vivos; a segunda junção, de 1.835 para 969.

- **`page.cleanup()` depois de todo desenho e extração de texto.** Sem isso o pdf.js guarda a
  imagem decodificada de cada página (~8 MB numa escaneada): rolar a grade somava 1 GB.
- `pdfjsDocumentOptions` **copia** os bytes por padrão (`new Uint8Array(pdf)`). O worker de
  renderização abre com `adopt: true` e **não guarda cópia própria**; ofuscar e OCR pedem
  `renderer.getData()` na hora.
- `buildComposition` carrega **uma origem por vez** e a solta após copiar: o pdf-lib copia o
  conteúdo dos streams ao interpretar e de novo ao copiar páginas.
- Operação pesada passa `around: usePageMemoryRelease()` à geração: o worker de renderização
  solta os documentos depois de escolhido o destino e os reabre **depois de gravar**. Pedidos
  de miniatura nesse intervalo **esperam**, não falham.
- **"Salvar de novo" nunca guarda bytes**: copia o arquivo já gravado (`copy_saved`). Origem
  igual ao destino é no-op — abrir em `"wt"` zeraria a origem antes de lê-la.
- **Régua:** memória privada do processo, numa máquina 64 bits com RAM sobrando, mistura lixo
  não coletado (o mesmo código deu 1.568 e 1.847 MB). Use
  `performance.measureUserAgentSpecificMemory()`: exige COOP+COEP e o Chromium completo
  (`channel: 'chromium'`) — o headless-shell padrão do Playwright não a tem.

**Código**

- **pdf-lib grava todo objeto do contexto, alcançável ou não** — e `context.delete()` foi medido
  sem efeito. Reescrever o `Contents` e apontar para um stream novo deixava o antigo no arquivo:
  remover a camada de OCR fazia o PDF **crescer** 178 bytes. A saída é copiar as páginas para um
  documento novo (`copyPages`), que só carrega o alcançável — ao custo de marcadores e links.
- `pushOperators` embrulha cada palavra num par `q`/`Q`. Podar só o `BT ... ET` deixa os pares
  órfãos: 1.200 bytes por página de 300 palavras.
- `pdf-core`: imports relativos **sem** extensão (o Vitest reescreve, o Turbopack não).
- Cancelamento cooperativo exige ceder o laço de eventos (`MessageChannel`, não `setTimeout`).
- Pastas iniciadas por `_` são privadas no App Router e nunca viram rota.
- Regra do `.gitignore` sem `/` inicial casa em **qualquer** nível: `documentos/` ignorava também
  `app/spike/documentos/`, e arquivo novo ali sumiria em silêncio. Ancore na raiz.
- Cada worker recebe **sua cópia** dos bytes: a transfer list destaca o buffer.
- `font.encodeText` **não lança** para caractere fora da fonte — substitui em silêncio.
- `catch` que engole a causa já custou caro **quatro vezes**. Mensagem traduzida na tela,
  `console.error` com a causa.

---

## Erros, lint e testes

**Erros do núcleo.** `PdfCoreError` com `code` + `params`; a `message` é só log e **nunca** vai à
tela. A UI resolve por código (`t(coreErrorKey(cause), coreErrorParams(cause))`), e código
desconhecido cai em `coreError.unknown`. Campos próprios não sobrevivem ao clone estruturado — por
isso viajam explicitamente no envelope. **Código novo:** adicione em `ErrorParamsByCode`, em
`CORE_ERROR_CODES` e a chave `coreError.<CODE>` nos dicionários; há teste de cobertura. Testes de
erro asseveram o **código**, nunca o texto.

**ESLint.** Configuração compartilhada com análise de tipos. As Regras de Ouro viraram regras:
`fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` proibidos, URL `http(s)` que não seja localhost
proibida, e qualquer arquivo em `src/app/api/**` falha. Os testes E2E são isentos — é neles que se
verifica a ausência de rede. **Verificado que as três detectam.**

**Navegadores.** Chromium completo; **o WebKit do Playwright não tem `OffscreenCanvas`**
(limitação do build, não do Safari) e pula por capacidade medida em `e2e/capabilities.ts`. Firefox
é opcional (`PDFKITTY_FIREFOX=1`) e não inicia nesta máquina (`mozglue`). Espera das asserções em
15 s: tudo ali é estado eventual, e 5 s produzia falha intermitente.

**Rotas de spike.** `page.spike.tsx` só vira rota com `PDFKITTY_SPIKE=1`.
`pnpm verify:spike-excluded` faz um build limpo e falha se algo vazar (fora do `pnpm test`: custa
um build inteiro).

---

## Backlog

| ID    | Feature                  | Restrição que não pode ser esquecida                                                      |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------- |
| US-01 | Organização de páginas   | Multi-arquivo; mesclar páginas **entre** PDFs; reordenar por arraste **e** por botão      |
| US-02 | Fusão, divisão, extração | Extrair = 1 arquivo; dividir = vários, em pacote único. Seleção da grade preenche o campo |
| US-03 | Ofuscação                | Remover do content stream. Irreversível é requisito jurídico — testar extraindo texto     |
| US-04 | OCR local                | Tesseract.wasm em worker, PT-BR, barra de progresso obrigatória                           |
| US-05 | Assinatura ICP-Brasil    | A1 `.pfx` só em memória; chave nunca persistida, logada ou transmitida                    |
| US-06 | Busca de campo aberto    | Destaca (não filtra) páginas com ≥1 ocorrência, entre PDFs distintos                      |

**Estado (03/09/2026):** backlog completo (US-01 a US-08), verificado por dentro do pacote no
Windows e no Android real. 215 testes unitários, 200+ E2E, lint e typecheck verdes. Tudo
commitado e sincronizado com `origin/main`.

**Fase atual:** validação com o administrativo da escola, em Windows e Android, antes de
publicar. Os artefatos de teste ficam em `Desktop/PDFKitty-para-testar/`.

**Próxima fase — publicação.** Nesta ordem, e nada disso começou:

1. **Keystore de release** para a Play Store. É material sensível: quem gera é o usuário, e a
   senha nunca entra no repositório nem em log. Perder o keystore após publicar **impede
   atualizar o app para sempre**.
2. **APK/AAB de release assinado.** Atenção: o `verify:android` **não roda contra release** — só
   o build de debug expõe o socket de depuração. Medir antes de assinar.
3. **Microsoft Store**: exige assinatura de código (o SmartScreen hoje alerta "editor
   desconhecido") e empacotamento MSIX, que o Tauri gera mas ainda não foi exercitado aqui.
4. Política de privacidade e ficha da loja — o argumento de venda é a Regra de Ouro 1, e a
   ausência da permissão `INTERNET` é verificável por qualquer auditor.

**Ainda não existe:** keystore e APK de release, MSIX, build macOS/Linux, carimbo AD-RT,
conformidade DOC-ICP-15, via cirúrgica de ofuscação.

---

## Rastreabilidade (antes e depois de toda mudança)

Fonte única: `packages/rastreabilidade/src/matriz.ts` — 13 requisitos (US-01..08, RNF-01..05),
9 funcionalidades (`F-*`) e 16 componentes (`C-*`), cada um com seus arquivos (por padrão de
caminho), dependências, testes e verificação manual. Visão: `docs/rastreabilidade.html`.

- **Antes de mexer:** ache o componente no mapa e veja quantas funcionalidades ele afeta.
- **Depois:** `pnpm test:impact`. Componente alterado contamina, de forma transitiva, quem depende
  dele; teste alterado roda só a si mesmo; documentação não roda nada; configuração,
  dependências e apoio de teste (`exigemTudo`) rodam tudo. Typecheck e integridade, sempre.
- **O `git push` roda isso sozinho** (`core.hooksPath = .githooks`, ativado pelo `prepare` do
  `pnpm install`) e recusa o envio se algum teste impactado falhar.
- **Arquivo novo exige linha na matriz.** `integridade.test.ts` falha com arquivo de produto sem
  dono, dois donos, teste que ninguém cita, teste citado que não existe, padrão que não casa com
  nada, funcionalidade sem E2E, rota sem página, requisito sem quem o atenda e ciclo entre
  componentes — e com `docs/` desatualizado. Dois donos para um arquivo é sinal de que ele faz
  duas coisas: divida o arquivo, não a regra.
- `invariantes.test.ts` fixa as Regras de Ouro que moram na configuração: Android sem INTERNET,
  CSP fechada, ponte sem `fs:`, `.gitignore` barrando `.pfx`/`.p12`/`/documentos/`, nenhum
  certificado ou keystore versionado.
- Testes nativos do plugin: `cargo test --manifest-path apps/desktop/plugins/saf-save/Cargo.toml`
  (com `CARGO_TARGET_DIR=apps/desktop/src-tauri/target` para reaproveitar a compilação do app).
- O pacote roda direto no Node 24 (type stripping): imports com `.ts` e só sintaxe apagável. Sem
  dependência de glob, de propósito — roda num hook, numa máquina que pode ser nova.

---

## Regras de trabalho

- **Baixo acoplamento:** UI, estado e workers separados; lógica de PDF não conhece React.
- **Código autodocumentado:** nomes explicam a intenção; comentário só para o "porquê" não óbvio.
- **i18n desde o início:** sem strings hardcoded; adicionar idioma custa um arquivo + registro.
- **Um passo só termina após a implementação E a verificação dos testes.** Não relate concluído
  sem a saída dos testes.
- **Modo Entrevista:** no início de cada fase importante, 1 a 3 perguntas pontuais e **aguarde a
  resposta**. Não gere a estrutura toda de uma vez.
- Ao precisar da atenção do usuário, emita sinal sonoro (permissão concedida):
  `powershell -c "[console]::beep(1200,250);[console]::beep(1600,400)"`
