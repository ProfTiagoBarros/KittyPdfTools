import { describe, it, expect } from 'vitest';
import { createTextPdf } from '../fixtures';
import { addInvisibleTextLayer } from '../ocr/text-layer';
import { extractAllText } from '../testing/leak-checks';
import { repackLossless, reductionPercent } from './repack';
import type { OcrPageText } from '../ocr/types';

const VISIVEL = 'CONTRATO DE PRESTACAO';
const OCULTO = 'palavraoculta';

/**
 * Palavras VARIADAS, e nao `palavra1, palavra2...`.
 *
 * Importa para a medicao: texto repetitivo comprime cerca de vinte para um, e uma camada de
 * OCR sintetica assim custa quase nada dentro do arquivo — o teste concluiria que remove-la
 * nao adianta. OCR de verdade produz vocabulario variado, que comprime mal. Gerador
 * deterministico para o teste nao oscilar.
 */
function palavraSintetica(semente: number): string {
  const letras = 'abcdefghijklmnopqrstuvwxyz';
  let estado = (semente * 2654435761) % 4294967296;
  let saida = '';
  for (let i = 0; i < 8; i += 1) {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    saida += letras[estado % 26];
  }
  return saida;
}

/** Camada de OCR densa o bastante para o ganho ser mensuravel, e nao ruido. */
function camadaOcr(palavras: number): OcrPageText[] {
  return [
    {
      pageIndex: 0,
      imageWidthPx: 800,
      imageHeightPx: 520,
      words: Array.from({ length: palavras }, (_u, i) => {
        const x0 = 20 + (i % 6) * 120;
        const y0 = 20 + Math.floor(i / 6) * 26;
        return { text: `${OCULTO}${palavraSintetica(i)}`, x0, y0, x1: x0 + 110, y1: y0 + 20 };
      }),
    },
  ];
}

async function comOcr(palavras = 300): Promise<Uint8Array> {
  const base = await createTextPdf([[{ text: VISIVEL, y: 200 }]]);
  const { pdf } = await addInvisibleTextLayer(base, camadaOcr(palavras));
  return pdf;
}

describe('repackLossless', () => {
  it('reempacota sem tocar no conteudo quando nada e pedido', async () => {
    const original = await comOcr();
    const { pdf, invisibleBlocksRemoved } = await repackLossless(original);

    expect(invisibleBlocksRemoved).toBe(0);
    // O texto — visivel e invisivel — continua todo la.
    const texto = await extractAllText(pdf);
    expect(texto).toContain(VISIVEL);
    expect(texto).toContain(`${OCULTO}${palavraSintetica(0)}`);
  });

  it('encolhe o arquivo so por reempacotar', async () => {
    const original = await comOcr();
    const { pdf } = await repackLossless(original);

    expect(pdf.length).toBeLessThan(original.length);
  });

  /**
   * O pedido do usuario: PDFs com OCR ficam grandes demais para sistemas com limite de
   * tamanho. Remover a camada e o unico ganho grande que NAO mexe na imagem da pagina.
   */
  it('remove a camada de OCR e preserva o texto visivel', async () => {
    const original = await comOcr();
    const { pdf, invisibleBlocksRemoved } = await repackLossless(original, {
      removeInvisibleText: true,
    });

    expect(invisibleBlocksRemoved).toBeGreaterThan(0);

    const texto = await extractAllText(pdf);
    // Controle negativo: se esta asercao passasse sozinha, a funcao poderia estar apagando
    // o content stream inteiro e ninguem notaria.
    expect(texto).toContain(VISIVEL);
    expect(texto).not.toContain(OCULTO);
  });

  it('remover a camada encolhe mais do que so reempacotar', async () => {
    const original = await comOcr();
    const apenasReempacotado = await repackLossless(original);
    const semOcr = await repackLossless(original, { removeInvisibleText: true });

    expect(semOcr.pdf.length).toBeLessThan(apenasReempacotado.pdf.length);
  });

  it('nao altera um documento que nunca passou por OCR', async () => {
    const original = await createTextPdf([[{ text: VISIVEL, y: 200 }]]);
    const { pdf, invisibleBlocksRemoved } = await repackLossless(original, {
      removeInvisibleText: true,
    });

    expect(invisibleBlocksRemoved).toBe(0);
    expect(await extractAllText(pdf)).toContain(VISIVEL);
  });

  it('relata progresso por pagina', async () => {
    const base = await createTextPdf([
      [{ text: 'a', y: 200 }],
      [{ text: 'b', y: 200 }],
      [{ text: 'c', y: 200 }],
    ]);

    const passos: number[] = [];
    await repackLossless(base, {
      removeInvisibleText: true,
      onProgress: (feito, total) => {
        expect(total).toBe(3);
        passos.push(feito);
      },
    });

    expect(passos).toEqual([1, 2, 3]);
  });

  it('informa o tamanho original, para a tela mostrar o antes e o depois', async () => {
    const original = await comOcr(50);
    const { originalBytes } = await repackLossless(original);

    expect(originalBytes).toBe(original.length);
  });
});

describe('reductionPercent', () => {
  it('calcula a reducao arredondada', () => {
    expect(reductionPercent(1000, 250)).toBe(75);
  });

  it('nunca reporta reducao negativa: crescer nao e encolher menos que zero', () => {
    expect(reductionPercent(1000, 1200)).toBe(0);
  });
});
