import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { redactByRasterizing } from './rasterize-redaction';
import type { Rect } from '../geometry';
import {
  createNodeRasterizer,
  createTextPdf,
  findTextRect,
  extractAllText,
  existsInFileBytes,
  hasIncrementalHistory,
} from '../testing/index';

const SECRET = 'CPF-123456789-SIGILOSO';
const PUBLIC = 'Relatorio trimestral publico';

async function buildDocument(rotate?: number) {
  return createTextPdf(
    [
      [
        { text: PUBLIC, y: 200 },
        { text: SECRET, y: 150 },
      ],
    ],
    rotate === undefined ? {} : { rotate },
  );
}

describe('ofuscacao por rasterizacao', () => {
  let original: Uint8Array;
  let redacted: Uint8Array;

  beforeAll(async () => {
    original = await buildDocument();
    const rect = await findTextRect(original, SECRET);
    if (rect === undefined) throw new Error('fixture invalido: segredo nao localizado');
    redacted = await redactByRasterizing(
      original,
      [{ pageIndex: 0, rect }],
      await createNodeRasterizer(original),
    );
  });

  it('o documento original REALMENTE expoe o segredo (validade do teste)', async () => {
    // Sem esta asercao, todas as demais passariam mesmo com uma ofuscacao que nao faz nada.
    expect(await extractAllText(original)).toContain(SECRET);
    expect(await existsInFileBytes(original, SECRET)).toBe(true);
  });

  it('verificacao 1 — o segredo nao e mais extraivel como texto', async () => {
    expect(await extractAllText(redacted)).not.toContain(SECRET);
  });

  it('verificacao 2 — o segredo nao sobrevive nos bytes, nem em stream comprimido', async () => {
    expect(await existsInFileBytes(redacted, SECRET)).toBe(false);
  });

  it('verificacao 3 — nao ha atualizacao incremental preservando a versao anterior', () => {
    expect(hasIncrementalHistory(redacted)).toBe(false);
  });

  it('a pagina afetada nao contem operador de texto algum', async () => {
    expect((await extractAllText(redacted)).trim()).toBe('');
  });

  it('preserva as dimensoes da pagina', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const before = (await PDFDocument.load(original)).getPage(0).getSize();
    const after = (await PDFDocument.load(redacted)).getPage(0).getSize();
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });
});

describe('escopo da ofuscacao', () => {
  it('paginas nao afetadas mantem o texto pesquisavel', async () => {
    const original = await createTextPdf([[{ text: SECRET, y: 150 }], [{ text: PUBLIC, y: 150 }]]);
    const rect = await findTextRect(original, SECRET, 0);
    if (rect === undefined) throw new Error('fixture invalido');

    const redacted = await redactByRasterizing(
      original,
      [{ pageIndex: 0, rect }],
      await createNodeRasterizer(original),
    );
    const text = await extractAllText(redacted);

    expect(text).not.toContain(SECRET);
    expect(text).toContain(PUBLIC);
    expect(await existsInFileBytes(redacted, SECRET)).toBe(false);
  });

  it('sem regioes marcadas, devolve o documento inalterado', async () => {
    const original = await buildDocument();
    expect(await redactByRasterizing(original, [], await createNodeRasterizer(original))).toBe(
      original,
    );
  });

  it('rejeita pagina fora do intervalo', async () => {
    const original = await buildDocument();
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    await expect(
      redactByRasterizing(original, [{ pageIndex: 7, rect }], await createNodeRasterizer(original)),
    ).rejects.toMatchObject({ code: 'REDACTION_PAGE_OUT_OF_RANGE' });
  });

  it('lida com pagina rotacionada', async () => {
    const original = await buildDocument(90);
    const rect = await findTextRect(original, SECRET);
    if (rect === undefined) throw new Error('fixture invalido');

    const redacted = await redactByRasterizing(
      original,
      [{ pageIndex: 0, rect }],
      await createNodeRasterizer(original),
    );
    expect(await extractAllText(redacted)).not.toContain(SECRET);
    expect(await existsInFileBytes(redacted, SECRET)).toBe(false);
  });
});

describe('documento real — Documento de Requisitos do PDFKitty', () => {
  const fixturePath = fileURLToPath(
    new URL('../../../../referencias/Documento de Requisitos do PDFKitty.pdf', import.meta.url),
  );
  const NEEDLE = 'LGPD';

  it('remove o trecho escolhido de um PDF nao sintetico', async () => {
    const original = new Uint8Array(await readFile(fixturePath));
    expect(await extractAllText(original)).toContain(NEEDLE);

    const rect = await findTextRect(original, NEEDLE, 0);
    if (rect === undefined) throw new Error(`'${NEEDLE}' nao localizado no documento real`);

    const redacted = await redactByRasterizing(
      original,
      [{ pageIndex: 0, rect }],
      await createNodeRasterizer(original),
    );

    expect(await extractAllText(redacted)).not.toContain(NEEDLE);
    expect(await existsInFileBytes(redacted, NEEDLE)).toBe(false);
    expect(hasIncrementalHistory(redacted)).toBe(false);
  });
});

/**
 * Controle negativo do spike.
 *
 * O criterio de aceite de US-03 diz que desenhar um retangulo preto NAO e ofuscacao. Estes
 * testes constroem exatamente essa implementacao falsa e exigem que as verificacoes a
 * reprovem. Sem isto, nao ha como saber se a suite acima tem poder de deteccao ou se
 * apenas concorda com tudo.
 */
describe('controle negativo — retangulo preto nao e ofuscacao', () => {
  async function drawBlackBoxOver(pdfBytes: Uint8Array, rect: Rect): Promise<Uint8Array> {
    const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
    const document = await PDFDocument.load(pdfBytes);
    const page = document.getPage(0);
    page.drawRectangle({ ...rect, color: rgb(0, 0, 0) });
    return document.save({ useObjectStreams: false });
  }

  it('as verificacoes reprovam a ofuscacao falsa', async () => {
    const original = await buildDocument();
    const rect = await findTextRect(original, SECRET);
    if (rect === undefined) throw new Error('fixture invalido');

    const fake = await drawBlackBoxOver(original, rect);

    // Visualmente identico ao resultado correto — e completamente inseguro.
    expect(await extractAllText(fake)).toContain(SECRET);
    expect(await existsInFileBytes(fake, SECRET)).toBe(true);
  });

  it('a ofuscacao real e a falsa divergem exatamente onde importa', async () => {
    const original = await buildDocument();
    const rect = await findTextRect(original, SECRET);
    if (rect === undefined) throw new Error('fixture invalido');

    const fake = await drawBlackBoxOver(original, rect);
    const real = await redactByRasterizing(
      original,
      [{ pageIndex: 0, rect }],
      await createNodeRasterizer(original),
    );

    expect(await existsInFileBytes(fake, SECRET)).toBe(true);
    expect(await existsInFileBytes(real, SECRET)).toBe(false);
  });
});

describe('progresso', () => {
  it('reporta uma vez por pagina ofuscada, e nao por pagina do documento', async () => {
    const original = await createTextPdf([
      [{ text: SECRET, y: 150 }],
      [{ text: PUBLIC, y: 150 }],
      [{ text: SECRET, y: 150 }],
    ]);
    const rect = await findTextRect(original, SECRET, 0);
    if (rect === undefined) throw new Error('fixture invalido');

    const events: [number, number][] = [];
    await redactByRasterizing(
      original,
      [
        { pageIndex: 0, rect },
        { pageIndex: 2, rect },
      ],
      await createNodeRasterizer(original),
      { onProgress: (completed, total) => events.push([completed, total]) },
    );

    expect(events).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
