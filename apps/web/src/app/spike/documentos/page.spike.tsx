'use client';

import { useEffect } from 'react';
import { createTextPdf } from 'pdf-core';
import { extractAllText, configurePdfjs } from 'pdf-core/browser';
import { createDocumentWorkspace, OperationCancelled } from '@/workers/documents-client';

/**
 * Banco de provas de US-01 e US-02 no navegador. Nao faz parte do produto.
 * `page.spike.tsx` so vira rota com PDFKITTY_SPIKE=1.
 */

export interface DocsReport {
  pageCountA: number;
  pageCountB: number;
  composedPageCount: number;
  composedFirstPage: string;
  composedSecondPage: string;
  extractedPageCount: number;
  rangeVolumeCounts: number[];
  sizeVolumeCount: number;
  sizeVolumesWithinLimit: boolean;
  sizeTotalPages: number;
  progressEvents: number;
  cancelledAsCancellation: boolean;
  errorForUnknownDocument: string;
  bytesStayInWorker: boolean;
}

declare global {
  interface Window {
    __pdfkittyDocs?: { run: () => Promise<DocsReport> };
  }
}

async function labelled(prefix: string, pages: number): Promise<Uint8Array> {
  return createTextPdf(
    Array.from({ length: pages }, (_unused, index) => [
      { text: `${prefix}-PAGINA-${index + 1}`, y: 150 },
    ]),
  );
}

function transferable(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export default function DocsSpikePage() {
  useEffect(() => {
    configurePdfjs('/pdfjs/');

    window.__pdfkittyDocs = {
      async run(): Promise<DocsReport> {
        const workspace = createDocumentWorkspace();

        try {
          const a = await labelled('A', 2);
          const b = await labelled('B', 3);

          const bufferA = transferable(a);
          const pageCountA = await workspace.load('a', bufferA);
          const pageCountB = await workspace.load('b', transferable(b));

          // A transfer list destaca o buffer: prova que os bytes migraram para o worker.
          const bytesStayInWorker = bufferA.byteLength === 0;

          // US-01: paginas de origens diferentes, intercaladas e giradas.
          const composed = await workspace.compose([
            { source: 'b', pageIndex: 2 },
            { source: 'a', pageIndex: 0, rotate: 90 },
          ]);
          const composedText = await extractAllText(composed);

          // US-02: extracao e divisao por intervalo.
          const big = await labelled('C', 20);
          await workspace.load('c', transferable(big));
          const extracted = await workspace.extract('c', '1-5, 8, 11-15');
          const rangeVolumes = await workspace.splitByRanges('c', '1-5, 8, 11-15');

          // US-02: divisao por tamanho, com progresso.
          const whole = await workspace.extract('c', '1-');
          const limit = Math.ceil(whole.length / 3);
          let progressEvents = 0;
          const sizeSplit = await workspace.splitBySize('c', limit, {
            onProgress: () => {
              progressEvents += 1;
            },
          });

          let sizeTotalPages = 0;
          for (const volume of sizeSplit.volumes) {
            sizeTotalPages += (await extractAllText(volume)).split('C-PAGINA-').length - 1;
          }

          // Cancelamento tem de chegar como cancelamento, nao como falha generica.
          const controller = new AbortController();
          let cancelledAsCancellation = false;
          const pending = workspace.splitBySize('c', 1000, {
            signal: controller.signal,
            onProgress: (completed) => {
              if (completed === 2) controller.abort();
            },
          });
          try {
            await pending;
          } catch (error) {
            cancelledAsCancellation = error instanceof OperationCancelled;
          }

          let errorForUnknownDocument = '';
          try {
            await workspace.extract('inexistente', '1');
          } catch (error) {
            errorForUnknownDocument = error instanceof Error ? error.message : String(error);
          }

          const composedPages = composedText.split(/\s+/).filter((part) => part.includes('PAGINA'));

          return {
            pageCountA,
            pageCountB,
            composedPageCount: composedPages.length,
            composedFirstPage: composedPages[0] ?? '',
            composedSecondPage: composedPages[1] ?? '',
            extractedPageCount: (await extractAllText(extracted)).split('C-PAGINA-').length - 1,
            rangeVolumeCounts: await Promise.all(
              rangeVolumes.map(
                async (volume) => (await extractAllText(volume)).split('C-PAGINA-').length - 1,
              ),
            ),
            sizeVolumeCount: sizeSplit.volumes.length,
            sizeVolumesWithinLimit: sizeSplit.volumes.every((v) => v.length <= limit),
            sizeTotalPages,
            progressEvents,
            cancelledAsCancellation,
            errorForUnknownDocument,
            bytesStayInWorker,
          };
        } finally {
          workspace.dispose();
        }
      },
    };

    return () => {
      delete window.__pdfkittyDocs;
    };
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Spike — documentos (US-01 / US-02)</h1>
      {/* O teste espera o gancho global existir, nao este texto: sinalizar prontidao
          por estado obrigaria a chamar setState dentro do efeito. */}
      <p data-testid="docs-status" className="mt-2 text-sm">
        banco de provas
      </p>
    </main>
  );
}
