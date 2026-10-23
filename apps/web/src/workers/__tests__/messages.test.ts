import { describe, expect, it } from 'vitest';
import { PdfCoreError, coreError, isPdfCoreError } from 'pdf-core';
import {
  describeError,
  isAbortError,
  isEnvelope,
  restoreError,
  toErrorPayload,
  toTransferable,
} from '../messages';

describe('envelope de mensagens', () => {
  it('reconhece so objetos com kind e id textuais', () => {
    expect(isEnvelope({ kind: 'progress', id: '1' })).toBe(true);
    expect(isEnvelope({ kind: 'progress' })).toBe(false);
    expect(isEnvelope({ kind: 1, id: '1' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope('progress')).toBe(false);
  });

  it('descreve erro e valor qualquer', () => {
    expect(describeError(new Error('quebrou'))).toBe('quebrou');
    expect(describeError('texto')).toBe('texto');
  });
});

describe('erro atravessando o postMessage', () => {
  it('leva codigo e parametros do nucleo e os reconstroi do outro lado', () => {
    const original = coreError('PAGE_DOES_NOT_EXIST', { part: '9', page: 9, total: 3 }, 'log');

    // O clone estruturado e o que o postMessage faz; e nele que campos proprios se perdem.
    const payload = structuredClone(toErrorPayload('op-1', original));
    const restaurado = restoreError(payload);

    expect(payload).toMatchObject({ kind: 'error', id: 'op-1', code: 'PAGE_DOES_NOT_EXIST' });
    expect(isPdfCoreError(restaurado)).toBe(true);
    expect((restaurado as PdfCoreError).code).toBe('PAGE_DOES_NOT_EXIST');
    expect((restaurado as PdfCoreError).params).toEqual({ part: '9', page: 9, total: 3 });
  });

  it('erro comum vira erro comum, sem codigo inventado', () => {
    const payload = toErrorPayload('op-2', new Error('falha do navegador'));
    const restaurado = restoreError(payload);

    expect(payload.code).toBeUndefined();
    expect(isPdfCoreError(restaurado)).toBe(false);
    expect(restaurado.message).toBe('falha do navegador');
  });
});

describe('isAbortError', () => {
  it('so o AbortError do DOM conta como cancelamento', () => {
    expect(isAbortError(new DOMException('parou', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('outra', 'NotFoundError'))).toBe(false);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
  });
});

describe('toTransferable', () => {
  it('devolve exatamente a janela de bytes da visao, num buffer proprio', () => {
    const grande = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const janela = grande.subarray(2, 5);

    const buffer = toTransferable(janela);

    expect([...new Uint8Array(buffer)]).toEqual([2, 3, 4]);
    // Transferir nao pode destacar o buffer de quem ainda usa a visao original.
    expect(buffer).not.toBe(grande.buffer);
  });
});
