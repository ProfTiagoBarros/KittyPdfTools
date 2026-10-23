/**
 * Regras que mantem a matriz verdadeira.
 *
 * Uma matriz desatualizada e pior do que nenhuma: ela da confianca para pular exatamente o teste
 * que pegaria a regressao. Estas regras transformam "lembrar de atualizar a matriz" em teste que
 * falha — arquivo novo sem dono, teste que ninguem cita, padrao que nao casa com mais nada.
 */
import { casa, type Matriz } from './modelo.ts';

export interface Problema {
  readonly regra: string;
  readonly detalhe: string;
}

export function verificarIntegridade(matriz: Matriz, arquivos: readonly string[]): Problema[] {
  const problemas: Problema[] = [];
  const falha = (regra: string, detalhe: string) => problemas.push({ regra, detalhe });

  const itens = [...matriz.funcionalidades, ...matriz.componentes];
  const existentes = new Set(arquivos);
  const idsDeComponente = new Set(matriz.componentes.map((c) => c.id));
  const idsDeRequisito = new Set(matriz.requisitos.map((r) => r.id));

  // ids-unicos
  const vistos = new Set<string>();
  for (const id of [...itens.map((i) => i.id), ...matriz.requisitos.map((r) => r.id)]) {
    if (vistos.has(id)) falha('ids-unicos', `id repetido: ${id}`);
    vistos.add(id);
  }

  const citados = new Set(itens.flatMap((i) => [...i.testes.unitarios, ...i.testes.e2e]));

  for (const arquivo of arquivos) {
    const ehTeste = casa(arquivo, matriz.testesDescobertos);
    const donos = itens.filter((i) => casa(arquivo, i.arquivos)).map((i) => i.id);

    // teste-citado: teste que ninguem cita nunca roda pelo calculo de impacto.
    if (ehTeste) {
      if (!citados.has(arquivo)) falha('teste-citado', `${arquivo} nao e citado por nenhum item`);
      continue;
    }

    // dono-unico: dois donos significam um arquivo fazendo duas coisas.
    if (donos.length > 1) falha('dono-unico', `${arquivo} tem mais de um dono: ${donos.join(', ')}`);

    // classificado: todo arquivo tem dono, exige a suite inteira ou declaradamente nao exige teste.
    const classificado =
      donos.length > 0 || casa(arquivo, matriz.exigemTudo) || casa(arquivo, matriz.semTeste);
    if (!classificado) {
      falha(
        casa(arquivo, matriz.produto) ? 'sem-dono' : 'nao-classificado',
        `${arquivo} nao tem lugar na matriz`,
      );
    }
  }

  for (const item of itens) {
    // teste-existe: citar um teste que nao existe e prometer uma cobertura que nao ha.
    for (const teste of [...item.testes.unitarios, ...item.testes.e2e, ...item.testes.nativos]) {
      if (!existentes.has(teste)) falha('teste-existe', `${item.id} cita ${teste}, que nao existe`);
    }

    // dependencia-existe: so se depende de componente.
    for (const id of item.usa) {
      if (!idsDeComponente.has(id)) falha('dependencia-existe', `${item.id} usa ${id}, que nao e componente`);
    }

    // requisito-existe
    for (const id of item.requisitos) {
      if (!idsDeRequisito.has(id)) falha('requisito-existe', `${item.id} atende ${id}, que nao existe`);
    }

    // padrao-vivo: padrao que nao casa com nada e resto de arquivo apagado ou renomeado.
    for (const padrao of item.arquivos) {
      if (!arquivos.some((a) => casa(a, [padrao]))) {
        falha('padrao-vivo', `${item.id}: "${padrao}" nao casa com nenhum arquivo`);
      }
    }
  }

  for (const [lista, nome] of [
    [matriz.produto, 'produto'],
    [matriz.exigemTudo, 'exigemTudo'],
    [matriz.semTeste, 'semTeste'],
  ] as const) {
    for (const padrao of lista) {
      if (!arquivos.some((a) => casa(a, [padrao]))) {
        falha('padrao-vivo', `${nome}: "${padrao}" nao casa com nenhum arquivo`);
      }
    }
  }

  for (const f of matriz.funcionalidades) {
    // funcionalidade-com-e2e: o usuario ve a funcionalidade, entao o teste tambem tem de ver.
    if (f.testes.e2e.length === 0) falha('funcionalidade-com-e2e', `${f.id} nao tem teste E2E`);

    // rota-existe
    if (f.rota !== null) {
      const pagina = `apps/web/src/app${f.rota}page.tsx`;
      if (!existentes.has(pagina)) falha('rota-existe', `${f.id}: rota ${f.rota} sem ${pagina}`);
    }
  }

  // requisito-coberto: requisito sem item que o atenda e requisito sem teste.
  const atendidos = new Set(itens.flatMap((i) => i.requisitos));
  for (const r of matriz.requisitos) {
    if (!atendidos.has(r.id)) falha('requisito-coberto', `${r.id} nao e atendido por nenhum item`);
  }

  // sem-ciclo: dependencia circular torna o impacto infinito e a arquitetura, emaranhada.
  for (const ciclo of ciclosEntreComponentes(matriz)) {
    falha('sem-ciclo', `ciclo: ${ciclo.join(' -> ')}`);
  }

  return problemas;
}

function ciclosEntreComponentes(matriz: Matriz): string[][] {
  const usa = new Map(matriz.componentes.map((c) => [c.id, c.usa]));
  const ciclos: string[][] = [];
  const estado = new Map<string, 'visitando' | 'feito'>();

  const visitar = (id: string, caminho: string[]) => {
    if (estado.get(id) === 'feito') return;
    if (estado.get(id) === 'visitando') {
      ciclos.push([...caminho.slice(caminho.indexOf(id)), id]);
      return;
    }
    estado.set(id, 'visitando');
    for (const dependencia of usa.get(id) ?? []) visitar(dependencia, [...caminho, id]);
    estado.set(id, 'feito');
  };

  for (const c of matriz.componentes) visitar(c.id, []);
  return ciclos;
}
