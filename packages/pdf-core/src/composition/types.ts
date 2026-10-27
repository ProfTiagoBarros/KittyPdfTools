/** Identificador de um documento carregado no workspace. */
export type SourceId = string;

export interface SourceDocument {
  readonly id: SourceId;
  readonly bytes: Uint8Array;
}

/**
 * Origem lida so quando chega a vez dela.
 *
 * E o que deixa unir oito arquivos de 90 MB sem ter os oito na memoria: quem guarda o arquivo
 * (o `File` do seletor, no disco) entrega os bytes da origem da vez e mais nenhum.
 */
export interface LazySource {
  readonly id: SourceId;
  readonly load: () => Promise<Uint8Array>;
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
