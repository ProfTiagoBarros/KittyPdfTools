import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { coreError } from '../errors';
import { stripInvisibleText } from './invisible-text';

export interface RepackOptions {
  /**
   * Remove a camada de texto invisivel do OCR.
   *
   * Desligado por padrao: o texto e o que torna o documento pesquisavel, e apagar isso sem
   * pedir seria decidir pelo usuario o que ele veio decidir.
   */
  readonly removeInvisibleText?: boolean;
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface RepackResult {
  readonly pdf: Uint8Array;
  readonly originalBytes: number;
  /** Blocos de texto invisivel removidos, somando todas as paginas. */
  readonly invisibleBlocksRemoved: number;
}

/**
 * Reduz o tamanho SEM alterar uma unica pagina visualmente.
 *
 * Dois ganhos, ambos estruturais:
 *
 * 1. **Fluxos de objetos.** O `addInvisibleTextLayer` salva com `useObjectStreams: false`, e
 *    o arquivo fica com cada objeto gravado solto. Reempacotar com fluxos de objetos rendeu
 *    10,6% num documento medido — pouco sozinho, mas de graca.
 * 2. **Content streams comprimidos.** O pdf-lib grava sem compressao o que ele proprio
 *    acrescenta; aqui tudo volta comprimido.
 *
 * Opcionalmente remove a camada de OCR, que num documento denso e milhares de operadores de
 * texto. Isso NAO e sem perda — perde-se a busca —, e por isso a interface pergunta.
 *
 * O que esta funcao **nao** faz e mexer nas imagens, que sao o peso real de um documento
 * digitalizado. Para isso existe `compressByRasterizing`, que perde qualidade e avisa.
 */
export async function repackLossless(
  pdfBytes: Uint8Array,
  options: RepackOptions = {},
): Promise<RepackResult> {
  const document = await PDFDocument.load(pdfBytes);
  const total = document.getPageCount();

  if (options.removeInvisibleText !== true) {
    // Sem poda, reempacotar e literalmente reabrir e regravar: nada se perde, nem
    // marcadores, nem links, nem metadados.
    const pdf = await document.save({ useObjectStreams: true });
    return { pdf, originalBytes: pdfBytes.length, invisibleBlocksRemoved: 0 };
  }

  let invisibleBlocksRemoved = 0;
  for (let pageIndex = 0; pageIndex < total; pageIndex += 1) {
    invisibleBlocksRemoved += reescreverPagina(document, pageIndex);
    options.onProgress?.(pageIndex + 1, total);
  }

  /*
   * Reescrever o `Contents` NAO basta para o arquivo encolher.
   *
   * O pdf-lib grava todo objeto que esta no contexto, alcancavel ou nao — `context.delete()`
   * inclusive foi medido sem efeito aqui. O stream antigo do OCR continuava no arquivo, ao
   * lado do novo, e o resultado ficava MAIOR do que se nada fosse feito.
   *
   * Copiar as paginas para um documento novo percorre o grafo a partir delas, entao o que
   * ninguem mais aponta simplesmente nao viaja. E a coleta de lixo que o pdf-lib nao tem.
   *
   * O preco e o mesmo de `buildComposition`: marcadores e links internos ficam para tras.
   * Os metadados sao levados a mao logo abaixo, por serem o que o usuario percebe.
   */
  const output = await PDFDocument.create();
  const copiadas = await output.copyPages(document, document.getPageIndices());
  for (const pagina of copiadas) output.addPage(pagina);
  transferirMetadados(document, output);

  const pdf = await output.save({ useObjectStreams: true });
  return { pdf, originalBytes: pdfBytes.length, invisibleBlocksRemoved };
}

/** Leva adiante o que identifica o documento; o resto do grafo nao sobrevive a copia. */
function transferirMetadados(origem: PDFDocument, destino: PDFDocument): void {
  const titulo = origem.getTitle();
  if (titulo !== undefined) destino.setTitle(titulo);
  const autor = origem.getAuthor();
  if (autor !== undefined) destino.setAuthor(autor);
  const assunto = origem.getSubject();
  if (assunto !== undefined) destino.setSubject(assunto);
  const palavrasChave = origem.getKeywords();
  if (palavrasChave !== undefined) destino.setKeywords([palavrasChave]);
  const criacao = origem.getCreationDate();
  if (criacao !== undefined) destino.setCreationDate(criacao);
}

/** Reescreve os content streams de uma pagina sem a camada invisivel. Devolve quantos sairam. */
function reescreverPagina(document: PDFDocument, pageIndex: number): number {
  const page = document.getPage(pageIndex);
  const context = document.context;

  // `Contents` pode ser UM stream ou um ARRAY deles, e um bloco `BT ... ET` tem permissao
  // de comecar num e terminar no seguinte. Por isso tudo e concatenado antes da analise:
  // ler cada stream isoladamente veria um `BT` sem `ET` e desistiria da pagina.
  const conteudos = page.node.Contents();
  if (conteudos === undefined) return 0;

  const brutos =
    conteudos instanceof PDFArray
      ? conteudos.asArray().map((entrada) => context.lookup(entrada))
      : [conteudos];

  const pedacos: string[] = [];
  for (const stream of brutos) {
    // Qualquer coisa fora do esperado faz a pagina passar intacta. Uma otimizacao que
    // arrisca corromper o documento nao vale o espaco que economiza.
    if (!(stream instanceof PDFRawStream)) return 0;
    pedacos.push(deBytes(decodePDFRawStream(stream).decode()));
  }

  const { conteudo, report } = stripInvisibleText(pedacos.join('\n'));
  if (report.removidos === 0) return 0;

  const substituto = context.flateStream(paraBytes(conteudo));
  page.node.set(PDFName.of('Contents'), context.register(substituto));
  return report.removidos;
}

/**
 * Content stream e binario, mas os operadores sao ASCII.
 *
 * Latin-1 e a unica conversao que sobrevive a ida e volta byte a byte: cada byte vira
 * exatamente um caractere, inclusive o interior de uma imagem embutida, que atravessa a
 * analise sem ser interpretado.
 */
function deBytes(bytes: Uint8Array): string {
  let texto = '';
  const PEDACO = 0x8000;
  for (let i = 0; i < bytes.length; i += PEDACO) {
    texto += String.fromCharCode(...bytes.subarray(i, i + PEDACO));
  }
  return texto;
}

function paraBytes(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i) & 0xff;
  return bytes;
}

/** Quanto do arquivo sobrou, em porcentagem, para a interface relatar sem recalcular. */
export function reductionPercent(before: number, after: number): number {
  if (before <= 0) throw coreError('INVALID_MAX_BYTES', { maxBytes: before }, 'tamanho invalido');
  return Math.max(0, Math.round((1 - after / before) * 100));
}
