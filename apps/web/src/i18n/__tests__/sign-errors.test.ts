import { describe, it, expect } from 'vitest';
import { SignError } from '@/workers/sign-client';
import { signErrorKey, SIGN_FAILURES, LOCALES, LOCALE_CODES } from '@/i18n';
import { ptBR } from '@/i18n/messages/pt-BR';

describe('traducao de falhas de assinatura', () => {
  /** Mesma barreira dos erros do nucleo: motivo novo sem traducao quebra o build. */
  it.each(SIGN_FAILURES)('o motivo %s tem chave de traducao', (reason) => {
    expect(ptBR).toHaveProperty(`signError.${reason}`);
  });

  it.each(LOCALE_CODES)('o idioma %s traduz todos os motivos', (locale) => {
    const messages = LOCALES[locale].messages;
    for (const reason of SIGN_FAILURES) {
      const key = `signError.${reason}` as keyof typeof messages;
      expect(messages[key]).toBeTruthy();
    }
  });

  it('mapeia a falha para a chave do seu motivo', () => {
    const error = new SignError('INVALID_PASSWORD', 'forge: MAC verify failure');
    expect(signErrorKey(error)).toBe('signError.INVALID_PASSWORD');
  });

  it('erro comum cai no generico, sem vazar detalhe da biblioteca', () => {
    // "MAC verify failure" nao pode chegar a tela: e texto de implementacao, num idioma so.
    expect(signErrorKey(new Error('forge: MAC verify failure'))).toBe('coreError.unknown');
  });
});
