import { isEnvelope } from './messages';
import type { RedactionArea } from 'pdf-core';
import type { CancelledMessage, ErrorMessage, ProgressMessage } from './messages';

/**
 * Protocolo do worker de renderizacao.
 *
 * Residente e dono dos documentos abertos no pdf.js: miniaturas e ofuscacao compartilham o
 * mesmo documento aberto. Reabrir por miniatura faria o pdf.js reinterpretar o arquivo a
 * cada rolagem da grade.
 */

export interface OpenRequest {
  readonly kind: 'open';
  readonly id: string;
  readonly documentId: string;
  /** Transferido por transfer list: os bytes passam a pertencer ao worker. */
  readonly bytes: ArrayBuffer;
}

export interface CloseRequest {
  readonly kind: 'close';
  readonly id: string;
  readonly documentId: string;
}

export interface ThumbnailRequest {
  readonly kind: 'thumbnail';
  readonly id: string;
  readonly documentId: string;
  readonly pageIndex: number;
  readonly maxEdge: number;
}

export interface RedactRequest {
  readonly kind: 'redact';
  readonly id: string;
  readonly documentId: string;
  readonly areas: readonly RedactionArea[];
  readonly scale?: number;
}

export interface OcrRequest {
  readonly kind: 'ocr';
  readonly id: string;
  readonly documentId: string;
  /** Paginas a reconhecer, base 0. Vazio significa o documento inteiro. */
  readonly pageIndexes: readonly number[];
  /** Pula paginas que ja tem texto extraivel: OCR e a operacao mais lenta do produto. */
  readonly skipPagesWithText: boolean;
}

export interface PageTextsRequest {
  readonly kind: 'pageTexts';
  readonly id: string;
  readonly documentId: string;
}

export type RenderRequest =
  OpenRequest | CloseRequest | ThumbnailRequest | RedactRequest | OcrRequest | PageTextsRequest;

export interface OpenedMessage {
  readonly kind: 'opened';
  readonly id: string;
  readonly documentId: string;
  readonly pageCount: number;
}

export interface ClosedMessage {
  readonly kind: 'closed';
  readonly id: string;
}

export interface ThumbnailMessage {
  readonly kind: 'thumbnail';
  readonly id: string;
  /** Transferido sem copia. Quem recebe assume a posse e precisa chamar `close()`. */
  readonly bitmap: ImageBitmap;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Tamanho da pagina em pontos, para converter coordenadas de tela em espaco do PDF. */
  readonly widthPt: number;
  readonly heightPt: number;
}

export interface RedactedMessage {
  readonly kind: 'redacted';
  readonly id: string;
  readonly pdf: ArrayBuffer;
}

export interface OcrDoneMessage {
  readonly kind: 'ocrDone';
  readonly id: string;
  readonly pdf: ArrayBuffer;
  /** Paginas efetivamente reconhecidas, base 0. */
  readonly recognizedPages: readonly number[];
  /** Paginas puladas por ja terem texto. */
  readonly skippedPages: readonly number[];
  readonly wordsWritten: number;
  readonly wordsSkipped: number;
}

export interface PageTextsMessage {
  readonly kind: 'pageTexts';
  readonly id: string;
  /** Uma entrada por pagina, na ordem do documento. Pagina sem texto vem como string vazia. */
  readonly texts: readonly string[];
}

export type RenderResponse =
  | OpenedMessage
  | PageTextsMessage
  | ClosedMessage
  | ThumbnailMessage
  | RedactedMessage
  | OcrDoneMessage
  | ProgressMessage
  | CancelledMessage
  | ErrorMessage;

const RESPONSE_KINDS = new Set([
  'opened',
  'closed',
  'thumbnail',
  'redacted',
  'ocrDone',
  'pageTexts',
  'progress',
  'cancelled',
  'error',
]);

export function isRenderResponse(value: unknown): value is RenderResponse {
  return isEnvelope(value) && RESPONSE_KINDS.has(value.kind);
}
