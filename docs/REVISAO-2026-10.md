# Revisão de engenharia — PDFKitty, outubro de 2026

Revisão de **desempenho, uso de memória, arquitetura e segurança** do repositório no estado de
22/10/2026 (`main`, com as mudanças de gestão de memória ainda não commitadas).

Critérios: [`GUIA-SEGURANCA-DESEMPENHO.md`](GUIA-SEGURANCA-DESEMPENHO.md).

---

## Método

- Leitura dos módulos de maior risco: workers e clientes RPC, núcleo de composição, plugin
  nativo (Rust e Kotlin), configuração do Tauri, manifesto Android, fluxo de geração e grade.
- `pnpm audit --prod` com triagem de exposição real de cada aviso.
- Medições feitas **nesta revisão** ou na rodada de memória anterior:
  - memória viva por worker com `measureUserAgentSpecificMemory`, dois PDFs escaneados
    sintéticos de 200 páginas (287 MB);
  - cópia extra em `toTransferable` (o pdf-lib devolve buffer exato);
  - inflação de bytes serializados como array JSON.
- Cada achado diz se é **medido**, **confirmado no código** ou **estimado**.

**Fora do escopo:** pentest dinâmico, revisão do código de `node_modules`, medição em Windows
32 bits real e medição dos achados de Android no aparelho.

---

## Resumo executivo

| Área        | Avaliação                                 | Comentário                                                                                     |
| ----------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Arquitetura | **Boa**                                   | Camadas limpas, núcleo puro, protocolos tipados, erros por código                              |
| Segurança   | **Razoável**                              | Zero rede bem defendido; ponte nativa sem escopo de caminho; dados reais dentro do repositório |
| Memória     | **Boa no Windows, risco alto no Android** | Junção caiu 37% nesta rodada; salvar arquivo grande no Android tende a estourar                |
| Desempenho  | **Razoável**                              | Sem gargalo grave medido; padrões O(n²) e re-renderização em listas grandes                    |
| Processo    | **Fraco**                                 | Excelente suíte de testes, mas sem CI: nada roda sozinho                                       |

### As cinco prioridades

1. **[A1]** Tirar os documentos reais de dentro do repositório. _Minutos._
2. **[A2]** Gravação em blocos no Android, antes de qualquer teste com arquivo real. _Dias._
3. **[A3]** Escopo de caminhos no plugin nativo. _Dias._
4. **[M1]** Remover a cópia extra de `toTransferable`. _Minutos._
5. **[M7]** CI com typecheck, lint, testes e auditoria. _Horas._

---

## Pontos fortes

Para não perder o que já funciona ao corrigir o resto:

- **Zero-Data Transfer por construção.** `output: 'export'` elimina o servidor, o lint proíbe
  `fetch`/`XMLHttpRequest`/`WebSocket`, a CSP fecha `connect-src`, e o Android **não tem a
  permissão `INTERNET`**. Isso foi verificado no aparelho com o CSP desligado.
- **Núcleo puro e direção de dependência garantida.** `pdf-core` não conhece React nem DOM, e
  `node-linker=isolated` impede import não declarado.
- **Processamento pesado fora da main thread**, com transferência de buffers, progresso e
  cancelamento cooperativo que cede o laço de eventos.
- **Taxonomia de erros** (`PdfCoreError` com código e parâmetros). A mensagem crua nunca chega
  à tela.
- **Segredo da assinatura bem confinado.** O `.pfx` e a senha vivem só no worker, que é
  encerrado depois de assinar, e nada é logado. Nenhum material de chave está versionado
  (verificado com `git ls-files`).
- **Testes com poder de detecção:** 215 unitários e 203 E2E, vários com controle negativo, e
  verificação por dentro do app empacotado.
- **Nenhum `innerHTML`, `eval` ou `new Function`** no código da aplicação.

---

## Achados

Severidade: **Alta** (corrigir antes de publicar) · **Média** (próximo ciclo) · **Baixa**
(oportunidade).

### Alta

#### A1 — Documentos pessoais reais dentro do repositório, fora do `.gitignore`

