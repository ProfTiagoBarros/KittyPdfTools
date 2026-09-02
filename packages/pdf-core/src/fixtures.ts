import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';

export const PAGE_WIDTH = 400;
export const PAGE_HEIGHT = 260;

export interface FixtureLine {
  readonly text: string;
  readonly y: number;
  readonly size?: number;
}

/**
 * PDF sintetico e deterministico. Funciona em Node e no navegador, o que permite que a
 * mesma fixture alimente os testes dos dois ambientes — condicao para comparar paridade.
 */
export async function createTextPdf(
  pages: readonly (readonly FixtureLine[])[],
  options: { readonly rotate?: number } = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const lines of pages) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (options.rotate !== undefined) page.setRotation(degrees(options.rotate));

    for (const line of lines) {
      page.drawText(line.text, {
        x: 30,
        y: line.y,
        size: line.size ?? 14,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return document.save({ useObjectStreams: false });
}
