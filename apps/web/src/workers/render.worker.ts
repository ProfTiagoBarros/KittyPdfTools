/// <reference lib="webworker" />
import {
  addInvisibleTextLayer,
  compressByRasterizing,
  compressToTarget,
  redactByRasterizing,
  repackLossless,
  type OcrPageText,
} from 'pdf-core';
import { openForRendering, configurePdfjs, type DocumentRenderer } from 'pdf-core/browser';
import { toErrorPayload, toTransferable } from './messages';
import type { CompressRequest, RenderRequest, RenderResponse } from './render-protocol';
import { createOcrEngine, OCR_SCALE } from './ocr';

/**
 * Worker residente de renderizacao: miniaturas (canvas central) e ofuscacao (US-03).
 *
 * Concentra aqui tudo que depende do pdf.js, cujo worker sozinho pesa 1,2 MB. O worker de
 * documentos (US-01/US-02) usa apenas pdf-lib e nao paga esse custo.
 */

// Assets locais, copiados de node_modules para public/. Um CDN quebraria a Regra de Ouro 4.
// URL absoluta: dentro de um Worker, caminho iniciado por barra nao resolve contra a origem
// da pagina. O pdf.js v6 EXIGE `workerSrc` — nao ha mais fallback em linha —, e sem os demais
// assets a miniatura falha so em alguns documentos, que e o pior tipo de defeito.
configurePdfjs(new URL('/pdfjs/', self.location.origin).href);

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** O que o worker sabe de cada documento, aberto ou nao no pdf.js. */
interface Source {
  /** O arquivo do seletor: aponta para o disco, e e de onde o documento se reabre. */
  readonly file: Blob;
  /** Texto por pagina, extraido na primeira busca. Sobrevive ao documento ser solto. */
  texts?: readonly string[];
}

interface OpenDocument {
  readonly renderer: DocumentRenderer;
  readonly bytes: number;
  /** Operacoes usando o documento agora: enquanto houver, ele nao e solto. */
  inUse: number;
  /** Fechado ou liberado enquanto estava em uso: solta assim que a ultima operacao terminar. */
  closing: boolean;
}

/**
 * Quanto de documento aberto no pdf.js o worker se permite manter.
 *
 * Antes, todo arquivo aberto ficava inteiro aqui ate ser removido — oito PDFs escaneados eram
 * 551 MB parados, e o mesmo tanto no worker de documentos. Agora fica so o que esta sendo
 * desenhado, ate este teto; o resto se reabre do arquivo quando a grade rolar ate ele. Um
 * documento grande sozinho pode passar do teto: o que esta em uso nunca e solto.
 */
const OPEN_BUDGET_BYTES = 192 * 1024 * 1024;

const sources = new Map<string, Source>();
/** Documentos abertos no pdf.js, do menos ao mais recentemente usado. */
const opened = new Map<string, OpenDocument>();
const opening = new Map<string, Promise<OpenDocument>>();

function reply(message: RenderResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function requireSource(documentId: string): Source {
  const source = sources.get(documentId);
  if (source === undefined) {
    throw new Error(`Documento '${documentId}' nao esta registrado no worker de renderizacao.`);
  }
  return source;
}

async function openFromFile(documentId: string): Promise<OpenDocument> {
  const { file } = requireSource(documentId);
  // Por faixas: o pdf.js le do arquivo so o que cada pagina precisa. O tamanho do arquivo e o
  // teto do que ele pode chegar a guardar, e e o que conta no orcamento.
  const renderer = await openForRendering(file);
  const document: OpenDocument = { renderer, bytes: file.size, inUse: 0, closing: false };
  opened.set(documentId, document);
  return document;
}

/** Garante o documento aberto e o marca em uso. Todo `acquire` exige um `releaseUse`. */
async function acquire(documentId: string): Promise<OpenDocument> {
  const ready = opened.get(documentId);
  if (ready !== undefined && !ready.closing) {
    // Reinsere: passa a ser o mais recente, e o ultimo a ser solto.
    opened.delete(documentId);
    opened.set(documentId, ready);
    ready.inUse += 1;
    return ready;
  }

  let pending = opening.get(documentId);
  if (pending === undefined) {
    pending = openFromFile(documentId).finally(() => opening.delete(documentId));
    opening.set(documentId, pending);
  }
  const document = await pending;
  // Solto enquanto abria (uma liberacao no meio do caminho): abre de novo, em vez de usar um
  // documento ja descartado.
  if (opened.get(documentId) !== document) return acquire(documentId);
  document.inUse += 1;
  await trimToBudget();
  return document;
}

async function releaseUse(document: OpenDocument): Promise<void> {
  document.inUse -= 1;
  if (document.inUse === 0 && document.closing) await document.renderer.dispose();
}

async function withDocument<T>(
  documentId: string,
  work: (renderer: DocumentRenderer) => Promise<T>,
): Promise<T> {
  const document = await acquire(documentId);
  try {
    return await work(document.renderer);
  } finally {
    await releaseUse(document);
  }
}

/** Solta o documento agora, ou assim que ninguem mais o estiver usando. */
async function letGo(documentId: string): Promise<void> {
  const document = opened.get(documentId);
  if (document === undefined) return;
  opened.delete(documentId);
  if (document.inUse === 0) await document.renderer.dispose();
  else document.closing = true;
}

/** Solta os menos usados ate caber no orcamento, sem tocar em quem esta em uso. */
async function trimToBudget(): Promise<void> {
  let total = 0;
  for (const document of opened.values()) total += document.bytes;

  for (const [documentId, document] of [...opened]) {
    if (total <= OPEN_BUDGET_BYTES) return;
    if (document.inUse > 0) continue;
    total -= document.bytes;
    await letGo(documentId);
  }
}

scope.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  void handle(event.data);
});

