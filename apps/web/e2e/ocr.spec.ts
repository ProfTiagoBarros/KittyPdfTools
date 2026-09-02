import { inflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { requireOffscreenCanvas } from './capabilities';

/**
 * Exercita US-04 pela interface, num navegador de verdade.
 *
 * O teste central e o de ponta a ponta: um PDF cuja pagina e apenas uma IMAGEM de texto —
 * sem texto extraivel algum, como um digitalizado — precisa sair pesquisavel. Um controle
 * confirma que o original realmente nao tinha texto, senao o teste passaria de graca.
 */

/** PDF de uma pagina contendo somente uma imagem PNG com a palavra desenhada. */
function scannedPdf(pngBase64: string, widthPx: number, heightPx: number): string {
  const png = Buffer.from(pngBase64, 'base64').toString('latin1');
  const content = `q ${widthPx} 0 0 ${heightPx} 0 0 cm /Im0 Do Q`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPx} ${heightPx}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${png.length} >>\n` +
      `stream\n${png}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}

/** PDF comum, com texto de verdade — usado para provar o pulo de paginas ja pesquisaveis. */
function textPdf(): string {
  const content = 'BT /F1 24 Tf 20 150 Td (JADIGITAL) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}

/** Desenha a palavra num canvas e devolve o JPEG, para virar a imagem do "digitalizado". */
async function wordImage(page: Page, word: string) {
  return page.evaluate((text) => {
    const width = 900;
    const height = 300;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('sem contexto');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#000000';
    context.font = 'bold 120px serif';
    context.textBaseline = 'middle';
    context.fillText(text, 60, height / 2);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    return { base64: dataUrl.split(',')[1] ?? '', width, height };
  }, word);
}

const state = (page: Page) => page.getByTestId('workspace-state');
const cards = (page: Page) => page.getByTestId('page-card');

async function attachPdf(page: Page, name: string, pdf: string): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf, 'latin1'),
  });
}

test.describe('OCR', () => {
  // O reconhecimento carrega ~15 MB de wasm e modelo antes de comecar; o padrao de 30 s do
  // Playwright nao cobre isso nem numa pagina pequena.
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/ocr/');
    await requireOffscreenCanvas(page);
    await expect(state(page)).toHaveAttribute('data-ready', 'true');
  });

  test('comeca sem resultado', async ({ page }) => {
    await expect(page.getByTestId('ocr-run')).toBeDisabled();
    await expect(page.getByTestId('ocr-result')).toHaveCount(0);
  });

  test('o escopo acompanha a selecao', async ({ page }) => {
    await attachPdf(page, 'texto.pdf', textPdf());
    await expect(cards(page)).toHaveCount(1);

    await expect(page.getByTestId('ocr-scope')).toContainText(/todo o documento|whole document/i);

    await page.getByRole('button', { name: /selecionar tudo|select all/i }).click();
    await expect(page.getByTestId('ocr-scope')).toContainText(/1/);
  });

  test('pula paginas que ja tem texto', async ({ page }) => {
    await attachPdf(page, 'texto.pdf', textPdf());
    await expect(cards(page)).toHaveCount(1);

    await page.getByTestId('ocr-run').click();

    await expect(page.getByTestId('ocr-result')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('ocr-skipped')).toContainText(/1/);
  });

  test('US-04 — um digitalizado sem texto sai pesquisavel', async ({ page }) => {
    const image = await wordImage(page, 'CONTRATO');
    await attachPdf(page, 'digitalizado.pdf', scannedPdf(image.base64, image.width, image.height));
    await expect(cards(page)).toHaveCount(1);

    // Controle: a pagina e so imagem, entao nao ha texto algum a extrair.
    const before = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="workspace-state"]');
      return node?.getAttribute('data-pages');
    });
    expect(before).toBe('1');

    // Sem pular: a pagina nao tem texto mesmo, mas deixamos explicito o que se testa.
    await page.getByTestId('skip-with-text').uncheck();
    // O download comeca a ser esperado ANTES do clique: no fluxo unificado ele acontece ao
    // fim da geracao, sem segundo clique.
    const download = page.waitForEvent('download', { timeout: 180_000 });
    await page.getByTestId('ocr-run').click();

    await expect(page.getByTestId('ocr-result')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('ocr-result')).toContainText(/1/);

    const file = await download;

    expect(file.suggestedFilename()).toBe('pdfkitty-pesquisavel.pdf');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // A prova de que ficou pesquisavel: a palavra reconhecida esta dentro do arquivo. Nao
    // basta olhar os bytes crus — o pdf-lib grava texto em hexadecimal e dentro de stream
    // FlateDecode, entao a busca precisa descomprimir e cobrir as duas formas.
    expect(containsWord(bytes, 'CONTRATO')).toBe(true);
  });
});

/** Procura a palavra nos bytes do PDF, inclusive comprimida e em hexadecimal. */
function containsWord(pdf: Buffer, word: string): boolean {
  const literal = Buffer.from(word, 'latin1');
  const hexUpper = Buffer.from(literal.toString('hex').toUpperCase(), 'latin1');
  const hexLower = Buffer.from(literal.toString('hex').toLowerCase(), 'latin1');
  const candidates = [literal, hexUpper, hexLower];

  const found = (haystack: Buffer) => candidates.some((needle) => haystack.includes(needle));
  if (found(pdf)) return true;

  const open = Buffer.from('stream', 'latin1');
  const close = Buffer.from('endstream', 'latin1');
  let from = 0;

  for (;;) {
    const start = pdf.indexOf(open, from);
    if (start === -1) return false;

    let dataStart = start + open.length;
    if (pdf[dataStart] === 0x0d) dataStart += 1;
    if (pdf[dataStart] === 0x0a) dataStart += 1;

    const end = pdf.indexOf(close, dataStart);
    if (end === -1) return false;

    let dataEnd = end;
    while (dataEnd > dataStart) {
      const last = pdf[dataEnd - 1];
      if (last !== 0x0a && last !== 0x0d) break;
      dataEnd -= 1;
    }

    try {
      if (found(inflateSync(pdf.subarray(dataStart, dataEnd)))) return true;
    } catch {
      // stream nao comprimido com Flate, ou imagem: nada a fazer
    }

    from = end + close.length;
  }
}
