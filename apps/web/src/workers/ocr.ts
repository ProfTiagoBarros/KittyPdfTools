import type { OcrPageText, OcrWord } from 'pdf-core';

/**
 * Reconhecimento de texto com Tesseract.wasm.
 *
 * Todos os assets — worker, wasm e modelo de idioma — sao servidos pela propria aplicacao,
 * a partir de public/tesseract. O padrao do tesseract.js e busca-los em CDN, o que vazaria o
 * padrao de uso (Regra de Ouro 1) e impediria o Desktop de funcionar offline (Regra 4).
 */

/**
 * Caminhos ABSOLUTOS, e nao `/tesseract/...`.
 *
 * Dentro de um Worker, `importScripts` resolve contra a URL do proprio worker, nao contra a
 * origem da pagina — um caminho iniciado por barra e recusado como invalido. O sintoma e
 * enganoso: o erro fala em URL invalida, nao em arquivo ausente.
 */
function assetUrl(path: string): string {
  return new URL(path, self.location.origin).href;
}

const ASSETS = {
  workerPath: assetUrl('/tesseract/worker.min.js'),
  corePath: assetUrl('/tesseract/'),
  langPath: assetUrl('/tesseract/lang'),
  /** Guardamos o modelo descompactado; sem isto o tesseract.js procuraria um `.gz`. */
  gzip: false,
} as const;

const LANGUAGE = 'por';

/** Resolucao do rasterizado enviado ao OCR. Abaixo disso, o reconhecimento perde precisao. */
export const OCR_SCALE = 3;

interface TesseractBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text: string;
  bbox: TesseractBBox;
}

interface TesseractBlock {
  paragraphs?: { lines?: { words?: TesseractWord[] }[] }[];
}

export interface OcrEngine {
  recognizePage(
    png: Uint8Array,
    pageIndex: number,
    imageWidthPx: number,
    imageHeightPx: number,
  ): Promise<OcrPageText>;
  terminate(): Promise<void>;
}

/**
 * Cria o motor de OCR.
 *
 * O `import` e dinamico de proposito: o tesseract.js e seus binarios pesam mais de 14 MB, e
 * quem so quer unir dois PDFs nunca deve pagar esse custo.
 */
export async function createOcrEngine(onProgress?: (fraction: number) => void): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker(LANGUAGE, 1, {
    ...ASSETS,
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(message.progress);
      }
    },
  });

  return {
    async recognizePage(png, pageIndex, imageWidthPx, imageHeightPx) {
      // `blocks: true` e obrigatorio: sem ele o tesseract.js v7 devolve apenas o texto
      // corrido, sem as caixas — e sem caixa nao ha onde posicionar a camada invisivel.
      const result = await worker.recognize(png as unknown as Blob, {}, { blocks: true });
      const blocks = (result.data as { blocks?: TesseractBlock[] | null }).blocks ?? [];

      return {
        pageIndex,
        words: collectWords(blocks),
        imageWidthPx,
        imageHeightPx,
      };
    },

    async terminate() {
      await worker.terminate();
    },
  };
}

/** Achata a hierarquia bloco > paragrafo > linha > palavra que o Tesseract devolve. */
function collectWords(blocks: readonly TesseractBlock[]): OcrWord[] {
  const words: OcrWord[] = [];

  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          });
        }
      }
    }
  }

  return words;
}
