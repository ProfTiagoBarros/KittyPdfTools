/** Extensoes de arquivo que o Next reconhece como pagina. */
export const PRODUCTION_PAGE_EXTENSIONS = ['tsx', 'ts'] as const;

/** Sufixo das paginas que existem apenas para teste. */
export const SPIKE_PAGE_EXTENSION = 'spike.tsx';

/**
 * Rotas de spike (`page.spike.tsx`) so viram pagina quando PDFKITTY_SPIKE=1.
 *
 * O arquivo continua no repositorio, mas o build de producao simplesmente nao o enxerga
 * como rota: nada e emitido em `out/`, e o host estatico responde 404. Num produto que
 * vende privacidade, uma rota de teste esquecida em producao e superficie que ninguem
 * auditou.
 */
export function resolvePageExtensions(spikeFlag: string | undefined): string[] {
  const extensions: string[] = [...PRODUCTION_PAGE_EXTENSIONS];
  if (spikeFlag === '1') extensions.push(SPIKE_PAGE_EXTENSION);
  return extensions;
}
