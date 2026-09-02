import { PDFDocument } from '@cantoo/pdf-lib';
import { throwIfAborted, yieldToEventLoop, type LongRunningOptions } from '../async';
import { coreError } from '../errors';
import type { PageRasterizer } from '../redaction/types';

/** Um ponto de compromisso entre resolucao e qualidade JPEG. */
export interface CompressionStep {
  /** Multiplicador de resolucao. 2 equivale a ~144 DPI. */
  readonly scale: number;
  /** Qualidade JPEG, de 0 a 1. */
  readonly quality: number;
}

/**
 * Degraus do mais fiel ao mais leve.
 *
 * Uma escada fixa, e nao dois eixos livres, porque resolucao e qualidade nao sao
 * independentes na pratica: reduzir a resolucao com qualidade alta produz um arquivo maior e
 * mais feio do que o caminho equilibrado. Cada degrau e um par que faz sentido junto, e a
 * busca por tamanho anda sobre eles — o que tambem limita o numero de tentativas.
 */
export const COMPRESSION_STEPS: readonly CompressionStep[] = [
  { scale: 2, quality: 0.9 },
  { scale: 1.7, quality: 0.8 },
  { scale: 1.5, quality: 0.7 },
  { scale: 1.25, quality: 0.6 },
  { scale: 1, quality: 0.55 },
  { scale: 0.85, quality: 0.5 },
  { scale: 0.7, quality: 0.42 },
];

export type RasterCompressOptions = LongRunningOptions & Partial<CompressionStep>;

/**
 * Substitui cada pagina por uma imagem dela mesma, comprimida em JPEG.
 *
 * E o unico caminho que encolhe de verdade um documento digitalizado: o peso dele esta nas
 * imagens, e nenhuma arrumacao estrutural chega perto. Tambem e o caminho que **perde** —
 * texto pesquisavel, camada de OCR e nitidez —, por isso a interface confirma antes.
 *
 * JPEG, e nao PNG: uma pagina digitalizada e uma fotografia, e PNG sem perda de fotografia
 * costuma sair MAIOR que o original. Ofuscar usa PNG pelo motivo oposto — la o resultado e
 * prova, e degradar seria inaceitavel.
 */
export async function compressByRasterizing(
  pdfBytes: Uint8Array,
  rasterizer: PageRasterizer,
  options: RasterCompressOptions = {},
): Promise<Uint8Array> {
  const scale = options.scale ?? 1.5;
  const quality = options.quality ?? 0.7;

  if (scale <= 0) throw coreError('INVALID_SCALE', { scale }, 'Escala invalida');
  if (quality <= 0 || quality > 1) {
    throw coreError('INVALID_SCALE', { scale: quality }, 'Qualidade invalida');
  }

  const source = await PDFDocument.load(pdfBytes);
  const total = source.getPageCount();
  if (total === 0) throw coreError('DOCUMENT_HAS_NO_PAGES', {}, 'Documento sem paginas');

  const output = await PDFDocument.create();

  for (let pageIndex = 0; pageIndex < total; pageIndex += 1) {
    await yieldToEventLoop();
    throwIfAborted(options.signal);

    const raster = await rasterizer.rasterize({
      pageIndex,
      scale,
      blackout: [],
      format: 'jpeg',
      quality,
    });

    const imagem = await output.embedJpg(raster.image);
    const pagina = output.addPage([raster.widthPt, raster.heightPt]);
    pagina.drawImage(imagem, { x: 0, y: 0, width: raster.widthPt, height: raster.heightPt });

    options.onProgress?.(pageIndex + 1, total);
  }

  return output.save({ useObjectStreams: true });
}

export interface TargetResult {
  readonly pdf: Uint8Array;
  /** O degrau efetivamente usado, para a tela poder dizer o que foi feito. */
  readonly step: CompressionStep;
  /** Falso quando nem o degrau mais agressivo coube no limite pedido. */
  readonly fitsTarget: boolean;
  /** Quantas geracoes completas foram necessarias. */
  readonly attempts: number;
}

export interface TargetOptions extends LongRunningOptions {
  readonly maxBytes: number;
  /** Chamado a cada tentativa concluida, para a tela mostrar a busca acontecendo. */
  readonly onAttempt?: (step: CompressionStep, bytes: number, fits: boolean) => void;
}

/**
 * Busca a melhor qualidade que ainda cabe num limite de tamanho.
 *
 * Existe por causa de sistemas que recusam anexos acima de um tamanho — o SEI e o caso que
 * motivou isto. Sem este modo, o usuario compactaria, olharia o resultado, e repetiria a
 * mao ate acertar.
 *
 * Busca BINARIA sobre a escada, e nao tentativa a tentativa: cada tentativa rasteriza o
 * documento inteiro, que num celular custa segundos por pagina. Sete degraus custam tres
 * tentativas em vez de sete.
 *
 * Quando nem o degrau mais agressivo cabe, devolve esse mesmo resultado com `fitsTarget`
 * falso, em vez de erro: o usuario fica com o menor arquivo possivel e a informacao de que
 * nao deu — melhor do que sair de maos vazias depois de esperar minutos.
 */
export async function compressToTarget(
  pdfBytes: Uint8Array,
  rasterizer: PageRasterizer,
  options: TargetOptions,
): Promise<TargetResult> {
  if (options.maxBytes <= 0) {
    throw coreError('INVALID_MAX_BYTES', { maxBytes: options.maxBytes }, 'Limite invalido');
  }

  let baixo = 0;
  let alto = COMPRESSION_STEPS.length - 1;
  let melhor: { pdf: Uint8Array; step: CompressionStep } | undefined;
  let ultimo: { pdf: Uint8Array; step: CompressionStep } | undefined;
  let attempts = 0;

  while (baixo <= alto) {
    throwIfAborted(options.signal);

    const meio = Math.floor((baixo + alto) / 2);
    const step = COMPRESSION_STEPS[meio];
    if (step === undefined) break;

    const pdf = await compressByRasterizing(pdfBytes, rasterizer, {
      ...step,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    attempts += 1;
    ultimo = { pdf, step };

    const cabe = pdf.length <= options.maxBytes;
    options.onAttempt?.(step, pdf.length, cabe);

    if (cabe) {
      // Coube: guarda e tenta subir a qualidade, indo para degraus mais fieis.
      melhor = { pdf, step };
      alto = meio - 1;
    } else {
      baixo = meio + 1;
    }
  }

  if (melhor !== undefined) {
    return { pdf: melhor.pdf, step: melhor.step, fitsTarget: true, attempts };
  }

  if (ultimo === undefined) {
    throw coreError('INTERNAL', { detail: 'nenhuma tentativa de compressao' }, 'Sem tentativas');
  }

  return { pdf: ultimo.pdf, step: ultimo.step, fitsTarget: false, attempts };
}
