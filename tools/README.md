# Ferramentas de diagnóstico

Não fazem parte do produto: são utilitários executados à mão.

## `diagnostico-motor.html`

Mede, no dispositivo em que for aberto, se o motor do navegador tem o que o PDFKitty precisa
para desenhar páginas — **inclusive dentro de um Web Worker**, que é onde o processamento
realmente acontece.

Basta abrir o arquivo no navegador do dispositivo. Nada é enviado a lugar nenhum.

**Por que existe:** o build do WebKit usado pelo Playwright não tem `OffscreenCanvas`, o que
derruba miniaturas, ofuscação e OCR. O Safari real oferece essa API desde a versão 16.4
(março de 2023), então aquele resultado não representa o Safari — mas o WebView do Tauri no
macOS é WebKit do sistema, e a única forma de saber é medir no aparelho.

Se o resultado do Worker aparecer como "não foi possível medir", verifique se a página está
sendo aberta a partir de um arquivo local ou servidor próprio: algumas hospedagens bloqueiam
Workers criados a partir de `blob:` por política de segurança da própria página, e isso não
diz nada sobre o motor.

## `regua-memoria.mjs` + `gerar-fixtures-escaneadas.py`

Mede a memória de abrir e unir um lote grande de PDFs escaneados — o cenário que deixou a tela
do app preta em 10/2026 (oito arquivos, 816 páginas, 551 MB).

```bash
pnpm --filter web build
python tools/gerar-fixtures-escaneadas.py %TEMP%\fixtures
node tools/regua-memoria.mjs apps/web %TEMP%\fixtures "rotulo"
```

**Nunca use os documentos reais** de `documentos/`: têm dados pessoais. Os sintéticos têm o
mesmo perfil (JPEG de 2500×3530 px, ~690 KB por página) e bastam para medir.

A régua mede três números, porque cada um engana sozinho: a memória **viva** (após coleta,
via `measureUserAgentSpecificMemory`), a memória privada do processo **renderizador** (o que cai
quando passa do que a máquina tem, e que inclui lixo ainda não coletado) e o **maior processo**
do navegador (que guarda os `Blob`s). Medido no lote acima:

| | Antes | Depois |
|---|---|---|
| Viva, arquivos abertos | 1.173 MB | 290 MB |
| Renderizador, abrindo | 1.512 MB | 736 MB |
| Renderizador, unindo | 3.055 MB | 815 MB |
