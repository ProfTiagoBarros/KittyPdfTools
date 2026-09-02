import { defineConfig, devices } from '@playwright/test';

/**
 * O E2E roda contra o export estatico (`next build` -> out/), e nao contra `next dev`:
 * e exatamente o artefato que sera publicado e empacotado no Tauri. Web Workers e WASM
 * se comportam de forma diferente sob dev server, e e o comportamento real que importa.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  /**
   * Espera das asserções: 15 s, e não os 5 s padrão.
   *
   * Tudo aqui é estado EVENTUAL — o workspace ficar pronto, a página aparecer na grade — e
   * depende de subir dois Web Workers, abrir o PDF e desenhar. Com a suíte inteira em
   * paralelo nesta máquina, 5 s é apertado, e o sintoma é sempre o mesmo: um punhado de
   * `toHaveAttribute` falha numa execução e passa na seguinte.
   *
   * Aumentar a espera não enfraquece asserção nenhuma: o que se afirma continua idêntico,
   * só se dá mais tempo para o estado chegar. Um teste que realmente quebrar segue quebrando
   * — apenas 10 s mais tarde.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  /**
   * Motores testados.
   *
   * O "webkit" do Playwright NAO e o Safari: e um build do motor por tras dele. E a melhor
   * aproximacao disponivel no Windows, e tambem o motor que o Tauri usa no macOS — entao
   * vale mais do que como simples cobertura de navegador.
   *
   * O Firefox e OPCIONAL porque o build do Playwright nao inicia em toda maquina Windows:
   * o carregador side-by-side falha ao resolver o assembly `mozglue`, mesmo com o Visual C++
   * Redistributable instalado e apos reinstalacao limpa. A configuracao esta correta e roda
   * onde o binario inicia; ative com PDFKITTY_FIREFOX=1.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ...(process.env.PDFKITTY_FIREFOX === '1'
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],

  webServer: {
    // Build com PDFKITTY_SPIKE=1 para que a rota do banco de provas exista.
    command: 'pnpm run build:spike && pnpm exec http-server out -p 4173 --silent',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
