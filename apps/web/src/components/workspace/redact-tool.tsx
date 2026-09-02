'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Trash2, X } from 'lucide-react';
import type { Rect } from 'pdf-core';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import { WorkspaceShell } from './workspace-shell';
import { useGeneration, type Generation } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { PageViewer } from './page-viewer';
import { PageThumbnail } from './page-thumbnail';
import { getTool } from '@/tools/registry';

/** Regiões marcadas por página, em espaço de usuário do PDF. */
type MarksByPage = ReadonlyMap<number, readonly Rect[]>;

interface RedactState {
  readonly documentId: string | undefined;
  readonly pageCount: number;
  readonly currentPage: number;
  readonly setCurrentPage: (pageIndex: number) => void;
  readonly marks: MarksByPage;
  readonly addMark: (pageIndex: number, rect: Rect) => void;
  readonly removeMark: (pageIndex: number, index: number) => void;
  readonly clearMarks: () => void;
  readonly totalMarks: number;
  readonly markedPages: number;
  readonly confirming: boolean;
  readonly setConfirming: (value: boolean) => void;
  readonly generation: Generation;
  readonly run: () => void;
}

const RedactContext = createContext<RedactState | null>(null);

function useRedact(): RedactState {
  const state = useContext(RedactContext);
  if (state === null) throw new Error('RedactProvider ausente');
  return state;
}

function RedactProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const documents = useWorkspaceStore((state) => state.documents);

  // A ofuscação age sobre o documento aberto, não sobre a composição: rasterizar exige a
  // página original, que é o que o worker de renderização mantém aberto.
  const document = documents[0];
  const documentId = document?.id;

  const [currentPage, setCurrentPage] = useState(0);
  const [marks, setMarks] = useState<MarksByPage>(new Map());
  const [confirming, setConfirming] = useState(false);
  const generation = useGeneration();

  const addMark = useCallback((pageIndex: number, rect: Rect) => {
    setMarks((current) => {
      const next = new Map(current);
      next.set(pageIndex, [...(current.get(pageIndex) ?? []), rect]);
      return next;
    });
  }, []);

  const removeMark = useCallback((pageIndex: number, index: number) => {
    setMarks((current) => {
      const next = new Map(current);
      const remaining = (current.get(pageIndex) ?? []).filter((_unused, at) => at !== index);
      if (remaining.length === 0) next.delete(pageIndex);
      else next.set(pageIndex, remaining);
      return next;
    });
  }, []);

  const clearMarks = useCallback(() => setMarks(new Map()), []);

  const totalMarks = useMemo(
    () => [...marks.values()].reduce((total, list) => total + list.length, 0),
    [marks],
  );

  const run = useCallback(() => {
    if (services === null || documentId === undefined || totalMarks === 0) return;

    const areas = [...marks.entries()].flatMap(([pageIndex, list]) =>
      list.map((rect) => ({ pageIndex, rect })),
    );

    setConfirming(false);
    generation.run({
      suggestedName: 'pdfkitty-ofuscado.pdf',
      // A ofuscacao rasteriza pagina a pagina e sabe informar o quanto falta — a Regra de
      // Ouro 2 exige esse relato para operacoes longas.
      produce: async (report) =>
        services.render.redact(documentId, areas, {
          onProgress: (completed, total) => report(total === 0 ? 0 : completed / total),
        }),
    });
  }, [services, documentId, marks, totalMarks, generation]);

  const value = useMemo<RedactState>(
    () => ({
      documentId,
      pageCount: document?.pageCount ?? 0,
      currentPage,
      setCurrentPage,
      marks,
      addMark,
      removeMark,
      clearMarks,
      totalMarks,
      markedPages: marks.size,
      confirming,
      setConfirming,
      generation,
      run,
    }),
    [
      documentId,
      document?.pageCount,
      currentPage,
      marks,
      addMark,
      removeMark,
      clearMarks,
      totalMarks,
      confirming,
      generation,
      run,
    ],
  );

  return <RedactContext.Provider value={value}>{children}</RedactContext.Provider>;
}

/** Faixa de navegação entre páginas. Substitui a grade, que aqui não precisa arrastar. */
function PageStrip() {
  const { t } = useTranslation();
  const redact = useRedact();
  const documents = useWorkspaceStore((state) => state.documents);

  if (redact.documentId === undefined) return null;

  const fileName =
    documents.find((document) => document.id === redact.documentId)?.name ?? redact.documentId;

  return (
    <nav
      aria-label={t('redact.pages')}
      className="flex w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800"
    >
      {Array.from({ length: redact.pageCount }, (_unused, pageIndex) => (
        <button
          key={pageIndex}
          type="button"
          onClick={() => redact.setCurrentPage(pageIndex)}
          aria-current={pageIndex === redact.currentPage ? 'true' : undefined}
          data-testid="strip-page"
          data-page-index={pageIndex}
          className={cn(
            'flex flex-col items-center gap-1 rounded-md border p-1 text-xs transition-colors',
            pageIndex === redact.currentPage
              ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
              : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800',
          )}
        >
          <span className="flex h-20 items-center justify-center overflow-hidden">
            <PageThumbnail
              documentId={redact.documentId!}
              pageIndex={pageIndex}
              rotate={0}
              fileName={fileName}
            />
          </span>
          <span className="tabular-nums">
            {pageIndex + 1}
            {(redact.marks.get(pageIndex)?.length ?? 0) > 0 && ' •'}
          </span>
        </button>
      ))}
    </nav>
  );
}