async function handle(request: RenderRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'open': {
        // Substituir um id ja aberto sem soltar o anterior vazaria o documento do pdf.js.
        await letGo(request.documentId);
        sources.set(request.documentId, { file: request.file });
        try {
          // Abrir agora e o que recusa cedo o arquivo que nao e PDF, e conta as paginas.
          const pageCount = await withDocument(request.documentId, (renderer) =>
            Promise.resolve(renderer.pageCount),
          );
          reply({ kind: 'opened', id: request.id, documentId: request.documentId, pageCount });
        } catch (error) {
          sources.delete(request.documentId);
          throw error;
        }
        return;
      }

      case 'close': {
        await letGo(request.documentId);
        sources.delete(request.documentId);
        reply({ kind: 'closed', id: request.id });
        return;
      }

      case 'thumbnail': {
        const thumbnail = await withDocument(request.documentId, (renderer) =>
          renderer.renderThumbnail(request.pageIndex, request.maxEdge),
        );
        reply(
          {
            kind: 'thumbnail',
            id: request.id,
            bitmap: thumbnail.bitmap,
            widthPx: thumbnail.widthPx,
            heightPx: thumbnail.heightPx,
            widthPt: thumbnail.widthPt,
            heightPt: thumbnail.heightPt,
          },
          [thumbnail.bitmap],
        );
        return;
      }

      case 'pageTexts': {
        // Extrai uma vez por documento e guarda. A busca e por digitacao: reextrair a cada
        // tecla faria o pdf.js reinterpretar o documento inteiro a cada letra.
        const source = requireSource(request.documentId);
        source.texts ??= await withDocument(request.documentId, async (renderer) => {
          const texts: string[] = [];
          for (let pageIndex = 0; pageIndex < renderer.pageCount; pageIndex += 1) {
            texts.push(await renderer.textOf(pageIndex));
          }
          return texts;
        });

        reply({ kind: 'pageTexts', id: request.id, texts: source.texts });
        return;
      }

      case 'release': {
        // Os arquivos ficam: cada documento se reabre deles quando for pedido de novo.
        for (const documentId of [...opened.keys()]) await letGo(documentId);
        reply({ kind: 'released', id: request.id });
        return;
      }

      case 'compress': {
        await runCompress(request);
        return;
      }

      case 'ocr': {
        await runOcr(request);
        return;
      }

      case 'redact': {
        const result = await withDocument(request.documentId, async (renderer) =>
          redactByRasterizing(await renderer.getData(), request.areas, renderer, {
            ...(request.scale === undefined ? {} : { scale: request.scale }),
            onProgress: (completed, total) =>
              reply({ kind: 'progress', id: request.id, completed, total }),
          }),
        );
        const pdf = toTransferable(result);
        reply({ kind: 'redacted', id: request.id, pdf }, [pdf]);
        return;
      }
    }
  } catch (error) {
    reply(toErrorPayload(request.id, error));
  }
}

/**
 * Reconhece o texto das paginas pedidas e devolve o PDF com camada invisivel.
 *
 * O progresso combina duas coisas: quantas paginas ja sairam e o quanto o Tesseract avancou
 * na pagina atual. Sem a segunda parte, a barra ficaria parada por dezenas de segundos numa
 * pagina densa — que e exatamente quando o usuario mais precisa saber que algo acontece.
 */
