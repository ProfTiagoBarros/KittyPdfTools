/**
 * Verifica o app Android por dentro.
 *
 * Mesma ideia do verify-desktop.mjs: compilar e instalar nao prova que o WebView achou os
 * assets, que o CSP nao quebrou os workers, nem que uma operacao real funciona. Aqui ha uma
 * pergunta extra, que so existe no celular: **o aparelho consegue salvar o arquivo gerado?**
 * Um WebView nao trata download por conta propria como um navegador trata.
 *
 * Nao faz parte do produto: script de verificacao, executado a mao com o app aberto.
 *
 *   pnpm --filter web verify:android
 *
 * A depuracao remota do WebView so existe em build de debug. O APK de release nao expoe
 * socket algum, entao este script nao tem como rodar contra o pacote distribuido.
 */
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const PACOTE = process.env.PDFKITTY_ANDROID_PACKAGE ?? 'com.pdfkitty.app';
const PORTA = 9223;

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', windowsHide: true }).trim();

// O socket de depuracao do WebView carrega o pid do processo que o abriu.
const pid = adb('shell', 'pidof', PACOTE).split(/\s+/)[0];
if (!pid) {
  console.error(`App '${PACOTE}' nao esta em execucao. Abra-o no aparelho e rode de novo.`);
  process.exit(1);
}

const sockets = adb('shell', 'cat', '/proc/net/unix')
  .split('\n')
  .map((linha) => linha.match(/@?(webview_devtools_remote_\d+)/)?.[1])
  .filter((nome) => nome !== undefined);

const socket = sockets.find((nome) => nome.endsWith(`_${pid}`)) ?? sockets[0];
if (!socket) {
  console.error(
    'Nenhum socket de depuracao do WebView encontrado.\n' +
      'Isso e esperado num APK de release: so o build de debug habilita depuracao remota.',
  );
  process.exit(1);
}

adb('forward', `tcp:${PORTA}`, `localabstract:${socket}`);
console.log('SOCKET   :', socket, `(pid ${pid}) -> 127.0.0.1:${PORTA}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTA}`);
const context = browser.contexts()[0];
const page = context.pages()[0];

const errors = [];
// O proprio teste de rede provoca erros de console de proposito; contar os dele como
// defeito do app faria o relatorio acusar exatamente o comportamento que ele quer ver.
const ruidoDoControle = (texto) => texto.includes('example.com');
// As violacoes de CSP do teste de rede nao sao defeito: sao a medida de que o CSP esta
// atuando, e e por elas que se sabe se o bypass funcionou.
const violacoesDeCsp = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const texto = message.text();
  if (texto.includes('Content Security Policy')) violacoesDeCsp.push(texto);
  if (!ruidoDoControle(texto)) errors.push(`console: ${texto}`);
});

const url = page.url();
console.log('URL      :', url);
console.log('TITULO   :', await page.title());
console.log('UA       :', await page.evaluate(() => navigator.userAgent));

// As capacidades que decidem se o produto inteiro funciona, medidas dentro do WebView do
// app — nao no Chrome do aparelho, que pode ser outra versao.
const caps = await page.evaluate(async () => {
  const naMain = {
    OffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    DecompressionStream: typeof DecompressionStream !== 'undefined',
    Worker: typeof Worker !== 'undefined',
    createImageBitmap: typeof createImageBitmap !== 'undefined',
  };

  // O worker e a coluna que decide: e onde o PDFKitty desenha.
  const fonte = [
    'self.onmessage = () => {',
    '  let contexto2d = false;',
    "  try { contexto2d = new OffscreenCanvas(2, 2).getContext('2d') !== null; }",
    '  catch (erro) { contexto2d = false; }',
    '  self.postMessage({',
    "    OffscreenCanvas: typeof OffscreenCanvas !== 'undefined',",
    '    contexto2d,',
    "    DecompressionStream: typeof DecompressionStream !== 'undefined',",
    "    createImageBitmap: typeof createImageBitmap !== 'undefined',",
    '  });',
    '};',
  ].join('\n');

  const blob = new Blob([fonte], { type: 'text/javascript' });
  const endereco = URL.createObjectURL(blob);
  try {
    const worker = new Worker(endereco);
    const noWorker = await new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error('tempo esgotado')), 8000);
      worker.onmessage = (evento) => {
        clearTimeout(limite);
        resolve(evento.data);
      };
      worker.onerror = (evento) => {
        clearTimeout(limite);
        reject(new Error(evento.message ?? 'erro no worker'));
      };
      worker.postMessage(null);
    });
    worker.terminate();
    return { naMain, noWorker };
  } catch (erro) {
    return { naMain, noWorker: `nao foi possivel medir: ${erro.message}` };
  } finally {
    URL.revokeObjectURL(endereco);
  }
});
console.log('MAIN     :', JSON.stringify(caps.naMain));
console.log('WORKER   :', JSON.stringify(caps.noWorker));

