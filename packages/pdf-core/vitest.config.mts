import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // O nucleo nao depende de DOM: roda em Node, o que torna o spike rapido de iterar.
    environment: 'node',
    testTimeout: 30_000,
    coverage: { provider: 'v8', reporter: ['text'], include: ['src/**/*.ts'] },
  },
});
