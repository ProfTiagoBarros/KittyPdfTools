import { coreError } from '../errors';

/** Um intervalo de paginas ja resolvido, em indices base 0 e inclusivo nas duas pontas. */
export interface PageRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Interpreta uma especificacao de intervalos como `1-5, 8, 11-15`.
 *
 * A entrada e base 1 porque e escrita por pessoas, que contam paginas a partir de 1; a saida
 * e base 0 porque e consumida por codigo. Essa traducao acontece so aqui — nenhuma outra
 * parte do nucleo precisa saber que existem duas convencoes.
 *
 * Aceita tambem `11-` como "da 11 ate o fim".
 */
export function parsePageRanges(spec: string, pageCount: number): PageRange[] {
  if (pageCount <= 0) throw coreError('DOCUMENT_HAS_NO_PAGES', {}, 'Documento sem paginas');

  const parts = spec
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) {
    throw coreError('EMPTY_RANGE_SPEC', {}, 'Especificacao de intervalos vazia');
  }

  return parts.map((part) => parseSinglePart(part, pageCount));
}

/**
 * Achata os intervalos numa lista de indices, sem repetir pagina.
 *
 * A ordem informada e preservada: quem pede `5, 1-2` quer as paginas nessa ordem. Duplicatas
 * saem porque um documento com a mesma pagina duas vezes seria quase sempre engano de quem
 * digitou intervalos sobrepostos.
 */
export function expandPageRanges(ranges: readonly PageRange[]): number[] {
  const seen = new Set<number>();
  const indices: number[] = [];

  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index += 1) {
      if (seen.has(index)) continue;
      seen.add(index);
      indices.push(index);
    }
  }

  return indices;
}

function parseSinglePart(part: string, pageCount: number): PageRange {
  const openEnded = /^(\d+)\s*-$/.exec(part);
  if (openEnded !== null) {
    const start = toIndex(openEnded[1], part, pageCount);
    return { start, end: pageCount - 1 };
  }

  const closed = /^(\d+)\s*-\s*(\d+)$/.exec(part);
  if (closed !== null) {
    const start = toIndex(closed[1], part, pageCount);
    const end = toIndex(closed[2], part, pageCount);
    if (end < start) {
      throw coreError('REVERSED_RANGE', { part }, `Intervalo invertido: ${part}`);
    }
    return { start, end };
  }

  const single = /^(\d+)$/.exec(part);
  if (single !== null) {
    const index = toIndex(single[1], part, pageCount);
    return { start: index, end: index };
  }

  throw coreError('INVALID_RANGE_PART', { part }, `Trecho invalido: ${part}`);
}

function toIndex(raw: string | undefined, part: string, pageCount: number): number {
  const pageNumber = Number(raw);

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw coreError('INVALID_PAGE_NUMBER', { part }, `Numero de pagina invalido: ${part}`);
  }
  if (pageNumber > pageCount) {
    throw coreError(
      'PAGE_DOES_NOT_EXIST',
      { part, page: pageNumber, total: pageCount },
      `Pagina ${pageNumber} nao existe (total ${pageCount})`,
    );
  }

  return pageNumber - 1;
}

/**
 * Escreve indices de pagina como uma especificacao legivel: `[0,1,2,6,7]` vira `1-3, 7-8`.
 *
 * E a volta de `parsePageRanges`, e mora aqui pelo mesmo motivo que ela: esta e a unica
 * fronteira do nucleo onde base 0 e base 1 se encontram. Existe para que clicar paginas na
 * grade e digitar no campo sejam a mesma coisa vista de dois jeitos — antes a selecao era
 * ignorada pela divisao, e quem selecionava paginas ficava sem entender por que nada mudava.
 *
 * Ordena e remove repeticao: a ordem em que o usuario clicou nao e uma intencao de ordem, e
 * uma faixa so faz sentido crescente.
 */
export function formatPageRanges(indices: readonly number[]): string {
  const [primeiro, ...resto] = [...new Set(indices)].sort((a, b) => a - b);
  if (primeiro === undefined) return '';

  const partes: string[] = [];
  let inicio = primeiro;
  let fim = primeiro;

  const fechar = () => {
    partes.push(inicio === fim ? `${inicio + 1}` : `${inicio + 1}-${fim + 1}`);
  };

  for (const indice of resto) {
    if (indice === fim + 1) {
      fim = indice;
      continue;
    }
    fechar();
    inicio = indice;
    fim = indice;
  }
  fechar();

  return partes.join(', ');
}
