import { test, type Page } from '@playwright/test';

/**
 * Pula o teste quando o motor nao oferece `OffscreenCanvas`.
 *
 * O corte e por CAPACIDADE MEDIDA, nao por nome de navegador: se um WebKit futuro passar a
 * oferece-la, estes testes voltam a rodar sozinhos. Marcar como "falha esperada" esconderia
 * o tamanho do buraco; pular dizendo o motivo mantem o buraco visivel.
 *
 * Miniaturas, ofuscacao e OCR dependem dela — unir, dividir e assinar nao.
 */
export async function requireOffscreenCanvas(page: Page): Promise<void> {
  const supported = await page.evaluate(() => typeof OffscreenCanvas !== 'undefined');
  test.skip(!supported, 'Motor sem OffscreenCanvas: renderizacao de pagina indisponivel.');
}
