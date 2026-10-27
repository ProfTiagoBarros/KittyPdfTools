'use client';

import { useTranslation } from '@/i18n';

/**
 * "Extrair" virou uma opcao de "Unir e extrair". A rota continua respondendo para nao quebrar
 * favoritos e atalhos: o export estatico nao tem servidor para redirecionar, entao quem
 * redireciona e a propria pagina, sem depender de JavaScript.
 */
export default function Page() {
  const { t } = useTranslation();

  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/unir/" />
      <a href="/unir/">{t('tool.merge.name')}</a>
    </>
  );
}