- **Área:** segurança / LGPD · **Evidência:** confirmado (`git check-ignore documentos/`
  responde "não ignorado"; 344 PDFs, 4,8 GB, nomes indicam folha de pagamento).
- **Impacto:** um `git add .` envia dados pessoais de terceiros para o GitHub. Depois do push,
  remover do histórico não desfaz cópias, forks nem caches. É um incidente de LGPD em um único
  comando.
- **Recomendação:** mover a pasta para **fora** do repositório e, de imediato, acrescentar
  `documentos/` ao `.gitignore`. Para medir desempenho, usar fixtures sintéticas com o mesmo
  peso (o gerador desta rodada produziu 200 páginas e 144 MB por arquivo).
- **Esforço:** minutos.

#### A2 — Salvar no Android envia os bytes como array JSON de números

- **Área:** memória / Android · **Evidência:** confirmado no código
  (`plugins/saf-save/src/lib.rs:96`, `InvokeBody::Json(serde_json::Value::Array(...))`). O
  comentário ali registra que o Tauri entrega o corpo assim no Android. Inflação **medida**:
  3,57× em texto JSON. Custo no Rust **estimado**: cada número vira um `serde_json::Value`
  (~32 bytes em 64 bits).
- **Impacto:** um PDF de 100 MB vira ~357 MB de texto no JavaScript e alguns GB de `Value` no
  Rust, coexistindo com o documento original. Em celular, isso estoura a memória bem antes dos
  arquivos reais da escola (média de 14 MB, máximos de 164 MB). Até hoje o salvamento no
  aparelho só foi testado com arquivos de poucos KB, e por isso nunca apareceu.
- **Recomendação:** primeiro **medir** no aparelho com um PDF de 30–50 MB. Depois, trocar o
  transporte por **gravação em blocos**: `begin_write(destino)` → `write_chunk(id, bloco)` →
  `end_write(id)`, com blocos binários (ou base64, 1,33×) de 4–8 MB. O destino fica aberto no
  lado nativo, e nenhum dos lados precisa do arquivo inteiro de uma vez.
- **Esforço:** dias (Rust, Kotlin, cliente e verificação no aparelho).

#### A3 — Plugin nativo aceita qualquer caminho vindo da página

- **Área:** segurança (defesa em profundidade) · **Evidência:** confirmado no código.
  `save_to_uri` grava em qualquer caminho do cabeçalho (`lib.rs:76`, `std::fs::write` em
  `:170`). `copy_saved` copia qualquer arquivo para qualquer destino (`:135`,
  `std::fs::copy` em `:148`). `discard_uri` apaga qualquer URI no Android (`:119`). A
  capacidade `saf-save:default` libera os três para a janela principal
  (`capabilities/default.json:11`).
- **Impacto:** se algum script hostil rodar na WebView, ele ganha leitura e escrita arbitrária
  no disco do usuário. Exemplos: copiar qualquer arquivo legível para outro lugar, ou gravar um
  `.bat` na pasta _Inicializar_ do Windows e obter execução de código. Não encontrei hoje vetor
  de XSS (o React escapa o texto e não há `innerHTML`), e a CSP ainda permite
  `'unsafe-inline'` (M5). É exatamente o cenário que a defesa em profundidade existe para
  cobrir.
- **Recomendação:** o seletor de arquivos passa a ser aberto **pelo Rust**, que registra o
  caminho escolhido num conjunto em memória da sessão. `save_to_uri` e `copy_saved` só aceitam
  destinos registrados, e `copy_saved` só aceita como origem um caminho já gravado pelo
  próprio app. No Android, mesma regra com os URIs devolvidos pelo seletor.
- **Esforço:** dias.

### Média

#### M1 — `toTransferable` sempre copia, inclusive quando não precisa

- **Área:** memória · **Evidência:** **medido**. O pdf-lib devolve `Uint8Array` com
  `byteOffset 0` e tamanho igual ao do buffer, e mesmo assim `messages.ts:77` faz
  `buffer.slice(...)`.
