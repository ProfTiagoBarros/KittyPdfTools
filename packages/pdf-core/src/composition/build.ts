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

  const loaded = await loadSources(sources);
  const output = await PDFDocument.create();

  // Copia todas as paginas de uma origem numa unica chamada. Copiar de uma em uma refaz o
  // grafo de objetos a cada pagina, o que fica lento em documentos grandes.
  const plan = planCopies(composition, loaded);
  const copied = new Map<SourceId, PDFPage[]>();
  for (const [id, indices] of plan) {
    const source = loaded.get(id);
    if (source === undefined) {
      throw coreError(
        'INTERNAL',
        { detail: `origem '${id}' nao carregada` },
        'Origem nao carregada',
      );
    }
    copied.set(id, await output.copyPages(source, indices));
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

async function loadSources(
  sources: readonly SourceDocument[],
): Promise<Map<SourceId, PDFDocument>> {
  const loaded = new Map<SourceId, PDFDocument>();

  for (const source of sources) {
    if (loaded.has(source.id)) {
      throw coreError('DUPLICATE_SOURCE', { source: source.id }, `Origem duplicada: ${source.id}`);
    }
    loaded.set(source.id, await PDFDocument.load(source.bytes));
  }

  return loaded;
}

/** Agrupa as paginas pedidas por origem, preservando a ordem em que aparecem. */
function planCopies(
  composition: Composition,
  loaded: Map<SourceId, PDFDocument>,
): Map<SourceId, number[]> {
  const plan = new Map<SourceId, number[]>();

  for (const ref of composition) {
    const source = loaded.get(ref.source);
    if (source === undefined) {
      throw coreError(
        'UNKNOWN_SOURCE',
        { source: ref.source },
        `Origem desconhecida: ${ref.source}`,
      );
    }

    const count = source.getPageCount();
    if (!Number.isInteger(ref.pageIndex) || ref.pageIndex < 0 || ref.pageIndex >= count) {
      throw coreError(
        'PAGE_OUT_OF_RANGE',
        { source: ref.source, pageIndex: ref.pageIndex, lastIndex: count - 1 },
        `Pagina ${ref.pageIndex} fora do intervalo de ${ref.source}`,
      );
    }

    if (ref.rotate !== undefined && ref.rotate % 90 !== 0) {
      throw coreError('INVALID_ROTATION', { rotate: ref.rotate }, 'Rotacao nao multipla de 90');
    }

    const indices = plan.get(ref.source);
    if (indices === undefined) plan.set(ref.source, [ref.pageIndex]);
    else indices.push(ref.pageIndex);
  }

  return plan;
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
