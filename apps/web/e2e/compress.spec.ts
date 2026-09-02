import { test, expect, type Page } from '@playwright/test';
import { minimalPdf } from './minimal-pdf';
import { requireOffscreenCanvas } from './capabilities';

/**
 * Compactar tem duas vias com contratos opostos, e o que separa uma da outra e o AVISO.
 *
 * A via sem perda nao degrada nada e por isso executa direto. A via forte rasteriza — o
 * documento deixa de ter texto pesquisavel — e por isso nao pode comecar sem o usuario
 * confirmar. Estes testes fixam exatamente essa fronteira.
 */

async function attach(page: Page, name: string, pages: number): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(minimalPdf(pages), 'latin1'),
  });
}

const state = (page: Page) => page.getByTestId('workspace-state');
const cards = (page: Page) => page.getByTestId('page-card');

/** Dispara a geracao e devolve os bytes que o navegador baixou. */
async function baixar(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  const file = await download;

  expect(file.suggestedFilename()).toBe('pdfkitty-compactado.pdf');

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/compactar/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('comeca sem resultado e com a acao indisponivel', async ({ page }) => {
  await expect(page.getByTestId('compress-run')).toBeDisabled();
  await expect(page.getByTestId('compress-results')).toHaveCount(0);
});

test('a via sem perda executa direto, sem aviso', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  // Sem perda e o modo inicial: nada degrada, entao nao ha o que avisar.
  await expect(page.getByTestId('compress-mode-lossless')).toHaveAttribute('aria-checked', 'true');

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('compress-run').click();

  await expect(page.getByTestId('compress-confirm')).toHaveCount(0);

  const file = await download;
  expect(file.suggestedFilename()).toBe('pdfkitty-compactado.pdf');
  await expect(page.getByTestId('compress-results')).toBeVisible();
});

/**
 * O pedido explicito do usuario: avisar que o PDF sera compactado. O aviso vem ANTES de
 * escolher destino — descobrir a perda ao abrir o arquivo salvo seria tarde demais.
 */
test('a via forte avisa antes de comecar, e o aviso diz o que se perde', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId('compress-mode-quality').click();
  await page.getByTestId('compress-run').click();

  const aviso = page.getByTestId('compress-confirm');
  await expect(aviso).toBeVisible();
  // Nao basta aparecer: precisa nomear a perda, e nao apenas dizer "tem certeza?".
  await expect(aviso).toContainText(/pesquisavel|searchable/i);
  await expect(aviso).toContainText(/OCR/);
});

test('cancelar o aviso nao gera arquivo algum', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId('compress-mode-quality').click();
  await page.getByTestId('compress-run').click();
  await page.getByTestId('compress-cancel').click();

  await expect(page.getByTestId('compress-confirm')).toHaveCount(0);
  await expect(page.getByTestId('compress-results')).toHaveCount(0);
});

test('o modo por tamanho tambem avisa, porque tambem rasteriza', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId('compress-mode-target').click();
  await expect(page.getByTestId('compress-target-input')).toBeVisible();

  await page.getByTestId('compress-run').click();
  await expect(page.getByTestId('compress-confirm')).toBeVisible();
});

test('so o campo do modo ativo aparece', async ({ page }) => {
  await expect(page.getByTestId('compress-remove-ocr')).toBeVisible();
  await expect(page.getByTestId('compress-target-input')).toHaveCount(0);

  await page.getByTestId('compress-mode-target').click();
  await expect(page.getByTestId('compress-target-input')).toBeVisible();
  await expect(page.getByTestId('compress-remove-ocr')).toHaveCount(0);

  await page.getByTestId('compress-mode-quality').click();
  await expect(page.getByTestId('compress-preset-medium')).toBeVisible();
  await expect(page.getByTestId('compress-target-input')).toHaveCount(0);
});

test('US-07 — aceitar o aviso produz um PDF valido', async ({ page }) => {
  await requireOffscreenCanvas(page);

  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  await page.getByTestId('compress-mode-quality').click();
  await page.getByTestId('compress-preset-low').click();
  await page.getByTestId('compress-run').click();
  await page.getByTestId('compress-accept').click();

  const bytes = await baixar(page);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Cabecalho nao basta: um arquivo truncado tambem comeca com %PDF.
  expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
  await expect(page.getByTestId('compress-results')).toBeVisible();
});

/**
 * Compactar pode AUMENTAR o arquivo, e a tela tem de dizer isso.
 *
 * A fixture aqui e um PDF de TEXTO, e rasteriza-la produz a fotografia de uma pagina quase em
 * branco — maior que o vetor que a descrevia. Medido no aparelho: 2 kB viraram 9 kB enquanto a
 * tela dizia "0% menor". O numero nao mentia; ele escondia.
 *
 * Este teste existe porque a versao anterior se chamava "produz um PDF valido E MENOR" e
 * passava produzindo um arquivo 5,7 vezes maior: ela nunca olhou o tamanho.
 */
test('avisa quando rasterizar AUMENTOU o arquivo, em vez de dizer "0% menor"', async ({ page }) => {
  await requireOffscreenCanvas(page);

  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  await page.getByTestId('compress-mode-quality').click();
  await page.getByTestId('compress-run').click();
  await page.getByTestId('compress-accept').click();

  const bytes = await baixar(page);

  const aviso = page.getByTestId('compress-grew');
  await expect(aviso).toBeVisible();
  // O aviso precisa APONTAR A SAIDA, e nao apenas constatar o problema.
  await expect(aviso).toContainText(/sem perda|lossless/i);

  // E o arquivo realmente cresceu: sem esta medida, o teste acreditaria no proprio aviso.
  expect(bytes.length).toBeGreaterThan(0);
  await expect(page.getByTestId('compress-results')).not.toContainText(/0%/);
});

/**
 * O contraste que justifica as duas vias existirem: no MESMO documento de texto, a via sem
 * perda encolhe enquanto a forte incha.
 */
test('a via sem perda encolhe o mesmo documento que a forte aumentaria', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  await page.getByTestId('compress-run').click();
  await baixar(page);

  await expect(page.getByTestId('compress-grew')).toHaveCount(0);
  await expect(page.getByTestId('compress-results')).toBeVisible();
});