// Controle da Regra de Ouro 1: uma saida de rede tem mesmo que falhar aqui dentro.
// Duas barreiras respondem por isso no Android — o CSP do Tauri e a ausencia da permissao
// INTERNET no manifesto — e este teste nao distingue qual delas agiu. A permissao e a que
// continua valendo se alguem afrouxar o CSP por engano.
const rede = await page.evaluate(async () => {
  try {
    await fetch('https://example.com', { mode: 'no-cors' });
    return 'A REQUISICAO PASSOU — a barreira de rede nao esta valendo';
  } catch (erro) {
    return `bloqueada (${erro.message})`;
  }
});
console.log('REDE     :', rede);

// Operacao completa: carregar um PDF e ver a miniatura renderizar.
await page.goto(new URL('/unir/', url).href);
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
    'true',
  undefined,
  { timeout: 30_000 },
);
console.log('WORKERS  : criados (workspace pronto)');

/** Mais de uma pagina de proposito: o defeito relatado era miniatura faltando em ALGUMAS. */
const PAGINAS = 3;

const loaded = await page.evaluate(async (paginas) => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: paginas }, (_u, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${paginas} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < paginas; i += 1) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const fluxo = `BT /F1 24 Tf 40 200 Td (ANDROID${i + 1}) Tj ET`;
    objs.push(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((b, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;

  const input = document.querySelector('[data-testid="file-input"]');
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'android.pdf', { type: 'application/pdf' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const state = document.querySelector('[data-testid="workspace-state"]');
  const cartoes = [...document.querySelectorAll('[data-testid="page-card"]')];
  return {
    documentos: state?.getAttribute('data-documents'),
    paginas: state?.getAttribute('data-pages'),
    // Conta UMA POR PAGINA, e nao "existe alguma": o defeito relatado era exatamente
    // miniatura faltando em parte das paginas, e um booleano nao teria detectado.
    //
    // O criterio e a ausencia do marcador de folha em branco, e nao a presenca do canvas: o
    // canvas fica montado mesmo antes de existir imagem, entao procura-lo aprovaria tudo.
    miniaturas: cartoes.filter(
      (cartao) => cartao.querySelector('[data-testid="thumbnail-placeholder"]') === null,
    ).length,
    semImagem: cartoes.filter((cartao) => cartao.querySelector('[data-status="failed"]') !== null)
      .length,
  };
}, PAGINAS);
console.log('CARREGAR :', JSON.stringify(loaded));

// A acao principal precisa estar ALCANCAVEL, nao apenas visivel. Com a janela indo ate a
// borda fisica da tela, a barra grudada embaixo cai atras dos botoes de navegacao do Android:
// o usuario ve o botao e o toque nao chega nele. Medir e a unica forma de saber.
const areaSegura = await page.evaluate(() => {
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(sonda);
  const inset = Number.parseFloat(getComputedStyle(sonda).paddingBottom) || 0;
  sonda.remove();

  const botao = document.querySelector('[data-testid="export"]')?.getBoundingClientRect();
  const barra = document.querySelector('[data-testid="bottom-bar"]')?.getBoundingClientRect();

  return {
    inset,
    alturaJanela: window.innerHeight,
    fundoDoBotao: botao === undefined ? null : Math.round(botao.bottom),
    fundoDaBarra: barra === undefined ? null : Math.round(barra.bottom),
  };
});

console.log(
  'AREA SEG :',
  `inset=${areaSegura.inset}px`,
  `| janela=${areaSegura.alturaJanela}px`,
  `| fundo do botao=${areaSegura.fundoDoBotao}px`,
);

if (areaSegura.inset === 0) {
  console.log(
    '           ATENCAO: inset zero. Ou o aparelho nao tem barra de navegacao sobreposta, ou ' +
      'o WebView nao esta propagando as insets — e neste segundo caso o CTA fica embaixo dos ' +
      'botoes do sistema. Confira na tela antes de concluir.',
  );
} else if (
  areaSegura.fundoDoBotao !== null &&
  areaSegura.fundoDoBotao > areaSegura.alturaJanela - areaSegura.inset
) {
  console.log('           ATENCAO: o botao invade a area do sistema.');
} else {
  console.log('           O botao esta acima da area do sistema.');
}

// A pergunta propria do Android: exportar salva mesmo um arquivo no aparelho?
//
// Aqui o teste dirige o **seletor de verdade**, e nao uma versao fingida dele.
//
// A primeira tentativa foi substituir `window.__TAURI_INTERNALS__.invoke` para devolver um
// caminho fixo e pular a tela nativa. Nao funciona, e falha do pior jeito: a propriedade e
// `writable: false, configurable: false`, entao a atribuicao **nao lanca** — ela e ignorada
// em silencio, o seletor abre de verdade e o relatorio acusa "nenhum comando Tauri", que se
// leria como "o caminho do app instalado nao foi tomado".
//
// Entao: clica em exportar, confere que o seletor do sistema subiu, e o completa por
// automacao de UI. O destino e o padrao do proprio seletor — /sdcard/Download —, que e
// exatamente o caminho que o usuario percorre.
/**
 * Localiza um botao pelo texto na arvore de UI do sistema e devolve o centro dele.
 *
 * Procura no a no em vez de montar uma expressao unica: os atributos do uiautomator vem em
 * ordem variavel, e `bounds` pode aparecer antes ou depois de `text`.
 */
const LIMITES = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

const acharBotao = (textos) => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/pdfkitty-ui.xml');
  const nos = adb('shell', 'cat', '/sdcard/pdfkitty-ui.xml').split('<node');

  for (const texto of textos) {
    const no = nos.find((trecho) => trecho.includes(`text="${texto}"`));
    const limites = no === undefined ? null : LIMITES.exec(no);
    if (limites !== null) {
      return {
        texto,
        x: Math.round((Number(limites[1]) + Number(limites[3])) / 2),
        y: Math.round((Number(limites[2]) + Number(limites[4])) / 2),
      };
    }
  }
  return null;
};

const atividadeNoTopo = () => {
  const saida = adb('shell', 'dumpsys', 'activity', 'activities');
  return (
    /topResumedActivity=ActivityRecord\{[^ ]+ [^ ]+ ([^ ]+)/.exec(saida)?.[1] ?? 'desconhecida'
  );
};

/**
 * O seletor esta no TOPO?
 *
 * Perguntar se `documentsui` aparece em algum lugar do `dumpsys` nao serve: ele continua
 * listado na pilha depois de fechar, entao a resposta era sempre "aberto" — e o relatorio
 * acusava "toquei, mas o seletor continua aberto" logo abaixo de um arquivo gravado
 * corretamente. Relatorio que contradiz a evidencia e pior do que relatorio nenhum.
 */
const seletorAberto = () => {
  try {
    return atividadeNoTopo().includes('documentsui');
  } catch {
    return false;
  }
};

/**
 * Aciona uma geracao e a completa pelo seletor DE VERDADE, devolvendo o que ficou no aparelho.
 *
 * Existe como funcao porque agora ha mais de um fluxo de geracao para medir — unir entrega um
 * `.pdf`, extrair entrega outro, dividir entrega `.zip` — e duplicar esta logica seria pedir
 * para as copias divergirem. As esperas aqui nao sao folga: cada uma paga um defeito que ja
 * aconteceu, e estao comentadas uma a uma.
 *
 * A primeira tentativa de automatizar isto foi substituir `window.__TAURI_INTERNALS__.invoke`
 * para devolver um caminho fixo e pular a tela nativa. Nao funciona, e falha do pior jeito: a
 * propriedade e `writable: false, configurable: false`, entao a atribuicao **nao lanca** — ela
 * e ignorada em silencio, o seletor abre de verdade e o relatorio acusa "nenhum comando
 * Tauri", que se leria como "o caminho do app instalado nao foi tomado".
 */
async function salvarPeloSeletor(nomeArquivo, acionar) {
  const caminho = `/sdcard/Download/${nomeArquivo}`;

  const remover = () => {
    try {
      adb('shell', 'rm', '-f', caminho);
    } catch {
      // Nao existir e o caso normal.
    }
  };

  const tamanhoNoAparelho = () => {
    try {
      const saida = adb('shell', 'stat', '-c', '%s', caminho);
      return /^\d+$/.test(saida) ? Number(saida) : null;
    } catch {
      return null;
    }
  };

  remover();
  await acionar();

  let seletor = 'nao abriu';
  for (let tentativa = 0; tentativa < 15; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const topo = atividadeNoTopo();
    if (topo.includes('documentsui') || topo.toLowerCase().includes('picker')) {
      seletor = topo;
      break;
    }
  }

  let bytes = null;
  let confirmacao = 'seletor nao abriu';
  /** Ultimo tamanho observado durante a espera, para distinguir "falhou" de "demorou". */
  let ultimoVisto = null;
  let segundos = 0;

  if (seletor !== 'nao abriu') {
    // O seletor precisa ASSENTAR antes do toque: a arvore de UI existe enquanto a tela ainda
    // esta animando, e um toque nas coordenadas lidas cedo demais cai fora do botao. O sintoma
    // e cruel — a tela fecha como se tivesse cancelado, e o produto trata cancelamento como
    // decisao do usuario: sem arquivo, sem erro, sem pista.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Insiste ate o seletor FECHAR, que e o unico sinal confiavel de que o toque pegou.
    // Um `uiautomator dump` durante a animacao devolve arvore vazia ou desatualizada; tratar
    // isso como "botao inexistente" fazia a verificacao desistir de um botao que estava la.
    let tocou = false;
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      if (!seletorAberto()) break;

      const botao = acharBotao(['SALVAR', 'Salvar', 'SAVE', 'Save']);
      if (botao === null) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }

      adb('shell', 'input', 'tap', String(botao.x), String(botao.y));
      tocou = true;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // Um respiro antes do veredito: a tela leva um instante para sair depois do toque, e
    // conferir cedo demais acusava "continua aberto" num salvamento que deu certo.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (!tocou) {
      confirmacao = 'nao achei o botao de confirmar no seletor';
    } else {
      confirmacao = seletorAberto() ? 'toquei, mas o seletor continua aberto' : 'confirmei';

      /*
       * Espera o tamanho ESTABILIZAR, e nao apenas aparecer: a gravacao e assincrona, e medir
       * cedo demais reporta um arquivo pela metade como se estivesse pronto. Aconteceu de
       * verdade numa sonda — o `stat` deu 0 MB e o arquivo tinha megabytes segundos depois.
       *
       * A janela e generosa porque o seletor cria o documento ANTES de a geracao comecar:
       * dividir gera um PDF por faixa e compactar rasteriza pagina a pagina, e no celular isso
       * passa facilmente de vinte segundos. Com a janela curta, o relatorio dizia "NADA
       * gravado" para operacoes que estavam apenas demorando — acusar defeito onde havia
       * lentidao e pior do que nao medir.
       */
      let anterior = -1;
      for (let tentativa = 0; tentativa < 90 && bytes === null; tentativa += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const agora = tamanhoNoAparelho();
        if (agora !== null && agora === anterior && agora > 0) bytes = agora;
        if (agora !== null) ultimoVisto = agora;
        anterior = agora ?? -1;
        segundos = tentativa + 1;
      }
    }
  }

  // Tamanho e cabecalho nao bastam: um arquivo truncado tem tamanho e comeca com a mesma
  // assinatura. O FIM do arquivo e o que denuncia gravacao incompleta.
  const assinatura = bytes === null ? null : adb('shell', 'head', '-c', '5', caminho).trim();
  const fim = bytes === null ? null : adb('shell', 'tail', '-c', '32', caminho).trim();

  return {
    nomeArquivo,
    caminho,
    seletor,
    confirmacao,
    bytes,
    ultimoVisto,
    segundos,
    assinatura,
    fim,
    remover,
  };
}

