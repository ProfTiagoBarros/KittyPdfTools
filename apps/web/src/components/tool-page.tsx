'use client';

import { useTranslation } from '@/i18n';
import type { ToolDefinition } from '@/tools/registry';

/**
 * Casca provisoria de uma ferramenta. O workspace real (sidebar + canvas de miniaturas +
 * painel de propriedades + barra inferior) entra na proxima fase; aqui garantimos apenas
 * que rota, registro de ferramentas e i18n estao ligados de ponta a ponta.
 */
export function ToolPage({ tool }: { tool: ToolDefinition }) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t(tool.nameKey)}</h1>
      <p className="text-neutral-600 dark:text-neutral-400">{t(tool.descriptionKey)}</p>
      <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('privacy.badge')}</p>
    </main>
  );
}
