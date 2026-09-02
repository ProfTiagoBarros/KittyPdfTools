'use client';

import { coreErrorKey, coreErrorParams, useTranslation, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/workspace/store';
import type { PageSpec } from '@/workspace/page-spec';

interface PageRangeFieldProps {
  readonly pageSpec: PageSpec;
  readonly labelKey: MessageKey;
  readonly testId: string;
}

/**
 * Campo de intervalos amarrado a selecao da grade.
 *
 * A dica embaixo do campo nao e decoracao: e ela que conta que clicar nas miniaturas tambem
 * preenche isto aqui. Sem esse aviso, quem chega selecionando paginas na grade nao tem como
 * descobrir que os dois lados sao a mesma coisa.
 */
export function PageRangeField({ pageSpec, labelKey, testId }: PageRangeFieldProps) {
  const { t } = useTranslation();
  const total = useWorkspaceStore((state) => state.items.length);
  const selectAll = useWorkspaceStore((state) => state.selectAll);
  const clearSelection = useWorkspaceStore((state) => state.clearSelection);

  const count = pageSpec.indices.length;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex flex-col gap-1">
        {t(labelKey)}
        <input
          type="text"
          inputMode="numeric"
          value={pageSpec.spec}
          onChange={(event) => pageSpec.setSpec(event.target.value)}
          placeholder={t('pageRange.placeholder')}
          data-testid={testId}
          aria-invalid={pageSpec.error !== null}
          aria-describedby={`${testId}-hint`}
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700 aria-[invalid=true]:border-red-500"
        />
      </label>

      <p id={`${testId}-hint`} className="text-xs text-neutral-500">
        {pageSpec.error !== null ? (
          <span role="alert" className="text-red-700 dark:text-red-400" data-testid="range-invalid">
            {t(coreErrorKey(pageSpec.error), coreErrorParams(pageSpec.error))}
          </span>
        ) : count === 0 ? (
          t('pageRange.hint')
        ) : (
          t('pageRange.count', { count })
        )}
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={selectAll} disabled={total === 0} data-testid="range-select-all">
          {t('pageRange.selectAll')}
        </Button>
        <Button size="sm" onClick={clearSelection} disabled={count === 0} data-testid="range-clear">
          {t('pageRange.clear')}
        </Button>
      </div>
    </div>
  );
}
