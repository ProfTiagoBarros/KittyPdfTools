import { GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist';

/**
 * Aponta o pdf.js para os arquivos servidos pela aplicacao.
 *
 * **Uma chamada so, com o diretorio base**, e nao uma funcao por asset. O motivo e um defeito
 * real: por muito tempo o produto configurava apenas o worker, e o pdf.js ficava sem as fontes
 * padrao, os CMaps, o wasm dos decodificadores e os perfis ICC. O sintoma era enganoso —
 * documentos simples renderizavam, e a miniatura sumia so nos que dependiam desses recursos.
 * Com um parametro unico nao existe "esqueci de configurar um".
 *
 * Nao e um hook do React, apesar de `configure` parecer nome de efeito: e chamada no topo de
 * um worker, onde hook nenhum pode ser chamado.
 *
 * Quem conhece o caminho dos assets e o app, nao o nucleo — e eles precisam ser arquivos
 * locais empacotados, nunca um CDN, sob pena de quebrar a Regra de Ouro 4 (offline no
 * Desktop) e a Regra de Ouro 1 (nenhuma requisicao externa).
 *
 * Dentro de um Worker, caminho iniciado por barra nao resolve contra a origem da pagina:
 * passe URL absoluta (`new URL('/pdfjs/', self.location.origin).href`).
 */
export function configurePdfjs(baseUrl: string): void {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;

  assets = {
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  };
}

interface PdfjsAssets {
  readonly standardFontDataUrl: string;
  readonly cMapUrl: string;
  readonly wasmUrl: string;
  readonly iccUrl: string;
}

let assets: PdfjsAssets | null = null;

interface CanvasAndContext {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

/**
 * Fabrica de canvas sem DOM.
 *
 * A padrao do pdf.js e a `DOMCanvasFactory`, que chama `document.createElement('canvas')`.
 * Dentro de um Web Worker `document` nao existe, e o erro que chega e
 * `Cannot read properties of undefined (reading 'createElement')` — sem dizer que a causa e o
 * ambiente.
 *
 * **O sintoma engana feio:** pagina so de texto renderiza normalmente, porque esse caminho
 * nunca precisa de um canvas auxiliar. Quem precisa e imagem, padrao e sombreado — logotipo,
 * grafico, tabela com fundo. Por isso o defeito se apresenta como "nao aparece a miniatura de
 * alguns documentos", e nao como "a renderizacao esta quebrada".
 */
class OffscreenCanvasFactory {
  readonly #willReadFrequently: boolean;

  constructor({ enableHWA = false }: { enableHWA?: boolean } = {}) {
    this.#willReadFrequently = !enableHWA;
  }

  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');

    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext('2d', { willReadFrequently: this.#willReadFrequently }),
    };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (canvasAndContext.canvas === null) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');

    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (canvasAndContext.canvas === null) throw new Error('Canvas is not specified');

    // Zerar antes de soltar libera a memoria grafica na hora, como manda a Regra de Ouro 3.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Fabrica de filtros que nao filtra nada.
 *
 * A padrao monta filtros SVG no documento, o que exige DOM. Devolver `'none'` e exatamente o
 * que a classe base do pdf.js faz, e o que a versao dele para Node usa. O efeito visivel e
 * ausencia de ajuste em modo de alto contraste; o desenho da pagina continua correto.
 */
class NoFilterFactory {
  addFilter(): string {
    return 'none';
  }
  addHCMFilter(): string {
    return 'none';
  }
  addAlphaFilter(): string {
    return 'none';
  }
  addLuminosityFilter(): string {
    return 'none';
  }
  addKnockoutFilter(): string {
    return 'none';
  }
  addHighlightHCMFilter(): string {
    return 'none';
  }
  addSelectionHCMFilter(): string {
    return 'none';
  }
  addSelectionFilter(): string {
    return 'none';
  }
  destroy(): void {
    // Nada a liberar: nenhum no foi criado.
  }
}

/**
 * Opcoes de abertura comuns a toda leitura de PDF no navegador.
 *
 * Centralizado de proposito: renderizar e verificar precisam enxergar o mesmo documento. Se a
 * verificacao abrisse sem os assets, ela aprovaria um arquivo que a tela nao consegue desenhar.
 */
export interface DocumentOptionsConfig {
  /**
   * Entrega o buffer ao pdf.js em vez de uma copia dele.
   *
   * O pdf.js transfere os dados para o seu worker, e quem chamou nao pode mais usa-los. Por
   * isso o padrao e copiar. Mas copiar tem preco: com um PDF de 150 MB, o worker de
   * renderizacao guardava o arquivo DUAS vezes (a sua copia e a do pdf.js), e com dois
   * arquivos abertos eram 287 MB a mais morando no processo sem uso. Quem nao vai reler os
   * bytes deve adotar, e pedir de volta com `getData()` quando precisar.
   */
  readonly adopt?: boolean;
}

/**
 * Entrega ao pdf.js so as faixas do arquivo que ele pede.
 *
 * Abrir com o arquivo inteiro na memoria custava o tamanho dele so para contar as paginas: oito
 * PDFs escaneados de 70 a 95 MB eram lidos por inteiro ao abrir, e o que o pdf.js realmente le
 * para isso e o fim do arquivo, a tabela de objetos e o catalogo. Uma miniatura le a pagina e
 * a imagem dela, nada mais. Fatias de um `Blob` sao leituras de disco, sem copiar o resto.
 */
class BlobRangeTransport extends PDFDataRangeTransport {
  constructor(private readonly file: Blob) {
    super(file.size, null);
  }

  override requestDataRange(begin: number, end: number): void {
    void this.file
      .slice(begin, end)
      .arrayBuffer()
      .then((chunk) => this.onDataRange(begin, new Uint8Array(chunk)))
      // Sem dados, o pdf.js fica esperando: devolver nada faz a leitura falhar com erro dele,
      // que chega a quem abriu, em vez de travar a pagina.
      .catch((cause: unknown) => {
        console.error('Falha ao ler faixa do arquivo', { begin, end }, cause);
        this.onDataRange(begin, null);
      });
  }
}

/** Faixas de 512 KB: uma pagina escaneada (~700 KB) sai em duas leituras, e nao em onze. */
const RANGE_CHUNK_BYTES = 512 * 1024;

export function pdfjsDocumentOptions(pdf: Uint8Array | Blob, config: DocumentOptionsConfig = {}) {
  const source =
    pdf instanceof Blob
      ? {
          range: new BlobRangeTransport(pdf),
          length: pdf.size,
          rangeChunkSize: RANGE_CHUNK_BYTES,
          // Le so o que e pedido; sem isso o pdf.js baixaria o resto em segundo plano.
          disableAutoFetch: true,
          disableStream: true,
        }
      : { data: config.adopt === true ? pdf : new Uint8Array(pdf) };

  return {
    ...source,

    /*
     * Sem `@font-face`, e por isso sem DOM.
     *
     * Com `useSystemFonts` ligado, o pdf.js tenta registrar a fonte no `document.fonts` e a
     * leitura inteira falha com `document is not defined`. A armadilha e que isso so aparece
     * DEPOIS de publicar `standardFontDataUrl`: sem os dados da fonte ele nunca chegava a
     * tentar. Com `disableFontFace`, os glifos sao desenhados como caminhos.
     */
    useSystemFonts: false,
    disableFontFace: true,

    /*
     * Explicito, e nao pelo padrao — o padrao TOCA em `document`.
     *
     * Em `getDocument` o pdf.js decide `useWorkerFetch` sozinho quando a opcao vem ausente, e
     * a expressao dessa decisao le `document.baseURI` (pdf.mjs, v6.3). Basta fornecer os
     * quatro URLs de asset para essa linha ser alcancada — e dentro de um Web Worker ela
     * levanta `document is not defined`, derrubando a abertura do PDF inteira.
     */
    useWorkerFetch: true,

    /*
     * As fabricas padrao supoem DOM. Estas nao supoem — e e por isso que o produto consegue
     * desenhar dentro de um Web Worker.
     *
     * **O worker proprio do pdf.js nunca sobe aqui, e nao ha como faze-lo subir.**
     * `PDFWorker.#initialize` le `window.location` antes de criar o Worker; num Web Worker
     * isso lanca, ele engole a excecao e cai no "fake worker", que interpreta o PDF no mesmo
     * contexto. Isso NAO viola a Regra de Ouro 2: o trabalho pesado continua fora da main
     * thread, dentro do nosso worker de renderizacao. O que esse caminho exige e justamente
     * que nada no desenho dependa de DOM.
     */
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,

    cMapPacked: true,
    ...(assets ?? {}),
  };
}
