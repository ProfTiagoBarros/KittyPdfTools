import { isPdfCoreError, type PdfCoreErrorCode } from 'pdf-core';
import type { MessageKey } from './messages/pt-BR';

/**
 * Traduz um erro do nucleo para o idioma corrente.
 *
 * A mensagem que acompanha um `PdfCoreError` e para log: foi escrita num idioma so. Aqui o
 * codigo vira chave de traducao e os parametros preenchem a frase — e um codigo desconhecido
 * cai num texto generico, em vez de vazar texto cru do nucleo para a tela.
 */
export function coreErrorKey(error: unknown): MessageKey {
  if (!isPdfCoreError(error)) return 'coreError.unknown';
  const key = `coreError.${error.code}` as MessageKey;
  return key;
}

export function coreErrorParams(error: unknown): Record<string, string | number> {
  return isPdfCoreError(error) ? { ...error.params } : {};
}

/** Todos os codigos que o nucleo pode emitir. Existe para o teste de cobertura das chaves. */
export const CORE_ERROR_CODES = [
  'EMPTY_COMPOSITION',
  'DUPLICATE_SOURCE',
  'UNKNOWN_SOURCE',
  'PAGE_OUT_OF_RANGE',
  'INVALID_ROTATION',
  'DOCUMENT_HAS_NO_PAGES',
  'EMPTY_RANGE_SPEC',
  'INVALID_RANGE_PART',
  'REVERSED_RANGE',
  'INVALID_PAGE_NUMBER',
  'PAGE_DOES_NOT_EXIST',
  'INVALID_MAX_BYTES',
  'INVALID_SCALE',
  'REDACTION_PAGE_OUT_OF_RANGE',
  'INVALID_MAX_EDGE',
  'NO_CANVAS_CONTEXT',
  'INTERNAL',
] as const satisfies readonly PdfCoreErrorCode[];
