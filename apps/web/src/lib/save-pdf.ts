'use client';

/** Distingue o app instalado da aba do navegador sem importar nada do Tauri. */
function runningInsideTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Onde o arquivo vai ser gravado.
 *
 * Separar "escolher o destino" de "gravar" e o que permite perguntar o nome ANTES de gerar: o
 * usuario decide na hora do clique, ve o progresso, e o arquivo aparece pronto. Se os dois
 * passos fossem um so, so daria para perguntar depois de esperar.
 */
export type Destination =
  | { readonly kind: 'system'; readonly path: string }
  | { readonly kind: 'browser'; readonly fileName: string };

/**
 * Pergunta ao usuario onde salvar.
 *
 * No app instalado abre o seletor do sistema. **Na web nao pergunta nada**: o navegador e
 * dono dessa decisao, e um formulario nosso em cima do fluxo de download dele seria atrito
 * sem ganho. O nome sugerido vira o nome do arquivo baixado.
 *
 * Devolve `null` quando o usuario cancela — que nao e erro, e sim uma decisao.
 */
export async function chooseDestination(fileName: string): Promise<Destination | null> {
  if (!runningInsideTauri()) return { kind: 'browser', fileName };

  // O filtro sai da extensao do nome sugerido: dividir entrega um pacote `.zip`, e oferecer
  // "PDF" ali faria o seletor esconder justamente o que o usuario acabou de gerar.
  const extension = fileName.split('.').pop()?.toLowerCase() ?? 'pdf';

  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });

  return path === null ? null : { kind: 'system', path };
}

/**
 * Tamanho de cada pedaco enviado ao plugin de gravacao.
 *
 * O arquivo inteiro numa requisicao so era uma copia do tamanho do documento dentro da ponte —
 * 551 MB ao unir oito PDFs escaneados. No Android o corpo vira array JSON de numeros, ~3,6x
 * maior: 8 MB viram ~29 MB de texto, o que cabe; 551 MB nao cabiam.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Grava o arquivo no destino escolhido.
 *
 * No app instalado usa comando proprio, e nao o `tauri-plugin-fs`: o dele grava por um
 * descritor destacado do `ParcelFileDescriptor`, e o documento fica registrado com **zero
 * bytes** no Android — o arquivo existe no disco e e ilegivel para qualquer app, inclusive
 * este. Foi medido.
 *
 * Le o `Blob` em pedacos e envia um de cada vez: a tela nunca tem mais que um pedaco na
 * memoria. O destino so muda no `finish_write` — uma falha no meio deixa intacto o arquivo
 * que o usuario escolheu sobrescrever.
 */
export async function writeTo(destination: Destination, content: Blob): Promise<void> {
  if (destination.kind === 'system') {
    const { invoke } = await import('@tauri-apps/api/core');
    let offset = 0;
    do {
      const bytes = new Uint8Array(await content.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      await invoke('plugin:saf-save|write_chunk', bytes, {
        headers: { destination: destination.path, append: offset === 0 ? '0' : '1' },
      });
      offset += CHUNK_BYTES;
    } while (offset < content.size);
    await invoke('plugin:saf-save|finish_write', { destination: destination.path });
    return;
  }

  /*
   * Regra de Ouro 3: o `revokeObjectURL` fica no mesmo escopo do `createObjectURL`, para que
   * nao exista caminho em que um seja chamado sem o outro.
   *
   * O `Blob` vai direto ao download, sem passar por um buffer da pagina.
   */
  const tipo = destination.fileName.toLowerCase().endsWith('.zip')
    ? 'application/zip'
    : 'application/pdf';
  const url = URL.createObjectURL(
    content.type === tipo ? content : content.slice(0, content.size, tipo),
  );
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = destination.fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Copia um arquivo ja gravado para um novo destino, sem passar os bytes pela memoria da tela.
 *
 * So existe no app instalado: e o plugin proprio que le a origem e escreve o destino. Na web
 * o navegador nao deixa reler o que foi baixado.
 */
export async function copySaved(source: string, destination: Destination): Promise<void> {
  if (destination.kind !== 'system') {
    throw new Error('copiar um arquivo salvo so e possivel no app instalado');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin:saf-save|copy_saved', { source, destination: destination.path });
}

/**
 * Descarta um destino que ficou vazio.
 *
 * No Android o seletor **cria o documento** no instante em que o usuario confirma o nome,
 * antes de existir um unico byte. Se a geracao falhar depois, sobra um arquivo de 0 bytes na
 * pasta do usuario — e arquivo de 0 bytes e justamente o sintoma do defeito que o plugin
 * proprio existe para corrigir, o que envenenaria qualquer diagnostico futuro.
 *
 * No desktop nao ha o que descartar: o seletor so devolve um caminho, e apagar seria
 * perigoso, porque o usuario pode ter escolhido sobrescrever um arquivo que ja existia.
 */
export async function discardDestination(destination: Destination): Promise<void> {
  if (destination.kind !== 'system') return;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin:saf-save|discard_uri', { destination: destination.path });
}

/** Escolhe o destino e grava. Usado por quem ja tem o arquivo pronto. */
export async function savePdf(content: Blob, fileName: string): Promise<void> {
  const destination = await chooseDestination(fileName);
  if (destination === null) return;

  await writeTo(destination, content);
}
