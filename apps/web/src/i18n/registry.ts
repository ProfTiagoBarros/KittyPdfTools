import { ptBR, type Messages } from './messages/pt-BR';
import { en } from './messages/en';

export interface LocaleDefinition {
  /** Nome do idioma escrito no proprio idioma. */
  readonly label: string;
  readonly messages: Messages;
}

/**
 * PARA ADICIONAR UM IDIOMA:
 *   1. crie `messages/<codigo>.ts` exportando um objeto anotado com `: Messages`;
 *   2. acrescente uma linha neste objeto.
 * Nenhum componente precisa ser tocado.
 */
export const LOCALES = {
  'pt-BR': { label: 'Portugues (Brasil)', messages: ptBR },
  en: { label: 'English', messages: en },
} as const satisfies Record<string, LocaleDefinition>;

export type Locale = keyof typeof LOCALES;

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export const LOCALE_CODES = Object.keys(LOCALES) as readonly Locale[];

export function isLocale(value: string): value is Locale {
  return Object.prototype.hasOwnProperty.call(LOCALES, value);
}
