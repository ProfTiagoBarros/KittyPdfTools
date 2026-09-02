import { describe, it, expect } from 'vitest';
import { PdfCoreError } from 'pdf-core';
import { coreErrorKey, coreErrorParams, CORE_ERROR_CODES, LOCALES, LOCALE_CODES } from '@/i18n';
import { ptBR } from '@/i18n/messages/pt-BR';

describe('traducao de erros do nucleo', () => {
  /**
   * A barreira que impede a regressao: um codigo novo no nucleo sem chave de traducao quebra
   * aqui, em vez de aparecer como texto generico para o usuario meses depois.
   */
  it.each(CORE_ERROR_CODES)('o codigo %s tem chave de traducao', (code) => {
    expect(ptBR).toHaveProperty(`coreError.${code}`);
  });

  it.each(LOCALE_CODES)('o idioma %s traduz todos os codigos', (locale) => {
    const messages = LOCALES[locale].messages;
    for (const code of CORE_ERROR_CODES) {
      const key = `coreError.${code}` as keyof typeof messages;
      expect(messages[key]).toBeTruthy();
    }
  });

  it('mapeia um erro do nucleo para a chave do seu codigo', () => {
    const error = new PdfCoreError('REVERSED_RANGE', { part: '9-4' }, 'log only');
    expect(coreErrorKey(error)).toBe('coreError.REVERSED_RANGE');
    expect(coreErrorParams(error)).toEqual({ part: '9-4' });
  });

  it('erro comum cai no texto generico, sem vazar a mensagem crua', () => {
    // Um erro inesperado nao pode levar texto de implementacao — nem idioma errado — a tela.
    expect(coreErrorKey(new Error('ReferenceError: x is not defined'))).toBe('coreError.unknown');
    expect(coreErrorParams(new Error('qualquer'))).toEqual({});
  });

  it('valor que nem e Error tambem cai no generico', () => {
    expect(coreErrorKey('string solta')).toBe('coreError.unknown');
  });
});
