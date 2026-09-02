'use client';

import { useEffect } from 'react';
import { createTextPdf, type Rect } from 'pdf-core';
import {
  configurePdfjs,
  extractAllText,
  existsInFileBytes,
  hasIncrementalHistory,
  findTextRect,
  samplePixels,
  type Pixel,
} from 'pdf-core/browser';
import { createRenderWorkspace } from '@/workers/render-client';

/**
 * Banco de provas da ofuscacao no navegador. Nao faz parte do produto: existe para o
 * Playwright exercitar worker + OffscreenCanvas + nucleo num navegador de verdade.
 *
 * `page.spike.tsx` so vira rota com PDFKITTY_SPIKE=1 (ver src/config/page-extensions.ts).
 */

const SECRET = 'CPF-123456789-SIGILOSO';
const PUBLIC = 'Relatorio trimestral publico';

export interface SpikeReport {
  thumbnailWidth: number;
  thumbnailHeight: number;
  thumbnailIsCached: boolean;
  cacheEvicts: boolean;
  progressEvents: number;
  originalTextHasSecret: boolean;
  originalBytesHaveSecret: boolean;
  redactedTextHasSecret: boolean;
  redactedBytesHaveSecret: boolean;
  redactedHasIncrementalHistory: boolean;
  redactedTextIsEmpty: boolean;
  blackoutPixel: Pixel;
  controlPixel: Pixel;
}

declare global {
  interface Window {
    __pdfkittySpike?: { run: () => Promise<SpikeReport> };
  }
}

function centerOf(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export default function SpikePage() {
  useEffect(() => {
    configurePdfjs('/pdfjs/');

    window.__pdfkittySpike = {
      async run(): Promise<SpikeReport> {
        // Cache pequeno de proposito: o descarte precisa ser observavel no teste.
        const workspace = createRenderWorkspace({ cacheSize: 2, maxEdge: 120 });

        const original = await createTextPdf([
          [
            { text: PUBLIC, y: 200 },
            { text: SECRET, y: 150 },
          ],
        ]);

        const rect = await findTextRect(original, SECRET);
        if (rect === undefined) throw new Error('segredo nao localizado na fixture');

        const originalTextHasSecret = (await extractAllText(original)).includes(SECRET);
        const originalBytesHaveSecret = await existsInFileBytes(original, SECRET);

        // A transfer list destaca o buffer enviado ao worker; manda-se uma copia.
        const copy = original.slice();
        await workspace.open('doc', copy.buffer);

        // Miniaturas: mesmo documento aberto, sem reabrir o PDF por pagina.
        const thumbnail = await workspace.thumbnail('doc', 0);
        await workspace.thumbnail('doc', 0);
        const thumbnailIsCached = workspace.cachedThumbnails() === 1;

        // Excede o cache de 2 para provar o descarte das mais antigas.
        const multi = await createTextPdf(
          Array.from({ length: 4 }, (_unused, index) => [{ text: `P${index}`, y: 150 }]),
        );
        await workspace.open('multi', multi.slice().buffer);
        for (let page = 0; page < 4; page += 1) await workspace.thumbnail('multi', page);
        const cacheEvicts = workspace.cachedThumbnails() === 2;

        let progressEvents = 0;
        const redacted = await workspace.redact('doc', [{ pageIndex: 0, rect }], {
          onProgress: () => {
            progressEvents += 1;
          },
        });
        const redactedText = await extractAllText(redacted);

        // Centro da regiao ofuscada e um canto intocado, para provar que a area certa caiu.
        const [blackoutPixel, controlPixel] = await samplePixels(redacted, [
          centerOf(rect),
          { x: 2, y: 2 },
        ]);
        if (blackoutPixel === undefined || controlPixel === undefined) {
          throw new Error('amostragem de pixels falhou');
        }

        return {
          originalTextHasSecret,
          originalBytesHaveSecret,
          redactedTextHasSecret: redactedText.includes(SECRET),
          redactedBytesHaveSecret: await existsInFileBytes(redacted, SECRET),
          redactedHasIncrementalHistory: hasIncrementalHistory(redacted),
          redactedTextIsEmpty: redactedText.trim() === '',
          blackoutPixel,
          controlPixel,
          thumbnailWidth: thumbnail.widthPx,
          thumbnailHeight: thumbnail.heightPx,
          thumbnailIsCached,
          cacheEvicts,
          progressEvents,
        };
      },
    };

    return () => {
      delete window.__pdfkittySpike;
    };
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Spike — ofuscação no navegador</h1>
      {/* O teste espera o gancho global existir, nao este texto: sinalizar prontidao
          por estado obrigaria a chamar setState dentro do efeito. */}
      <p data-testid="spike-status" className="mt-2 text-sm">
        banco de provas
      </p>
    </main>
  );
}
