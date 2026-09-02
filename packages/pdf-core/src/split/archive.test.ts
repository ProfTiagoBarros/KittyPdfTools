import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';

import { packVolumes, volumeNames } from './archive';
import { PdfCoreError } from '../errors';

const bytes = (texto: string) => new TextEncoder().encode(texto);

describe('packVolumes', () => {
  it('devolve um ZIP com um arquivo por volume, intactos', () => {
    const pacote = packVolumes([
      { name: 'contrato-1.pdf', bytes: bytes('%PDF-1.4 primeiro') },
      { name: 'contrato-2.pdf', bytes: bytes('%PDF-1.4 segundo') },
    ]);

    // Assinatura do formato: sem isto, "gerou alguma coisa" passaria por sucesso.
    expect([...pacote.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const dentro = unzipSync(pacote);
    expect(Object.keys(dentro).sort()).toEqual(['contrato-1.pdf', 'contrato-2.pdf']);
    expect(new TextDecoder().decode(dentro['contrato-1.pdf'])).toBe('%PDF-1.4 primeiro');
    expect(new TextDecoder().decode(dentro['contrato-2.pdf'])).toBe('%PDF-1.4 segundo');
  });

  it('nao comprime: o conteudo ja comprimido do PDF nao encolheria', () => {
    // Bytes aleatorios nao comprimem. Se houvesse compressao ligada, o pacote ficaria MAIOR
    // que a soma dos volumes por causa do custo de tentar — o teste denuncia a troca.
    const conteudo = new Uint8Array(4096);
    for (let i = 0; i < conteudo.length; i += 1) conteudo[i] = (Math.random() * 256) | 0;

    const pacote = packVolumes([{ name: 'a.pdf', bytes: conteudo }]);

    // O ZIP guarda o conteudo cru mais cabecalhos; a folga cobre isso sem esconder inchaco.
    expect(pacote.length).toBeGreaterThanOrEqual(conteudo.length);
    expect(pacote.length).toBeLessThan(conteudo.length + 512);
  });

  it('recusa empacotar nada, com codigo proprio', () => {
    expect(() => packVolumes([])).toThrow(PdfCoreError);
    try {
      packVolumes([]);
    } catch (erro) {
      expect((erro as PdfCoreError).code).toBe('EMPTY_ARCHIVE');
    }
  });
});

describe('volumeNames', () => {
  it('deriva os nomes do pacote escolhido pelo usuario', () => {
    expect(volumeNames('contrato.zip', 3)).toEqual([
      'contrato-1.pdf',
      'contrato-2.pdf',
      'contrato-3.pdf',
    ]);
  });

  it('alinha a numeracao quando ha dois digitos, para ordenar certo na pasta', () => {
    const nomes = volumeNames('x.zip', 10);
    expect(nomes[0]).toBe('x-01.pdf');
    expect(nomes[9]).toBe('x-10.pdf');
  });

  it('aceita nome sem extensao', () => {
    expect(volumeNames('relatorio', 1)).toEqual(['relatorio-1.pdf']);
  });
});