- **Impacto:** toda saída é duplicada no worker no momento de maior uso. Na junção de 287 MB,
  são 287 MB a mais no pico. Afeta juntar, extrair, dividir, compactar, ofuscar e OCR.
- **Recomendação:** devolver `bytes.buffer` quando `byteOffset === 0` e o tamanho bate; fatiar
  só no caso contrário. Acrescentar teste que confira que o buffer foi transferido, e não
  copiado.
- **Esforço:** minutos.

#### M2 — Abrir um arquivo faz o pdf-lib interpretá-lo inteiro só para contar páginas

- **Área:** memória / CPU · **Evidência:** confirmado (`documents.worker.ts:65`,
  `readPageCount` → `PDFDocument.load`).
- **Impacto:** o pdf.js já conta as páginas em `render.open`. A segunda interpretação custa CPU
  e um pico transitório de cerca de uma vez o tamanho do arquivo, por arquivo aberto
  (**estimado** pelo comportamento do pdf-lib, que copia os streams ao interpretar; não medido
  isoladamente).
- **Recomendação:** usar a contagem do pdf.js. Se o objetivo é falhar cedo quando o pdf-lib não
  aceitar o arquivo, validar só a estrutura (cabeçalho e _trailer_). A troca é consciente: o
  erro de um arquivo que o pdf.js lê e o pdf-lib não passa a aparecer ao gerar, não ao abrir.
- **Esforço:** horas.

#### M3 — Clique duplo pode disparar duas gerações ao mesmo tempo

- **Área:** robustez / memória · **Evidência:** confirmado (`generation.ts:111`,
  `if (running) return;` lê **estado** do React).
- **Impacto:** o estado só muda no próximo render. Na web, onde não há seletor modal, dois
  cliques rápidos passam pela mesma guarda, e duas junções simultâneas **somam os picos**.
- **Recomendação:** guarda com `useRef`, marcada de forma síncrona no início de `run`.
- **Esforço:** minutos.

#### M4 — Nenhum limite de tamanho, páginas ou tempo na entrada

- **Área:** segurança (negação de serviço) / memória · **Evidência:** confirmado (nenhum
  limite em `workspace-shell.tsx:73` nem no worker).
- **Impacto:** um arquivo enorme ou forjado (milhares de páginas, objeto de compressão
  explosiva) esgota o processo de 2 GB do Windows 32 bits. O usuário vê o app travar, sem
  mensagem.
- **Recomendação:** limites declarados (por exemplo, por arquivo e pela soma aberta), com
  mensagem clara e traduzida, e aviso antes de operações que vão passar do orçamento. Somar com
  o orçamento de memória do teste automatizado (M7).
- **Esforço:** horas.

#### M5 — CSP com `'unsafe-inline'`, e nenhuma CSP na versão web

- **Área:** segurança · **Evidência:** confirmado (`tauri.conf.json:27-28`; nenhum cabeçalho
  ou `meta` de CSP em `apps/web`).
- **Impacto:** `'unsafe-inline'` em `script-src` anula a principal proteção da CSP contra
  injeção de script, e é a camada que limitaria o dano de A3. A versão web, e o futuro PWA,
  sairiam sem política alguma.
- **Recomendação:** verificar se o Tauri já injeta hashes dos scripts inline do export (o
  `'unsafe-inline'` passaria a ser ignorado pelo navegador e poderia ser removido). Senão,
  gerar hashes no build. Para a web, entregar a mesma política por cabeçalho do servidor,
  acrescentando `base-uri 'self'`. Conferir com teste E2E que um script inline injetado é
  bloqueado.
- **Esforço:** horas a dias.

#### M6 — Dependências: avisos a tratar, e um que bloqueia funcionalidade futura

