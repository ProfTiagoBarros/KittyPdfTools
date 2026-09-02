# Histórico de progresso do PDFKitty

Arquivado fora do `CLAUDE.md` para não custar contexto a cada sessão. **Não é documentação de
uso** — é o registro de como cada decisão foi tomada e o que cada defeito custou. Consulte
quando precisar saber _por que_ algo é do jeito que é; as regras em vigor estão no `CLAUDE.md`.

Mantenha atualizado ao final de cada passo.

**Fase 1 — Setup do monorepo (concluída e verificada).** Raiz com `package.json`,
`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`, prettier e git.
pnpm 11.24.0 instalado via `npm i -g` (corepack falhou com EPERM: Node em `Program Files`).

**Fase 2 — Scaffolding do `apps/web` (concluída e verificada).**
Next.js 16.3.3 + React 19.2.8 + Tailwind v4 + Zustand 5, export estático com 7 rotas.
Camada de i18n completa (pt-BR/en), registro de ferramentas e suíte de testes.
Telemetria do Next desativada (`next telemetry disable`) — exigência da Regra de Ouro 1.

Verificação: `typecheck` limpo · **20 testes Vitest** · **10 testes Playwright** · build gera
7 rotas estáticas. Cobertura em 46% (esperado: só i18n e registro têm lógica; a UI é casca).

**Fase 4 — Spike de ofuscação (concluída e verificada).** `packages/pdf-core` criado com
`redactByRasterizing`. **13 testes passando.**

A ofuscação substitui cada página afetada por uma imagem dela mesma, já sem o conteúdo
sensível; páginas não afetadas são copiadas intactas e mantêm o texto pesquisável. Pintar
sobre pixels é destrutivo — não sobra camada por baixo, e a página resultante não contém
operador de texto algum. O documento é sempre reescrito do zero, nunca por atualização
incremental.

O núcleo não conhece canvas: rasterizar é uma **porta** (`PageRasterizer`). O navegador vai
implementá-la com `OffscreenCanvas`; os testes usam `@napi-rs/canvas` em Node.

**Dois achados que valem mais que o código:**

1. O detector de vazamento por bytes **não achava o segredo nem no documento original**. O
   pdf-lib grava texto como string hexadecimal (`<4350462D...> Tj`), não como ASCII. Um
   verificador que só procura a forma literal dá confiança falsa. Agora varre literal, hex e
   UTF-16BE, dentro e fora de streams FlateDecode.
2. Existe **controle negativo**: dois testes constroem a ofuscação falsa (retângulo preto por
   cima) e exigem que as verificações a reprovem. Sem isso não há como saber se a suíte
   detecta alguma coisa.

**Limitação conhecida e registrada:** texto quebrado entre operadores por kerning
(`[(CP)-10(F)] TJ`) escapa da busca contígua por bytes. A verificação por extração de texto
cobre essa lacuna, porque reconstrói a string como um leitor faria.

**Fase 5 — Worker + OffscreenCanvas (concluída e verificada).** A ofuscação roda num Web
Worker real, provada por Playwright em Chromium. **57 testes ao todo:** 13 pdf-core, 27 web
(Vitest), 17 Playwright.

Protocolo UI↔worker é união discriminada com id de correlação e eventos de progresso
(`apps/web/src/workers/protocol.ts`). O `ArrayBuffer` vai e volta por transfer list, sem cópia.
Um worker por operação, encerrado ao final — worker que morre não retém bytes sensíveis.

A geometria do blackout (`src/redaction/blackout.ts`) é **compartilhada** entre Node e
navegador de propósito: se cada ambiente calculasse a própria conversão, a paridade seria
coincidência e o erro apareceria só no que não está sob teste.

**Três achados desta fase:**

1. **O detector de bytes falhou de novo, agora no navegador.** `DecompressionStream` recusa o
   stream inteiro quando há bytes sobrando no fim, onde o `zlib` do Node tolera. A quebra de
   linha antes de `endstream` é exigida pela especificação e não faz parte dos dados. Corrigido
   na extração, mais fallback `deflate-raw`.
2. **Pastas com `_` são privadas no App Router** — `__spike` nunca virou rota, e o
   `pageExtensions` parecia não funcionar.
