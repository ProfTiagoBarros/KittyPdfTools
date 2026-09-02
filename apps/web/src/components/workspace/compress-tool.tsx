'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';
import { COMPRESSION_STEPS } from 'pdf-core';
import { useTranslation, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { toPageRefs } from '@/workspace/model';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import { useGeneration, type Generation } from '@/lib/generation';
import type { CompressMode } from '@/workers/render-client';
import { GenerationAction } from './generation-action';
import { WorkspaceShell } from './workspace-shell';
import { getTool } from '@/tools/registry';

type ModeId = 'lossless' | 'quality' | 'target';

/**
 * Tres degraus, e nao os sete do nucleo.
 *
 * A escada interna existe para a busca por tamanho caminhar sobre ela; oferecer sete opcoes
 * a quem so quer "menor" e transferir ao usuario uma decisao que ele nao tem como avaliar
 * sem gerar cada uma.
 */
const PRESETS = [
  { id: 'high', index: 1, labelKey: 'compress.quality.high' },
  { id: 'medium', index: 3, labelKey: 'compress.quality.medium' },
  { id: 'low', index: 5, labelKey: 'compress.quality.low' },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

const MEGABYTE = 1024 * 1024;

interface Outcome {
  readonly originalBytes: number;
  readonly finalBytes: number;
  readonly fitsTarget: boolean;
  readonly invisibleBlocksRemoved: number;
}

interface CompressState {
  readonly mode: ModeId;
  readonly setMode: (mode: ModeId) => void;
  readonly removeOcr: boolean;
  readonly setRemoveOcr: (value: boolean) => void;
  readonly preset: PresetId;
  readonly setPreset: (value: PresetId) => void;
  readonly targetMb: string;
  readonly setTargetMb: (value: string) => void;
  readonly outcome: Outcome | null;
  readonly generation: Generation;
  /** Verdadeiro nos modos que rasterizam, e portanto perdem texto. */
  readonly lossy: boolean;
  readonly confirming: boolean;
  readonly setConfirming: (value: boolean) => void;
  /** Ponto de entrada do botao: confirma primeiro quando ha perda. */
  readonly request: () => void;
  readonly run: () => void;
  readonly canRun: boolean;
}

const CompressContext = createContext<CompressState | null>(null);

function useCompress(): CompressState {
  const state = useContext(CompressContext);
  if (state === null) throw new Error('CompressProvider ausente');
  return state;
}

/** Tamanho legivel. Aproximar em MB abaixo de 1 MB esconderia o resultado de arquivos pequenos. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / MEGABYTE).toFixed(2)} MB`;
}

/**
 * Compactar (US-07).
 *
 * Nasceu de um problema concreto: PDFs com OCR ficam grandes, e sistemas de governo recusam
 * anexos acima de um limite. Duas vias, porque sao dois problemas diferentes:
 *
 * - **Sem perda** reempacota a estrutura e, se pedido, remove a camada de texto do OCR. O
 *   documento continua identico na tela; o que sai e peso de arquivo, nao qualidade.
 * - **Forte** rasteriza as paginas em JPEG. E o unico caminho que encolhe um documento
 *   digitalizado de verdade, e perde texto pesquisavel — por isso confirma antes.
 */
function CompressProvider({ children }: { children: ReactNode }) {
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);

  const [mode, setMode] = useState<ModeId>('lossless');
  const [removeOcr, setRemoveOcr] = useState(true);
  const [preset, setPreset] = useState<PresetId>('medium');
  const [targetMb, setTargetMb] = useState('10');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const generation = useGeneration();

  const megabytes = Number(targetMb);
  const lossy = mode !== 'lossless';
  const canRun =
    services !== null &&
    items.length > 0 &&
    !generation.running &&
    (mode !== 'target' || (Number.isFinite(megabytes) && megabytes > 0));

  const run = useCallback(() => {
    if (services === null || !canRun) return;
    setConfirming(false);
    setOutcome(null);

    const escolhido = PRESETS.find((item) => item.id === preset) ?? PRESETS[1];
    const step = COMPRESSION_STEPS[escolhido.index] ?? COMPRESSION_STEPS[3];
    if (step === undefined) return;

    const selecionado: CompressMode =
      mode === 'lossless'
        ? { kind: 'lossless', removeInvisibleText: removeOcr }
        : mode === 'quality'
          ? { kind: 'quality', step }
          : { kind: 'target', maxBytes: Math.round(megabytes * MEGABYTE) };

    generation.run({
      suggestedName: 'pdfkitty-compactado.pdf',
      produce: async (report) => {
        /*
         * Compacta a COMPOSICAO da grade, e nao um arquivo de origem: quem juntou paginas de
         * tres PDFs quer compactar o que montou. Montar e compactar sao duas mensagens porque
         * moram em workers diferentes — o de documentos e dono dos bytes, o de renderizacao e
         * quem tem canvas.
         */
        const montado = await services.documents.compose(toPageRefs(items));
        const original = montado.length;

        const resultado = await services.render.compress(
          montado.buffer as ArrayBuffer,
          selecionado,
          { onProgress: (feito, total) => report(feito / total) },
        );

        setOutcome({
          originalBytes: original,
          finalBytes: resultado.pdf.length,
          fitsTarget: resultado.fitsTarget,
          invisibleBlocksRemoved: resultado.invisibleBlocksRemoved,
        });

        return resultado.pdf;
      },
    });
  }, [services, canRun, mode, removeOcr, preset, megabytes, items, generation]);

  const request = useCallback(() => {
    if (!canRun) return;
    // A perda e anunciada ANTES de escolher destino: descobrir que o texto sumiu ao abrir o
    // arquivo salvo seria tarde demais.
    if (lossy) setConfirming(true);
    else run();
  }, [canRun, lossy, run]);

  const value = useMemo<CompressState>(
    () => ({
      mode,
      setMode,
      removeOcr,
      setRemoveOcr,
      preset,
      setPreset,
      targetMb,
      setTargetMb,
      outcome,
      generation,
      lossy,
      confirming,
      setConfirming,
      request,
      run,
      canRun,
    }),
    [
      mode,
      removeOcr,
      preset,
      targetMb,
      outcome,
      generation,
      lossy,
      confirming,
      request,
      run,
      canRun,
    ],
  );

  return <CompressContext.Provider value={value}>{children}</CompressContext.Provider>;
}

interface ModeOption {
  readonly id: ModeId;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
}

const MODES = [
  { id: 'lossless', labelKey: 'compress.mode.lossless', hintKey: 'compress.mode.lossless.hint' },
  { id: 'quality', labelKey: 'compress.mode.quality', hintKey: 'compress.mode.quality.hint' },
  { id: 'target', labelKey: 'compress.mode.target', hintKey: 'compress.mode.target.hint' },
] as const satisfies readonly ModeOption[];

function CompressPanel() {
  const { t } = useTranslation();
  const compress = useCompress();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('compress.mode')}
      </h2>

      <div role="radiogroup" aria-label={t('compress.mode')} className="flex flex-col gap-1">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={compress.mode === option.id}
            onClick={() => compress.setMode(option.id)}
            data-testid={`compress-mode-${option.id}`}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-sm transition-colors',
              compress.mode === option.id
                ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800',
            )}
          >
            <span className="font-medium">{t(option.labelKey)}</span>
            <span className="block text-xs text-neutral-500">{t(option.hintKey)}</span>
          </button>
        ))}
      </div>

      {compress.mode === 'lossless' && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={compress.removeOcr}
            onChange={(event) => compress.setRemoveOcr(event.target.checked)}
            data-testid="compress-remove-ocr"
            className="mt-1"
          />
          <span>
            {t('compress.removeOcr')}
            <span className="block text-xs text-neutral-500">{t('compress.removeOcr.hint')}</span>
          </span>
        </label>
      )}

      {compress.mode === 'quality' && (
        <div role="radiogroup" aria-label={t('compress.quality')} className="flex gap-2">
          {PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={compress.preset === option.id}
              onClick={() => compress.setPreset(option.id)}
              data-testid={`compress-preset-${option.id}`}
              className={cn(
                'flex-1 rounded-md border px-2 py-1 text-sm transition-colors',
                compress.preset === option.id
                  ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                  : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800',
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      )}

      {compress.mode === 'target' && (
        <label className="flex flex-col gap-1 text-sm">
          {t('compress.target.label')}
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={compress.targetMb}
            onChange={(event) => compress.setTargetMb(event.target.value)}
            data-testid="compress-target-input"
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 tabular-nums dark:border-neutral-700"
          />
          <span className="text-xs text-neutral-500">{t('compress.target.hint')}</span>
        </label>
      )}

      {compress.generation.error !== null && (
        <p
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
          data-testid="compress-error"
        >
          {compress.generation.error}
        </p>
      )}

      <h2 className="mt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('compress.result')}
      </h2>

      {compress.outcome === null ? (
        <p className="text-sm text-neutral-500">{t('compress.noResult')}</p>
      ) : (
        <div className="flex flex-col gap-1" data-testid="compress-results">
          {/*
            Compactar pode AUMENTAR o arquivo, e isso precisa ser dito.

            Rasterizar uma pagina de texto vetorial produz a fotografia de uma pagina quase em
            branco, maior que o vetor que a descrevia. Medido no aparelho: 2 kB viraram 9 kB
            enquanto a tela dizia "0% menor" — um numero que nao mente, mas esconde.
          */}
          {compress.outcome.finalBytes > compress.outcome.originalBytes ? (
            <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="compress-grew">
              {t('compress.grew', {
                before: formatBytes(compress.outcome.originalBytes),
                after: formatBytes(compress.outcome.finalBytes),
              })}
            </p>
          ) : (
            <p className="text-sm">
              {t('compress.summary', {
                before: formatBytes(compress.outcome.originalBytes),
                after: formatBytes(compress.outcome.finalBytes),
                percent: Math.round(
                  (1 - compress.outcome.finalBytes / compress.outcome.originalBytes) * 100,
                ),
              })}
            </p>
          )}
          {compress.outcome.invisibleBlocksRemoved > 0 && (
            <p className="text-sm text-neutral-500" data-testid="compress-ocr-removed">
              {t('compress.ocrRemoved', { blocks: compress.outcome.invisibleBlocksRemoved })}
            </p>
          )}
          {!compress.outcome.fitsTarget && (
            <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="compress-missed">
              {t('compress.missedTarget')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Confirmacao antes de rasterizar.
 *
 * O usuario pediu explicitamente para ser avisado. O que se perde nao e obvio pelo nome
 * "compactar": a pagina vira imagem, o texto deixa de ser pesquisavel e a camada de OCR vai
 * junto. Descobrir isso ao abrir o arquivo salvo seria tarde.
 */
function ConfirmDialog() {
  const { t } = useTranslation();
  const compress = useCompress();

  // Sem guarda de montagem: o dialogo so aparece apos um clique, entao nunca e renderizado
  // durante a geracao estatica, onde `document` nao existe.
  if (!compress.confirming) return null;

  // Portal para o body: a barra inferior usa `backdrop-blur`, e um filtro de fundo cria bloco
  // de contencao — um `fixed` dentro dela sairia da tela.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compress-confirm-title"
        data-testid="compress-confirm"
        className="flex max-w-md flex-col gap-3 rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-900"
      >
        <h2 id="compress-confirm-title" className="text-lg font-semibold">
          {t('compress.confirm.title')}
        </h2>

        <p className="text-sm">{t('compress.confirm.body')}</p>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('compress.confirm.rasterized')}
        </p>
        <p className="text-sm text-neutral-500">{t('compress.confirm.losslessHint')}</p>

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => compress.setConfirming(false)} data-testid="compress-cancel">
            {t('compress.confirm.cancel')}
          </Button>
          <Button variant="primary" onClick={compress.run} data-testid="compress-accept">
            {t('compress.confirm.accept')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompressAction() {
  const compress = useCompress();

  return (
    <>
      <ConfirmDialog />
      <GenerationAction
        generation={compress.generation}
        icon={Minimize2}
        labelKey="compress.run"
        runningLabelKey="compress.running"
        disabled={!compress.canRun}
        testId="compress-run"
        onRun={compress.request}
      />
    </>
  );
}

export function CompressTool() {
  return (
    <WorkspaceServicesProvider>
      <CompressProvider>
        <WorkspaceShell
          titleKey={getTool('compactar').nameKey}
          panel={<CompressPanel />}
          action={<CompressAction />}
        />
      </CompressProvider>
    </WorkspaceServicesProvider>
  );
}
