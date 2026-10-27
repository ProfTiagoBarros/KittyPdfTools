'use client';

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useWorkspaceStore } from '@/workspace/store';
import { PageCard } from './page-card';
import { PagePreview } from './page-preview';
import { pageKey } from '@/workspace/search';

export function PageGrid() {
  const { t } = useTranslation();
  const items = useWorkspaceStore((state) => state.items);
  const documents = useWorkspaceStore((state) => state.documents);
  const selection = useWorkspaceStore((state) => state.selection);
  const matchedPages = useWorkspaceStore((state) => state.matchedPages);
  const activeMatch = useWorkspaceStore((state) => state.activeMatch);
  const moveItem = useWorkspaceStore((state) => state.moveItem);
  const toggleSelection = useWorkspaceStore((state) => state.toggleSelection);
  const rotate = useWorkspaceStore((state) => state.rotate);
  const duplicate = useWorkspaceStore((state) => state.duplicate);
  const remove = useWorkspaceStore((state) => state.remove);

  /*
   * A visualizacao segue a CHAVE do item, nao a posicao.
   *
   * Ela permite mover a pagina de dentro, e a posicao muda a cada movimento — guardar o
   * indice faria a lupa saltar para a pagina vizinha exatamente no momento em que o usuario
   * acabou de mover a que estava olhando.
   */
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreviewKey(null), []);

  /*
   * Tres sensores, um por forma de apontar, e nao um `PointerSensor` para todas.
   *
   * O ponteiro unificado obrigava o mesmo criterio para mouse e dedo, e no celular isso
   * quebra: qualquer arrasto de alguns pixels iniciava o drag e a grade parava de rolar.
   * Com sensores separados, o mouse dispara por distancia (clique curto continua
   * selecionando) e o toque dispara por PRESSAO LONGA — deslizar rola a lista, segurar move
   * a pagina, que e a convencao que o usuario de celular ja conhece.
   *
   * O teclado mantem a reordenacao acessivel sem mouse nem tela sensivel.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;

    const from = items.findIndex((item) => item.key === active.id);
    const to = items.findIndex((item) => item.key === over.id);
    if (from === -1 || to === -1) return;

    moveItem(from, to);
  }

  if (items.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-neutral-500" data-testid="grid-empty">
        {t('workspace.empty')}
      </p>
    );
  }

  const nameOf = (documentId: string) =>
    documents.find((document) => document.id === documentId)?.name ?? documentId;

  // Conjunto porque a grade pode ter centenas de cartoes: `includes` num array faria a
  // busca custar O(paginas x paginas) a cada render.
  const matched = new Set(matchedPages);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.key)} strategy={rectSortingStrategy}>
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-4"
          data-testid="page-grid"
        >
          {items.map((item, index) => (
            <PageCard
              key={item.key}
              item={item}
              position={index + 1}
              fileName={nameOf(item.source)}
              selected={selection.includes(item.key)}
              matched={matched.has(pageKey(item.source, item.pageIndex))}
              currentMatch={item.key === activeMatch}
              canMoveBack={index > 0}
              canMoveForward={index < items.length - 1}
              onMove={(delta) => moveItem(index, index + delta)}
              onToggle={() => toggleSelection(item.key)}
              onPreview={() => setPreviewKey(item.key)}
              onRotate={(delta) => rotate([item.key], delta)}
              onDuplicate={() => duplicate([item.key])}
              onRemove={() => remove([item.key])}
            />
          ))}
        </ul>
      </SortableContext>

      {previewKey !== null && <PagePreview startKey={previewKey} onClose={closePreview} />}
    </DndContext>
  );
}
