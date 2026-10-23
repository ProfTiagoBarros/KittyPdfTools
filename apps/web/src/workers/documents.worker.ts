/// <reference lib="webworker" />
import {
  buildComposition,
  extractPages,
  readPageCount,
  splitByRanges,
  splitBySize,
  type SourceDocument,
} from 'pdf-core';
import { isAbortError, toErrorPayload, toTransferable } from './messages';
import type { DocumentRequest, DocumentResponse } from './documents-protocol';

/**
 * Worker residente de documentos (US-01 e US-02).
 *
 * Nao importa nada do pdf.js: compor e dividir precisam apenas do pdf-lib. A rasterizacao
 * mora no worker de ofuscacao, cujo bundle carrega o motor de renderizacao do pdf.js
 * (1,2 MB) — que seria desperdicio pagar para unir dois arquivos.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Os bytes vivem aqui, e so aqui. A UI conhece apenas identificadores. */
const documents = new Map<string, Uint8Array>();

/** Operacoes em andamento, para que `cancel` alcance a que o usuario pediu. */
const running = new Map<string, AbortController>();

function reply(message: DocumentResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function requireDocument(documentId: string): Uint8Array {
  const bytes = documents.get(documentId);
  if (bytes === undefined) {
    throw new Error(`Documento '${documentId}' nao esta carregado no worker.`);
  }
  return bytes;
}

function sourcesFor(ids: readonly string[]): SourceDocument[] {
  return ids.map((id) => ({ id, bytes: requireDocument(id) }));
}

scope.addEventListener('message', (event: MessageEvent<DocumentRequest>) => {
  const request = event.data;

  if (request.kind === 'cancel') {
    running.get(request.targetId)?.abort();
    return;
  }

  void handle(request);
});

async function handle(request: Exclude<DocumentRequest, { kind: 'cancel' }>): Promise<void> {
  const controller = new AbortController();
  running.set(request.id, controller);

  try {
    switch (request.kind) {
      case 'load': {
        const bytes = new Uint8Array(request.bytes);
        // Falha cedo e com mensagem clara se o arquivo nao for um PDF utilizavel.
        const pageCount = await readPageCount(bytes);
        documents.set(request.documentId, bytes);
        reply({
          kind: 'loaded',
          id: request.id,
          documentId: request.documentId,
          pageCount,
        });
        return;
      }

      case 'copy': {
        const copia = requireDocument(request.documentId).slice().buffer;
        reply({ kind: 'copied', id: request.id, bytes: copia }, [copia]);
        return;
      }

      case 'unload': {
        documents.delete(request.documentId);
        reply({ kind: 'unloaded', id: request.id });
        return;
      }

      case 'compose': {
        const ids = [...new Set(request.composition.map((ref) => ref.source))];
        const built = await buildComposition(sourcesFor(ids), request.composition);
        const pdf = toTransferable(built);
        reply({ kind: 'built', id: request.id, pdf }, [pdf]);
        return;
      }

      case 'extract': {
        const built = await extractPages(requireDocument(request.documentId), request.spec);
        const pdf = toTransferable(built);
        reply({ kind: 'built', id: request.id, pdf }, [pdf]);
        return;
      }

      case 'splitByRanges': {
        const volumes = await splitByRanges(requireDocument(request.documentId), request.spec, {
          signal: controller.signal,
          onProgress: (completed, total) =>
            reply({ kind: 'progress', id: request.id, completed, total }),
        });
        sendVolumes(request.id, volumes, []);
        return;
      }

      case 'splitComposition': {
        const ids = [...new Set(request.composition.map((ref) => ref.source))];
        const composed = await buildComposition(sourcesFor(ids), request.composition);
        const progress = (completed: number, total: number) =>
          reply({ kind: 'progress', id: request.id, completed, total });

        switch (request.mode.kind) {
          case 'extract': {
            sendVolumes(request.id, [await extractPages(composed, request.mode.spec)], []);
            return;
          }
          case 'ranges': {
            const volumes = await splitByRanges(composed, request.mode.spec, {
              signal: controller.signal,
              onProgress: progress,
            });
            sendVolumes(request.id, volumes, []);
            return;
          }
          case 'size': {
            const result = await splitBySize(composed, request.mode.maxBytes, {
              signal: controller.signal,
              onProgress: progress,
            });
            sendVolumes(request.id, result.volumes, result.oversizedPages);
            return;
          }
        }
        return;
      }

      case 'splitBySize': {
        const result = await splitBySize(requireDocument(request.documentId), request.maxBytes, {
          signal: controller.signal,
          onProgress: (completed, total) =>
            reply({ kind: 'progress', id: request.id, completed, total }),
        });
        sendVolumes(request.id, result.volumes, result.oversizedPages);
        return;
      }
    }
  } catch (error) {
    // Cancelamento e o desfecho pedido pelo usuario, nao uma falha.
    if (isAbortError(error)) reply({ kind: 'cancelled', id: request.id });
    else reply(toErrorPayload(request.id, error));
  } finally {
    running.delete(request.id);
  }
}

function sendVolumes(
  id: string,
  volumes: readonly Uint8Array[],
  oversizedPages: readonly number[],
): void {
  const buffers = volumes.map(toTransferable);
  reply({ kind: 'volumes', id, volumes: buffers, oversizedPages }, buffers);
}
