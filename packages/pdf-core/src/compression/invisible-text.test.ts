import { describe, it, expect } from 'vitest';
import { stripInvisibleText } from './invisible-text';

/**
 * O tokenizador e a peca que pode corromper um documento, entao os testes atacam por onde uma
 * expressao regular ingenua quebraria: strings que contem os proprios operadores, imagens
 * embutidas com bytes arbitrarios, e blocos que misturam modos de renderizacao.
 */
describe('stripInvisibleText', () => {
  it('remove o bloco escrito em modo invisivel', () => {
    const { conteudo, report } = stripInvisibleText('BT /F1 12 Tf 3 Tr 10 20 Td (oculto) Tj ET');

    expect(report.removidos).toBe(1);
    expect(conteudo).not.toContain('oculto');
  });

  it('preserva o bloco que pinta de verdade', () => {
    const fonte = 'BT /F1 12 Tf 10 20 Td (visivel) Tj ET';
    const { conteudo, report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(report.mantidos).toBe(1);
    expect(conteudo).toBe(fonte);
  });

  it('remove so o bloco invisivel, mantendo o que veio antes e depois', () => {
    // O `q ... Q` em volta do bloco invisivel importa: `Tr` e estado grafico e sobrevive ao
    // `ET`, entao sem restaurar o estado o texto seguinte seria invisivel DE VERDADE — e
    // remove-lo estaria certo. E a restauracao que separa "camada de OCR" de "pagina".
    const { conteudo } = stripInvisibleText(
      '0.5 0 0 RG 1 w BT (antes) Tj ET q BT 3 Tr (some) Tj ET Q BT (depois) Tj ET',
    );

    expect(conteudo).toContain('antes');
    expect(conteudo).toContain('depois');
    expect(conteudo).not.toContain('some');
    // O que nao e texto atravessa intacto: apagar o estado grafico mudaria o desenho.
    expect(conteudo).toContain('0.5 0 0 RG');
  });

  /**
   * O caso que derruba busca por texto: os proprios operadores aparecem DENTRO de uma string
   * literal. Um `replace` sobre o stream apagaria pedaco de pagina de verdade.
   */
  it('nao confunde operadores escritos dentro de uma string', () => {
    const fonte = 'BT (ET BT 3 Tr fim) Tj ET';
    const { conteudo, report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(conteudo).toBe(fonte);
  });

  it('respeita parentese escapado dentro da string', () => {
    const fonte = 'BT (aviso \\) 3 Tr) Tj ET';
    const { conteudo, report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(conteudo).toBe(fonte);
  });

  it('atravessa imagem embutida sem interpretar o binario dela', () => {
    // O "conteudo" da imagem carrega de proposito uma sequencia que parece um bloco de texto.
    const fonte = 'q BI /W 4 /H 4 /BPC 8 ID BT 3 Tr (x) Tj ET EI Q BT (fica) Tj ET';
    const { conteudo, report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(conteudo).toBe(fonte);
  });

  /**
   * Regra deliberada: na duvida, PRESERVA. Apagar conteudo real e irreversivel; deixar de
   * economizar bytes nao e.
   */
  it('mantem o bloco que alterna entre invisivel e visivel', () => {
    const fonte = 'BT 3 Tr (oculto) Tj 0 Tr (aparece) Tj ET';
    const { report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(report.mantidos).toBe(1);
  });

  /**
   * O `addInvisibleTextLayer` embrulha cada palavra num `q ... Q`. Podar so o miolo deixava
   * os pares no arquivo: 1.200 bytes de ruido por pagina de 300 palavras, medidos.
   */
  it('leva junto o q/Q que embrulhava o bloco removido', () => {
    const { conteudo, report } = stripInvisibleText('(antes) Tj q BT 3 Tr (x) Tj ET Q (depois) Tj');

    expect(report.removidos).toBe(1);
    expect(conteudo).not.toContain('q');
    expect(conteudo).not.toContain('Q');
    expect(conteudo).toContain('antes');
    expect(conteudo).toContain('depois');
  });

  it('nao leva o q quando falta o Q correspondente', () => {
    // Meio par nao pode sair: desequilibrar a pilha mudaria o desenho do resto da pagina.
    const { conteudo, report } = stripInvisibleText('q BT 3 Tr (x) Tj ET (segue) Tj Q');

    expect(report.removidos).toBe(1);
    expect(conteudo.trimStart().startsWith('q')).toBe(true);
    expect(conteudo.trimEnd().endsWith('Q')).toBe(true);
  });

  it('o modo invisivel nao vaza para fora do q/Q que o definiu', () => {
    const { report } = stripInvisibleText('q 3 Tr BT (oculto) Tj ET Q BT (visivel) Tj ET');

    expect(report.removidos).toBe(1);
    expect(report.mantidos).toBe(1);
  });

  it('herda o modo de renderizacao vigente quando o bloco nao o define', () => {
    // `3 Tr` fora do bloco continua valendo dentro dele: Tr e estado grafico.
    const { report } = stripInvisibleText('3 Tr BT (herdado) Tj ET');
    expect(report.removidos).toBe(1);

    const normal = stripInvisibleText('0 Tr BT (herdado) Tj ET');
    expect(normal.report.removidos).toBe(0);
  });

  it('ignora bloco de texto que nao escreve nada', () => {
    const fonte = 'BT /F1 12 Tf 10 20 Td ET';
    const { conteudo, report } = stripInvisibleText(fonte);

    expect(report.removidos).toBe(0);
    expect(report.mantidos).toBe(0);
    expect(conteudo).toBe(fonte);
  });

  it('trata os quatro operadores que pintam texto', () => {
    for (const operador of ['Tj', 'TJ', "'", '"']) {
      const carga = operador === 'TJ' ? '[(a)]' : '(a)';
      const { report } = stripInvisibleText(`BT 3 Tr ${carga} ${operador} ET`);
      expect(report.removidos, operador).toBe(1);
    }
  });

  it('nao mexe num stream sem texto algum', () => {
    const fonte = '1 0 0 1 50 50 cm /Im0 Do';
    expect(stripInvisibleText(fonte).conteudo).toBe(fonte);
  });

  it('devolve string vazia intacta', () => {
    expect(stripInvisibleText('').conteudo).toBe('');
  });
});
