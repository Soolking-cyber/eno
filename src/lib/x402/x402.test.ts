import crypto from 'crypto'
import { describe, expect, it, vi } from 'vitest'

/**
 * x402 v2 wire format, the offer config and the CDP JWT (owner 2026-11-23, paid ads). The JWT is checked against the
 * public key it was signed with, for both key kinds CDP issues (Ed25519 base64 seed||pub, EC P-256 PEM).
 */
vi.mock('server-only', () => ({}))
const { checkPayload, decodeHeader, encodeHeader } = await import('./wire')
const { x402Config, adRequirements, usdcText, adHours, adPriceAtomicFor } = await import('./config')
const { cdpJwt } = await import('./cdp-jwt')

const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'
const NOW_S = Math.floor(Date.now() / 1000)
const ENV = { X402_PAY_TO: PAY_TO, X402_NETWORK: 'eip155:84532', X402_FACILITATOR_URL: 'https://x402.org/facilitator' } as unknown as NodeJS.ProcessEnv

function payloadFor(over: { amount?: string; payTo?: string; value?: string; to?: string; network?: string } = {}) {
  const cfg = x402Config(ENV)!
  const ours = adRequirements(cfg)
  return {
    x402Version: 2,
    resource: { url: 'https://eno.vn/api/v1/ads' },
    accepted: { ...ours, amount: over.amount ?? ours.amount, payTo: over.payTo ?? ours.payTo, network: over.network ?? ours.network },
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: {
        from: '0x857b06519E91e3A54538791bDbb0E22373e36b66',
        to: over.to ?? PAY_TO,
        value: over.value ?? ours.amount,
        validAfter: String(NOW_S - 60),
        validBefore: String(NOW_S + 240),
        nonce: `0x${'f3'.repeat(32)}`,
      },
    },
    extensions: { bazaar: { info: {} } },
  }
}

