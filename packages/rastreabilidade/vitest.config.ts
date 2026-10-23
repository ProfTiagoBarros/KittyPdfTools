import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // A verificacao de integridade lista o repositorio pelo git; em disco lento (OneDrive)
    // isso passa dos 5 s padrao.
    testTimeout: 30_000,
  },
});
