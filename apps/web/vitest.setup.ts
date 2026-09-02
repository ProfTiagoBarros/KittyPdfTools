import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useLocaleStore } from '@/i18n';
import { DEFAULT_LOCALE } from '@/i18n';

beforeEach(() => {
  // Store global: sem reset, a escolha de idioma de um teste vaza para o proximo.
  // A guarda permite testes com `@vitest-environment node`, onde nao ha localStorage.
  if (typeof localStorage !== 'undefined') localStorage.clear();
  useLocaleStore.setState({ locale: DEFAULT_LOCALE });
});

afterEach(() => {
  cleanup();
});
