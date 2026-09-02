'use client';

import { useCallback } from 'react';
import { LOCALES, type Locale } from './registry';
import type { MessageKey } from './messages/pt-BR';
import { useLocaleStore } from './store';

export type TranslateParams = Readonly<Record<string, string | number>>;

/** Substitui marcadores `{nome}` pelos valores fornecidos. */
function interpolate(template: string, params?: TranslateParams): string {
  if (params === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = params[token];
    return value === undefined ? match : String(value);
  });
}

export interface Translation {
  t: (key: MessageKey, params?: TranslateParams) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/**
 * Unico ponto de acesso a textos na UI. Componentes nunca importam dicionarios
 * diretamente — assim trocar de idioma nao exige alterar componente algum.
 */
export function useTranslation(): Translation {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) =>
      interpolate(LOCALES[locale].messages[key], params),
    [locale],
  );

  return { t, locale, setLocale };
}