3. **`node-linker=isolated` barrou um import não declarado** (`pdfjs-dist` a partir do `web`).
   A correção certa não foi declarar a dependência, foi o `pdf-core` encapsular o pdfjs e expor
   `samplePixels`. O `web` não conhece biblioteca de PDF alguma.

**Fase 6 — US-01 e US-02 no pdf-core (concluída e verificada).** **95 testes ao todo:**
51 pdf-core, 27 web (Vitest), 17 Playwright.

Composição declarativa (`src/composition/`) cobre US-01 por inteiro: páginas de origens
diferentes intercaladas num único documento, rotação somada à original, exclusão por ausência
e duplicação por repetição. Divisão (`src/split/`) cobre US-02, incluindo o exemplo literal do
documento de requisitos (`1-5, 8, 11-15`).

Dois testes de controle impedem asserções vazias: o de marcadores confirma que a origem
**tem** outline antes de exigir que o resultado não tenha; o de tamanho verifica que a divisão
realmente produziu mais de um volume antes de checar o limite.

**Fase 7 — US-01/US-02 pelo worker (concluída e verificada).** **107 testes ao todo:**
54 pdf-core, 27 web (Vitest), 26 Playwright.

Worker residente de documentos com registro por id, protocolo tipado com cancelamento, e dois
bancos de prova (`/spike/ofuscar`, `/spike/documentos`) exercitando tudo em Chromium.

**Achado desta fase:** o cancelamento cooperativo não funcionava — o teste falhou e revelou
que `AbortSignal` sozinho é inútil num worker de thread única, porque a mensagem de
cancelamento nunca era lida. Corrigido com `yieldToEventLoop()` entre páginas.

**Fase 8 — Miniaturas e worker de renderização (concluída e verificada).** **111 testes:**
55 pdf-core, 27 web (Vitest), 29 Playwright.

O `redaction.worker.ts` por operação foi substituído pelo `render.worker.ts` residente. A porta
`PageRasterizer` deixou de receber os bytes em cada chamada e passou a estar **ligada a um
documento aberto** — antes o rasterizador reabria e reinterpretava o PDF inteiro a cada página
ofuscada.

**Achado desta fase:** na refatoração eu perdi o relato de progresso da ofuscação, que a Regra
de Ouro 2 exige. Restaurado com `onProgress` em `redactByRasterizing`, propagado pelo worker e
verificado em teste — que reporta por página _ofuscada_, não por página do documento.

**Fase 9 — UI do workspace (concluída e verificada).** **144 testes:** 55 pdf-core, 47 web
(Vitest), 42 Playwright. Verificada também no navegador: carregar PDF, miniaturas, rotação em
lote e exportação.

US-01 funciona ponta a ponta em `/unir`: arrastar arquivos, reordenar por drag-and-drop
(mouse e teclado), girar, duplicar, excluir, desfazer/refazer e exportar o PDF montado.

**Dois achados desta fase:**

1. O teste de arraste por teclado falhou por **tempo**, não por defeito — o dnd-kit precisa de
   um tick entre as teclas para registrar o início do arraste. Ambos os caminhos (mouse e
   teclado) estão cobertos.
2. Substituir a casca de `/unir` deixou a página **sem `h1`**, e três testes de smoke
   acusaram. Corrigido com um cabeçalho `sr-only` — a ferramenta ativa já aparece na sidebar,
   mas sem `h1` quem navega por cabeçalhos fica sem ponto de entrada.

**Fase 10 — UI de dividir (concluída e verificada).** **152 testes:** 55 pdf-core, 47 web
(Vitest), 50 Playwright. Verificada no navegador com PDF real.

`workspace.tsx` virou `workspace-shell.tsx` com slots, mais `organize-tool.tsx` e
`split-tool.tsx`. `PropertiesPanel` e `BottomBar` passaram a aceitar conteúdo da ferramenta.

**Dois tropeços que valem registro:**

1. Deixei um `http-server` rodando em background e o `reuseExistingServer` do Playwright o
   reaproveitou **sem rebuildar** — oito testes falharam contra arquivos velhos. Pior: o
   `TaskStop` não matou o processo, e só encerrar a porta resolveu. **Nunca deixar servidor
   manual na 4173 ao rodar o Playwright.**
