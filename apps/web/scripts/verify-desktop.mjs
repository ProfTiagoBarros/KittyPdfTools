/**
 * Verifica o app Desktop por dentro.
 *
 * Conecta ao WebView do Tauri por depuracao remota e confere o que o build nao prova:
 * que a interface carregou, que o CSP restritivo nao quebrou workers nem wasm, e que uma
 * operacao real funciona de ponta a ponta dentro do pacote.
 *
 * Nao faz parte do produto: e um script de verificacao, executado a mao.
 *
 * COMO USAR (PowerShell), com o app ja compilado:
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
 *   Start-Process apps\desktop\src-tauri	arget
elease\pdfkitty.exe
 *   pnpm --filter web verify:desktop
 *
 * A porta de depuracao so existe quando essa variavel e definida na sessao que inicia o
 * app: ela NAO fica embutida no pacote distribuido.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const url = page.url();
const title = await page.title();
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 160);

console.log('URL      :', url);
console.log('TITULO   :', title);
console.log('CONTEUDO :', JSON.stringify(bodyText));

// Capacidades dentro do WebView do Tauri, que no Windows e o Chromium do WebView2.
const caps = await page.evaluate(() => ({
  OffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  DecompressionStream: typeof DecompressionStream !== 'undefined',
  Worker: typeof Worker !== 'undefined',
}));
console.log('CAPACIDADES:', JSON.stringify(caps));

// Navega ate a ferramenta de unir e executa a operacao completa: carregar e exportar.
await page.goto(new URL('/unir/', url).href);
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
    'true',
  undefined,
  { timeout: 20_000 },
);
console.log('WORKERS  : criados (workspace pronto)');

const loaded = await page.evaluate(async () => {
  const content = 'BT /F1 24 Tf 40 200 Td (DESKTOP) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((b, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;

  const input = document.querySelector('[data-testid="file-input"]');
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'desktop.pdf', { type: 'application/pdf' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const state = document.querySelector('[data-testid="workspace-state"]');
  return {
    documentos: state?.getAttribute('data-documents'),
    paginas: state?.getAttribute('data-pages'),
    // Ausencia do marcador, e nao presenca do canvas: o canvas fica montado desde antes de
    // existir imagem, entao procura-lo aprovaria ate a miniatura que nunca renderizou.
    miniaturas: [...document.querySelectorAll('[data-testid="page-card"]')].filter(
      (cartao) => cartao.querySelector('[data-testid="thumbnail-placeholder"]') === null,
    ).length,
  };
});
console.log('CARREGAR :', JSON.stringify(loaded));

// Exportar: prova o caminho completo ate o PDF final, dentro do pacote.
//
// O app instalado nao baixa mais pelo `<a download>`: ele abre o seletor do sistema. Como o
// seletor e uma janela nativa, fora do alcance do CDP, o teste o dirige por teclado — digita
// o destino no campo de nome e confirma —, e depois confere o arquivo em disco.
//
// Nao tente substituir `window.__TAURI_INTERNALS__.invoke` para pular essa tela: a
// propriedade e `writable: false, configurable: false`, a atribuicao NAO lanca, e o
// resultado e um relatorio que jura que o Tauri nunca foi chamado enquanto o seletor esta
// aberto na frente do usuario.
const destino = join(tmpdir(), 'pdfkitty-verify-desktop.pdf');
rmSync(destino, { force: true });

const powershell = (script) =>
  execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();

/**
 * Titulos das janelas visiveis do processo do app.
 *
 * Duas abordagens mais simples nao funcionam aqui, ambas medidas:
 *
 * - `MainWindowTitle` do processo continua devolvendo "PDFKitty": o dialogo pertence ao mesmo
 *   processo, mas nao e a janela principal.
 * - A janela em primeiro plano nao serve: rodando a partir de uma sessao nao interativa,
 *   `GetForegroundWindow` volta vazia mesmo com o "Salvar como" aberto na tela.
 */
const ASSINATURAS_WIN32 = [
  'public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);',
  '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);',
  '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
].join(' ');

