'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useWorkspaceServices } from '@/workspace/services';
import { useWorkspaceStore } from '@/workspace/store';
import { findMatches } from '@/workspace/search';

/** Espera o usuario parar de digitar: buscar a cada tecla piscaria a grade inteira. */
const DEBOUNCE_MS = 250;

/**
 * Busca de campo aberto sobre os documentos carregados.
 *
 * Destaca as paginas com pelo menos uma ocorrencia — nao filtra a grade. Esconder as demais
 * quebraria a montagem em andamento: a ordem das paginas E o documento final, e o usuario
 * precisa continuar enxergando o todo enquanto procura.
 *
 * O texto sai do worker de renderizacao (uma extracao por documento, reaproveitada); aqui so
 * se decide o que casa.
 */
export function SearchField() {
  const { t } = useTranslation();
  const services = useWorkspaceServices();
  const documents = useWorkspaceStore((state) => state.documents);
  const matchedPages = useWorkspaceStore((state) => state.matchedPages);
  const pagesWithText = useWorkspaceStore((state) => state.pagesWithText);
  const searchTerm = useWorkspaceStore((state) => state.searchTerm);
  const setSearch = useWorkspaceStore((state) => state.setSearch);

  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (services === null) return undefined;

    if (term.trim() === '') {
      setSearch('', [], 0);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);

      void Promise.all(
        documents.map(
          async (document) => [document.id, await services.render.pageTexts(document.id)] as const,
        ),
      )
        .then((entries) => {
          if (cancelled) return;
          const outcome = findMatches(new Map(entries), term);
          setSearch(term, outcome.matchedPages, outcome.pagesWithText);
        })
        .catch((cause: unknown) => {
          // Falhar a extracao nao pode derrubar a montagem em andamento: a busca some, o
          // documento fica. A causa vai ao console para nao virar defeito invisivel.
          console.error('Falha ao extrair texto para a busca', cause);
          if (!cancelled) setSearch(term, [], 0);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [services, documents, term, setSearch]);

  const buscando = searchTerm !== '';
  const semTextoAlgum = buscando && !busy && pagesWithText === 0;

  return (
    <search className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="relative flex flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-2 size-4 text-neutral-500"
            aria-hidden="true"
          />
          <span className="sr-only">{t('search.label')}</span>
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('search.placeholder')}
            data-testid="search-input"
            className="w-full rounded-md border border-neutral-300 bg-transparent py-1.5 pr-2 pl-8 text-sm dark:border-neutral-700"
          />
        </label>

        {term !== '' && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setTerm('')}
            aria-label={t('search.clear')}
            title={t('search.clear')}
            data-testid="search-clear"
          >
            <X />
          </Button>
        )}
      </div>

      {/*
        `role="status"` para o leitor de tela anunciar o resultado: o destaque amarelo sozinho
        nao existe para quem nao enxerga cor.
      */}
      {buscando && (
        <p
          role="status"
          data-testid="search-status"
          className="text-xs text-neutral-500"
          aria-busy={busy}
        >
          {busy
            ? t('search.searching')
            : semTextoAlgum
              ? t('search.noText')
              : t('search.results', { count: matchedPages.length })}
        </p>
      )}
    </search>
  );
}
