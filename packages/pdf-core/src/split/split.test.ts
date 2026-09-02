import { describe, it, expect } from 'vitest';
import { extractPages, splitByRanges, splitBySize } from './split';
import { readPageCount } from '../composition/build';
import { createTextPdf } from '../fixtures';
import { extractAllText } from '../testing/index';

async function labelled(pages: number): Promise<Uint8Array> {
  return createTextPdf(
    Array.from({ length: pages }, (_unused, index) => [{ text: `PAGINA-${index + 1}`, y: 150 }]),
  );
}

describe('extractPages — um documento com o recorte pedido', () => {
  it('extrai o exemplo do documento de requisitos', async () => {
    const source = await labelled(20);
    const result = await extractPages(source, '1-5, 8, 11-15');

    expect(await readPageCount(result)).toBe(11);

    const text = await extractAllText(result);
    expect(text).toContain('PAGINA-1');
    expect(text).toContain('PAGINA-8');
    expect(text).toContain('PAGINA-15');
    expect(text).not.toContain('PAGINA-6');
    expect(text).not.toContain('PAGINA-9');
  });

  it('respeita a ordem escrita, mesmo fora de sequencia', async () => {
    const source = await labelled(5);
    const result = await extractPages(source, '4, 1');
    const single = await extractPages(result, '1');
    expect((await extractAllText(single)).trim()).toBe('PAGINA-4');
  });
});

describe('splitByRanges — um arquivo por intervalo', () => {
  it('produz um volume para cada intervalo informado', async () => {
    const source = await labelled(20);
    const volumes = await splitByRanges(source, '1-5, 8, 11-15');

    expect(volumes).toHaveLength(3);
    expect(await readPageCount(volumes[0]!)).toBe(5);
    expect(await readPageCount(volumes[1]!)).toBe(1);
    expect(await readPageCount(volumes[2]!)).toBe(5);
    expect((await extractAllText(volumes[1]!)).trim()).toBe('PAGINA-8');
  });

  it('nao perde nem duplica paginas ao cobrir o documento inteiro', async () => {
    const source = await labelled(9);
    const volumes = await splitByRanges(source, '1-3, 4-6, 7-9');

    const counts = await Promise.all(volumes.map((volume) => readPageCount(volume)));
    expect(counts.reduce((total, count) => total + count, 0)).toBe(9);
  });
});

describe('splitBySize — volumes dentro de um limite de bytes', () => {
  it('respeita o limite e preserva todas as paginas', async () => {
    const source = await labelled(12);
    const whole = await extractPages(source, '1-');
    // Limite proximo de um terco do documento, para forcar varios volumes.
    const limit = Math.ceil(whole.length / 3);

    const { volumes, oversizedPages } = await splitBySize(source, limit);

    expect(oversizedPages).toEqual([]);
    expect(volumes.length).toBeGreaterThan(1);
    for (const volume of volumes) expect(volume.length).toBeLessThanOrEqual(limit);

    const counts = await Promise.all(volumes.map((volume) => readPageCount(volume)));
    expect(counts.reduce((total, count) => total + count, 0)).toBe(12);
  });

  it('mantem a ordem original das paginas ao longo dos volumes', async () => {
    const source = await labelled(8);
    const whole = await extractPages(source, '1-');
    const { volumes } = await splitBySize(source, Math.ceil(whole.length / 2));

    const texts: string[] = [];
    for (const volume of volumes) texts.push(await extractAllText(volume));
    const joined = texts.join(' ');

    expect(joined.indexOf('PAGINA-1')).toBeLessThan(joined.indexOf('PAGINA-8'));
  });

  it('sinaliza pagina que sozinha excede o limite, em vez de entregar volume maior em silencio', async () => {
    const source = await labelled(3);
    // Limite absurdamente pequeno: nenhuma pagina cabe.
    const { volumes, oversizedPages } = await splitBySize(source, 200);

    expect(oversizedPages).toEqual([0, 1, 2]);
    expect(volumes).toHaveLength(3);
  });

  it('reporta progresso pagina a pagina', async () => {
    const source = await labelled(4);
    const events: [number, number][] = [];

    await splitBySize(source, 10_000_000, {
      onProgress: (completed, total) => events.push([completed, total]),
    });

    expect(events).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('cabendo tudo num volume, nao divide', async () => {
    const source = await labelled(3);
    const { volumes } = await splitBySize(source, 10_000_000);
    expect(volumes).toHaveLength(1);
    expect(await readPageCount(volumes[0]!)).toBe(3);
  });

  it('rejeita limite invalido', async () => {
    const source = await labelled(2);
    await expect(splitBySize(source, 0)).rejects.toMatchObject({ code: 'INVALID_MAX_BYTES' });
  });
});

describe('cancelamento cooperativo', () => {
  it('interrompe splitBySize quando o sinal e abortado', async () => {
    const source = await labelled(10);
    const controller = new AbortController();

    const promise = splitBySize(source, 1000, {
      signal: controller.signal,
      onProgress: (completed) => {
        if (completed === 2) controller.abort();
      },
    });

    await expect(promise).rejects.toThrow(/cancelada/i);
  });

  it('interrompe splitByRanges quando o sinal ja vem abortado', async () => {
    const source = await labelled(6);
    const controller = new AbortController();
    controller.abort();

    await expect(splitByRanges(source, '1-2, 3-4', { signal: controller.signal })).rejects.toThrow(
      /cancelada/i,
    );
  });

  it('nao interfere quando nenhum sinal e informado', async () => {
    const source = await labelled(4);
    const { volumes } = await splitBySize(source, 10_000_000);
    expect(volumes).toHaveLength(1);
  });
});
