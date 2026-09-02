import { zipSync } from 'fflate';

import { coreError } from '../errors';

export interface ArchiveEntry {
  /** Nome do arquivo dentro do pacote. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Empacota os volumes de uma divisao num unico arquivo.
 *
 * Dividir e a unica operacao que produz VARIOS arquivos, e isso a tornava a excecao na
 * interface: enquanto as outras entregavam um arquivo direto, ela listava volumes para o
 * usuario baixar um a um. Entregar um pacote unico devolve a divisao ao mesmo fluxo das
 * demais — uma pergunta de nome, um destino, um arquivo.
 *
 * **Sem compressao, de proposito.** O conteudo de um PDF ja esta comprimido (streams
 * FlateDecode); comprimir de novo gasta CPU — que no celular e o recurso escasso — para
 * economizar quase nada. O ZIP aqui serve para AGRUPAR, nao para encolher.
 */
export function packVolumes(entries: readonly ArchiveEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw coreError('EMPTY_ARCHIVE', {}, 'nao ha volumes para empacotar');
  }

  const conteudo: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const entry of entries) {
    conteudo[entry.name] = [entry.bytes, { level: 0 }];
  }

  return zipSync(conteudo);
}

/**
 * Nomes dos volumes derivados do nome escolhido para o pacote.
 *
 * `contrato.zip` vira `contrato-1.pdf`, `contrato-2.pdf`... Assim o usuario reconhece de onde
 * vieram depois de descompactar, mesmo semanas depois.
 */
export function volumeNames(archiveName: string, total: number): readonly string[] {
  const base = archiveName.replace(/\.zip$/i, '') || 'pdfkitty';
  const largura = String(total).length;

  return Array.from(
    { length: total },
    (_unused, indice) => `${base}-${String(indice + 1).padStart(largura, '0')}.pdf`,
  );
}
