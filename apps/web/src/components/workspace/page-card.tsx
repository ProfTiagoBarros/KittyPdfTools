'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Copy, RotateCcw, RotateCw, Search, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { PageThumbnail } from './page-thumbnail';
import type { CompositionItem } from '@/workspace/model';

interface PageCardProps {
  readonly item: CompositionItem;
  readonly position: number;
  readonly fileName: string;
  readonly selected: boolean;
  /** Pagina com pelo menos uma ocorrencia do termo buscado. */
  readonly matched: boolean;
  readonly canMoveBack: boolean;
  readonly canMoveForward: boolean;
  /** -1 move uma posicao para tras, +1 para a frente. */
  readonly onMove: (delta: number) => void;
  readonly onToggle: () => void;
  readonly onRotate: (delta: number) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}

export function PageCard({
  item,
  position,
  fileName,
  selected,
  matched,
  canMoveBack,
  canMoveForward,
  onMove,
  onToggle,
  onRotate,
  onDuplicate,
  onRemove,
}: PageCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });

  const label = t('workspace.pageOf', { number: position, file: fileName });
  // O destaque entra tambem no nome acessivel: cor sozinha nao informa quem nao a enxerga.
  const accessibleLabel = matched ? `${label} — ${t('workspace.pageMatches')}` : label;
  const origem = `${fileName} · ${t('workspace.sourcePage', { number: item.pageIndex + 1 })}`;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border p-2 transition-colors',
        selected
          ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
          : 'border-neutral-200 dark:border-neutral-800',
        // O amarelo vem por fora da borda (anel), para nao competir com a borda da selecao:
        // uma pagina pode estar selecionada E conter o termo ao mesmo tempo.
        matched && 'ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30',
        isDragging && 'z-10 opacity-60',
      )}
      data-testid="page-card"
      data-page-key={item.key}
      data-rotate={item.rotate}
      data-selected={selected}
      data-matched={matched}
      {...attributes}
      {...listeners}
    >
      {/*
        O cartao inteiro arrasta; o botao cuida apenas da selecao. Separar os papeis evita
        disputar `aria-pressed` com o dnd-kit, que o usa para anunciar o estado de arraste —
        sobrescreve-lo faria o leitor de tela descrever arraste como selecao.
      */}
      <button
        type="button"
        onClick={onToggle}
        className="flex h-32 cursor-grab items-center justify-center overflow-hidden rounded active:cursor-grabbing"
        aria-pressed={selected}
        aria-label={accessibleLabel}
      >
        <PageThumbnail
          documentId={item.source}
          pageIndex={item.pageIndex}
          rotate={item.rotate}
          fileName={fileName}
        />
      </button>

      {matched && (
        <span
          className="pointer-events-none absolute top-1 right-1 rounded-full bg-amber-400 p-1 text-amber-950"
          title={t('workspace.pageMatches')}
          data-testid="match-badge"
        >
          <Search className="size-3" aria-hidden="true" />
        </span>
      )}

      {/*
        Procedencia sempre visivel, e nao so quando a miniatura falha.
        Sao dois numeros diferentes e ambos importam: `position` e o lugar na montagem final,
        `p. N` e a pagina no arquivo de onde ela veio. Numa montagem com varios PDFs, so o
        primeiro nao permite achar a pagina original.
      */}
      <span
        className="w-full truncate text-[10px] leading-tight text-neutral-500"
        data-testid="page-origin"
        title={origem}
      >
        {origem}
      </span>

      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-xs text-neutral-500 tabular-nums" title={label}>
          {position}
        </span>

        {/*
          Acoes diretas, sem exigir selecao previa.

          Visiveis sempre no celular e so no hover/foco a partir de `md`. Esconder atras do
          hover num aparelho de toque as tornaria inalcancaveis — nao existe "passar o mouse"
          la, e era justamente no celular que faltava um caminho para reordenar.

          Elas quebram linha porque sao seis num cartao de ~9rem: forcar tudo numa linha
          espremeria os alvos de toque abaixo do tamanho utilizavel.
        */}
        <div className="flex flex-wrap justify-end gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={!canMoveBack}
            aria-label={t('action.moveBack')}
            title={t('action.moveBack')}
            data-testid="move-back"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={!canMoveForward}
            aria-label={t('action.moveForward')}
            title={t('action.moveForward')}
            data-testid="move-forward"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRotate(-90)}
            aria-label={t('action.rotateLeft')}
            title={t('action.rotateLeft')}
          >
            <RotateCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRotate(90)}
            aria-label={t('action.rotateRight')}
            title={t('action.rotateRight')}
          >
            <RotateCw />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            aria-label={t('action.duplicate')}
            title={t('action.duplicate')}
          >
            <Copy />
          </Button>
          <Button
            variant="danger"
            size="icon"
            onClick={onRemove}
            aria-label={t('action.delete')}
            title={t('action.delete')}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  );
}
