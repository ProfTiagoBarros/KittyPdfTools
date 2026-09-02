import { test, expect } from '@playwright/test';
import { requireOffscreenCanvas } from './capabilities';

/**
 * Prova a ofuscacao num navegador de verdade: Web Worker + OffscreenCanvas + o mesmo nucleo
 * ja verificado em Node. Os testes de Node usam `@napi-rs/canvas`; esta suite existe porque
 * os dois rasterizadores podem divergir, e a rasterizacao e onde a seguranca de US-03 mora.
 */

interface Pixel {
  r: number;
  g: number;
  b: number;
}

interface SpikeReport {
  originalTextHasSecret: boolean;
  originalBytesHaveSecret: boolean;
  redactedTextHasSecret: boolean;
  redactedBytesHaveSecret: boolean;
  redactedHasIncrementalHistory: boolean;
  redactedTextIsEmpty: boolean;
  blackoutPixel: Pixel;
  controlPixel: Pixel;
  thumbnailWidth: number;
  thumbnailHeight: number;
  thumbnailIsCached: boolean;
  cacheEvicts: boolean;
  progressEvents: number;
}

declare global {
  interface Window {
    __pdfkittySpike?: { run: () => Promise<SpikeReport> };
  }
}

test.describe('ofuscacao no navegador', () => {
  let report: SpikeReport;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await requireOffscreenCanvas(page);
    await page.goto('/spike/ofuscar/');
    // Espera o gancho do banco de provas existir, e nao um texto que sinalize isso
    // indiretamente: o que o teste precisa e a funcao, nao o rotulo.
    await page.waitForFunction(() => '__pdfkittySpike' in window);

    report = await page.evaluate(async () => {
      const spike = window.__pdfkittySpike;
      if (spike === undefined) throw new Error('banco de provas nao inicializado');
      return spike.run();
    });

    expect(consoleErrors, 'o worker nao deve lancar erro nao tratado').toEqual([]);
    await page.close();
  });

  test('o documento original REALMENTE expoe o segredo (validade do teste)', () => {
    // Sem isto, todas as asercoes abaixo passariam mesmo com uma ofuscacao que nao faz nada.
    expect(report.originalTextHasSecret).toBe(true);
    expect(report.originalBytesHaveSecret).toBe(true);
  });

  test('verificacao 1 — o segredo nao e mais extraivel como texto', () => {
    expect(report.redactedTextHasSecret).toBe(false);
    expect(report.redactedTextIsEmpty).toBe(true);
  });

  test('verificacao 2 — o segredo nao sobrevive nos bytes, nem em stream comprimido', () => {
    expect(report.redactedBytesHaveSecret).toBe(false);
  });

  test('verificacao 3 — nao ha atualizacao incremental preservando a versao anterior', () => {
    expect(report.redactedHasIncrementalHistory).toBe(false);
  });

  test('a regiao marcada saiu efetivamente preta', () => {
    const { r, g, b } = report.blackoutPixel;
    expect(r + g + b, `pixel central da regiao: rgb(${r},${g},${b})`).toBeLessThan(60);
  });

  test('a area fora da marcacao permanece intacta', () => {
    // Descarta o falso positivo em que a pagina inteira ficou preta e o segredo
    // "desapareceu" por destruicao total, e nao por ofuscacao correta.
    const { r, g, b } = report.controlPixel;
    expect(r + g + b, `pixel de controle: rgb(${r},${g},${b})`).toBeGreaterThan(600);
  });

  test('gera miniatura respeitando a aresta maxima e a proporcao da pagina', () => {
    // Pagina 400x260 com maxEdge 120: a maior aresta vira 120, a menor acompanha.
    expect(report.thumbnailWidth).toBe(120);
    expect(report.thumbnailHeight).toBe(78);
  });

  test('pedir a mesma miniatura duas vezes nao re-renderiza', () => {
    expect(report.thumbnailIsCached).toBe(true);
  });

  test('a ofuscacao reporta progresso (Regra de Ouro 2)', () => {
    expect(report.progressEvents).toBeGreaterThan(0);
  });

  test('o cache descarta as miniaturas mais antigas ao encher', () => {
    // Sem descarte, um PDF de centenas de paginas manteria todos os bitmaps vivos.
    expect(report.cacheEvicts).toBe(true);
  });
});
