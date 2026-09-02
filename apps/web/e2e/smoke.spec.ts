import { test, expect } from '@playwright/test';

const TOOL_SLUGS = ['unir', 'dividir', 'extrair', 'ocr', 'assinar', 'ofuscar'] as const;

test('a home lista todas as ferramentas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDFKitty');

  // Ancorado no href, e nao no rotulo: o texto muda conforme o idioma detectado.
  for (const slug of TOOL_SLUGS) {
    await expect(page.locator(`a[href="/${slug}/"]`)).toBeVisible();
  }
});

for (const slug of TOOL_SLUGS) {
  test(`a rota /${slug}/ e servida estaticamente`, async ({ page }) => {
    const response = await page.goto(`/${slug}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}

test('nenhuma requisicao de rede sai para host externo', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(externalRequests).toEqual([]);
});

/**
 * Valida a cadeia de i18n contra o export estatico real: o HTML e sempre pre-renderizado
 * em pt-BR, e o idioma do navegador so e aplicado no cliente, apos a hidratacao.
 */
test.describe('deteccao de idioma do navegador', () => {
  test.describe('navegador em portugues', () => {
    test.use({ locale: 'pt-BR' });

    test('mantem a interface em portugues', async ({ page }) => {
      await page.goto('/unir/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Unir');
    });
  });

  test.describe('navegador em ingles', () => {
    test.use({ locale: 'en-US' });

    test('troca a interface para ingles sem recarregar', async ({ page }) => {
      await page.goto('/unir/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge');
    });

    test('o HTML estatico entregue continua em pt-BR', async ({ request }) => {
      const response = await request.get('/unir/');
      expect(await response.text()).toContain('Unir');
    });
  });
});
