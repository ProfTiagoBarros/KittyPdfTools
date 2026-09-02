'use client';

import type { ReactNode } from 'react';
import { Copy, RotateCcw, RotateCw, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/workspace/store';

interface PropertiesPanelProps {
  readonly onRemoveDocument: (id: string) => void;
  /** Opcoes da ferramenta ativa. Cada ferramenta traz as suas; o painel nao as conhece. */
  readonly children?: ReactNode;
}

export function PropertiesPanel({ onRemoveDocument, children }: PropertiesPanelProps) {
  const { t } = useTranslation();
  const documents = useWorkspaceStore((state) => state.documents);
  const selection = useWorkspaceStore((state) => state.selection);
  const rotate = useWorkspaceStore((state) => state.rotate);
  const duplicate = useWorkspaceStore((state) => state.duplicate);
  const remove = useWorkspaceStore((state) => state.remove);

  const hasSelection = selection.length > 0;

  return (
    <aside className="flex shrink-0 flex-col gap-6 border-neutral-200 p-4 md:w-64 md:border-l dark:border-neutral-800">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t('panel.documents')}
        </h2>

        {documents.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('workspace.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={document.name}>
                  {document.name}
                </span>
                <span className="text-xs whitespace-nowrap text-neutral-500 tabular-nums">
                  {t('panel.pageCount', { count: document.pageCount })}
                </span>
                <Button
                  variant="danger"
                  size="icon"
                  onClick={() => onRemoveDocument(document.id)}
                  aria-label={t('panel.removeDocument')}
                  title={t('panel.removeDocument')}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t('panel.title')}
        </h2>

        {/* As mesmas acoes do cartao, aqui em lote. O painel nao inventa operacoes novas. */}
        {hasSelection ? (
          <>
            <p className="text-sm" data-testid="selection-count">
              {t('panel.selectedCount', { count: selection.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => rotate(selection, -90)}>
                <RotateCcw />
                {t('action.rotateLeft')}
              </Button>
              <Button size="sm" onClick={() => rotate(selection, 90)}>
                <RotateCw />
                {t('action.rotateRight')}
              </Button>
              <Button size="sm" onClick={() => duplicate(selection)}>
                <Copy />
                {t('action.duplicate')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove(selection)}>
                <Trash2 />
                {t('action.delete')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-500">{t('panel.noSelection')}</p>
        )}
      </section>

      {children}
    </aside>
  );
}
