import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface LoadedPdf {
  readonly doc: pdfjs.PDFDocumentProxy;
  /** Libera o worker do pdf.js. `destroy` vive na tarefa de carregamento, nao no documento. */
  readonly dispose: () => Promise<void>;
}

/** Carrega um PDF com pdf.js. O build `legacy` e o que funciona fora do navegador. */
export async function loadWithPdfjs(pdf: Uint8Array): Promise<LoadedPdf> {
  // pdf.js assume posse do buffer; uma copia evita corromper o original do chamador.
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const doc = await task.promise;
  return { doc, dispose: () => task.destroy() };
}

export { pdfjs };
