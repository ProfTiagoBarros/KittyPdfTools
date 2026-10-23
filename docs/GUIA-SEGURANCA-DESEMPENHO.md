# Guia de engenharia: segurança e desempenho

Regras para escrever e revisar código no PDFKitty — um produto que processa **documentos
pessoais não confiáveis**, inteiramente no aparelho, em Web Workers, atrás de uma ponte nativa
(Tauri) e em máquinas que vão de um celular a um Windows 32 bits com 2 GB por processo.

Cada regra traz o **porquê**. Regra sem porquê vira ritual e é a primeira a ser quebrada sob
pressão de prazo.

---

## 1. Princípios

1. **Defesa em profundidade.** Nenhuma barreira é suficiente sozinha. Projete supondo que a
   camada de cima falhou: se um script hostil rodar na WebView, o que ele consegue alcançar?
2. **Menor privilégio.** Cada componente recebe só a capacidade de que precisa — e a capacidade
   é restrita no lado que **não** pode ser comprometido (o nativo), não no que pode (a página).
3. **Falhar fechado.** Na dúvida, recuse, preserve ou pare. Apagar conteúdo real é irreversível;
   deixar de economizar bytes não é.
4. **Medir antes de otimizar, e medir com a régua certa.** Uma medição errada é pior do que
   nenhuma, porque dá confiança ao que está quebrado.
5. **Orçamento explícito.** Desempenho e memória têm limite declarado, e o limite tem teste.

---

## 2. Segurança

### 2.1 Modele a ameaça antes de defender

Para cada funcionalidade, responda por escrito:

| Pergunta                                   | Exemplo neste produto                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Que **dado** está em jogo?                 | O PDF (pessoal, às vezes sigiloso), a chave A1 e sua senha                                |
| Quem é o **adversário**?                   | PDF malicioso; script injetado na WebView; quem pega o aparelho; dependência comprometida |
| Qual **fronteira** ele precisa atravessar? | Parser de PDF → worker → tela → ponte IPC → disco                                         |
| O que acontece se a fronteira **ceder**?   | Leitura de outros arquivos, gravação fora do lugar, vazamento de dado                     |

Use STRIDE como lista de verificação: _Spoofing, Tampering, Repudiation, Information
disclosure, Denial of service, Elevation of privilege_.

### 2.2 Toda entrada é hostil

O PDF é **código de terceiros** que o produto interpreta. Trate-o assim:

- **Limite o que aceita:** tamanho máximo, número de páginas, tempo de processamento. Sem
  limite, um arquivo forjado esgota a memória — num processo de 2 GB isso é fácil.
- **Interprete em isolamento:** parsers rodam em worker, nunca na thread da interface. Uma
  falha ali derruba o worker, não a tela.
- **Desligue o que não usa:** avaliação dinâmica de código (`isEvalSupported: false` no pdf.js),
  formulários XFA, JavaScript embutido no PDF.
- **Valide no ponto de uso, não só na borda.** O intervalo de páginas é conferido contra o
  documento real no momento de copiar, não só no campo de texto.
- **Nunca** monte HTML com conteúdo vindo do arquivo (`innerHTML`, `dangerouslySetInnerHTML`).
  O React escapa texto; não contorne isso.

### 2.3 XSS e CSP

- CSP **estrita**: `default-src 'self'`, sem `unsafe-eval`, e sem `unsafe-inline` em
  `script-src` — use hashes ou nonces gerados no build.
- `connect-src` lista explicitamente o que pode sair. Para este produto, **nada** sai.
- `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`.
- A versão web (e o futuro PWA) precisa da **mesma** política, entregue por cabeçalho do
  servidor — o export estático não carrega CSP sozinho.

### 2.4 A ponte nativa é a fronteira mais valiosa

Um comando IPC dá à página um poder que o navegador nunca daria: tocar o disco. Por isso:

- **Capacidades mínimas** (`capabilities/*.json`): só os comandos usados, só na janela que usa.
- **Valide no lado nativo.** O Rust/Kotlin nunca confia em um caminho vindo do JavaScript.
  O padrão seguro é: **o nativo abre o seletor, guarda o caminho escolhido, e os comandos de
  escrita só aceitam caminhos que ele mesmo guardou**. Assim, nem um script injetado consegue
  escrever na pasta de inicialização do Windows.
