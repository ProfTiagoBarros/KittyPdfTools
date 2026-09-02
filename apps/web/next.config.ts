import type { NextConfig } from 'next';
import { resolvePageExtensions } from './src/config/page-extensions';

/**
 * Regra de Ouro 1 (Zero-Data Transfer): `output: 'export'` remove qualquer runtime de
 * servidor. Sem servidor, nao existe rota capaz de receber um PDF — a restricao passa a
 * ser garantida por construcao, e nao por disciplina de code review.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,

  // Export estatico nao roda o otimizador de imagens (que exigiria servidor).
  images: { unoptimized: true },

  // URLs como /unir/ garantem que o host estatico sirva unir/index.html.
  trailingSlash: true,

  // Rotas de spike so existem quando PDFKITTY_SPIKE=1; ver src/config/page-extensions.ts.
  pageExtensions: resolvePageExtensions(process.env.PDFKITTY_SPIKE),
};

export default nextConfig;
