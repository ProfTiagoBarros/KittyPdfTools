'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n';
import { TOOLS } from '@/tools/registry';

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">{t('app.tagline')}</p>
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('privacy.explanation')}</p>
      </header>

      <nav aria-label={t('nav.tools')}>
        <ul className="flex flex-col gap-2">
          {TOOLS.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`/${tool.slug}/`}
                className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                <span className="font-medium">{t(tool.nameKey)}</span>
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                  {t(tool.descriptionKey)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
