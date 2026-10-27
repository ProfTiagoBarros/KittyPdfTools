'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useWorkspaceServices } from '@/workspace/services';
import { useWorkspaceStore } from '@/workspace/store';
import { findMatches, matchesInGrid, stepMatch } from '@/workspace/search';
import { beginLongOperation } from '@/workspace/long-operation';

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
  const items = useWorkspaceStore((state) => state.items);
  const matchCounts = useWorkspaceStore((state) => state.matchCounts);
  const activeMatch = useWorkspaceStore((state) => state.activeMatch);
  const setActiveMatch = useWorkspaceStore((state) => state.setActiveMatch);
  const pagesWithText = useWorkspaceStore((state) => state.pagesWithText);
  const searchTerm = useWorkspaceStore((state) => state.searchTerm);
  const setSearch = useWorkspaceStore((state) => state.setSearch);

  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (services === null) return undefined;

    if (term.trim() === '') {
      setSearch('', { matchedPages: [], occurrences: {}, pagesWithText: 0 });
      return undefined;
    }

    let cancelled = false;
    let endLongOperation: (() => void) | undefined;
    const timer = setTimeout(() => {
      setBusy(true);
      // A primeira busca extrai o texto de todas as paginas: em centenas delas, demora.
      endLongOperation = beginLongOperation();

      void Promise.all(
        documents.map(
          async (document) => [document.id, await services.render.pageTexts(document.id)] as const,
        ),
      )
        .then((entries) => {
          if (cancelled) return;
          setSearch(term, findMatches(new Map(entries), term));
        })
        .catch((cause: unknown) => {
          // Falhar a extracao nao pode derrubar a montagem em andamento: a busca some, o
          // documento fica. A causa vai ao console para nao virar defeito invisivel.
          console.error('Falha ao extrair texto para a busca', cause);
          if (!cancelled) setSearch(term, { matchedPages: [], occurrences: {}, pagesWithText: 0 });
        })
        .finally(() => {
          endLongOperation?.();
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      endLongOperation?.();
    };
  }, [services, documents, term, setSearch]);

  // Pela grade, e nao pelos arquivos: pagina excluida nao conta, duplicada conta duas vezes.
  const hits = useMemo(() => matchesInGrid(items, matchCounts), [items, matchCounts]);
  const position = activeMatch === null ? -1 : hits.keys.indexOf(activeMatch);

  /*
   * Navega de PAGINA em pagina, nao de ocorrencia em ocorrencia: a miniatura nao mostra onde
   * o termo esta dentro dela, entao tres paradas na mesma pagina pareceriam setas quebradas.
   *
   * A rolagem e do navegador (`scrollIntoView`), sem estado de rolagem nosso. `center` porque
   * a busca fica fixa no topo e cobriria um cartao alinhado ao inicio.
   */
  const step = useCallback(
    (delta: 1 | -1) => {
      const next = stepMatch(hits.keys, activeMatch, delta);
      if (next === null) return;
      setActiveMatch(next);
      document
        .querySelector(`[data-page-key="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [hits.keys, activeMatch, setActiveMatch],
  );

  const buscando = searchTerm !== '';
  const semTextoAlgum = buscando && !busy && pagesWithText === 0;
  const navegavel = buscando && !busy && hits.keys.length > 0;

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
            // Enter avanca e Shift+Enter volta, como no "localizar" de qualquer navegador.
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !navegavel) return;
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }}
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
        <div className="flex items-center gap-2">
          <p
            role="status"
            data-testid="search-status"
            className="flex-1 text-xs text-neutral-500"
            aria-busy={busy}
          >
            {busy
              ? t('search.searching')
              : semTextoAlgum
                ? t('search.noText')
                : hits.keys.length === 0
                  ? t('search.none')
                  : t('search.summary', {
                      occurrences: hits.occurrences,
                      pages: hits.keys.length,
                    })}
          </p>

          {navegavel && (
            <>
              <span className="text-xs text-neutral-500 tabular-nums" data-testid="search-position">
                {position === -1
                  ? `– / ${hits.keys.length}`
                  : t('search.position', { current: position + 1, total: hits.keys.length })}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => step(-1)}
                aria-label={t('search.previous')}
                title={t('search.previous')}
                data-testid="search-previous"
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => step(1)}
                aria-label={t('search.next')}
                title={t('search.next')}
                data-testid="search-next"
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
      )}
    </search>
  );
}