2. Um teste meu esperava erro de "intervalo invertido" para `9-4` num documento de 3 páginas,
   mas o núcleo valida existência da página primeiro — comportamento correto, teste errado.

**Fase 11 — Erros traduzíveis (concluída e verificada).** **176 testes:** 55 pdf-core,
69 web (Vitest), 52 Playwright.

Os 22 pontos de erro do núcleo viraram 17 códigos tipados. A única exceção deliberada é o
`DOMException('AbortError')` do cancelamento, que é padrão da plataforma e o worker já traduz
para a mensagem `cancelled`.

Dois testes E2E provam a correção de ponta a ponta: com o navegador em inglês o erro aparece
em inglês **e não contém o texto do núcleo**; em português, aparece em português.

Duas chaves ficaram órfãs na migração (`split.failed`, `error.exportFailed`) e foram removidas.

**Fase 12 — OCR (concluída e verificada).** **189 testes:** 64 pdf-core, 69 web (Vitest),
56 Playwright. Verificado no navegador: um PDF que é só imagem sai pesquisável.

O E2E central prova o requisito de ponta a ponta — gera um "digitalizado" (página contendo
apenas um JPEG com a palavra desenhada), roda o OCR e **busca a palavra dentro do arquivo
baixado**, descomprimindo os streams e cobrindo a forma hexadecimal.

**Fase 13 — Spike de assinatura (concluída e verificada).** **197 testes:** 64 pdf-core,
69 web (Vitest), 64 Playwright.

`/spike/assinar` gera um certificado A1 autoassinado em memória (nada toca o disco, e a regra
do `.gitignore` contra `*.pfx` segue intacta), insere o placeholder, assina e **verifica** a
assinatura resultante. O relatório carrega um campo `stage`, para que uma falha diga em qual
etapa parou — um spike que termina em "não deu" não decide nada.

O plano B (`pkijs` sobre WebCrypto) não precisou ser acionado.

**Fase 14 — UI de ofuscar (concluída e verificada).** **204 testes:** 64 pdf-core, 69 web
(Vitest), 71 Playwright.

O teste central de US-03 não verifica que "apareceu um retângulo preto": marca a região,
exporta e **procura o texto dentro do arquivo gerado**, descomprimindo streams e cobrindo a
forma hexadecimal. Um controle prova que o segredo estava lá antes, e outra asserção confirma
que a página não marcada manteve seu texto.

**As cinco ferramentas agora têm interface.** `/assinar` é a única ainda sem núcleo — a
viabilidade está provada (Fase 13), falta construir.

**Fase 15 — UI de assinar (concluída e verificada).** **220 testes:** 64 pdf-core, 77 web
(Vitest), 79 Playwright.

**O backlog funcional está completo: as cinco histórias têm núcleo e interface.**

O certificado de teste é gerado no processo de teste a cada execução e nunca toca o disco —
`page.evaluate` não resolve especificadores de módulo, então gerar dentro da página não
funciona. A regra do `.gitignore` contra `*.pfx` segue sem exceção.

**Fase 16 — ESLint (concluída e verificada).** **220 testes** seguem passando após as
correções. Lint limpo nos dois pacotes.

**O lint encontrou o que o `tsc` não via:**

1. **`usePdfjsWorker` não era um hook** — o nome com prefixo `use` fazia o React tratá-la como
   tal, e ela é chamada no topo de um worker. Renomeada para `configurePdfjsWorker`.
2. **`setState` síncrono dentro de efeito**, em seis lugares. Cinco viraram correção real
   (remontagem por `key` no visualizador, guarda de montagem desnecessária no diálogo,
   prontidão dos bancos de prova sinalizada pelo gancho global em vez de estado). Um ficou com
   supressão justificada: workers só podem ser criados após a montagem.
3. **Promessa não aguardada e `any` cruzando a fronteira** do node-forge e do pdf.js, agora
   tipados na borda em vez de espalhados.

**Como efeito colateral, os testes E2E entraram no typecheck** — a lacuna que eu havia
flagrado na Fase 8 e nunca fechado.

**Fase 17 — Testes multi-navegador (concluída e verificada).** Chromium 79/79; WebKit 57
passam e 22 pulam por capacidade ausente; Firefox bloqueado pelo ambiente.

