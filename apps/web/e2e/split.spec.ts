import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { minimalPdf } from './minimal-pdf';

/**
 * Exercita US-02 pela interface. A divisao age sobre a COMPOSICAO da grade, entao os testes
 * tambem verificam que reorganizar antes muda o que sai — que e a razao de unir US-01 e US-02
 * no mesmo fluxo.
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
/**
 * Dispara a divisao e abre o pacote gerado.
 *
 * Conferir o ZIP e mais forte do que contar itens numa lista: prova que os volumes existem, com
 * os nomes certos e com conteudo de PDF. Uma lista bem renderizada nao garante nada disso.
 */
async function dividirEAbrir(page: Page): Promise<Record<string, Uint8Array>> {
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('split-run').click();
  const file = await download;

  expect(file.suggestedFilename()).toBe('pdfkitty-dividido.zip');

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  return unzipSync(new Uint8Array(Buffer.concat(chunks)));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dividir/');
  await expect(state(page)).toHaveAttribute('data-ready', 'true');
});

test('comeca sem resultado e com a acao indisponivel', async ({ page }) => {
  await expect(page.getByTestId('split-run')).toBeDisabled();
  await expect(page.getByTestId('split-results')).toHaveCount(0);
});

test('so o campo do modo ativo aparece', async ({ page }) => {
  // Por intervalo e o modo inicial: campo de faixas visivel, campo de tamanho ausente.
  await expect(page.getByTestId('ranges-input')).toBeVisible();
  await expect(page.getByTestId('size-input')).toHaveCount(0);

  await page.getByTestId('mode-size').click();

  await expect(page.getByTestId('size-input')).toBeVisible();
  await expect(page.getByTestId('ranges-input')).toHaveCount(0);
});

test('US-02 — dividir por intervalo produz um arquivo por faixa', async ({ page }) => {
  await attach(page, 'a.pdf', 20);
  await expect(cards(page)).toHaveCount(20);

  await page.getByTestId('mode-ranges').click();
  await page.getByTestId('ranges-input').fill('1-5, 8, 11-15');
  const pacote = await dividirEAbrir(page);

  // Um arquivo por faixa, nomeados a partir do nome do pacote.
  expect(Object.keys(pacote).sort()).toEqual([
    'pdfkitty-dividido-1.pdf',
    'pdfkitty-dividido-2.pdf',
    'pdfkitty-dividido-3.pdf',
  ]);
});

test('US-02 — dividir por tamanho produz varios volumes', async ({ page }) => {
  await attach(page, 'a.pdf', 12);
  await expect(cards(page)).toHaveCount(12);

  await page.getByTestId('mode-size').click();
  // Limite minusculo: forca varios volumes num PDF sintetico pequeno.
  await page.getByTestId('size-input').fill('0.002');
  const pacote = await dividirEAbrir(page);

  expect(Object.keys(pacote).length).toBeGreaterThan(1);
  // O painel confirma o mesmo numero que o pacote traz.
  await expect(page.getByTestId('split-results')).toContainText(String(Object.keys(pacote).length));
});

test('trabalha com um arquivo por vez: abrir outro substitui o atual', async ({ page }) => {
  await attach(page, 'a.pdf', 4);
  await expect(cards(page)).toHaveCount(4);

  await attach(page, 'b.pdf', 2);

  await expect(cards(page)).toHaveCount(2);
  await expect(state(page)).toHaveAttribute('data-documents', '1');
});

test('varios arquivos arrastados de uma vez: abre o primeiro e diz isso', async ({ page }) => {
  // O seletor daqui ja nao aceita varios; arrastar da area de trabalho do sistema, aceita.
  const arquivos: [nome: string, conteudo: string][] = [
    ['a.pdf', minimalPdf(3)],
    ['b.pdf', minimalPdf(2)],
  ];
  const arrastados = await page.evaluateHandle(
    (lista) => {
      const transferencia = new DataTransfer();
      for (const [nome, conteudo] of lista) {
        const bytes = Uint8Array.from(conteudo, (c) => c.charCodeAt(0));
        transferencia.items.add(new File([bytes], nome, { type: 'application/pdf' }));
      }
      return transferencia;
    },
    arquivos,
  );
  await page.getByTestId('dropzone').dispatchEvent('drop', { dataTransfer: arrastados });

  await expect(cards(page)).toHaveCount(3);
  await expect(state(page)).toHaveAttribute('data-documents', '1');
  // Recusar em silencio faria o usuario procurar o segundo arquivo na grade.
  await expect(page.getByTestId('workspace-error')).toContainText('a.pdf');
});

test('a divisao age sobre a composicao, nao sobre o arquivo original', async ({ page }) => {
  await attach(page, 'a.pdf', 4);
  await expect(cards(page)).toHaveCount(4);

  // Excluir duas paginas muda a numeracao que o usuario ve — e pedir "1-4" passa a nao existir.
  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();
  await cards(page)
    .first()
    .getByRole('button', { name: /excluir|delete/i })
    .click();
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId('ranges-input').fill('1-4');

  // O campo recusa antes de gerar, e a acao continua indisponivel.
  await expect(page.getByTestId('range-invalid')).toBeVisible();
  await expect(page.getByTestId('split-run')).toBeDisabled();
});