- **Operações destrutivas exigem prova de intenção:** abrir para escrita (`"wt"`) trunca —
  confira se origem e destino não são o mesmo arquivo antes.
- Erros nativos voltam como **código**, não como mensagem crua do sistema.

### 2.5 Segredos e criptografia

- Segredo existe **só em memória**, no menor escopo possível, e morre junto com o contexto que
  o usa (worker de assinatura encerrado após assinar).
- **Nunca** logar, persistir, transmitir ou incluir em mensagem de erro: senha, chave, conteúdo
  de documento, nome de arquivo do usuário em telemetria.
- Não implemente criptografia. Use bibliotecas mantidas e **acompanhe os avisos delas** — uma
  falha de verificação de assinatura numa dependência vira falha sua no dia em que você
  começar a verificar.

### 2.6 Cadeia de suprimentos

- Lockfile versionado; versões **exatas** para dependências de produção.
- `pnpm audit` em todo PR, com triagem escrita: o aviso afeta o produto, ou só o servidor de
  desenvolvimento? Contagem de alertas não é medida de risco — exposição é.
- Dependência transitiva vulnerável sem correção upstream → `pnpm.overrides`.
- Prefira menos dependências. Cada uma é código de terceiros com acesso total ao processo.

### 2.7 Dados pessoais (LGPD)

- **Minimização:** o produto não guarda o que não precisa. Arquivo gerado é gravado onde o
  usuário escolheu, e a memória o solta.
- **Nada de dado real no repositório**, nem em pasta "temporária". Use fixtures sintéticas com
  o mesmo peso e a mesma forma. Toda pasta de dados reais vai para o `.gitignore` **antes** do
  primeiro arquivo entrar nela.
- No Android, desative o backup automático (`allowBackup="false"`) se não houver motivo para ele.

### 2.8 Build e distribuição

- **Build de depuração nunca chega ao usuário final.** Ela expõe a WebView a depuração remota:
  com acesso USB, qualquer um lê a memória do app — inclusive o documento aberto.
- Assine o código (Windows e Android). Executável sem assinatura ensina o usuário a clicar em
  "executar assim mesmo".
- O artefato entregue é conferido por **hash**, não por nome ou data.

### 2.9 Erros e logs

- Na tela: mensagem traduzida, sem detalhe técnico.
- No log: a **causa** completa — `catch` que engole a causa custa horas de diagnóstico.
- No log, **nunca** o conteúdo do documento nem segredos.

---

## 3. Desempenho e memória

### 3.1 Tenha um orçamento, e um teste que o defenda

| Ambiente           | Limite prático                                                   |
| ------------------ | ---------------------------------------------------------------- |
| Windows 32 bits    | ~2 GB por processo — **tela e workers dividem o mesmo processo** |
| Celular de entrada | 2–4 GB de RAM total, com o sistema disputando                    |
| Main thread        | Nenhuma tarefa > 50 ms enquanto o usuário interage               |

O orçamento vira teste automatizado com fixture realista (ex.: dois PDFs escaneados de 200
páginas). Sem teste, a próxima mudança devolve o que a anterior economizou.

### 3.2 Meça com a régua certa

- **Memória privada do processo** numa máquina com RAM sobrando inclui lixo ainda não coletado
  e oscila centenas de MB entre execuções do mesmo código.
- **Memória viva** (`performance.measureUserAgentSpecificMemory()`, que força a coleta e separa
  por worker) é o que decide se cabe num processo limitado. Exige isolamento de origem
  (COOP + COEP).
- Compare **antes e depois com a mesma régua e a mesma fixture**. Uma melhoria só existe se
  aparece nessa comparação.
- Desconfie da medição que **concorda** com você tanto quanto da que discorda: confira se ela
  tem poder de detecção (sabote de propósito e veja se acusa).

### 3.3 Conte as cópias

Em processamento de documentos, o custo dominante é **quantas vezes o arquivo existe ao mesmo
tempo**. Para cada operação, desenhe o caminho dos bytes e conte:

