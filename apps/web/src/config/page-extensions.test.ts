import { describe, it, expect } from 'vitest';
import { resolvePageExtensions, SPIKE_PAGE_EXTENSION } from './page-extensions';

describe('resolvePageExtensions', () => {
  it('nao expoe rotas de spike sem a variavel de ambiente', () => {
    expect(resolvePageExtensions(undefined)).not.toContain(SPIKE_PAGE_EXTENSION);
  });

  it.each(['0', '', 'true', 'yes'])('ignora o valor %o, que nao e "1"', (value) => {
    expect(resolvePageExtensions(value)).not.toContain(SPIKE_PAGE_EXTENSION);
  });

  it('expoe rotas de spike apenas com PDFKITTY_SPIKE=1', () => {
    expect(resolvePageExtensions('1')).toContain(SPIKE_PAGE_EXTENSION);
  });

  it('mantem as extensoes de producao em qualquer caso', () => {
    for (const flag of [undefined, '1']) {
      expect(resolvePageExtensions(flag)).toEqual(expect.arrayContaining(['tsx', 'ts']));
    }
  });
});
