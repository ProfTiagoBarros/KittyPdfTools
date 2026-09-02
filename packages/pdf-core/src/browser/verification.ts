import { getDocument } from 'pdfjs-dist';
import { pdfjsDocumentOptions } from './pdfjs-setup';
import {
  existsInFileBytes as existsInBytes,
  extractTextFrom,
  findTextRectIn,
  type Inflate,
} from '../verification/index';
import type { Rect } from '../geometry';
import type { ViewportLike } from '../redaction/blackout';
import { coreError } from '../errors';

/**
 * Adaptador de inflate para o navegador. `DecompressionStream('deflate')` cobre o formato
 * zlib usado pelos streams FlateDecode de PDF.
 */
const browserInflate: Inflate = async (data) => {
  // Streams FlateDecode usam o formato zlib ('deflate'), mas ha PDFs no mundo real que
  // gravam deflate cru. Tentar os dois evita concluir "sem vazamento" por incapacidade de
  // descomprimir — que e a pior forma de falso negativo num verificador de ofuscacao.
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const stream = new Blob([data as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      continue;
    }
  }
  return undefined;
};

async function withDocument<T>(pdf: Uint8Array, use: (doc: never) => Promise<T>): Promise<T> {
  const task = getDocument(pdfjsDocumentOptions(pdf));
  const doc = await task.promise;
  try {
    return await use(doc as never);
  } finally {
    await task.destroy();
  }
}

export async function extractAllText(pdf: Uint8Array): Promise<string> {
  return withDocument(pdf, (doc) => extractTextFrom(doc));
}

export async function findTextRect(
  pdf: Uint8Array,
  needle: string,
  pageIndex = 0,
): Promise<Rect | undefined> {
  return withDocument(pdf, (doc) => findTextRectIn(doc, needle, pageIndex));
}

export async function existsInFileBytes(pdf: Uint8Array, needle: string): Promise<boolean> {
  return existsInBytes(pdf, needle, browserInflate);
}

export { hasIncrementalHistory } from '../verification/index';

export interface Pixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SamplePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Renderiza uma pagina e le a cor em pontos especificos, em espaco de usuario do PDF.
 *
 * Prova que a area CERTA foi coberta. Sem isto, um blackout deslocado que por acaso
 * apagasse o segredo passaria por todas as demais verificacoes.
 */
export async function samplePixels(
  pdf: Uint8Array,
  points: readonly SamplePoint[],
  pageIndex = 0,
): Promise<Pixel[]> {
  const task = getDocument(pdfjsDocumentOptions(pdf));
  const document = await task.promise;

  try {
    const page = await document.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });

    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (context === null) throw coreError('NO_CANVAS_CONTEXT', {}, 'Sem contexto 2d');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    // O pdf.js declara `convertToViewportPoint` como `any[]`. `ViewportLike` e o tipo que ja
    // usamos para essa mesma conversao na geometria do blackout; reaproveita-lo evita espalhar
    // `any` a partir da fronteira da biblioteca.
    const projection = viewport as unknown as ViewportLike;

    return points.map((point) => {
      const [vx = 0, vy = 0] = projection.convertToViewportPoint(point.x, point.y);
      const [r = 0, g = 0, b = 0] = context.getImageData(Math.round(vx), Math.round(vy), 1, 1).data;
      return { r, g, b };
    });
  } finally {
    await task.destroy();
  }
}
