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

interface OpenDocument {
  readonly bytes: Uint8Array;
  readonly renderer: DocumentRenderer;
  /** Texto por pagina, extraido sob demanda na primeira busca e reaproveitado depois. */
  readonly texts?: readonly string[];
}

/** Os documentos abertos vivem aqui, e so aqui. A UI conhece apenas identificadores. */
const documents = new Map<string, OpenDocument>();

function reply(message: RenderResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function requireDocument(documentId: string): OpenDocument {
  const open = documents.get(documentId);
  if (open === undefined) {
    throw new Error(`Documento '${documentId}' nao esta aberto no worker de renderizacao.`);
  }
  return open;
}

scope.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  void handle(event.data);
});

async function handle(request: RenderRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'open': {
        const bytes = new Uint8Array(request.bytes);
        const renderer = await openForRendering(bytes);
        // Substituir um id ja aberto sem fechar o anterior vazaria o documento do pdf.js.
        await documents.get(request.documentId)?.renderer.dispose();
        documents.set(request.documentId, { bytes, renderer });
        reply({
          kind: 'opened',
          id: request.id,
          documentId: request.documentId,
          pageCount: renderer.pageCount,
        });
        return;
      }

      case 'close': {
        await documents.get(request.documentId)?.renderer.dispose();
        documents.delete(request.documentId);
        reply({ kind: 'closed', id: request.id });
        return;
      }

      case 'thumbnail': {
        const { renderer } = requireDocument(request.documentId);
        const thumbnail = await renderer.renderThumbnail(request.pageIndex, request.maxEdge);
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
        const { renderer } = requireDocument(request.documentId);

        // Extrai uma vez por documento e guarda. A busca e por digitacao: reextrair a cada
        // tecla faria o pdf.js reinterpretar o documento inteiro a cada letra.
        const open = requireDocument(request.documentId);
        if (open.texts === undefined) {
          const texts: string[] = [];
          for (let pageIndex = 0; pageIndex < renderer.pageCount; pageIndex += 1) {
            texts.push(await renderer.textOf(pageIndex));
          }
          documents.set(request.documentId, { ...open, texts });
        }

        reply({
          kind: 'pageTexts',
          id: request.id,
          texts: documents.get(request.documentId)?.texts ?? [],
        });
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
        const open = requireDocument(request.documentId);
        const result = await redactByRasterizing(open.bytes, request.areas, open.renderer, {
          ...(request.scale === undefined ? {} : { scale: request.scale }),
          onProgress: (completed, total) =>
            reply({ kind: 'progress', id: request.id, completed, total }),
        });
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
  const open = requireDocument(request.documentId);
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

  const { pdf, report: layer } = await addInvisibleTextLayer(open.bytes, results);
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
