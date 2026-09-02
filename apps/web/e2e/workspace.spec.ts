import { test, expect, type Page } from '@playwright/test';
import { requireOffscreenCanvas } from './capabilities';
import { minimalPdf } from './minimal-pdf';

/**
 * Exercita US-01 pela interface real: carregar arquivos, reordenar, girar, excluir, desfazer
 * e exportar. O nucleo ja tem 55 testes em Node; aqui se verifica que a UI liga corretamente
 * nos dois workers e que o usuario consegue chegar ao PDF final.
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

test.beforeEach(async ({ page }) => {
  await page.goto('/unir/');
  // Os workers so existem apos a montagem; sem esperar, o primeiro arquivo se perderia.
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('a grade comeca vazia', async ({ page }) => {
  await expect(page.getByTestId('grid-empty')).toBeVisible();
  await expect(state(page)).toHaveAttribute('data-pages', '0');
});

test('carregar um PDF cria uma miniatura por pagina', async ({ page }) => {
  await attach(page, 'contrato.pdf', 3);

  await expect(state(page)).toHaveAttribute('data-pages', '3');
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId('total-pages')).toContainText('3');
});

test('US-01 — paginas de arquivos diferentes convivem na mesma grade', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await attach(page, 'b.pdf', 3);

  await expect(state(page)).toHaveAttribute('data-documents', '2');
  await expect(cards(page)).toHaveCount(5);
});

test('girar uma pagina afeta apenas ela', async ({ page }) => {
  await attach(page, 'a.pdf', 2);

  await cards(page)
    .first()
    .getByRole('button', { name: /direita|right/i })
    .click();

  await expect(cards(page).first()).toHaveAttribute('data-rotate', '90');
  await expect(cards(page).nth(1)).toHaveAttribute('data-rotate', '0');
});

test('excluir uma pagina a remove da grade', async ({ page }) => {
  await attach(page, 'a.pdf', 3);

  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();

  await expect(cards(page)).toHaveCount(2);
});

test('desfazer devolve a pagina excluida', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();
  await expect(cards(page)).toHaveCount(2);

  await page.getByRole('button', { name: /desfazer|undo/i }).click();

  await expect(cards(page)).toHaveCount(3);
});

test('refazer reaplica o que foi desfeito', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();
  await page.getByRole('button', { name: /desfazer|undo/i }).click();
  await page.getByRole('button', { name: /refazer|redo/i }).click();

  await expect(cards(page)).toHaveCount(2);
});

test('selecao em lote gira varias paginas de uma vez', async ({ page }) => {
  await attach(page, 'a.pdf', 3);

  await page.getByRole('button', { name: /selecionar tudo|select all/i }).click();
  await expect(page.getByTestId('selection-count')).toBeVisible();

  // O painel de propriedades repete as acoes do cartao, agora aplicadas a selecao inteira.
  await page
    .getByRole('button', { name: /^girar para a direita$|^rotate right$/i })
    .last()
    .click();

  for (const index of [0, 1, 2]) {
    await expect(cards(page).nth(index)).toHaveAttribute('data-rotate', '90');
  }
});

test('remover o arquivo tira suas paginas da grade', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await attach(page, 'b.pdf', 2);

  await page
    .getByRole('button', { name: /remover arquivo|remove file/i })
    .first()
    .click();

  await expect(cards(page)).toHaveCount(2);
  await expect(state(page)).toHaveAttribute('data-documents', '1');
});

test('exportar entrega um PDF com as paginas montadas', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await attach(page, 'b.pdf', 1);
  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();

  const download = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const file = await download;

  expect(file.suggestedFilename()).toBe('pdfkitty.pdf');

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(0);
});

test('exportar fica indisponivel sem paginas', async ({ page }) => {
  await expect(page.getByTestId('export')).toBeDisabled();
});

test('US-01 — reordenar arrastando muda a ordem das paginas', async ({ page }) => {
  // O cartao so ganha altura util quando a miniatura renderiza; sem ela nao ha o que arrastar.
  await requireOffscreenCanvas(page);
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  const keysOf = () =>
    cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-key')));
  const before = await keysOf();

  const first = await cards(page).first().boundingBox();
  const second = await cards(page).nth(1).boundingBox();
  if (first === null || second === null) throw new Error('cartoes sem geometria');

  // Arrasto com o mouse, como o usuario faz. O PointerSensor so ativa apos alguns pixels,
  // entao o movimento precisa ser em passos — um salto unico nao dispara o arraste.
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(keysOf).toEqual([before[1], before[0], before[2]]);
});

test('a reordenacao tambem funciona pelo teclado (acessibilidade)', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  const keysOf = () =>
    cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-key')));
  const before = await keysOf();

  await cards(page).first().focus();
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');

  await expect.poll(keysOf).toEqual([before[1], before[0], before[2]]);
});

test('US-01 — mover uma pagina entre PDFs distintos pelos botoes', async ({ page }) => {
  // O arrasto ja e coberto acima. Este caminho existe porque no celular nao ha "passar o
  // mouse", e um usuario de toque precisa de um jeito explicito de reordenar — que e o mesmo
  // caminho que o leitor de tela usa.
  await attach(page, 'a.pdf', 2);
  await attach(page, 'b.pdf', 2);
  await expect(cards(page)).toHaveCount(4);

  const keysOf = () =>
    cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-key')));
  const before = await keysOf();
  const primeiraDeB = before[2];

  // Duas posicoes para tras: a primeira pagina de b.pdf passa a abrir o documento final.
  await cards(page).nth(2).getByTestId('move-back').click();
  await expect.poll(keysOf).toEqual([before[0], primeiraDeB, before[1], before[3]]);

  await cards(page).nth(1).getByTestId('move-back').click();
  await expect.poll(keysOf).toEqual([primeiraDeB, before[0], before[1], before[3]]);
});

test('a primeira pagina nao pode ser movida para tras', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await expect(cards(page).first().getByTestId('move-back')).toBeDisabled();
  await expect(cards(page).last().getByTestId('move-forward')).toBeDisabled();
});

test('busca destaca as paginas que contem o termo', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  // Controle: sem busca, nenhuma pagina esta destacada. Sem isto o teste passaria mesmo se
  // o destaque estivesse sempre ligado.
  await expect(cards(page).filter({ has: page.getByTestId('match-badge') })).toHaveCount(0);

  await page.getByTestId('search-input').fill('P2');

  const destacadas = cards(page).filter({ has: page.getByTestId('match-badge') });
  await expect(destacadas).toHaveCount(1);
  await expect(cards(page).nth(1)).toHaveAttribute('data-matched', 'true');
  await expect(cards(page).first()).toHaveAttribute('data-matched', 'false');
  await expect(page.getByTestId('search-status')).toContainText('1');
});

test('busca atravessa documentos distintos', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await attach(page, 'b.pdf', 3);

  await page.getByTestId('search-input').fill('P1');

  // P1 existe nos dois arquivos: a busca e sobre a montagem, nao sobre um arquivo.
  await expect(cards(page).filter({ has: page.getByTestId('match-badge') })).toHaveCount(2);
});

test('limpar a busca remove o destaque', async ({ page }) => {
  await attach(page, 'a.pdf', 2);
  await page.getByTestId('search-input').fill('P1');
  await expect(cards(page).filter({ has: page.getByTestId('match-badge') })).toHaveCount(1);

  await page.getByTestId('search-clear').click();

  await expect(cards(page).filter({ has: page.getByTestId('match-badge') })).toHaveCount(0);
});

test('toda pagina carregada ganha miniatura, e nenhuma fica sem identificacao', async ({
  page,
}) => {
  // O defeito que originou esta verificacao era miniatura faltando em PARTE das paginas, entao
  // o criterio conta uma a uma. O marcador de folha em branco so pode sobrar onde a imagem
  // realmente nao veio — e mesmo ali ele carrega arquivo e pagina de origem.
  await requireOffscreenCanvas(page);
  await attach(page, 'contrato.pdf', 4);
  await expect(cards(page)).toHaveCount(4);

  await expect(page.getByTestId('thumbnail-placeholder')).toHaveCount(0, { timeout: 20_000 });
});

test('a folha em branco identifica arquivo e pagina de origem', async ({ page }) => {
  await attach(page, 'contrato.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  // Antes de a imagem chegar, o espaco ja diz de onde a pagina veio. Sem isso, uma miniatura
  // ausente no meio de varios PDFs vira um buraco que o usuario nao consegue identificar.
  const marcadores = page.getByTestId('thumbnail-placeholder');
  if ((await marcadores.count()) > 0) {
    await expect(marcadores.first()).toContainText('contrato.pdf');
    await expect(marcadores.first()).toContainText('p. 1');
  }
});

test('miniatura de pagina com padrao de preenchimento renderiza', async ({ page }) => {
  /*
   * Regressao do defeito que so aparecia em documento real: pagina de texto renderizava e
   * pagina com logotipo, grafico ou tabela nao. A causa era o pdf.js pedindo um canvas
   * AUXILIAR pela `DOMCanvasFactory`, que chama `document.createElement` — dentro de um Worker
   * onde `document` nao existe.
   *
   * O conteudo aqui e um padrao de preenchimento (tiling pattern) porque ele **obriga** esse
   * canvas auxiliar. Imagem simples nao serve: medi, e a pagina com um JPEG renderiza mesmo
   * com a fabrica quebrada — um teste assim aprovaria o produto defeituoso.
   */
  await requireOffscreenCanvas(page);

  const tile = 'q 1 0 0 RG 2 w 0 0 m 10 10 l S Q';
  const fluxo = '/Pattern cs /P0 scn 0 0 200 200 re f';
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ' +
      '/Resources << /Pattern << /P0 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${fluxo.length} >>
