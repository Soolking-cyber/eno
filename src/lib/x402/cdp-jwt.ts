import 'server-only'
import crypto from 'crypto'

/**
 * ── The Bearer JWT Coinbase's CDP API wants on every facilitator call — rebuilt from the CDP SDK's own builder
 * (github.com/coinbase/cdp-sdk typescript/packages/cdp-sdk/src/auth/utils/jwt.ts, read 2026-11-23) with node:crypto,
 * so the SDK and its dependency tree (viem, solana) stay out of the bundle.
 *   header  { alg: EdDSA | ES256, kid: <key id>, typ: 'JWT', nonce: 16 random bytes as hex }
 *   claims  { sub: <key id>, iss: 'cdp', uris: ['POST api.cdp.coinbase.com/platform/v2/x402/settle'], iat, nbf, exp: +120 }
 * The secret is either an Ed25519 key (base64 of 64 bytes: 32-byte seed then 32-byte public key) or an EC P-256 PEM.
 * One token per request: the `uris` claim binds it to that method and path.
 */
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

function signingKey(secret: string): { alg: 'EdDSA' | 'ES256'; key: crypto.KeyObject } {
  const pem = secret.replace(/\\n/g, '\n')
  if (pem.includes('-----BEGIN')) {
    const key = crypto.createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ec') throw new Error('cdp_key_not_ec')
    return { alg: 'ES256', key }
  }
  const raw = Buffer.from(secret, 'base64')
  if (raw.length !== 64) throw new Error('cdp_key_format')
  const key = crypto.createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) },
    format: 'jwk',
  })
  return { alg: 'EdDSA', key }
}

export function cdpJwt(p: { keyId: string; secret: string; method: string; host: string; path: string }, nowSec = Math.floor(Date.now() / 1000)): string {
  const { alg, key } = signingKey(p.secret)
  const header = { alg, kid: p.keyId, typ: 'JWT', nonce: crypto.randomBytes(16).toString('hex') }
  const claims = { sub: p.keyId, iss: 'cdp', uris: [`${p.method.toUpperCase()} ${p.host}${p.path}`], iat: nowSec, nbf: nowSec, exp: nowSec + 120 }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const sig = alg === 'EdDSA'
    ? crypto.sign(null, Buffer.from(input), key)
    : crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  return `${input}.${b64url(sig)}`
}
