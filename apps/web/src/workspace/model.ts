import type { PageRef } from 'pdf-core';

export interface LoadedDocument {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
}

/**
 * Uma pagina na composicao final.
 *
 * `key` e proprio de cada item, e nao derivado de origem+pagina, porque a mesma pagina pode
 * aparecer mais de uma vez. Sem chave propria, duplicar uma pagina faria o drag-and-drop e a
 * selecao confundirem as duas copias.
 */
export interface CompositionItem {
  readonly key: string;
  readonly source: string;
  readonly pageIndex: number;
  /** Graus horarios acumulados, sempre entre 0 e 270. */
  readonly rotate: number;
}

export interface WorkspaceSnapshot {
  readonly items: readonly CompositionItem[];
  readonly selection: readonly string[];
}

export function toPageRefs(items: readonly CompositionItem[]): PageRef[] {
  return items.map((item) => ({
    source: item.source,
    pageIndex: item.pageIndex,
    ...(item.rotate === 0 ? {} : { rotate: item.rotate }),
  }));
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function itemsForDocument(
  documentId: string,
  pageCount: number,
  makeKey: () => string,
): CompositionItem[] {
  return Array.from({ length: pageCount }, (_unused, pageIndex) => ({
    key: makeKey(),
    source: documentId,
    pageIndex,
    rotate: 0,
  }));
}

/** Move um item de posicao, como no arrastar-e-soltar da grade. */
export function moveItem(
  items: readonly CompositionItem[],
  from: number,
  to: number,
): CompositionItem[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    throw new RangeError(`Movimento invalido: ${from} -> ${to}`);
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) throw new Error('Item ausente ao mover');
  next.splice(to, 0, moved);
  return next;
}

export function rotateItems(
  items: readonly CompositionItem[],
  keys: readonly string[],
  delta: number,
): CompositionItem[] {
  const target = new Set(keys);
  return items.map((item) =>
    target.has(item.key) ? { ...item, rotate: normalizeAngle(item.rotate + delta) } : item,
  );
}

export function removeItems(
  items: readonly CompositionItem[],
  keys: readonly string[],
): CompositionItem[] {
  const target = new Set(keys);
  return items.filter((item) => !target.has(item.key));
}

export function duplicateItems(
  items: readonly CompositionItem[],
  keys: readonly string[],
  makeKey: () => string,
): CompositionItem[] {
  const target = new Set(keys);
  return items.flatMap((item) =>
    target.has(item.key) ? [item, { ...item, key: makeKey() }] : [item],
  );
}

export function toggleSelected(selection: readonly string[], key: string): string[] {
  return selection.includes(key)
    ? selection.filter((selected) => selected !== key)
    : [...selection, key];
}

/** Remove da selecao chaves que nao existem mais entre os itens. */
export function pruneSelection(
  items: readonly CompositionItem[],
  selection: readonly string[],
): string[] {
  const alive = new Set(items.map((item) => item.key));
  return selection.filter((key) => alive.has(key));
}
