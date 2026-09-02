/** Descompactor de stream Flate. Node usa `zlib`; o navegador, `DecompressionStream`. */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array | undefined>;

const encoder = new TextEncoder();

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;

  const last = haystack.length - needle.length;
  outer: for (let start = from; start <= last; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function utf16beBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = code >> 8;
    bytes[i * 2 + 1] = code & 0xff;
  }
  return bytes;
}

/**
 * As representacoes do mesmo texto que podem aparecer dentro de um PDF.
 *
 * Nao e paranoia: o pdf-lib grava operadores de texto como string hexadecimal
 * (`<4350462D...> Tj`), e nao como ASCII literal. Um verificador que so procura a forma
 * literal responde "nao encontrado" para um documento que expoe o segredo por inteiro.
 */
function encodingsOf(needle: string): Uint8Array[] {
  const literal = latin1Bytes(needle);
  const hex = toHex(literal);
  const utf16 = utf16beBytes(needle);
  const utf16Hex = toHex(utf16);

  return [
    literal,
    encoder.encode(hex.toUpperCase()),
    encoder.encode(hex.toLowerCase()),
    utf16,
    encoder.encode(utf16Hex.toUpperCase()),
    encoder.encode(utf16Hex.toLowerCase()),
  ];
}

/**
 * Procura o texto nos bytes do arquivo, inclusive dentro de streams comprimidos.
 *
 * LIMITACAO CONHECIDA: texto quebrado entre operadores por ajuste de kerning
 * (`[(CP)-10(F)] TJ`) escapa da busca contigua. Essa lacuna e coberta pela verificacao por
 * extracao de texto, que reconstroi a string como um leitor faria.
 */
export async function existsInFileBytes(
  pdf: Uint8Array,
  needle: string,
  inflate: Inflate,
): Promise<boolean> {
  const candidates = encodingsOf(needle);
  if (containsAny(pdf, candidates)) return true;

  for (const stream of extractStreams(pdf)) {
    const inflated = await inflate(stream);
    if (inflated !== undefined && containsAny(inflated, candidates)) return true;
  }

  return false;
}

/**
 * Detecta atualizacao incremental, em que a versao anterior do documento — com o conteudo
 * sensivel intacto — continua guardada dentro do arquivo.
 */
export function hasIncrementalHistory(pdf: Uint8Array): boolean {
  return countOccurrences(pdf, '%%EOF') > 1 || indexOfBytes(pdf, latin1Bytes('/Prev')) !== -1;
}

function containsAny(haystack: Uint8Array, candidates: readonly Uint8Array[]): boolean {
  return candidates.some((candidate) => indexOfBytes(haystack, candidate) !== -1);
}

function countOccurrences(haystack: Uint8Array, needle: string): number {
  const target = latin1Bytes(needle);
  let count = 0;
  let from = 0;

  for (;;) {
    const at = indexOfBytes(haystack, target, from);
    if (at === -1) return count;
    count += 1;
    from = at + target.length;
  }
}

function extractStreams(pdf: Uint8Array): Uint8Array[] {
  const streams: Uint8Array[] = [];
  const open = latin1Bytes('stream');
  const close = latin1Bytes('endstream');
  let from = 0;

  for (;;) {
    const start = indexOfBytes(pdf, open, from);
    if (start === -1) return streams;

    let dataStart = start + open.length;
    if (pdf[dataStart] === 0x0d) dataStart += 1;
    if (pdf[dataStart] === 0x0a) dataStart += 1;

    const end = indexOfBytes(pdf, close, dataStart);
    if (end === -1) return streams;

    // A especificacao exige uma quebra de linha antes de `endstream`. Ela nao faz parte dos
    // dados comprimidos, e `DecompressionStream` — ao contrario do zlib do Node — recusa o
    // stream inteiro se houver qualquer byte sobrando no fim.
    let dataEnd = end;
    while (dataEnd > dataStart) {
      const last = pdf[dataEnd - 1];
      if (last !== 0x0a && last !== 0x0d) break;
      dataEnd -= 1;
    }

    streams.push(pdf.subarray(dataStart, dataEnd));
    from = end + close.length;
  }
}
