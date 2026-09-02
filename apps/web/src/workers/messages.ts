import { PdfCoreError, isPdfCoreError } from 'pdf-core';
import type { PdfCoreErrorCode, PdfCoreErrorParams } from 'pdf-core';

/**
 * Envelope comum a todos os workers.
 *
 * Toda mensagem carrega `id`: um mesmo worker atende varias operacoes simultaneas sem
 * misturar respostas, e o cancelamento sabe a quem se dirige. Nada de `any` atravessa
 * esta fronteira.
 */

export interface Envelope {
  readonly kind: string;
  readonly id: string;
}

export interface ProgressMessage extends Envelope {
  readonly kind: 'progress';
  readonly completed: number;
  readonly total: number;
}

export interface ErrorMessage extends Envelope {
  readonly kind: 'error';
  /** Texto para log. Nunca deve ser mostrado ao usuario: pode nao estar no idioma dele. */
  readonly message: string;
  /** Presente quando o erro veio do nucleo. E o que permite a UI traduzir. */
  readonly code?: PdfCoreErrorCode;
  readonly params?: PdfCoreErrorParams;
}

/** Resposta a um cancelamento aceito. Nao e erro: e o desfecho pedido pelo usuario. */
export interface CancelledMessage extends Envelope {
  readonly kind: 'cancelled';
}

/** Pedido de cancelamento de uma operacao em andamento, identificada por `targetId`. */
export interface CancelRequest extends Envelope {
  readonly kind: 'cancel';
  readonly targetId: string;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; id?: unknown };
  return typeof candidate.kind === 'string' && typeof candidate.id === 'string';
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prepara um erro para atravessar o `postMessage`.
 *
 * `Error` sobrevive ao clone estruturado, mas campos proprios como `code` e `params` NAO —
 * chegariam do outro lado como um erro sem identidade, e a UI voltaria a exibir a mensagem
 * crua do nucleo. Por isso codigo e parametros viajam explicitamente.
 */
export function toErrorPayload(id: string, error: unknown): ErrorMessage {
  const base = { kind: 'error', id, message: describeError(error) } as const;
  return isPdfCoreError(error) ? { ...base, code: error.code, params: error.params } : base;
}

/** Reconstroi do outro lado o erro do nucleo, com codigo e parametros intactos. */
export function restoreError(message: ErrorMessage): Error {
  return message.code === undefined
    ? new Error(message.message)
    : new PdfCoreError(message.code, message.params ?? {}, message.message);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Extrai um ArrayBuffer proprio, transferivel sem copia. */
export function toTransferable(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