/**
 * Compacta a composicao ja montada.
 *
 * O documento e aberto so aqui e descartado no `finally`: manter mais um documento do pdf.js
 * vivo por engano custa memoria que o celular nao tem sobrando, e o rasterizador so faz
 * sentido enquanto esta compressao dura.
 */
async function runCompress(request: CompressRequest): Promise<void> {
  const bytes = new Uint8Array(request.pdf);
  const relatarProgresso = (completed: number, total: number) =>
    reply({ kind: 'progress', id: request.id, completed, total });

  if (request.mode.kind === 'lossless') {
    // Sem rasterizacao nao ha rasterizador a abrir: e so pdf-lib.
    const resultado = await repackLossless(bytes, {
      removeInvisibleText: request.mode.removeInvisibleText,
      onProgress: relatarProgresso,
    });
    const pdf = toTransferable(resultado.pdf);
    reply(
      {
        kind: 'compressed',
        id: request.id,
        pdf,
        originalBytes: bytes.length,
        invisibleBlocksRemoved: resultado.invisibleBlocksRemoved,
        fitsTarget: true,
        step: null,
        attempts: 1,
      },
      [pdf],
    );
    return;
  }

  const renderer = await openForRendering(bytes);
  try {
    if (request.mode.kind === 'quality') {
      const comprimido = await compressByRasterizing(bytes, renderer, {
        ...request.mode.step,
        onProgress: relatarProgresso,
      });
      const pdf = toTransferable(comprimido);
      reply(
        {
          kind: 'compressed',
          id: request.id,
          pdf,
          originalBytes: bytes.length,
          invisibleBlocksRemoved: 0,
          fitsTarget: true,
          step: request.mode.step,
          attempts: 1,
        },
        [pdf],
      );
      return;
    }

    const resultado = await compressToTarget(bytes, renderer, {
      maxBytes: request.mode.maxBytes,
      onProgress: relatarProgresso,
    });
    const pdf = toTransferable(resultado.pdf);
    reply(
      {
        kind: 'compressed',
        id: request.id,
        pdf,
        originalBytes: bytes.length,
        invisibleBlocksRemoved: 0,
        fitsTarget: resultado.fitsTarget,
        step: resultado.step,
        attempts: resultado.attempts,
      },
      [pdf],
    );
  } finally {
    await renderer.dispose();
  }
}

async function runOcr(request: Extract<RenderRequest, { kind: 'ocr' }>): Promise<void> {
  await withDocument(request.documentId, (renderer) => recognize(request, renderer));
}

async function recognize(
  request: Extract<RenderRequest, { kind: 'ocr' }>,
  renderer: DocumentRenderer,
): Promise<void> {
  const open = { renderer };
  const targets =
    request.pageIndexes.length > 0
      ? [...request.pageIndexes]
      : Array.from({ length: open.renderer.pageCount }, (_unused, index) => index);

  const recognized: number[] = [];
  const skipped: number[] = [];
  const results: OcrPageText[] = [];

  let done = 0;
  const report = (withinPage: number) =>
    reply({
      kind: 'progress',
      id: request.id,
      completed: Math.round((done + withinPage) * 100),
      total: targets.length * 100,
    });

  // O motor so e criado quando a primeira pagina realmente precisa dele: carregar 14 MB de
  // wasm e modelo para depois pular todas as paginas seria desperdicio puro.
  let engine: Awaited<ReturnType<typeof createOcrEngine>> | undefined;

  try {
    for (const pageIndex of targets) {
      if (request.skipPagesWithText && (await open.renderer.hasText(pageIndex))) {
        skipped.push(pageIndex);
        done += 1;
        report(0);
        continue;
      }

      engine ??= await createOcrEngine((fraction) => report(fraction));

      const raster = await open.renderer.rasterize({
        pageIndex,
        scale: OCR_SCALE,
        blackout: [],
      });
      results.push(
        await engine.recognizePage(raster.image, pageIndex, raster.widthPx, raster.heightPx),
      );
      recognized.push(pageIndex);
      done += 1;
      report(0);
    }
  } finally {
    await engine?.terminate();
  }

  const { pdf, report: layer } = await addInvisibleTextLayer(
    await open.renderer.getData(),
    results,
  );
  const buffer = toTransferable(pdf);

  reply(
    {
      kind: 'ocrDone',
      id: request.id,
      pdf: buffer,
      recognizedPages: recognized,
      skippedPages: skipped,
      wordsWritten: layer.written,
      wordsSkipped: layer.skipped,
    },
    [buffer],
  );
}
