/** Identificador de um documento carregado no workspace. */
export type SourceId = string;

export interface SourceDocument {
  readonly id: SourceId;
  readonly bytes: Uint8Array;
}

/**
 * Referencia a uma pagina de origem. Nao contem bytes: o documento final e descrito, nao
 * construido, ate que `buildComposition` seja chamado.
 */
export interface PageRef {
  readonly source: SourceId;
  /** Indice base 0 no documento de origem. */
  readonly pageIndex: number;
  /** Graus horarios adicionais, multiplo de 90. Somados a rotacao original da pagina. */
  readonly rotate?: number;
}

/**
 * A ordem final das paginas do documento montado.
 *
 * Reordenar, excluir e duplicar sao manipulacoes deste array — nenhum byte e tocado ate a
 * exportacao. E o que permite arrastar paginas na interface sem recodificar o PDF a cada
 * movimento, e o que torna desfazer trivial: basta guardar o array anterior.
 */
export type Composition = readonly PageRef[];