- **Área:** segurança (cadeia de suprimentos) · **Evidência:** `pnpm audit --prod`, 12 avisos.
  Triagem de exposição real:

  | Pacote                                                    | Severidade            | Exposição real                                                                                                                                   | Ação                                                                                          |
  | --------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
  | `next` 16.3.3                                             | crítica, alta e média | **Nenhuma no produto**: são falhas de servidor (`next/og`, otimizador de imagens, ISR), e o export estático não roda servidor                    | Atualizar para ≥ 16.3.8 por higiene                                                           |
  | `crypto-js` (via `pdfkit` ← `@signpdf/placeholder-plain`) | crítica               | **Baixa**: atinge a criptografia de PDF do pdfkit, que não usamos                                                                                | `pnpm.overrides` para ≥ 4.2.0                                                                 |
  | `node-forge` ≤ 1.4.0                                      | alta                  | **Baixa hoje, alta amanhã**: a falha é na **verificação** de assinatura RSA. Hoje só assinamos; a validação de cadeia do backlog dependeria dela | Bloquear a validação de cadeia até haver correção, ou usar outra biblioteca só para verificar |
  | `sharp`, `source-map-js`                                  | alta                  | **Nenhuma**: ferramentas de build do Next                                                                                                        | Somem com a atualização do Next                                                               |

- **Recomendação:** auditoria no CI (M7) com triagem registrada, e dependências de produção
  com versão exata (`fflate`, `@tauri-apps/api` e `@tauri-apps/plugin-dialog` usam `^`).
- **Esforço:** horas.

#### M7 — Sem integração contínua

- **Área:** processo · **Evidência:** confirmado (não existe `.github/workflows`).
- **Impacto:** typecheck, lint, 418 testes, auditoria e a verificação de rotas de spike só rodam
  quando alguém lembra. As regressões desta sessão foram pegas por testes rodados à mão. Nada
  garante que o próximo commit os rode.
- **Recomendação:** GitHub Actions em runner Windows com typecheck, lint, testes unitários, E2E
  em Chromium, `pnpm audit` e um **teste de orçamento de memória** (a fixture de 2×200 páginas,
  medida com `measureUserAgentSpecificMemory`, falhando acima do limite).
- **Esforço:** horas.

#### M8 — APKs de teste são builds de depuração

- **Área:** segurança / distribuição · **Evidência:** confirmado (todos os APKs desta fase
  foram `--debug`; o `verify:android` depende disso para se conectar à WebView).
- **Impacto:** a build de depuração expõe a WebView a depuração remota. Com acesso USB e
  depuração ativada, qualquer pessoa lê a memória do app, inclusive o documento aberto.
  Aceitável no aparelho do desenvolvedor, não em aparelhos de terceiros.
- **Recomendação:** para testes de campo, entregar build **release** (mesmo antes da assinatura
  da Play). Manter a debug só para verificação automatizada.
- **Esforço:** baixo.

### Baixa

#### B1 — RPC com um _listener_ por requisição

- **Área:** desempenho · **Evidência:** confirmado (`render-client.ts:177`, mesmo padrão em
  `documents-client.ts:119` e `sign-client.ts:60`).
- **Impacto:** cada resposta percorre todos os listeners pendentes. Numa rajada de miniaturas,
  o custo cresce com o quadrado das requisições em voo.
- **Recomendação:** um listener por worker e um `Map<id, pendência>`. Extrair para um cliente
  RPC genérico e tipado, que remove também a duplicação entre os três clientes.
- **Esforço:** horas.

#### B2 — Grade sem `memo`, sem virtualização, e um `<canvas>` vivo por página

- **Área:** desempenho / memória · **Evidência:** confirmado (`page-grid.tsx:97` monta todos os
  cartões com callbacks inline; nenhum `memo` em `components/workspace`). Memória dos canvases
  **estimada**.
- **Impacto:** selecionar uma página re-renderiza todos os 400 cartões. Cada cartão mantém os
  pixels da miniatura no canvas mesmo fora da tela: ~160 KB cada, ~65 MB com 400 páginas, fora
  do cache LRU, que só controla os `ImageBitmap`.
- **Recomendação:** `React.memo` no cartão com callbacks estáveis; virtualizar a grade a partir
  de algumas centenas de páginas, ou zerar o canvas (`width = 0`) quando o cartão se afastar da
  área visível.
- **Esforço:** horas a dias.

#### B3 — pdf.js sem `isEvalSupported: false`