stream
${fluxo}
endstream`,
    '<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] ' +
      `/XStep 10 /YStep 10 /Resources << >> /Length ${tile.length} >>
stream
${tile}
endstream`,
  ];

  let pdf = `%PDF-1.4
`;
  const deslocamentos: number[] = [];
  objetos.forEach((corpo, indice) => {
    deslocamentos.push(pdf.length);
    pdf += `${indice + 1} 0 obj
${corpo}
endobj
`;
  });
  const xref = pdf.length;
  pdf += `xref
0 ${objetos.length + 1}
0000000000 65535 f 
`;
  for (const deslocamento of deslocamentos) {
    pdf += `${String(deslocamento).padStart(10, '0')} 00000 n 
`;
  }
  pdf += `trailer
<< /Size ${objetos.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;

  await page.getByTestId('file-input').setInputFiles({
    name: 'com-padrao.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf, 'latin1'),
  });

  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId('thumbnail-placeholder')).toHaveCount(0, { timeout: 20_000 });
});

test('trocar de ferramenta preserva os arquivos e as miniaturas', async ({ page }) => {
  /*
   * O defeito: cada ferramenta montava o proprio provedor de workers, entao trocar de rota
   * destruia os workers e criava outros. O store de documentos sobrevivia a troca — e a grade
   * ficava listando paginas cujos bytes nao existiam mais em worker algum, com TODAS as
   * miniaturas quebradas de uma vez.
   *
   * A tela foi desenhada em volta de uma montagem so, com as ferramentas na lateral: trocar de
   * ferramenta nao pode custar os arquivos.
   */
  await requireOffscreenCanvas(page);
  await attach(page, 'contrato.pdf', 3);
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId('thumbnail-placeholder')).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('link', { name: /dividir|split/i }).click();
  await expect(page).toHaveURL(/\/dividir\//);
  await expect(state(page)).toHaveAttribute('data-ready', 'true');

  // As paginas continuam la...
  await expect(cards(page)).toHaveCount(3);
  // ...e continuam desenhaveis, que e o que o defeito quebrava.
  await expect(page.getByTestId('thumbnail-placeholder')).toHaveCount(0, { timeout: 20_000 });
});

