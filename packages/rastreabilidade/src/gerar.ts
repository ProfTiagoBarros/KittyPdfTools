/**
 * `pnpm rastreabilidade`: regenera `docs/rastreabilidade.html` e `docs/RASTREABILIDADE.md` a partir
 * da matriz, e recusa gerar uma matriz que nao passa na integridade.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verificarIntegridade } from './integridade.ts';
import { matriz } from './matriz.ts';
import { DOCUMENTOS_GERADOS, gerarHtml, gerarMarkdown } from './pagina.ts';
import { arquivosDoRepositorio, raizDoRepositorio } from './repositorio.ts';

const raiz = raizDoRepositorio();
const problemas = verificarIntegridade(matriz, arquivosDoRepositorio(raiz));

if (problemas.length > 0) {
  console.error('A matriz nao confere com o repositorio:\n');
  for (const p of problemas) console.error(`  [${p.regra}] ${p.detalhe}`);
  console.error('\nCorrija packages/rastreabilidade/src/matriz.ts e rode de novo.');
  process.exit(1);
}

writeFileSync(join(raiz, DOCUMENTOS_GERADOS.html), gerarHtml(matriz));
writeFileSync(join(raiz, DOCUMENTOS_GERADOS.markdown), gerarMarkdown(matriz));
console.log(`Gerados ${DOCUMENTOS_GERADOS.html} e ${DOCUMENTOS_GERADOS.markdown}.`);
