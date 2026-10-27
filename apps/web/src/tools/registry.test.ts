import { describe, it, expect } from 'vitest';
import { TOOLS, findTool, getTool } from '@/tools/registry';
import { ptBR } from '@/i18n/messages/pt-BR';

describe('registro de ferramentas', () => {
  it('cobre as ferramentas do backlog, com extrair dentro de unir', () => {
    expect(TOOLS.map((tool) => tool.slug)).toEqual([
      'unir',
      'dividir',
      'compactar',
      'ocr',
      'assinar',
      'ofuscar',
    ]);
  });

  it('nao repete slugs', () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(TOOLS)('a ferramenta "$slug" aponta para chaves de traducao existentes', (tool) => {
    expect(ptBR).toHaveProperty(tool.nameKey);
    expect(ptBR).toHaveProperty(tool.descriptionKey);
  });

  it('findTool devolve undefined para slug desconhecido', () => {
    expect(findTool('inexistente')).toBeUndefined();
  });
});

describe('getTool', () => {
  it('devolve a ferramenta registrada', () => {
    expect(getTool('unir').slug).toBe('unir');
  });

  it('lanca erro apontando o arquivo do registro quando o slug nao existe', () => {
    expect(() => getTool('inexistente')).toThrowError(/src\/tools\/registry\.ts/);
  });
});
