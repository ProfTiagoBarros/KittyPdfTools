'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ScanText } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import type { OcrResult } from '@/workers/render-client';
import { WorkspaceShell } from './workspace-shell';
import { useGeneration, type Generation } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { getTool } from '@/tools/registry';

interface OcrState {
  readonly skipWithText: boolean;
  readonly setSkipWithText: (value: boolean) => void;
  /** Metadados do reconhecimento. Os bytes ficam com a geracao, nao aqui. */
  readonly result: OcrResult | null;
  readonly generation: Generation;
  readonly run: () => void;
  readonly canRun: boolean;
  readonly selectedCount: number;
}

const OcrContext = createContext<OcrState | null>(null);

function useOcr(): OcrState {
  const state = useContext(OcrContext);
  if (state === null) throw new Error('OcrProvider ausente');
  return state;
}

function OcrProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const documents = useWorkspaceStore((state) => state.documents);
  const items = useWorkspaceStore((state) => state.items);
  const selection = useWorkspaceStore((state) => state.selection);

  const [skipWithText, setSkipWithText] = useState(true);
  const [result, setResult] = useState<OcrResult | null>(null);
  const generation = useGeneration();

  /**
   * O OCR age sobre um documento aberto, nao sobre a composicao: a camada invisivel precisa
   * das paginas originais, que sao o que o worker de renderizacao mantem aberto.
   */
  const documentId = documents[0]?.id;

  const selectedPages = useMemo(() => {
    const chosen = new Set(selection);
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => chosen.has(item.key) && item.source === documentId)
      .map(({ item }) => item.pageIndex);
  }, [items, selection, documentId]);

  const canRun = services !== null && documentId !== undefined && !generation.running;

  const run = useCallback(() => {
    if (services === null || documentId === undefined) return;

    setResult(null);
    generation.run({
      suggestedName: 'pdfkitty-pesquisavel.pdf',
      produce: async (report) => {
        const reconhecido = await services.render.ocr(documentId, {
          pageIndexes: selectedPages,
          skipPagesWithText: skipWithText,
          onProgress: (completed, total) => report(total === 0 ? 0 : completed / total),
        });
        // Os metadados alimentam o painel; os bytes seguem para a gravacao.
        setResult(reconhecido);
        return reconhecido.pdf;
      },
    });
  }, [services, documentId, generation, selectedPages, skipWithText]);

  const value = useMemo<OcrState>(
    () => ({
      skipWithText,
      setSkipWithText,
      result,
      generation,
      run,
      canRun,
      selectedCount: selectedPages.length,
    }),
    [skipWithText, result, generation, run, canRun, selectedPages.length],
  );

  return <OcrContext.Provider value={value}>{children}</OcrContext.Provider>;
}

function OcrPanel() {
  const { t } = useTranslation();
  const ocr = useOcr();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('ocr.title')}
      </h2>

      <p className="text-sm text-neutral-500">{t('ocr.description')}</p>
      <p className="text-sm">{t('ocr.language')}</p>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ocr.skipWithText}
          onChange={(event) => ocr.setSkipWithText(event.target.checked)}
          data-testid="skip-with-text"
          className="mt-1"
        />
        <span>
          {t('ocr.skipWithText')}
          <span className="block text-xs text-neutral-500">{t('ocr.skipWithText.hint')}</span>
        </span>
      </label>

      <p className="text-sm text-neutral-500" data-testid="ocr-scope">
        {ocr.selectedCount > 0
          ? t('ocr.scopeSelection', { count: ocr.selectedCount })
          : t('ocr.scopeAll')}
      </p>

      {ocr.generation.error !== null && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="ocr-error">
          {ocr.generation.error}
        </p>
      )}

      <h2 className="mt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('ocr.result')}
      </h2>

      {ocr.result === null ? (
        <p className="text-sm text-neutral-500">{t('ocr.noResult')}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm" data-testid="ocr-result">
          <p>{t('ocr.recognized', { count: ocr.result.recognizedPages.length })}</p>
          {ocr.result.skippedPages.length > 0 && (
            <p className="text-neutral-500" data-testid="ocr-skipped">
              {t('ocr.skipped', { count: ocr.result.skippedPages.length })}
            </p>
          )}
          <p className="text-neutral-500">{t('ocr.words', { count: ocr.result.wordsWritten })}</p>
          {ocr.result.wordsSkipped > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {t('ocr.wordsDropped', { count: ocr.result.wordsSkipped })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function OcrAction() {
  const ocr = useOcr();

  return (
    <GenerationAction
      generation={ocr.generation}
      icon={ScanText}
      labelKey="ocr.run"
      runningLabelKey="ocr.running"
      disabled={!ocr.canRun}
      testId="ocr-run"
      onRun={ocr.run}
    />
  );
}

export function OcrTool() {
  return (
    <WorkspaceServicesProvider>
      <OcrProvider>
        <WorkspaceShell
          titleKey={getTool('ocr').nameKey}
          panel={<OcrPanel />}
          action={<OcrAction />}
        />
      </OcrProvider>
    </WorkspaceServicesProvider>
  );
}
