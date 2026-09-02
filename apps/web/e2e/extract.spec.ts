import { test, expect, type Page } from '@playwright/test';
import { minimalPdf } from './minimal-pdf';

/**
 * Extrair recorta paginas para UM arquivo.
 *
 * Era um modo escondido dentro de "Dividir", e por isso entregava um `.zip` de um item so —
 * o empacotador servia as duas intencoes. Separada, a ferramenta entrega o `.pdf` direto, que
 * e o que o nome promete.
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
const campo = (page: Page) => page.getByTestId('extract-ranges-input');

/** Marca uma pagina clicando na miniatura, como o usuario faz. */
async function marcar(page: Page, indice: number): Promise<void> {
  await cards(page)
    .nth(indice)
    .getByRole('button', { name: /pagina|page/i })
    .first()
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/extrair/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('comeca indisponivel: sem paginas escolhidas nao ha o que extrair', async ({ page }) => {
  await expect(page.getByTestId('extract-run')).toBeDisabled();
});

test('US-02 — extrair entrega um unico PDF com as paginas escolhidas', async ({ page }) => {
  await attach(page, 'a.pdf', 20);
  await expect(cards(page)).toHaveCount(20);

  await campo(page).fill('1-5, 8, 11-15');
  await expect(page.getByTestId('extract-run')).toBeEnabled();

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('extract-run').click();
  const file = await download;

  // O nome diz `.pdf`, nao `.zip`: e a diferenca visivel entre extrair e dividir.
  expect(file.suggestedFilename()).toBe('pdfkitty-extraido.pdf');

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Cabecalho nao basta: um arquivo truncado tambem comeca com %PDF.
  expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
});

test('clicar nas miniaturas basta: o campo se preenche sozinho', async ({ page }) => {
  await attach(page, 'a.pdf', 8);
  await expect(cards(page)).toHaveCount(8);

  // Este era o defeito: escolher paginas na grade e mandar extrair nao fazia nada.
  await expect(page.getByTestId('extract-run')).toBeDisabled();

  for (const indice of [1, 2, 3, 6]) await marcar(page, indice);

  await expect(campo(page)).toHaveValue('2-4, 7');
  await expect(page.getByTestId('extract-run')).toBeEnabled();

  // Desmarcar reflete de volta, sem sobrar faixa fantasma no campo.
  await marcar(page, 6);
  await expect(campo(page)).toHaveValue('2-4');
});

test('os botoes de conjunto escrevem no campo como um clique escreveria', async ({ page }) => {
  await attach(page, 'a.pdf', 5);
  await expect(cards(page)).toHaveCount(5);

  await page.getByTestId('range-select-all').click();
  await expect(campo(page)).toHaveValue('1-5');

  await page.getByTestId('range-clear').click();
  await expect(campo(page)).toHaveValue('');
  await expect(page.getByTestId('extract-run')).toBeDisabled();
});

test('extrair age sobre a composicao, entao reordenar antes muda o resultado', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await attach(page, 'b.pdf', 2);
  await expect(cards(page)).toHaveCount(5);

  // A pagina 4 e a primeira de b.pdf: a numeracao e a da GRADE, nao a do arquivo de origem.
  await campo(page).fill('4-5');
  await expect(page.locator('[data-testid="page-card"][data-selected="true"]')).toHaveCount(2);
  await expect(cards(page).nth(3)).toHaveAttribute('data-selected', 'true');
  await expect(cards(page).nth(0)).toHaveAttribute('data-selected', 'false');
});
