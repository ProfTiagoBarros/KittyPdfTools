/**
 * O que a matriz precisa saber do repositorio, perguntado ao git.
 *
 * Isolado aqui para que o resto do pacote seja puro: o calculo de impacto e a pagina gerada
 * recebem listas de caminhos, e so este arquivo sabe que elas vem do git.
 */
import { execFileSync } from 'node:child_process';
import { normalizar } from './modelo.ts';

function git(args: readonly string[], cwd?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(cwd === undefined ? {} : { cwd }),
  });
}

function linhas(saida: string): string[] {
  return saida
    .split('\n')
    .map((linha) => normalizar(linha.trim()))
    .filter((linha) => linha !== '');
}

/** Raiz do repositorio, de onde todos os caminhos da matriz sao relativos. */
export function raizDoRepositorio(): string {
  return normalizar(git(['rev-parse', '--show-toplevel']).trim());
}

/**
 * Todos os arquivos que o repositorio conhece ou vai conhecer: versionados e novos, menos os
 * ignorados.
 *
 * Inclui os nao versionados de proposito: a verificacao de integridade tem de acusar o arquivo
 * novo sem dono ANTES de ele ser commitado, e nao depois. `-z` evita que o git escape nomes com
 * acento.
 */
export function arquivosDoRepositorio(raiz: string): string[] {
  const saida = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], raiz);
  const vistos = new Set(saida.split('\0').map(normalizar).filter((c) => c !== ''));
  // Removido do disco mas ainda no indice: nao existe mais para efeito de dono.
  const apagados = new Set(linhas(git(['ls-files', '--deleted'], raiz)));
  return [...vistos].filter((c) => !apagados.has(c)).sort();
}

/** Arquivos alterados entre duas revisoes (`base...cabeca` = desde o ancestral comum). */
export function alteradosEntre(raiz: string, base: string, cabeca: string): string[] {
  return linhas(git(['diff', '--name-only', '--no-renames', `${base}...${cabeca}`], raiz));
}

/** Alteracoes ainda nao commitadas: indice, arvore de trabalho e arquivos novos. */
export function alteradosNaoCommitados(raiz: string): string[] {
  const rastreados = linhas(git(['diff', '--name-only', '--no-renames', 'HEAD'], raiz));
  const novos = linhas(git(['ls-files', '--others', '--exclude-standard'], raiz));
  return [...new Set([...rastreados, ...novos])].sort();
}

/** Ancestral comum com a referencia, ou `null` quando ela nao existe (repositorio sem remoto). */
export function baseComum(raiz: string, referencia: string): string | null {
  try {
    return git(['merge-base', 'HEAD', referencia], raiz).trim() || null;
  } catch {
    return null;
  }
}
