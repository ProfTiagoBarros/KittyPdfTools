import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useTranslation, useLocaleStore } from '@/i18n';

function Probe() {
  const { t, locale } = useTranslation();
  return (
    <>
      <span data-testid="locale">{locale}</span>
      <span data-testid="tagline">{t('app.tagline')}</span>
    </>
  );
}

describe('useTranslation', () => {
  it('resolve textos no idioma padrao', () => {
    render(<Probe />);
    expect(screen.getByTestId('locale')).toHaveTextContent('pt-BR');
    expect(screen.getByTestId('tagline')).toHaveTextContent('nunca saem do seu computador');
  });

  it('re-renderiza os componentes ao trocar de idioma, sem recarregar a pagina', () => {
    render(<Probe />);

    act(() => {
      useLocaleStore.getState().setLocale('en');
    });

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('tagline')).toHaveTextContent('never leave your computer');
  });
});
