import { describe, it, expect } from 'vitest';
import { LOCALES, LOCALE_CODES, DEFAULT_LOCALE, isLocale } from '@/i18n';
import { ptBR } from '@/i18n/messages/pt-BR';

const referenceKeys = Object.keys(ptBR).sort();

describe('registro de idiomas', () => {
  it('inclui o idioma padrao', () => {
    expect(LOCALE_CODES).toContain(DEFAULT_LOCALE);
  });

  /**
   * Este e o teste que sustenta a regra "adicionar idioma deve ser trivial": um idioma novo
   * so passa se estiver completo. O tipo `Messages` ja barra em tempo de compilacao; aqui
   * cobrimos o caso de alguem contornar com `as` ou de um dicionario vindo de JSON.
   */
  it.each(LOCALE_CODES)('o idioma "%s" cobre todas as chaves de referencia', (code) => {
    expect(Object.keys(LOCALES[code].messages).sort()).toEqual(referenceKeys);
  });

  it.each(LOCALE_CODES)('o idioma "%s" nao tem traducao vazia', (code) => {
    const empty = Object.entries(LOCALES[code].messages)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it.each(LOCALE_CODES)('o idioma "%s" se identifica no proprio idioma', (code) => {
    expect(LOCALES[code].label.trim().length).toBeGreaterThan(0);
  });

  it('isLocale aceita codigos registrados e rejeita os demais', () => {
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('klingon')).toBe(false);
    expect(isLocale('toString')).toBe(false);
  });
});
