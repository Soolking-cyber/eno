/**
 * ── WEB BOT AUTH: eno.vn's key directory (owner 2026-11-17, "do this" on isitagentready's informational check) ──────────────
 *
 * /.well-known/http-message-signatures-directory — a JWKS of the Ed25519 key eno's own bots and agents sign their requests with
 * (IETF webbotauth: draft-meunier-http-message-signatures-directory-03; Cloudflare's reading of it:
 * developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/). Receiving sites verify such a request against it.
 *
 * ⛔ THE DIRECTORY ITSELF IS SIGNED, AND THE SIGNATURE IS FIXED HERE (no key on the box). Cloudflare requires one signature per key
 * on the directory's own response, tag "http-message-signatures-directory", over `"@authority";req` — and that is all it covers:
 * the host name plus the parameters. So it was computed once, offline, for exactly `eno.vn`, and is served as constant headers;
 * a mirror on another host cannot reuse it (its @authority differs). Other hosts get the key set without the signature.
 * ⛔ IT EXPIRES (`expires` below, one year from signing): re-sign with the private key before then, from the vault
 * (`web-bot-auth-ed25519-private-jwk`) — never from this repository, which is public and must never hold it.
 * web-bot-auth.test.ts verifies the signature against the key on every run, so a hand-edited header fails the suite.
 *
 * Signing OUTBOUND requests (tag "web-bot-auth", `Signature-Agent: "https://eno.vn/.well-known/http-message-signatures-directory"`)
 * and registering with Cloudflare's verified bots are separate steps, not done here.
 */
export const WEB_BOT_AUTH_AUTHORITY = 'eno.vn'

/** The public key (RFC 8037 OKP). Its RFC 7638 thumbprint is the `kid` and every signature's `keyid`. */
export const WEB_BOT_AUTH_KEY = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'dfpn_m_KA2lGwJAcmFkIu7q7YC3cnUfvlOTlFiVZnd8',
  kid: 'DfjoY5qxzSrJrlBCw3QQTLb3LMtdvc-4aIpcty8i7wI',
  alg: 'EdDSA',
  use: 'sig',
  // The key's lifetime (seconds since the epoch), as the directory signature's own created/expires: Web Bot Auth directories
  // list nbf/exp per key (ora 2026-11-17). Rotate the key and these together.
  nbf: 1794893554,
  exp: 1826429554,
} as const

/** Signed 2026-11-17 (created 1794893554); valid until 2027-11-17 (expires 1826429554). */
export const DIRECTORY_SIGNATURE_INPUT =
  'sig1=("@authority";req);alg="ed25519";keyid="DfjoY5qxzSrJrlBCw3QQTLb3LMtdvc-4aIpcty8i7wI";tag="http-message-signatures-directory";created=1794893554;expires=1826429554'
export const DIRECTORY_SIGNATURE = 'sig1=:0QH+tloJIsynot6BYTcEo3OJB7OMneN0fYKzsU2PxG+rRJHSFp8QHCwfetnyJRtDeTA+7tJaFihCE0ZbEVN3Bg==:'

export const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json'

export const keyDirectory = () => ({ keys: [WEB_BOT_AUTH_KEY] })

/** The directory's headers for a request to `host`: the signature only where it was made for (WEB_BOT_AUTH_AUTHORITY). */
export function directoryHeaders(host: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': DIRECTORY_CONTENT_TYPE,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  }
  if ((host ?? '').toLowerCase().replace(/:\d+$/, '') === WEB_BOT_AUTH_AUTHORITY) {
    h['Signature-Input'] = DIRECTORY_SIGNATURE_INPUT
    h.Signature = DIRECTORY_SIGNATURE
  }
  return h
}
