import { isSignResponse, type CertificateInfo, type SignFailure } from './sign-protocol';
import type { SignWorkerRequest, SignWorkerResponse } from './sign-protocol';

/** Falha de assinatura com motivo traduzivel. A UI nunca exibe a mensagem crua. */
export class SignError extends Error {
  readonly reason: SignFailure;

  constructor(reason: SignFailure, detail: string) {
    super(detail);
    this.name = 'SignError';
    this.reason = reason;
  }
}

export interface SignSession {
  /**
   * Envia o certificado ao worker e devolve seus dados.
   *
   * O `ArrayBuffer` do `.pfx` e TRANSFERIDO: a partir daqui a interface fica sem os bytes, e
   * o material de chave existe apenas dentro do worker.
   */
  loadCertificate(pfx: ArrayBuffer, passphrase: string): Promise<CertificateInfo>;
  sign(pdf: ArrayBuffer, reason: string, location: string): Promise<Uint8Array>;
  /** Encerra o worker. A memoria com a chave e a senha vai junto. */
  dispose(): void;
}

/**
 * Sessao de assinatura: um worker dedicado, criado ao carregar o certificado e encerrado ao
 * fim da assinatura. Nao ha worker de assinatura vivo fora desse intervalo.
 */
export function createSignSession(): SignSession {
  const worker = new Worker(new URL('./sign.worker.ts', import.meta.url), { type: 'module' });

  let nextId = 0;
  const newId = () => `sign-${(nextId += 1)}`;

  function send<T>(
    request: SignWorkerRequest,
    transfer: Transferable[],
    resolveFrom: (message: SignWorkerResponse) => T | undefined,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onMessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (!isSignResponse(response) || response.id !== request.id) return;

        worker.removeEventListener('message', onMessage);

        if (response.kind === 'error') {
          reject(new SignError(response.reason, response.message));
          return;
        }

        const value = resolveFrom(response);
        if (value === undefined) reject(new SignError('SIGN_FAILED', `resposta ${response.kind}`));
        else resolve(value);
      };

      worker.addEventListener('message', onMessage);
      worker.postMessage(request, transfer);
    });
  }

  return {
    async loadCertificate(pfx, passphrase) {
      return send({ kind: 'loadCertificate', id: newId(), pfx, passphrase }, [pfx], (message) =>
        message.kind === 'certificateLoaded' ? message.certificate : undefined,
      );
    },

    async sign(pdf, reason, location) {
      const signed = await send(
        { kind: 'sign', id: newId(), pdf, reason, location },
        [pdf],
        (message) => (message.kind === 'signed' ? message.pdf : undefined),
      );
      return new Uint8Array(signed);
    },

    dispose() {
      worker.terminate();
    },
  };
}
