'use client';

import { useEffect } from 'react';
import { useLocaleStore, detectBrowserLocale } from './store';

/**
 * Restaura a preferencia de idioma apos a montagem (ver comentario em `store.ts` sobre
 * hidratacao). Sem preferencia salva, cai no idioma do navegador.
 *
 * Nao renderiza nada: e um efeito colateral isolado num componente, para nao contaminar
 * o layout com logica de bootstrap.
 */
export function LocaleHydrator(): null {
  useEffect(() => {
    void useLocaleStore.persist.rehydrate();

    const hasStoredPreference = localStorage.getItem('pdfkitty.locale') !== null;
    if (!hasStoredPreference) {
      useLocaleStore.getState().setLocale(detectBrowserLocale());
    }
  }, []);

  return null;
}
