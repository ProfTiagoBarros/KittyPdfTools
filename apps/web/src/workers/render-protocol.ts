import { isEnvelope } from './messages';
import type { CompressionStep, RedactionArea } from 'pdf-core';
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

/**
 * Como compactar. Tres intencoes distintas, e nao um numero de "nivel".
 *
 * `lossless` nao mexe em pixel algum; os outros dois rasterizam e por isso perdem texto. A
 * interface confirma antes de executar qualquer um dos dois ultimos.
 */
export type CompressMode =
  | { readonly kind: 'lossless'; readonly removeInvisibleText: boolean }
  | { readonly kind: 'quality'; readonly step: CompressionStep }
  | { readonly kind: 'target'; readonly maxBytes: number };

/**
 * Compacta um PDF ja montado.
 *
 * Recebe os BYTES, e nao um `documentId`: compactar age sobre a composicao da grade — que
 * pode misturar paginas de varios arquivos —, e nao sobre um documento de origem. O worker
 * abre, trabalha e descarta, sem sujar o mapa de documentos abertos.
 */
export interface CompressRequest {
  readonly kind: 'compress';
  readonly id: string;
  readonly pdf: ArrayBuffer;
  readonly mode: CompressMode;
}

/**
 * Solta todos os documentos abertos no pdf.js, ate a tela reabri-los.
 *
 * Existe para as operacoes pesadas — juntar, dividir, extrair, compactar. Elas acontecem no
 * worker de documentos, mas dividem o MESMO processo com este worker: num Windows 32 bits o
 * conjunto tem ~2 GB. Enquanto o pdf-lib monta o resultado, a copia do pdf.js aqui fica parada
 * ocupando o tamanho inteiro de cada arquivo. Solta-la durante a operacao e o que mantem o
 * pico abaixo do limite.
 */
export interface ReleaseRequest {
  readonly kind: 'release';
  readonly id: string;
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
  | OpenRequest
  | CloseRequest
  | ThumbnailRequest
  | RedactRequest
  | CompressRequest
  | ReleaseRequest
  | OcrRequest
  | PageTextsRequest;

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

export interface ReleasedMessage {
  readonly kind: 'released';
  readonly id: string;
}

export interface CompressedMessage {
  readonly kind: 'compressed';
  readonly id: string;
  readonly pdf: ArrayBuffer;
  readonly originalBytes: number;
  /** Blocos de texto invisivel removidos; so no modo sem perda. */
  readonly invisibleBlocksRemoved: number;
  /** Falso quando o limite pedido nao foi alcancado nem no degrau mais agressivo. */
  readonly fitsTarget: boolean;
  /** Degrau usado, quando houve rasterizacao. */
  readonly step: CompressionStep | null;
  /** Geracoes completas gastas pela busca por tamanho. */
  readonly attempts: number;
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
  | CompressedMessage
  | ReleasedMessage
  | OcrDoneMessage
  | ProgressMessage
  | CancelledMessage
  | ErrorMessage;

const RESPONSE_KINDS = new Set([
  'opened',
  'closed',
  'thumbnail',
  'redacted',
  'compressed',
  'released',
  'ocrDone',
  'pageTexts',
  'progress',
  'cancelled',
  'error',
]);

export function isRenderResponse(value: unknown): value is RenderResponse {
  return isEnvelope(value) && RESPONSE_KINDS.has(value.kind);
}
