'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { FileOutput } from 'lucide-react';
import { useTranslation } from '@/i18n';
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

interface ExtractState {
  readonly pageSpec: PageSpec;
  readonly generation: Generation;
  readonly run: () => void;
  readonly canRun: boolean;
}

const ExtractContext = createContext<ExtractState | null>(null);

function useExtract(): ExtractState {
  const state = useContext(ExtractContext);
  if (state === null) throw new Error('ExtractProvider ausente');
  return state;
}

/**
 * Recortar paginas para um arquivo so.
 *
 * Vive fora de "Dividir" de proposito. Eram dois resultados diferentes — um documento contra
 * varios — servidos pela mesma tela, com a escolha escondida num grupo de opcoes; quem
 * selecionava paginas e clicava em "Extrair" so trocava de modo, e nada acontecia. Separadas,
 * cada ferramenta tem um botao com um resultado, dito pelo nome.
 */
function ExtractProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);
  const pageSpec = usePageSpec();
  const generation = useGeneration();
  // Solta as paginas da renderizacao enquanto o pdf-lib monta o resultado.
  const pageMemory = usePageMemoryRelease();

  const canRun =
    services !== null && items.length > 0 && !generation.running && pageSpec.indices.length > 0;

  const run = useCallback(() => {
    if (services === null || !canRun) return;

    generation.run({
      suggestedName: 'pdfkitty-extraido.pdf',
      ...(pageMemory === undefined ? {} : { around: pageMemory }),
      /*
       * `resolvedSpec` e sempre valido: enquanto se digita, o campo passa por estados que
       * ainda nao descrevem paginas, e nenhum deles pode chegar ao worker.
       */
      produce: async () =>
        services.documents.extractComposition(toPageRefs(items), pageSpec.resolvedSpec),
    });
  }, [services, canRun, pageSpec.resolvedSpec, items, generation, pageMemory]);

  const value = useMemo<ExtractState>(
    () => ({ pageSpec, generation, run, canRun }),
    [pageSpec, generation, run, canRun],
  );

  return <ExtractContext.Provider value={value}>{children}</ExtractContext.Provider>;
}

function ExtractPanel() {
  const { t } = useTranslation();
  const extract = useExtract();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('extract.pages')}
      </h2>

      <PageRangeField
        pageSpec={extract.pageSpec}
        labelKey="extract.pages.label"
        testId="extract-ranges-input"
      />

      <p className="text-sm text-neutral-500">{t('extract.explanation')}</p>

      {extract.generation.error !== null && (
        <p
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
          data-testid="extract-error"
        >
          {extract.generation.error}
        </p>
      )}
    </section>
  );
}

function ExtractAction() {
  const extract = useExtract();

  return (
    <GenerationAction
      generation={extract.generation}
      icon={FileOutput}
      labelKey="extract.run"
      runningLabelKey="extract.running"
      disabled={!extract.canRun}
      testId="extract-run"
      onRun={extract.run}
    />
  );
}

export function ExtractTool() {
  return (
    <WorkspaceServicesProvider>
      <ExtractProvider>
        <WorkspaceShell
          titleKey={getTool('extrair').nameKey}
          panel={<ExtractPanel />}
          action={<ExtractAction />}
        />
      </ExtractProvider>
    </WorkspaceServicesProvider>
  );
}
