/**
 * Visoes geradas da matriz: uma pagina HTML para consultar e um Markdown para o GitHub.
 *
 * Saida DETERMINISTICA — sem data, sem hora, sem ordem dependente de Map. E o que permite ao
 * teste de integridade regenerar em memoria e acusar quando os arquivos em `docs/` ficaram para
 * tras da matriz.
 */
import { funcionalidadesAfetadasPor, type Componente, type Funcionalidade, type Matriz } from './modelo.ts';

/** Onde as visoes geradas moram, relativo a raiz do repositorio. */
export const DOCUMENTOS_GERADOS = {
  html: 'docs/rastreabilidade.html',
  markdown: 'docs/RASTREABILIDADE.md',
} as const;

/** Componentes que a funcionalidade usa, direta ou indiretamente. */
export function componentesDe(matriz: Matriz, f: Funcionalidade): Set<string> {
  const porId = new Map(matriz.componentes.map((c) => [c.id, c]));
  const alcancados = new Set<string>();
  const pendentes = [...f.usa];

  while (pendentes.length > 0) {
    const id = pendentes.pop();
    if (id === undefined || alcancados.has(id)) continue;
    alcancados.add(id);
    pendentes.push(...(porId.get(id)?.usa ?? []));
  }

  return alcancados;
}

function contarTestes(matriz: Matriz) {
  const itens = [...matriz.funcionalidades, ...matriz.componentes];
  return {
    unitarios: new Set(itens.flatMap((i) => i.testes.unitarios)).size,
    e2e: new Set(itens.flatMap((i) => i.testes.e2e)).size,
    nativos: new Set(itens.flatMap((i) => i.testes.nativos)).size,
  };
}

const curto = (caminho: string) => caminho.replace(/^.*\//, '');

// ------------------------------------------------------------------------------- Markdown

export function gerarMarkdown(matriz: Matriz): string {
  const t = contarTestes(matriz);
  const linhas: string[] = [];
  const add = (...l: string[]) => linhas.push(...l);

  add(
    '# Matriz de rastreabilidade',
    '',
    '> Gerado de `packages/rastreabilidade/src/matriz.ts` por `pnpm rastreabilidade`. **Nao edite a mao.**',
    '> Versao visual: [`rastreabilidade.html`](rastreabilidade.html).',
    '',
    `**${matriz.requisitos.length}** requisitos · **${matriz.funcionalidades.length}** funcionalidades · ` +
      `**${matriz.componentes.length}** componentes · **${t.unitarios}** testes unitarios · ` +
      `**${t.e2e}** specs E2E · **${t.nativos}** suites nativas`,
    '',
    '## Como usar',
    '',
    '```bash',
    'pnpm test:impact            # roda os testes de tudo o que a sua mudanca pode quebrar',
    'pnpm test:impact --listar   # so mostra o que rodaria',
    'pnpm rastreabilidade        # regenera esta pagina depois de mudar a matriz',
    '```',
    '',
    'O `git push` roda `pnpm test:impact` sozinho (hook em `.githooks/pre-push`) e recusa o envio se',
    'algum teste impactado falhar.',
    '',
    '## Impacto: componente x funcionalidade',
    '',
    '`●` usa diretamente · `○` usa por meio de outro componente. Mexer numa linha exige os testes de',
    'todas as colunas marcadas nela.',
    '',
  );

  const cabecalho = ['Componente', ...matriz.funcionalidades.map((f) => f.id.replace('F-', '')), 'Afeta'];
  add(`| ${cabecalho.join(' | ')} |`, `| ${cabecalho.map(() => '---').join(' | ')} |`);
  for (const c of matriz.componentes) {
    const celulas = matriz.funcionalidades.map((f) =>
      f.usa.includes(c.id) ? '●' : componentesDe(matriz, f).has(c.id) ? '○' : '',
    );
    const afeta = funcionalidadesAfetadasPor(matriz, c.id).length;
    add(`| \`${c.id}\` | ${celulas.join(' | ')} | ${afeta} |`);
  }

  add('', '## Requisitos', '', '| Requisito | Atendido por | Restricao |', '| --- | --- | --- |');
  for (const r of matriz.requisitos) {
    const por = [...matriz.funcionalidades, ...matriz.componentes]
      .filter((i) => i.requisitos.includes(r.id))
      .map((i) => `\`${i.id}\``);
    add(`| **${r.id}** ${r.titulo} | ${por.join(' ')} | ${r.restricao} |`);
  }

  add('', '## Funcionalidades', '');
  for (const f of matriz.funcionalidades) add(...secaoMarkdown(f, matriz));

  add('## Componentes', '');
  for (const c of matriz.componentes) add(...secaoMarkdown(c, matriz));

  return `${linhas.join('\n').trimEnd()}\n`;
}

function secaoMarkdown(item: Funcionalidade | Componente, matriz: Matriz): string[] {
  const ehFuncionalidade = 'rota' in item;
  const l: string[] = [`### \`${item.id}\` ${item.nome}`, '', item.descricao, ''];

  if (ehFuncionalidade && item.rota !== null) l.push(`- **Rota:** \`${item.rota}\``);
  if (item.requisitos.length > 0) l.push(`- **Requisitos:** ${item.requisitos.join(', ')}`);
  if (item.usa.length > 0) l.push(`- **Usa:** ${item.usa.map((id) => `\`${id}\``).join(' ')}`);
  if (!ehFuncionalidade) {
    const afetadas = funcionalidadesAfetadasPor(matriz, item.id);
    if (afetadas.length > 0) l.push(`- **Mexer aqui afeta:** ${afetadas.map((id) => `\`${id}\``).join(' ')}`);
  }
  l.push(`- **Arquivos:** ${item.arquivos.map((a) => `\`${a}\``).join(', ')}`);

  const testes = [
    ...item.testes.unitarios.map((t) => `unitario \`${curto(t)}\``),
    ...item.testes.e2e.map((t) => `E2E \`${curto(t)}\``),
    ...item.testes.nativos.map((t) => `nativo \`${t}\``),
  ];
  l.push(`- **Testes:** ${testes.length > 0 ? testes.join(', ') : '_coberto pelos testes de quem o usa_'}`);
  if (item.verificacaoManual.length > 0) {
    l.push(`- **Verificacao manual:** ${item.verificacaoManual.join('; ')}`);
  }
  l.push('');
  return l;
}

