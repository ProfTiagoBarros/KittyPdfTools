/**
 * As Regras de Ouro que moram na configuracao, e nao no codigo.
 *
 * O lint pega `fetch` num componente; nada pegava alguem regenerar o projeto Android e trazer a
 * permissao INTERNET de volta, abrir o `connect-src` da CSP ou commitar um `.pfx`. Cada uma destas
 * e a ultima barreira de alguma garantia que o produto vende.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arquivosDoRepositorio, raizDoRepositorio } from './repositorio.ts';

const raiz = raizDoRepositorio();
const TAURI = 'apps/desktop/src-tauri';
const ler = (caminho: string) => readFileSync(join(raiz, caminho), 'utf8');

describe('Zero-Data Transfer na configuracao', () => {
  it('o Android nao pede a permissao INTERNET', () => {
    const manifesto = ler(`${TAURI}/gen/android/app/src/main/AndroidManifest.xml`);

    // Comentarios fora: a remocao vem explicada no proprio manifesto.
    const semComentarios = manifesto.replace(/<!--[\s\S]*?-->/g, '');
    expect(semComentarios).not.toMatch(/android\.permission\.INTERNET/);
  });

  it('a CSP do app so conversa com ele mesmo', () => {
    const configuracao = JSON.parse(ler(`${TAURI}/tauri.conf.json`)) as {
      app: { security: { csp: Record<string, string> } };
    };
    const csp = configuracao.app.security.csp;

    expect(csp['connect-src']?.split(/\s+/).sort()).toEqual(["'self'", 'http://ipc.localhost', 'ipc:'].sort());
    expect(csp['default-src']).toBe("'self'");
    expect(csp['object-src']).toBe("'none'");
    // `wasm-unsafe-eval` e o que o Tesseract precisa; `unsafe-eval` abriria `eval` de texto.
    expect(Object.values(csp).join(' ')).not.toMatch(/'unsafe-eval'/);
  });

  it('a ponte nativa nao da acesso livre ao sistema de arquivos', () => {
    const capacidades = JSON.parse(ler(`${TAURI}/capabilities/default.json`)) as { permissions: string[] };

    // O `fs` gravava 0 bytes no Android e saiu do produto; a gravacao e do plugin proprio.
    expect(capacidades.permissions.filter((p) => p.startsWith('fs:'))).toEqual([]);
    expect(capacidades.permissions.filter((p) => /^(http|shell|websocket):/.test(p))).toEqual([]);
  });
});

describe('material sensivel fora do repositorio', () => {
  // Ancorada na raiz: sem a barra inicial, a regra ignorava tambem `app/spike/documentos/`, e um
  // arquivo novo naquela rota sumiria do repositorio sem aviso.
  it('o .gitignore barra certificados e documentos reais', () => {
    const regras = ler('.gitignore').split(/\r?\n/).map((l) => l.trim());

    expect(regras).toEqual(expect.arrayContaining(['*.pfx', '*.p12', '/documentos/']));
  });

  it('nenhum certificado, keystore ou documento real esta no repositorio', () => {
    const sensiveis = arquivosDoRepositorio(raiz).filter(
      (c) => /\.(pfx|p12|jks|keystore)$/i.test(c) || c.startsWith('documentos/'),
    );

    expect(sensiveis).toEqual([]);
  });
});
