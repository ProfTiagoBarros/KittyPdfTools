import { describe, it, expect } from 'vitest';
import { parsePageRanges, expandPageRanges, formatPageRanges } from './page-ranges';
import { PdfCoreError, type PdfCoreErrorCode } from '../errors';

/** Verifica o CODIGO do erro, e nao seu texto: a mensagem e para log, nao para contrato. */
function expectCode(action: () => unknown, code: PdfCoreErrorCode): void {
  expect(action).toThrow(PdfCoreError);
  try {
    action();
  } catch (error) {
    expect((error as PdfCoreError).code).toBe(code);
  }
}

const TOTAL = 20;

describe('parsePageRanges', () => {
  it('interpreta o exemplo do documento de requisitos', () => {
    // Entrada base 1 (como a pessoa escreve), saida base 0 (como o codigo consome).
    expect(parsePageRanges('1-5, 8, 11-15', TOTAL)).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 7 },
      { start: 10, end: 14 },
    ]);
  });

  it('aceita intervalo aberto ate o fim', () => {
    expect(parsePageRanges('18-', TOTAL)).toEqual([{ start: 17, end: 19 }]);
  });

  it.each(['  1 - 5  ', '1-5', ' 1-5 '])('tolera espacos em %o', (spec) => {
    expect(parsePageRanges(spec, TOTAL)).toEqual([{ start: 0, end: 4 }]);
  });

  it('rejeita pagina inexistente informando o total nos parametros', () => {
    try {
      parsePageRanges('19-25', TOTAL);
      throw new Error('deveria ter lancado');
    } catch (error) {
      const failure = error as PdfCoreError;
      expect(failure.code).toBe('PAGE_DOES_NOT_EXIST');
      // Os parametros carregam o que a frase precisa, em qualquer idioma.
      expect(failure.params).toMatchObject({ page: 25, total: 20 });
    }
  });

  it('rejeita pagina zero, porque a contagem humana comeca em 1', () => {
    expectCode(() => parsePageRanges('0-3', TOTAL), 'INVALID_PAGE_NUMBER');
  });

  it('rejeita intervalo invertido em vez de adivinhar a intencao', () => {
    expectCode(() => parsePageRanges('9-4', TOTAL), 'REVERSED_RANGE');
  });

  it.each(['abc', '1--5', '1-2-3', '-5'])('rejeita o trecho invalido %o', (spec) => {
    expectCode(() => parsePageRanges(spec, TOTAL), 'INVALID_RANGE_PART');
  });

  it('rejeita especificacao vazia', () => {
    expectCode(() => parsePageRanges('   ,  ', TOTAL), 'EMPTY_RANGE_SPEC');
  });
});

describe('expandPageRanges', () => {
  it('achata preservando a ordem escrita', () => {
    expect(expandPageRanges(parsePageRanges('5, 1-2', TOTAL))).toEqual([4, 0, 1]);
  });

  it('remove repeticao vinda de intervalos sobrepostos', () => {
    expect(expandPageRanges(parsePageRanges('1-4, 3-6', TOTAL))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('formatPageRanges', () => {
  it('agrupa paginas contiguas numa faixa e mantem as isoladas', () => {
    expect(formatPageRanges([0, 1, 2, 6, 7])).toBe('1-3, 7-8');
  });

  it('escreve pagina unica sem hifen', () => {
    expect(formatPageRanges([4])).toBe('5');
  });

  it('ordena e remove repeticao, porque a ordem do clique nao e intencao de ordem', () => {
    expect(formatPageRanges([7, 0, 6, 0, 1])).toBe('1-2, 7-8');
  });

  it('devolve vazio quando nada esta selecionado', () => {
    expect(formatPageRanges([])).toBe('');
  });

  it('volta ao mesmo conjunto ao passar por parsePageRanges', () => {
    const indices = [0, 1, 2, 6, 7, 9];
    const spec = formatPageRanges(indices);
    expect(expandPageRanges(parsePageRanges(spec, TOTAL))).toEqual(indices);
  });
});
