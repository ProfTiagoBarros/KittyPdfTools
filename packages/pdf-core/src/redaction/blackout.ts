import type { Rect } from '../geometry';

/** Superficie de desenho minima. OffscreenCanvas e canvas nativo satisfazem ambas. */
export interface FillSurface {
  fillStyle: unknown;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** Conversao de espaco de usuario do PDF para pixels, fornecida pelo viewport do pdf.js. */
export interface ViewportLike {
  convertToViewportPoint(x: number, y: number): readonly number[];
}

/**
 * Pinta as regioes sensiveis de preto sobre o bitmap ja renderizado.
 *
 * Esta funcao e deliberadamente compartilhada entre o rasterizador de Node e o do navegador.
 * Se cada ambiente calculasse a propria geometria, a paridade entre eles seria coincidencia,
 * e um erro de conversao apareceria em apenas um dos dois — provavelmente no que nao esta
 * sob teste.
 */
export function paintBlackout(
  surface: FillSurface,
  viewport: ViewportLike,
  rects: readonly Rect[],
): void {
  surface.fillStyle = '#000000';

  for (const rect of rects) {
    // O eixo Y do PDF cresce para cima e o do canvas para baixo, entao os cantos opostos
    // do retangulo trocam de lado na conversao. Normalizar depois evita largura negativa.
    const topLeft = viewport.convertToViewportPoint(rect.x, rect.y + rect.height);
    const bottomRight = viewport.convertToViewportPoint(rect.x + rect.width, rect.y);

    const x0 = topLeft[0] ?? 0;
    const y0 = topLeft[1] ?? 0;
    const x1 = bottomRight[0] ?? 0;
    const y1 = bottomRight[1] ?? 0;

    surface.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
}
