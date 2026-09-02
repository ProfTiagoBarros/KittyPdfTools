import { getDocument } from 'pdfjs-dist';
import { pdfjsDocumentOptions } from './pdfjs-setup';
import { paintBlackout } from '../redaction/blackout';
import type { PageRasterizer, RasterizeRequest, RasterPage } from '../redaction/types';
import { coreError } from '../errors';

export interface PageThumbnail {
  /**
   * Transferivel sem copia entre worker e main thread. Quem recebe assume a posse e
   * DEVE chamar `close()` ao descartar — e a Regra de Ouro 3 aplicada a bitmaps.
   */
  readonly bitmap: ImageBitmap;
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * Tamanho da pagina em pontos. Sem isto nao ha como converter um retangulo desenhado na
   * tela para o espaco de usuario do PDF, que e o que a ofuscacao consome.
   */
  readonly widthPt: number;
  readonly heightPt: number;
}

export interface DocumentRenderer extends PageRasterizer {
  readonly pageCount: number;
  /** Miniatura com a maior aresta limitada a `maxEdge` pixels, preservando proporcao. */
  renderThumbnail(pageIndex: number, maxEdge: number): Promise<PageThumbnail>;
  /**
   * Texto extraivel da pagina, na ordem em que o pdf.js o encontra.
   *
   * **Nao e o que um leitor humano ve.** Uma pagina que so contem imagem devolve string
   * vazia ate que o OCR (US-04) escreva a camada invisivel.
   */
  textOf(pageIndex: number): Promise<string>;
  /**
   * Se a pagina ja possui texto extraivel.
   *
   * Serve para nao reprocessar com OCR uma pagina que ja e pesquisavel: OCR e a operacao
   * mais lenta do produto, e digitalizar o que ja esta digital nao acrescenta nada.
   */
  hasText(pageIndex: number): Promise<boolean>;
  dispose(): Promise<void>;
}

/**
 * Abre um PDF para renderizacao e o MANTEM aberto.
 *
 * Reabrir por pagina faria o pdf.js reinterpretar o arquivo a cada miniatura — inviavel numa
 * grade que rola por centenas de paginas.
 */
export async function openForRendering(pdf: Uint8Array): Promise<DocumentRenderer> {
  const task = getDocument(pdfjsDocumentOptions(pdf));
  const document = await task.promise;

  /** Declarada a parte para que `hasText` a chame sem depender de `this` no objeto devolvido. */
  async function textOf(pageIndex: number): Promise<string> {
    const page = await document.getPage(pageIndex + 1);
    const content = await page.getTextContent();

    // Quebra de linha marcada pelo proprio pdf.js. Nao insira separador entre os demais
    // itens: uma palavra frequentemente chega partida em varios (kerning, mudanca de fonte),
    // e separar juntaria lixo no meio dela.
    return content.items
      .map((item) => {
        if (!('str' in item)) return '';
        return item.hasEOL ? `${item.str}\n` : item.str;
      })
      .join('');
  }

  async function draw(
    pageIndex: number,
    scale: number,
    blackout: readonly RasterizeRequest['blackout'][number][] = [],
  ) {
    const page = await document.getPage(pageIndex + 1);
    // O viewport ja aplica a rotacao da pagina, entao a imagem sai sempre "em pe".
    const viewport = page.getViewport({ scale });
    const unscaled = page.getViewport({ scale: 1 });

    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (context === null) throw coreError('NO_CANVAS_CONTEXT', {}, 'Sem contexto 2d');

    // PDFs assumem papel branco; sem isto o fundo sai transparente.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    if (blackout.length > 0) paintBlackout(context, viewport, blackout);

    return { canvas, context, viewport, unscaled };
  }

  return {
    pageCount: document.numPages,

    async renderThumbnail(pageIndex: number, maxEdge: number): Promise<PageThumbnail> {
      if (maxEdge <= 0) throw coreError('INVALID_MAX_EDGE', { maxEdge }, 'maxEdge invalido');

      const page = await document.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = maxEdge / Math.max(base.width, base.height);

      const { canvas } = await draw(pageIndex, scale);

      return {
        bitmap: canvas.transferToImageBitmap(),
        widthPx: canvas.width,
        heightPx: canvas.height,
        widthPt: base.width,
        heightPt: base.height,
      };
    },

    async rasterize(request: RasterizeRequest): Promise<RasterPage> {
      const { canvas, unscaled } = await draw(request.pageIndex, request.scale, request.blackout);
      const format = request.format ?? 'png';
      const blob = await canvas.convertToBlob(
        format === 'jpeg'
          ? { type: 'image/jpeg', quality: request.quality ?? 0.7 }
          : { type: 'image/png' },
      );

      return {
        image: new Uint8Array(await blob.arrayBuffer()),
        format,
        widthPt: unscaled.width,
        heightPt: unscaled.height,
        widthPx: canvas.width,
        heightPx: canvas.height,
      };
    },

    textOf,

    async hasText(pageIndex: number): Promise<boolean> {
      return (await textOf(pageIndex)).trim().length > 0;
    },

    dispose: () => task.destroy(),
  };
}
