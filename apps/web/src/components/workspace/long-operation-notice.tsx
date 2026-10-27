'use client';

import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useLongOperation } from '@/workspace/long-operation';

/**
 * Aviso de operacao demorada, cobrindo a tela.
 *
 * Unir oito PDFs escaneados levava dezenas de segundos com a tela parada, e o usuario concluia
 * que o programa tinha travado. O aviso diz o contrario e bloqueia os cliques ate terminar —
 * ninguem remove um arquivo no meio da juncao.
 *
 * So aparece depois de 1 s, e quem espera e o CSS (`animation-delay`), nao um timer: operacao
 * rapida nao pisca a tela, e a longa nao custa nada enquanto roda. Ate aparecer, o painel fica
 * `visibility: hidden`, que tambem nao recebe clique.
 *
 * Vai para o `body` por portal: a barra inferior tem `backdrop-blur`, que cria bloco de
 * contencao, e um `fixed` dentro dela sairia da tela.
 */
export function LongOperationNotice() {
  const { t } = useTranslation();
  const running = useLongOperation((state) => state.running);
  const progress = useLongOperation((state) => state.progress);

  if (running === 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="long-operation fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 p-4"
      data-testid="long-operation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby="long-operation-message"
        className="flex max-w-sm flex-col items-center gap-4 rounded-lg bg-white p-6 text-center shadow-xl dark:bg-neutral-900"
      >
        <Loader2 className="size-8 animate-spin text-neutral-500" aria-hidden="true" />
        <p id="long-operation-message" className="text-sm font-medium">
          {t('longOperation.message')}
        </p>
        {progress !== null && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
          >
            <div
              className="h-full bg-neutral-900 transition-[width] dark:bg-neutral-100"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
