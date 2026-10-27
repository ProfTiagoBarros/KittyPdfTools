# Matriz de rastreabilidade

> Gerado de `packages/rastreabilidade/src/matriz.ts` por `pnpm rastreabilidade`. **Nao edite a mao.**
> Versao visual: [`rastreabilidade.html`](rastreabilidade.html).

**13** requisitos · **8** funcionalidades · **16** componentes · **27** testes unitarios · **12** specs E2E · **1** suites nativas

## Como usar

```bash
pnpm test:impact            # roda os testes de tudo o que a sua mudanca pode quebrar
pnpm test:impact --listar   # so mostra o que rodaria
pnpm rastreabilidade        # regenera esta pagina depois de mudar a matriz
```

O `git push` roda `pnpm test:impact` sozinho (hook em `.githooks/pre-push`) e recusa o envio se
algum teste impactado falhar.

## Impacto: componente x funcionalidade

`●` usa diretamente · `○` usa por meio de outro componente. Mexer numa linha exige os testes de
todas as colunas marcadas nela.

| Componente | UNIR | DIVIDIR | COMPACTAR | OCR | ASSINAR | OFUSCAR | BUSCA | LUPA | Afeta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C-NUCLEO` | ○ | ● | ● | ● | ○ | ● | ○ | ○ | 8 |
| `C-COMPOSICAO` | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | 8 |
| `C-VERIFICACAO` |  |  |  |  |  | ● |  |  | 1 |
| `C-MENSAGENS` | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | 8 |
| `C-RENDERIZACAO` | ○ | ○ | ● | ● | ○ | ● | ● | ● | 8 |
| `C-DOCUMENTOS` | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | 8 |
| `C-ESTADO` | ● | ● | ● | ● | ● | ● | ● | ● | 8 |
| `C-I18N` | ● | ● | ● | ● | ● | ● | ● | ● | 8 |
| `C-GERACAO` | ● | ● | ● | ● | ● | ● | ○ | ○ | 8 |
| `C-SERVICOS` | ● | ● | ● | ● | ● | ● | ● | ● | 8 |
| `C-INTERVALOS` | ● | ● |  |  |  |  |  |  | 2 |
| `C-GRADE` | ● | ● | ● | ● | ● | ● | ● | ● | 8 |
| `C-CASCA` | ● | ● | ● | ● | ● | ● |  |  | 6 |
| `C-PROTOTIPOS` |  |  |  |  |  |  |  |  | 0 |
| `C-PLATAFORMA` |  |  |  |  |  |  |  |  | 0 |
| `C-RASTREABILIDADE` |  |  |  |  |  |  |  |  | 0 |

## Requisitos

| Requisito | Atendido por | Restricao |
| --- | --- | --- |
| **US-01** Organizacao de paginas | `F-UNIR` `C-GRADE` | Multi-arquivo; mesclar paginas ENTRE PDFs; reordenar por arraste E por botao. |
| **US-02** Fusao, divisao e extracao | `F-UNIR` `F-DIVIDIR` `C-INTERVALOS` | Extrair entrega 1 arquivo; dividir entrega varios num pacote; a selecao da grade preenche o campo. |
| **US-03** Ofuscacao | `F-OFUSCAR` | Remover do content stream, irreversivel. Retangulo preto nao e ofuscacao. |
| **US-04** OCR local | `F-OCR` | Tesseract em worker, PT-BR, barra de progresso obrigatoria. |
| **US-05** Assinatura ICP-Brasil | `F-ASSINAR` | A1 .pfx so em memoria; chave nunca persistida, logada ou transmitida. |
| **US-06** Busca de campo aberto | `F-BUSCA` | Destaca (nao filtra) paginas com pelo menos uma ocorrencia, entre PDFs distintos. |
| **US-07** Compactar | `F-COMPACTAR` | Sem perda ou forte; avisar antes de degradar; alvo de tamanho; avisar quando crescer. |
| **US-08** Lupa na pagina | `F-LUPA` | Ler nome e matricula sem gerar o PDF; navega e reordena; segue a chave, nao a posicao. |
| **RNF-01** Zero-Data Transfer | `F-ASSINAR` `C-CASCA` `C-PLATAFORMA` | Nenhum byte de documento sai do aparelho. Android sem a permissao INTERNET. |
| **RNF-02** Processamento em workers | `F-OCR` `C-MENSAGENS` `C-RENDERIZACAO` `C-DOCUMENTOS` | Trabalho pesado fora da main thread, com progresso e buffers transferidos. |
| **RNF-03** Orcamento de memoria | `F-UNIR` `F-COMPACTAR` `C-COMPOSICAO` `C-RENDERIZACAO` `C-DOCUMENTOS` `C-GERACAO` `C-SERVICOS` `C-GRADE` | Caber em ~2 GB por processo (Windows 32 bits): tela e workers dividem o processo. |
| **RNF-04** Offline-first | `F-OCR` `C-RENDERIZACAO` `C-PLATAFORMA` | Fontes, workers, wasm e traineddata viajam no pacote. |
| **RNF-05** Internacionalizacao | `C-NUCLEO` `C-I18N` | Sem texto fixo na interface; dicionarios completos; erros traduzidos por codigo. |

## Funcionalidades

### `F-UNIR` Unir e extrair

Junta paginas de varios PDFs, reordena, gira, duplica, exclui e desfaz; gera UM PDF com todas as paginas ou so com as escolhidas. /extrair/ redireciona para ca.

- **Rota:** `/unir/`
- **Requisitos:** US-01, US-02, RNF-03
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-INTERVALOS` `C-DOCUMENTOS` `C-COMPOSICAO`
- **Arquivos:** `apps/web/src/app/unir/**`, `apps/web/src/app/extrair/**`, `apps/web/src/components/workspace/organize-tool.tsx`
- **Testes:** E2E `merge.spec.ts`, E2E `workspace.spec.ts`
- **Verificacao manual:** verify:desktop -> CARREGAR, SELETOR, ARQUIVO, EXTRAIR; verify:android -> UNIR SELETOR/ARQUIVO/INTEGRO, REABRIR, LIGACAO, EXTRAIR CONTEUDO

