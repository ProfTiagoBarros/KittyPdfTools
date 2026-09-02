'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { TOOLS } from '@/tools/registry';

export function ToolSidebar() {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('nav.tools')}
      className="flex shrink-0 gap-1 overflow-x-auto border-neutral-200 p-2 md:w-48 md:flex-col md:overflow-visible md:border-r dark:border-neutral-800"
    >
      {TOOLS.map((tool) => {
        const href = `/${tool.slug}/`;
        const active = pathname === href || pathname === `/${tool.slug}`;

        return (
          <Link
            key={tool.slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
              active
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            {t(tool.nameKey)}
          </Link>
        );
      })}
    </nav>
  );
}