/** Um PDF comeca em %PDF e termina em %%EOF; um ZIP comeca em PK. */
function relatar(rotulo, salvo, tipo) {
  const marca = tipo === 'zip' ? 'PK' : '%PDF';
  console.log(`${rotulo} SELETOR:`, salvo.seletor, `| ${salvo.confirmacao}`);

  if (salvo.bytes === null) {
    // Diz O QUE se viu, e nao so que nao deu: um arquivo que apareceu e estava crescendo e um
    // problema de espera; um que nunca existiu e um problema de gravacao.
    console.log(
      `${rotulo} ARQUIVO:`,
      salvo.ultimoVisto === null
        ? `NADA gravado em ${salvo.caminho} (nem 0 bytes) apos ${salvo.segundos}s`
        : `nao estabilizou em ${salvo.segundos}s; ultimo tamanho visto ${salvo.ultimoVisto} bytes`,
    );
    return false;
  }

  const inicioOk = salvo.assinatura?.startsWith(marca) === true;
  const fimOk = tipo === 'zip' ? true : salvo.fim?.includes('%%EOF') === true;

  console.log(
    `${rotulo} ARQUIVO:`,
    `${salvo.bytes} bytes em ${salvo.caminho}`,
    `| comeca com ${JSON.stringify(salvo.assinatura)}`,
    inicioOk ? `— e ${tipo === 'zip' ? 'um ZIP' : 'um PDF'}` : `— NAO parece ${tipo}`,
  );
  if (tipo !== 'zip') {
    console.log(
      `${rotulo} INTEGRO:`,
      fimOk
        ? 'termina em %%EOF — gravacao completa'
        : `NAO termina em %%EOF: ${JSON.stringify(salvo.fim)}`,
    );
  }
  return inicioOk && fimOk;
}

