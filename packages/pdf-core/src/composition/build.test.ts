import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { buildComposition, readPageCount, composeAllPages } from './build';
import type { SourceDocument } from './types';
import { createTextPdf } from '../fixtures';
import { extractAllText } from '../testing/index';

/** Documento com uma marca por pagina, para provar identidade e ordem apos a montagem. */
async function labelled(prefix: string, pages: number): Promise<Uint8Array> {
  return createTextPdf(
    Array.from({ length: pages }, (_unused, index) => [
      { text: `${prefix}-PAGINA-${index + 1}`, y: 150 },
    ]),
  );
}

async function textOfPage(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const single = await buildComposition([{ id: 'x', bytes }], [{ source: 'x', pageIndex }]);
  return (await extractAllText(single)).trim();
}

describe('buildComposition', () => {
  it('monta um documento com paginas de origens diferentes, na ordem pedida', async () => {
    const a = await labelled('A', 2);
    const b = await labelled('B', 2);
    const sources: SourceDocument[] = [
      { id: 'a', bytes: a },
      { id: 'b', bytes: b },
    ];

    // Intercala as origens: e o cenario que US-01 exige e que merge simples nao cobre.
    const result = await buildComposition(sources, [
      { source: 'b', pageIndex: 1 },
      { source: 'a', pageIndex: 0 },
      { source: 'b', pageIndex: 0 },
    ]);

    expect(await readPageCount(result)).toBe(3);
    expect(await textOfPage(result, 0)).toBe('B-PAGINA-2');
    expect(await textOfPage(result, 1)).toBe('A-PAGINA-1');
    expect(await textOfPage(result, 2)).toBe('B-PAGINA-1');
  });

  it('exclui paginas simplesmente por ausencia na composicao', async () => {
    const a = await labelled('A', 3);
    const result = await buildComposition(
      [{ id: 'a', bytes: a }],
      [
        { source: 'a', pageIndex: 0 },
        { source: 'a', pageIndex: 2 },
      ],
    );

    expect(await readPageCount(result)).toBe(2);
    expect(await extractAllText(result)).not.toContain('A-PAGINA-2');
  });

  it('duplica uma pagina referenciada duas vezes', async () => {
    const a = await labelled('A', 1);
    const result = await buildComposition(
      [{ id: 'a', bytes: a }],
      [
        { source: 'a', pageIndex: 0 },
        { source: 'a', pageIndex: 0 },
      ],
    );

    expect(await readPageCount(result)).toBe(2);
  });

  it('aplica rotacao somando a rotacao original da pagina', async () => {
    const a = await createTextPdf([[{ text: 'X', y: 150 }]], { rotate: 90 });
    const result = await buildComposition(
      [{ id: 'a', bytes: a }],
      [{ source: 'a', pageIndex: 0, rotate: 180 }],
    );

    const page = (await PDFDocument.load(result)).getPage(0);
    expect(page.getRotation().angle).toBe(270);
  });

  it('normaliza rotacao que ultrapassa uma volta completa', async () => {
    const a = await labelled('A', 1);
    const result = await buildComposition(
      [{ id: 'a', bytes: a }],
      [{ source: 'a', pageIndex: 0, rotate: 450 }],
    );

    expect((await PDFDocument.load(result)).getPage(0).getRotation().angle).toBe(90);
  });

  it('preserva o tamanho proprio de cada pagina, sem normalizar', async () => {
    const wide = await PDFDocument.create();
    wide.addPage([600, 200]);
    const wideBytes = await wide.save();
    const normal = await labelled('N', 1);

    const result = await buildComposition(
      [
        { id: 'w', bytes: wideBytes },
        { id: 'n', bytes: normal },
      ],
      [
        { source: 'w', pageIndex: 0 },
        { source: 'n', pageIndex: 0 },
      ],
    );

    const doc = await PDFDocument.load(result);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(600, 0);
    expect(doc.getPage(1).getSize().width).toBeCloseTo(400, 0);
  });

  it('rejeita composicao vazia', async () => {
    const a = await labelled('A', 1);
    await expect(buildComposition([{ id: 'a', bytes: a }], [])).rejects.toMatchObject({
      code: 'EMPTY_COMPOSITION',
    });
  });

  it('rejeita origem desconhecida', async () => {
    const a = await labelled('A', 1);
    await expect(
      buildComposition([{ id: 'a', bytes: a }], [{ source: 'z', pageIndex: 0 }]),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE', params: { source: 'z' } });
  });

  it('rejeita origens com o mesmo identificador', async () => {
    const a = await labelled('A', 1);
    await expect(
      buildComposition(
        [
          { id: 'a', bytes: a },
          { id: 'a', bytes: a },
        ],
        [{ source: 'a', pageIndex: 0 }],
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE' });
  });

  it('rejeita pagina fora do intervalo informando o limite nos parametros', async () => {
    const a = await labelled('A', 2);
    await expect(
      buildComposition([{ id: 'a', bytes: a }], [{ source: 'a', pageIndex: 5 }]),
    ).rejects.toMatchObject({
      code: 'PAGE_OUT_OF_RANGE',
      params: { pageIndex: 5, lastIndex: 1 },
    });
  });

  it('rejeita rotacao que nao e multiplo de 90', async () => {
    const a = await labelled('A', 1);
    await expect(
      buildComposition([{ id: 'a', bytes: a }], [{ source: 'a', pageIndex: 0, rotate: 45 }]),
    ).rejects.toMatchObject({ code: 'INVALID_ROTATION', params: { rotate: 45 } });
  });
});

describe('composeAllPages', () => {
  it('reproduz varios documentos por inteiro, na ordem informada (fusao — US-02)', async () => {
    const a = await labelled('A', 2);
    const b = await labelled('B', 3);
    const sources: SourceDocument[] = [
      { id: 'a', bytes: a },
      { id: 'b', bytes: b },
    ];

    const merged = await buildComposition(sources, await composeAllPages(sources));

    expect(await readPageCount(merged)).toBe(5);
    expect(await textOfPage(merged, 0)).toBe('A-PAGINA-1');
    expect(await textOfPage(merged, 4)).toBe('B-PAGINA-3');
  });
});

/**
 * Limitacao conhecida, fixada em teste de proposito.
 *
 * Marcadores nao sobrevivem a montagem: remapear destinos entre documentos e trabalho de
 * estrutura de PDF que o pdf-lib nao oferece. O teste existe para que a perda seja uma
 * decisao registrada — e para avisar, falhando, no dia em que passarmos a preserva-los.
 */
describe('limitacao conhecida — marcadores', () => {
  it('o documento montado nao carrega o outline da origem', async () => {
    const source = await PDFDocument.create();
    source.addPage([400, 260]);
    source.addPage([400, 260]);
    const context = source.context;
    const { PDFName } = await import('@cantoo/pdf-lib');
    source.catalog.set(PDFName.of('Outlines'), context.obj({}));
    const bytes = await source.save();

    const result = await buildComposition(
      [{ id: 's', bytes }],
      [
        { source: 's', pageIndex: 0 },
        { source: 's', pageIndex: 1 },
      ],
    );

    // Controle: sem isto, o teste passaria mesmo que a origem nunca tivesse tido outline.
    const reloadedSource = await PDFDocument.load(bytes);
    expect(reloadedSource.catalog.get(PDFName.of('Outlines'))).toBeDefined();

    const rebuilt = await PDFDocument.load(result);
    expect(rebuilt.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });
});
