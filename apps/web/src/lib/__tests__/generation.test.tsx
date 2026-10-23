import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Destination } from '../save-pdf';
import { useGeneration, type GenerationAround } from '../generation';

const chooseDestination = vi.fn<(name: string) => Promise<Destination | null>>();
const writeTo = vi.fn<(destination: Destination, bytes: Uint8Array) => Promise<void>>();
const discardDestination = vi.fn<(destination: Destination) => Promise<void>>();
const copySaved = vi.fn<(source: string, destination: Destination) => Promise<void>>();
const savePdf = vi.fn<(bytes: Uint8Array, name: string) => Promise<void>>();

vi.mock('../save-pdf', () => ({
  chooseDestination: (name: string) => chooseDestination(name),
  writeTo: (destination: Destination, bytes: Uint8Array) => writeTo(destination, bytes),
  discardDestination: (destination: Destination) => discardDestination(destination),
  copySaved: (source: string, destination: Destination) => copySaved(source, destination),
  savePdf: (bytes: Uint8Array, name: string) => savePdf(bytes, name),
}));

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const NO_DISCO: Destination = { kind: 'system', path: 'C:\\saida\\contrato.pdf' };
const NO_NAVEGADOR: Destination = { kind: 'browser', fileName: 'contrato.pdf' };

/** Registra a ordem em que as etapas do fluxo acontecem. */
function registrar() {
  const ordem: string[] = [];
  const etapa = <T,>(nome: string, valor: T) => () => {
    ordem.push(nome);
    return Promise.resolve(valor);
  };
  chooseDestination.mockImplementation(etapa('destino', NO_DISCO));
  writeTo.mockImplementation(etapa('gravar', undefined));
  const around: GenerationAround = {
    before: etapa('liberar', undefined),
    after: etapa('restaurar', undefined),
  };
  const produce = vi.fn(etapa('gerar', BYTES));
  return { ordem, around, produce };
}

describe('useGeneration', () => {
  beforeEach(() => {
    for (const mock of [chooseDestination, writeTo, discardDestination, copySaved, savePdf]) {
      mock.mockReset();
    }
    writeTo.mockResolvedValue(undefined);
    discardDestination.mockResolvedValue(undefined);
    copySaved.mockResolvedValue(undefined);
    savePdf.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('escolhe o destino ANTES de gerar, e restaura a memoria so DEPOIS de gravar', async () => {
    const { ordem, around, produce } = registrar();
    const { result } = renderHook(() => useGeneration());

    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce, around }));

    await waitFor(() => expect(result.current.last).not.toBeNull());
    expect(ordem).toEqual(['destino', 'liberar', 'gerar', 'gravar', 'restaurar']);
    expect(produce).toHaveBeenCalledWith(expect.any(Function), 'contrato.pdf');
    expect(result.current.running).toBe(false);
  });

  it('cancelar o seletor nao gera, nao libera memoria e nao mostra erro', async () => {
    const { around, produce } = registrar();
    chooseDestination.mockResolvedValue(null);
    const before = vi.spyOn(around, 'before');
    const { result } = renderHook(() => useGeneration());

    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce, around }));

    await waitFor(() => expect(chooseDestination).toHaveBeenCalled());
    expect(produce).not.toHaveBeenCalled();
    expect(before).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('falha ao gerar: descarta o destino vazio, restaura a memoria e traduz o erro', async () => {
    const { ordem, around } = registrar();
    const produce = vi.fn(() => {
      ordem.push('gerar');
      return Promise.reject(new Error('quebrou'));
    });
    const { result } = renderHook(() => useGeneration());

    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce, around }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    await waitFor(() => expect(result.current.running).toBe(false));
    // Sem descartar, o Android deixaria um arquivo de 0 bytes no lugar escolhido.
    expect(discardDestination).toHaveBeenCalledWith(NO_DISCO);
    expect(writeTo).not.toHaveBeenCalled();
    expect(ordem).toEqual(['destino', 'liberar', 'gerar', 'restaurar']);
    expect(result.current.last).toBeNull();
  });

  it('falha ao liberar memoria nao impede a geracao', async () => {
    const { produce } = registrar();
    const after = vi.fn(() => Promise.resolve());
    const around: GenerationAround = { before: () => Promise.reject(new Error('sem memoria')), after };
    const { result } = renderHook(() => useGeneration());

    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce, around }));

    await waitFor(() => expect(result.current.last).not.toBeNull());
    // Nada foi liberado, entao nada ha para restaurar.
    expect(after).not.toHaveBeenCalled();
  });

  it('no app instalado, lembra o CAMINHO gravado e nao os bytes', async () => {
    const { produce } = registrar();
    const { result } = renderHook(() => useGeneration());

    act(() => result.current.run({ suggestedName: 'x.pdf', produce }));

    await waitFor(() => expect(result.current.last).not.toBeNull());
    expect(result.current.last).toEqual({
      name: 'contrato.pdf',
      source: { kind: 'disk', path: NO_DISCO.path },
    });
  });

  it('na web, guarda os bytes de arquivo pequeno e esquece os de arquivo grande', async () => {
    chooseDestination.mockResolvedValue(NO_NAVEGADOR);
    const pequeno = renderHook(() => useGeneration());
    act(() => pequeno.result.current.run({ suggestedName: 'a.pdf', produce: () => Promise.resolve(BYTES) }));
    await waitFor(() => expect(pequeno.result.current.last).not.toBeNull());
    expect(pequeno.result.current.last?.source).toEqual({ kind: 'memory', bytes: BYTES });

    const enorme = new Uint8Array(50 * 1024 * 1024 + 1);
    const grande = renderHook(() => useGeneration());
    act(() => grande.result.current.run({ suggestedName: 'b.pdf', produce: () => Promise.resolve(enorme) }));
    await waitFor(() => expect(grande.result.current.last).not.toBeNull());
    expect(grande.result.current.last?.source).toBeNull();
  });

  it('salvar de novo no app instalado COPIA o arquivo ja gravado', async () => {
    const { produce } = registrar();
    const { result } = renderHook(() => useGeneration());
    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce }));
    await waitFor(() => expect(result.current.last).not.toBeNull());

    const outro: Destination = { kind: 'system', path: 'D:\\copia.pdf' };
    chooseDestination.mockResolvedValue(outro);
    act(() => result.current.saveAgain());

    await waitFor(() => expect(copySaved).toHaveBeenCalledWith(NO_DISCO.path, outro));
    expect(produce).toHaveBeenCalledOnce();
    expect(savePdf).not.toHaveBeenCalled();
  });

  it('salvar de novo quando o arquivo sumiu do disco mostra erro com saida', async () => {
    const { produce } = registrar();
    copySaved.mockRejectedValue(new Error('nao encontrado'));
    const { result } = renderHook(() => useGeneration());
    act(() => result.current.run({ suggestedName: 'contrato.pdf', produce }));
    await waitFor(() => expect(result.current.last).not.toBeNull());

    act(() => result.current.saveAgain());

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('salvar de novo na web entrega os bytes guardados', async () => {
    chooseDestination.mockResolvedValue(NO_NAVEGADOR);
    const { result } = renderHook(() => useGeneration());
    act(() => result.current.run({ suggestedName: 'a.pdf', produce: () => Promise.resolve(BYTES) }));
    await waitFor(() => expect(result.current.last).not.toBeNull());

    act(() => result.current.saveAgain());

    await waitFor(() => expect(savePdf).toHaveBeenCalledWith(BYTES, 'contrato.pdf'));
    expect(copySaved).not.toHaveBeenCalled();
  });
});
