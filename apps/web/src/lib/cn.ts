import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes resolvendo conflitos do Tailwind, para que a ultima informada vencca. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
