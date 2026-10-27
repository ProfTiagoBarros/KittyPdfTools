'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RotateCcw,
  RotateCw,
  Search,
  Trash2,
  ZoomIn,
} from 'lucide-react';
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
  /** A ocorrencia em foco na navegacao da busca. */
  readonly currentMatch: boolean;
  readonly canMoveBack: boolean;
  readonly canMoveForward: boolean;
  /** -1 move uma posicao para tras, +1 para a frente. */
  readonly onMove: (delta: number) => void;
  readonly onToggle: () => void;
  /** Abre a visualizacao rapida desta pagina. */
  readonly onPreview: () => void;
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
  currentMatch,
  canMoveBack,
  canMoveForward,
  onMove,
  onToggle,
  onPreview,
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
        'group relative flex flex-col gap-2 rounded-lg border border-neutral-200 p-2 transition-colors dark:border-neutral-800',
        // A busca e dona do contorno; a selecao e o circulo verde. Antes as duas eram bordas, e
        // uma pagina selecionada que tambem continha o termo nao dizia qual das duas coisas era.
        matched && 'bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-950/30',
        currentMatch && 'ring-4 ring-amber-500',
        isDragging && 'z-10 opacity-60',
      )}
      data-testid="page-card"
      data-page-key={item.key}
      data-rotate={item.rotate}
      data-selected={selected}
      data-matched={matched}
      data-current-match={currentMatch}
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
        data-testid="select-page"
        className="relative flex h-32 cursor-grab items-center justify-center overflow-hidden rounded active:cursor-grabbing"
        aria-pressed={selected}
        aria-label={accessibleLabel}
      >
        <PageThumbnail
          documentId={item.source}
          pageIndex={item.pageIndex}
          rotate={item.rotate}
          fileName={fileName}
        />

        {/*
          Selecao: circulo verde no canto inferior esquerdo, com 1/3 da largura da pagina.
          Grande de proposito — numa grade de centenas de paginas, e o que se procura de longe.
          O visto dentro dele diz "selecionada" a quem nao distingue o verde; o estado em si
          vai ao leitor de tela pelo `aria-pressed` do botao.
        */}
        {selected && (
          <span
            aria-hidden="true"
            data-testid="selected-mark"
            className="pointer-events-none absolute bottom-1 left-1 flex aspect-square w-1/3 items-center justify-center rounded-full bg-green-600 text-white shadow-md"
          >
            <Check className="size-1/2" strokeWidth={3} />
          </span>
        )}
      </button>

      {/*
        A lupa fica SOBRE a miniatura, e nao na fila de acoes.

        Medido no aparelho: como setimo icone de 32px ela reprovava como alvo de toque, e e
        justamente a pergunta que se faz antes de qualquer acao — "que pagina e esta?". Aqui
        ela tem 44px, o minimo praticavel para o dedo, e nao disputa espaco com as outras seis.

        `stopPropagation` no ponteiro porque o cartao inteiro e alca de arraste: sem isso, um
        toque um pouco mais longo viraria drag em vez de abrir a pagina.
      */}
      <Button
        variant="outline"
        onClick={onPreview}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={t('action.preview')}
        title={t('action.preview')}
        data-testid="preview-open"
        className="absolute top-3 right-3 z-10 h-11 w-11 rounded-full p-0 shadow-sm"
      >
        <ZoomIn />
      </Button>

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
