/**
 * Capacidades do motor do navegador exigidas por cada ferramenta.
 *
 * Existe porque descobrimos, rodando a suite no WebKit, que nem todo motor oferece
 * `OffscreenCanvas` — e sem ela nao ha miniatura, ofuscacao nem OCR. Sem esta deteccao o
 * produto falha em silencio: o visualizador fica eternamente em "Lendo arquivo...".
 */

/**
 * Renderizar exige `OffscreenCanvas`: e como o worker desenha a pagina sem tocar no DOM.
 * Sem ela, so restariam miniatura e rasterizacao na thread principal, o que contraria a
 * Regra de Ouro 2.
 */
export function canRenderPages(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** Ferramentas que dependem de renderizacao. Unir e dividir usam apenas o pdf-lib. */
export const RENDERING_TOOLS = ['ocr', 'ofuscar'] as const;
