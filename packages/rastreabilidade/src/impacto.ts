/**
 * `pnpm test:impact`: roda os testes de tudo o que a mudanca pode quebrar, segundo a matriz.
 *
 *   pnpm test:impact                      mudancas desde origin/main, mais as nao commitadas
 *   pnpm test:impact --base A --head B    mudancas entre duas revisoes (o hook de pre-push usa)
 *   pnpm test:impact --listar             so mostra o plano, sem rodar
 *   pnpm test:impact --tudo               a suite inteira
 *
 * Sempre roda o typecheck e a integridade da matriz: um erro de tipo atravessa fronteiras que a
 * matriz nao enxerga, e uma matriz desatualizada torna o resto do calculo mentiroso.
 */
import { spawnSync } from 'node:child_process';
import { calcularImpacto, type Impacto } from './modelo.ts';
import { matriz } from './matriz.ts';
import { alteradosEntre, alteradosNaoCommitados, baseComum, raizDoRepositorio } from './repositorio.ts';

interface Opcoes {
  readonly base: string | null;
  readonly cabeca: string;
  readonly listar: boolean;
  readonly tudo: boolean;
}

/** Onde cada suite Vitest mora: o teste roda com o caminho relativo ao pacote. */
const PACOTES_VITEST = [
  { prefixo: 'apps/web/', filtro: 'web' },
  { prefixo: 'packages/pdf-core/', filtro: 'pdf-core' },
  { prefixo: 'packages/rastreabilidade/', filtro: 'rastreabilidade' },
] as const;

const E2E_PREFIXO = 'apps/web/';
const INTEGRIDADE = 'packages/rastreabilidade/src/integridade.test.ts';

function lerOpcoes(argumentos: readonly string[]): Opcoes {
  const valor = (nome: string) => {
    const i = argumentos.indexOf(nome);
    return i === -1 ? null : (argumentos[i + 1] ?? null);
  };
  return {
    base: valor('--base'),
    cabeca: valor('--head') ?? 'HEAD',
    listar: argumentos.includes('--listar'),
    tudo: argumentos.includes('--tudo'),
  };
}

function arquivosAlterados(raiz: string, opcoes: Opcoes): string[] {
  if (opcoes.base !== null) return alteradosEntre(raiz, opcoes.base, opcoes.cabeca);

  const base = baseComum(raiz, 'origin/main');
  const commitados = base === null ? [] : alteradosEntre(raiz, base, 'HEAD');
  return [...new Set([...commitados, ...alteradosNaoCommitados(raiz)])].sort();
}

interface Passo {
  readonly titulo: string;
  readonly comando: string;
  readonly argumentos: readonly string[];
}

function planejar(impacto: Impacto): Passo[] {
  const passos: Passo[] = [{ titulo: 'Tipos (todos os pacotes)', comando: 'pnpm', argumentos: ['typecheck'] }];

  const unitarios = new Set(impacto.testes.unitarios);
  unitarios.add(INTEGRIDADE);

  for (const { prefixo, filtro } of PACOTES_VITEST) {
    const doPacote = [...unitarios].filter((t) => t.startsWith(prefixo)).map((t) => t.slice(prefixo.length));
    if (doPacote.length === 0) continue;
    const argumentos = impacto.tudo ? [] : doPacote;
    passos.push({
      titulo: `Unitarios: ${filtro}${impacto.tudo ? ' (todos)' : ` (${doPacote.length})`}`,
      comando: 'pnpm',
      argumentos: ['--filter', filtro, 'exec', 'vitest', 'run', ...argumentos],
    });
  }

  if (impacto.testes.e2e.length > 0) {
    const specs = impacto.tudo ? [] : impacto.testes.e2e.map((t) => t.slice(E2E_PREFIXO.length));
    passos.push({
      titulo: `E2E${impacto.tudo ? ' (todos)' : ` (${specs.length})`}`,
      comando: 'pnpm',
      argumentos: ['--filter', 'web', 'exec', 'playwright', 'test', ...specs, '--workers=2'],
    });
  }

  for (const manifesto of impacto.testes.nativos) {
    passos.push({
      titulo: `Nativos: ${manifesto}`,
      comando: 'cargo',
      argumentos: ['test', '--manifest-path', manifesto],
    });
  }

  return passos;
}

function imprimirPlano(alterados: readonly string[], impacto: Impacto, passos: readonly Passo[]): void {
  console.log(`\nArquivos alterados: ${alterados.length}`);
  if (impacto.tudo) {
    console.log('Suite inteira, por causa de:');
    for (const m of impacto.motivos) console.log(`  - ${m}`);
  } else {
    console.log(`Funcionalidades afetadas: ${impacto.funcionalidades.join(', ') || 'nenhuma'}`);
    console.log(`Componentes afetados:     ${impacto.componentes.join(', ') || 'nenhum'}`);
  }
  if (impacto.ignorados.length > 0) console.log(`Sem teste (documentacao): ${impacto.ignorados.length}`);

  const manuais = [...matriz.funcionalidades, ...matriz.componentes]
    .filter((i) => impacto.funcionalidades.includes(i.id) || impacto.componentes.includes(i.id))
    .flatMap((i) => i.verificacaoManual.map((v) => `${i.id}: ${v}`));

  console.log('\nPlano:');
  for (const p of passos) console.log(`  - ${p.titulo}`);
  if (manuais.length > 0) {
    console.log('\nVerificacao manual que a suite nao cobre (antes de publicar):');
    for (const m of manuais) console.log(`  - ${m}`);
  }
  console.log('');
}

function executar(raiz: string, passos: readonly Passo[]): boolean {
  const ambiente = { ...process.env };
  // O crate do plugin compila no mesmo alvo do app, reaproveitando dependencias ja compiladas.
  ambiente.CARGO_TARGET_DIR ??= `${raiz}/apps/desktop/src-tauri/target`;

  for (const passo of passos) {
    console.log(`\n=== ${passo.titulo}\n`);
    const resultado = spawnSync(passo.comando, passo.argumentos, {
      cwd: raiz,
      stdio: 'inherit',
      env: ambiente,
      // `pnpm` e `cargo` sao .cmd/.exe no Windows: sem shell o spawn nao os encontra.
      shell: process.platform === 'win32',
    });
    if (resultado.status !== 0) {
      console.error(`\nFALHOU: ${passo.titulo}`);
      return false;
    }
  }
  return true;
}

const opcoes = lerOpcoes(process.argv.slice(2));
const raiz = raizDoRepositorio();
const alterados = arquivosAlterados(raiz, opcoes);
const impacto = opcoes.tudo
  ? { ...calcularImpacto(matriz, ['package.json']), motivos: ['--tudo'] }
  : calcularImpacto(matriz, alterados);
const passos = planejar(impacto);

imprimirPlano(alterados, impacto, passos);

if (!opcoes.listar) {
  const ok = executar(raiz, passos);
  console.log(ok ? '\nTodos os testes impactados passaram.' : '');
  process.exit(ok ? 0 : 1);
}
