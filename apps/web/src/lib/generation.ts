'use client';

import { useCallback, useState } from 'react';
import { coreErrorKey, coreErrorParams, useTranslation } from '@/i18n';
import {
  chooseDestination,
  copySaved,
  discardDestination,
  savePdf,
  writeTo,
  type Destination,
} from './save-pdf';

/**
 * De onde o "salvar de novo" tira o arquivo.
 *
 * NAO e o arquivo em si. Guardar os bytes custava o tamanho inteiro do documento enquanto o
 * app estivesse aberto — medido, 288 MB depois de juntar dois PDFs de 200 paginas —, e cada
 * operacao seguinte comecava desse patamar. Num Windows 32 bits, com ~2 GB por processo, era
 * a diferenca entre a segunda juncao funcionar ou travar.
 *
 * - `disk`: o app instalado ja gravou o arquivo; salvar de novo e copiar de la.
 * - `memory`: a web nao rele o que baixou, entao guarda — mas so arquivos pequenos.
 * - `null`: arquivo grande na web; da para ver o nome, nao para salvar de novo.
 */
export type LastSource =
  | { readonly kind: 'disk'; readonly path: string }
  | { readonly kind: 'memory'; readonly bytes: Uint8Array }
  | null;

/** Arquivo que a ferramenta acabou de produzir. */
export interface LastGenerated {
  readonly name: string;
  readonly source: LastSource;
}

/** Acima disto, a web nao guarda o arquivo para salvar de novo. */
const MAX_KEPT_IN_MEMORY = 50 * 1024 * 1024;

function sourceFor(destination: Destination, bytes: Uint8Array): LastSource {
  if (destination.kind === 'system') return { kind: 'disk', path: destination.path };
  return bytes.length <= MAX_KEPT_IN_MEMORY ? { kind: 'memory', bytes } : null;
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

/** O que fazer em volta de uma geracao pesada: liberar antes, restaurar depois. */
export interface GenerationAround {
  readonly before: () => Promise<void>;
  readonly after: () => Promise<void>;
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
  /**
   * Liberacao de memoria em volta da geracao.
   *
   * `before` roda depois de o destino ser escolhido — cancelar o seletor nao deve custar uma
   * recarga — e `after` roda depois de o arquivo estar GRAVADO, inclusive quando a geracao
   * falha. Restaurar antes de gravar somaria a recarga ao arquivo gerado, ainda vivo na
   * memoria, que e exatamente o pico que a liberacao existe para evitar.
   */
  readonly around?: GenerationAround;
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
    ({ suggestedName, produce, around }: RunOptions) => {
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

        let liberado = false;
        try {
          if (around !== undefined) {
            try {
              await around.before();
              liberado = true;
            } catch (cause) {
              // Liberar e otimizacao: se falhar, a geracao segue com a memoria como esta.
              console.error('Falha ao liberar memoria antes de gerar', cause);
            }
          }

          const bytes = await produce((fraction) => setProgress(fraction), name);
          await writeTo(destination, bytes);
          setLast({ name, source: sourceFor(destination, bytes) });
        } catch (cause) {
          // A causa vai ao console porque a mensagem na tela e traduzida e generica por
          // design; sem ela, "nao foi possivel" e tudo o que se sabe quando o defeito e nosso.
          console.error('Falha ao gerar o arquivo', { suggestedName }, cause);
          setError(t(coreErrorKey(cause), coreErrorParams(cause)));
          await discardDestination(destination).catch((erro: unknown) => {
            console.error('Falha ao descartar o destino vazio', erro);
          });
        } finally {
          if (liberado && around !== undefined) {
            await around.after().catch((cause: unknown) => {
              console.error('Falha ao restaurar as paginas apos gerar', cause);
            });
          }
          setRunning(false);
          setProgress(null);
        }
      })();
    },
    [running, t],
  );

  const saveAgain = useCallback(() => {
    if (last?.source == null) return;
    const { name, source } = last;

    setError(null);

    if (source.kind === 'memory') {
      void savePdf(source.bytes, name).catch((cause: unknown) => {
        console.error('Falha ao salvar novamente', { name }, cause);
        setError(t('save.failed'));
      });
      return;
    }

    void (async () => {
      const destination = await chooseDestination(name).catch(() => null);
      if (destination === null) return;
      await copySaved(source.path, destination);
    })().catch((cause: unknown) => {
      // O caso real e o arquivo ter sido movido ou apagado depois de salvo: a mensagem diz
      // isso e sugere gerar de novo, em vez de um "nao foi possivel" sem saida.
      console.error('Falha ao copiar o arquivo salvo', { name }, cause);
      setError(t('generation.copyFailed'));
    });
  }, [last, t]);

  return { running, progress, error, last, run, saveAgain };
}
