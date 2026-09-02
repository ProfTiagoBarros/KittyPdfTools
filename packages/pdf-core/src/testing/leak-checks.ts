import { inflateSync } from 'node:zlib';
import { loadWithPdfjs } from './pdfjs';
import {
  existsInFileBytes as existsInBytes,
  extractTextFrom,
  hasIncrementalHistory,
  type Inflate,
} from '../verification/index';

/**
 * Adaptador de inflate para Node.
 *
 * `inflateSync` e sincrono, mas a porta `Inflate` e assincrona porque o navegador usa
 * `DecompressionStream`, que so existe em versao assincrona.
 */
const nodeInflate: Inflate = (data) => {
  try {
    return Promise.resolve(new Uint8Array(inflateSync(data)));
  } catch {
    // stream nao comprimido com Flate, ou imagem: nada a fazer
    return Promise.resolve(undefined);
  }
};

export async function extractAllText(pdf: Uint8Array): Promise<string> {
  const { doc, dispose } = await loadWithPdfjs(pdf);
  const text = await extractTextFrom(doc);
  await dispose();
  return text;
}

export async function existsInFileBytes(pdf: Uint8Array, needle: string): Promise<boolean> {
  return existsInBytes(pdf, needle, nodeInflate);
}

export { hasIncrementalHistory };
