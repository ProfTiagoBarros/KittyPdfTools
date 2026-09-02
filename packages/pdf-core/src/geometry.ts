/**
 * Retangulo em espaco de usuario do PDF: unidade em pontos, origem no canto
 * INFERIOR esquerdo da pagina. Nao confundir com coordenadas de tela, que crescem
 * para baixo — a conversao entre os dois e responsabilidade do rasterizador.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Garante largura e altura positivas, aceitando retangulos desenhados em qualquer direcao. */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Expande o retangulo em todas as direcoes. Usado como margem de seguranca na ofuscacao. */
export function padRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}
