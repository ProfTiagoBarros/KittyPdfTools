import { describe, expect, it } from 'vitest';
import { findMatches, normalizeForSearch, pageKey } from '../search';

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
