'use client';

import { Check, Loader2, type LucideIcon } from 'lucide-react';
import { useTranslation, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import type { Generation } from '@/lib/generation';

interface GenerationActionProps {
  readonly generation: Generation;
  readonly icon: LucideIcon;
  /** Rotulo do botao em repouso. */
  readonly labelKey: MessageKey;
  /** Rotulo enquanto trabalha. */
  readonly runningLabelKey: MessageKey;
  readonly disabled: boolean;
  readonly onRun: () => void;
  readonly testId: string;
}

/**
 * Acao principal de uma ferramenta, igual em todas.
 *
 * Tres estados visiveis, e nenhum deles opcional:
 *
 * - **Trabalhando:** o botao vira indicador. Uma operacao que leva dezenas de segundos sem
 *   sinal algum passa por travamento — foi por isso que a barra do OCR sempre foi criterio de
 *   aceite, e o mesmo vale para as outras.
 * - **Progresso quando existe.** Quem nao consegue estimar mostra atividade sem porcentagem,
 *   em vez de uma barra fingindo saber.
 * - **Ultima geracao:** o arquivo recem-criado continua ao alcance de um clique. Cobre o caso
 *   real de salvar no lugar errado, e o de querer uma segunda copia.
 */
export function GenerationAction({
  generation,
  icon: Icon,
  labelKey,
  runningLabelKey,
  disabled,
  onRun,
  testId,
}: GenerationActionProps) {
  const { t } = useTranslation();

  return (
    <>
      {generation.error !== null && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-400">
          {generation.error}
        </span>
      )}

      {generation.last !== null && !generation.running && (
        <Button
          size="sm"
          onClick={generation.saveAgain}
          title={t('generation.saveAgain')}
          data-testid="last-generated"
          className="max-w-56"
        >
          <Check className="text-green-600 dark:text-green-400" />
          <span className="truncate">{generation.last.name}</span>
        </Button>
      )}

      {generation.running && generation.progress !== null && (
        <progress
          value={generation.progress}
          max={1}
          data-testid="generation-progress"
          className="h-2 w-32"
          aria-label={t(runningLabelKey)}
        />
      )}

      <Button
        variant="primary"
        onClick={onRun}
        disabled={disabled || generation.running}
        data-testid={testId}
        // `aria-busy` conta para o leitor de tela o que o giro do icone conta para quem enxerga.
        aria-busy={generation.running}
      >
        {generation.running ? <Loader2 className="animate-spin" /> : <Icon />}
        {t(generation.running ? runningLabelKey : labelKey)}
      </Button>
    </>
  );
}
