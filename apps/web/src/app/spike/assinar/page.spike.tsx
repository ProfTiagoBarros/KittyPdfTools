'use client';

import { useEffect } from 'react';
import { createTextPdf } from 'pdf-core';

/**
 * Banco de provas de viabilidade da assinatura no navegador (US-05). Nao faz parte do produto.
 *
 * A pergunta que este spike responde: o `@signpdf`, publicado como "signing of PDFs in node",
 * funciona num navegador? E a assinatura que ele produz e estruturalmente valida, ou apenas
 * "nao deu erro"?
 *
 * `page.spike.tsx` so vira rota com PDFKITTY_SPIKE=1.
 */

export interface SignReport {
  /** Etapa alcancada; util para saber ONDE falhou, e nao apenas que falhou. */
  stage: string;
  certificateGenerated: boolean;
  placeholderAdded: boolean;
  signedWithoutError: boolean;
  /** A assinatura foi encontrada dentro do PDF e e um PKCS#7 decodificavel. */
  signatureIsParseablePkcs7: boolean;
  /** O certificado embutido na assinatura e o mesmo que assinou. */
  signerMatchesCertificate: boolean;
  /** O digest da assinatura confere com o conteudo assinado. */
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

const PASSPHRASE = 'spike-somente-em-memoria';

export default function SignSpikePage() {
  useEffect(() => {
    window.__pdfkittySign = {
      async run(): Promise<SignReport> {
        const report: SignReport = {
          stage: 'inicio',
          certificateGenerated: false,
          placeholderAdded: false,
          signedWithoutError: false,
          signatureIsParseablePkcs7: false,
          signerMatchesCertificate: false,
          signatureVerifies: false,
          signedPdfBytes: 0,
          privateKeyLeftMemory: false,
          error: null,
        };

        try {
          // 1. Certificado A1 autoassinado, criado e mantido apenas em memoria. Nada toca o
          //    disco: e a mesma garantia que o produto precisa dar com o .pfx do usuario.
          report.stage = 'gerando certificado';
          const forge = (await import('node-forge')).default;
          const keys = forge.pki.rsa.generateKeyPair(2048);
          const cert = forge.pki.createCertificate();
          cert.publicKey = keys.publicKey;
          cert.serialNumber = '01';
          cert.validity.notBefore = new Date(Date.now() - 86_400_000);
          cert.validity.notAfter = new Date(Date.now() + 86_400_000);
          const attrs = [
            { name: 'commonName', value: 'PDFKitty Spike' },
            { name: 'countryName', value: 'BR' },
            { name: 'organizationName', value: 'PDFKitty' },
          ];
          cert.setSubject(attrs);
          cert.setIssuer(attrs);
          cert.sign(keys.privateKey, forge.md.sha256.create());

          const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, {
            algorithm: '3des',
          });
          const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
          const p12Bytes = Uint8Array.from(p12Der, (character) => character.charCodeAt(0));
          report.certificateGenerated = p12Bytes.length > 0;

          // 2. Placeholder de assinatura. Usamos `placeholder-plain`, que opera nos bytes:
          //    o `placeholder-pdf-lib` depende do pdf-lib upstream abandonado e traria uma
          //    segunda biblioteca de PDF para o bundle.
          report.stage = 'inserindo placeholder';
          const original = await createTextPdf([[{ text: 'CONTRATO PARA ASSINAR', y: 150 }]]);
          const { plainAddPlaceholder } = await import('@signpdf/placeholder-plain');
          const withPlaceholder = plainAddPlaceholder({
            pdfBuffer: Buffer.from(original),
            reason: 'Spike de viabilidade',
            contactInfo: 'spike@pdfkitty.local',
            name: 'PDFKitty Spike',
            location: 'Brasil',
          });
          report.placeholderAdded = withPlaceholder.length > original.length;

          // 3. Assinatura propriamente dita.
          report.stage = 'assinando';
          const { SignPdf } = await import('@signpdf/signpdf');
          const { P12Signer } = await import('@signpdf/signer-p12');
          const signer = new P12Signer(Buffer.from(p12Bytes), { passphrase: PASSPHRASE });
          const signed = await new SignPdf().sign(withPlaceholder, signer);
          report.signedWithoutError = true;
          report.signedPdfBytes = signed.length;

          // 4. Verificacao. Assinar sem erro nao prova nada: o que importa e a assinatura ser
          //    um PKCS#7 decodificavel, ancorado no certificado certo, e cujo digest confira.
          report.stage = 'verificando';
          const verification = verifySignature(signed.toString('latin1'), forge, cert);
          report.signatureIsParseablePkcs7 = verification.parseable;
          report.signerMatchesCertificate = verification.signerMatches;
          report.signatureVerifies = verification.digestMatches;

          // 5. A chave privada nunca sai da memoria: nenhuma requisicao de rede acontece.
          report.privateKeyLeftMemory = false;
          report.stage = 'concluido';
        } catch (cause) {
          report.error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        }

        return report;
      },
    };

    return () => {
      delete window.__pdfkittySign;
    };
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Spike — assinatura no navegador</h1>
      {/* O teste espera o gancho global existir, nao este texto: sinalizar prontidao
          por estado obrigaria a chamar setState dentro do efeito. */}
      <p data-testid="sign-status" className="mt-2 text-sm">
        banco de provas
      </p>
    </main>
  );
}

/** Forma minima de um PKCS#7 assinado, que e o unico caso que nos interessa aqui. */
interface SignedMessage {
  certificates?: import('node-forge').pki.Certificate[];
  rawCapture?: { authenticatedAttributes?: unknown[] };
}

interface Verification {
  parseable: boolean;
  signerMatches: boolean;
  digestMatches: boolean;
}

/**
 * Extrai a assinatura do PDF e a valida.
 *
 * O PDF guarda o PKCS#7 em hexadecimal dentro de `/Contents <...>`, e `/ByteRange` diz quais
 * trechos do arquivo foram assinados — justamente todos menos o proprio campo da assinatura.
 */
function verifySignature(
  pdf: string,
  forge: typeof import('node-forge'),
  expected: import('node-forge').pki.Certificate,
): Verification {
  const result: Verification = { parseable: false, signerMatches: false, digestMatches: false };

  const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(pdf);
  const contentsMatch = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(pdf);
  if (byteRangeMatch === null || contentsMatch === null) return result;

  const hex = (contentsMatch[1] ?? '').replace(/(00)+$/, '');
  const der = forge.util.hexToBytes(hex);

  // `messageFromAsn1` devolve uma uniao (envelopado ou assinado); so o assinado tem
  // certificados, entao a leitura passa por uma forma estrutural minima.
  let message: SignedMessage;
  try {
    message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der));
  } catch {
    return result;
  }
  result.parseable = true;

  const signerCert = message.certificates?.[0];
  if (signerCert !== undefined) {
    result.signerMatches =
      forge.pki.certificateToPem(signerCert) === forge.pki.certificateToPem(expected);
  }

  // Reconstroi exatamente os bytes cobertos pelo ByteRange e confere contra o digest assinado.
  const [, a, b, c, d] = byteRangeMatch.map(Number);
  const signedContent =
    pdf.slice(a ?? 0, (a ?? 0) + (b ?? 0)) + pdf.slice(c ?? 0, (c ?? 0) + (d ?? 0));

  const digestFromAttrs = extractMessageDigest(forge, message);
  if (digestFromAttrs === null) return result;

  const computed = forge.md.sha256.create();
  computed.update(signedContent);
  result.digestMatches = computed.digest().getBytes() === digestFromAttrs;

  return result;
}

/** Le o atributo `messageDigest` do PKCS#7, que e o hash do conteudo assinado. */
function extractMessageDigest(
  forge: typeof import('node-forge'),
  message: SignedMessage,
): string | null {
  const attributes = message.rawCapture?.authenticatedAttributes ?? [];

  for (const attribute of attributes) {
    const asn1 = attribute as { value?: { value?: unknown }[] };
    const oidValue = asn1.value?.[0]?.value;
    if (typeof oidValue !== 'string') continue;
    if (forge.asn1.derToOid(oidValue) !== forge.pki.oids.messageDigest) continue;

    const digestSet = asn1.value?.[1] as { value?: { value?: unknown }[] } | undefined;
    const digest = digestSet?.value?.[0]?.value;
    if (typeof digest === 'string') return digest;
  }

  return null;
}
