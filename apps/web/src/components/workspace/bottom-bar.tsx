'use client';

import type { ReactNode } from 'react';
import { CheckSquare, Redo2, Square, Undo2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/workspace/store';

interface BottomBarProps {
  /** Acao principal da ferramenta ativa: exportar, dividir, assinar. */
  readonly children: ReactNode;
}

export function BottomBar({ children }: BottomBarProps) {
  const { t } = useTranslation();
  const items = useWorkspaceStore((state) => state.items);
  const selection = useWorkspaceStore((state) => state.selection);
  const past = useWorkspaceStore((state) => state.past);
  const future = useWorkspaceStore((state) => state.future);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const selectAll = useWorkspaceStore((state) => state.selectAll);
  const clearSelection = useWorkspaceStore((state) => state.clearSelection);

  const allSelected = items.length > 0 && selection.length === items.length;

  /*
   * O respiro extra embaixo e a barra de navegacao do Android.
   *
   * Com `viewport-fit=cover` (definido no layout raiz) a janela vai ate a borda fisica da
   * tela, entao a barra grudada em `bottom-0` cai atras dos botoes do sistema: o usuario ve
   * o CTA e nao consegue toca-lo. `env(safe-area-inset-bottom)` vale 0 onde nao ha inset,
   * entao o desktop nao muda.
   */
  return (
    <div
      className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-white/90 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90"
      data-testid="bottom-bar"
    >
      <span className="text-sm tabular-nums" data-testid="total-pages">
        {t('bottom.totalPages', { count: items.length })}
      </span>

      {selection.length > 0 && (
        <span className="text-sm text-neutral-500 tabular-nums" data-testid="selected-pages">
          {t('bottom.selected', { count: selection.length })}
        </span>
      )}

      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          onClick={allSelected ? clearSelection : selectAll}
          disabled={items.length === 0}
        >
          {allSelected ? <Square /> : <CheckSquare />}
          {allSelected ? t('action.clearSelection') : t('action.selectAll')}
        </Button>

        <Button
          size="sm"
          onClick={undo}
          disabled={past.length === 0}
          aria-label={t('action.undo')}
          title={t('action.undo')}
        >
          <Undo2 />
        </Button>
        <Button
          size="sm"
          onClick={redo}
          disabled={future.length === 0}
          aria-label={t('action.redo')}
          title={t('action.redo')}
        >
          <Redo2 />
        </Button>

        {children}
      </div>
    </div>
  );
}
