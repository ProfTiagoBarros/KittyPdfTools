import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { writeComposition } from './build';
import { concatChunks } from './writer';

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

/**
 * Origem cujas paginas carregam um fluxo nao comprimido com uma marca legivel.
 *
 * A marca faz o papel da imagem escaneada: e o conteudo pesado que o gravador precisa emitir e
 * soltar antes de carregar a proxima origem.
 */
async function comMarcas(nome: string, paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let indice = 0; indice < paginas; indice += 1) {
    const page = doc.addPage([200 + indice, 300]);
    const marca = doc.context.register(doc.context.stream(`MARCA-${nome}-${indice}`));
    page.node.set(PDFName.of('Marca'), marca);
  }
  return doc.save({ useObjectStreams: false });
}

describe('writeComposition', () => {
  it('grava o conteudo de cada origem ANTES de carregar a proxima', async () => {
    const a = await comMarcas('A', 2);
    const b = await comMarcas('B', 2);
    const eventos: string[] = [];

    await writeComposition(
      [
        { id: 'a', load: () => (eventos.push('carrega a'), Promise.resolve(a)) },
        { id: 'b', load: () => (eventos.push('carrega b'), Promise.resolve(b)) },
      ],
      [
        { source: 'a', pageIndex: 0 },
        { source: 'b', pageIndex: 1 },
        { source: 'a', pageIndex: 1 },
      ],
      (chunk) => {
        const texto = latin1(chunk);
        for (const marca of ['MARCA-A-0', 'MARCA-A-1', 'MARCA-B-1']) {
          if (texto.includes(marca)) eventos.push(`grava ${marca}`);
        }
      },
    );

    // O que prova o fluxo: as marcas de A saem antes de B ser sequer lida.
    expect(eventos).toEqual([
      'carrega a',
      'grava MARCA-A-0',
      'grava MARCA-A-1',
      'carrega b',
      'grava MARCA-B-1',
    ]);
  });

  it('emite varios pedacos que, juntos, formam um PDF valido na ordem pedida', async () => {
    const a = await comMarcas('A', 3);
    const pedacos: Uint8Array[] = [];

    const tamanho = await writeComposition(
      [{ id: 'a', load: () => Promise.resolve(a) }],
      [
        { source: 'a', pageIndex: 2, rotate: 90 },
        { source: 'a', pageIndex: 0 },
      ],
      (chunk) => {
        pedacos.push(chunk);
      },
    );

    const pdf = concatChunks(pedacos);
    expect(pedacos.length).toBeGreaterThan(5);
    expect(pdf.length).toBe(tamanho);

    const lido = await PDFDocument.load(pdf, { throwOnInvalidObject: true });
    expect(lido.getPageCount()).toBe(2);
    // Largura identifica a pagina de origem (200 + indice).
    expect(lido.getPage(0).getWidth()).toBe(202);
    expect(lido.getPage(0).getRotation().angle).toBe(90);
    expect(lido.getPage(1).getWidth()).toBe(200);
    // O conteudo pesado sai uma vez so, mesmo passando pelo contexto e pelo gravador.
    expect(latin1(pdf).split('MARCA-A-2').length - 1).toBe(1);
    expect(latin1(pdf)).not.toContain('MARCA-A-1');
  });

  it('cada entrada da tabela xref aponta exatamente para o seu objeto', async () => {
    const a = await comMarcas('A', 2);
    const b = await comMarcas('B', 1);
    const pedacos: Uint8Array[] = [];
    await writeComposition(
      [
        { id: 'a', load: () => Promise.resolve(a) },
        { id: 'b', load: () => Promise.resolve(b) },
      ],
      [
        { source: 'b', pageIndex: 0 },
        { source: 'a', pageIndex: 1 },
      ],
      (chunk) => {
        pedacos.push(chunk);
      },
    );
    const texto = latin1(concatChunks(pedacos));

    // Os objetos saem fora de ordem (paginas por ultimo); a tabela precisa compensar.
    const inicioXref = Number(/startxref\n(\d+)\n%%EOF$/.exec(texto)?.[1]);
    const [cabecalho, ...linhas] = texto.slice(inicioXref).split('\n').slice(1);
    const total = Number(cabecalho?.split(' ')[1]);
    expect(total).toBeGreaterThan(3);

    let conferidos = 0;
    linhas.slice(0, total).forEach((linha, numero) => {
      const [offset, , tipo] = linha.trim().split(' ');
      if (tipo !== 'n') return;
      expect(texto.startsWith(`${numero} 0 obj`, Number(offset))).toBe(true);
      conferidos += 1;
    });
    expect(conferidos).toBe(total - 1);
  });

  it('a falha ao ler uma origem chega a quem chamou', async () => {
    await expect(
      writeComposition(
        [{ id: 'a', load: () => Promise.reject(new Error('arquivo sumiu')) }],
        [{ source: 'a', pageIndex: 0 }],
        () => undefined,
      ),
    ).rejects.toThrow('arquivo sumiu');
  });
});
