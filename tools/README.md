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
