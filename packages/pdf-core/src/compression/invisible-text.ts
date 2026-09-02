/**
 * Remove a camada de texto invisivel de um content stream.
 *
 * O OCR (US-04) torna a pagina pesquisavel escrevendo cada palavra com modo de renderizacao
 * 3 — presente no arquivo, invisivel na tela. Isso custa espaco: um operador por palavra,
 * gravado sem compressao pelo pdf-lib. Num documento denso sao milhares deles.
 *
 * Aqui a camada e desfeita, e SO ela: blocos de texto que pintam alguma coisa ficam intactos.
 * A pagina continua visualmente identica; o que se perde e a busca.
 *
 * POR QUE UM TOKENIZADOR, E NAO UMA EXPRESSAO REGULAR: um content stream carrega strings
 * literais `(...)` e imagens embutidas `BI ... ID <binario> EI`. Dentro delas pode haver
 * qualquer sequencia de bytes, inclusive `BT`, `ET` e `3 Tr`. Casar texto as cegas apagaria
 * pedaco de pagina — e o defeito so apareceria em alguns documentos, que e o pior modo de
 * falhar.
 */

/** Operadores que efetivamente desenham texto. Se nenhum aparece, o bloco nao pinta nada. */
const OPERADORES_DE_TEXTO = new Set(['Tj', 'TJ', "'", '"']);

const ESPACO = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIMITADOR = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

interface Token {
  readonly texto: string;
  readonly inicio: number;
  readonly fim: number;
  /** Verdadeiro para nomes, strings e numeros: nunca sao operadores. */
  readonly operando: boolean;
}

/**
 * Percorre o stream devolvendo um token por vez.
 *
 * Nao interpreta o conteudo: apenas delimita, o suficiente para saber onde um operador
 * comeca e termina sem confundi-lo com o interior de uma string.
 */
function* tokenizar(fonte: string): Generator<Token> {
  let i = 0;

  while (i < fonte.length) {
    const c = fonte.charAt(i);

    if (ESPACO.has(c)) {
      i += 1;
      continue;
    }

    // Comentario: vai ate o fim da linha.
    if (c === '%') {
      const quebra = fonte.indexOf('\n', i);
      i = quebra === -1 ? fonte.length : quebra + 1;
      continue;
    }

    // String literal, com parenteses aninhados e escape por barra invertida.
    if (c === '(') {
      const inicio = i;
      let profundidade = 0;
      while (i < fonte.length) {
        const d = fonte[i];
        if (d === '\\') {
          i += 2;
          continue;
        }
        if (d === '(') profundidade += 1;
        if (d === ')') {
          profundidade -= 1;
          if (profundidade === 0) {
            i += 1;
            break;
          }
        }
        i += 1;
      }
      yield { texto: fonte.slice(inicio, i), inicio, fim: i, operando: true };
      continue;
    }

    // String hexadecimal ou dicionario. Ambos comecam com '<'; o dicionario tem '<<'.
    if (c === '<') {
      const inicio = i;
      if (fonte[i + 1] === '<') {
        i += 2;
      } else {
        const fecha = fonte.indexOf('>', i);
        i = fecha === -1 ? fonte.length : fecha + 1;
      }
      yield { texto: fonte.slice(inicio, i), inicio, fim: i, operando: true };
      continue;
    }

    if (DELIMITADOR.has(c)) {
      // Nome (/Nome) vai ate o proximo delimitador; os demais sao tokens de um caractere.
      if (c === '/') {
        const inicio = i;
        i += 1;
        while (i < fonte.length) {
          const d = fonte.charAt(i);
          if (ESPACO.has(d) || DELIMITADOR.has(d)) break;
          i += 1;
        }
        yield { texto: fonte.slice(inicio, i), inicio, fim: i, operando: true };
        continue;
      }
      yield { texto: c, inicio: i, fim: i + 1, operando: true };
      i += 1;
      continue;
    }

    // Palavra: numero ou operador.
    const inicio = i;
    while (i < fonte.length) {
      const d = fonte.charAt(i);
      if (ESPACO.has(d) || DELIMITADOR.has(d)) break;
      i += 1;
    }
    const texto = fonte.slice(inicio, i);
    yield { texto, inicio, fim: i, operando: /^[-+.\d]/.test(texto) };
  }
}

export interface StripReport {
  /** Blocos de texto invisiveis removidos. */
  readonly removidos: number;
  /** Blocos de texto preservados por pintarem alguma coisa. */
  readonly mantidos: number;
}

export interface StripResult {
  readonly conteudo: string;
  readonly report: StripReport;
}

