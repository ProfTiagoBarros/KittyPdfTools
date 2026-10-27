/// <reference lib="webworker" />
import {
  buildComposition,
  expandPageRanges,
  extractPages,
  parsePageRanges,
  splitByRanges,
  splitBySize,
  writeComposition,
  type LazySource,
  type PageRef,
} from 'pdf-core';
import { isAbortError, toErrorPayload, toTransferable } from './messages';
import type { DocumentRequest, DocumentResponse } from './documents-protocol';

/**
 * Worker residente de documentos (US-01 e US-02).
 *
 * Nao importa nada do pdf.js: compor e dividir precisam apenas do pdf-lib. A rasterizacao
 * mora no worker de renderizacao, cujo bundle carrega o motor do pdf.js (1,2 MB) — que seria
 * desperdicio pagar para unir dois arquivos.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Os ARQUIVOS vivem aqui, e nao os bytes. A UI conhece apenas identificadores.
 *
 * Um `File` do seletor aponta para o disco: guarda-lo custa quase nada, e os bytes so entram
 * na memoria quando uma operacao precisa daquela origem — uma por vez.
 */
const documents = new Map<string, Blob>();

/** Operacoes em andamento, para que `cancel` alcance a que o usuario pediu. */
const running = new Map<string, AbortController>();

/**
 * Quanto acumular antes de passar os pedacos ao `Blob`.
 *
 * Pedacos pequenos demais multiplicam as partes do `Blob`; grandes demais voltam a concentrar o
 * resultado na memoria do worker, que e o que se quer evitar.
 */
const BLOB_FLUSH_BYTES = 16 * 1024 * 1024;

function reply(message: DocumentResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function requireFile(documentId: string): Blob {
  const file = documents.get(documentId);
  if (file === undefined) {
    throw new Error(`Documento '${documentId}' nao esta carregado no worker.`);
  }
  return file;
}

async function bytesOf(documentId: string): Promise<Uint8Array> {
  return new Uint8Array(await requireFile(documentId).arrayBuffer());
}

function sourcesFor(composition: readonly PageRef[]): LazySource[] {
  const ids = [...new Set(composition.map((ref) => ref.source))];
  return ids.map((id) => ({ id, load: () => bytesOf(id) }));
}

/** Monta a composicao em fluxo e devolve o resultado como `Blob`, sem te-lo inteiro aqui. */
async function composeToBlob(composition: readonly PageRef[]): Promise<Blob> {
  let blob = new Blob([], { type: 'application/pdf' });
  let pending: Uint8Array<ArrayBuffer>[] = [];
  let pendingBytes = 0;

  const flush = () => {
    blob = new Blob([blob, ...pending], { type: 'application/pdf' });
    pending = [];
    pendingBytes = 0;
  };

  await writeComposition(sourcesFor(composition), composition, (chunk) => {
    pending.push(chunk as Uint8Array<ArrayBuffer>);
    pendingBytes += chunk.length;
    if (pendingBytes >= BLOB_FLUSH_BYTES) flush();
  });
  flush();
  return blob;
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
        // Sem interpretar o arquivo: o worker de renderizacao ja o abre para contar as paginas,
        // e um PDF que ele recusa nunca chega aqui. Interpretar de novo custava o arquivo
        // inteiro na memoria so para repetir a contagem.
        documents.set(request.documentId, request.file);
        reply({ kind: 'loaded', id: request.id, documentId: request.documentId });
        return;
      }

      case 'unload': {
        documents.delete(request.documentId);
        reply({ kind: 'unloaded', id: request.id });
        return;
      }

      case 'compose': {
        const pdf = await composeToBlob(request.composition);
        reply({ kind: 'composed', id: request.id, pdf });
        return;
      }

      case 'extractComposition': {
        const indices = expandPageRanges(parsePageRanges(request.spec, request.composition.length));
        const escolhidas = indices.flatMap((index) => request.composition[index] ?? []);
        const pdf = await composeToBlob(escolhidas);
        reply({ kind: 'composed', id: request.id, pdf });
        return;
      }

      case 'extract': {
        const built = await extractPages(await bytesOf(request.documentId), request.spec);
        const pdf = toTransferable(built);
        reply({ kind: 'built', id: request.id, pdf }, [pdf]);
        return;
      }

      case 'splitByRanges': {
        const volumes = await splitByRanges(await bytesOf(request.documentId), request.spec, {
          signal: controller.signal,
          onProgress: (completed, total) =>
            reply({ kind: 'progress', id: request.id, completed, total }),
        });
        sendVolumes(request.id, volumes, []);
        return;
      }

      case 'splitComposition': {
        // Dividir age sobre UM arquivo (o do Dividir), entao montar em memoria aqui custa o
        // tamanho de um arquivo, e nao o da sessao inteira.
        const composed = await buildComposition(
          await Promise.all(
            sourcesFor(request.composition).map(async (source) => ({
              id: source.id,
              bytes: await source.load(),
            })),
          ),
          request.composition,
        );
        const progress = (completed: number, total: number) =>
          reply({ kind: 'progress', id: request.id, completed, total });

        if (request.mode.kind === 'ranges') {
          const volumes = await splitByRanges(composed, request.mode.spec, {
            signal: controller.signal,
            onProgress: progress,
          });
          sendVolumes(request.id, volumes, []);
          return;
        }

        const result = await splitBySize(composed, request.mode.maxBytes, {
          signal: controller.signal,
          onProgress: progress,
        });
        sendVolumes(request.id, result.volumes, result.oversizedPages);
        return;
      }

      case 'splitBySize': {
        const result = await splitBySize(await bytesOf(request.documentId), request.maxBytes, {
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
