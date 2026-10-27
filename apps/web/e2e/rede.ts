/**
 * Se uma requisicao vista pelo navegador SAI do aparelho (Regra de Ouro 1).
 *
 * Decide pelo PROTOCOLO, e nao so pelo host. O WebKit relata a leitura de um `Blob` como
 * requisicao a uma URL `blob:` — cujo host e vazio —, e o filtro antigo, que olhava so o host,
 * acusou como rede externa a leitura do arquivo que o usuario abriu. `blob:` e `data:` nunca
 * saem da maquina; `http(s)` e `ws(s)` so saem quando o destino nao e o servidor local.
 */
export function leavesTheDevice(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(protocol)) return false;
  return hostname !== '127.0.0.1' && hostname !== 'localhost';
}
