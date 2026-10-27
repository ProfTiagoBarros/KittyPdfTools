import { create } from 'zustand';

interface LongOperationState {
  /** Operacoes longas em andamento. Contador, e nao booleano: elas podem se sobrepor. */
  readonly running: number;
  /** Fracao de 0 a 1 da operacao que sabe informar, ou `null`. */
  readonly progress: number | null;
}

/**
 * Operacao longa em andamento, em qualquer ferramenta e em qualquer espaco de trabalho.
 *
 * Global de proposito: o aviso cobre a tela inteira, e quem abre arquivos (a casca), quem gera
 * (cada ferramenta) e quem busca (o campo) nao se conhecem.
 */
export const useLongOperation = create<LongOperationState>(() => ({ running: 0, progress: null }));

/**
 * Marca o inicio de uma operacao longa e devolve a funcao que marca o fim.
 *
 * O fim pode ser chamado mais de uma vez sem desequilibrar o contador — e o que permite chama-lo
 * num `finally` sem medo de um caminho de erro ja te-lo chamado antes.
 */
export function beginLongOperation(): () => void {
  useLongOperation.setState((state) => ({ running: state.running + 1 }));
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    useLongOperation.setState((state) => {
      const running = Math.max(0, state.running - 1);
      return { running, progress: running === 0 ? null : state.progress };
    });
  };
}

export function reportLongOperationProgress(progress: number | null): void {
  useLongOperation.setState({ progress });
}
