import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
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
import type { SearchOutcome } from './search';

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
  /** Ocorrencias do termo por pagina de origem, na mesma chave de `matchedPages`. */
  matchCounts: Readonly<Record<string, number>>;
  /** Quantas paginas carregadas tem texto extraivel; zero sugere documento so de imagem. */
  pagesWithText: number;
  setSearch: (term: string, outcome: SearchOutcome) => void;
  /** Cartao em foco na navegacao entre ocorrencias, pela chave do item. */
  activeMatch: string | null;
  setActiveMatch: (key: string | null) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  reset: () => void;
}

let keyCounter = 0;
/** Chaves previsiveis e sem dependencia de crypto: os testes precisam ser deterministicos. */
const makeKey = () => `item-${(keyCounter += 1)}`;

export type WorkspaceStore = StoreApi<WorkspaceState>;

/** Um espaco de trabalho: arquivos abertos, composicao, selecao, historico e busca. */
export function createWorkspaceStore(): WorkspaceStore {
  return createStore<WorkspaceState>()((set, get) => {
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
      matchCounts: {},
      activeMatch: null,

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

      rotate: (keys, delta) =>
        commit((state) => ({ items: rotateItems(state.items, keys, delta) })),

      remove: (keys) => commit((state) => ({ items: removeItems(state.items, keys) })),

      duplicate: (keys) =>
        commit((state) => ({ items: duplicateItems(state.items, keys, makeKey) })),

      // Selecao fica fora do historico: desfazer deve reverter o documento, nao o foco.
      toggleSelection: (key) =>
        set((state) => ({ selection: toggleSelected(state.selection, key) })),
      setSelection: (keys) =>
        set((state) => ({ selection: pruneSelection(state.items, [...keys]) })),
      selectAll: () => set((state) => ({ selection: state.items.map((item) => item.key) })),
      clearSelection: () => set({ selection: [] }),

      // Busca tambem fica fora do historico, pelo mesmo motivo da selecao: desfazer reverte o
      // documento, nao o que o usuario estava procurando.
      // Termo novo, resultado novo: a pagina em foco da busca anterior nao significa mais nada.
      setSearch: (searchTerm, { matchedPages, occurrences, pagesWithText }) =>
        set({
          searchTerm,
          matchedPages,
          matchCounts: occurrences,
          pagesWithText,
          activeMatch: null,
        }),
      setActiveMatch: (activeMatch) => set({ activeMatch }),

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
          matchCounts: {},
          activeMatch: null,
        }),
    };
  });
}

/**
 * Os arquivos da SESSAO: abertos numa ferramenta, continuam abertos nas outras.
 *
 * Dividir e a excecao e tem os seus. Dividir age sobre um documento so; enxergar os arquivos
 * que o usuario juntou em "Unir e extrair" faria dele outra forma de juntar e recortar —
 * redundante com a ferramenta ao lado.
 */
export const sessionStore = createWorkspaceStore();
export const splitStore = createWorkspaceStore();

const WorkspaceStoreContext = createContext<WorkspaceStore>(sessionStore);

/** Troca o espaco de trabalho de uma subarvore. Sem provedor, vale o da sessao. */
export const WorkspaceStoreProvider = WorkspaceStoreContext.Provider;

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useContext(WorkspaceStoreContext), selector);
}

/** O store do contexto, para ler fora do render (em callbacks) sem assinar mudancas. */
export function useWorkspaceStoreApi(): WorkspaceStore {
  return useContext(WorkspaceStoreContext);
}

/**
 * Todo documento aberto, em qualquer espaco de trabalho.
 *
 * Os workers sao um so para os dois espacos. Quem libera a memoria de TODOS precisa reabrir
 * TODOS: reabrir so os do espaco atual deixaria a grade do outro esperando para sempre por
 * documentos que ninguem devolveu.
 */
export function openDocumentIds(): string[] {
  return [sessionStore, splitStore].flatMap((store) =>
    store.getState().documents.map((document) => document.id),
  );
}