const janelasDoApp = () =>
  powershell(
    [
      `Add-Type -Namespace W -Name N -MemberDefinition '${ASSINATURAS_WIN32}'`,
      "$alvo = (Get-Process pdfkitty -ErrorAction SilentlyContinue | Select-Object -First 1).Id",
      // Acumula em variavel de escopo de script em vez de escrever na saida: o callback e
      // chamado pelo user32, fora do pipeline, e o que ele "escreve" ali se perde.
      '$achadas = @()',
      '$cb = [W.N+EnumWindowsProc]{ param($h, $l)',
      '  $dono = 0',
      '  [void][W.N]::GetWindowThreadProcessId($h, [ref]$dono)',
      '  if ($dono -eq $alvo -and [W.N]::IsWindowVisible($h)) {',
      '    $sb = New-Object System.Text.StringBuilder 256',
      '    [void][W.N]::GetWindowText($h, $sb, 256)',
      '    $script:achadas += $sb.ToString()',
      '  }',
      '  return $true',
      '}',
      '[void][W.N]::EnumWindows($cb, [IntPtr]::Zero)',
      '$achadas',
    ].join('\n'),
  )
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '');

await page.click('[data-testid="export"]');

// O criterio e o titulo do dialogo, e nao "qualquer janela que nao seja o app": este script
// digita um caminho e aperta Enter, e mandar isso para a janela errada seria pior do que
// nao verificar nada.
const TITULO_DE_SALVAR = /salvar|save/i;

let seletor = 'nao abriu';
for (let tentativa = 0; tentativa < 15; tentativa += 1) {
  await page.waitForTimeout(1000);
  const encontrada = janelasDoApp().find((titulo) => TITULO_DE_SALVAR.test(titulo));
  if (encontrada !== undefined) {
    seletor = encontrada;
    break;
  }
}
console.log('SELETOR  :', seletor);

let bytes = null;
if (seletor !== 'nao abriu') {
  // O dialogo precisa estar em foco antes de receber teclas: ele abre sem foco quando o app
  // foi iniciado por script. Por isso o `AppActivate` pelo titulo vem antes do SendKeys.
  //
  // ESTE E O PONTO FRAGIL DO SCRIPT. O Windows pode recusar a troca de foco, e ai as teclas
  // vao para outra janela e o relatorio diz "NADA gravado" sem que exista defeito no app.
  // Se acontecer, rode de novo com a janela do app visivel antes de investigar o produto —
  // a linha SELETOR acima ja diz se o dialogo abriu, que e a parte que o app controla.
  //
  // O campo de nome ja vem selecionado, entao digitar o caminho inteiro e confirmar salva
  // ali. A barra invertida nao e especial nem para o SendKeys nem para uma string entre
  // aspas simples do PowerShell: o caminho vai literal.
  powershell(
    [
      '$w = New-Object -ComObject WScript.Shell',
      `[void]$w.AppActivate('${seletor}')`,
      'Start-Sleep -Milliseconds 700',
      `$w.SendKeys('${destino}')`,
      'Start-Sleep -Milliseconds 500',
      "$w.SendKeys('{ENTER}')",
    ].join('\n'),
  );
  for (let tentativa = 0; tentativa < 10 && bytes === null; tentativa += 1) {
    await page.waitForTimeout(1000);
    bytes = existsSync(destino) ? statSync(destino).size : null;
  }
}

// Tamanho nao basta: bytes truncados tambem tem tamanho.
const assinatura = bytes === null ? null : readFileSync(destino).subarray(0, 5).toString('latin1');
console.log(
  'ARQUIVO  :',
  bytes === null
    ? 'NADA gravado'
    : `gravado: ${bytes} bytes, comeca com ${JSON.stringify(assinatura)}` +
        (assinatura?.startsWith('%PDF') === true ? ' — e um PDF' : ' — NAO parece um PDF'),
);
rmSync(destino, { force: true });

console.log('ERROS    :', errors.length === 0 ? 'nenhum' : JSON.stringify(errors.slice(0, 5)));

await browser.close();
