import { inflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { requireOffscreenCanvas } from './capabilities';

/**
 * Exercita US-03 pela interface.
 *
 * O teste central nao verifica que "apareceu um retangulo preto" — verifica que o texto
 * marcado DESAPARECEU do arquivo gerado, com um controle provando que ele estava la antes.
 * Retangulo preto por cima e exatamente o que o criterio de aceite proibe.
 */

const SECRET = 'CPFSIGILOSO';
const PUBLIC = 'PARTEPUBLICA';

/** PDF de duas paginas: a primeira com o segredo, a segunda so com conteudo publico. */
function twoPagePdf(): string {
  const pages = [
    `BT /F1 28 Tf 40 200 Td (${SECRET}) Tj ET`,
    `BT /F1 28 Tf 40 200 Td (${PUBLIC}) Tj ET`,
  ];

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ' +
      '/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${pages[0]?.length ?? 0} >>\nstream\n${pages[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ' +
      '/Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${pages[1]?.length ?? 0} >>\nstream\n${pages[1]}\nendstream`,
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

/** Procura a palavra nos bytes do PDF, inclusive comprimida e em hexadecimal. */
function containsWord(pdf: Buffer, word: string): boolean {
  const literal = Buffer.from(word, 'latin1');
  const hex = literal.toString('hex');
  const candidates = [
    literal,
    Buffer.from(hex.toUpperCase(), 'latin1'),
    Buffer.from(hex.toLowerCase(), 'latin1'),
  ];
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

const state = (page: Page) => page.getByTestId('workspace-state');
const viewer = (page: Page) => page.getByTestId('page-viewer');

async function attach(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(twoPagePdf(), 'latin1'),
  });
}

/** Arrasta sobre o visualizador para marcar uma regiao. */
async function markRegion(
  page: Page,
  fraction: { x0: number; y0: number; x1: number; y1: number },
) {
  const box = await viewer(page).boundingBox();
  if (box === null) throw new Error('visualizador sem geometria');

  await page.mouse.move(box.x + box.width * fraction.x0, box.y + box.height * fraction.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction.x1, box.y + box.height * fraction.y1, {
    steps: 10,
  });
  await page.mouse.up();
}

test.describe('ofuscacao', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/ofuscar/');
    await requireOffscreenCanvas(page);
    await expect(state(page)).toHaveAttribute('data-ready', 'true');
  });

  test('sem documento, nao ha o que ofuscar', async ({ page }) => {
    await expect(page.getByTestId('redact-run')).toBeDisabled();
  });

  test('arrastar sobre a pagina cria uma regiao', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();

    await markRegion(page, { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.4 });

    await expect(viewer(page)).toHaveAttribute('data-marks', '1');
    await expect(page.getByTestId('mark-list').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('redact-run')).toBeEnabled();
  });

  test('um clique sem arrasto nao cria regiao', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();

    const box = await viewer(page).boundingBox();
    if (box === null) throw new Error('sem geometria');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(viewer(page)).toHaveAttribute('data-marks', '0');
  });

  test('a regiao pode ser removida', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();
    await markRegion(page, { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.4 });

    await page
      .getByRole('button', { name: /remover regiao|remove region/i })
      .first()
      .click();

    await expect(viewer(page)).toHaveAttribute('data-marks', '0');
    await expect(page.getByTestId('redact-run')).toBeDisabled();
  });

  test('as marcacoes sao por pagina', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();
    await markRegion(page, { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.4 });

    await page.getByTestId('strip-page').nth(1).click();

    await expect(viewer(page)).toHaveAttribute('data-page-index', '1');
    await expect(viewer(page)).toHaveAttribute('data-marks', '0');
  });

  test('a confirmacao avisa das duas perdas antes de executar', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();
    await markRegion(page, { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.4 });

    await page.getByTestId('redact-run').click();

    const dialog = page.getByTestId('redact-confirm');
    await expect(dialog).toBeVisible();
    // Conteudo irrecuperavel e perda de texto pesquisavel: as duas precisam estar ditas.
    await expect(dialog).toContainText(/recuperad|recovered/i);
    await expect(dialog).toContainText(/pesquisav|searchable/i);

    // O dialogo precisa caber na janela. A barra inferior usa `backdrop-blur`, e um filtro
    // de fundo cria bloco de contencao: um `fixed` dentro dela se posicionaria em relacao a
    // barra, jogando o dialogo para fora da tela. Por isso ele vai num portal para o body.
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error('sem geometria');
    expect(box.y, 'o dialogo comeca dentro da janela').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'o dialogo termina dentro da janela').toBeLessThanOrEqual(
      viewport.height,
    );

    await page.getByTestId('redact-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('redact-result')).toHaveCount(0);
  });

  test('US-03 — o texto marcado desaparece do arquivo gerado', async ({ page }) => {
    await attach(page);
    await expect(viewer(page)).toBeVisible();

    // Cobre a faixa onde o texto foi desenhado na pagina 1.
    await markRegion(page, { x0: 0.02, y0: 0.2, x1: 0.98, y1: 0.5 });
    await page.getByTestId('redact-run').click();

    // O download e esperado desde a confirmacao: no fluxo unificado ele fecha a geracao.
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('redact-accept').click();

    await expect(page.getByTestId('redact-result')).toBeVisible({ timeout: 90_000 });

    const file = await download;

    expect(file.suggestedFilename()).toBe('pdfkitty-ofuscado.pdf');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    // Controle: o original REALMENTE continha o segredo. Sem isto, a asercao seguinte
    // passaria mesmo com uma ofuscacao que nao faz nada.
    expect(containsWord(Buffer.from(twoPagePdf(), 'latin1'), SECRET)).toBe(true);

    expect(containsWord(bytes, SECRET), 'o segredo nao pode sobreviver no arquivo').toBe(false);
    // A pagina nao marcada continua intacta, com seu texto pesquisavel.
    expect(containsWord(bytes, PUBLIC), 'a pagina intocada mantem o texto').toBe(true);
  });
});
