'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useTranslation, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { toPageRefs } from '@/workspace/model';
import { usePageSpec, type PageSpec } from '@/workspace/page-spec';
import { useWorkspaceStore } from '@/workspace/store';
import {
  usePageMemoryRelease,
  useWorkspaceServices,
  WorkspaceServicesProvider,
} from '@/workspace/services';
import { useGeneration, type Generation } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { PageRangeField } from './page-range-field';
import { WorkspaceShell } from './workspace-shell';
import { getTool } from '@/tools/registry';

type PageChoice = 'all' | 'some';

interface ChoiceOption {
  readonly id: PageChoice;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
}

const CHOICES = [
  { id: 'all', labelKey: 'merge.pages.all', hintKey: 'merge.pages.all.hint' },
  { id: 'some', labelKey: 'merge.pages.some', hintKey: 'merge.pages.some.hint' },
] as const satisfies readonly ChoiceOption[];

interface MergeState {
  readonly choice: PageChoice;
  readonly setChoice: (choice: PageChoice) => void;
  readonly pageSpec: PageSpec;
  readonly generation: Generation;
  readonly run: () => void;
  readonly canRun: boolean;
}

const MergeContext = createContext<MergeState | null>(null);

function useMerge(): MergeState {
  const state = useContext(MergeContext);
  if (state === null) throw new Error('MergeProvider ausente');
  return state;
}

/**
 * Unir e extrair sao a mesma operacao: montar UM PDF a partir das paginas da grade.
 *
 * Eram duas ferramentas, e a diferenca entre elas era so quais paginas entravam. A escolha e
 * EXPLICITA de proposito: a selecao da grade tambem serve para girar e excluir em lote, e quem
 * seleciona tres paginas para gira-las nao pode receber um PDF de tres paginas. "Todas" e o
 * padrao; menos paginas, so quando o usuario pede.
 */
function MergeProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);
  const [choice, setChoice] = useState<PageChoice>('all');
  const pageSpec = usePageSpec();
  const generation = useGeneration();
  // Solta as paginas da renderizacao enquanto o pdf-lib monta o resultado.
  const pageMemory = usePageMemoryRelease();

  const canRun =
    services !== null &&
    items.length > 0 &&
    !generation.running &&
    (choice === 'all' || pageSpec.indices.length > 0);

  const run = useCallback(() => {
    if (services === null || !canRun) return;
    const pages = toPageRefs(items);

    generation.run({
      suggestedName: choice === 'all' ? 'pdfkitty.pdf' : 'pdfkitty-extraido.pdf',
      ...(pageMemory === undefined ? {} : { around: pageMemory }),
      // Compor nao sabe estimar o quanto falta: a interface mostra atividade, sem porcentagem,
      // em vez de uma barra fingindo saber.
      produce: async () =>
        choice === 'all'
          ? services.documents.compose(pages)
          : // `resolvedSpec` e sempre valido: os estados intermediarios da digitacao nunca
            // chegam ao worker.
            services.documents.extractComposition(pages, pageSpec.resolvedSpec),
    });
  }, [services, canRun, items, choice, pageSpec.resolvedSpec, generation, pageMemory]);

  const value = useMemo<MergeState>(
    () => ({ choice, setChoice, pageSpec, generation, run, canRun }),
    [choice, pageSpec, generation, run, canRun],
  );

  return <MergeContext.Provider value={value}>{children}</MergeContext.Provider>;
}

function MergePanel() {
  const { t } = useTranslation();
  const merge = useMerge();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('merge.pages')}
      </h2>

      <div role="radiogroup" aria-label={t('merge.pages')} className="flex flex-col gap-1">
        {CHOICES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={merge.choice === option.id}
            onClick={() => merge.setChoice(option.id)}
            data-testid={`pages-${option.id}`}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-sm transition-colors',
              merge.choice === option.id
                ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800',
            )}
          >
            <span className="font-medium">{t(option.labelKey)}</span>
            <span className="block text-xs text-neutral-500">{t(option.hintKey)}</span>
          </button>
        ))}
      </div>

      {/* O campo so aparece quando decide algo: com "todas", ele nao muda o resultado. */}
      {merge.choice === 'some' && (
        <PageRangeField
          pageSpec={merge.pageSpec}
          labelKey="merge.pages.label"
          testId="extract-ranges-input"
        />
      )}

      {merge.generation.error !== null && (
        <p
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
          data-testid="merge-error"
        >
          {merge.generation.error}
        </p>
      )}
    </section>
  );
}

function MergeAction() {
  const merge = useMerge();

  return (
    <GenerationAction
      generation={merge.generation}
      icon={Download}
      labelKey={merge.choice === 'all' ? 'action.export' : 'merge.extract'}
      runningLabelKey="action.exporting"
      disabled={!merge.canRun}
      testId="export"
      onRun={merge.run}
    />
  );
}

export function OrganizeTool() {
  return (
    <WorkspaceServicesProvider>
      <MergeProvider>
        <WorkspaceShell
          titleKey={getTool('unir').nameKey}
          panel={<MergePanel />}
          action={<MergeAction />}
        />
      </MergeProvider>
    </WorkspaceServicesProvider>
  );
}
