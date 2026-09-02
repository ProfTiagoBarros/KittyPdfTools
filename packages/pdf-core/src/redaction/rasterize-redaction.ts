import { PDFDocument } from '@cantoo/pdf-lib';
import { normalizeRect, padRect, type Rect } from '../geometry';
import type { PageRasterizer, RedactionArea } from './types';
import { coreError } from '../errors';

export interface RedactOptions {
  /** Resolucao do rasterizado. Padrao 2 (~144 DPI). */
  readonly scale?: number;
  /** Margem de seguranca em pontos ao redor de cada regiao. Padrao 1. */
  readonly padding?: number;
  /** Progresso por pagina ofuscada. Regra de Ouro 2: operacao longa reporta progresso. */
  readonly onProgress?: (completed: number, total: number) => void;
}

const DEFAULT_SCALE = 2;
const DEFAULT_PADDING = 1;

/**
 * Ofusca regioes de um PDF substituindo cada pagina afetada por uma imagem dela mesma,
 * ja sem o conteudo sensivel.
 *
 * POR QUE RASTERIZAR: a exigencia de US-03 e que o conteudo seja irrecuperavel, nao apenas
 * invisivel. Desenhar um retangulo preto sobre o texto mantem os operadores de texto no
 * content stream, prontos para serem extraidos por qualquer leitor. Ja pintar sobre um
 * bitmap sobrescreve os pixels: nao ha camada por baixo. A pagina resultante nao contem
 * operador de texto algum, entao nao ha o que vazar.
 *
 * O CUSTO: a pagina afetada perde texto pesquisavel e selecionavel. Paginas nao afetadas
 * sao copiadas intactas e mantem seu texto. A busca pode ser reconstituida depois pelo OCR
 * (US-04), que so enxergara o conteudo que sobreviveu.
 *
 * O documento e sempre reescrito do zero, nunca por atualizacao incremental — do contrario
 * a versao anterior, com o conteudo sensivel, permaneceria dentro do arquivo.
 *
 * O `rasterizer` precisa estar ligado ao mesmo documento de `pdfBytes`.
 */
export async function redactByRasterizing(
  pdfBytes: Uint8Array,
  areas: readonly RedactionArea[],
  rasterizer: PageRasterizer,
  options: RedactOptions = {},
): Promise<Uint8Array> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const padding = options.padding ?? DEFAULT_PADDING;

  if (scale <= 0) throw coreError('INVALID_SCALE', { scale }, 'Escala invalida');

  const source = await PDFDocument.load(pdfBytes);
  const pageCount = source.getPageCount();

  const byPage = groupByPage(areas, pageCount, padding);
  if (byPage.size === 0) return pdfBytes;

  const output = await PDFDocument.create();
  const totalToRedact = byPage.size;
  let redacted = 0;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const blackout = byPage.get(pageIndex);

    if (blackout === undefined) {
      const [copied] = await output.copyPages(source, [pageIndex]);
      if (copied === undefined) {
        throw coreError(
          'INTERNAL',
          { detail: `falha ao copiar a pagina ${pageIndex}` },
          'Falha ao copiar',
        );
      }
      output.addPage(copied);
      continue;
    }

    const raster = await rasterizer.rasterize({ pageIndex, scale, blackout });
    // Ofuscar rasteriza SEM perda de proposito: o resultado costuma ser prova, e artefato
    // de compressao em cima de um documento ofuscado seria degradar o que sobrou.
    const image = await output.embedPng(raster.image);
    const page = output.addPage([raster.widthPt, raster.heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: raster.widthPt, height: raster.heightPt });

    redacted += 1;
    options.onProgress?.(redacted, totalToRedact);
  }

  return output.save({ useObjectStreams: false });
}

function groupByPage(
  areas: readonly RedactionArea[],
  pageCount: number,
  padding: number,
): Map<number, Rect[]> {
  const byPage = new Map<number, Rect[]>();

  for (const area of areas) {
    if (!Number.isInteger(area.pageIndex) || area.pageIndex < 0 || area.pageIndex >= pageCount) {
      throw coreError(
        'REDACTION_PAGE_OUT_OF_RANGE',
        { pageIndex: area.pageIndex, lastIndex: pageCount - 1 },
        `Pagina ${area.pageIndex} fora do intervalo`,
      );
    }

    const rect = padRect(normalizeRect(area.rect), padding);
    const existing = byPage.get(area.pageIndex);
    if (existing === undefined) byPage.set(area.pageIndex, [rect]);
    else existing.push(rect);
  }

  return byPage;
}
