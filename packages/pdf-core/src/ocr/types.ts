/**
 * Uma palavra reconhecida, com a caixa que ela ocupa NA IMAGEM analisada.
 *
 * As coordenadas sao em pixels e crescem para baixo, como em qualquer imagem. A conversao
 * para o espaco do PDF — pontos, origem embaixo — acontece em `addInvisibleTextLayer`, que e
 * o unico lugar que precisa conhecer as duas convencoes.
 */
export interface OcrWord {
  readonly text: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface OcrPageText {
  /** Indice da pagina no documento, base 0. */
  readonly pageIndex: number;
  readonly words: readonly OcrWord[];
  /** Dimensoes da imagem que o OCR analisou, para converter pixels em pontos. */
  readonly imageWidthPx: number;
  readonly imageHeightPx: number;
}

export interface TextLayerReport {
  /** Palavras efetivamente escritas na camada invisivel. */
  readonly written: number;
  /**
   * Palavras descartadas por conterem caracteres que a fonte nao representa.
   *
   * Descartar a palavra e melhor do que abortar o documento inteiro por causa de um glifo
   * exotico que o OCR inventou ao ler um borrao.
   */
  readonly skipped: number;
}
