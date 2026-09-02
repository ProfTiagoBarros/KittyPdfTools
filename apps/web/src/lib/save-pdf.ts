'use client';

import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n';

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
 * Grava os bytes no destino escolhido.
 *
 * No app instalado usa comando proprio, e nao o `tauri-plugin-fs`: o dele grava por um
 * descritor destacado do `ParcelFileDescriptor`, e o documento fica registrado com **zero
 * bytes** no Android — o arquivo existe no disco e e ilegivel para qualquer app, inclusive
 * este. Foi medido.
 *
 * Os bytes vao como corpo da requisicao, e nao dentro de JSON, quando o transporte permite.
 */
export async function writeTo(destination: Destination, bytes: Uint8Array): Promise<void> {
  if (destination.kind === 'system') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:saf-save|save_to_uri', bytes, {
      headers: { destination: destination.path },
    });
    return;
  }

  /*
   * Regra de Ouro 3: o `revokeObjectURL` fica no mesmo escopo do `createObjectURL`, para que
   * nao exista caminho em que um seja chamado sem o outro.
   */
  const tipo = destination.fileName.toLowerCase().endsWith('.zip')
    ? 'application/zip'
    : 'application/pdf';
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
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

/** Escolhe o destino e grava. Usado por quem ja tem os bytes prontos. */
export async function savePdf(bytes: Uint8Array, fileName: string): Promise<void> {
  const destination = await chooseDestination(fileName);
  if (destination === null) return;

  await writeTo(destination, bytes);
}

/**
 * Liga o salvamento a um aviso na tela.
 *
 * Existe porque `savePdf` e assincrona: sem isto, cada botao de salvar viraria uma promessa
 * solta, e uma falha de gravacao sumiria em silencio.
 */
export function useSavePdf(): {
  readonly save: (bytes: Uint8Array, fileName: string) => void;
  readonly saveError: string | null;
} {
  const { t } = useTranslation();
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(
    (bytes: Uint8Array, fileName: string) => {
      setSaveError(null);
      void savePdf(bytes, fileName).catch((cause: unknown) => {
        // A causa vai ao console. Este `catch` ja escondeu por uma rodada inteira o motivo
        // real de o salvamento falhar no Android — a tela dizia so "nao foi possivel".
        console.error('Falha ao salvar', { fileName }, cause);
        setSaveError(t('save.failed'));
      });
    },
    [t],
  );

  return { save, saveError };
}