describe('config', () => {
  it('is off without a valid pay-to wallet, on an unknown network, or on CDP without its key', () => {
    expect(x402Config({} as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(x402Config({ ...ENV, X402_PAY_TO: '0x123' })).toBeNull()
    expect(x402Config({ ...ENV, X402_NETWORK: 'eip155:1' })).toBeNull()
    expect(x402Config({ X402_PAY_TO: PAY_TO } as unknown as NodeJS.ProcessEnv)).toBeNull() // CDP default, no key
    expect(x402Config({ X402_PAY_TO: PAY_TO, CDP_API_KEY_ID: 'k', CDP_API_KEY_SECRET: 's' } as unknown as NodeJS.ProcessEnv)?.cdp).toEqual({ keyId: 'k', secret: 's' })
  })
  it('sells at the owner\'s price: 3.76 USDC by default (99.000 đ), Base Sepolia USDC on the test network', () => {
    const r = adRequirements(x402Config(ENV)!)
    expect(r).toMatchObject({ scheme: 'exact', network: 'eip155:84532', amount: '3760000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: PAY_TO, extra: { name: 'USDC', version: '2' } })
    expect(usdcText('3760000')).toBe('3.76')
    expect(usdcText('3000000')).toBe('3')
    expect(usdcText('3500000')).toBe('3.50')
  })
  it('any whole number of hours, 1 to 90 days, priced pro rata from the weekly price (rounded up; a week is exact)', () => {
    const cfg = x402Config(ENV)!
    expect(adPriceAtomicFor(cfg, 168)).toBe('3760000')
    expect(adPriceAtomicFor(cfg, 1)).toBe('22381')
    expect(adPriceAtomicFor(cfg, 24)).toBe('537143')
    expect(adPriceAtomicFor(cfg, 720)).toBe('16114286')
    expect(adRequirements(cfg, 1).amount).toBe('22381')
    expect(adHours(undefined)).toBe(168)
    expect(adHours(1)).toBe(1)
    expect(adHours('24')).toBe(24)
    for (const bad of [0, -1, 1.5, 2161, 'week', '1e3', NaN, null, '']) expect(adHours(bad), String(bad)).toBeNull()
    expect(adHours(2160)).toBe(2160)
  })
})

describe('wire', () => {
  it('round-trips a header, and refuses what is not base64 JSON', () => {
    const v = { a: 1, b: 'Quảng cáo' }
    expect(decodeHeader(encodeHeader(v))).toEqual(v)
    expect(decodeHeader(Buffer.from(JSON.stringify(v)).toString('base64url'))).toEqual(v)
    expect(decodeHeader('not base64!')).toBeNull()
    expect(decodeHeader('x'.repeat(20_000))).toBeNull()
    expect(decodeHeader(null)).toBeNull()
  })
  it('accepts our own offer and nothing else', () => {
    const ours = adRequirements(x402Config(ENV)!)
    expect(checkPayload(payloadFor(), ours).ok).toBe(true)
    // Case-only differences in addresses are the same address.
    expect(checkPayload(payloadFor({ payTo: PAY_TO.toLowerCase(), to: PAY_TO.toLowerCase() }), ours).ok).toBe(true)
    expect(checkPayload(payloadFor({ amount: '1' }), ours)).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_authorization_value_mismatch' })
    expect(checkPayload(payloadFor({ value: '1' }), ours)).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_authorization_value_mismatch' })
    expect(checkPayload(payloadFor({ payTo: `0x${'9'.repeat(40)}` }), ours).ok).toBe(false)
    expect(checkPayload(payloadFor({ to: `0x${'9'.repeat(40)}` }), ours).ok).toBe(false)
    expect(checkPayload(payloadFor({ network: 'eip155:8453' }), ours)).toEqual({ ok: false, reason: 'invalid_network' })
    expect(checkPayload({ x402Version: 1 }, ours)).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(checkPayload(null, ours)).toEqual({ ok: false, reason: 'invalid_payload' })
  })
  it('⛔ the authorization must be usable now and expire within the offer\'s window', () => {
    const ours = adRequirements(x402Config(ENV)!)
    const at = (after: number, before: number) => {
      const p = payloadFor()
      p.payload.authorization.validAfter = String(after)
      p.payload.authorization.validBefore = String(before)
      return checkPayload(p, ours, NOW_S)
    }
    expect(at(NOW_S - 600, NOW_S + 300).ok).toBe(true)
    expect(at(NOW_S + 60, NOW_S + 300)).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_after' })
    expect(at(NOW_S - 60, NOW_S + 10)).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_before' })
    expect(at(NOW_S - 60, NOW_S + 86_400 * 365)).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_before' })
  })

  it('keeps the buyer\'s extensions (the Bazaar needs them on settle)', () => {
    const r = checkPayload(payloadFor(), adRequirements(x402Config(ENV)!))
    expect(r.ok && r.payload.extensions).toEqual({ bazaar: { info: {} } })
  })
})

describe('CDP JWT', () => {
  const parts = (jwt: string) => jwt.split('.').map((p, i) => (i < 2 ? JSON.parse(Buffer.from(p, 'base64url').toString()) : p))
  const req = { method: 'POST', host: 'api.cdp.coinbase.com', path: '/platform/v2/x402/verify' }

  it('Ed25519 (base64 seed||pub): EdDSA, kid + 32-hex nonce, uris bound to the request, 2 minutes', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string }
    const secret = Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')]).toString('base64')
    const jwt = cdpJwt({ keyId: 'kid-1', secret, ...req }, 1_000)
    const [h, c] = parts(jwt)
    expect(h).toMatchObject({ alg: 'EdDSA', kid: 'kid-1', typ: 'JWT' })
    expect(h.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(c).toEqual({ sub: 'kid-1', iss: 'cdp', uris: ['POST api.cdp.coinbase.com/platform/v2/x402/verify'], iat: 1_000, nbf: 1_000, exp: 1_120 })
    const [a, b, s] = jwt.split('.')
    expect(crypto.verify(null, Buffer.from(`${a}.${b}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })

  it('EC P-256 PEM (also with escaped newlines): ES256 with a 64-byte raw signature', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = (privateKey.export({ format: 'pem', type: 'sec1' }) as string).replace(/\n/g, '\\n')
    const jwt = cdpJwt({ keyId: 'kid-2', secret: pem, ...req }, 1_000)
    expect(parts(jwt)[0].alg).toBe('ES256')
    const [a, b, s] = jwt.split('.')
    const sig = Buffer.from(s, 'base64url')
    expect(sig.length).toBe(64)
    expect(crypto.verify('sha256', Buffer.from(`${a}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true)
  })

  it('refuses a secret of neither kind', () => {
    expect(() => cdpJwt({ keyId: 'k', secret: Buffer.alloc(10).toString('base64'), ...req })).toThrow('cdp_key_format')
  })
})

describe('the offer\'s discovery entry', () => {
  it('its example body asks for the same length the 402 beside it is priced for', async () => {
    vi.doMock('@/lib/db', () => ({ db: {} }))
    vi.doMock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: async () => ({ where: {} }) }))
    const { adPaymentRequired } = await import('@/lib/ads/offer')
    const cfg = x402Config(ENV)!
    for (const hours of [1, 24, 168]) {
      const pr = adPaymentRequired(cfg, 'http', undefined, hours) as unknown as { accepts: { amount: string }[]; extensions: { bazaar: { info: { input: { body: { hours: number } } } } } }
      expect(pr.accepts[0].amount).toBe(adRequirements(cfg, hours).amount)
      expect(pr.extensions.bazaar.info.input.body.hours).toBe(hours)
    }
  })
})
