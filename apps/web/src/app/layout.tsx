import type { Metadata, Viewport } from 'next';
import { LocaleHydrator } from '@/i18n';
import { DEFAULT_LOCALE } from '@/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'PDFKitty',
  description: 'Suite de PDF 100% local: unir, dividir, ofuscar, assinar e OCR sem upload.',
};

/**
 * `viewportFit: 'cover'` habilita `env(safe-area-inset-*)`.
 *
 * Sem isso as insets valem zero e a barra inferior — onde mora a acao principal de cada
 * ferramenta — fica embaixo da barra de navegacao do Android. O usuario ve o botao e nao
 * consegue toca-lo, que e pior do que nao ve-lo.
 *
 * `maximumScale` fica de fora de proposito: impedir o zoom quebraria a acessibilidade de quem
 * precisa aumentar a interface.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
};

/**
 * `lang` fixo em DEFAULT_LOCALE porque o HTML e pre-renderizado estaticamente.
 * O <LocaleHydrator /> ajusta o atributo no cliente apos restaurar a preferencia.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <LocaleHydrator />
        {children}
      </body>
    </html>
  );
}
