import type { PageRef } from 'pdf-core';
import { isEnvelope } from './messages';
import type { CancelRequest, CancelledMessage, ErrorMessage, ProgressMessage } from './messages';

/**
 * Protocolo do worker de documentos (US-01 e US-02).
 *
 * O worker e residente e DONO DOS BYTES: a UI envia cada PDF uma unica vez, por `load`, e
 * depois trafega apenas identificadores, composicoes e comandos. Isso evita retransferir
 * dezenas de megabytes a cada exportacao e mantem a main thread sem copia dos documentos.
 */

export interface LoadRequest {
  readonly kind: 'load';
  readonly id: string;
  readonly documentId: string;
  /** Transferido por transfer list: o buffer do lado da UI e destacado de proposito. */
  readonly bytes: ArrayBuffer;
}

export interface UnloadRequest {
  readonly kind: 'unload';
  readonly id: string;
  readonly documentId: string;
}

export interface ComposeRequest {
  readonly kind: 'compose';
  readonly id: string;
  readonly composition: readonly PageRef[];
}

export interface ExtractRequest {
  readonly kind: 'extract';
  readonly id: string;
  readonly documentId: string;
  readonly spec: string;
}

export interface SplitByRangesRequest {
  readonly kind: 'splitByRanges';
  readonly id: string;
  readonly documentId: string;
  readonly spec: string;
}

export interface SplitBySizeRequest {
  readonly kind: 'splitBySize';
  readonly id: string;
  readonly documentId: string;
  readonly maxBytes: number;
}

/**
 * Como dividir. Tres modos explicitos, porque cada um produz um resultado diferente e o
 * usuario precisa saber qual antes de executar.
 */
export type SplitMode =
  | { readonly kind: 'extract'; readonly spec: string }
  | { readonly kind: 'ranges'; readonly spec: string }
  | { readonly kind: 'size'; readonly maxBytes: number };

/**
 * Divide a COMPOSICAO, nao um arquivo de origem.
 *
 * Compor e dividir acontecem no mesmo lugar de proposito: trazer o PDF montado ate a UI so
 * para reenvia-lo ao worker faria dois trafegos inuteis de um documento inteiro.
 */
export interface SplitCompositionRequest {
  readonly kind: 'splitComposition';
  readonly id: string;
  readonly composition: readonly PageRef[];
  readonly mode: SplitMode;
}

export type DocumentRequest =
  | LoadRequest
  | UnloadRequest
  | ComposeRequest
  | ExtractRequest
  | SplitByRangesRequest
  | SplitBySizeRequest
  | SplitCompositionRequest
  | CancelRequest;

export interface LoadedMessage {
  readonly kind: 'loaded';
  readonly id: string;
  readonly documentId: string;
  readonly pageCount: number;
}

export interface UnloadedMessage {
  readonly kind: 'unloaded';
  readonly id: string;
}

export interface BuiltMessage {
  readonly kind: 'built';
  readonly id: string;
  readonly pdf: ArrayBuffer;
}

export interface VolumesMessage {
  readonly kind: 'volumes';
  readonly id: string;
  readonly volumes: readonly ArrayBuffer[];
  /** Paginas que sozinhas excedem o limite; so aparece em splitBySize. */
  readonly oversizedPages: readonly number[];
}

export type DocumentResponse =
  | LoadedMessage
  | UnloadedMessage
  | BuiltMessage
  | VolumesMessage
  | ProgressMessage
  | CancelledMessage
  | ErrorMessage;

const RESPONSE_KINDS = new Set([
  'loaded',
  'unloaded',
  'built',
  'volumes',
  'progress',
  'cancelled',
  'error',
]);

export function isDocumentResponse(value: unknown): value is DocumentResponse {
  return isEnvelope(value) && RESPONSE_KINDS.has(value.kind);
}
