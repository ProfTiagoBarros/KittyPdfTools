import type { MessageKey } from '@/i18n';

export interface ToolDefinition {
  /** Segmento de rota. Em portugues por ser o mercado primario e o idioma indexado. */
  readonly slug: string;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
}

/**
 * Fonte unica das ferramentas: a sidebar, o mapa do site e as rotas derivam daqui.
 * Adicionar uma ferramenta e acrescentar uma entrada + a pasta da rota correspondente.
 */
export const TOOLS = [
  { slug: 'unir', nameKey: 'tool.merge.name', descriptionKey: 'tool.merge.description' },
  { slug: 'extrair', nameKey: 'tool.extract.name', descriptionKey: 'tool.extract.description' },
  { slug: 'dividir', nameKey: 'tool.split.name', descriptionKey: 'tool.split.description' },
  { slug: 'compactar', nameKey: 'tool.compress.name', descriptionKey: 'tool.compress.description' },
  { slug: 'ocr', nameKey: 'tool.ocr.name', descriptionKey: 'tool.ocr.description' },
  { slug: 'assinar', nameKey: 'tool.sign.name', descriptionKey: 'tool.sign.description' },
  { slug: 'ofuscar', nameKey: 'tool.redact.name', descriptionKey: 'tool.redact.description' },
] as const satisfies readonly ToolDefinition[];

export type ToolSlug = (typeof TOOLS)[number]['slug'];

export function findTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

/**
 * Versao estrita de `findTool`, para uso nas rotas: uma pagina que exista sem entrada
 * correspondente no registro e um erro de programacao, e deve quebrar o build.
 */
export function getTool(slug: string): ToolDefinition {
  const tool = findTool(slug);
  if (tool === undefined) {
    throw new Error(`Ferramenta '${slug}' ausente do registro em src/tools/registry.ts`);
  }
  return tool;
}