- **Área:** segurança · **Evidência:** confirmado (opção ausente em
  `pdfjs-setup.ts:154`).
- **Impacto:** baixo na versão atual, porque a falha conhecida desse caminho (CVE-2024-4367)
  está corrigida e a CSP do Tauri não libera `eval`. Na web, sem CSP (M5), o pdf.js poderia
  gerar código dinâmico ao desenhar fontes.
- **Recomendação:** `isEvalSupported: false` explícito. Custo nulo.
- **Esforço:** minutos.

#### B4 — Backup automático do Android ligado

- **Área:** privacidade · **Evidência:** confirmado (`AndroidManifest.xml:7`, sem
  `android:allowBackup`, cujo padrão é `true`).
- **Impacto:** os dados da WebView (preferências locais, cache) entram no backup do Google. O
  app não guarda documentos, então o risco é baixo, mas o padrão contradiz a minimização.
- **Recomendação:** `android:allowBackup="false"`. Lembrar que o `gen/android` é versionado e
  a mudança precisa sobreviver a uma regeneração.
- **Esforço:** minutos.

#### B5 — Operações longas sem botão de cancelar

- **Área:** desempenho percebido · **Evidência:** confirmado. O núcleo aceita `AbortSignal`, e
  `GenerationAction` não oferece cancelamento.
- **Impacto:** "compactar até caber" num celular leva minutos, e a única saída é fechar o app.
- **Recomendação:** botão de cancelar no lugar da ação enquanto ela roda, ligado ao sinal que o
  núcleo já respeita.
- **Esforço:** horas.

#### B6 — Worker de renderização com responsabilidades demais

- **Área:** arquitetura · **Evidência:** `render.worker.ts` cuida de miniaturas, texto,
  ofuscação, OCR e compactação.
- **Impacto:** operações longas e miniaturas disputam a mesma thread. Hoje os laços cedem o
  controle e isso não é gargalo, mas cada recurso novo aumenta o acoplamento.
- **Recomendação:** separar um worker de processamento pesado (compactar, ofuscar, OCR) do
  worker de visualização quando o próximo recurso pesado entrar.
- **Esforço:** dias.

#### B7 — Ferramentas de verificação monolíticas e arquivos gerados no versionamento

- **Área:** manutenção · **Evidência:** `verify-android.mjs` tem 979 linhas; construtores de
  PDF sintético estão repetidos em quatro lugares; o `.tauri/` gerado dentro de
  `plugins/saf-save/android` está versionado.
- **Impacto:** a verificação é parte essencial da qualidade deste projeto, e duplicação nela
  produz verificações que divergem sem ninguém perceber.
- **Recomendação:** extrair os auxiliares comuns (fixtures, condução do seletor, medição) para
  um módulo compartilhado entre os verificadores; ignorar o `.tauri/` gerado.
- **Esforço:** horas.

### Limitações conhecidas (já registradas no backlog)

- Assinatura só AD-RB, **sem validação de cadeia** nem conformidade DOC-ICP-15. A validação,
  quando vier, depende de M6 (`node-forge`).
- `splitBySize` faz uma geração por página (custo quadrático em documentos grandes), por
  desenho e com progresso. Uma estimativa por página antes de gerar reduziria as tentativas.

---

## Plano sugerido

| Ordem | Itens          | Por quê nesta ordem                                                                                   |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------- |
| 1     | A1             | Risco legal, custo de minutos                                                                         |
| 2     | M1, M3, B3, B4 | Ganhos certos e baratos, sem decisão de produto                                                       |
| 3     | M7, M6         | Protege tudo o que vier depois                                                                        |
| 4     | A2             | Medir no aparelho, depois gravar em blocos, **antes** do teste de campo no Android com arquivos reais |
| 5     | A3, M5         | Endurecer a fronteira nativa e a CSP juntas, **antes de publicar**                                    |
| 6     | M2, M4, M8, B5 | Robustez com arquivos grandes                                                                         |
| 7     | B1, B2, B6, B7 | Escala e manutenção                                                                                   |
