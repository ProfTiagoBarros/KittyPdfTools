import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { addInvisibleTextLayer } from './text-layer';
import type { OcrWord } from './types';
import { createTextPdf, PAGE_WIDTH, PAGE_HEIGHT } from '../fixtures';
import { extractAllText } from '../testing/index';

/** Página em branco do tamanho das fixtures, simulando um digitalizado sem texto. */
async function blankPages(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return document.save({ useObjectStreams: false });
}

/** Caixa em pixels de uma imagem rasterizada a 2x da página. */
function word(text: string, x0: number, y0: number): OcrWord {
  return { text, x0, y0, x1: x0 + text.length * 12, y1: y0 + 24 };
}

const IMAGE_WIDTH = PAGE_WIDTH * 2;
const IMAGE_HEIGHT = PAGE_HEIGHT * 2;

describe('camada de texto invisivel', () => {
  it('torna pesquisavel uma pagina que nao tinha texto algum', async () => {
    const scanned = await blankPages(1);
    // Controle: sem isto, o teste passaria mesmo que a camada nao fizesse nada.
    expect((await extractAllText(scanned)).trim()).toBe('');

    const { pdf, report } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 0,
        words: [word('CONTRATO', 40, 60), word('SIGILOSO', 40, 100)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    const text = await extractAllText(pdf);
    expect(text).toContain('CONTRATO');
    expect(text).toContain('SIGILOSO');
    expect(report).toEqual({ written: 2, skipped: 0 });
  });

  it('posiciona o texto onde o OCR viu a palavra', async () => {
    const scanned = await blankPages(1);
    // Palavra no topo da imagem deve cair na metade de cima da pagina, no espaco do PDF.
    const { pdf } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 0,
        words: [word('TOPO', 20, 20)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    const { pdfjs } = await import('../testing/pdfjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    const item = content.items.find((entry) => 'str' in entry && entry.str.includes('TOPO'));
    await task.destroy();

    const transform = (item as { transform: number[] }).transform;
    const y = transform[5] ?? 0;
    expect(y).toBeGreaterThan(PAGE_HEIGHT / 2);
  });

  it('preserva o texto que a pagina ja tinha', async () => {
    const original = await createTextPdf([[{ text: 'TEXTO-ORIGINAL', y: 150 }]]);

    const { pdf } = await addInvisibleTextLayer(original, [
      {
        pageIndex: 0,
        words: [word('OCR-ACRESCENTADO', 20, 20)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    const text = await extractAllText(pdf);
    expect(text).toContain('TEXTO-ORIGINAL');
    expect(text).toContain('OCR-ACRESCENTADO');
  });

  it('nao altera paginas ausentes do resultado do OCR', async () => {
    const scanned = await blankPages(3);
    const { pdf } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 1,
        words: [word('SOMENTE-NA-DOIS', 20, 20)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(3);
    expect(await extractAllText(pdf)).toContain('SOMENTE-NA-DOIS');
  });

  it('descarta palavra com glifo fora da fonte, sem derrubar o documento', async () => {
    const scanned = await blankPages(1);
    const { pdf, report } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 0,
        words: [word('VALIDO', 20, 20), word('日本語', 20, 60)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    expect(report.written).toBe(1);
    expect(report.skipped).toBe(1);
    expect(await extractAllText(pdf)).toContain('VALIDO');
  });

  it('ignora palavra vazia ou so com espacos', async () => {
    const scanned = await blankPages(1);
    const { report } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 0,
        words: [word('OK', 20, 20), { text: '   ', x0: 0, y0: 0, x1: 10, y1: 10 }],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    expect(report).toEqual({ written: 1, skipped: 1 });
  });

  it('mantem acentuacao do portugues', async () => {
    const scanned = await blankPages(1);
    const { pdf, report } = await addInvisibleTextLayer(scanned, [
      {
        pageIndex: 0,
        words: [word('CONTRIBUIÇÃO', 20, 20)],
        imageWidthPx: IMAGE_WIDTH,
        imageHeightPx: IMAGE_HEIGHT,
      },
    ]);

    expect(report.skipped).toBe(0);
    expect(await extractAllText(pdf)).toContain('CONTRIBUIÇÃO');
  });

  it('rejeita pagina fora do intervalo', async () => {
    const scanned = await blankPages(1);
    await expect(
      addInvisibleTextLayer(scanned, [
        { pageIndex: 5, words: [], imageWidthPx: IMAGE_WIDTH, imageHeightPx: IMAGE_HEIGHT },
      ]),
    ).rejects.toMatchObject({ code: 'PAGE_OUT_OF_RANGE' });
  });

  it('rejeita dimensoes de imagem invalidas', async () => {
    const scanned = await blankPages(1);
    await expect(
      addInvisibleTextLayer(scanned, [
        { pageIndex: 0, words: [], imageWidthPx: 0, imageHeightPx: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_SCALE' });
  });
});
