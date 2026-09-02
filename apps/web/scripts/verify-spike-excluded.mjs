#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garante que rotas de spike nao chegam ao build de producao.
 *
 * Faz um build limpo SEM PDFKITTY_SPIKE e exige que nada de `out/spike` seja emitido — o
 * que faz o host estatico responder 404. Num produto que vende privacidade, uma rota de
 * teste esquecida em producao e superficie que ninguem auditou.
 *
 * Nao entra em `pnpm test` porque custa um build inteiro; roda como tarefa propria.
 */
const outDir = join(process.cwd(), 'out');
rmSync(outDir, { recursive: true, force: true });

const env = { ...process.env };
delete env.PDFKITTY_SPIKE;

execFileSync('node', ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env });

const leaked = existsSync(join(outDir, 'spike'));
if (leaked) {
  console.error('\nFALHA: out/spike existe no build de producao.');
  process.exit(1);
}

console.log('\nOK: nenhuma rota de spike no build de producao.');