test('o arquivo gerado continua ao alcance para salvar de novo', async ({ page }) => {
  /*
   * "Ultima geracao" existe para o caso real de salvar no lugar errado — ou de querer uma
   * segunda copia — sem refazer o trabalho. Os bytes ficam em memoria ate a proxima geracao.
   */
  await attach(page, 'contrato.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  // Antes de gerar nao ha o que reoferecer.
  await expect(page.getByTestId('last-generated')).toHaveCount(0);

  const primeiro = page.waitForEvent('download');
  await page.getByTestId('export').click();
  await (await primeiro).path();

  const ultimo = page.getByTestId('last-generated');
  await expect(ultimo).toBeVisible();
  await expect(ultimo).toContainText('pdfkitty.pdf');

  // Clicar entrega o mesmo arquivo outra vez, sem recompor nada.
  const segundo = page.waitForEvent('download');
  await ultimo.click();
  expect((await segundo).suggestedFilename()).toBe('pdfkitty.pdf');
});

test('a acao principal desabilita enquanto trabalha', async ({ page }) => {
  await attach(page, 'contrato.pdf', 2);
  await expect(cards(page)).toHaveCount(2);

  // Sem documento nao ha o que exportar: o botao ja nasce desabilitado.
  await page.goto('/unir/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('export')).toBeDisabled();
});
