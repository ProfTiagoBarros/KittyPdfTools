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
      '$alvo = (Get-Process pdfkitty -ErrorAction SilentlyContinue | Select-Object -First 1).Id',
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

// ---------------------------------------------------------------------------
// As ferramentas novas, dentro do pacote.
//
// O salvamento ja foi provado acima e no Android, e conduzir a caixa nativa por SendKeys e o
// passo mais fragil deste script — repeti-lo tres vezes trocaria cobertura por instabilidade.
// O que se verifica aqui e o que o EMPACOTAMENTO poderia quebrar: a rota existir no export
// estatico, os workers responderem e a acao ficar disponivel.
// ---------------------------------------------------------------------------

/** PDF de varias paginas, montado dentro da pagina para nao depender de arquivo em disco. */
async function abrirComPdf(rota, paginas) {
  await page.goto(new URL(rota, url).href);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
      'true',
    undefined,
    { timeout: 30_000 },
  );

  return page.evaluate(async (total) => {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${Array.from({ length: total }, (_u, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${total} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    for (let i = 0; i < total; i += 1) {
      objs.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      );
      const fluxo = `BT /F1 24 Tf 40 200 Td (P${i + 1}) Tj ET`;
      objs.push(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
    }
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
    dt.items.add(new File([bytes], 'origem.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 4000));
    return document.querySelectorAll('[data-testid="page-card"]').length;
  }, paginas);
}

const habilitado = (testId) =>
  page.evaluate(
    (id) => document.querySelector(`[data-testid="${id}"]`)?.disabled === false,
    testId,
  );

// EXTRAIR: o defeito relatado era selecionar paginas e nada acontecer.
// Extrair e a opcao "so as escolhidas" de "Unir e extrair".
const cartoesExtrair = await abrirComPdf('/unir/', 6);
await page.click('[data-testid="pages-some"]');
const ligacao = await page.evaluate(async () => {
  const cartoes = [...document.querySelectorAll('[data-testid="page-card"]')];
  // Pelo `data-testid` do botao de selecao: `querySelector('button')` pegava o primeiro
  // botao do cartao, e quando a lupa entrou ela passou a ser esse primeiro.
  for (const indice of [0, 1, 2]) {
    cartoes[indice]?.querySelector('[data-testid="select-page"]')?.click();
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return document.querySelector('[data-testid="extract-ranges-input"]')?.value ?? null;
});
console.log(
  'EXTRAIR  :',
  `${cartoesExtrair} cartoes | clicando 3 paginas -> campo=${JSON.stringify(ligacao)}`,
  ligacao === '1-3' ? '| a grade escreve no campo' : '| O CAMPO NAO ACOMPANHOU',
  (await habilitado('export')) ? '| acao liberada' : '| ACAO BLOQUEADA',
);

// DIVIDIR: duas faixas encostadas, que a selecao sozinha nao saberia representar.
await abrirComPdf('/dividir/', 6);
await page.fill('[data-testid="ranges-input"]', '1-3, 4-6');
console.log(
  'DIVIDIR  :',
  (await habilitado('split-run')) ? 'acao liberada com "1-3, 4-6"' : 'ACAO BLOQUEADA',
);

// COMPACTAR: o aviso e o que separa a via sem perda da forte.
await abrirComPdf('/compactar/', 4);
const semPerdaLiberado = await habilitado('compress-run');
await page.click('[data-testid="compress-mode-quality"]');
await page.click('[data-testid="compress-run"]');
await new Promise((resolve) => setTimeout(resolve, 600));

const textoAviso = await page.evaluate(
  () => document.querySelector('[data-testid="compress-confirm"]')?.textContent ?? '',
);
console.log(
  'COMPACTAR:',
  semPerdaLiberado ? 'acao liberada' : 'ACAO BLOQUEADA',
  textoAviso === '' ? '| A VIA FORTE NAO AVISOU' : '| a via forte avisou',
  /pesquisav/i.test(textoAviso) ? '| nomeia a perda de busca' : '',
);

// Cancela para nao abrir a caixa nativa de salvar e deixar o app preso num dialogo.
await page.click('[data-testid="compress-cancel"]');

// LUPA: a razao desta build existir. O administrador nao conseguia reconhecer a pagina pela
// miniatura e precisava gerar o PDF para conferir. Aqui se verifica o que o EMPACOTAMENTO
// poderia quebrar: a pagina desenhar em resolucao de leitura dentro do WebView2, e as acoes
// de ordenacao responderem de dentro da lupa.
await abrirComPdf('/unir/', 4);

const lupa = await page.evaluate(async () => {
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const cartoes = [...document.querySelectorAll('[data-testid="page-card"]')];
  const chaves = cartoes.map((cartao) => cartao.getAttribute('data-page-key'));

  // Abre pela ULTIMA pagina: e o caso em que mover para tras tem efeito visivel.
  cartoes.at(-1)?.querySelector('[data-testid="preview-open"]')?.click();
  await esperar(2500);

  const visor = document.querySelector('[data-testid="page-preview"]');
  if (visor === null) return { aberto: false };

  const canvas = document.querySelector('[data-testid="preview-canvas"]');
  const desenhou = document.querySelector('[data-testid="preview-status"]') === null;
  const larguraPx = canvas?.width ?? 0;

  // Mover de dentro: a lupa tem de seguir a pagina, e a grade tem de receber o movimento.
  const chaveNaLupa = visor.getAttribute('data-page-key');
  document.querySelector('[data-testid="preview-move-back"]')?.click();
  await esperar(600);

  const posicao = document.querySelector('[data-testid="preview-position"]')?.textContent ?? '';
  const aindaNaMesma =
    document.querySelector('[data-testid="page-preview"]')?.getAttribute('data-page-key') ===
    chaveNaLupa;

  document.querySelector('[data-testid="preview-close"]')?.click();
  await esperar(400);

  const depois = [...document.querySelectorAll('[data-testid="page-card"]')].map((cartao) =>
    cartao.getAttribute('data-page-key'),
  );

  return {
    aberto: true,
    desenhou,
    larguraPx,
    posicao: posicao.trim(),
    aindaNaMesma,
    // A ultima pagina deve ter trocado de lugar com a penultima.
    reordenou: depois[depois.length - 2] === chaves[chaves.length - 1],
    fechou: document.querySelector('[data-testid="page-preview"]') === null,
  };
});

if (!lupa.aberto) {
  console.log('LUPA     : NAO ABRIU');
} else {
  console.log(
    'LUPA     :',
    lupa.desenhou ? `desenhou ${lupa.larguraPx}px` : 'NAO DESENHOU A PAGINA',
    // A legibilidade vem da resolucao: uma imagem do tamanho da miniatura nao resolveria nada.
    lupa.larguraPx > 600 ? '| resolucao de leitura' : '| RESOLUCAO BAIXA DEMAIS',
    `| ${lupa.posicao}`,
    lupa.aindaNaMesma ? '| seguiu a pagina ao mover' : '| SALTOU DE PAGINA AO MOVER',
    lupa.reordenou ? '| a grade recebeu o movimento' : '| A GRADE NAO MUDOU',
    lupa.fechou ? '| fechou' : '| NAO FECHOU',
  );
}

console.log('ERROS    :', errors.length === 0 ? 'nenhum' : JSON.stringify(errors.slice(0, 5)));

await browser.close();
