import { SignError } from '@/workers/sign-client';
import type { SignFailure } from '@/workers/sign-protocol';
import type { MessageKey } from './messages/pt-BR';

/** Todos os motivos de falha de assinatura, para o teste de cobertura das traducoes. */
export const SIGN_FAILURES = [
  'INVALID_PASSWORD',
  'INVALID_CERTIFICATE',
  'NO_CERTIFICATE_IN_FILE',
  'SIGN_FAILED',
] as const satisfies readonly SignFailure[];

/**
 * Traduz uma falha de assinatura.
 *
 * Mesma disciplina dos erros do nucleo: a mensagem que acompanha o erro e para log, e um
 * motivo desconhecido cai num texto generico em vez de vazar detalhe de biblioteca.
 */
export function signErrorKey(error: unknown): MessageKey {
  if (!(error instanceof SignError)) return 'coreError.unknown';
  return `signError.${error.reason}` as MessageKey;
}
