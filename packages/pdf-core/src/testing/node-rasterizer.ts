import { createCanvas } from '@napi-rs/canvas';
import { loadWithPdfjs, type LoadedPdf } from './pdfjs';
import { paintBlackout } from '../redaction/blackout';
import type { PageRasterizer, RasterizeRequest, RasterPage } from '../redaction/types';

export interface DisposableRasterizer extends PageRasterizer {
  dispose(): Promise<void>;
}

/**
 * Rasterizador para Node, usado nos testes. No produto, o worker de renderizacao implementa
 * a mesma porta com OffscreenCanvas — o nucleo nao distingue um do outro.
 *
 * Mantem o documento aberto entre chamadas: reabri-lo por pagina faria o pdf.js reinterpretar
 * o arquivo inteiro a cada pagina ofuscada.
 */
export async function createNodeRasterizer(pdf: Uint8Array): Promise<DisposableRasterizer> {
  const loaded: LoadedPdf = await loadWithPdfjs(pdf);

  return {
    async rasterize(request: RasterizeRequest): Promise<RasterPage> {
      const page = await loaded.doc.getPage(request.pageIndex + 1);

      // O viewport ja aplica a rotacao da pagina, entao a imagem sai sempre "em pe".
      const viewport = page.getViewport({ scale: request.scale });
      const unscaled = page.getViewport({ scale: 1 });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');

      // PDFs assumem papel branco; sem isto o fundo sai transparente e vira preto no PNG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      // O canvas nativo implementa a superficie de desenho que o pdf.js usa de fato, mas nao
      // e um HTMLCanvasElement do DOM. A conversao fica confinada a este adaptador de teste.
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;

      // A destruicao acontece aqui: pintar sobre o bitmap sobrescreve os pixels de vez.
      paintBlackout(context, viewport, request.blackout);

      return {
        png: new Uint8Array(canvas.toBuffer('image/png')),
        widthPt: unscaled.width,
        heightPt: unscaled.height,
        widthPx: canvas.width,
        heightPx: canvas.height,
      };
    },

    dispose: loaded.dispose,
  };
}
