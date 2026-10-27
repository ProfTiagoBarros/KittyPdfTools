import {
  PDFName,
  PDFRawStream,
  PDFTrailer,
  PDFTrailerDict,
  type PDFRef,
  type PDFContext,
  type PDFObject,
} from '@cantoo/pdf-lib';

/** Para onde vao os pedacos do arquivo, na ordem. Pode ser assincrono: o gravador espera. */
export type ChunkSink = (chunk: Uint8Array) => void | Promise<void>;

const ASCII = new TextEncoder();

/**
 * Grava um PDF objeto por objeto, sem nunca montar o arquivo inteiro na memoria.
 *
 * O `save()` do pdf-lib calcula o tamanho final e aloca UM buffer desse tamanho, com o
 * documento inteiro ainda vivo no contexto — duas copias do resultado ao mesmo tempo. Medido
 * unindo 816 paginas escaneadas (551 MB): o processo passava de 3 GB e a tela do app ficava
 * preta. Aqui cada objeto vira um pedaco assim que fica pronto, e quem chama pode solta-lo do
 * contexto em seguida (`release`), entao o pico e o de UMA origem, nao o do resultado.
 *
 * O formato e o mesmo do pdf-lib (cabecalho, `n g obj ... endobj`, tabela xref classica e
 * trailer), mas os objetos podem sair fora de ordem — a tabela e ordenada no fim.
 */
export class StreamingPdfWriter {
  private readonly offsets = new Map<number, number>();
  private position = 0;

  private constructor(
    private readonly context: PDFContext,
    private readonly sink: ChunkSink,
  ) {}

  static async start(context: PDFContext, sink: ChunkSink): Promise<StreamingPdfWriter> {
    const writer = new StreamingPdfWriter(context, sink);
    const header = new Uint8Array(context.header.sizeInBytes() + 2);
    const offset = context.header.copyBytesInto(header, 0);
    header[offset] = 0x0a;
    header[offset + 1] = 0x0a;
    await writer.emit(header);
    return writer;
  }

  /** Bytes gravados ate agora. */
  get size(): number {
    return this.position;
  }

  /**
   * Grava os objetos indicados e os SOLTA do contexto.
   *
   * Soltar e o que faz o pico cair: o conteudo das imagens deixa de ser alcancavel e o coletor
   * pode recupera-lo antes da proxima origem. Quem chama garante que nada mais vai alterar
   * esses objetos — so a referencia a eles continua valida.
   */
  async writeAndRelease(refs: readonly PDFRef[]): Promise<void> {
    for (const ref of refs) {
      const object = this.context.lookup(ref);
      if (object !== undefined) await this.writeObject(ref, object);
      this.context.delete(ref);
    }
  }

  /** Grava tudo o que restou no contexto, a tabela xref e o trailer. */
  async finish(): Promise<number> {
    const restantes = this.context
      .enumerateIndirectObjects()
      .filter(([ref]) => !this.offsets.has(ref.objectNumber));
    for (const [ref, object] of restantes) await this.writeObject(ref, object);

    const xrefOffset = this.position;
    await this.emit(ASCII.encode(this.xrefTable()));

    const trailerInfo = this.context.trailerInfo;
    const dict = PDFTrailerDict.of(
      this.context.obj({
        Size: this.context.largestObjectNumber + 1,
        Root: trailerInfo.Root,
        ...(trailerInfo.Info === undefined ? {} : { Info: trailerInfo.Info }),
        ...(trailerInfo.ID === undefined ? {} : { ID: trailerInfo.ID }),
      }),
    );
    const trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefOffset);
    const fim = new Uint8Array(dict.sizeInBytes() + 2 + trailer.sizeInBytes());
    let offset = dict.copyBytesInto(fim, 0);
    fim[offset++] = 0x0a;
    fim[offset++] = 0x0a;
    trailer.copyBytesInto(fim, offset);
    await this.emit(fim);

    return this.position;
  }

  private async writeObject(ref: PDFRef, object: PDFObject): Promise<void> {
    // Contêineres de fluxo de objetos e de xref vindos da origem: o pdf-lib ja os expandiu em
    // objetos soltos, e grava-los de novo duplicaria o conteudo (o `save()` faz o mesmo).
    if (object instanceof PDFRawStream) {
      const type = object.dict.lookup(PDFName.of('Type'));
      if (type === PDFName.of('ObjStm') || type === PDFName.of('XRef')) return;
    }

    const head = ASCII.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const tail = ASCII.encode('\nendobj\n\n');
    const chunk = new Uint8Array(head.length + object.sizeInBytes() + tail.length);
    chunk.set(head, 0);
    const end = head.length + object.copyBytesInto(chunk, head.length);
    chunk.set(tail, end);

    this.offsets.set(ref.objectNumber, this.position);
    await this.emit(chunk);
  }

  /**
   * Tabela classica numa secao so, de 0 ate o maior numero de objeto.
   *
   * Numeros nunca gravados (contêineres pulados) entram como livres, encadeados como manda a
   * especificacao: cada entrada livre aponta para a proxima, e a ultima volta a zero.
   */
  private xrefTable(): string {
    const total = this.context.largestObjectNumber + 1;
    const livres: number[] = [];
    for (let numero = 1; numero < total; numero += 1) {
      if (!this.offsets.has(numero)) livres.push(numero);
    }

    const proximoLivre = new Map<number, number>();
    [0, ...livres].forEach((numero, indice) => proximoLivre.set(numero, livres[indice] ?? 0));

    const linhas = [`xref\n0 ${total}\n`];
    for (let numero = 0; numero < total; numero += 1) {
      const offset = this.offsets.get(numero);
      linhas.push(
        offset === undefined
          ? `${pad(proximoLivre.get(numero) ?? 0, 10)} ${numero === 0 ? '65535' : '00001'} f \n`
          : `${pad(offset, 10)} 00000 n \n`,
      );
    }
    return `${linhas.join('')}\n`;
  }

  private async emit(chunk: Uint8Array): Promise<void> {
    this.position += chunk.length;
    await this.sink(chunk);
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Junta os pedacos num arquivo so: para quem precisa do PDF inteiro em memoria. */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((soma, chunk) => soma + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