const salvoUnir = await salvarPeloSeletor('pdfkitty.pdf', () =>
  page.click('[data-testid="export"]'),
);

// O que sai do produto tem de voltar para dentro dele.
//
// Um PDF montado aqui e reaberto aqui e o caso de uso mais provavel do usuario — juntar
// arquivos hoje, acrescentar uma pagina amanha — e nada garantia isso: a suite montava e
// exportava, mas nunca reabria o proprio resultado.
let reabertura = 'nao testada';
if (salvoUnir.bytes !== null) {
  const base64 = adb('shell', 'base64', salvoUnir.caminho).replace(/\s/g, '');

  await page.goto(new URL('/unir/', url).href);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
      'true',
    undefined,
    { timeout: 30_000 },
  );

  reabertura = await page.evaluate(async (codificado) => {
    const binario = atob(codificado);
    const conteudo = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) conteudo[i] = binario.charCodeAt(i);

    const input = document.querySelector('[data-testid="file-input"]');
    const dt = new DataTransfer();
    dt.items.add(new File([conteudo], 'reaberto.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 6000));

    const aviso = document.querySelector('[role="alert"]')?.textContent ?? null;
    const estado = document.querySelector('[data-testid="workspace-state"]');
    const paginas = estado?.getAttribute('data-pages');
    return aviso !== null ? `RECUSADO: ${aviso}` : `aceito, ${paginas} pagina(s)`;
  }, base64);
}
console.log('REABRIR  :', reabertura);

const alertas = await page.evaluate(() =>
  [...document.querySelectorAll('[role="alert"]')].map((no) => no.textContent),
);
relatar('UNIR   ', salvoUnir, 'pdf');
console.log('ALERTAS  :', alertas.length === 0 ? 'nenhum' : JSON.stringify(alertas));
salvoUnir.remover();

