'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Scissors } from 'lucide-react';
import { useTranslation, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { packVolumes, volumeNames } from 'pdf-core';
import { toPageRefs } from '@/workspace/model';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import type { SplitMode } from '@/workers/documents-protocol';
import { WorkspaceShell } from './workspace-shell';
import { useGeneration, type Generation } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { getTool } from '@/tools/registry';
import { usePageSpec, type PageSpec } from '@/workspace/page-spec';
import { PageRangeField } from './page-range-field';

type ModeId = Exclude<SplitMode['kind'], 'extract'>;

interface ModeOption {
  readonly id: ModeId;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
}

/**
 * Cada modo produz um resultado diferente, entao o nome diz o resultado, nao a tecnica.
 *
 * Recortar para um arquivo so nao esta aqui: virou a ferramenta "Extrair". Dividir sempre
 * entrega varios arquivos — e por isso sempre entrega um pacote.
 */
const MODES = [
  { id: 'ranges', labelKey: 'split.mode.ranges', hintKey: 'split.mode.ranges.hint' },
  { id: 'size', labelKey: 'split.mode.size', hintKey: 'split.mode.size.hint' },
] as const satisfies readonly ModeOption[];

const MEGABYTE = 1024 * 1024;

interface SplitState {
  readonly mode: ModeId;
  readonly setMode: (mode: ModeId) => void;
  readonly pageSpec: PageSpec;
  readonly sizeMb: string;
  readonly setSizeMb: (value: string) => void;
  readonly volumes: number;
  readonly oversizedPages: readonly number[];
  readonly generation: Generation;
  readonly run: () => void;
  readonly canRun: boolean;
}

const SplitContext = createContext<SplitState | null>(null);

function useSplit(): SplitState {
  const state = useContext(SplitContext);
  if (state === null) throw new Error('SplitProvider ausente');
  return state;
}

function SplitProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);

  const [mode, setMode] = useState<ModeId>('ranges');
  const pageSpec = usePageSpec();
  const [sizeMb, setSizeMb] = useState('1');
  /** Quantidade de volumes do ultimo pacote. Os bytes ficam com a geracao. */
  const [volumes, setVolumes] = useState(0);
  const [oversizedPages, setOversizedPages] = useState<readonly number[]>([]);
  const generation = useGeneration();

  const megabytes = Number(sizeMb);
  const canRun =
    services !== null &&
    items.length > 0 &&
    !generation.running &&
    (mode === 'size' ? Number.isFinite(megabytes) && megabytes > 0 : pageSpec.indices.length > 0);

  const run = useCallback(() => {
    if (services === null || !canRun) return;

    /*
     * Cada faixa vira um arquivo, e por isso aqui se usa `resolvedSpec`: `1-3, 4-6` precisa
     * continuar sendo duas faixas, enquanto a selecao — que e um conjunto — as fundiria numa
     * so. Quando a escolha vem de clicar na grade, `resolvedSpec` ja e a selecao formatada.
     */
    const selected: SplitMode =
      mode === 'size'
        ? { kind: 'size', maxBytes: Math.round(megabytes * MEGABYTE) }
        : { kind: mode, spec: pageSpec.resolvedSpec };

    setVolumes(0);
    setOversizedPages([]);

    generation.run({
      suggestedName: 'pdfkitty-dividido.zip',
      /*
       * Dividir e a unica operacao que produz varios arquivos, e era isso que a mantinha como
       * a excecao da interface. Empacotar devolve a divisao ao mesmo fluxo das outras: uma
       * pergunta de nome, um destino, um arquivo.
       *
       * Os nomes dos volumes saem do nome que o usuario escolheu — `contrato.zip` produz
       * `contrato-1.pdf`, `contrato-2.pdf` —, para que continuem reconheciveis depois de
       * descompactados.
       */
      produce: async (_report, fileName) => {
        const resultado = await services.documents.splitComposition(toPageRefs(items), selected);

        setVolumes(resultado.volumes.length);
        setOversizedPages(resultado.oversizedPages);

        const nomes = volumeNames(fileName, resultado.volumes.length);
        return packVolumes(
          resultado.volumes.map((bytes, indice) => ({
            name: nomes[indice] ?? `${indice + 1}.pdf`,
            bytes,
          })),
        );
      },
    });
  }, [services, canRun, mode, pageSpec.resolvedSpec, megabytes, items, generation]);

  const value = useMemo<SplitState>(
    () => ({
      mode,
      setMode,
      pageSpec,
      sizeMb,
      setSizeMb,
      volumes,
      oversizedPages,
      generation,
      run,
      canRun,
    }),
    [mode, pageSpec, sizeMb, volumes, oversizedPages, generation, run, canRun],
  );

  return <SplitContext.Provider value={value}>{children}</SplitContext.Provider>;
}

function SplitPanel() {
  const { t } = useTranslation();
  const split = useSplit();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('split.mode')}
      </h2>

      <div role="radiogroup" aria-label={t('split.mode')} className="flex flex-col gap-1">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={split.mode === option.id}
            onClick={() => split.setMode(option.id)}
            data-testid={`mode-${option.id}`}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-sm transition-colors',
              split.mode === option.id
                ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800',
            )}
          >
            <span className="font-medium">{t(option.labelKey)}</span>
            <span className="block text-xs text-neutral-500">{t(option.hintKey)}</span>
          </button>
        ))}
      </div>

      {/* Cada modo mostra so o campo que usa: opcao irrelevante visivel e ruido. */}
      {split.mode === 'size' ? (
        <label className="flex flex-col gap-1 text-sm">
          {t('split.size.label')}
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={split.sizeMb}
            onChange={(event) => split.setSizeMb(event.target.value)}
            data-testid="size-input"
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 tabular-nums dark:border-neutral-700"
          />
        </label>
      ) : (
        <PageRangeField
          pageSpec={split.pageSpec}
          labelKey="split.ranges.label"
          testId="ranges-input"
        />
      )}

      {split.generation.error !== null && (
        <p
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
          data-testid="split-error"
        >
          {split.generation.error}
        </p>
      )}

      <h2 className="mt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('split.result')}
      </h2>

      {split.volumes === 0 ? (
        <p className="text-sm text-neutral-500">{t('split.noResult')}</p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="split-results">
          <p className="text-sm">{t('split.packed', { count: split.volumes })}</p>
          {split.oversizedPages.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="oversized">
              {t('split.oversized', {
                pages: split.oversizedPages.map((page) => page + 1).join(', '),
              })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SplitAction() {
  const split = useSplit();

  return (
    <GenerationAction
      generation={split.generation}
      icon={Scissors}
      labelKey="split.run"
      runningLabelKey="split.running"
      disabled={!split.canRun}
      testId="split-run"
      onRun={split.run}
    />
  );
}

export function SplitTool() {
  return (
    // O provedor de servicos vem por fora: o SplitProvider consome os workers, entao
    // precisa estar dentro dele.
    <WorkspaceServicesProvider>
      <SplitProvider>
        <WorkspaceShell
          titleKey={getTool('dividir').nameKey}
          panel={<SplitPanel />}
          action={<SplitAction />}
        />
      </SplitProvider>
    </WorkspaceServicesProvider>
  );
}
