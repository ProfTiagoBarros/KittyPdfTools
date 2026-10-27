import { describe, expect, it } from 'vitest';
import {
  countOccurrences,
  findMatches,
  matchesInGrid,
  normalizeForSearch,
  pageKey,
  stepMatch,
} from '../search';

const textos = (documento: string, paginas: readonly string[]) =>
  new Map<string, readonly string[]>([[documento, paginas]]);

describe('normalizeForSearch', () => {
  it('ignora caixa e acento', () => {
    expect(normalizeForSearch('ENDEREÇO')).toBe(normalizeForSearch('endereco'));
    expect(normalizeForSearch('Inscrição')).toBe('inscricao');
  });
});

describe('findMatches', () => {
  it('marca a pagina com pelo menos uma ocorrencia', () => {
    const resultado = findMatches(
      textos('doc-1', ['nada aqui', 'o contrato vence em maio', 'contrato e contrato']),
      'contrato',
    );

    expect(resultado.matchedPages).toEqual([pageKey('doc-1', 1), pageKey('doc-1', 2)]);
  });

  it('acha o termo digitado sem acento no texto acentuado', () => {
    const resultado = findMatches(textos('doc-1', ['Endereço do titular']), 'endereco');

    expect(resultado.matchedPages).toEqual([pageKey('doc-1', 0)]);
  });

  it('atravessa documentos diferentes', () => {
    const mapa = new Map<string, readonly string[]>([
      ['doc-1', ['prazo']],
      ['doc-2', ['sem nada', 'prazo final']],
    ]);

    expect(findMatches(mapa, 'prazo').matchedPages).toEqual([
      pageKey('doc-1', 0),
      pageKey('doc-2', 1),
    ]);
  });

  it('conta quantas paginas tem texto, para distinguir "nao achei" de "nao da para achar"', () => {
    // Um documento so de imagem chega com strings vazias ate o OCR rodar. Sem esta contagem
    // a interface diria "0 resultados" para algo que ela nunca teve como procurar.
    const resultado = findMatches(textos('doc-1', ['', '', '']), 'qualquer');

    expect(resultado.matchedPages).toEqual([]);
    expect(resultado.pagesWithText).toBe(0);
  });

  it('termo vazio nao marca nada', () => {
    expect(findMatches(textos('doc-1', ['contrato']), '   ').matchedPages).toEqual([]);
  });
});

describe('contagem de ocorrencias', () => {
  it('conta sem sobreposicao, como um editor contaria', () => {
    expect(countOccurrences('contrato e contrato', 'contrato')).toBe(2);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('nada', 'x')).toBe(0);
    expect(countOccurrences('nada', '')).toBe(0);
  });

  it('cada pagina com o termo traz quantas vezes ele aparece, sem acento nem caixa', () => {
    const resultado = findMatches(textos('doc-1', ['nada', 'Prazo e PRAZO', 'prazo']), 'prazo');

    expect(resultado.occurrences).toEqual({
      [pageKey('doc-1', 1)]: 2,
      [pageKey('doc-1', 2)]: 1,
    });
  });
});

describe('ocorrencias vistas pela grade', () => {
  const contagem = { [pageKey('a', 0)]: 2, [pageKey('a', 2)]: 1 };

  it('segue a ordem da grade e soma as copias duplicadas', () => {
    const grade = [
      { key: 'k3', source: 'a', pageIndex: 2 },
      { key: 'k1', source: 'a', pageIndex: 0 },
      { key: 'k2', source: 'a', pageIndex: 1 },
      { key: 'k1b', source: 'a', pageIndex: 0 },
    ];

    expect(matchesInGrid(grade, contagem)).toEqual({ keys: ['k3', 'k1', 'k1b'], occurrences: 5 });
  });

  it('pagina excluida da grade nao conta', () => {
    expect(matchesInGrid([{ key: 'k2', source: 'a', pageIndex: 1 }], contagem)).toEqual({
      keys: [],
      occurrences: 0,
    });
  });
});

describe('navegar entre paginas com o termo', () => {
  const chaves = ['a', 'b', 'c'];

  it('sem pagina em foco, avancar vai a primeira e voltar, a ultima', () => {
    expect(stepMatch(chaves, null, 1)).toBe('a');
    expect(stepMatch(chaves, null, -1)).toBe('c');
  });

  it('da a volta nas pontas', () => {
    expect(stepMatch(chaves, 'c', 1)).toBe('a');
    expect(stepMatch(chaves, 'a', -1)).toBe('c');
    expect(stepMatch(chaves, 'a', 1)).toBe('b');
  });

  it('pagina em foco que saiu da grade recomeca das pontas', () => {
    expect(stepMatch(chaves, 'sumiu', 1)).toBe('a');
  });

  it('sem paginas com o termo, nao ha para onde ir', () => {
    expect(stepMatch([], null, 1)).toBeNull();
  });
});