### `F-DIVIDIR` Dividir

Quebra UM PDF, aberto so nesta ferramenta, em varios arquivos por faixa ou por tamanho, num pacote .zip.

- **Rota:** `/dividir/`
- **Requisitos:** US-02
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-INTERVALOS` `C-DOCUMENTOS` `C-COMPOSICAO` `C-NUCLEO`
- **Arquivos:** `apps/web/src/app/dividir/**`, `apps/web/src/components/workspace/split-tool.tsx`, `packages/pdf-core/src/split/{split.ts,archive.ts,index.ts}`
- **Testes:** unitario `split.test.ts`, unitario `archive.test.ts`, E2E `split.spec.ts`, E2E `workspace.spec.ts`
- **Verificacao manual:** verify:desktop -> DIVIDIR; verify:android -> DIVIDIR CONTEUDO

### `F-COMPACTAR` Compactar

Sem perda (reempacota e tira a camada de OCR) ou forte (rasteriza em JPEG), com alvo de tamanho.

- **Rota:** `/compactar/`
- **Requisitos:** US-07, RNF-03
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-DOCUMENTOS` `C-COMPOSICAO` `C-RENDERIZACAO` `C-NUCLEO`
- **Arquivos:** `apps/web/src/app/compactar/**`, `apps/web/src/components/workspace/compress-tool.tsx`, `packages/pdf-core/src/compression/**`
- **Testes:** unitario `invisible-text.test.ts`, unitario `repack.test.ts`, unitario `rasterize-compression.test.ts`, E2E `compress.spec.ts`
- **Verificacao manual:** verify:desktop -> COMPACTAR; verify:android -> SEM PERDA, FORTE AVISO, FORTE x S/PERDA

### `F-OCR` Reconhecer texto (OCR)

Tesseract local em portugues; grava uma camada de texto invisivel e pesquisavel.

- **Rota:** `/ocr/`
- **Requisitos:** US-04, RNF-02, RNF-04
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-RENDERIZACAO` `C-NUCLEO`
- **Arquivos:** `apps/web/src/app/ocr/**`, `apps/web/src/components/workspace/ocr-tool.tsx`, `apps/web/src/workers/ocr.ts`, `packages/pdf-core/src/ocr/**`, `apps/web/scripts/sync-tesseract.mjs`, `apps/web/por.traineddata`
- **Testes:** unitario `text-layer.test.ts`, E2E `ocr.spec.ts`
- **Verificacao manual:** OCR num documento escaneado real, no aparelho, com a barra de progresso

### `F-ASSINAR` Assinar (ICP-Brasil A1)

Assina com certificado A1; chave e senha vivem so num worker descartavel.

- **Rota:** `/assinar/`
- **Requisitos:** US-05, RNF-01
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-MENSAGENS`
- **Arquivos:** `apps/web/src/app/assinar/**`, `apps/web/src/components/workspace/sign-tool.tsx`, `apps/web/src/workers/{sign-client.ts,sign-protocol.ts,sign.worker.ts}`, `apps/web/src/i18n/sign-errors.ts`
- **Testes:** unitario `sign-errors.test.ts`, E2E `sign.spec.ts`, E2E `sign-spike.spec.ts`
- **Verificacao manual:** Assinar com um A1 real e conferir no validador do ITI

### `F-OFUSCAR` Ofuscar

Marca regioes e as destroi no nivel do pixel; o texto nao e mais extraivel.

- **Rota:** `/ofuscar/`
- **Requisitos:** US-03
- **Usa:** `C-CASCA` `C-GRADE` `C-ESTADO` `C-SERVICOS` `C-GERACAO` `C-I18N` `C-RENDERIZACAO` `C-VERIFICACAO` `C-NUCLEO`
- **Arquivos:** `apps/web/src/app/ofuscar/**`, `apps/web/src/components/workspace/redact-tool.tsx`, `apps/web/src/components/workspace/page-viewer.tsx`, `packages/pdf-core/src/redaction/**`
- **Testes:** unitario `rasterize-redaction.test.ts`, E2E `redact.spec.ts`, E2E `redaction-worker.spec.ts`

### `F-BUSCA` Busca de campo aberto

Destaca em amarelo as paginas com o termo, sem acento e sem caixa, entre PDFs.

- **Requisitos:** US-06
- **Usa:** `C-GRADE` `C-RENDERIZACAO` `C-ESTADO` `C-SERVICOS` `C-I18N`
- **Arquivos:** `apps/web/src/components/workspace/search-field.tsx`, `apps/web/src/workspace/search.ts`
- **Testes:** unitario `search.test.ts`, E2E `workspace.spec.ts`

### `F-LUPA` Lupa na pagina

Abre a pagina a 1400 px, navega com setas e move/gira de dentro.

- **Requisitos:** US-08
- **Usa:** `C-GRADE` `C-RENDERIZACAO` `C-ESTADO` `C-SERVICOS` `C-I18N`
- **Arquivos:** `apps/web/src/components/workspace/page-preview.tsx`
- **Testes:** E2E `preview.spec.ts`
- **Verificacao manual:** verify:desktop -> LUPA; verify:android -> LUPA ALVO, LUPA PAG, LUPA ACAO, LUPA AREA

## Componentes

### `C-NUCLEO` Nucleo de PDF: erros, API e utilitarios

Taxonomia de erros por codigo, a API publica do pdf-core, geometria, cessao do laco de eventos e fixtures.

- **Requisitos:** RNF-05
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `packages/pdf-core/src/errors.ts`, `packages/pdf-core/src/index.ts`, `packages/pdf-core/src/geometry.ts`, `packages/pdf-core/src/async.ts`, `packages/pdf-core/src/fixtures.ts`
- **Testes:** unitario `core-errors.test.ts`

### `C-COMPOSICAO` Composicao de paginas (pdf-lib)

Materializa a lista de paginas num PDF em fluxo: uma origem por vez, gravando e soltando o conteudo antes da proxima.

- **Requisitos:** RNF-03
- **Usa:** `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `packages/pdf-core/src/composition/**`
- **Testes:** unitario `build.test.ts`, unitario `writer.test.ts`

### `C-VERIFICACAO` Verificacao de vazamento

Extrai texto e procura bytes num PDF: e como se prova que uma ofuscacao e real.

- **Usa:** `C-NUCLEO`
- **Mexer aqui afeta:** `F-OFUSCAR`
- **Arquivos:** `packages/pdf-core/src/verification/**`, `packages/pdf-core/src/browser/verification.ts`
- **Testes:** E2E `redaction-worker.spec.ts`

### `C-MENSAGENS` Envelope de mensagens entre threads

Formato comum das mensagens dos workers, transporte de erros por codigo e de buffers.

- **Requisitos:** RNF-02
- **Usa:** `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/workers/messages.ts`
- **Testes:** unitario `messages.test.ts`

### `C-RENDERIZACAO` Renderizacao (pdf.js)

Worker que desenha paginas, extrai texto, rasteriza e orquestra ofuscar, OCR e compactar; cliente com cache LRU e liberacao de memoria.

- **Requisitos:** RNF-02, RNF-03, RNF-04
- **Usa:** `C-MENSAGENS` `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/workers/render-client.ts`, `apps/web/src/workers/render-protocol.ts`, `apps/web/src/workers/render.worker.ts`, `packages/pdf-core/src/browser/index.ts`, `packages/pdf-core/src/browser/pdfjs-setup.ts`, `packages/pdf-core/src/browser/renderer.ts`, `packages/pdf-core/scripts/copy-pdfjs-assets.mjs`
- **Testes:** E2E `workspace.spec.ts`, E2E `preview.spec.ts`
- **Verificacao manual:** verify:desktop -> CARREGAR, LUPA; verify:android -> CARREGAR, LUPA

### `C-DOCUMENTOS` Worker de documentos (pdf-lib)

Dono dos bytes de cada arquivo aberto: compoe, extrai e divide.

- **Requisitos:** RNF-02, RNF-03
- **Usa:** `C-MENSAGENS` `C-COMPOSICAO` `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/workers/documents-client.ts`, `apps/web/src/workers/documents-protocol.ts`, `apps/web/src/workers/documents.worker.ts`
- **Testes:** E2E `documents-worker.spec.ts`

### `C-ESTADO` Estado da composicao

Modelo puro da grade e stores Zustand por contexto: o da sessao e o proprio do Dividir, com paginas, selecao e desfazer.

- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/workspace/model.ts`, `apps/web/src/workspace/store.ts`
- **Testes:** unitario `store.test.ts`

### `C-I18N` Internacionalizacao

Dicionarios, deteccao de idioma e traducao de erros do nucleo.

- **Requisitos:** RNF-05
- **Usa:** `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/i18n/core-errors.ts`, `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/locale-hydrator.tsx`, `apps/web/src/i18n/messages/**`, `apps/web/src/i18n/registry.ts`, `apps/web/src/i18n/store.ts`, `apps/web/src/i18n/use-translation.ts`
- **Testes:** unitario `core-errors.test.ts`, unitario `registry.test.ts`, unitario `use-translation.test.tsx`

### `C-GERACAO` Fluxo de geracao e gravacao

Destino antes de gerar, progresso, aviso de operacao demorada, ultima geracao, gravacao em pedacos pelo plugin proprio (Rust + Kotlin) e copia do arquivo ja salvo.

- **Requisitos:** RNF-03
- **Usa:** `C-I18N` `C-NUCLEO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/lib/generation.ts`, `apps/web/src/lib/save-pdf.ts`, `apps/web/src/components/workspace/generation-action.tsx`, `apps/web/src/workspace/long-operation.ts`, `apps/web/src/components/workspace/long-operation-notice.tsx`, `apps/desktop/plugins/saf-save/src/**`, `apps/desktop/plugins/saf-save/android/src/**`, `apps/desktop/plugins/saf-save/android/{build.gradle.kts,settings.gradle,consumer-rules.pro}`, `apps/desktop/plugins/saf-save/{Cargo.toml,build.rs}`, `apps/desktop/plugins/saf-save/permissions/default.toml`
- **Testes:** unitario `save-pdf.test.ts`, unitario `generation.test.tsx`, unitario `long-operation.test.tsx`, E2E `workspace.spec.ts`, nativo `apps/desktop/plugins/saf-save/Cargo.toml`
- **Verificacao manual:** verify:desktop -> ARQUIVO (seletor Salvar como); verify:android -> UNIR SELETOR/ARQUIVO/INTEGRO (gravacao pelo SAF)

### `C-SERVICOS` Workers da sessao e liberacao de memoria

Cria os workers uma vez por sessao e solta as paginas da renderizacao durante operacoes pesadas.

- **Requisitos:** RNF-03
- **Usa:** `C-RENDERIZACAO` `C-DOCUMENTOS` `C-ESTADO` `C-GERACAO`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/workspace/services.tsx`
- **Testes:** E2E `workspace.spec.ts`, E2E `preview.spec.ts`

### `C-INTERVALOS` Intervalos de paginas e selecao

Gramatica `1-3, 7-8` (base 1 na entrada, base 0 na saida) e o vinculo de mao dupla entre campo e grade.

- **Requisitos:** US-02
- **Usa:** `C-NUCLEO` `C-ESTADO` `C-I18N`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR`
- **Arquivos:** `packages/pdf-core/src/split/page-ranges.ts`, `apps/web/src/workspace/page-spec.ts`, `apps/web/src/components/workspace/page-range-field.tsx`
- **Testes:** unitario `page-ranges.test.ts`, unitario `page-spec.test.ts`, E2E `merge.spec.ts`, E2E `split.spec.ts`

### `C-GRADE` Grade de paginas e miniaturas

Cartoes reordenaveis, miniaturas sob demanda e nunca vazias, desenho com rotacao compartilhado com a lupa.

- **Requisitos:** US-01, RNF-03
- **Usa:** `C-ESTADO` `C-SERVICOS` `C-I18N`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR` `F-BUSCA` `F-LUPA`
- **Arquivos:** `apps/web/src/components/workspace/page-grid.tsx`, `apps/web/src/components/workspace/page-card.tsx`, `apps/web/src/components/workspace/page-thumbnail.tsx`, `apps/web/src/lib/draw-page.ts`
- **Testes:** unitario `page-thumbnail.test.tsx`, E2E `workspace.spec.ts`
- **Verificacao manual:** verify:android -> LUPA ALVO (alvo de toque de 44 px)

### `C-CASCA` Casca do workspace e navegacao

Layout, pagina inicial, barra lateral, area de arquivos, barra inferior com area segura, registro de ferramentas.

- **Requisitos:** RNF-01
- **Usa:** `C-GRADE` `C-SERVICOS` `C-ESTADO` `C-I18N`
- **Mexer aqui afeta:** `F-UNIR` `F-DIVIDIR` `F-COMPACTAR` `F-OCR` `F-ASSINAR` `F-OFUSCAR`
- **Arquivos:** `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/workspace/workspace-shell.tsx`, `apps/web/src/components/workspace/tool-sidebar.tsx`, `apps/web/src/components/workspace/bottom-bar.tsx`, `apps/web/src/components/workspace/dropzone.tsx`, `apps/web/src/components/workspace/properties-panel.tsx`, `apps/web/src/components/ui/**`, `apps/web/src/tools/registry.ts`, `apps/web/src/lib/capabilities.ts`, `apps/web/src/lib/cn.ts`
- **Testes:** unitario `registry.test.ts`, E2E `smoke.spec.ts`, E2E `workspace.spec.ts`
- **Verificacao manual:** verify:desktop -> CAPACIDADES, WORKERS; verify:android -> AREA SEG (barra inferior acima da area do sistema)

### `C-PROTOTIPOS` Rotas de prototipo (spikes)

Paginas que exercitam os workers isolados; so viram rota com PDFKITTY_SPIKE=1.

- **Usa:** `C-DOCUMENTOS` `C-RENDERIZACAO` `C-VERIFICACAO`
- **Arquivos:** `apps/web/src/app/spike/**`, `apps/web/src/config/page-extensions.ts`, `apps/web/scripts/verify-spike-excluded.mjs`
- **Testes:** unitario `page-extensions.test.ts`, E2E `documents-worker.spec.ts`, E2E `redaction-worker.spec.ts`, E2E `sign-spike.spec.ts`
- **Verificacao manual:** pnpm verify:spike-excluded (build limpo sem rotas de spike)

### `C-PLATAFORMA` Empacotamento Tauri (Windows e Android)

Configuracao do Tauri e CSP, capacidades da ponte nativa e o projeto Android sem a permissao INTERNET.

- **Requisitos:** RNF-01, RNF-04
- **Arquivos:** `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/**`, `apps/desktop/src-tauri/{Cargo.toml,Cargo.lock,build.rs}`, `apps/desktop/src-tauri/src/**`, `apps/desktop/src-tauri/gen/**`
- **Testes:** unitario `invariantes.test.ts`
- **Verificacao manual:** pnpm --filter desktop package + verify:desktop (pacote Windows inteiro); android.ps1 build --debug --apk + verify:android (REDE e REDE s/CSP bloqueadas)

### `C-RASTREABILIDADE` Matriz de rastreabilidade

Esta matriz, o calculo de impacto, o hook de pre-push e a pagina gerada.

- **Arquivos:** `packages/rastreabilidade/src/**`
- **Testes:** unitario `modelo.test.ts`, unitario `integridade.test.ts`
