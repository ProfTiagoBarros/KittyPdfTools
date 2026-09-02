import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_LOCALE, isLocale, type Locale } from './registry';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/**
 * `skipHydration: true` e deliberado.
 *
 * O app e exportado estaticamente (Regra de Ouro 1), entao o HTML e pre-renderizado sempre
 * em DEFAULT_LOCALE. Se o zustand restaurasse o idioma do localStorage durante o primeiro
 * render, o markup do cliente divergiria do HTML servido e o React acusaria erro de
 * hidratacao. Restauramos apos a montagem, via <LocaleHydrator />.
 */
export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'pdfkitty.locale',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);

/** Detecta o idioma do navegador quando ainda nao ha preferencia salva. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  for (const candidate of navigator.languages ?? []) {
    if (isLocale(candidate)) return candidate;
    const base = candidate.split('-')[0];
    if (base !== undefined && isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
