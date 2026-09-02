/// <reference lib="webworker" />
import forge from 'node-forge';
import { toTransferable } from './messages';
import type {
  CertificateInfo,
  SignFailure,
  SignWorkerRequest,
  SignWorkerResponse,
} from './sign-protocol';

/**
 * Worker de assinatura. Ver `sign-protocol.ts` para o desenho e as garantias.
 *
 * O material de chave nunca sai daqui: nao ha mensagem que o devolva, e o worker e encerrado
 * pela UI ao fim da assinatura.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

interface LoadedCertificate {
  readonly pfx: Uint8Array;
  readonly passphrase: string;
}

let loaded: LoadedCertificate | undefined;

function reply(message: SignWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function fail(id: string, reason: SignFailure, detail: string): void {
  // `message` e so para log. A UI decide o texto pelo `reason`, no idioma corrente.
  reply({ kind: 'error', id, message: detail, reason });
}

scope.addEventListener('message', (event: MessageEvent<SignWorkerRequest>) => {
  void handle(event.data);
});

async function handle(request: SignWorkerRequest): Promise<void> {
  switch (request.kind) {
    case 'loadCertificate':
      loadCertificate(request.id, new Uint8Array(request.pfx), request.passphrase);
      return;
    case 'sign':
      await sign(request.id, new Uint8Array(request.pdf), request.reason, request.location);
      return;
  }
}

function loadCertificate(id: string, pfx: Uint8Array, passphrase: string): void {
  let info: CertificateInfo;

  try {
    info = describeCertificate(pfx, passphrase);
  } catch (cause) {
    // Senha errada e arquivo invalido chegam como a mesma excecao do node-forge; a mensagem
    // e o unico sinal disponivel para distinguir os dois casos para o usuario.
    const detail = cause instanceof Error ? cause.message : String(cause);
    const wrongPassword = /mac|password|invalid password/i.test(detail);
    fail(id, wrongPassword ? 'INVALID_PASSWORD' : 'INVALID_CERTIFICATE', detail);
    return;
  }

  loaded = { pfx, passphrase };
  reply({ kind: 'certificateLoaded', id, certificate: info });
}

function describeCertificate(pfx: Uint8Array, passphrase: string): CertificateInfo {
  const binary = String.fromCharCode(...pfx);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binary), passphrase);

  const certBagType = forge.pki.oids.certBag;
  if (certBagType === undefined) throw new Error('node-forge sem OID de certBag');

  const bags: forge.pkcs12.Bag[] = p12.getBags({ bagType: certBagType })[certBagType] ?? [];
  const certificate = bags.find((bag) => bag.cert != null)?.cert;
  if (certificate == null) throw new Error('NO_CERTIFICATE_IN_FILE');

  // `getField` e `attributes` sao `any` no node-forge; a conversao fica confinada aqui,
  // em vez de espalhar `any` a partir da fronteira da biblioteca.
  const name = (field: forge.pki.Certificate['subject']): string => {
    const common = field.getField('CN') as { value?: unknown } | null;
    if (typeof common?.value === 'string') return common.value;
    return field.attributes.map((attribute) => String(attribute.value)).join(', ');
  };

  return {
    subject: String(name(certificate.subject)),
    issuer: String(name(certificate.issuer)),
    validFrom: certificate.validity.notBefore.toISOString(),
    validUntil: certificate.validity.notAfter.toISOString(),
    expired: certificate.validity.notAfter.getTime() < Date.now(),
  };
}

async function sign(id: string, pdf: Uint8Array, reason: string, location: string): Promise<void> {
  if (loaded === undefined) {
    fail(id, 'NO_CERTIFICATE_IN_FILE', 'nenhum certificado carregado');
    return;
  }

  try {
    // `placeholder-plain` opera nos bytes. O `placeholder-pdf-lib` dependeria do pdf-lib
    // upstream abandonado e traria uma segunda biblioteca de PDF para o bundle.
    const { plainAddPlaceholder } = await import('@signpdf/placeholder-plain');
    const { SignPdf } = await import('@signpdf/signpdf');
    const { P12Signer } = await import('@signpdf/signer-p12');

    const prepared = plainAddPlaceholder({
      pdfBuffer: Buffer.from(pdf),
      reason,
      location,
      contactInfo: '',
      name: '',
    });

    const signer = new P12Signer(Buffer.from(loaded.pfx), { passphrase: loaded.passphrase });
    const signed = await new SignPdf().sign(prepared, signer);

    const buffer = toTransferable(new Uint8Array(signed));
    reply({ kind: 'signed', id, pdf: buffer }, [buffer]);
  } catch (cause) {
    fail(id, 'SIGN_FAILED', cause instanceof Error ? cause.message : String(cause));
  }
}