- `ArrayBuffer` viaja por **transfer list**; copie só quando dois donos precisarem de verdade.
- Não copie um buffer que já tem o tamanho exato "por garantia".
- Bibliotecas copiam por conta própria (o pdf-lib copia streams ao interpretar e ao copiar
  páginas). Carregue uma origem por vez e solte-a antes da próxima.
- Não guarde resultados grandes "por conveniência". Se o arquivo já está no disco, o disco é o
  cache.
- Formato de transporte importa: bytes como **array JSON de números** inflam 3,6× em texto e
  muito mais depois de interpretados. Use transporte binário ou blocos.

### 3.4 Libere o que alocou

- Todo cache tem **teto e política de descarte** (LRU).
- Recursos com dono explícito são liberados explicitamente: `ImageBitmap.close()`,
  `URL.revokeObjectURL()`, `page.cleanup()` do pdf.js, `destroy()` de documentos.
- Liberar no mesmo escopo em que alocou, para não existir caminho em que um acontece sem o outro.
- Operações pesadas podem **soltar estruturas ociosas** durante o pico e recarregá-las depois.

### 3.5 Não bloqueie a interface

- Todo processamento pesado em worker. A main thread só orquestra.
- Laços longos **cedem o laço de eventos** entre unidades de trabalho (`MessageChannel`, não
  `setTimeout(0)`, que é estrangulado a ~4 ms). Sem isso, nem o cancelamento chega.
- Toda operação longa relata **progresso** e aceita **cancelamento** na interface.

### 3.6 Complexidade

- Procure O(n²) escondido: um _listener_ por requisição percorrido a cada resposta,
  `array.includes` dentro de `map`, refazer o grafo inteiro a cada item.
- Em RPC entre threads: **um** listener e um `Map<id, pendência>`.

### 3.7 Interfaces com listas grandes

- Componentes de item com `React.memo` e callbacks estáveis; senão, cada clique re-renderiza
  todos os itens.
- **Virtualize** listas que podem passar de algumas centenas de itens. Elemento fora da tela
  ainda ocupa memória — e um `<canvas>` guarda os pixels enquanto existir.
- Trabalho sob demanda: só renderize o que está perto da área visível.

### 3.8 Concorrência e reentrância

- Guardas contra reexecução usam **`ref`**, não estado do React: o estado só muda no próximo
  render, e dois cliques rápidos passam pela mesma guarda.
- Duas operações pesadas simultâneas somam os picos. Serialize-as.

---

## 4. Checklist de revisão de PR

**Segurança**

- [ ] Entrada nova tem limite de tamanho, quantidade e tempo?
- [ ] Algum dado de documento, nome de arquivo ou segredo pode chegar a log, rede ou disco fora
      do destino escolhido?
- [ ] Comando nativo novo valida os argumentos **no lado nativo** e está só na capacidade que o usa?
- [ ] Algum HTML montado a partir de conteúdo externo?
- [ ] A CSP continua sem `unsafe-eval` e sem origem externa?
- [ ] Dependência nova: necessária, mantida, auditada, com versão exata?

**Desempenho e memória**

- [ ] Quantas cópias do documento existem no pico desta operação? Alguma é evitável?
- [ ] Recurso alocado tem liberação no mesmo escopo?
- [ ] Cache novo tem teto?
- [ ] Operação longa roda em worker, cede o laço, relata progresso e pode ser cancelada?
- [ ] Lista nova escala para 400+ itens?
- [ ] O teste de orçamento de memória continua passando?

**Qualidade da evidência**

- [ ] O teste novo falha quando o código é sabotado?
- [ ] A medição usa a régua certa, com a mesma fixture do "antes"?

---

## 5. Referências

- OWASP Application Security Verification Standard (ASVS) — requisitos verificáveis por nível.
- OWASP Top 10 e CWE Top 25 — as classes de falha mais comuns.
- Documentação de segurança do Tauri v2 — capacidades, permissões, escopos e CSP.
- MDN: Content Security Policy; `measureUserAgentSpecificMemory`; Transferable objects.
- NIST SSDF (SP 800-218) — práticas de desenvolvimento seguro ao longo do ciclo de vida.
- Lei 13.709/2018 (LGPD) — minimização e segurança no tratamento de dados pessoais.
