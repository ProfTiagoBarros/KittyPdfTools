import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkspaceStore, sessionStore, splitStore } from './store';

const doc = (id: string, pageCount: number) => ({ id, name: `${id}.pdf`, pageCount });
const state = () => sessionStore.getState();
const keys = () => state().items.map((item) => item.key);
const pages = () => state().items.map((item) => `${item.source}:${item.pageIndex}`);
const firstKey = () => {
  const key = keys()[0];
  if (key === undefined) throw new Error('workspace vazio');
  return key;
};

beforeEach(() => {
  state().reset();
});

describe('carregar documentos', () => {
  it('acrescenta uma pagina por pagina do documento', () => {
    state().addDocument(doc('a', 3));
    expect(pages()).toEqual(['a:0', 'a:1', 'a:2']);
  });

  it('acumula documentos preservando a ordem de chegada (US-01)', () => {
    state().addDocument(doc('a', 2));
    state().addDocument(doc('b', 1));
    expect(pages()).toEqual(['a:0', 'a:1', 'b:0']);
  });

  it('da chave propria a cada item, mesmo apontando para a mesma origem', () => {
    state().addDocument(doc('a', 2));
    expect(new Set(keys()).size).toBe(2);
  });

  it('remover um documento tira suas paginas e mantem as demais', () => {
    state().addDocument(doc('a', 2));
    state().addDocument(doc('b', 2));
    state().removeDocument('a');
    expect(pages()).toEqual(['b:0', 'b:1']);
  });
});

describe('reordenar, girar, excluir e duplicar', () => {
  beforeEach(() => {
    state().addDocument(doc('a', 3));
  });

  it('move uma pagina de posicao', () => {
    state().moveItem(0, 2);
    expect(pages()).toEqual(['a:1', 'a:2', 'a:0']);
  });

  it('gira acumulando sobre a rotacao anterior', () => {
    state().rotate([firstKey()], 90);
    state().rotate([firstKey()], 90);
    expect(state().items[0]?.rotate).toBe(180);
  });

  it('normaliza a rotacao ao passar de uma volta completa', () => {
    state().rotate([firstKey()], 270);
    state().rotate([firstKey()], 180);
    expect(state().items[0]?.rotate).toBe(90);
  });

  it('gira varias paginas de uma vez (acao em lote)', () => {
    state().rotate(keys().slice(0, 2), 90);
    expect(state().items.map((item) => item.rotate)).toEqual([90, 90, 0]);
  });

  it('exclui as paginas indicadas', () => {
    state().remove([keys()[1]!]);
    expect(pages()).toEqual(['a:0', 'a:2']);
  });

  it('duplica logo apos a original, com chave nova', () => {
    state().duplicate([firstKey()]);
    expect(pages()).toEqual(['a:0', 'a:0', 'a:1', 'a:2']);
    expect(new Set(keys()).size).toBe(4);
  });

  it('rejeita movimento fora do intervalo', () => {
    expect(() => state().moveItem(0, 9)).toThrow(/invalido/);
  });
});

describe('selecao', () => {
  beforeEach(() => {
    state().addDocument(doc('a', 3));
  });

  it('alterna a selecao de uma pagina', () => {
    state().toggleSelection(firstKey());
    expect(state().selection).toHaveLength(1);
    state().toggleSelection(state().selection[0]!);
    expect(state().selection).toEqual([]);
  });

  it('excluir uma pagina tambem a remove da selecao', () => {
    state().selectAll();
    state().remove([firstKey()]);
    expect(state().selection).toHaveLength(2);
  });

  it('limpar a selecao nao mexe nas paginas', () => {
    state().selectAll();
    state().clearSelection();
    expect(state().selection).toEqual([]);
    expect(state().items).toHaveLength(3);
  });
});

describe('desfazer e refazer', () => {
  beforeEach(() => {
    state().addDocument(doc('a', 3));
  });

  it('desfaz uma exclusao', () => {
    state().remove([firstKey()]);
    expect(state().items).toHaveLength(2);
    state().undo();
    expect(pages()).toEqual(['a:0', 'a:1', 'a:2']);
  });

  it('refaz o que foi desfeito', () => {
    state().moveItem(0, 2);
    state().undo();
    state().redo();
    expect(pages()).toEqual(['a:1', 'a:2', 'a:0']);
  });

  it('uma alteracao nova descarta o futuro', () => {
    state().moveItem(0, 2);
    state().undo();
    expect(state().canRedo()).toBe(true);
    state().rotate([firstKey()], 90);
    expect(state().canRedo()).toBe(false);
  });

  it('nao ha o que desfazer num workspace recem-aberto', () => {
    state().reset();
    expect(state().canUndo()).toBe(false);
    state().undo();
    expect(state().items).toEqual([]);
  });

  it('selecionar nao entra no historico', () => {
    // Desfazer deve reverter o documento, nunca o foco do usuario.
    const before = state().past.length;
    state().selectAll();
    state().toggleSelection(firstKey());
    expect(state().past.length).toBe(before);
  });

  it('o historico tem teto, para nao crescer sem limite', () => {
    for (let round = 0; round < 80; round += 1) state().rotate([firstKey()], 90);
    expect(state().past.length).toBeLessThanOrEqual(50);
  });
});

describe('espacos de trabalho separados', () => {
  beforeEach(() => splitStore.getState().reset());

  it('o arquivo do Dividir nao aparece na sessao, nem o contrario', () => {
    state().addDocument(doc('juntos', 2));
    splitStore.getState().addDocument(doc('dividir', 5));

    expect(state().documents.map((d) => d.id)).toEqual(['juntos']);
    expect(splitStore.getState().documents.map((d) => d.id)).toEqual(['dividir']);
  });

  it('desfazer num espaco nao mexe no outro', () => {
    state().addDocument(doc('a', 2));
    splitStore.getState().addDocument(doc('b', 2));

    splitStore.getState().undo();

    expect(splitStore.getState().items).toHaveLength(0);
    expect(state().items).toHaveLength(2);
  });

  it('as chaves nao colidem entre espacos', () => {
    const outro = createWorkspaceStore();
    state().addDocument(doc('a', 3));
    outro.getState().addDocument(doc('b', 3));

    const todas = [...keys(), ...outro.getState().items.map((item) => item.key)];
    expect(new Set(todas).size).toBe(6);
  });
});

describe('busca', () => {
  it('termo novo tira o foco da ocorrencia da busca anterior', () => {
    state().addDocument(doc('a', 2));
    state().setActiveMatch(firstKey());

    state().setSearch('outro', { matchedPages: [], occurrences: {}, pagesWithText: 2 });

    expect(state().activeMatch).toBeNull();
  });
});
