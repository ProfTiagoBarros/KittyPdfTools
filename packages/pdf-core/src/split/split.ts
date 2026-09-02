import { buildComposition, readPageCount } from '../composition/build';
import type { PageRef } from '../composition/types';
import { expandPageRanges, parsePageRanges } from './page-ranges';
import { coreError } from '../errors';
import { yieldToEventLoop, throwIfAborted, type LongRunningOptions } from '../async';

const SOURCE = 'documento';

function refsFor(indices: readonly number[]): PageRef[] {
  return indices.map((pageIndex) => ({ source: SOURCE, pageIndex }));
}

async function build(bytes: Uint8Array, indices: readonly number[]): Promise<Uint8Array> {
  return buildComposition([{ id: SOURCE, bytes }], refsFor(indices));
}

/**
 * Extrai as paginas indicadas para UM unico documento.
 *
 * `1-5, 8, 11-15` produz um arquivo com essas onze paginas, na ordem escrita.
 */
export async function extractPages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const pageCount = await readPageCount(bytes);
  const indices = expandPageRanges(parsePageRanges(spec, pageCount));
  return build(bytes, indices);
}

/**
 * Divide o documento em UM arquivo POR intervalo.
 *
 * `1-5, 8, 11-15` produz tres arquivos. E a diferenca em relacao a `extractPages`: mesma
 * sintaxe, intencoes distintas — separar em partes versus recortar um trecho.
 */
export async function splitByRanges(
  bytes: Uint8Array,
  spec: string,
  options: LongRunningOptions = {},
): Promise<Uint8Array[]> {
  const pageCount = await readPageCount(bytes);
  const ranges = parsePageRanges(spec, pageCount);

  const volumes: Uint8Array[] = [];
  for (const [position, range] of ranges.entries()) {
    await yieldToEventLoop();
    throwIfAborted(options.signal);
    volumes.push(await build(bytes, expandPageRanges([range])));
    options.onProgress?.(position + 1, ranges.length);
  }
  return volumes;
}

export interface SizeSplitResult {
  readonly volumes: readonly Uint8Array[];
  /**
   * Paginas (base 0) que sozinhas ja excedem o limite. O volume que as contem passa do
   * tamanho pedido, porque uma pagina nao pode ser partida ao meio. Devolver isto e melhor
   * do que entregar em silencio um arquivo maior do que o prometido.
   */
  readonly oversizedPages: readonly number[];
}

export type SplitBySizeOptions = LongRunningOptions;

/**
 * Divide o documento em volumes que caibam num limite de bytes.
 *
 * Empacotamento incremental: acrescenta uma pagina, gera, e ao passar do limite fecha o
 * volume na ultima versao que coube. Nao ha como saber o tamanho final sem gerar — PDF
 * compartilha fontes e objetos entre paginas, entao o tamanho nao e a soma das partes.
 *
 * O custo e uma geracao por pagina; por isso a operacao reporta progresso e pertence a um
 * worker, nunca a main thread.
 */
export async function splitBySize(
  bytes: Uint8Array,
  maxBytes: number,
  options: SplitBySizeOptions = {},
): Promise<SizeSplitResult> {
  if (maxBytes <= 0)
    throw coreError('INVALID_MAX_BYTES', { maxBytes }, 'Limite de tamanho invalido');

  const pageCount = await readPageCount(bytes);
  const volumes: Uint8Array[] = [];
  const oversizedPages: number[] = [];

  let current: number[] = [];
  let lastFitting: Uint8Array | undefined;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    await yieldToEventLoop();
    throwIfAborted(options.signal);
    const candidate = [...current, pageIndex];
    const built = await build(bytes, candidate);

    if (built.length <= maxBytes) {
      current = candidate;
      lastFitting = built;
    } else if (current.length === 0) {
      // Pagina que sozinha estoura o limite: vira um volume proprio, acima do pedido.
      volumes.push(built);
      oversizedPages.push(pageIndex);
      current = [];
      lastFitting = undefined;
    } else {
      if (lastFitting === undefined) {
        throw coreError(
          'INTERNAL',
          { detail: 'estado inconsistente ao fechar volume' },
          'Estado inconsistente',
        );
      }
      volumes.push(lastFitting);
      current = [pageIndex];
      lastFitting = await build(bytes, current);

      if (lastFitting.length > maxBytes) {
        volumes.push(lastFitting);
        oversizedPages.push(pageIndex);
        current = [];
        lastFitting = undefined;
      }
    }

    options.onProgress?.(pageIndex + 1, pageCount);
  }

  if (current.length > 0 && lastFitting !== undefined) volumes.push(lastFitting);

  return { volumes, oversizedPages };
}