// ---------------------------------------------------------------------------
// Extrair e dividir, medidos no aparelho.
//
// Sao os dois fluxos que mudaram: extrair virou ferramenta propria e entrega `.pdf`; dividir
// continua entregando `.zip`. O Playwright ja cobre a logica no Chromium — o que so o celular
// responde e se a rota existe no export estatico dentro do WebView e se o plugin proprio
// grava cada um dos dois formatos pelo SAF.
// ---------------------------------------------------------------------------

/** PDF de teste montado no Node, para nao repetir o construtor dentro da pagina. */
function pdfDeTeste(paginas) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: paginas }, (_u, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${paginas} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < paginas; i += 1) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const fluxo = `BT /F1 24 Tf 40 200 Td (P${i + 1}) Tj ET`;
    objs.push(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((b, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

/** Abre a ferramenta e poe um PDF na grade; devolve quantas paginas entraram. */
async function abrirComPdf(rota, paginas) {
  await page.goto(new URL(rota, url).href);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
      'true',
    undefined,
    { timeout: 30_000 },
  );

  return page.evaluate(async (codificado) => {
    const binario = atob(codificado);
    const conteudo = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) conteudo[i] = binario.charCodeAt(i);

    const input = document.querySelector('[data-testid="file-input"]');
    const dt = new DataTransfer();
    dt.items.add(new File([conteudo], 'origem.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 5000));
    return document.querySelectorAll('[data-testid="page-card"]').length;
  }, pdfDeTeste(paginas));
}

/** Reabre um arquivo gravado no aparelho e conta as paginas que o produto enxerga nele. */
async function contarPaginasDe(caminho) {
  const base64 = adb('shell', 'base64', caminho).replace(/\s/g, '');
  await page.goto(new URL('/unir/', url).href);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-ready') ===
      'true',
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(async (codificado) => {
    const binario = atob(codificado);
    const conteudo = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) conteudo[i] = binario.charCodeAt(i);

    const input = document.querySelector('[data-testid="file-input"]');
    const dt = new DataTransfer();
    dt.items.add(new File([conteudo], 'gerado.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 6000));
    const aviso = document.querySelector('[role="alert"]')?.textContent ?? null;
    if (aviso !== null) return `RECUSADO: ${aviso}`;
    return document.querySelector('[data-testid="workspace-state"]')?.getAttribute('data-pages');
  }, base64);
}

// --- EXTRAIR ---------------------------------------------------------------
// Extrair e a opcao "so as escolhidas" de "Unir e extrair".
const cartoesExtrair = await abrirComPdf('/unir/', 6);
await page.click('[data-testid="pages-some"]');
console.log('EXTRAIR  :', `rota carregou, ${cartoesExtrair} cartao(oes) na grade`);

// O defeito relatado pelo usuario: selecionar paginas na grade e mandar extrair nao fazia
// nada, porque a ferramenta lia so o campo de texto. Aqui as paginas sao escolhidas do
// jeito que ele escolhe — clicando — e o criterio e o campo se preencher sozinho.
const ligacao = await page.evaluate(async () => {
  const cartoes = [...document.querySelectorAll('[data-testid="page-card"]')];
  // Pelo `data-testid` do botao de selecao: `querySelector('button')` pegava o primeiro
  // botao do cartao, e quando a lupa entrou ela passou a ser esse primeiro.
  for (const indice of [0, 1, 2]) {
    cartoes[indice]?.querySelector('[data-testid="select-page"]')?.click();
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    campo: document.querySelector('[data-testid="extract-ranges-input"]')?.value ?? null,
    marcadas: document.querySelectorAll('[data-testid="page-card"][data-selected="true"]').length,
    acaoLiberada: document.querySelector('[data-testid="export"]')?.disabled === false,
  };
});
console.log(
  'LIGACAO  :',
  `clicando 3 paginas -> campo=${JSON.stringify(ligacao.campo)}`,
  `| marcadas=${ligacao.marcadas}`,
  `| acao ${ligacao.acaoLiberada ? 'liberada' : 'AINDA BLOQUEADA'}`,
  ligacao.campo === '1-3' ? '— a grade escreve no campo' : '— O CAMPO NAO ACOMPANHOU A GRADE',
);

const salvoExtrair = await salvarPeloSeletor('pdfkitty-extraido.pdf', () =>
  page.click('[data-testid="export"]'),
);
relatar('EXTRAIR', salvoExtrair, 'pdf');

if (salvoExtrair.bytes !== null) {
  // Contar as paginas do resultado e o que separa "gravou alguma coisa" de "gravou o que
  // foi pedido": 3 de 6 escolhidas tem de virar um documento de 3 paginas.
  const paginas = await contarPaginasDe(salvoExtrair.caminho);
  console.log(
    'EXTRAIR CONTEUDO:',
    `${paginas} pagina(s)`,
    paginas === '3' ? '— as 3 paginas escolhidas' : '— ESPERAVA 3',
  );
}
salvoExtrair.remover();

// --- DIVIDIR ---------------------------------------------------------------
const cartoesDividir = await abrirComPdf('/dividir/', 6);
console.log('DIVIDIR  :', `rota carregou, ${cartoesDividir} cartao(oes) na grade`);

// Duas faixas encostadas de proposito: e o caso que a selecao sozinha nao sabe representar,
// porque um conjunto de paginas nao guarda fronteira. Tem de sair DOIS arquivos.
await page.fill('[data-testid="ranges-input"]', '1-3, 4-6');

const salvoDividir = await salvarPeloSeletor('pdfkitty-dividido.zip', () =>
  page.click('[data-testid="split-run"]'),
);
relatar('DIVIDIR', salvoDividir, 'zip');

if (salvoDividir.bytes !== null) {
  const bruto = Buffer.from(
    adb('shell', 'base64', salvoDividir.caminho).replace(/\s/g, ''),
    'base64',
  );
  // Conta os cabecalhos locais do ZIP (PK\x03\x04): um por arquivo empacotado.
  let volumes = 0;
  for (let i = 0; i + 3 < bruto.length; i += 1) {
    if (
      bruto[i] === 0x50 &&
      bruto[i + 1] === 0x4b &&
      bruto[i + 2] === 0x03 &&
      bruto[i + 3] === 0x04
    )
      volumes += 1;
  }
  console.log(
    'DIVIDIR CONTEUDO:',
    `${volumes} volume(s) no pacote`,
    volumes === 2 ? '— as duas faixas viraram dois arquivos' : '— ESPERAVA 2',
  );
}
salvoDividir.remover();

// --- COMPACTAR --------------------------------------------------------------
//
// Duas vias com contratos opostos, e o que as separa e o AVISO. A via sem perda executa
// direto; a forte rasteriza e nao pode comecar sem confirmacao. O Playwright ja fixa essa
// fronteira no Chromium — o que so o celular responde e se o `OffscreenCanvas` do WebView
// aguenta rasterizar um documento inteiro e se o resultado chega ao disco pelo SAF.

const cartoesCompactar = await abrirComPdf('/compactar/', 4);
console.log('COMPACTAR:', `rota carregou, ${cartoesCompactar} cartao(oes) na grade`);

/** Estado da tela de compactar, sem depender de texto traduzido. */
const lerCompactar = () =>
  page.evaluate(() => ({
    modoSemPerda: document
      .querySelector('[data-testid="compress-mode-lossless"]')
      ?.getAttribute('aria-checked'),
    avisoNaTela: document.querySelector('[data-testid="compress-confirm"]') !== null,
    resultado: document.querySelector('[data-testid="compress-results"]')?.textContent ?? null,
  }));

// A via sem perda NAO pode abrir aviso: ela nao degrada nada, e um alerta desnecessario
// treina o usuario a clicar em "confirmar" sem ler — inclusive quando importa.
const antesSemPerda = await lerCompactar();
const salvoSemPerda = await salvarPeloSeletor('pdfkitty-compactado.pdf', async () => {
  await page.click('[data-testid="compress-run"]');
  // Meio segundo e suficiente: o dialogo e sincrono ao clique, nao espera worker algum.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const durante = await lerCompactar();
  console.log(
    'SEM PERDA:',
    `modo inicial=${antesSemPerda.modoSemPerda}`,
    durante.avisoNaTela ? '| AVISO APARECEU ONDE NAO DEVIA' : '| sem aviso, como esperado',
  );
});
relatar('S/PERDA', salvoSemPerda, 'pdf');

const depoisSemPerda = await lerCompactar();
console.log('S/PERDA PAINEL:', depoisSemPerda.resultado ?? 'nao relatou antes/depois');

if (salvoSemPerda.bytes !== null) {
  // Sem perda tem de continuar pesquisavel: o PDF de teste tem texto, e ele precisa
  // sobreviver. E o controle que separa "sem perda" de "forte".
  const paginas = await contarPaginasDe(salvoSemPerda.caminho);
  console.log(
    'S/PERDA CONTEUDO:',
    `${paginas} pagina(s)`,
    paginas === '4' ? '— intacto' : '— ESPERAVA 4',
  );
}
salvoSemPerda.remover();

// A via forte: rasteriza no WebView e PRECISA avisar antes.
await abrirComPdf('/compactar/', 4);
await page.click('[data-testid="compress-mode-quality"]');
await page.click('[data-testid="compress-preset-low"]');
await page.click('[data-testid="compress-run"]');
await new Promise((resolve) => setTimeout(resolve, 800));

const comAviso = await lerCompactar();
const textoAviso = await page.evaluate(
  () => document.querySelector('[data-testid="compress-confirm"]')?.textContent ?? '',
);
console.log(
  'FORTE AVISO:',
  comAviso.avisoNaTela ? 'apareceu' : 'NAO APARECEU — a via forte comecaria sem avisar',
  // Nao basta aparecer: precisa NOMEAR a perda, e nao so perguntar "tem certeza?".
  /pesquisav/i.test(textoAviso) ? '| nomeia a perda de busca' : '| NAO diz o que se perde',
  /OCR/.test(textoAviso) ? '| cita o OCR' : '| nao cita o OCR',
);

if (comAviso.avisoNaTela) {
  const salvoForte = await salvarPeloSeletor('pdfkitty-compactado.pdf', () =>
    page.click('[data-testid="compress-accept"]'),
  );
  relatar('FORTE  ', salvoForte, 'pdf');

  const painelForte = await lerCompactar();
  console.log('FORTE PAINEL:', painelForte.resultado ?? 'nao relatou antes/depois');

  if (salvoForte.bytes !== null && salvoSemPerda.bytes !== null) {
    /*
     * O PDF de teste e VETORIAL, entao rasteriza-lo aumenta o arquivo — a fotografia de uma
     * pagina quase em branco pesa mais que o vetor que a descrevia. Isso nao e defeito: a via
     * forte existe para documento digitalizado. O que seria defeito e a tela nao dizer.
     */
    const cresceu = salvoForte.bytes > salvoSemPerda.bytes;
    const avisouQueCresceu = await page.evaluate(
      () => document.querySelector('[data-testid="compress-grew"]') !== null,
    );

    console.log(
      'FORTE x S/PERDA:',
      `${salvoForte.bytes} vs ${salvoSemPerda.bytes} bytes`,
      cresceu ? '— cresceu, esperado num PDF de texto' : '— encolheu',
      cresceu ? (avisouQueCresceu ? '| a tela avisou' : '| A TELA NAO AVISOU QUE CRESCEU') : '',
    );
  }
  salvoForte.remover();
}

// --- LUPA -------------------------------------------------------------------
//
// No celular ela responde a uma pergunta que o desktop nao faz: o botao e ALCANCAVEL pelo
// dedo? Um alvo abaixo de ~40px reprova na pratica mesmo aparecendo na tela. E a barra de
// acoes da lupa nao pode cair atras dos botoes de navegacao do Android, o mesmo defeito que
// ja escondeu o botao de exportar.

const cartoesLupa = await abrirComPdf('/unir/', 4);
console.log('LUPA     :', `rota carregou, ${cartoesLupa} cartao(oes) na grade`);

const lupa = await page.evaluate(async () => {
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const cartoes = [...document.querySelectorAll('[data-testid="page-card"]')];
  const chaves = cartoes.map((cartao) => cartao.getAttribute('data-page-key'));

  const botaoLupa = cartoes.at(-1)?.querySelector('[data-testid="preview-open"]');
  const alvo = botaoLupa?.getBoundingClientRect();

  // Abre pela ULTIMA pagina: e onde mover para tras tem efeito verificavel.
  botaoLupa?.click();
  await esperar(3000);

  const visor = document.querySelector('[data-testid="page-preview"]');
  if (visor === null) return { aberto: false, alvo: null };

  const canvas = document.querySelector('[data-testid="preview-canvas"]');
  const desenhou = document.querySelector('[data-testid="preview-status"]') === null;

  // A pagina desenhada cabe na tela? Estourar a altura deixaria o rodape inalcancavel.
  const caixaCanvas = canvas?.getBoundingClientRect();
  const rodape = visor.querySelector('footer')?.getBoundingClientRect();
  /*
   * Mede o BOTAO, e nao a caixa do rodape.
   *
   * O rodape vive dentro de um `fixed inset-0`, entao o fundo dele coincide sempre com a
   * borda da janela — medi-lo acusava invasao da area do sistema mesmo com o afastamento
   * correto aplicado. E o botao que precisa ficar acima dos botoes do Android, e e ele que
   * o afastamento empurra. Medir a caixa errada gritava defeito onde nao havia.
   */
  const botaoDoRodape = document
    .querySelector('[data-testid="preview-move-back"]')
    ?.getBoundingClientRect();

  const chaveNaLupa = visor.getAttribute('data-page-key');
  document.querySelector('[data-testid="preview-move-back"]')?.click();
  await esperar(700);

  const posicao = document.querySelector('[data-testid="preview-position"]')?.textContent ?? '';
  const aindaNaMesma =
    document.querySelector('[data-testid="page-preview"]')?.getAttribute('data-page-key') ===
    chaveNaLupa;

  // Ampliar: e o caminho de quem nao consegue ler uma matricula na pagina inteira.
  document.querySelector('[data-testid="preview-zoom"]')?.click();
  await esperar(500);
  const ampliado =
    document.querySelector('[data-testid="preview-stage"]')?.getAttribute('data-zoomed') === 'true';

  document.querySelector('[data-testid="preview-close"]')?.click();
  await esperar(400);

  const depois = [...document.querySelectorAll('[data-testid="page-card"]')].map((cartao) =>
    cartao.getAttribute('data-page-key'),
  );

  return {
    aberto: true,
    desenhou,
    larguraPx: canvas?.width ?? 0,
    alvo: alvo === undefined ? null : { w: Math.round(alvo.width), h: Math.round(alvo.height) },
    canvasCabe:
      caixaCanvas !== undefined && rodape !== undefined
        ? Math.round(caixaCanvas.bottom) <= Math.round(rodape.top) + 1
        : null,
    fundoDoRodape: rodape === undefined ? null : Math.round(rodape.bottom),
    fundoDoBotao: botaoDoRodape === undefined ? null : Math.round(botaoDoRodape.bottom),
    alturaJanela: window.innerHeight,
    posicao: posicao.trim(),
    aindaNaMesma,
    ampliado,
    reordenou: depois[depois.length - 2] === chaves[chaves.length - 1],
    fechou: document.querySelector('[data-testid="page-preview"]') === null,
  };
});

if (!lupa.aberto) {
  console.log('LUPA ABRIR: NAO ABRIU');
} else {
  // 40px e o minimo praticavel para o dedo; abaixo disso o botao existe mas nao se acerta.
  const alvoOk = lupa.alvo !== null && lupa.alvo.w >= 40 && lupa.alvo.h >= 40;
  console.log(
    'LUPA ALVO :',
    lupa.alvo === null ? 'botao ausente' : `${lupa.alvo.w}x${lupa.alvo.h}px`,
    alvoOk ? '| alcancavel pelo dedo' : '| ALVO PEQUENO DEMAIS PARA TOQUE',
  );
  console.log(
    'LUPA PAG  :',
    lupa.desenhou ? `desenhou ${lupa.larguraPx}px` : 'NAO DESENHOU A PAGINA',
    lupa.larguraPx > 600 ? '| resolucao de leitura' : '| RESOLUCAO BAIXA DEMAIS',
    lupa.canvasCabe === true ? '| cabe acima do rodape' : '| A PAGINA INVADE O RODAPE',
  );
  console.log(
    'LUPA ACAO :',
    `${lupa.posicao}`,
    lupa.aindaNaMesma ? '| seguiu a pagina ao mover' : '| SALTOU DE PAGINA AO MOVER',
    lupa.reordenou ? '| a grade recebeu o movimento' : '| A GRADE NAO MUDOU',
    lupa.ampliado ? '| ampliar respondeu' : '| AMPLIAR NAO RESPONDEU',
    lupa.fechou ? '| fechou' : '| NAO FECHOU',
  );

  // O rodape da lupa e um `fixed` proprio: precisa respeitar a area do sistema, como a barra
  // inferior do app ja respeita. Sem isso, mover e girar ficam atras dos botoes do Android.
  console.log(
    'LUPA AREA :',
    `fundo do botao=${lupa.fundoDoBotao}px | janela=${lupa.alturaJanela}px | inset=${areaSegura.inset}px`,
    lupa.fundoDoBotao !== null && lupa.fundoDoBotao > lupa.alturaJanela - areaSegura.inset
      ? '| OS BOTOES INVADEM A AREA DO SISTEMA'
      : '| os botoes ficam acima da area do sistema',
  );
}

console.log('ERROS    :', errors.length === 0 ? 'nenhum' : JSON.stringify(errors.slice(0, 8)));

// Isola a barreira do sistema operacional. Com o CSP desligado, o que sobra impedindo a
// saida de rede e a ausencia da permissao INTERNET no manifesto — e so assim da para
// afirmar que ela tem poder de deteccao, em vez de estar de enfeite atras do CSP.
// Controle do controle: so da para creditar o bloqueio ao sistema se o bypass do CSP tiver
// mesmo desligado o CSP. O sinal e a propria violacao no console — na primeira tentativa o
// navegador reclama de 'connect-src'; se depois do bypass ele nao reclamar mais e a
// requisicao ainda assim falhar, quem barrou foi outra camada.
//
// (Nao adianta testar `eval()` por aqui: codigo injetado por CDP nao esta sujeito ao CSP da
// pagina, entao ele funciona nos dois casos e nao mede nada. Ja tentei.)
const violacoesAntes = violacoesDeCsp.length;

const cdp = await context.newCDPSession(page);
await cdp.send('Page.setBypassCSP', { enabled: true });
await page.reload({ waitUntil: 'domcontentloaded' });

const semCsp = await page.evaluate(async () => {
  try {
    await fetch('https://example.com', { mode: 'no-cors' });
    return 'A REQUISICAO PASSOU — sem o CSP nao sobra barreira alguma';
  } catch (erro) {
    return `bloqueada (${erro.message})`;
  }
});
await page.waitForTimeout(500);

const cspAindaAtua = violacoesDeCsp.length > violacoesAntes;
console.log(
  'CONTROLE : violacoes de CSP na 1a tentativa:',
  violacoesAntes,
  '| apos o bypass:',
  violacoesDeCsp.length - violacoesAntes,
);
console.log('REDE s/CSP:', semCsp);
if (violacoesAntes === 0) {
  console.log(
    '           ATENCAO: nem a 1a tentativa gerou violacao — o CSP pode nao estar valendo.',
  );
} else if (cspAindaAtua) {
  console.log(
    '           ATENCAO: o bypass nao pegou; a linha acima nao isola a barreira do sistema.',
  );
} else {
  console.log(
    '           Sem CSP no caminho e ainda bloqueado: quem barra e o sistema operacional.',
  );
}

// O bypass vale ate ser desligado, e o WebView sobrevive ao fim deste script. Sem isto, a
// proxima execucao mediria um app com o CSP ja desativado por esta — e leria zero violacoes
// como "o CSP nao esta valendo".
await cdp.send('Page.setBypassCSP', { enabled: false });

await browser.close();
