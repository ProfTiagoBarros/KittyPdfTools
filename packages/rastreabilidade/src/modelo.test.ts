import { describe, expect, it } from 'vitest';
import { calcularImpacto, casa, funcionalidadesAfetadasPor, padraoParaRegex, type Matriz } from './modelo.ts';

describe('padroes de caminho', () => {
  it.each([
    ['src/**', 'src/a/b/c.ts', true],
    ['src/**', 'outro/src/a.ts', false],
    ['**/package.json', 'package.json', true],
    ['**/package.json', 'apps/web/package.json', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['src/{a,b}.ts', 'src/b.ts', true],
    ['src/{a,b}.ts', 'src/c.ts', false],
    ['src/?.ts', 'src/x.ts', true],
    ['src/a.ts', 'src/a_ts', false],
    ['**/*.test.{ts,tsx}', 'apps/web/src/x.test.tsx', true],
  ])('%s casa %s: %s', (padrao, caminho, esperado) => {
    expect(casa(caminho, [padrao])).toBe(esperado);
  });

  it('recusa chave sem fechamento', () => {
    expect(() => padraoParaRegex('src/{a,b.ts')).toThrow();
  });
});

/**
 * Matriz de brinquedo: BASE <- MEIO <- TOPO, e duas funcionalidades.
 * F-A usa TOPO (logo, depende de tudo); F-B usa so ISOLADO.
 */
const vazio = { unitarios: [], e2e: [], nativos: [] };
const brinquedo: Matriz = {
  requisitos: [{ id: 'R-1', titulo: 'r', restricao: 'r' }],
  componentes: [
    { id: 'C-BASE', nome: '', descricao: '', arquivos: ['lib/base/**'], usa: [], testes: { ...vazio, unitarios: ['lib/base.test.ts'] }, requisitos: [], verificacaoManual: [] },
    { id: 'C-MEIO', nome: '', descricao: '', arquivos: ['lib/meio.ts'], usa: ['C-BASE'], testes: vazio, requisitos: [], verificacaoManual: [] },
    { id: 'C-TOPO', nome: '', descricao: '', arquivos: ['lib/topo.ts'], usa: ['C-MEIO'], testes: vazio, requisitos: [], verificacaoManual: [] },
    { id: 'C-ISOLADO', nome: '', descricao: '', arquivos: ['lib/isolado.ts'], usa: [], testes: vazio, requisitos: [], verificacaoManual: [] },
  ],
  funcionalidades: [
    { id: 'F-A', nome: '', descricao: '', rota: '/a/', arquivos: ['app/a/**'], usa: ['C-TOPO'], testes: { ...vazio, e2e: ['e2e/a.spec.ts'] }, requisitos: ['R-1'], verificacaoManual: [] },
    { id: 'F-B', nome: '', descricao: '', rota: '/b/', arquivos: ['app/b/**'], usa: ['C-ISOLADO'], testes: { ...vazio, e2e: ['e2e/b.spec.ts'] }, requisitos: ['R-1'], verificacaoManual: [] },
  ],
  produto: ['lib/**', 'app/**'],
  testesDescobertos: ['**/*.test.ts', 'e2e/*.spec.ts'],
  exigemTudo: ['package.json'],
  semTeste: ['**/*.md'],
};

describe('calcularImpacto', () => {
  it('componente de base contamina, de forma transitiva, quem depende dele', () => {
    const impacto = calcularImpacto(brinquedo, ['lib/base/x.ts']);

    expect(impacto.tudo).toBe(false);
    expect(impacto.componentes).toEqual(['C-BASE', 'C-MEIO', 'C-TOPO']);
    expect(impacto.funcionalidades).toEqual(['F-A']);
    expect(impacto.testes.unitarios).toEqual(['lib/base.test.ts']);
    expect(impacto.testes.e2e).toEqual(['e2e/a.spec.ts']);
  });

  it('mudanca na funcionalidade nao contamina os componentes que ela usa', () => {
    const impacto = calcularImpacto(brinquedo, ['app/b/page.tsx']);

    expect(impacto.funcionalidades).toEqual(['F-B']);
    expect(impacto.componentes).toEqual([]);
    expect(impacto.testes.e2e).toEqual(['e2e/b.spec.ts']);
  });

  it('documentacao nao exige teste nenhum', () => {
    const impacto = calcularImpacto(brinquedo, ['README.md']);

    expect(impacto.tudo).toBe(false);
    expect(impacto.funcionalidades).toEqual([]);
    expect(impacto.ignorados).toEqual(['README.md']);
  });

  it('configuracao exige a suite inteira e diz por que', () => {
    const impacto = calcularImpacto(brinquedo, ['package.json', 'lib/isolado.ts']);

    expect(impacto.tudo).toBe(true);
    expect(impacto.motivos).toEqual(['package.json']);
    expect(impacto.funcionalidades).toEqual(['F-A', 'F-B']);
    expect(impacto.testes.e2e).toEqual(['e2e/a.spec.ts', 'e2e/b.spec.ts']);
  });

  it('teste alterado roda a si mesmo, e so', () => {
    const impacto = calcularImpacto(brinquedo, ['lib/base.test.ts', 'e2e/b.spec.ts']);

    expect(impacto.funcionalidades).toEqual([]);
    expect(impacto.testes.unitarios).toEqual(['lib/base.test.ts']);
    expect(impacto.testes.e2e).toEqual(['e2e/b.spec.ts']);
  });

  it('arquivo de produto sem dono forca a suite inteira', () => {
    const impacto = calcularImpacto(brinquedo, ['lib/novo.ts']);

    expect(impacto.tudo).toBe(true);
    expect(impacto.motivos).toEqual(['lib/novo.ts (sem dono na matriz)']);
  });

  it('aceita o separador do Windows', () => {
    expect(calcularImpacto(brinquedo, ['app\\b\\page.tsx']).funcionalidades).toEqual(['F-B']);
  });
});

describe('funcionalidadesAfetadasPor', () => {
  it('responde "quem quebra se eu mexer aqui"', () => {
    expect(funcionalidadesAfetadasPor(brinquedo, 'C-BASE')).toEqual(['F-A']);
    expect(funcionalidadesAfetadasPor(brinquedo, 'C-ISOLADO')).toEqual(['F-B']);
  });
});
