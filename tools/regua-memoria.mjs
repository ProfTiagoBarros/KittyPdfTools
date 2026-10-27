// Regua de memoria: abre PDFs em /unir/, une, e mede o pico por fase.
//
//   pnpm --filter web build
//   python tools/gerar-fixtures-escaneadas.py <pasta>           # 816 paginas, 551 MB
//   REGUA_PAGINAS=816 node tools/regua-memoria.mjs apps/web <pasta> "rotulo"
//
// Mede tres coisas, porque cada uma mente sozinha:
//   vivaMB          memoria viva da pagina e dos workers (measureUserAgentSpecificMemory, apos
//                   coleta). Exige COOP+COEP — o servidor daqui os envia — e o Chromium completo.
//                   Durante operacao pesada a amostra so volta quando o worker fica ocioso.
//   renderizadorMB  memoria privada do processo que desenha a tela: o que cai (tela preta) quando
//                   passa do que a maquina tem. Inclui lixo ainda nao coletado.
//   maiorProcessoMB o maior processo do navegador, que guarda os Blobs.
//
// Use PDFs sinteticos, nunca os documentos reais da pasta documentos/ (dados pessoais).
// REGUA_SAIDA=<arquivo.pdf> grava o resultado para conferir a integridade.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const [webDir, fixtures, rotulo = 'medicao'] = process.argv.slice(2);
const require = createRequire(join(webDir, 'package.json'));
const { chromium } = require('@playwright/test');
const out = join(webDir, 'out');

const tipos = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.traineddata': 'application/octet-stream',
};
const servidor = createServer((req, res) => {
  let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let arquivo = join(out, caminho);
  if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, 'index.html');
  if (!existsSync(arquivo)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': tipos[extname(arquivo)] ?? 'application/octet-stream',
    // Exigidos por measureUserAgentSpecificMemory.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  res.end(readFileSync(arquivo));
}).listen(4180);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();

// Medidor do sistema: soma e maximo da memoria privada dos processos filhos do navegador.
let fase = 'inicio';
const picos = {};
const sistema = spawn('powershell', [
  '-NoProfile',
  '-Command',
  `
  while ($true) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.ExecutablePath -like '*ms-playwright*' }
    $all = $procs | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).PrivateMemorySize64 }
    $rend = $procs | Where-Object { $_.CommandLine -like '*--type=renderer*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).PrivateMemorySize64 }
    $m = ($all | Measure-Object -Maximum -Sum)
    $r = ($rend | Measure-Object -Maximum)
    "$([math]::Round($m.Maximum/1MB)) $([math]::Round($m.Sum/1MB)) $([math]::Round($r.Maximum/1MB))"
    Start-Sleep -Milliseconds 700
  }`,
]);
sistema.stdout.on('data', (d) => {
  for (const linha of d.toString().trim().split(/\r?\n/)) {
    const [max, soma, renderizador] = linha.split(' ').map(Number);
    if (!Number.isFinite(max)) continue;
    const p = (picos[fase] ??= { maiorProcessoMB: 0, renderizadorMB: 0, somaMB: 0, vivaMB: 0 });
    p.maiorProcessoMB = Math.max(p.maiorProcessoMB, max);
    p.renderizadorMB = Math.max(p.renderizadorMB, renderizador || 0);
    p.somaMB = Math.max(p.somaMB, soma);
  }
});

let caiu = false;
page.on('crash', () => {
  caiu = true;
  console.log(`!!! A PAGINA CAIU na fase "${fase}"`);
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log('console.' + m.type() + ':', m.text().slice(0, 200));
});

const progresso = setInterval(async () => {
  try {
    const estado = await page.evaluate(() => {
      const e = document.querySelector('[data-testid="workspace-state"]');
      return `docs=${e?.getAttribute('data-documents')} paginas=${e?.getAttribute('data-pages')} placeholders=${document.querySelectorAll('[data-testid="thumbnail-placeholder"]').length}`;
    });
    console.log(t(), fase, estado, '| maior processo', picos[fase]?.maiorProcessoMB, 'MB');
  } catch (e) {
    console.log(t(), 'sem resposta da pagina', String(e).slice(0, 80));
  }
}, 15000);

async function viva() {
  try {
    const detalhe = await page.evaluate(async () => {
      if (!crossOriginIsolated) return { bytes: -1, escopos: {} };
      const m = await performance.measureUserAgentSpecificMemory();
      const escopos = {};
      for (const b of m.breakdown) {
        const a = b.attribution[0];
        const nome = a
          ? `${a.scope ?? '?'}:${(a.url ?? '').split('/').pop().slice(0, 30)}`
          : b.types.join('+') || 'outros';
        escopos[nome] = (escopos[nome] ?? 0) + b.bytes;
      }
      return { bytes: m.bytes, escopos };
    });
    const r = detalhe.bytes;
    const mb = Math.round(r / 2 ** 20);
    if (fase === 'unir') {
      const resumo = Object.entries(detalhe.escopos)
        .map(([k, v]) => `${k}=${Math.round(v / 2 ** 20)}MB`)
        .join(' ');
      console.log(t(), 'viva', mb, 'MB |', resumo);
    }
    const p = (picos[fase] ??= { maiorProcessoMB: 0, renderizadorMB: 0, somaMB: 0, vivaMB: 0 });
    p.vivaMB = Math.max(p.vivaMB, mb);
    return mb;
  } catch {
    return null;
  }
}

const t = () => `${((performance.now() - inicio) / 1000).toFixed(1)}s`;
const inicio = performance.now();
await page.goto('http://127.0.0.1:4180/unir/');
await page.waitForSelector('[data-testid="workspace-state"][data-ready="true"]');

fase = 'abrir';
const arquivos = readdirSync(fixtures)
  .filter((f) => f.endsWith('.pdf'))
  .sort()
  .map((f) => join(fixtures, f));
await page.getByTestId('file-input').setInputFiles(arquivos);
const total = Number(process.env.REGUA_PAGINAS ?? 816);
const amostrador = setInterval(() => void viva(), 1500);
try {
  await page.waitForSelector(`[data-testid="workspace-state"][data-pages="${total}"]`, {
    timeout: 240_000,
    state: 'attached',
  });
  console.log(t(), 'abertos:', total, 'paginas | viva agora', await viva(), 'MB');
  await page.waitForTimeout(5000);

  fase = 'unir';
  const download = page.waitForEvent('download', { timeout: 900_000 });
  await page.getByTestId('export').click();
  const arquivo = await download;
  const saida = process.env.REGUA_SAIDA;
  if (saida) await arquivo.saveAs(saida);
  console.log(t(), 'unido:', arquivo.suggestedFilename());
  fase = 'depois';
  await page.waitForTimeout(8000);
  await viva();
} catch (erro) {
  console.log(t(), 'INTERROMPIDO:', String(erro).slice(0, 300), caiu ? '(pagina caiu)' : '');
}
clearInterval(amostrador);
clearInterval(progresso);
await new Promise((r) => setTimeout(r, 1500));
console.log(`\n== ${rotulo} ==`);
console.table(picos);
sistema.kill();
await browser.close().catch(() => {});
servidor.close();
process.exit(0);
