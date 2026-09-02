/**
 * Erros do nucleo, identificados por codigo.
 *
 * POR QUE CODIGO E NAO TEXTO: a mensagem de um erro do nucleo acaba na tela do usuario. Se
 * for uma string pronta, ela chega sempre no idioma em que foi escrita — e uma interface em
 * ingles passa a exibir meia frase em portugues. O codigo mais os parametros deixam a UI
 * montar a frase no idioma corrente, sem o nucleo saber que idiomas existem.
 *
 * A `message` que acompanha cada erro serve a log, depuracao e teste. **Nunca deve ser
 * mostrada ao usuario** — a UI resolve pelo codigo, e usa um texto generico proprio quando o
 * codigo for desconhecido.
 */

/** Parametros de cada codigo. O tipo obriga quem lanca a informar o que a frase precisa. */
export interface ErrorParamsByCode {
  // Composicao (US-01)
  EMPTY_COMPOSITION: Record<string, never>;
  DUPLICATE_SOURCE: { source: string };
  UNKNOWN_SOURCE: { source: string };
  PAGE_OUT_OF_RANGE: { source: string; pageIndex: number; lastIndex: number };
  INVALID_ROTATION: { rotate: number };

  // Intervalos e divisao (US-02)
  DOCUMENT_HAS_NO_PAGES: Record<string, never>;
  EMPTY_RANGE_SPEC: Record<string, never>;
  INVALID_RANGE_PART: { part: string };
  REVERSED_RANGE: { part: string };
  INVALID_PAGE_NUMBER: { part: string };
  PAGE_DOES_NOT_EXIST: { part: string; page: number; total: number };
  INVALID_MAX_BYTES: { maxBytes: number };
  EMPTY_ARCHIVE: Record<string, never>;

  // Ofuscacao (US-03)
  INVALID_SCALE: { scale: number };
  REDACTION_PAGE_OUT_OF_RANGE: { pageIndex: number; lastIndex: number };

  // Renderizacao
  INVALID_MAX_EDGE: { maxEdge: number };
  NO_CANVAS_CONTEXT: Record<string, never>;

  /**
   * Invariante interna violada. Nao deveria alcancar o usuario; se alcancar, e defeito nosso,
   * e a UI mostra um texto generico em vez de expor detalhe de implementacao.
   */
  INTERNAL: { detail: string };
}

export type PdfCoreErrorCode = keyof ErrorParamsByCode;

/** Forma dos parametros ja apagada, para quem apenas captura o erro. */
export type PdfCoreErrorParams = Readonly<Record<string, string | number>>;

export class PdfCoreError extends Error {
  readonly code: PdfCoreErrorCode;
  readonly params: PdfCoreErrorParams;

  constructor(code: PdfCoreErrorCode, params: PdfCoreErrorParams, message: string) {
    super(message);
    this.name = 'PdfCoreError';
    this.code = code;
    this.params = params;
  }
}

/**
 * Cria um erro do nucleo com os parametros exigidos pelo codigo.
 *
 * A tipagem por codigo acontece aqui, no ponto em que o erro e lancado; quem captura recebe
 * um `PdfCoreError` simples, porque `catch` nunca sabe qual codigo virá.
 */
export function coreError<C extends PdfCoreErrorCode>(
  code: C,
  params: ErrorParamsByCode[C],
  message: string,
): PdfCoreError {
  return new PdfCoreError(code, params, message);
}

export function isPdfCoreError(value: unknown): value is PdfCoreError {
  return value instanceof PdfCoreError;
}
