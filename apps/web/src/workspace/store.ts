import { create } from 'zustand';
import {
  type CompositionItem,
  type LoadedDocument,
  itemsForDocument,
  moveItem,
  duplicateItems,
  pruneSelection,
  removeItems,
  rotateItems,
  toggleSelected,
} from './model';

/** Teto do historico: guardar tudo faria a memoria crescer sem limite numa sessao longa. */
const HISTORY_LIMIT = 50;

interface Snapshot {
  readonly items: readonly CompositionItem[];
  readonly selection: readonly string[];
}

export interface WorkspaceState {
  documents: LoadedDocument[];
  items: CompositionItem[];
  selection: string[];
  past: Snapshot[];
  future: Snapshot[];

  addDocument: (document: LoadedDocument) => void;
  removeDocument: (documentId: string) => void;

  moveItem: (from: number, to: number) => void;
  rotate: (keys: readonly string[], delta: number) => void;
  remove: (keys: readonly string[]) => void;
  duplicate: (keys: readonly string[]) => void;

  toggleSelection: (key: string) => void;
  /** Troca a selecao inteira de uma vez. Usado por quem digita intervalos em vez de clicar. */
  setSelection: (keys: readonly string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;

  /** Termo da busca aberta. Vazio significa busca desligada. */
  searchTerm: string;
  /** Paginas com pelo menos uma ocorrencia, na chave composta de documento e indice. */
  matchedPages: readonly string[];
  /** Quantas paginas carregadas tem texto extraivel; zero sugere documento so de imagem. */
  pagesWithText: number;
  setSearch: (term: string, matchedPages: readonly string[], pagesWithText: number) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  reset: () => void;
}

let keyCounter = 0;
/** Chaves previsiveis e sem dependencia de crypto: os testes precisam ser deterministicos. */
const makeKey = () => `item-${(keyCounter += 1)}`;

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  /**
   * Empilha o estado atual antes de alterar.
   *
   * Como a composicao e apenas um array de referencias, o historico e uma pilha de arrays —
   * nenhum byte de PDF esta envolvido. E o que torna desfazer barato o bastante para existir
   * desde o comeco, em vez de virar divida tecnica.
   */
  function commit(next: (state: WorkspaceState) => Partial<WorkspaceState>): void {
    set((state) => {
      const snapshot: Snapshot = { items: state.items, selection: state.selection };
      const patch = next(state);
      const items = patch.items ?? state.items;

      return {
        ...patch,
        selection: pruneSelection(items, patch.selection ?? state.selection),
        past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }

  return {
    documents: [],
    items: [],
    selection: [],
    past: [],
    future: [],
    searchTerm: '',
    matchedPages: [],
    pagesWithText: 0,

    addDocument: (document) =>
      commit((state) => ({
        documents: [...state.documents, document],
        items: [...state.items, ...itemsForDocument(document.id, document.pageCount, makeKey)],
      })),

    removeDocument: (documentId) =>
      commit((state) => ({
        documents: state.documents.filter((document) => document.id !== documentId),
        items: state.items.filter((item) => item.source !== documentId),
      })),

    moveItem: (from, to) => commit((state) => ({ items: moveItem(state.items, from, to) })),

    rotate: (keys, delta) => commit((state) => ({ items: rotateItems(state.items, keys, delta) })),

    remove: (keys) => commit((state) => ({ items: removeItems(state.items, keys) })),

    duplicate: (keys) => commit((state) => ({ items: duplicateItems(state.items, keys, makeKey) })),

    // Selecao fica fora do historico: desfazer deve reverter o documento, nao o foco.
    toggleSelection: (key) => set((state) => ({ selection: toggleSelected(state.selection, key) })),
    setSelection: (keys) => set((state) => ({ selection: pruneSelection(state.items, [...keys]) })),
    selectAll: () => set((state) => ({ selection: state.items.map((item) => item.key) })),
    clearSelection: () => set({ selection: [] }),

    // Busca tambem fica fora do historico, pelo mesmo motivo da selecao: desfazer reverte o
    // documento, nao o que o usuario estava procurando.
    setSearch: (searchTerm, matchedPages, pagesWithText) =>
      set({ searchTerm, matchedPages, pagesWithText }),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (previous === undefined) return state;
        return {
          items: [...previous.items],
          selection: pruneSelection(previous.items, previous.selection),
          past: state.past.slice(0, -1),
          future: [{ items: state.items, selection: state.selection }, ...state.future],
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (next === undefined) return state;
        return {
          items: [...next.items],
          selection: pruneSelection(next.items, next.selection),
          past: [...state.past, { items: state.items, selection: state.selection }],
          future: rest,
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    reset: () =>
      set({
        documents: [],
        items: [],
        selection: [],
        past: [],
        future: [],
        searchTerm: '',
        matchedPages: [],
        pagesWithText: 0,
      }),
  };
});
