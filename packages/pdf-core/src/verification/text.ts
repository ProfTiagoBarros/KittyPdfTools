import type { Rect } from '../geometry';

/** Forma minima de um documento do pdf.js. Evita amarrar a verificacao a um build especifico. */
export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
}

interface TextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

function asTextItem(item: unknown): TextItem | undefined {
  if (typeof item !== 'object' || item === null || !('str' in item)) return undefined;
  return item as TextItem;
}

/** Texto extraivel de todas as paginas, como um leitor de PDF qualquer o veria. */
export async function extractTextFrom(document: PdfDocumentLike): Promise<string> {
  const parts: string[] = [];

  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      const item = asTextItem(raw);
      if (item !== undefined) parts.push(item.str);
    }
  }

  return parts.join(' ');
}

/**
 * Localiza um trecho de texto e devolve seu retangulo em espaco de usuario.
 *
 * E a etapa "localizar" da ofuscacao: na aplicacao real a selecao vem do usuario sobre a
 * miniatura, mas para testar precisamos das coordenadas reais do texto.
 */
export async function findTextRectIn(
  document: PdfDocumentLike,
  needle: string,
  pageIndex = 0,
): Promise<Rect | undefined> {
  const page = await document.getPage(pageIndex + 1);
  const content = await page.getTextContent();

  for (const raw of content.items) {
    const item = asTextItem(raw);
    if (!item?.str.includes(needle)) continue;

    const x = item.transform[4] ?? 0;
    const baseline = item.transform[5] ?? 0;
    const fontHeight = Math.abs(item.transform[3] ?? item.height);

    return {
      x,
      // `y` do pdf.js e a linha de base; o desenho desce um pouco abaixo dela.
      y: baseline - fontHeight * 0.25,
      width: item.width,
      height: fontHeight * 1.25,
    };
  }

  return undefined;
}
