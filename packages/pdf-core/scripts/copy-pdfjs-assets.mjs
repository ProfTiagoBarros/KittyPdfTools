#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * Copia os assets do pdf.js para o diretorio publico da aplicacao.
 *
 * Vive no pdf-core porque e ele quem declara `pdfjs-dist`: assim o app nao precisa conhecer
 * — nem declarar — a biblioteca de PDF so para publicar assets dela.
 *
 * Tudo tem de ser servido pela propria aplicacao. Buscar de CDN vazaria padrao de uso e
 * impediria o funcionamento offline exigido na versao Desktop (Regra de Ouro 4).
 *
 * **Nao basta o worker.** Por muito tempo era so ele que vinha, e o sintoma era enganoso:
 * documentos simples renderizavam e a miniatura sumia exatamente nos que dependiam dos
 * outros arquivos. O pdf.js precisa de:
 *
 * - `standard_fonts/` — as 14 fontes padrao do PDF quando nao vem embutidas. Dentro de um
 *   Worker nao ha DOM, entao `useSystemFonts` nao tem como registrar `@font-face`.
 * - `cmaps/` — mapas de caractere de PDFs CJK.
 * - `wasm/` — decodificadores de imagem (JPEG 2000, entre outros).
 * - `iccs/` — perfis de cor.
 */
const targetDir = process.argv[2];
if (targetDir === undefined) {
  console.error('uso: copy-pdfjs-assets <diretorio-destino>');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pdfjsPackage = require.resolve('pdfjs-dist/package.json');
const pdfjsRoot = dirname(pdfjsPackage);
const { version } = JSON.parse(await readFile(pdfjsPackage, 'utf8'));
const destination = resolve(process.cwd(), targetDir);

/*
 * Marcador de versao: os assets so sao recopiados quando o pdf.js muda.
 *
 * Nao e otimizacao de tempo — e correcao. Recopiar 4,6 MB a cada build apagava e reescrevia
 * milhares de arquivos, e num diretorio sincronizado (OneDrive, antivirus) uma dessas
 * remocoes falha com EBUSY de vez em quando, derrubando o build inteiro por um arquivo que
 * ja estava correto no destino.
 */
const MARCADOR = join(destination, '.pdfjs-version');
const jaPublicado = await readFile(MARCADOR, 'utf8').catch(() => null);

if (jaPublicado === version) {
  console.log(`pdfjs ${version}: assets ja publicados em ${destination}`);
  process.exit(0);
}

await mkdir(destination, { recursive: true });

const WORKER = 'pdf.worker.min.mjs';
await cp(join(pdfjsRoot, 'build', WORKER), join(destination, WORKER), { force: true });

const DIRETORIOS = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];
for (const nome of DIRETORIOS) {
  await cp(join(pdfjsRoot, nome), join(destination, nome), { recursive: true, force: true });
}

await writeFile(MARCADOR, version);
console.log(`pdfjs ${version}: ${WORKER} + ${DIRETORIOS.join(', ')} -> ${destination}`);
