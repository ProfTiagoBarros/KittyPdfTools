import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verificarIntegridade } from './integridade.ts';
import { matriz } from './matriz.ts';
import type { Componente, Funcionalidade, Matriz } from './modelo.ts';
import { DOCUMENTOS_GERADOS, gerarHtml, gerarMarkdown } from './pagina.ts';
import { arquivosDoRepositorio, raizDoRepositorio } from './repositorio.ts';

const raiz = raizDoRepositorio();

describe('a matriz confere com o repositorio', () => {
  it('nao ha problema de integridade', () => {
    const problemas = verificarIntegridade(matriz, arquivosDoRepositorio(raiz));

    // A lista inteira na falha: e ela que diz o que mudar na matriz.
    expect(problemas.map((p) => `[${p.regra}] ${p.detalhe}`)).toEqual([]);
  });

  it.each([
    ['html', DOCUMENTOS_GERADOS.html, gerarHtml],
    ['markdown', DOCUMENTOS_GERADOS.markdown, gerarMarkdown],
  ] as const)('a visao %s em docs/ esta em dia (rode pnpm rastreabilidade)', (_, caminho, gerar) => {
    const noDisco = readFileSync(join(raiz, caminho), 'utf8').replaceAll('\r\n', '\n');
    expect(noDisco === gerar(matriz)).toBe(true);
  });
});

/** Controles negativos: cada regra precisa acusar o defeito que diz pegar. */
describe('cada regra acusa o seu defeito', () => {
  const vazio = { unitarios: [], e2e: [], nativos: [] };
  const componenteA: Componente = { id: 'C-A', nome: '', descricao: '', arquivos: ['src/a.ts'], usa: [], testes: { ...vazio, unitarios: ['src/a.test.ts'] }, requisitos: [], verificacaoManual: [] };
  const funcionalidadeX: Funcionalidade = { id: 'F-X', nome: '', descricao: '', rota: '/x/', arquivos: ['apps/web/src/app/x/**'], usa: ['C-A'], testes: { ...vazio, e2e: ['e2e/x.spec.ts'] }, requisitos: ['R-1'], verificacaoManual: [] };
  const sadia: Matriz = {
    requisitos: [{ id: 'R-1', titulo: 'r', restricao: 'r' }],
    componentes: [componenteA],
    funcionalidades: [funcionalidadeX],
    produto: ['src/**', 'apps/**'],
    testesDescobertos: ['**/*.test.ts', 'e2e/*.spec.ts'],
    exigemTudo: ['package.json'],
    semTeste: ['README.md'],
  };
  const arquivos = ['src/a.ts', 'src/a.test.ts', 'e2e/x.spec.ts', 'apps/web/src/app/x/page.tsx', 'package.json', 'README.md'];

  const regras = (m: Matriz, a: readonly string[] = arquivos) => verificarIntegridade(m, a).map((p) => p.regra);

  it('a matriz sadia nao tem problema', () => {
    expect(regras(sadia)).toEqual([]);
  });

  it.each<[string, Matriz, readonly string[]]>([
    ['sem-dono', sadia, [...arquivos, 'src/novo.ts']],
    ['nao-classificado', sadia, [...arquivos, 'script.sh']],
    ['teste-citado', sadia, [...arquivos, 'src/b.test.ts']],
    ['dono-unico', { ...sadia, componentes: [...sadia.componentes, { ...componenteA, id: 'C-B', testes: vazio }] }, arquivos],
    ['ids-unicos', { ...sadia, requisitos: [...sadia.requisitos, { id: 'C-A', titulo: '', restricao: '' }] }, arquivos],
    ['teste-existe', sadia, arquivos.filter((a) => a !== 'src/a.test.ts')],
    ['dependencia-existe', { ...sadia, funcionalidades: [{ ...funcionalidadeX, usa: ['C-NADA'] }] }, arquivos],
    ['requisito-existe', { ...sadia, componentes: [{ ...componenteA, requisitos: ['R-9'] }] }, arquivos],
    ['padrao-vivo', { ...sadia, semTeste: ['README.md', 'apagado.txt'] }, arquivos],
    ['funcionalidade-com-e2e', { ...sadia, funcionalidades: [{ ...funcionalidadeX, testes: vazio }] }, arquivos],
    ['rota-existe', { ...sadia, funcionalidades: [{ ...funcionalidadeX, rota: '/y/' }] }, arquivos],
    ['requisito-coberto', { ...sadia, requisitos: [...sadia.requisitos, { id: 'R-2', titulo: '', restricao: '' }] }, arquivos],
    [
      'sem-ciclo',
      {
        ...sadia,
        componentes: [
          { ...componenteA, usa: ['C-B'] },
          { ...componenteA, id: 'C-B', arquivos: ['src/b.ts'], testes: vazio, usa: ['C-A'] },
        ],
      },
      [...arquivos, 'src/b.ts'],
    ],
  ])('%s', (regra, m, a) => {
    expect(regras(m, a)).toContain(regra);
  });
});