test('faixa invalida e recusada no campo, antes de escolher destino', async ({ page }) => {
  await attach(page, 'a.pdf', 3);
  await expect(cards(page)).toHaveCount(3);

  // Pagina inexistente e reportada com o total, para o usuario saber o limite real.
  await page.getByTestId('ranges-input').fill('9-4');
  await expect(page.getByTestId('range-invalid')).toContainText(/(nao existe|does not exist).*3/s);

  // Paginas existentes, porem em ordem invertida: e a inversao que precisa ser reportada.
  await page.getByTestId('ranges-input').fill('3-1');
  await expect(page.getByTestId('range-invalid')).toContainText(
    /(fim vem antes|end comes before)/i,
  );

  // Corrigir limpa o aviso e libera a acao: o campo nao fica preso no estado de erro.
  await page.getByTestId('ranges-input').fill('1-3');
  await expect(page.getByTestId('range-invalid')).toHaveCount(0);
  await expect(page.getByTestId('split-run')).toBeEnabled();
});

/**
 * O motivo desta mudanca: a grade tinha selecao e a divisao lia SO o campo de texto. Escolher
 * paginas clicando e mandar dividir nao fazia nada — sem mensagem, sem pista.
 */
test('campo e grade sao a mesma escolha, nos dois sentidos', async ({ page }) => {
  await attach(page, 'a.pdf', 8);
  await expect(cards(page)).toHaveCount(8);

  const marcadas = page.locator('[data-testid="page-card"][data-selected="true"]');
  const campo = page.getByTestId('ranges-input');

  // Grade -> campo: paginas contiguas viram faixa, a isolada fica sozinha.
  for (const indice of [0, 1, 2, 6]) {
    // Por `data-testid`: o rotulo da lupa em portugues tambem contem "pagina", e o seletor
    // por texto passou a pegar o botao errado quando ela entrou no cartao.
    await cards(page).nth(indice).getByTestId('select-page').click();
  }
  await expect(campo).toHaveValue('1-3, 7');

  // Campo -> grade: digitar destaca exatamente essas paginas.
  await campo.fill('5-9');
  await expect(campo).toHaveValue('5-9');
  // So existem 8 paginas: 5-9 e recusado e a grade nao muda.
  await expect(page.getByTestId('range-invalid')).toBeVisible();
  await expect(marcadas).toHaveCount(4);

  await campo.fill('5-8');
  await expect(marcadas).toHaveCount(4);
  await expect(cards(page).nth(4)).toHaveAttribute('data-selected', 'true');
  await expect(cards(page).nth(0)).toHaveAttribute('data-selected', 'false');

  // Limpar o campo desmarca tudo.
  await campo.fill('');
  await expect(marcadas).toHaveCount(0);
  await expect(page.getByTestId('split-run')).toBeDisabled();
});

test('as partes vem nomeadas dentro do pacote, na ordem', async ({ page }) => {
  await attach(page, 'a.pdf', 6);
  await expect(cards(page)).toHaveCount(6);

  await page.getByTestId('mode-ranges').click();
  await page.getByTestId('ranges-input').fill('1-3, 4-6');
  const pacote = await dividirEAbrir(page);

  expect(Object.keys(pacote).sort()).toEqual([
    'pdfkitty-dividido-1.pdf',
    'pdfkitty-dividido-2.pdf',
  ]);
  for (const conteudo of Object.values(pacote)) {
    expect(Buffer.from(conteudo).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }
});

/**
 * A razao de existir a taxonomia de codigos: antes, o erro chegava a tela como a mensagem
 * crua do nucleo — sempre no mesmo idioma — dentro de uma interface traduzida.
 */
test.describe('erros do nucleo sao traduzidos', () => {
  test.describe('navegador em ingles', () => {
    test.use({ locale: 'en-US' });

    test('mostra o erro em ingles, sem texto do nucleo', async ({ page }) => {
      await attach(page, 'a.pdf', 3);
      await expect(cards(page)).toHaveCount(3);

      await page.getByTestId('ranges-input').fill('3-1');

      const error = page.getByTestId('range-invalid');
      await expect(error).toContainText('the end comes before the start');
      // A mensagem interna do nucleo nao pode vazar para a tela.
      await expect(error).not.toContainText(/invertido|pagina/i);
    });
  });

  test.describe('navegador em portugues', () => {
    test.use({ locale: 'pt-BR' });

    test('mostra o mesmo erro em portugues', async ({ page }) => {
      await attach(page, 'a.pdf', 3);
      await expect(cards(page)).toHaveCount(3);

      await page.getByTestId('ranges-input').fill('3-1');

      await expect(page.getByTestId('range-invalid')).toContainText('o fim vem antes do inicio');
    });
  });
});
