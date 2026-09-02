import { inflateSync } from 'node:zlib';
import forge from 'node-forge';
import { test, expect, type Page } from '@playwright/test';

/**
 * Exercita US-05 pela interface.
 *
 * O certificado A1 de teste e gerado a cada execucao e nunca toca o disco — a regra do
 * `.gitignore` contra `*.pfx` continua valendo sem excecao.
 *
 * O teste central verifica a assinatura no arquivo baixado, e nao apenas que a interface
 * disse "assinado".
 */

const PASSPHRASE = 'senha-de-teste';

function simplePdf(text: string): string {
  const content = `BT /F1 24 Tf 40 200 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}

/**
 * Gera um `.pfx` autoassinado no processo de teste.
 *
 * Fica aqui, e nao dentro da pagina, porque `page.evaluate` roda JavaScript cru e nao resolve
 * especificadores de modulo como `node-forge`. Nada e escrito em disco: os bytes vao direto
 * para o campo de arquivo.
 */
function makeCertificate(commonName: string, passphrase: string, validUntil?: Date): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = validUntil ?? new Date(Date.now() + 86_400_000);

  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'PDFKitty Teste' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'latin1');
}

const state = (page: Page) => page.getByTestId('workspace-state');

async function attachPdf(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(simplePdf('CONTRATO'), 'latin1'),
  });
}

async function attachCertificate(page: Page, bytes: Buffer, name = 'teste.pfx'): Promise<void> {
  await page.getByTestId('pfx-input').setInputFiles({
    name,
    mimeType: 'application/x-pkcs12',
    buffer: bytes,
  });
}

/** A assinatura fica em `/Contents <...>`, referenciada por `/ByteRange`. */
function hasSignature(pdf: Buffer): boolean {
  const text = pdf.toString('latin1');
  return /\/ByteRange\s*\[/.test(text) && /\/Contents\s*<[0-9A-Fa-f]{100,}>/.test(text);
}

/** Confirma que o conteudo original sobreviveu: assinar nao pode alterar o documento. */
function containsWord(pdf: Buffer, word: string): boolean {
  const literal = Buffer.from(word, 'latin1');
  const hex = literal.toString('hex');
  const candidates = [
    literal,
    Buffer.from(hex.toUpperCase(), 'latin1'),
    Buffer.from(hex.toLowerCase(), 'latin1'),
  ];
  const found = (haystack: Buffer) => candidates.some((needle) => haystack.includes(needle));
  if (found(pdf)) return true;

  const open = Buffer.from('stream', 'latin1');
  const close = Buffer.from('endstream', 'latin1');
  let from = 0;

  for (;;) {
    const start = pdf.indexOf(open, from);
    if (start === -1) return false;
    let dataStart = start + open.length;
    if (pdf[dataStart] === 0x0d) dataStart += 1;
    if (pdf[dataStart] === 0x0a) dataStart += 1;
    const end = pdf.indexOf(close, dataStart);
    if (end === -1) return false;
    let dataEnd = end;
    while (dataEnd > dataStart) {
      const last = pdf[dataEnd - 1];
      if (last !== 0x0a && last !== 0x0d) break;
      dataEnd -= 1;
    }
    try {
      if (found(inflateSync(pdf.subarray(dataStart, dataEnd)))) return true;
    } catch {
      // stream nao comprimido com Flate: nada a fazer
    }
    from = end + close.length;
  }
}

test.describe('assinatura', () => {
  // Gerar chave RSA de 2048 bits em JavaScript puro nao e instantaneo.
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/assinar/');
    await expect(state(page)).toHaveAttribute('data-ready', 'true');
  });

  test('sem certificado, nao ha o que assinar', async ({ page }) => {
    await expect(page.getByTestId('sign-run')).toBeDisabled();
  });

  test('senha errada e reportada como senha errada', async ({ page }) => {
    const pfx = makeCertificate('Fulano de Tal', PASSPHRASE);
    await attachCertificate(page, pfx);

    await page.getByTestId('passphrase-input').fill('senha-incorreta');
    await page.getByTestId('load-cert').click();

    // A mensagem crua do node-forge ("MAC verify failure") nao pode chegar a tela.
    const error = page.getByTestId('sign-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/(senha incorreta|wrong password)/i);
    await expect(error).not.toContainText(/MAC|forge/i);
  });

  test('arquivo que nao e certificado e recusado com clareza', async ({ page }) => {
    await attachCertificate(page, Buffer.from([1, 2, 3, 4, 5]), 'lixo.pfx');
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();

    await expect(page.getByTestId('sign-error')).toContainText(
      /(certificado a1|a1 certificate|nao contem|no usable)/i,
    );
  });

  test('o certificado carregado mostra titular, emissor e validade', async ({ page }) => {
    const pfx = makeCertificate('Fulano de Tal', PASSPHRASE);
    await attachCertificate(page, pfx);
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();

    const info = page.getByTestId('cert-info');
    await expect(info).toBeVisible();
    await expect(info).toContainText('Fulano de Tal');
    // Certificado valido: o aviso de vencido nao deve aparecer.
    await expect(page.getByTestId('cert-expired')).toHaveCount(0);
  });

  test('certificado vencido carrega, mas avisa', async ({ page }) => {
    // Vencido nao impede assinar — impedir seria decidir pelo usuario. Mas ele precisa saber
    // antes, e nao quando alguem recusar o documento.
    const expired = makeCertificate('Fulano Vencido', PASSPHRASE, new Date(Date.now() - 3_600_000));
    await attachCertificate(page, expired);
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();

    await expect(page.getByTestId('cert-info')).toBeVisible();
    await expect(page.getByTestId('cert-expired')).toBeVisible();
  });

  test('remover o certificado encerra a sessao', async ({ page }) => {
    const pfx = makeCertificate('Fulano de Tal', PASSPHRASE);
    await attachCertificate(page, pfx);
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();
    await expect(page.getByTestId('cert-info')).toBeVisible();

    await page.getByTestId('remove-cert').click();

    await expect(page.getByTestId('cert-info')).toHaveCount(0);
    await expect(page.getByTestId('sign-run')).toBeDisabled();
  });

  test('US-05 — assina o documento e o arquivo sai com assinatura', async ({ page }) => {
    await attachPdf(page);
    await expect(page.getByTestId('page-card')).toHaveCount(1);

    const pfx = makeCertificate('Fulano de Tal', PASSPHRASE);
    await attachCertificate(page, pfx);
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();
    await expect(page.getByTestId('cert-info')).toBeVisible();

    await page.getByTestId('reason-input').fill('Concordo com os termos');

    // No fluxo unificado a entrega fecha a geracao: nao ha segundo clique para baixar.
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('sign-run').click();

    await expect(page.getByTestId('sign-result')).toBeVisible({ timeout: 90_000 });
    // A sessao termina junto com a assinatura: o certificado sai da memoria.
    await expect(page.getByTestId('cert-info')).toHaveCount(0);

    const file = await download;

    expect(file.suggestedFilename()).toBe('pdfkitty-assinado.pdf');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    // Controle: o PDF sem assinar NAO tem campo de assinatura.
    expect(hasSignature(Buffer.from(simplePdf('CONTRATO'), 'latin1'))).toBe(false);

    expect(hasSignature(bytes), 'o arquivo baixado precisa conter a assinatura').toBe(true);
    expect(containsWord(bytes, 'CONTRATO'), 'assinar nao altera o conteudo').toBe(true);
  });

  test('assinar nao faz nenhuma requisicao de rede (AD-RB)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const { hostname } = new URL(request.url());
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') external.push(request.url());
    });

    await attachPdf(page);
    const pfx = makeCertificate('Fulano de Tal', PASSPHRASE);
    await attachCertificate(page, pfx);
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('load-cert').click();
    await expect(page.getByTestId('cert-info')).toBeVisible();

    await page.getByTestId('sign-run').click();
    await expect(page.getByTestId('sign-result')).toBeVisible({ timeout: 90_000 });

    // Sem carimbo de tempo, a assinatura e integralmente local — a promessa do produto.
    expect(external).toEqual([]);
  });
});
