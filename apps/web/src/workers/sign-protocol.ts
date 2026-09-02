import { isEnvelope } from './messages';
import type { ErrorMessage } from './messages';

/**
 * Protocolo do worker de assinatura (US-05).
 *
 * O worker existe enquanto um certificado estiver carregado e e encerrado ao fim da
 * assinatura. A chave privada e a senha vivem so dentro dele: os bytes do `.pfx` sao
 * TRANSFERIDOS pela UI, que fica sem eles, e a memoria vai junto quando o worker morre.
 *
 * Nenhuma operacao aqui acessa a rede. Esta versao produz assinatura AD-RB (sem carimbo de
 * tempo), que e integralmente local; AD-RT depende de uma Autoridade de Carimbo e so entra
 * com o fluxo de consentimento descrito na Regra de Ouro 1.
 */

/** Motivos de falha que a UI traduz. Nunca exibir a mensagem crua da biblioteca. */
export type SignFailure =
  'INVALID_PASSWORD' | 'INVALID_CERTIFICATE' | 'NO_CERTIFICATE_IN_FILE' | 'SIGN_FAILED';

export interface CertificateInfo {
  readonly subject: string;
  readonly issuer: string;
  /** ISO 8601, para a UI formatar no idioma corrente. */
  readonly validFrom: string;
  readonly validUntil: string;
  readonly expired: boolean;
}

export interface LoadCertificateRequest {
  readonly kind: 'loadCertificate';
  readonly id: string;
  /** Transferido: a UI perde os bytes de proposito. */
  readonly pfx: ArrayBuffer;
  readonly passphrase: string;
}

export interface SignRequest {
  readonly kind: 'sign';
  readonly id: string;
  readonly pdf: ArrayBuffer;
  readonly reason: string;
  readonly location: string;
}

export type SignWorkerRequest = LoadCertificateRequest | SignRequest;

export interface CertificateLoadedMessage {
  readonly kind: 'certificateLoaded';
  readonly id: string;
  readonly certificate: CertificateInfo;
}

export interface SignedMessage {
  readonly kind: 'signed';
  readonly id: string;
  readonly pdf: ArrayBuffer;
}

export interface SignErrorMessage extends ErrorMessage {
  readonly reason: SignFailure;
}

export type SignWorkerResponse = CertificateLoadedMessage | SignedMessage | SignErrorMessage;

const RESPONSE_KINDS = new Set(['certificateLoaded', 'signed', 'error']);

export function isSignResponse(value: unknown): value is SignWorkerResponse {
  return isEnvelope(value) && RESPONSE_KINDS.has(value.kind);
}
