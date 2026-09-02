/** O que o worker de renderizacao devolve e que a tela sabe desenhar. */
export interface RenderedPage {
  readonly bitmap: ImageBitmap;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Pinta a pagina no canvas ja com a rotacao do usuario aplicada.
 *
 * A rotacao entra no DESENHO, e nao numa transformacao CSS: girando 90 graus, largura e
 * altura trocam de lugar, e uma transformacao visual deixaria a imagem estourando a celula
 * que a contem. Por isso o canvas e redimensionado antes de desenhar.
 *
 * Mora aqui porque a miniatura da grade e a visualizacao ampliada precisam do mesmo
 * resultado: se as duas divergirem, a pagina que o usuario inspeciona deixa de ser a que ele
 * vai receber.
 */
export function drawRotated(canvas: HTMLCanvasElement, page: RenderedPage, rotate: number): void {
  const quarterTurn = rotate === 90 || rotate === 270;
  canvas.width = quarterTurn ? page.heightPx : page.widthPx;
  canvas.height = quarterTurn ? page.widthPx : page.heightPx;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('sem contexto 2d no canvas da pagina');

  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotate * Math.PI) / 180);
  context.drawImage(page.bitmap, -page.widthPx / 2, -page.heightPx / 2);
  context.restore();
}
