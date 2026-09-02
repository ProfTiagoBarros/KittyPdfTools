'use client';

import { useCallback, useState } from 'react';
import { coreErrorKey, coreErrorParams, useTranslation } from '@/i18n';
import { chooseDestination, discardDestination, savePdf, writeTo } from './save-pdf';

/** Arquivo que a ferramenta acabou de produzir e que o usuario ainda pode salvar de novo. */
export interface LastGenerated {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface Generation {
  readonly running: boolean;
  /** Fracao de 0 a 1, ou `null` quando a operacao nao sabe informar o quanto falta. */
  readonly progress: number | null;
  readonly error: string | null;
  readonly last: LastGenerated | null;
  /** Dispara o fluxo completo: escolher destino, gerar, gravar. */
  readonly run: (options: RunOptions) => void;
  /** Salva de novo o ultimo arquivo gerado, perguntando o destino outra vez. */
  readonly saveAgain: () => void;
}

export interface RunOptions {
  /** Nome sugerido no seletor. O usuario pode trocar. */
  readonly suggestedName: string;
  /**
   * Produz os bytes do arquivo.
   *
   * Recebe uma funcao para relatar progresso — operacoes que nao conseguem estimar podem
   * simplesmente nao chama-la, e a interface mostra atividade sem porcentagem — e o **nome
   * final escolhido pelo usuario**, que a divisao usa para nomear os volumes dentro do
   * pacote.
   */
  readonly produce: (report: (fraction: number) => void, fileName: string) => Promise<Uint8Array>;
}

/**
 * O mesmo fluxo de geracao para todas as ferramentas.
 *
 * Antes cada uma se comportava de um jeito: unir salvava direto, dividir listava volumes, e
 * OCR, ofuscar e assinar exigiam um segundo clique para baixar. Tres comportamentos para a
 * mesma intencao — "gere e me entregue o arquivo".
 *
 * A ordem aqui e deliberada: **o destino e escolhido ANTES de gerar**. O usuario decide no
 * clique, ve o trabalho acontecer e recebe o arquivo pronto, em vez de esperar para so entao
 * ser perguntado.
 *
 * O preco dessa ordem esta no Android, onde o seletor cria o documento na hora da confirmacao:
 * se a geracao falhar, sobra um arquivo vazio. Por isso o destino e descartado no erro — sem
 * isso, o produto passaria a produzir exatamente o sintoma do defeito que ele acabou de
 * corrigir.
 */
export function useGeneration(): Generation {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<LastGenerated | null>(null);

  const run = useCallback(
    ({ suggestedName, produce }: RunOptions) => {
      if (running) return;

      setError(null);

      void (async () => {
        const destination = await chooseDestination(suggestedName).catch(() => null);
        // Cancelar nao e falha: o usuario decidiu nao gerar.
        if (destination === null) return;

        const name =
          destination.kind === 'system'
            ? (destination.path.split(/[\\/]/).pop() ?? suggestedName)
            : destination.fileName;

        setRunning(true);
        setProgress(null);

        try {
          const bytes = await produce((fraction) => setProgress(fraction), name);
          await writeTo(destination, bytes);
          setLast({ name, bytes });
        } catch (cause) {
          // A causa vai ao console porque a mensagem na tela e traduzida e generica por
          // design; sem ela, "nao foi possivel" e tudo o que se sabe quando o defeito e nosso.
          console.error('Falha ao gerar o arquivo', { suggestedName }, cause);
          setError(t(coreErrorKey(cause), coreErrorParams(cause)));
          await discardDestination(destination).catch((erro: unknown) => {
            console.error('Falha ao descartar o destino vazio', erro);
          });
        } finally {
          setRunning(false);
          setProgress(null);
        }
      })();
    },
    [running, t],
  );

  const saveAgain = useCallback(() => {
    if (last === null) return;

    setError(null);
    void savePdf(last.bytes, last.name).catch((cause: unknown) => {
      console.error('Falha ao salvar novamente', { name: last.name }, cause);
      setError(t('save.failed'));
    });
  }, [last, t]);

  return { running, progress, error, last, run, saveAgain };
}