O achado principal foi a ausência de `OffscreenCanvas` no WebKit, que derruba toda a
renderização. Virou detecção de capacidade no produto (aviso ao usuário) e nos testes (pulo
com motivo), em vez de falha silenciosa.

**Fase 18 — apps/desktop com Tauri (concluída e verificada).** Compila em ~6 min e gera
`pdfkitty.exe` (14,7 MB), MSI e instalador NSIS.

Verificado por dentro do WebView: interface carregada, workers criados, PDF carregado com
miniatura renderizada, exportação concluída, **zero erros de console**. O CSP restritivo não
quebrou nada.

**Correção de registro:** as fases anteriores diziam "`rustc`/`cargo` não instalados" e
"Tauri bloqueado". Estava errado — o Rust 1.98.0 já estava instalado com toolchain
`stable-x86_64-pc-windows-msvc`; o que faltava era `~/.cargo/bin` no PATH das sessões de
shell, abertas antes da instalação. O bloqueio nunca existiu.

**Fase 19 — Verificação do Safari (parcial).** Não é possível rodar o Safari real nesta
máquina: é Windows, e a Apple descontinuou o Safari para Windows em 2012.

**Evidência documental levantada:** Safari 16.4 (março/2023) adicionou `OffscreenCanvas` 2D,
com renderização transferível para worker. O WKWebView usa o WebKit do sistema. Portanto o
resultado do WebKit do Playwright era um falso alarme sobre o Safari.

**Falta a medição empírica**, que só pode ser feita num aparelho Apple. Criada
`tools/diagnostico-motor.html` para isso.

**Fase 19 encerrada por decisão de escopo (2026-08-31).** Não há aparelho Apple disponível.
O lançamento passa a mirar **Windows e Android**; macOS/iOS/Safari viram evolução futura, com o
raciocínio completo em _Plataformas-alvo_. A medição empírica no WebKit fica pendente **por falta
de aparelho, não por defeito conhecido** — a evidência documental é favorável, e nenhum código
precisa mudar para a Apple entrar depois.

**Fase 20 — Android com Tauri v2 (parcial: motor verificado, exportação em aberto).**
**141 testes unitários** seguem passando (64 pdf-core, 77 web); typecheck e lint limpos. O
Playwright não foi reexecutado porque nenhum arquivo de produto mudou — a fase mexeu em scripts,
configuração e no projeto Android gerado.

Verificado **dentro do WebView do app**, num Galaxy A56 real (Android 16, WebView Chromium 152):
capacidades completas na main thread e no Worker, PDF carregado, miniatura renderizada, zero
erros de console. O CSP restritivo não quebrou workers nem wasm.

**A permissão INTERNET foi removida do manifesto, e o bloqueio foi isolado.** Com o CSP no
caminho a rede já falhava, mas era o CSP quem barrava. Desligando o CSP por CDP — e conferindo
pelas violações de console que ele realmente saiu do caminho — a requisição continua falhando:
quem barra é o sistema operacional. A Regra de Ouro 1 ganhou uma quinta barreira, testada.

**O achado que mais importa é uma falha da minha própria ferramenta.** A primeira versão do
`verify-android.mjs` relatou `EXPORTAR: ok`. Não havia arquivo nenhum no aparelho: o evento de
download vinha do Playwright, que ao conectar por CDP recolhe o arquivo **para o PC**. O
verificador passou a perguntar ao sistema de arquivos do aparelho, e aí disse a verdade — o
`<a download>` não salva nada no Android.

Duas outras armadilhas do mesmo tipo, ambas corrigidas: a tentativa de usar `eval()` como
controle do bypass de CSP não media nada (código injetado por CDP não está sujeito ao CSP da
página), e o bypass **vazava entre execuções**, fazendo a leitura seguinte acusar "zero
violações de CSP" como se o CSP não existisse.

**Exportação resolvida com o seletor do sistema**, nas duas plataformas, por decisão do product
owner. Um ponto de saída só — `savePdf()` — e os plugins entram por `import()` dinâmico, então o
bundle da web não carrega nada do Tauri. Verificado no aparelho: seletor abre, SALVAR grava,
arquivo começa com `%PDF`.

