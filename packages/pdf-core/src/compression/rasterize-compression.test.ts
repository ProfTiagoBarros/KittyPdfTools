import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { createTextPdf } from '../fixtures';
import { createNodeRasterizer } from '../testing/node-rasterizer';
import { extractAllText } from '../testing/leak-checks';
import { PdfCoreError, type PdfCoreErrorCode } from '../errors';
import {
  COMPRESSION_STEPS,
  compressByRasterizing,
  compressToTarget,
} from './rasterize-compression';

const TEXTO = 'RELATORIO CONFIDENCIAL 2026';

function expectCode(action: () => unknown, code: PdfCoreErrorCode): Promise<void> | void {
  return expect(action()).rejects.toSatisfy(
    (erro: unknown) => erro instanceof PdfCoreError && erro.code === code,
  );
}

async function documento(paginas = 3): Promise<Uint8Array> {
  return createTextPdf(
    Array.from({ length: paginas }, (_u, i) => [
      { text: TEXTO, y: 200 },
      { text: `pagina ${i + 1}`, y: 160 },
    ]),
  );
}

describe('compressByRasterizing', () => {
  it('mantem a quantidade de paginas e o tamanho de cada uma', async () => {
    const original = await documento(3);
    const rasterizador = await createNodeRasterizer(original);

    const comprimido = await compressByRasterizing(original, rasterizador, { quality: 0.6 });
    await rasterizador.dispose();

    const antes = await PDFDocument.load(original);
    const depois = await PDFDocument.load(comprimido);

    expect(depois.getPageCount()).toBe(antes.getPageCount());
    expect(depois.getPage(0).getSize()).toEqual(antes.getPage(0).getSize());
  });

  /**
   * A perda que a interface precisa avisar: rasterizar apaga o texto. Esta asercao e o
   * contrato — se um dia ela falhar, o aviso na tela virou mentira.
   */
  it('o texto deixa de ser extraivel, que e a perda anunciada', async () => {
    const original = await documento(1);
    expect(await extractAllText(original)).toContain(TEXTO);

    const rasterizador = await createNodeRasterizer(original);
    const comprimido = await compressByRasterizing(original, rasterizador, { quality: 0.6 });
    await rasterizador.dispose();

    expect(await extractAllText(comprimido)).not.toContain(TEXTO);
  });

  it('qualidade menor produz arquivo menor', async () => {
    const original = await documento(2);
    const rasterizador = await createNodeRasterizer(original);

    const alta = await compressByRasterizing(original, rasterizador, { scale: 2, quality: 0.95 });
    const baixa = await compressByRasterizing(original, rasterizador, { scale: 2, quality: 0.3 });
    await rasterizador.dispose();

    expect(baixa.length).toBeLessThan(alta.length);
  });

  it('relata progresso por pagina', async () => {
    const original = await documento(4);
    const rasterizador = await createNodeRasterizer(original);

    const passos: number[] = [];
    await compressByRasterizing(original, rasterizador, {
      onProgress: (feito, total) => {
        expect(total).toBe(4);
        passos.push(feito);
      },
    });
    await rasterizador.dispose();

    expect(passos).toEqual([1, 2, 3, 4]);
  });

  it('atende ao cancelamento entre paginas', async () => {
    const original = await documento(6);
    const rasterizador = await createNodeRasterizer(original);
    const controle = new AbortController();

    const promessa = compressByRasterizing(original, rasterizador, {
      signal: controle.signal,
      onProgress: (feito) => {
        if (feito === 2) controle.abort();
      },
    });

    await expect(promessa).rejects.toThrow(/cancelada/i);
    await rasterizador.dispose();
  });

  it('recusa escala e qualidade invalidas pelo codigo do erro', async () => {
    const original = await documento(1);
    const rasterizador = await createNodeRasterizer(original);

    await expectCode(
      () => compressByRasterizing(original, rasterizador, { scale: 0 }),
      'INVALID_SCALE',
    );
    await expectCode(
      () => compressByRasterizing(original, rasterizador, { quality: 1.5 }),
      'INVALID_SCALE',
    );
    await rasterizador.dispose();
  });
});

describe('compressToTarget', () => {
  it('devolve um arquivo dentro do limite pedido', async () => {
    const original = await documento(3);
    const rasterizador = await createNodeRasterizer(original);

    // Limite folgado o bastante para caber, apertado o bastante para nao ser o primeiro degrau.
    const solto = await compressByRasterizing(original, rasterizador, COMPRESSION_STEPS[0]);
    const limite = Math.floor(solto.length * 0.6);

    const resultado = await compressToTarget(original, rasterizador, { maxBytes: limite });
    await rasterizador.dispose();

    expect(resultado.fitsTarget).toBe(true);
    expect(resultado.pdf.length).toBeLessThanOrEqual(limite);
  });

  /**
   * A razao de a busca ser binaria: cada tentativa rasteriza o documento inteiro. Sete
   * degraus percorridos um a um custariam sete geracoes completas.
   */
  it('encontra o degrau em poucas tentativas', async () => {
    const original = await documento(2);
    const rasterizador = await createNodeRasterizer(original);

    const solto = await compressByRasterizing(original, rasterizador, COMPRESSION_STEPS[0]);
    const resultado = await compressToTarget(original, rasterizador, {
      maxBytes: Math.floor(solto.length * 0.7),
    });
    await rasterizador.dispose();

    expect(resultado.attempts).toBeLessThanOrEqual(3);
  });

  it('escolhe a MAIOR qualidade que cabe, e nao a primeira que couber', async () => {
    const original = await documento(2);
    const rasterizador = await createNodeRasterizer(original);

    const tentativas: number[] = [];
    const resultado = await compressToTarget(original, rasterizador, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      onAttempt: (step) => tentativas.push(step.quality),
    });
    await rasterizador.dispose();

    // Com limite infinito, o degrau escolhido tem de ser o mais fiel de todos.
    expect(resultado.step).toEqual(COMPRESSION_STEPS[0]);
    expect(resultado.fitsTarget).toBe(true);
  });

  it('entrega o menor possivel e avisa quando o limite e inalcancavel', async () => {
    const original = await documento(2);
    const rasterizador = await createNodeRasterizer(original);

    const resultado = await compressToTarget(original, rasterizador, { maxBytes: 500 });
    await rasterizador.dispose();

    // Nao lanca: o usuario esperou minutos e sai com o melhor que deu, sabendo que nao coube.
    expect(resultado.fitsTarget).toBe(false);
    expect(resultado.step).toEqual(COMPRESSION_STEPS.at(-1));
    expect(resultado.pdf.length).toBeGreaterThan(0);
  });

  it('recusa limite invalido pelo codigo do erro', async () => {
    const original = await documento(1);
    const rasterizador = await createNodeRasterizer(original);

    await expectCode(
      () => compressToTarget(original, rasterizador, { maxBytes: 0 }),
      'INVALID_MAX_BYTES',
    );
    await rasterizador.dispose();
  });
});
