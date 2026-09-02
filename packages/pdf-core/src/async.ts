export interface LongRunningOptions {
  readonly onProgress?: (completed: number, total: number) => void;
  /**
   * Cancelamento cooperativo: verificado entre unidades de trabalho. Uma operacao que leva
   * minutos sem isto deixaria ao usuario apenas recarregar a pagina.
   */
  readonly signal?: AbortSignal;
}

/**
 * Devolve o controle ao laco de eventos entre unidades de trabalho.
 *
 * Sem isto o cancelamento cooperativo NAO funciona dentro de um Web Worker: uma sequencia de
 * `await` permanece na fila de microtarefas, e a mensagem de cancelamento — que e uma
 * macrotarefa — so seria lida depois que a operacao inteira terminasse. O sinal existiria,
 * mas ninguem o acionaria a tempo.
 *
 * Usa `MessageChannel` porque `setTimeout(0)` sofre limitacao de ~4 ms apos alguns
 * aninhamentos, o que somaria segundos num documento de centenas de paginas.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('Operacao cancelada', 'AbortError');
  }
}