**A armadilha desta etapa também foi de ferramenta.** Tentei substituir
`window.__TAURI_INTERNALS__.invoke` para pular a tela nativa no teste. A propriedade é
`writable: false, configurable: false`, e a atribuição **não lança**: é ignorada em silêncio. O
resultado foi um relatório dizendo "nenhum comando Tauri" enquanto o seletor estava aberto no
celular. A saída foi dirigir o seletor de verdade por `uiautomator`.

**Verificação final da fase:** typecheck e lint limpos, **145 testes unitários** (64 pdf-core,
81 web — quatro novos cobrindo a escolha de caminho do `savePdf`, o cancelamento e a propagação
de falha), **136 testes E2E passando e 22 pulados** (os do WebKit sem `OffscreenCanvas`), mais as
duas verificações por dentro dos apps: Android e Windows salvam um PDF de verdade em disco.

**Fase 21 — Correções de uso e busca (US-06).** Quatro frentes pedidas pelo product owner,
antes de gerar o APK de release.

**O defeito das miniaturas não estava onde parecia.** O relato era "só alguns documentos geram
miniatura". Medi antes de mexer: 90 de 90 páginas pintavam num documento longo, 12 de 12 com três
documentos. A causa era o que os PDFs sintéticos do teste não exercitam — **o produto publicava
apenas o worker do pdf.js**, sem as fontes padrão, os CMaps, o wasm dos decodificadores e os
perfis ICC. Documento que dependesse de qualquer um deles falhava calado.

Consertar isso **revelou dois defeitos escondidos atrás dele**, ambos documentados em _Assets do
pdf.js_: `useSystemFonts` num Worker, e o padrão de `useWorkerFetch` que lê `document.baseURI` —
este derrubava a abertura de qualquer PDF com `document is not defined`, e a pilha do erro não
mostrava um único quadro do pdf.js, porque o `postMessage` atravessa sem pilha. O diagnóstico
saiu de ler o `pdf.mjs` no offset do minificado.

**Dois `catch` que engoliam a causa agora escrevem no console** — o do carregamento e o da
miniatura. É a terceira vez que este projeto paga por isso.

**US-06 nasceu:** busca de campo aberto destacando em amarelo as páginas com pelo menos uma
ocorrência, atravessando PDFs distintos. Destaca e não filtra, de propósito.

**US-01 ganhou o caminho que faltava:** três sensores de arraste em vez de um, e botões
explícitos de mover. Arrastar sozinho exclui quem usa toque ou leitor de tela — e era justamente
no celular que o usuário não conseguia reordenar.

**A barra inferior saiu de trás da navegação do Android** com `viewport-fit=cover` e
`env(safe-area-inset-bottom)` — confirmado no aparelho: inset de 48px, botão 12px acima dela.

**Verificação:** typecheck e lint limpos, **151 testes unitários** (64 pdf-core, 87 web), **146
E2E passando e 22 pulados**, e a verificação por dentro do app Android com três páginas, três
miniaturas, rede bloqueada pelo sistema e o PDF gravado em disco pelo seletor.

**A instabilidade da suíte foi resolvida, não tolerada.** Testes falhavam de forma intermitente,
sempre em `toHaveAttribute` e sempre passando na repetição. A causa era a espera padrão de 5 s
das asserções: tudo ali é estado **eventual** — subir dois workers, abrir o PDF, desenhar — e a
suíte inteira em paralelo nesta máquina não cabe nesse prazo. Passou para 15 s, o que não
enfraquece asserção alguma: o que se afirma continua idêntico, só se dá tempo do estado chegar.
Duas execuções completas seguidas depois disso: 150 passando, 24 pulados, zero falhas.

**Fase 22 — A causa real das miniaturas ausentes (concluída e verificada).** As duas fases
anteriores trataram hipóteses; esta achou o defeito, e só foi possível porque o usuário reproduziu
no aparelho enquanto o `adb logcat` capturava o console do WebView.

**O que o log entregou:** `Setting up fake worker` e
`Cannot read properties of undefined (reading 'createElement')`. Dali saiu a cadeia inteira,
registrada em _O pdf.js roda sem DOM_: o worker próprio do pdf.js nunca sobe (ele lê
`window.location` antes de criá-lo), o produto sempre usou o "fake worker", e a fábrica de canvas
padrão desse caminho depende de `document`.

