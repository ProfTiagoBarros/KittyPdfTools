#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Traz para public/ tudo que o OCR precisa em tempo de execucao.
 *
 * O tesseract.js busca worker, wasm e modelo de idioma em CDN por padrao. Isso quebraria a
 * Regra de Ouro 1 (o padrao de uso vazaria para terceiros) e a Regra 4 (o Desktop precisa
 * funcionar sem rede). Tudo passa a ser servido pela propria aplicacao.
 *
 * Copiamos apenas as variantes `-lstm` COM SIMD. Justificativa de cada corte:
 *
 * - variantes nao-LSTM: pertencem ao motor legado, que nao usamos.
 * - variante sem SIMD: a aplicacao ja exige `OffscreenCanvas` e `DecompressionStream`, e todo
 *   navegador que os oferece tambem tem WebAssembly SIMD. Manter o fallback custaria 6,4 MB
 *   para um navegador que nao roda o resto do produto.
 *
 * Sao 6,4 MB por variante (wasm + a cola JS do Emscripten), entao o corte nao e cosmetico.
 */

const require = createRequire(import.meta.url);
const publicDir = join(import.meta.dirname, '..', 'public', 'tesseract');
const langDir = join(publicDir, 'lang');

/** Modelo compacto oficial. ~2 MB, contra ~15 MB do modelo completo. */
const LANG_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/por.traineddata';
const LANG_FILE = 'por.traineddata';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyInto(source, targetDir, name) {
  await copyFile(source, join(targetDir, name));
  return (await stat(source)).size;
}

await mkdir(publicDir, { recursive: true });
await mkdir(langDir, { recursive: true });

let total = 0;

// 1. Worker do tesseract.js
const tesseractDist = join(dirname(require.resolve('tesseract.js/package.json')), 'dist');
total += await copyInto(join(tesseractDist, 'worker.min.js'), publicDir, 'worker.min.js');

// 2. Nucleo wasm, apenas as variantes LSTM
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const coreFiles = (await readdir(coreDir)).filter(
  (name) => name.includes('-lstm.wasm') && name.includes('simd'),
);
if (coreFiles.length === 0) {
  throw new Error('Nenhuma variante LSTM com SIMD encontrada em tesseract.js-core');
}
for (const name of coreFiles) total += await copyInto(join(coreDir, name), publicDir, name);

// 3. Modelo de idioma. Baixado uma vez e mantido em cache: o build seguinte ja nao precisa
//    de rede. O arquivo e grande e gerado, entao fica fora do git.
const langTarget = join(langDir, LANG_FILE);
if (await exists(langTarget)) {
  total += (await stat(langTarget)).size;
  console.log(`${LANG_FILE} ja em cache`);
} else {
  console.log(`baixando ${LANG_FILE}...`);
  const response = await fetch(LANG_URL);
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${LANG_FILE}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(langTarget, bytes);
  total += bytes.length;
}

console.log(
  `tesseract: ${coreFiles.length + 2} arquivos em public/tesseract (${(total / 1048576).toFixed(1)} MB)`,
);
