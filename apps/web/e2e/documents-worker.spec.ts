import { test, expect } from '@playwright/test';

/**
 * Prova US-01 e US-02 atraves do worker residente, num navegador de verdade. O nucleo ja
 * tem 54 testes em Node; o que se verifica aqui e a fronteira: transferencia de bytes,
 * posse dos documentos pelo worker, progresso e cancelamento.
 */

interface DocsReport {
  pageCountA: number;
  pageCountB: number;
  composedPageCount: number;
  composedFirstPage: string;
  composedSecondPage: string;
  extractedPageCount: number;
  rangeVolumeCounts: number[];
  sizeVolumeCount: number;
  sizeVolumesWithinLimit: boolean;
  sizeTotalPages: number;
  progressEvents: number;
  cancelledAsCancellation: boolean;
  errorForUnknownDocument: string;
  loadDoesNotRead: boolean;
}

declare global {
  interface Window {
    __pdfkittyDocs?: { run: () => Promise<DocsReport> };
  }
}

test.describe('worker de documentos', () => {
  let report: DocsReport;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/spike/documentos/');
    // Espera o gancho do banco de provas existir, e nao um texto que sinalize isso
    // indiretamente: o que o teste precisa e a funcao, nao o rotulo.
    await page.waitForFunction(() => '__pdfkittyDocs' in window);

    report = await page.evaluate(async () => {
      const spike = window.__pdfkittyDocs;
      if (spike === undefined) throw new Error('banco de provas nao inicializado');
      return spike.run();
    });

    expect(pageErrors, 'o worker nao deve lancar erro nao tratado').toEqual([]);
    await page.close();
  });

  test('os documentos de teste tem a contagem esperada', () => {
    expect(report.pageCountA).toBe(2);
    expect(report.pageCountB).toBe(3);
  });

  test('registrar um documento nao le o arquivo', () => {
    // O worker guarda o `File` e le so quando uma operacao precisa: ate um arquivo que nao e
    // PDF e aceito no registro. Quem recusa e o worker de renderizacao, ao abrir para contar
    // as paginas. Ler aqui custava o arquivo inteiro na memoria por documento aberto.
    expect(report.loadDoesNotRead).toBe(true);
  });

  test('US-01 — compoe paginas de origens diferentes, na ordem pedida', () => {
    expect(report.composedPageCount).toBe(2);
    expect(report.composedFirstPage).toBe('B-PAGINA-3');
    expect(report.composedSecondPage).toBe('A-PAGINA-1');
  });

  test('US-02 — extrai o recorte do documento de requisitos num unico arquivo', () => {
    expect(report.extractedPageCount).toBe(11);
  });

  test('US-02 — divide em um arquivo por intervalo', () => {
    expect(report.rangeVolumeCounts).toEqual([5, 1, 5]);
  });

  test('US-02 — divide por tamanho respeitando o limite e sem perder paginas', () => {
    expect(report.sizeVolumeCount).toBeGreaterThan(1);
    expect(report.sizeVolumesWithinLimit).toBe(true);
    expect(report.sizeTotalPages).toBe(20);
  });

  test('operacoes longas reportam progresso', () => {
    expect(report.progressEvents).toBe(20);
  });

  test('cancelamento chega como cancelamento, nao como falha', () => {
    // Um cancelamento que aparece como erro generico faria a UI mostrar alerta de falha
    // para uma acao que o proprio usuario pediu.
    expect(report.cancelledAsCancellation).toBe(true);
  });

  test('documento desconhecido produz erro que diz o que houve', () => {
    expect(report.errorForUnknownDocument).toMatch(/inexistente.*nao esta carregado/);
  });
});
