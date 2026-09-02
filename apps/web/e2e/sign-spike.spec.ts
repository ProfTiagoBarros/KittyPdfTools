import { test, expect } from '@playwright/test';

/**
 * Spike de viabilidade de US-05.
 *
 * Responde uma pergunta que o comparativo de bibliotecas deixou em aberto: o `@signpdf`,
 * publicado como "signing of PDFs in node", funciona no navegador — e produz uma assinatura
 * estruturalmente valida, e nao apenas um arquivo sem erro?
 *
 * O campo `stage` do relatorio existe para que uma falha diga ONDE parou, e nao apenas que
 * parou. Um spike que termina em "nao deu" nao decide nada.
 */

interface SignReport {
  stage: string;
  certificateGenerated: boolean;
  placeholderAdded: boolean;
  signedWithoutError: boolean;
  signatureIsParseablePkcs7: boolean;
  signerMatchesCertificate: boolean;
  signatureVerifies: boolean;
  signedPdfBytes: number;
  privateKeyLeftMemory: boolean;
  error: string | null;
}

declare global {
  interface Window {
    __pdfkittySign?: { run: () => Promise<SignReport> };
  }
}

test.describe('viabilidade da assinatura no navegador', () => {
  // Gerar uma chave RSA de 2048 bits em JavaScript puro nao e instantaneo.
  test.describe.configure({ timeout: 180_000 });

  let report: SignReport;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Nenhuma requisicao externa pode acontecer durante a assinatura: a chave privada e o
    // documento ficam na maquina, e este spike nao usa carimbo de tempo.
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const { hostname } = new URL(request.url());
      if (hostname !== '127.0.0.1' && hostname !== 'localhost')
        externalRequests.push(request.url());
    });

    await page.goto('/spike/assinar/');
    // Espera o gancho do banco de provas existir, e nao um texto que sinalize isso
    // indiretamente: o que o teste precisa e a funcao, nao o rotulo.
    await page.waitForFunction(() => '__pdfkittySign' in window);

    report = await page.evaluate(async () => {
      const spike = window.__pdfkittySign;
      if (spike === undefined) throw new Error('banco de provas nao inicializado');
      return spike.run();
    });

    expect(pageErrors, 'a assinatura nao deve lancar erro nao tratado').toEqual([]);
    expect(externalRequests, 'assinar sem carimbo de tempo nao acessa a rede').toEqual([]);
    await page.close();
  });

  test('o spike percorreu todas as etapas', () => {
    // Falhando, esta asercao diz em qual etapa parou — o dado que decide o proximo passo.
    expect(report.error, `parou em: ${report.stage}`).toBeNull();
    expect(report.stage).toBe('concluido');
  });

  test('gera um certificado A1 apenas em memoria', () => {
    expect(report.certificateGenerated).toBe(true);
  });

  test('insere o placeholder de assinatura no PDF', () => {
    expect(report.placeholderAdded).toBe(true);
  });

  test('assina sem erro no navegador', () => {
    expect(report.signedWithoutError).toBe(true);
    expect(report.signedPdfBytes).toBeGreaterThan(0);
  });

  test('a assinatura e um PKCS#7 decodificavel', () => {
    // Assinar sem erro nao prova nada: um campo preenchido com lixo tambem "assina".
    expect(report.signatureIsParseablePkcs7).toBe(true);
  });

  test('a assinatura carrega o certificado que a produziu', () => {
    expect(report.signerMatchesCertificate).toBe(true);
  });

  test('o digest assinado confere com o conteudo do documento', () => {
    // A prova de que a assinatura cobre o PDF, e nao um conteudo qualquer.
    expect(report.signatureVerifies).toBe(true);
  });

  test('a chave privada nao deixa a memoria', () => {
    expect(report.privateKeyLeftMemory).toBe(false);
  });
});
