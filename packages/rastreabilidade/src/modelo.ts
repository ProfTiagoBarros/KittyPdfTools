/**
 * Modelo da matriz de rastreabilidade e o calculo de impacto de uma mudanca.
 *
 * Tudo aqui e puro: recebe a matriz e a lista de arquivos alterados, devolve o que precisa ser
 * testado. Nao toca o git nem o disco — e por isso o calculo e testavel com uma matriz de
 * brinquedo, sem depender do estado do repositorio.
 */

/** Requisito de origem: historia de usuario (US) ou requisito nao funcional (RNF). */
export interface Requisito {
  readonly id: string;
  readonly titulo: string;
  /** A restricao que nao pode ser esquecida ao mexer nas funcionalidades que o atendem. */
  readonly restricao: string;
}

/** Caminhos de teste, relativos a raiz do repositorio. */
export interface Testes {
  /** Vitest. */
  readonly unitarios: readonly string[];
  /** Specs do Playwright. */
  readonly e2e: readonly string[];
  /** Crates Rust cujo `cargo test` cobre o item (caminho do `Cargo.toml`). */
  readonly nativos: readonly string[];
}

interface ItemBase {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string;
  /** Padroes de caminho do codigo que pertence ao item. */
  readonly arquivos: readonly string[];
  /** Componentes compartilhados dos quais o item depende. */
  readonly usa: readonly string[];
  readonly testes: Testes;
  readonly requisitos: readonly string[];
  /**
   * O que so se confere a mao, fora da suite automatica: o app empacotado, o aparelho, o
   * seletor de arquivos do sistema. Listar aqui e o que impede esse passo de ser esquecido.
   */
  readonly verificacaoManual: readonly string[];
}

/** Algo que o usuario ve e usa: uma ferramenta ou um recurso da tela. */
export interface Funcionalidade extends ItemBase {
  /** Rota da interface, quando a funcionalidade tem uma. */
  readonly rota: string | null;
}

/** Peca compartilhada: mexer nela pode quebrar todas as funcionalidades que a usam. */
export type Componente = ItemBase;

export interface Matriz {
  readonly requisitos: readonly Requisito[];
  readonly funcionalidades: readonly Funcionalidade[];
  readonly componentes: readonly Componente[];
  /** Raizes de codigo de produto: todo arquivo dentro delas precisa de dono na matriz. */
  readonly produto: readonly string[];
  /** Onde estao os testes: todo teste encontrado aqui precisa ser citado por algum item. */
  readonly testesDescobertos: readonly string[];
  /** Mudanca aqui exige a suite inteira: configuracao, dependencias, apoio de teste. */
  readonly exigemTudo: readonly string[];
  /** Mudanca aqui nao exige teste: documentacao e ferramentas manuais. */
  readonly semTeste: readonly string[];
}

// ------------------------------------------------------------------------------- padroes

/**
 * Converte um padrao de caminho em expressao regular.
 *
 * Suporta o que a matriz usa: `**` (qualquer profundidade), `*` (dentro de um segmento), `?` e
 * `{a,b}`. Implementado aqui para o pacote nao depender de biblioteca de glob — ele roda num hook
 * de git, e cada dependencia a mais e uma chance de o hook quebrar numa maquina nova.
 */
export function padraoParaRegex(padrao: string): RegExp {
  let expressao = '';

  for (let i = 0; i < padrao.length; i += 1) {
    const c = padrao.charAt(i);

    if (c === '*') {
      if (padrao.charAt(i + 1) === '*') {
        if (padrao.charAt(i + 2) === '/') {
          expressao += '(?:.*/)?';
          i += 2;
        } else {
          expressao += '.*';
          i += 1;
        }
      } else {
        expressao += '[^/]*';
      }
    } else if (c === '?') {
      expressao += '[^/]';
    } else if (c === '{') {
      const fim = padrao.indexOf('}', i);
      if (fim === -1) throw new Error(`Chave sem fechamento no padrao: ${padrao}`);
      const opcoes = padrao.slice(i + 1, fim).split(',').map(escapar);
      expressao += `(?:${opcoes.join('|')})`;
      i = fim;
    } else {
      expressao += escapar(c);
    }
  }

  return new RegExp(`^${expressao}$`);
}