**Por isso o defeito parecia aleatório:** só padrão de preenchimento, sombreado e transparência
pedem o canvas auxiliar. Texto puro nunca passa por ali — e todos os PDFs sintéticos da suíte
eram de texto puro.

**Duas correções minhas foram descartadas no caminho, e isso vale mais que as que ficaram:**

1. O carregamento do worker do pdf.js por blob. Medido no aparelho: a URL do Tauri realmente
   falha e o blob realmente funciona — **e nada disso importa**, porque o pdf.js morre antes. Era
   código morto disfarçado de correção. Removido, junto com a exceção de lint que ele exigia.
2. O primeiro teste de regressão, com uma página contendo JPEG. **Passava com a fábrica
   quebrada.** Trocado por um _tiling pattern_, com controle negativo confirmando que falha sem o
   conserto.

**A referência de origem virou regra fixa** a pedido do product owner: todo cartão mostra
`arquivo · p. N`, com miniatura ou sem. São dois números distintos e ambos importam — a posição
na montagem e a página no arquivo de origem.

**Fase 23 — Salvar no Android, de verdade (concluída e verificada).** O produto salvava PDFs que
ele mesmo não conseguia reabrir. A causa estava no `tauri-plugin-fs`, não no nosso código, e o
conserto virou um plugin próprio — detalhes em _Gravar no Android_.

**A investigação percorreu quatro hipóteses erradas antes da certa**, e cada uma foi descartada
por medição, não por opinião: arquivo truncado (termina em `%%EOF`), tamanho (49 MB carregam),
conteúdo com imagens (4,9 MB salvam e reabrem), ciclo salvar/reabrir programático (funciona). O
que faltava era percorrer o **seletor real do Android** — o teste automatizado injetava os bytes
direto e nunca passava por ele.

**Dois defeitos meus apareceram no caminho, e ambos são reincidência:**

1. Escrevi um `catch` que engolia a causa do erro de salvamento. É a quarta vez que este projeto
   paga por isso; a tela dizia "não foi possível salvar" e mais nada.
2. O verificador media o arquivo salvo **enquanto ele ainda estava sendo escrito** — o `stat`
   deu 0 MB num arquivo que segundos depois tinha megabytes. Agora espera o tamanho estabilizar.

**Também saiu do produto o `tauri-plugin-fs`**, junto com a permissão de escrita que ele exigia.
Menos superfície, e o defeito não pode voltar por esse caminho.

**Verificação:** typecheck e lint limpos, **154 testes unitários** (64 pdf-core, 90 web), **151
E2E passando** e 25 pulados. No aparelho, o ciclo inteiro: salvar pelo seletor → 1637 bytes
terminando em `%%EOF` → reabrir pelo seletor → aceito, 3 páginas, zero erros.

**Fase 24 — Um comportamento só para gerar arquivo (concluída e verificada).** As cinco
ferramentas faziam a mesma coisa de três jeitos. Agora todas seguem **clicar → escolher o destino
→ ver o progresso → arquivo pronto e ainda ao alcance**, com o detalhamento em _Um fluxo de
geração só_ e _Dividir entrega um pacote_.

Sumiram os botões de "baixar" como segundo passo, e com eles cinco chaves de tradução órfãs. O
`useSavePdf` continua existindo, mas o produto inteiro passou a entrar pelo `useGeneration`.

**Uma recomendação minha caiu por terra no meio do caminho.** Eu havia recomendado que dividir
pedisse uma pasta; ao implementar, descobri que o Tauri não implementa seletor de pasta no
Android (`FolderPickerNotImplemented`). Como a alternativa muda o que o usuário recebe — um
`.zip` em vez de N arquivos —, a decisão voltou ao product owner em vez de ser trocada em
silêncio.

**Verificação:** typecheck e lint limpos, **160 testes unitários** (70 pdf-core, 90 web), **155
E2E passando** e 25 pulados. Os testes de divisão agora **abrem o pacote** e conferem nomes e
cabeçalho de cada volume, em vez de contar itens de lista.

**Ainda não existe:** APK de release assinado, build para macOS e Linux, carimbo de tempo
(AD-RT), conformidade ICP-Brasil, via cirúrgica de ofuscação. Firefox não executa nesta máquina.
