import { test, expect, type Download, type Page } from '@playwright/test';
import { minimalPdf } from './minimal-pdf';

/**
 * "Unir e extrair": um PDF a partir das paginas da grade — todas, ou so as escolhidas.
 *
 * Eram duas ferramentas cuja unica diferenca era quais paginas entravam. A escolha e explicita
 * porque a selecao da grade tambem serve para girar e excluir em lote: quem seleciona paginas
 * para gira-las nao pode receber um PDF so com elas.
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
const gerar = (page: Page) => page.getByTestId('export');

/** Marca uma pagina clicando na miniatura, como o usuario faz. */
async function marcar(page: Page, indice: number): Promise<void> {
  // Por `data-testid`, e nao pelo rotulo: em portugues o rotulo da lupa tambem contem
  // "pagina", e um seletor por texto passou a pegar o botao errado.
  await cards(page).nth(indice).getByTestId('select-page').click();
}

async function bytesDe(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Paginas do PDF gerado, lidas do proprio arquivo.
 *
 * A composicao grava sem fluxos de objetos, entao o `/Count` da arvore de paginas e texto
 * legivel. Contar os cartoes da tela nao provaria nada sobre o que saiu.
 */
function paginasDe(bytes: Buffer): number {
  const texto = bytes.toString('latin1');
  expect(texto.startsWith('%PDF-')).toBe(true);
  // Cabecalho nao basta: um arquivo truncado tambem comeca com %PDF.
  expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
  return Number(/\/Type \/Pages[^>]*\/Count (\d+)/.exec(texto)?.[1]);
}

async function gerarEBaixar(page: Page): Promise<{ nome: string; paginas: number }> {
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await gerar(page).click();
  const arquivo = await download;
  return { nome: arquivo.suggestedFilename(), paginas: paginasDe(await bytesDe(arquivo)) };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/unir/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('comeca em "todas as paginas", sem campo de intervalo', async ({ page }) => {
  await expect(page.getByTestId('pages-all')).toHaveAttribute('aria-checked', 'true');
  await expect(campo(page)).toHaveCount(0);
  await expect(gerar(page)).toBeDisabled();
});

test('US-01 — junta as paginas de varios PDFs num so', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await attach(page, 'b.pdf', 2);
  await expect(cards(page)).toHaveCount(5);

  const gerado = await gerarEBaixar(page);

  expect(gerado.nome).toBe('pdfkitty.pdf');
  expect(gerado.paginas).toBe(5);
});

test('selecionar paginas para gira-las NAO reduz o PDF gerado', async ({ page }) => {
  // O motivo da escolha explicita: a selecao tambem serve para acoes em lote.
  await attach(page, 'a.pdf', 4);
  await expect(cards(page)).toHaveCount(4);
  await marcar(page, 0);
  await marcar(page, 1);

  const gerado = await gerarEBaixar(page);

  expect(gerado.paginas).toBe(4);
});

test('US-02 — "so as escolhidas" entrega UM PDF com as paginas pedidas', async ({ page }) => {
  await attach(page, 'a.pdf', 20);
  await expect(cards(page)).toHaveCount(20);

  await page.getByTestId('pages-some').click();
  // Sem paginas escolhidas nao ha o que gerar.
  await expect(gerar(page)).toBeDisabled();

  await campo(page).fill('1-5, 8, 11-15');
  await expect(gerar(page)).toBeEnabled();

  const gerado = await gerarEBaixar(page);

  // `.pdf`, nao `.zip`: um arquivo so, que e o que distingue extrair de dividir.
  expect(gerado.nome).toBe('pdfkitty-extraido.pdf');
  expect(gerado.paginas).toBe(11);
});

test('clicar nas miniaturas basta: o campo se preenche sozinho', async ({ page }) => {
  await attach(page, 'a.pdf', 8);
  await expect(cards(page)).toHaveCount(8);
  await page.getByTestId('pages-some').click();

  // O defeito original: escolher paginas na grade e mandar extrair nao fazia nada.
  for (const indice of [1, 2, 3, 6]) await marcar(page, indice);

  await expect(campo(page)).toHaveValue('2-4, 7');
  await expect(gerar(page)).toBeEnabled();

  // Desmarcar reflete de volta, sem sobrar faixa fantasma no campo.
  await marcar(page, 6);
  await expect(campo(page)).toHaveValue('2-4');
});

test('os botoes de conjunto escrevem no campo como um clique escreveria', async ({ page }) => {
  await attach(page, 'a.pdf', 5);
  await expect(cards(page)).toHaveCount(5);
  await page.getByTestId('pages-some').click();

  await page.getByTestId('range-select-all').click();
  await expect(campo(page)).toHaveValue('1-5');

  await page.getByTestId('range-clear').click();
  await expect(campo(page)).toHaveValue('');
  await expect(gerar(page)).toBeDisabled();
});

test('a numeracao e a da grade, atravessando PDFs distintos', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await attach(page, 'b.pdf', 2);
  await expect(cards(page)).toHaveCount(5);
  await page.getByTestId('pages-some').click();

  // A pagina 4 e a primeira de b.pdf: a numeracao e a da GRADE, nao a do arquivo de origem.
  await campo(page).fill('4-5');
  await expect(page.locator('[data-testid="page-card"][data-selected="true"]')).toHaveCount(2);
  await expect(cards(page).nth(3)).toHaveAttribute('data-selected', 'true');
  await expect(cards(page).nth(0)).toHaveAttribute('data-selected', 'false');

  const gerado = await gerarEBaixar(page);
  expect(gerado.paginas).toBe(2);
});

test('/extrair/ continua respondendo e leva a "Unir e extrair"', async ({ page }) => {
  await page.goto('/extrair/');
  await expect(page).toHaveURL(/\/unir\/$/);
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});