function RedactMain() {
  const { t } = useTranslation();
  const redact = useRedact();

  if (redact.documentId === undefined) {
    return (
      <p className="flex flex-1 items-center justify-center p-8 text-sm text-neutral-500">
        {t('workspace.empty')}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <PageStrip />
      <PageViewer
        // Remontar ao trocar de pagina descarta o estado anterior sem precisar zera-lo
        // dentro de um efeito, o que dispararia render em cascata.
        key={`${redact.documentId}:${redact.currentPage}`}
        documentId={redact.documentId}
        pageIndex={redact.currentPage}
        marks={redact.marks.get(redact.currentPage) ?? []}
        onAddMark={(rect) => redact.addMark(redact.currentPage, rect)}
      />
    </div>
  );
}

function RedactPanel() {
  const { t } = useTranslation();
  const redact = useRedact();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('redact.title')}
      </h2>
      <p className="text-sm text-neutral-500">{t('redact.description')}</p>

      <h2 className="mt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('redact.marks')}
      </h2>

      {redact.totalMarks === 0 ? (
        <p className="text-sm text-neutral-500">{t('redact.noMarks')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1" data-testid="mark-list">
            {[...redact.marks.entries()].map(([pageIndex, list]) =>
              list.map((_rect, index) => (
                <li
                  key={`${pageIndex}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-800"
                >
                  <span className="truncate tabular-nums">
                    {t('redact.markLabel', { page: pageIndex + 1, index: index + 1 })}
                  </span>
                  <Button
                    size="icon"
                    variant="danger"
                    onClick={() => redact.removeMark(pageIndex, index)}
                    aria-label={t('redact.removeMark', { page: pageIndex + 1, index: index + 1 })}
                  >
                    <X />
                  </Button>
                </li>
              )),
            )}
          </ul>
          <Button size="sm" variant="danger" onClick={redact.clearMarks} data-testid="clear-marks">
            <Trash2 />
            {t('redact.clear')}
          </Button>
        </>
      )}

      {redact.generation.error !== null && (
        <p
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
          data-testid="redact-error"
        >
          {redact.generation.error}
        </p>
      )}

      {redact.generation.last !== null && (
        <div className="flex flex-col gap-2" data-testid="redact-result">
          <p className="text-sm">{t('redact.done', { pages: redact.markedPages })}</p>
        </div>
      )}
    </section>
  );
}

/**
 * Confirmação antes de executar.
 *
 * Duas perdas irreversíveis acontecem aqui: o conteúdo apagado não volta, e as páginas
 * afetadas viram imagem e deixam de ser pesquisáveis. O usuário precisa saber disso antes de
 * clicar, não ao abrir o resultado.
 */
function ConfirmDialog() {
  const { t } = useTranslation();
  const redact = useRedact();
  // Sem guarda de montagem: o dialogo so aparece depois de o usuario clicar, entao nunca
  // e renderizado durante a geracao estatica, onde `document` nao existe.
  if (!redact.confirming) return null;

  // Portal para o body de proposito: a barra inferior usa `backdrop-blur`, e um filtro de
  // fundo cria bloco de contencao — um `fixed` dentro dela se posicionaria em relacao a
  // barra, e nao a janela, jogando o dialogo para fora da tela.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="redact-confirm-title"
        data-testid="redact-confirm"
        className="flex max-w-md flex-col gap-3 rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-900"
      >
        <h2 id="redact-confirm-title" className="text-lg font-semibold">
          {t('redact.confirm.title')}
        </h2>

        <p className="text-sm">
          {t('redact.confirm.regions', {
            regions: redact.totalMarks,
            pages: redact.markedPages,
          })}
        </p>
        <p className="text-sm text-red-700 dark:text-red-400">{t('redact.confirm.irreversible')}</p>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('redact.confirm.rasterized')}
        </p>
        <p className="text-sm text-neutral-500">{t('redact.confirm.ocrHint')}</p>

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => redact.setConfirming(false)} data-testid="redact-cancel">
            {t('redact.confirm.cancel')}
          </Button>
          <Button variant="primary" onClick={redact.run} data-testid="redact-accept">
            {t('redact.confirm.accept')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RedactAction() {
  const redact = useRedact();

  return (
    <>
      <ConfirmDialog />
      <GenerationAction
        generation={redact.generation}
        icon={Eraser}
        labelKey="redact.run"
        runningLabelKey="redact.running"
        disabled={redact.totalMarks === 0}
        testId="redact-run"
        // A confirmacao vem antes: ofuscar e irreversivel, e o dialogo diz as duas perdas.
        onRun={() => redact.setConfirming(true)}
      />
    </>
  );
}

export function RedactTool() {
  return (
    <WorkspaceServicesProvider>
      <RedactProvider>
        <WorkspaceShell
          titleKey={getTool('ofuscar').nameKey}
          main={<RedactMain />}
          panel={<RedactPanel />}
          action={<RedactAction />}
        />
      </RedactProvider>
    </WorkspaceServicesProvider>
  );
}
