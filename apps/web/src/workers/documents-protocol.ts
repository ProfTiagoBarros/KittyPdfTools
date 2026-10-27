import type { PageRef } from 'pdf-core';
import { isEnvelope } from './messages';
import type { CancelRequest, CancelledMessage, ErrorMessage, ProgressMessage } from './messages';

/**
 * Protocolo do worker de documentos (US-01 e US-02).
 *
 * O worker e residente e guarda o ARQUIVO de cada documento — o `File` do seletor, que aponta
 * para o disco —, e nao os bytes. Le a origem so quando uma operacao precisa dela, uma de cada
 * vez. Guardar os bytes custava o tamanho inteiro de cada arquivo aberto: oito PDFs escaneados
 * de 70 a 95 MB eram 551 MB parados aqui, e outros tantos no worker de renderizacao.
 */

export interface LoadRequest {
  readonly kind: 'load';
  readonly id: string;
  readonly documentId: string;
  /** Clonado por referencia: um `Blob` atravessa a fronteira sem copiar o conteudo. */
  readonly file: Blob;
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
  | { readonly kind: 'ranges'; readonly spec: string }
  | { readonly kind: 'size'; readonly maxBytes: number };

/**
 * Recorta da composicao as paginas do intervalo (base 1, numeracao da grade) para UM PDF.
 *
 * Seleciona antes de montar: montar as 816 paginas para guardar cinco era o caminho antigo.
 */
export interface ExtractCompositionRequest {
  readonly kind: 'extractComposition';
  readonly id: string;
  readonly composition: readonly PageRef[];
  readonly spec: string;
}

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
  | ExtractCompositionRequest
  | SplitCompositionRequest
  | CancelRequest;

/** Arquivo registrado. Sem contagem de paginas: quem a sabe e o worker de renderizacao. */
export interface LoadedMessage {
  readonly kind: 'loaded';
  readonly id: string;
  readonly documentId: string;
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

/**
 * Documento montado em fluxo, entregue como `Blob`.
 *
 * O conteudo de um `Blob` mora fora do processo da pagina (o navegador o guarda, e pode leva-lo
 * ao disco), e atravessa fronteiras por referencia. E o que permite entregar 551 MB sem que o
 * processo que desenha a tela os tenha inteiros em momento algum.
 */
export interface ComposedMessage {
  readonly kind: 'composed';
  readonly id: string;
  readonly pdf: Blob;
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
  | ComposedMessage
  | VolumesMessage
  | ProgressMessage
  | CancelledMessage
  | ErrorMessage;

const RESPONSE_KINDS = new Set([
  'loaded',
  'unloaded',
  'built',
  'composed',
  'volumes',
  'progress',
  'cancelled',
  'error',
]);

export function isDocumentResponse(value: unknown): value is DocumentResponse {
  return isEnvelope(value) && RESPONSE_KINDS.has(value.kind);
}