// ------------------------------------------------------------------------------- HTML

const esc = (texto: string) =>
  texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function chips(ids: readonly string[], classe: string): string {
  return ids.map((id) => `<span class="chip ${classe}">${esc(id)}</span>`).join('');
}

function listaTestes(item: Funcionalidade | Componente): string {
  const linhas = [
    ...item.testes.unitarios.map((t) => `<li><span class="tag u">unit</span><code>${esc(curto(t))}</code></li>`),
    ...item.testes.e2e.map((t) => `<li><span class="tag e">e2e</span><code>${esc(curto(t))}</code></li>`),
    ...item.testes.nativos.map((t) => `<li><span class="tag n">rust</span><code>${esc(t)}</code></li>`),
  ];
  return linhas.length > 0
    ? `<ul class="testes">${linhas.join('')}</ul>`
    : '<p class="mudo">Coberto pelos testes de quem o usa.</p>';
}

function cartao(item: Funcionalidade | Componente, matriz: Matriz): string {
  const ehFuncionalidade = 'rota' in item;
  const afetadas = ehFuncionalidade ? [] : funcionalidadesAfetadasPor(matriz, item.id);
  const busca = [item.id, item.nome, item.descricao, ...item.arquivos, ...item.requisitos].join(' ').toLowerCase();

  return `
  <article class="cartao" id="${esc(item.id)}" data-busca="${esc(busca)}">
    <header>
      <code class="id">${esc(item.id)}</code>
      <h3>${esc(item.nome)}</h3>
      ${ehFuncionalidade && item.rota !== null ? `<code class="rota">${esc(item.rota)}</code>` : ''}
    </header>
    <p>${esc(item.descricao)}</p>
    ${item.requisitos.length > 0 ? `<div class="linha"><span class="rotulo">Requisitos</span>${chips(item.requisitos, 'req')}</div>` : ''}
    ${item.usa.length > 0 ? `<div class="linha"><span class="rotulo">Usa</span>${chips(item.usa, 'comp')}</div>` : ''}
    ${afetadas.length > 0 ? `<div class="linha alerta"><span class="rotulo">Mexer aqui afeta</span>${chips(afetadas, 'func')}</div>` : ''}
    <details><summary>Arquivos (${item.arquivos.length})</summary><ul class="arquivos">${item.arquivos.map((a) => `<li><code>${esc(a)}</code></li>`).join('')}</ul></details>
    <div class="bloco"><span class="rotulo">Testes</span>${listaTestes(item)}</div>
    ${item.verificacaoManual.length > 0 ? `<div class="bloco manual"><span class="rotulo">Verificacao manual</span><ul>${item.verificacaoManual.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
  </article>`;
}

export function gerarHtml(matriz: Matriz): string {
  const t = contarTestes(matriz);
  const funcs = matriz.funcionalidades;

  const mapa = matriz.componentes
    .map((c) => {
      const celulas = funcs
        .map((f) => {
          const direto = f.usa.includes(c.id);
          const indireto = !direto && componentesDe(matriz, f).has(c.id);
          const classe = direto ? 'direto' : indireto ? 'indireto' : '';
          const titulo = direto ? `${f.id} usa ${c.id}` : indireto ? `${f.id} usa ${c.id} por meio de outro componente` : '';
          return `<td class="${classe}" data-f="${esc(f.id)}"${titulo ? ` title="${esc(titulo)}"` : ''}></td>`;
        })
        .join('');
      const afeta = funcionalidadesAfetadasPor(matriz, c.id).length;
      return `<tr data-c="${esc(c.id)}"><th scope="row"><a href="#${esc(c.id)}">${esc(c.id)}</a><span>${esc(c.nome)}</span></th>${celulas}<td class="afeta"><b>${afeta}</b>/${funcs.length}</td></tr>`;
    })
    .join('');

  const requisitos = matriz.requisitos
    .map((r) => {
      const por = [...matriz.funcionalidades, ...matriz.componentes].filter((i) => i.requisitos.includes(r.id));
      return `<tr><th scope="row"><code>${esc(r.id)}</code>${esc(r.titulo)}</th><td>${por.map((i) => `<a class="chip ${'rota' in i ? 'func' : 'comp'}" href="#${esc(i.id)}">${esc(i.id)}</a>`).join('')}</td><td class="restricao">${esc(r.restricao)}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rastreabilidade PDFKitty</title>
<style>
:root {
  --fundo: #f6f7f9; --superficie: #ffffff; --borda: #e3e6eb; --texto: #1d2330; --mudo: #667085;
  --acento: #4f46e5; --acento-suave: #eef0ff; --direto: #4f46e5; --indireto: #c7cbff;
  --alerta: #b54708; --alerta-suave: #fff6ed; --ok: #067647; --ok-suave: #ecfdf3;
  --u: #0e7090; --e: #6941c6; --n: #b54708; --sombra: 0 1px 2px rgba(16,24,40,.06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --fundo: #0f1218; --superficie: #171b24; --borda: #2a303c; --texto: #e7eaf0; --mudo: #98a2b3;
    --acento: #8b93ff; --acento-suave: #232845; --direto: #8b93ff; --indireto: #3a3f6b;
    --alerta: #fdb022; --alerta-suave: #2b2112; --ok: #47cd89; --ok-suave: #102a1e; --sombra: none;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fundo); color: var(--texto);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1240px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -.01em; }
h2 { font-size: 19px; margin: 40px 0 6px; }
h3 { font-size: 16px; margin: 0; }
p { margin: 6px 0; }
code { font: 12.5px ui-monospace, "Cascadia Code", Consolas, monospace; }
a { color: var(--acento); text-decoration: none; }
.sub { color: var(--mudo); margin: 0 0 20px; }
.nota { color: var(--mudo); font-size: 13.5px; margin-bottom: 12px; }
.numeros { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.numero { background: var(--superficie); border: 1px solid var(--borda); border-radius: 12px; padding: 14px 16px; box-shadow: var(--sombra); }
.numero b { display: block; font-size: 26px; line-height: 1.1; }
.numero span { color: var(--mudo); font-size: 13px; }
.uso { background: var(--acento-suave); border-radius: 12px; padding: 14px 18px; margin-top: 16px; }
.uso pre { margin: 8px 0 0; white-space: pre-wrap; }
.rolagem { overflow-x: auto; background: var(--superficie); border: 1px solid var(--borda); border-radius: 12px; box-shadow: var(--sombra); }
table { border-collapse: collapse; width: 100%; }
.mapa th, .mapa td { border-bottom: 1px solid var(--borda); }
.mapa thead th { font-size: 12px; font-weight: 600; color: var(--mudo); padding: 10px 4px; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; height: 170px; vertical-align: bottom; }
.mapa thead th.canto { writing-mode: horizontal-tb; transform: none; text-align: left; vertical-align: bottom; padding: 10px 14px; }
.mapa tbody th { text-align: left; padding: 8px 14px; font-weight: 500; white-space: nowrap; }
.mapa tbody th a { font: 600 12.5px ui-monospace, Consolas, monospace; }
.mapa tbody th span { display: block; color: var(--mudo); font-size: 12px; font-weight: 400; }
.mapa td { width: 38px; min-width: 38px; height: 38px; text-align: center; }
.mapa td.direto::after, .mapa td.indireto::after { content: ""; display: inline-block; width: 16px; height: 16px; border-radius: 50%; vertical-align: middle; }
.mapa td.direto::after { background: var(--direto); }
.mapa td.indireto::after { background: var(--indireto); }
.mapa td.afeta { width: auto; padding: 0 14px; color: var(--mudo); white-space: nowrap; }
.mapa td.afeta b { color: var(--texto); }
.mapa tr.foco th, .mapa tr.foco td { background: var(--acento-suave); }
.mapa td.foco-col { background: var(--acento-suave); }
.legenda { display: flex; gap: 18px; color: var(--mudo); font-size: 13px; margin: 10px 2px 0; flex-wrap: wrap; }
.legenda i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
.req th { text-align: left; padding: 10px 14px; font-weight: 500; white-space: nowrap; }
.req th code { margin-right: 8px; color: var(--acento); }
.req td { padding: 10px 14px; border-top: 1px solid var(--borda); vertical-align: top; }
.req th { border-top: 1px solid var(--borda); vertical-align: top; }
.req tr:first-child th, .req tr:first-child td { border-top: 0; }
.restricao { color: var(--mudo); font-size: 13.5px; }
.chip { display: inline-block; font: 600 11.5px ui-monospace, Consolas, monospace; padding: 2px 8px; border-radius: 999px; margin: 2px 4px 2px 0; border: 1px solid var(--borda); background: var(--fundo); color: var(--texto); }
.chip.func { border-color: transparent; background: var(--acento-suave); color: var(--acento); }
.chip.req { border-color: transparent; background: var(--ok-suave); color: var(--ok); }
.busca { width: 100%; max-width: 420px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--borda); background: var(--superficie); color: var(--texto); font: inherit; margin: 6px 0 14px; }
.grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: 14px; }
.cartao { background: var(--superficie); border: 1px solid var(--borda); border-radius: 12px; padding: 16px; box-shadow: var(--sombra); scroll-margin-top: 16px; }
.cartao:target { outline: 2px solid var(--acento); }
.cartao header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.cartao .id { color: var(--acento); font-weight: 600; }
.cartao .rota { margin-left: auto; color: var(--mudo); }
.linha { margin-top: 8px; }
.rotulo { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--mudo); margin-bottom: 3px; }
.alerta .rotulo { color: var(--alerta); }
.bloco { margin-top: 10px; }
.manual { background: var(--alerta-suave); border-radius: 8px; padding: 8px 10px; }
.manual ul { margin: 0; padding-left: 18px; font-size: 13.5px; }
details { margin-top: 10px; font-size: 13.5px; }
summary { cursor: pointer; color: var(--mudo); }
ul.arquivos, ul.testes { list-style: none; padding: 0; margin: 6px 0 0; }
ul.arquivos li, ul.testes li { padding: 2px 0; overflow-wrap: anywhere; }
.tag { display: inline-block; width: 38px; font: 600 10.5px system-ui, sans-serif; text-transform: uppercase; color: #fff; border-radius: 4px; text-align: center; margin-right: 8px; padding: 1px 0; }
.tag.u { background: var(--u); } .tag.e { background: var(--e); } .tag.n { background: var(--n); }
.mudo { color: var(--mudo); font-size: 13.5px; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Matriz de rastreabilidade</h1>
  <p class="sub">PDFKitty · requisito &rarr; funcionalidade &rarr; codigo &rarr; testes. Gerada de <code>packages/rastreabilidade/src/matriz.ts</code>; nao edite a mao.</p>

  <section class="numeros">
    <div class="numero"><b>${matriz.requisitos.length}</b><span>requisitos</span></div>
    <div class="numero"><b>${matriz.funcionalidades.length}</b><span>funcionalidades</span></div>
    <div class="numero"><b>${matriz.componentes.length}</b><span>componentes</span></div>
    <div class="numero"><b>${t.unitarios}</b><span>testes unitarios</span></div>
    <div class="numero"><b>${t.e2e}</b><span>specs E2E</span></div>
    <div class="numero"><b>${t.nativos}</b><span>suites nativas</span></div>
  </section>

  <div class="uso">
    <b>Antes de mexer:</b> encontre o componente no mapa e veja quantas funcionalidades ele afeta.
    <b>Depois de mexer:</b>
<pre><code>pnpm test:impact            # testes de tudo o que a mudanca pode quebrar
pnpm test:impact --listar   # so mostra o que rodaria
pnpm rastreabilidade        # regenera esta pagina</code></pre>
    O <code>git push</code> roda <code>pnpm test:impact</code> sozinho e recusa o envio se algum teste impactado falhar.
  </div>

  <h2>Mapa de impacto</h2>
  <p class="nota">Linhas sao componentes compartilhados; colunas, funcionalidades. Mexer numa linha exige os testes de todas as colunas marcadas nela. Passe o mouse para destacar.</p>
  <div class="rolagem">
    <table class="mapa">
      <thead><tr><th class="canto">Componente</th>${funcs.map((f) => `<th scope="col" data-f="${esc(f.id)}"><a href="#${esc(f.id)}">${esc(f.nome)}</a></th>`).join('')}<th class="canto">Afeta</th></tr></thead>
      <tbody>${mapa}</tbody>
    </table>
  </div>
  <div class="legenda"><span><i style="background:var(--direto)"></i>usa diretamente</span><span><i style="background:var(--indireto)"></i>usa por meio de outro componente</span></div>

  <h2>Requisitos</h2>
  <div class="rolagem"><table class="req"><tbody>${requisitos}</tbody></table></div>

  <h2>Funcionalidades e componentes</h2>
  <input class="busca" type="search" placeholder="Filtrar por nome, arquivo ou requisito..." aria-label="Filtrar">
  <h3 style="margin:8px 0 10px">Funcionalidades</h3>
  <section class="grade">${matriz.funcionalidades.map((f) => cartao(f, matriz)).join('')}</section>
  <h3 style="margin:28px 0 10px">Componentes</h3>
  <section class="grade">${matriz.componentes.map((c) => cartao(c, matriz)).join('')}</section>
</main>
<script>
(() => {
  const campo = document.querySelector('.busca');
  const cartoes = [...document.querySelectorAll('.cartao')];
  campo.addEventListener('input', () => {
    const termo = campo.value.trim().toLowerCase();
    for (const c of cartoes) c.hidden = termo !== '' && !c.dataset.busca.includes(termo);
  });
  const tabela = document.querySelector('.mapa');
  tabela.addEventListener('mouseover', (evento) => {
    const celula = evento.target.closest('td, th');
    tabela.querySelectorAll('.foco, .foco-col').forEach((e) => e.classList.remove('foco', 'foco-col'));
    if (!celula) return;
    celula.closest('tbody tr')?.classList.add('foco');
    const f = celula.dataset.f;
    if (f) tabela.querySelectorAll('[data-f="' + f + '"]').forEach((e) => e.classList.add('foco-col'));
  });
  tabela.addEventListener('mouseleave', () => tabela.querySelectorAll('.foco, .foco-col').forEach((e) => e.classList.remove('foco', 'foco-col')));
})();
</script>
</body>
</html>
`;
}
