import { test, expect, type Page } from '@playwright/test';
import { requireOffscreenCanvas } from './capabilities';
import { minimalPdf } from './minimal-pdf';

/**
 * A lupa (US-08).
 *
 * Relato de uso real que a motivou: ordenando um documento longo, a miniatura da grade nao
 * respondia "que pagina e esta?", e a saida era gerar o PDF, conferir e voltar para corrigir.
 *
 * Por isso os testes nao param em "abre e fecha": eles fixam que a lupa NAVEGA e que ela
 * CORRIGE a ordem, que e o ciclo que ela veio encurtar.
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
const preview = (page: Page) => page.getByTestId('page-preview');

/** Abre a lupa do cartao na posicao informada, base 0. */
async function abrirLupa(page: Page, indice: number): Promise<void> {
  await cards(page).nth(indice).getByTestId('preview-open').click();
  await expect(preview(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/unir/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('toda pagina tem lupa, e ela abre a visualizacao', async ({ page }) => {
  await attach(page, 'boletins.pdf', 4);
  await expect(cards(page)).toHaveCount(4);

  // Uma por pagina: a lupa nao serve se depender de o usuario achar a unica que existe.
  await expect(page.getByTestId('preview-open')).toHaveCount(4);

  await abrirLupa(page, 2);
  await expect(page.getByTestId('preview-position')).toContainText('3');
});

/**
 * O botao precisa ser ALCANCAVEL pelo dedo, nao apenas visivel.
 *
 * Medido no aparelho: como setimo icone da fila de acoes, a lupa tinha 32x32px e reprovava
 * como alvo de toque — o recurso existia e nao se acertava nele. A suite inteira passava,
 * porque nenhum teste olhava tamanho. Este olha.
 */
test('a lupa e grande o bastante para o dedo', async ({ page }) => {
  await attach(page, 'boletins.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  const caixa = await cards(page).nth(0).getByTestId('preview-open').boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('a lupa diz de qual arquivo e de qual pagina dele veio', async ({ page }) => {
  await attach(page, 'turma-a.pdf', 2);
  // Espera o primeiro entrar ANTES de anexar o segundo: os dois carregamentos sao assincronos
  // e correm entre si, e a ordem da grade e justamente o que este teste afirma.
  await expect(cards(page)).toHaveCount(2);
  await attach(page, 'turma-b.pdf', 2);
  await expect(cards(page)).toHaveCount(4);

  // A terceira pagina da GRADE e a primeira de turma-b.pdf. Sem essa referencia, numa
  // montagem de varios PDFs o usuario nao sabe o que esta olhando.
  await abrirLupa(page, 2);
  await expect(preview(page)).toContainText('turma-b.pdf');
  await expect(page.getByTestId('preview-position')).toContainText('3');
});

test('navega entre as paginas sem fechar', async ({ page }) => {
  await attach(page, 'boletins.pdf', 5);
  await expect(cards(page)).toHaveCount(5);

  await abrirLupa(page, 0);
  await expect(page.getByTestId('preview-previous')).toBeDisabled();

  await page.getByTestId('preview-next').click();
  await expect(page.getByTestId('preview-position')).toContainText('2');

  // Setas do teclado: quem confere dezenas de paginas nao quer mirar num botao a cada uma.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('preview-position')).toContainText('3');

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('preview-position')).toContainText('2');
});

test('Esc fecha, e o botao tambem', async ({ page }) => {
  await attach(page, 'boletins.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  await abrirLupa(page, 0);
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);

  await abrirLupa(page, 0);
  await page.getByTestId('preview-close').click();
  await expect(preview(page)).toHaveCount(0);
});

/**
 * O ciclo que a lupa veio encurtar: identificar a pagina errada e ja coloca-la no lugar,
 * sem fechar, procurar o cartao na grade e recomecar.
 */
test('US-08 — mover pela lupa reordena a grade de verdade', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);
  await attach(page, 'b.pdf', 1);
  await expect(cards(page)).toHaveCount(4);

  // A identidade vem da CHAVE do item, e nao do texto do cartao: assim que a miniatura
  // renderiza, o nome do arquivo sai da tela — ele so aparece na folha em branco.
  const keysOf = () =>
    cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-key')));
  const antes = await keysOf();
  const paginaDeB = antes[3];

  // A pagina de b.pdf esta em ultimo; leva-la ate a primeira posicao com tres movimentos.
  await abrirLupa(page, 3);
  await expect(preview(page)).toContainText('b.pdf');

  for (const posicaoEsperada of ['3', '2', '1']) {
    await page.getByTestId('preview-move-back').click();
    // A lupa SEGUE a pagina movida: se ela seguisse a POSICAO, saltaria para a vizinha
    // exatamente no instante em que o usuario acabou de mover a que estava olhando.
    await expect(page.getByTestId('preview-position')).toContainText(posicaoEsperada);
    await expect(preview(page)).toContainText('b.pdf');
    await expect(preview(page)).toHaveAttribute('data-page-key', paginaDeB ?? '');
  }

  await expect(page.getByTestId('preview-move-back')).toBeDisabled();
  await page.getByTestId('preview-close').click();

  // A grade recebeu o movimento: a lupa nao e uma vista paralela do documento.
  await expect.poll(keysOf).toEqual([paginaDeB, antes[0], antes[1], antes[2]]);
});

test('girar pela lupa afeta a pagina na grade', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  await expect(cards(page).nth(0)).toHaveAttribute('data-rotate', '0');

  await abrirLupa(page, 0);
  await page.getByTestId('preview-rotate-right').click();
  await page.getByTestId('preview-close').click();

  await expect(cards(page).nth(0)).toHaveAttribute('data-rotate', '90');
  await expect(cards(page).nth(1)).toHaveAttribute('data-rotate', '0');
});

test('ampliar troca o ajuste da pagina, e virar a pagina volta ao ajustado', async ({ page }) => {
  await attach(page, 'boletins.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  await abrirLupa(page, 0);
  const palco = page.getByTestId('preview-stage');
  await expect(palco).toHaveAttribute('data-zoomed', 'false');

  await page.getByTestId('preview-zoom').click();
  await expect(palco).toHaveAttribute('data-zoomed', 'true');

  // Virar a pagina volta ao ajustado: manter a ampliacao deixaria a proxima aberta num
  // pedaco arbitrario, e quem navega esta procurando o cabecalho.
  await page.getByTestId('preview-next').click();
  await expect(palco).toHaveAttribute('data-zoomed', 'false');
});

test('a pagina aparece desenhada, e nao so a moldura', async ({ page }) => {
  await requireOffscreenCanvas(page);

  await attach(page, 'boletins.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  await abrirLupa(page, 0);

  // O criterio e a AUSENCIA do aviso de estado: o canvas fica montado mesmo sem imagem,
  // entao procura-lo aprovaria uma tela vazia.
  await expect(page.getByTestId('preview-status')).toHaveCount(0);

  // E a imagem tem de ser maior que a miniatura da grade — e disso que vem a legibilidade.
  const largura = await page
    .getByTestId('preview-canvas')
    .evaluate((canvas: HTMLCanvasElement) => canvas.width);
  expect(largura).toBeGreaterThan(600);
});