function escapar(texto: string): string {
  return texto.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

const cacheDeRegex = new Map<string, RegExp>();

export function casa(caminho: string, padroes: readonly string[]): boolean {
  return padroes.some((padrao) => {
    let regex = cacheDeRegex.get(padrao);
    if (regex === undefined) {
      regex = padraoParaRegex(padrao);
      cacheDeRegex.set(padrao, regex);
    }
    return regex.test(caminho);
  });
}

/** Normaliza separadores: o git devolve `/`, mas o Windows pode entregar `\`. */
export function normalizar(caminho: string): string {
  return caminho.replaceAll('\\', '/');
}

// ------------------------------------------------------------------------------- impacto

export interface Impacto {
  /** A suite inteira precisa rodar. */
  readonly tudo: boolean;
  /** Por que a suite inteira — cada arquivo que forcou isso. */
  readonly motivos: readonly string[];
  readonly funcionalidades: readonly string[];
  readonly componentes: readonly string[];
  readonly testes: Testes;
  /** Arquivos alterados que nao exigem teste nenhum (documentacao). */
  readonly ignorados: readonly string[];
}

/**
 * Quem pode quebrar quando estes arquivos mudam.
 *
 * Um componente alterado contamina, de forma transitiva, todos os componentes que dependem dele
 * e todas as funcionalidades que usam qualquer um deles. A regra e conservadora de proposito:
 * rodar um teste a mais custa segundos; deixar de rodar o teste que pegaria a regressao custa o
 * defeito chegar a escola.
 *
 * Arquivo de produto sem dono forca a suite inteira — nao se sabe o que ele quebra. (O teste de
 * integridade da matriz impede que esse arquivo chegue ao repositorio, mas o hook pode rodar
 * antes dele.)
 */
export function calcularImpacto(matriz: Matriz, alterados: readonly string[]): Impacto {
  const motivos: string[] = [];
  const ignorados: string[] = [];
  const funcionalidades = new Set<string>();
  const componentes = new Set<string>();
  const testesDiretos = { unitarios: new Set<string>(), e2e: new Set<string>() };

  for (const bruto of alterados) {
    const caminho = normalizar(bruto);

    if (casa(caminho, matriz.exigemTudo)) {
      motivos.push(caminho);
      continue;
    }

    // Um teste alterado roda a SI MESMO, e so. Ele nao muda o produto, entao nao ha o que
    // contaminar: tratar como mudanca do componente rodaria os testes de meio produto por causa
    // de um comentario num spec.
    if (casa(caminho, matriz.testesDescobertos)) {
      if (caminho.endsWith('.spec.ts')) testesDiretos.e2e.add(caminho);
      else testesDiretos.unitarios.add(caminho);
      continue;
    }

    let temDono = false;
    for (const f of matriz.funcionalidades) {
      if (casa(caminho, f.arquivos)) {
        funcionalidades.add(f.id);
        temDono = true;
      }
    }
    for (const c of matriz.componentes) {
      if (casa(caminho, c.arquivos)) {
        componentes.add(c.id);
        temDono = true;
      }
    }

    if (temDono) continue;
    if (casa(caminho, matriz.semTeste)) {
      ignorados.push(caminho);
      continue;
    }
    if (casa(caminho, matriz.produto)) {
      motivos.push(`${caminho} (sem dono na matriz)`);
      continue;
    }
    ignorados.push(caminho);
  }

  if (motivos.length > 0) return impactoTotal(matriz, motivos, ignorados);

  // Contaminacao transitiva: quem depende de um componente afetado tambem e afetado.
  for (const id of dependentesDe(matriz, componentes)) componentes.add(id);
  for (const f of matriz.funcionalidades) {
    if (f.usa.some((id) => componentes.has(id))) funcionalidades.add(f.id);
  }

  const itens = [
    ...matriz.funcionalidades.filter((f) => funcionalidades.has(f.id)),
    ...matriz.componentes.filter((c) => componentes.has(c.id)),
  ];

  return {
    tudo: false,
    motivos,
    funcionalidades: ordenar(funcionalidades),
    componentes: ordenar(componentes),
    testes: {
      unitarios: ordenar(new Set([...testesDiretos.unitarios, ...itens.flatMap((i) => i.testes.unitarios)])),
      e2e: ordenar(new Set([...testesDiretos.e2e, ...itens.flatMap((i) => i.testes.e2e)])),
      nativos: ordenar(new Set(itens.flatMap((i) => i.testes.nativos))),
    },
    ignorados,
  };
}

/** Componentes que dependem, direta ou indiretamente, de algum dos informados. */
export function dependentesDe(matriz: Matriz, raizes: ReadonlySet<string>): Set<string> {
  const afetados = new Set(raizes);
  let mudou = true;

  while (mudou) {
    mudou = false;
    for (const c of matriz.componentes) {
      if (!afetados.has(c.id) && c.usa.some((id) => afetados.has(id))) {
        afetados.add(c.id);
        mudou = true;
      }
    }
  }

  return afetados;
}

function impactoTotal(matriz: Matriz, motivos: string[], ignorados: string[]): Impacto {
  const itens = [...matriz.funcionalidades, ...matriz.componentes];
  return {
    tudo: true,
    motivos,
    funcionalidades: matriz.funcionalidades.map((f) => f.id),
    componentes: matriz.componentes.map((c) => c.id),
    testes: {
      unitarios: ordenar(new Set(itens.flatMap((i) => i.testes.unitarios))),
      e2e: ordenar(new Set(itens.flatMap((i) => i.testes.e2e))),
      nativos: ordenar(new Set(itens.flatMap((i) => i.testes.nativos))),
    },
    ignorados,
  };
}

function ordenar(conjunto: ReadonlySet<string>): string[] {
  return [...conjunto].sort();
}

// ------------------------------------------------------------------------------- consultas

/** Funcionalidades que usam o componente, direta ou indiretamente: "quem quebra se eu mexer aqui". */
export function funcionalidadesAfetadasPor(matriz: Matriz, componenteId: string): string[] {
  const afetados = dependentesDe(matriz, new Set([componenteId]));
  return matriz.funcionalidades.filter((f) => f.usa.some((id) => afetados.has(id))).map((f) => f.id);
}