/**
 * Devolve o content stream sem os blocos `BT ... ET` que so escrevem texto invisivel.
 *
 * Um bloco e considerado invisivel quando o ultimo `Tr` visto dentro dele vale 3 (nem
 * preenche, nem contorna) e ele nao contem operador de desenho que escape disso. Blocos que
 * alternam o modo no meio sao MANTIDOS: preferir errar preservando e a unica escolha segura,
 * porque o dano de apagar conteudo real e irreversivel e o de manter e so tamanho.
 */
export function stripInvisibleText(conteudo: string): StripResult {
  /*
   * Os tokens sao materializados porque a decisao de remover precisa OLHAR PARA TRAS: o
   * `addInvisibleTextLayer` embrulha cada palavra num par `q ... Q`, e podar so o `BT ... ET`
   * de dentro deixava os pares orfaos — 1.200 bytes de ruido numa pagina de 300 palavras,
   * medidos. Um gerador nao permite espiar o token anterior.
   */
  const tokens = [...tokenizar(conteudo)];
  const partes: string[] = [];
  let removidos = 0;
  let mantidos = 0;

  /** Inicio do bloco atual, ou -1 fora de um bloco de texto. */
  let inicioBloco = -1;
  let copiadoAte = 0;
  let modoAtual = 0;
  /**
   * Pilha de `q`/`Q`.
   *
   * `Tr` e estado grafico: vale ate ser trocado, ATRAVESSANDO o `ET`. Sem esta pilha, um
   * `q 3 Tr ... Q` contaminaria todo o texto seguinte da pagina, e o compactador apagaria
   * conteudo visivel achando que era camada de OCR.
   */
  const estados: number[] = [];
  let modosVistos = new Set<number>();
  let pintaTexto = false;
  let dentroDeImagem = false;

  const pilha: string[] = [];
  /** Indice do token que abriu o bloco atual, para alcancar o `q` imediatamente anterior. */
  let indiceBloco = -1;

  for (const [indice, token] of tokens.entries()) {
    if (dentroDeImagem) {
      // Dentro de uma imagem embutida nada e interpretado ate o `EI`.
      if (!token.operando && token.texto === 'EI') dentroDeImagem = false;
      continue;
    }

    if (token.operando) {
      pilha.push(token.texto);
      continue;
    }

    switch (token.texto) {
      case 'BI':
        dentroDeImagem = true;
        pilha.length = 0;
        break;

      case 'q':
        estados.push(modoAtual);
        break;

      case 'Q': {
        const anterior = estados.pop();
        if (anterior !== undefined) modoAtual = anterior;
        break;
      }

      case 'BT':
        inicioBloco = token.inicio;
        indiceBloco = indice;
        modosVistos = new Set();
        pintaTexto = false;
        break;

      case 'Tr': {
        const valor = Number(pilha.at(-1));
        if (Number.isFinite(valor)) {
          modoAtual = valor;
          if (inicioBloco !== -1) modosVistos.add(valor);
        }
        break;
      }

      case 'ET': {
        if (inicioBloco !== -1) {
          // Invisivel de ponta a ponta: nenhum modo diferente de 3 apareceu no bloco.
          const soInvisivel =
            pintaTexto && modosVistos.size > 0 && [...modosVistos].every((modo) => modo === 3);

          if (soInvisivel) {
            // Engole o `q ... Q` que embrulha o bloco, mas SO se o par estiver completo:
            // levar um sem o outro desequilibraria a pilha de estado grafico e mudaria o
            // desenho do resto da pagina.
            const anterior = tokens[indiceBloco - 1];
            const seguinte = tokens[indice + 1];
            const emblocado =
              anterior !== undefined &&
              !anterior.operando &&
              anterior.texto === 'q' &&
              seguinte !== undefined &&
              !seguinte.operando &&
              seguinte.texto === 'Q';

            partes.push(conteudo.slice(copiadoAte, emblocado ? anterior.inicio : inicioBloco));
            copiadoAte = emblocado ? seguinte.fim : token.fim;
            removidos += 1;
          } else if (pintaTexto) {
            mantidos += 1;
          }
        }
        inicioBloco = -1;
        indiceBloco = -1;
        break;
      }

      default:
        if (OPERADORES_DE_TEXTO.has(token.texto)) {
          pintaTexto = true;
          // Um bloco sem `Tr` proprio herda o modo do estado grafico corrente.
          if (inicioBloco !== -1 && modosVistos.size === 0) modosVistos.add(modoAtual);
        }
        break;
    }

    pilha.length = 0;
  }

  partes.push(conteudo.slice(copiadoAte));
  return { conteudo: partes.join(''), report: { removidos, mantidos } };
}
