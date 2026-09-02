import type { RedactionArea } from 'pdf-core';
import { restoreError } from './messages';
import { isRenderResponse, type RenderRequest, type RenderResponse } from './render-protocol';

export interface Thumbnail {
  readonly bitmap: ImageBitmap;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Tamanho da pagina em pontos, para converter coordenadas de tela em espaco do PDF. */
  readonly widthPt: number;
  readonly heightPt: number;
}

export interface RedactOptions {
  readonly scale?: number;
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface RenderWorkspaceOptions {
  /**
   * Quantas miniaturas manter vivas. A grade pede so o que esta visivel; as que saem de uso
   * ha mais tempo sao fechadas para nao acumular bitmaps de um PDF de centenas de paginas.
   */
  readonly cacheSize?: number;
  readonly maxEdge?: number;
}

export interface OcrOptions {
  /** Paginas a reconhecer, base 0. Vazio significa o documento inteiro. */
  readonly pageIndexes?: readonly number[];
  /** Padrao: true. Pular pagina que ja tem texto evita reprocessar um PDF digital. */
  readonly skipPagesWithText?: boolean;
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface OcrResult {
  readonly pdf: Uint8Array;
  readonly recognizedPages: readonly number[];
  readonly skippedPages: readonly number[];
  readonly wordsWritten: number;
  readonly wordsSkipped: number;
}

export interface RenderWorkspace {
  open(documentId: string, bytes: ArrayBuffer): Promise<number>;
  close(documentId: string): Promise<void>;
  /**
   * Imagem da pagina. Repetir a chamada devolve a mesma, sem re-renderizar.
   *
   * `maxEdge` entra na chave do cache: a grade pede miniaturas pequenas e o visualizador de
   * ofuscacao pede a mesma pagina em tamanho grande, e uma nao pode servir pela outra.
   */
  thumbnail(documentId: string, pageIndex: number, maxEdge?: number): Promise<Thumbnail>;
  redact(
    documentId: string,
    areas: readonly RedactionArea[],
    options?: RedactOptions,
  ): Promise<Uint8Array>;
  /** Reconhece texto e devolve o PDF com camada invisivel pesquisavel (US-04). */
  ocr(documentId: string, options?: OcrOptions): Promise<OcrResult>;
  /**
   * Texto de cada pagina, na ordem do documento.
   *
   * Extraido uma vez e reaproveitado: a busca acontece por digitacao, e reextrair a cada
   * tecla faria o pdf.js reinterpretar o documento inteiro a cada letra.
   */
  pageTexts(documentId: string): Promise<readonly string[]>;
  /** Numero de miniaturas vivas no cache. Existe para os testes observarem o descarte. */
  cachedThumbnails(): number;
  dispose(): void;
}

const DEFAULT_CACHE_SIZE = 60;
const DEFAULT_MAX_EDGE = 240;

export function createRenderWorkspace(options: RenderWorkspaceOptions = {}): RenderWorkspace {
  const cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;

  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

  let nextId = 0;
  const newId = () => `render-${(nextId += 1)}`;

  // Map preserva a ordem de insercao: reinserir ao ler transforma isto num LRU.
  const cache = new Map<string, Thumbnail>();
  // Evita renderizar a mesma pagina duas vezes quando a grade pede em rajada.
  const inFlight = new Map<string, Promise<Thumbnail>>();

  // Texto por documento: sem teto, porque sao strings e o custo de reextrair e alto.
  const texts = new Map<string, readonly string[]>();
  const textsInFlight = new Map<string, Promise<readonly string[]>>();

  function send<T>(
    request: RenderRequest,
    transfer: Transferable[],
    resolveFrom: (message: RenderResponse) => T | undefined,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onMessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (!isRenderResponse(response) || response.id !== request.id) return;

        if (response.kind === 'progress') {
          onProgress?.(response.completed, response.total);
          return;
        }

        worker.removeEventListener('message', onMessage);

        if (response.kind === 'error') {
          reject(restoreError(response));
          return;
        }

        const value = resolveFrom(response);
        if (value === undefined) reject(new Error(`Resposta inesperada: ${response.kind}`));
        else resolve(value);
      };

      worker.addEventListener('message', onMessage);
      worker.postMessage(request, transfer);
    });
  }

  function evictIfNeeded(): void {
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next();
      if (oldest.done === true) return;
      // Fechar o bitmap libera a memoria grafica na hora; deixar para o coletor nao serve.
      cache.get(oldest.value)?.bitmap.close();
      cache.delete(oldest.value);
    }
  }

  function dropDocument(documentId: string): void {
    const prefix = `${documentId}\u0000`;
    for (const key of [...cache.keys()]) {
      if (!key.startsWith(prefix)) continue;
      cache.get(key)?.bitmap.close();
      cache.delete(key);
    }
  }

  return {
    async open(documentId, bytes) {
      dropDocument(documentId);
      return send({ kind: 'open', id: newId(), documentId, bytes }, [bytes], (message) =>
        message.kind === 'opened' ? message.pageCount : undefined,
      );
    },

    async close(documentId) {
      dropDocument(documentId);
      await send({ kind: 'close', id: newId(), documentId }, [], (message) =>
        message.kind === 'closed' ? true : undefined,
      );
    },

    async thumbnail(documentId, pageIndex, edge = maxEdge) {
      // `edge` entra na chave: grade e visualizador pedem a mesma pagina em tamanhos
      // diferentes, e uma imagem nao pode servir pela outra.
      const key = [documentId, pageIndex, edge].join(String.fromCharCode(0));

      const cached = cache.get(key);
      if (cached !== undefined) {
        cache.delete(key);
        cache.set(key, cached); // reinsere: passa a ser o mais recente
        return cached;
      }

      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;

      const request = send(
        { kind: 'thumbnail', id: newId(), documentId, pageIndex, maxEdge: edge },
        [],
        (message) =>
          message.kind === 'thumbnail'
            ? {
                bitmap: message.bitmap,
                widthPx: message.widthPx,
                heightPx: message.heightPx,
                widthPt: message.widthPt,
                heightPt: message.heightPt,
              }
            : undefined,
      )
        .then((thumbnail) => {
          cache.set(key, thumbnail);
          evictIfNeeded();
          return thumbnail;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    },

    async pageTexts(documentId) {
      const cached = texts.get(documentId);
      if (cached !== undefined) return cached;

      const pending = textsInFlight.get(documentId);
      if (pending !== undefined) return pending;

      const request = send({ kind: 'pageTexts', id: newId(), documentId }, [], (message) =>
        message.kind === 'pageTexts' ? message.texts : undefined,
      )
        .then((result) => {
          texts.set(documentId, result);
          return result;
        })
        .finally(() => {
          textsInFlight.delete(documentId);
        });

      textsInFlight.set(documentId, request);
      return request;
    },

    async redact(documentId, areas, options = {}) {
      const pdf = await send(
        {
          kind: 'redact',
          id: newId(),
          documentId,
          areas,
          ...(options.scale === undefined ? {} : { scale: options.scale }),
        },
        [],
        (message) => (message.kind === 'redacted' ? message.pdf : undefined),
        options.onProgress,
      );
      return new Uint8Array(pdf);
    },

    async ocr(documentId, options = {}) {
      const result = await send(
        {
          kind: 'ocr',
          id: newId(),
          documentId,
          pageIndexes: options.pageIndexes ?? [],
          skipPagesWithText: options.skipPagesWithText ?? true,
        },
        [],
        (message) => (message.kind === 'ocrDone' ? message : undefined),
        options.onProgress,
      );

      return {
        pdf: new Uint8Array(result.pdf),
        recognizedPages: result.recognizedPages,
        skippedPages: result.skippedPages,
        wordsWritten: result.wordsWritten,
        wordsSkipped: result.wordsSkipped,
      };
    },

    cachedThumbnails: () => cache.size,

    dispose() {
      for (const thumbnail of cache.values()) thumbnail.bitmap.close();
      cache.clear();
      texts.clear();
      worker.terminate();
    },
  };
}
