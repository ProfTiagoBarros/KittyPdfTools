import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from '@cantoo/pdf-lib';
import { coreError } from '../errors';
import type { OcrPageText, OcrWord, TextLayerReport } from './types';

export interface TextLayerResult {
  readonly pdf: Uint8Array;
  readonly report: TextLayerReport;
}

/** Fonte minima aceitavel: caixa degenerada nao produz texto selecionavel. */
const MIN_FONT_SIZE = 1;

/**
 * A Helvetica padrao do PDF usa a codificacao WinAnsi, que cobre o Latin-1 — e portanto todo
 * o portugues. Caracteres fora dela precisam ser barrados ANTES da codificacao: `encodeText`
 * nao lanca erro, apenas substitui em silencio, e a camada invisivel acabaria com texto
 * incorreto que ninguem encontraria numa busca.
 */
function isEncodable(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined || code > 0xff) return false;
  }
  return true;
}

/**
 * Acrescenta uma camada de texto invisivel sobre as paginas, tornando-as pesquisaveis.
 *
 * A pagina nao e alterada visualmente: o texto entra com modo de renderizacao 3 (invisivel),
 * exatamente sobre onde o OCR viu cada palavra. Quem le o PDF continua vendo a imagem
 * digitalizada; quem busca ou copia encontra o texto.
 *
 * E o que fecha US-04 — "copiar conteudos OU pesquisar no documento" — e tambem o que
 * devolve busca a uma pagina que a ofuscacao rasterizou.
 */
export async function addInvisibleTextLayer(
  pdfBytes: Uint8Array,
  pages: readonly OcrPageText[],
): Promise<TextLayerResult> {
  const document = await PDFDocument.load(pdfBytes);
  const pageCount = document.getPageCount();
  const font = await document.embedFont(StandardFonts.Helvetica);

  let written = 0;
  let skipped = 0;

  for (const result of pages) {
    if (
      !Number.isInteger(result.pageIndex) ||
      result.pageIndex < 0 ||
      result.pageIndex >= pageCount
    ) {
      throw coreError(
        'PAGE_OUT_OF_RANGE',
        { source: 'ocr', pageIndex: result.pageIndex, lastIndex: pageCount - 1 },
        `Pagina ${result.pageIndex} fora do intervalo`,
      );
    }
    if (result.imageWidthPx <= 0 || result.imageHeightPx <= 0) {
      throw coreError(
        'INVALID_SCALE',
        { scale: result.imageWidthPx },
        'Dimensoes da imagem analisada invalidas',
      );
    }

    const page = document.getPage(result.pageIndex);
    const { width, height } = page.getSize();

    // A imagem foi rasterizada a partir desta pagina, entao a proporcao bate; a escala
    // apenas desfaz o fator de resolucao usado na rasterizacao.
    const scaleX = width / result.imageWidthPx;
    const scaleY = height / result.imageHeightPx;

    page.setFont(font);
    const [, fontKey] = page.getFont();

    for (const word of result.words) {
      const operators = wordOperators(word, font, fontKey, scaleX, scaleY, height);
      if (operators === undefined) {
        skipped += 1;
        continue;
      }
      page.pushOperators(...operators);
      written += 1;
    }
  }

  const pdf = await document.save({ useObjectStreams: false });
  return { pdf, report: { written, skipped } };
}

type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;
type FontKey = ReturnType<ReturnType<PDFDocument['addPage']>['getFont']>[1];
type Operators = ReturnType<typeof pushGraphicsState>[];

function wordOperators(
  word: OcrWord,
  font: Font,
  fontKey: FontKey,
  scaleX: number,
  scaleY: number,
  pageHeight: number,
): Operators | undefined {
  const text = word.text.trim();
  if (text === '') return undefined;

  const boxHeight = Math.abs(word.y1 - word.y0) * scaleY;
  const fontSize = Math.max(MIN_FONT_SIZE, boxHeight);

  // O eixo Y da imagem cresce para baixo e o do PDF para cima; a linha de base fica no
  // rodape da caixa, nao no topo.
  const x = Math.min(word.x0, word.x1) * scaleX;
  const y = pageHeight - Math.max(word.y0, word.y1) * scaleY;

  // Glifo fora do repertorio da fonte: descarta a palavra e segue com o documento. Perder
  // uma palavra e melhor do que abortar por causa de um borrao que o OCR leu como simbolo.
  if (!isEncodable(text)) return undefined;

  let encoded;
  try {
    encoded = font.encodeText(text);
  } catch {
    return undefined;
  }

  return [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontKey, fontSize),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(encoded),
    endText(),
    popGraphicsState(),
  ];
}
