import type { PageRef } from 'pdf-core';
import { restoreError } from './messages';
import { isDocumentResponse } from './documents-protocol';
import type { DocumentRequest, DocumentResponse, SplitMode } from './documents-protocol';

export interface OperationOptions {
  readonly onProgress?: (completed: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface SizeSplit {
  readonly volumes: readonly Uint8Array[];
  readonly oversizedPages: readonly number[];
}

/** Sinalizado quando o usuario cancela; distinto de falha, e tratado como tal na UI. */
export class OperationCancelled extends Error {
  constructor() {
    super('Operacao cancelada');
    this.name = 'OperationCancelled';
  }
}

export interface DocumentWorkspace {
  /**
   * Registra o arquivo de um documento no worker, sem le-lo: os bytes so entram na memoria
   * quando uma operacao precisa daquela origem.
   */
  load(documentId: string, file: Blob): Promise<void>;
  unload(documentId: string): Promise<void>;
  /** Monta a composicao em fluxo; o resultado chega como `Blob`, fora da memoria da pagina. */
  compose(composition: readonly PageRef[]): Promise<Blob>;
  extract(documentId: string, spec: string): Promise<Uint8Array>;
  splitByRanges(
    documentId: string,
    spec: string,
    options?: OperationOptions,
  ): Promise<Uint8Array[]>;
  splitBySize(documentId: string, maxBytes: number, options?: OperationOptions): Promise<SizeSplit>;
  /**
   * Recorta a composicao montada na grade num UNICO documento.
   *
   * Nao e um caso particular de dividir: a intencao e outra, e por isso o resultado tambem e
   * — um `.pdf` direto, sem o pacote que so faz sentido quando existem varios arquivos.
   */
  extractComposition(composition: readonly PageRef[], spec: string): Promise<Blob>;
  /** Divide a composicao montada na grade, sem passar o PDF pela main thread. */
  splitComposition(
    composition: readonly PageRef[],
    mode: SplitMode,
    options?: OperationOptions,
  ): Promise<SizeSplit>;
  dispose(): void;
}

/**
 * Cliente do worker residente de documentos.
 *
 * Um worker atende o workspace inteiro enquanto ele existir: os PDFs sao enviados uma vez e
 * permanecem la. Reordenar e girar paginas nao conversa com o worker — sao manipulacoes da
 * composicao, na main thread — e so a exportacao volta a cruzar a fronteira.
 */
export function createDocumentWorkspace(): DocumentWorkspace {
  const worker = new Worker(new URL('./documents.worker.ts', import.meta.url), {
    type: 'module',
  });

  let nextId = 0;
  const newId = () => `op-${(nextId += 1)}`;

  function send<T>(
    request: DocumentRequest,
    transfer: Transferable[],
    resolveFrom: (message: DocumentResponse) => T | undefined,
    options: OperationOptions = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const settle = (finish: () => void) => {
        worker.removeEventListener('message', onMessage);
        options.signal?.removeEventListener('abort', onAbort);
        finish();
      };

      const onMessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (!isDocumentResponse(response) || response.id !== request.id) return;

        if (response.kind === 'progress') {
          options.onProgress?.(response.completed, response.total);
          return;
        }
        if (response.kind === 'cancelled') {
          settle(() => reject(new OperationCancelled()));
          return;
        }
        if (response.kind === 'error') {
          settle(() => reject(restoreError(response)));
          return;
        }

        const value = resolveFrom(response);
        if (value !== undefined) settle(() => resolve(value));
      };

      const onAbort = () => {
        const cancel: DocumentRequest = {
          kind: 'cancel',
          id: newId(),
          targetId: request.id,
        };
        worker.postMessage(cancel);
      };

      worker.addEventListener('message', onMessage);
      if (options.signal?.aborted === true) queueMicrotask(onAbort);
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      worker.postMessage(request, transfer);
    });
  }

  return {
    async load(documentId, file) {
      await send({ kind: 'load', id: newId(), documentId, file }, [], (message) =>
        message.kind === 'loaded' ? true : undefined,
      );
    },

    async unload(documentId) {
      await send({ kind: 'unload', id: newId(), documentId }, [], (message) =>
        message.kind === 'unloaded' ? true : undefined,
      );
    },

    async compose(composition) {
      return send({ kind: 'compose', id: newId(), composition }, [], (message) =>
        message.kind === 'composed' ? message.pdf : undefined,
      );
    },

    async extract(documentId, spec) {
      const pdf = await send({ kind: 'extract', id: newId(), documentId, spec }, [], (message) =>
        message.kind === 'built' ? message.pdf : undefined,
      );
      return new Uint8Array(pdf);
    },

    async splitByRanges(documentId, spec, options) {
      const result = await send(
        { kind: 'splitByRanges', id: newId(), documentId, spec },
        [],
        (message) => (message.kind === 'volumes' ? message : undefined),
        options,
      );
      return result.volumes.map((buffer) => new Uint8Array(buffer));
    },

    async splitBySize(documentId, maxBytes, options) {
      const result = await send(
        { kind: 'splitBySize', id: newId(), documentId, maxBytes },
        [],
        (message) => (message.kind === 'volumes' ? message : undefined),
        options,
      );
      return {
        volumes: result.volumes.map((buffer) => new Uint8Array(buffer)),
        oversizedPages: result.oversizedPages,
      };
    },

    async extractComposition(composition, spec) {
      return send({ kind: 'extractComposition', id: newId(), composition, spec }, [], (message) =>
        message.kind === 'composed' ? message.pdf : undefined,
      );
    },

    async splitComposition(composition, mode, options) {
      const result = await send(
        { kind: 'splitComposition', id: newId(), composition, mode },
        [],
        (message) => (message.kind === 'volumes' ? message : undefined),
        options,
      );
      return {
        volumes: result.volumes.map((buffer) => new Uint8Array(buffer)),
        oversizedPages: result.oversizedPages,
      };
    },

    dispose() {
      worker.terminate();
    },
  };
}
