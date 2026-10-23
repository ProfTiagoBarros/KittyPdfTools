import { PDFDocument, degrees, type PDFPage } from '@cantoo/pdf-lib';
import type { Composition, PageRef, SourceDocument, SourceId } from './types';
import { coreError } from '../errors';

/**
 * Materializa a composicao num PDF.
 *
 * PRESERVA: o conteudo de cada pagina, seu tamanho proprio (paginas de origens diferentes
 * mantem dimensoes diferentes) e as anotacoes que `copyPages` carrega junto.
 *
 * LIMITACAO CONHECIDA: marcadores (outline) e links internos que apontem para outra pagina
 * nao sobrevivem a montagem. Reconstrui-los exige remapear destinos entre documentos, o que
 * o pdf-lib nao oferece pronto. Ha teste fixando esse comportamento para que a perda seja
 * uma decisao registrada, e nao uma surpresa.
 */
export async function buildComposition(
  sources: readonly SourceDocument[],
  composition: Composition,
): Promise<Uint8Array> {
  if (composition.length === 0) {
    throw coreError('EMPTY_COMPOSITION', {}, 'Composicao vazia');
  }

  const byId = indexSources(sources);
  const plan = planCopies(composition, byId);
  const output = await PDFDocument.create();

  /*
   * UMA origem por vez: carrega, copia as paginas pedidas e solta, antes de carregar a
   * proxima.
   *
   * O pdf-lib copia o conteudo de cada stream ao interpretar o arquivo, e copia de novo ao
   * levar as paginas para o documento novo. Carregando todas as origens antes de copiar,
   * as versoes interpretadas de TODAS ficavam vivas ate o fim — medido com dois PDFs de 200
   * paginas: a juncao passava de 1,8 GB, acima do que um Windows 32 bits da a um processo.
   * Soltando cada origem assim que suas paginas foram copiadas, o coletor de lixo pode
   * recupera-la antes que a proxima seja aberta e antes de o resultado ser serializado.
   *
   * Dentro de cada origem, todas as paginas vao numa unica chamada: copiar de uma em uma
   * refaz o grafo de objetos a cada pagina, o que fica lento em documentos grandes.
   */
  const copied = new Map<SourceId, PDFPage[]>();
  for (const [id, refs] of plan) {
    const bytes = byId.get(id);
    if (bytes === undefined) {
      throw coreError('INTERNAL', { detail: `origem '${id}' ausente` }, 'Origem ausente');
    }
    const source = await PDFDocument.load(bytes);
    copied.set(id, await output.copyPages(source, validatedIndices(id, refs, source)));
  }

  const cursors = new Map<SourceId, number>();
  for (const ref of composition) {
    const pages = copied.get(ref.source) ?? [];
    const cursor = cursors.get(ref.source) ?? 0;
    const page = pages[cursor];
    if (page === undefined) {
      throw coreError(
        'INTERNAL',
        { detail: `pagina ausente na copia de '${ref.source}'` },
        'Pagina ausente na copia',
      );
    }
    cursors.set(ref.source, cursor + 1);

    if (ref.rotate !== undefined && ref.rotate !== 0) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(normalizeAngle(current + ref.rotate)));
    }

    output.addPage(page);
  }

  return output.save({ useObjectStreams: false });
}

/** Numero de paginas de um documento, sem materializar nada. */
export async function readPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** Composicao que reproduz um ou mais documentos por inteiro, na ordem informada. */
export async function composeAllPages(sources: readonly SourceDocument[]): Promise<PageRef[]> {
  const refs: PageRef[] = [];
  for (const source of sources) {
    const count = await readPageCount(source.bytes);
    for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
      refs.push({ source: source.id, pageIndex });
    }
  }
  return refs;
}

/** Indexa as origens por id, recusando duplicatas sem carregar nenhuma delas. */
function indexSources(sources: readonly SourceDocument[]): Map<SourceId, Uint8Array> {
  const byId = new Map<SourceId, Uint8Array>();

  for (const source of sources) {
    if (byId.has(source.id)) {
      throw coreError('DUPLICATE_SOURCE', { source: source.id }, `Origem duplicada: ${source.id}`);
    }
    byId.set(source.id, source.bytes);
  }

  return byId;
}

/**
 * Agrupa as paginas pedidas por origem, preservando a ordem em que aparecem.
 *
 * Valida aqui so o que nao exige abrir o arquivo — origem conhecida e rotacao. O intervalo
 * das paginas depende de quantas o arquivo tem, e e conferido em `validatedIndices`, no
 * momento em que a origem e carregada.
 */
function planCopies(
  composition: Composition,
  byId: Map<SourceId, Uint8Array>,
): Map<SourceId, PageRef[]> {
  const plan = new Map<SourceId, PageRef[]>();

  for (const ref of composition) {
    if (!byId.has(ref.source)) {
      throw coreError(
        'UNKNOWN_SOURCE',
        { source: ref.source },
        `Origem desconhecida: ${ref.source}`,
      );
    }

    if (ref.rotate !== undefined && ref.rotate % 90 !== 0) {
      throw coreError('INVALID_ROTATION', { rotate: ref.rotate }, 'Rotacao nao multipla de 90');
    }

    const refs = plan.get(ref.source);
    if (refs === undefined) plan.set(ref.source, [ref]);
    else refs.push(ref);
  }

  return plan;
}

/** Confere cada pagina pedida contra o total real da origem e devolve os indices. */
function validatedIndices(id: SourceId, refs: readonly PageRef[], source: PDFDocument): number[] {
  const count = source.getPageCount();

  return refs.map((ref) => {
    if (!Number.isInteger(ref.pageIndex) || ref.pageIndex < 0 || ref.pageIndex >= count) {
      throw coreError(
        'PAGE_OUT_OF_RANGE',
        { source: id, pageIndex: ref.pageIndex, lastIndex: count - 1 },
        `Pagina ${ref.pageIndex} fora do intervalo de ${id}`,
      );
    }
    return ref.pageIndex;
  });
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
