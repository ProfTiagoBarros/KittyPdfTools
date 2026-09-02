'use client';

import { useCallback, useMemo, useState } from 'react';
import { expandPageRanges, formatPageRanges, parsePageRanges } from 'pdf-core';
import { useWorkspaceStore } from './store';

export interface PageSpec {
  /** O que aparece no campo. */
  readonly spec: string;
  readonly setSpec: (value: string) => void;
  /**
   * Causa crua do ultimo texto recusado, ou `null`. Quem exibe traduz por codigo — a
   * mensagem do nucleo e log, nunca tela.
   *
   * Vale a pena carregar a causa em vez de um booleano: "a pagina 9 nao existe (total 3)" e
   * "o fim vem antes do inicio" dizem o que corrigir, e uma frase generica nao diz.
   */
  readonly error: unknown;
  /** Paginas escolhidas, em indices base 0 da composicao. Vazio quando nada foi escolhido. */
  readonly indices: readonly number[];
  /**
   * A especificacao que deve ser EXECUTADA, sempre valida.
   *
   * Nao e `spec` nem `formatPageRanges(indices)`, e a diferenca importa: uma selecao e um
   * CONJUNTO de paginas e nao guarda fronteiras, entao `1-3, 4-6` e `1-6` teriam a mesma
   * selecao — e dividir por intervalo entregaria um arquivo onde o usuario pediu dois. Por
   * isso, quando o texto digitado e valido, e ele que manda; quando a escolha veio da grade,
   * manda a selecao.
   */
  readonly resolvedSpec: string;
}

interface Draft {
  readonly text: string;
  /**
   * Qual deve ser a especificacao derivada da selecao enquanto este rascunho vale.
   *
   * E o que dispensa `useEffect` para sincronizar os dois lados: se a selecao da grade mudar
   * por fora (um clique numa pagina), ela deixa de bater com `base`, o rascunho e abandonado
   * e o campo volta a espelhar a grade. Enquanto bater, quem manda e o texto digitado — e o
   * cursor nao pula no meio da digitacao.
   */
  readonly base: string;
  /** Causa do erro de leitura do texto, preservada para a tela traduzir por codigo. */
  readonly error: unknown;
}

/**
 * Liga o campo de intervalos a selecao da grade, nos dois sentidos.
 *
 * Clicar paginas escreve `1-3, 7-8` no campo; digitar `5-9` destaca essas paginas na grade.
 * Antes eram duas coisas independentes: a divisao lia SO o campo e ignorava a selecao, entao
 * escolher paginas na grade e mandar dividir nao fazia nada — sem mensagem, sem pista.
 *
 * A selecao e a fonte da verdade; o texto e uma vista dela. O rascunho existe apenas para
 * sobreviver ao estado intermediario da digitacao, em que `1-` ainda nao descreve nada.
 */
export function usePageSpec(): PageSpec {
  const items = useWorkspaceStore((state) => state.items);
  const selection = useWorkspaceStore((state) => state.selection);
  const setSelection = useWorkspaceStore((state) => state.setSelection);
  const [draft, setDraft] = useState<Draft | null>(null);

  const selectedIndices = useMemo(() => {
    const chosen = new Set(selection);
    return items.flatMap((item, index) => (chosen.has(item.key) ? [index] : []));
  }, [items, selection]);

  const selectionSpec = useMemo(() => formatPageRanges(selectedIndices), [selectedIndices]);

  const setSpec = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      if (trimmed === '') {
        setSelection([]);
        setDraft({ text: value, base: '', error: null });
        return;
      }

      let indices: readonly number[];
      try {
        indices = expandPageRanges(parsePageRanges(trimmed, items.length));
      } catch (cause) {
        /*
         * A selecao fica como esta, e o campo avisa. Apagar a escolha a cada tecla recusada
         * seria pior: `1-5` passa por `1` e `1-`, que a gramatica aceita, mas `3-1` e `9` num
         * documento de tres paginas sao enganos de verdade — e o usuario descobre agora, sem
         * ter escolhido destino nem esperado a geracao.
         */
        setDraft({ text: value, base: selectionSpec, error: cause });
        return;
      }

      setSelection(indices.flatMap((index) => (items[index] ? [items[index].key] : [])));
      setDraft({ text: value, base: formatPageRanges(indices), error: null });
    },
    [items, selectionSpec, setSelection],
  );

  const usingDraft = draft !== null && draft.base === selectionSpec;

  const digitadoVale = usingDraft && draft.error === null;

  return {
    spec: usingDraft ? draft.text : selectionSpec,
    setSpec,
    error: usingDraft ? draft.error : null,
    indices: selectedIndices,
    resolvedSpec: digitadoVale ? draft.text : selectionSpec,
  };
}
