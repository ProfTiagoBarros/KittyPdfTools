import type { Rect } from '../geometry';

/** Uma regiao a ser ofuscada, ancorada numa pagina especifica. */
export interface RedactionArea {
  /** Indice da pagina, base 0. */
  readonly pageIndex: number;
  readonly rect: Rect;
}

/** Uma pagina ja convertida em imagem, com o conteudo sensivel destruido no nivel do pixel. */
export interface RasterPage {
  readonly png: Uint8Array;
  /** Dimensoes da pagina em pontos, ja considerando rotacao. */
  readonly widthPt: number;
  readonly heightPt: number;
  /** Dimensoes do bitmap. O OCR reporta caixas nestas coordenadas. */
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RasterizeRequest {
  readonly pageIndex: number;
  /** Multiplicador de resolucao. 2 equivale a ~144 DPI. */
  readonly scale: number;
  /**
   * Regioes pintadas de preto sobre o bitmap ANTES da codificacao em PNG.
   * Pintar sobre pixels e destrutivo: nao existe camada por baixo para recuperar.
   */
  readonly blackout: readonly Rect[];
}

/**
 * Porta de saida do nucleo. O navegador implementa com OffscreenCanvas; os testes, com um
 * canvas nativo em Node. O nucleo nao sabe qual dos dois esta em uso.
 *
 * CONTRATO: o rasterizador ja esta ligado a um documento aberto, que deve ser o MESMO
 * passado a `redactByRasterizing`. Manter o documento aberto entre paginas evita reabrir e
 * reinterpretar o PDF inteiro a cada pagina ofuscada.
 */
export interface PageRasterizer {
  rasterize(request: RasterizeRequest): Promise<RasterPage>;
}
