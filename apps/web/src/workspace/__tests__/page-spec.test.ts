import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PdfCoreError } from 'pdf-core';
import { usePageSpec } from '../page-spec';
import { useWorkspaceStore } from '../store';

/**
 * O campo de intervalos e a selecao da grade sao a mesma escolha vista de dois jeitos.
 *
 * O risco desta ligacao e o laco: o campo escreve na selecao, a selecao reescreve o campo, e
 * o cursor pula no meio da digitacao. Por isso os testes exercitam as duas direcoes e, em
 * especial, o momento em que uma sobrepoe a outra.
 */

function carregar(paginas: number): void {
  useWorkspaceStore.getState().addDocument({ id: 'doc', name: 'a.pdf', pageCount: paginas });
}

/** Chave do item na posicao informada, do jeito que a grade a passaria ao clicar. */
function chave(posicao: number): string {
  const item = useWorkspaceStore.getState().items[posicao];
  if (item === undefined) throw new Error(`sem item na posicao ${posicao}`);
  return item.key;
}

beforeEach(() => {
  useWorkspaceStore.getState().reset();
});

describe('usePageSpec', () => {
  it('escreve no campo o que foi clicado na grade, agrupando o que e contiguo', () => {
    carregar(8);
    const { result } = renderHook(() => usePageSpec());

    expect(result.current.spec).toBe('');

    act(() => {
      for (const posicao of [0, 1, 2, 6]) {
        useWorkspaceStore.getState().toggleSelection(chave(posicao));
      }
    });

    expect(result.current.spec).toBe('1-3, 7');
    expect(result.current.indices).toEqual([0, 1, 2, 6]);
  });

  it('marca na grade o que foi digitado no campo', () => {
    carregar(8);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('5-8'));

    expect(result.current.indices).toEqual([4, 5, 6, 7]);
    expect(useWorkspaceStore.getState().selection).toEqual([
      chave(4),
      chave(5),
      chave(6),
      chave(7),
    ]);
  });

  it('preserva o texto digitado, sem reformatar embaixo do cursor', () => {
    carregar(20);
    const { result } = renderHook(() => usePageSpec());

    // `11-15, 1` descreve o mesmo conjunto que `1, 11-15`; reescrever seria mover o cursor.
    act(() => result.current.setSpec('11-15, 1'));

    expect(result.current.spec).toBe('11-15, 1');
    expect(result.current.indices).toEqual([0, 10, 11, 12, 13, 14]);
  });

  it('abandona o texto digitado quando a grade muda por fora', () => {
    carregar(8);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('1-3'));
    expect(result.current.spec).toBe('1-3');

    // Um clique numa pagina e uma intencao nova: o campo volta a espelhar a grade.
    act(() => useWorkspaceStore.getState().toggleSelection(chave(6)));

    expect(result.current.spec).toBe('1-3, 7');
  });

  it('recusa texto invalido sem apagar a escolha ja feita', () => {
    carregar(3);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('1-2'));
    act(() => result.current.setSpec('3-1'));

    expect(result.current.spec).toBe('3-1');
    // A selecao anterior sobrevive: reagir a cada tecla recusada destruiria o trabalho.
    expect(result.current.indices).toEqual([0, 1]);
    expect(result.current.error).toBeInstanceOf(PdfCoreError);
    expect((result.current.error as PdfCoreError).code).toBe('REVERSED_RANGE');
  });

  it('reporta o codigo do nucleo para pagina inexistente', () => {
    carregar(3);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('9'));

    expect((result.current.error as PdfCoreError).code).toBe('PAGE_DOES_NOT_EXIST');
  });

  it('aceita a forma aberta, que e por onde a digitacao passa', () => {
    carregar(5);
    const { result } = renderHook(() => usePageSpec());

    // Digitar `2-4` passa por `2` e `2-`; nenhum dos dois pode acusar erro.
    act(() => result.current.setSpec('2'));
    expect(result.current.error).toBeNull();

    act(() => result.current.setSpec('2-'));
    expect(result.current.error).toBeNull();
    expect(result.current.indices).toEqual([1, 2, 3, 4]);

    act(() => result.current.setSpec('2-4'));
    expect(result.current.error).toBeNull();
    expect(result.current.indices).toEqual([1, 2, 3]);
  });

  /**
   * Uma selecao e um CONJUNTO, e conjunto nao guarda fronteira. Ignorar isso fazia dividir
   * por intervalo entregar UM arquivo onde o usuario tinha pedido dois — defeito real,
   * apanhado pelo E2E depois de a implementacao parecer pronta.
   */
  describe('resolvedSpec preserva as fronteiras que a selecao perde', () => {
    it('mantem as faixas escritas, mesmo quando elas se encostam', () => {
      carregar(6);
      const { result } = renderHook(() => usePageSpec());

      act(() => result.current.setSpec('1-3, 4-6'));

      // A selecao funde as duas faixas; o texto continua dizendo que sao duas.
      expect(result.current.indices).toEqual([0, 1, 2, 3, 4, 5]);
      expect(result.current.resolvedSpec).toBe('1-3, 4-6');
    });

    it('usa a selecao quando a escolha veio da grade', () => {
      carregar(6);
      const { result } = renderHook(() => usePageSpec());

      act(() => {
        for (const posicao of [0, 1, 4]) {
          useWorkspaceStore.getState().toggleSelection(chave(posicao));
        }
      });

      expect(result.current.resolvedSpec).toBe('1-2, 5');
    });

    it('nunca entrega texto recusado a quem vai executar', () => {
      carregar(3);
      const { result } = renderHook(() => usePageSpec());

      act(() => result.current.setSpec('1-2'));
      act(() => result.current.setSpec('3-1'));

      expect(result.current.spec).toBe('3-1');
      expect(result.current.resolvedSpec).toBe('1-2');
    });

    it('volta a mandar no texto assim que a grade e sobreposta de novo', () => {
      carregar(6);
      const { result } = renderHook(() => usePageSpec());

      act(() => result.current.setSpec('1-3, 4-6'));
      // Um clique por fora abandona o rascunho: a fronteira digitada deixa de valer.
      act(() => useWorkspaceStore.getState().toggleSelection(chave(0)));

      expect(result.current.resolvedSpec).toBe('2-6');
    });
  });

  it('limpar o campo desmarca tudo', () => {
    carregar(4);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('1-4'));
    act(() => result.current.setSpec(''));

    expect(result.current.indices).toEqual([]);
    expect(useWorkspaceStore.getState().selection).toEqual([]);
  });

  it('sai do estado de erro quando o texto volta a ser valido', () => {
    carregar(3);
    const { result } = renderHook(() => usePageSpec());

    act(() => result.current.setSpec('9'));
    expect(result.current.error).not.toBeNull();

    act(() => result.current.setSpec('1-3'));
    expect(result.current.error).toBeNull();
    expect(result.current.indices).toEqual([0, 1, 2]);
  });
});
