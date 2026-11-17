import { createHash, createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DIRECTORY_CONTENT_TYPE, DIRECTORY_SIGNATURE, DIRECTORY_SIGNATURE_INPUT, WEB_BOT_AUTH_AUTHORITY, WEB_BOT_AUTH_KEY, directoryHeaders, keyDirectory } from './web-bot-auth'

describe('Web Bot Auth key directory', () => {
  it('the kid is the key\'s RFC 7638 thumbprint, and the signature names it', () => {
    const tp = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${WEB_BOT_AUTH_KEY.x}"}`).digest('base64url')
    expect(WEB_BOT_AUTH_KEY.kid).toBe(tp)
    expect(DIRECTORY_SIGNATURE_INPUT).toContain(`keyid="${tp}"`)
    expect(DIRECTORY_SIGNATURE_INPUT).toContain('tag="http-message-signatures-directory"')
  })

  it('⛔ the fixed signature verifies against the published key, over "@authority";req = eno.vn (RFC 9421 base)', () => {
    const params = DIRECTORY_SIGNATURE_INPUT.replace(/^sig1=/, '')
    const base = `"@authority";req: ${WEB_BOT_AUTH_AUTHORITY}\n"@signature-params": ${params}`
    const sig = Buffer.from(DIRECTORY_SIGNATURE.replace(/^sig1=:/, '').replace(/:$/, ''), 'base64')
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: WEB_BOT_AUTH_KEY.x }, format: 'jwk' })
    expect(verify(null, Buffer.from(base), key, sig)).toBe(true)
  })

  it('the key\'s lifetime (nbf/exp) is the directory signature\'s own created/expires', () => {
    expect(WEB_BOT_AUTH_KEY.nbf).toBe(Number(/;created=(\d+)/.exec(DIRECTORY_SIGNATURE_INPUT)?.[1]))
    expect(WEB_BOT_AUTH_KEY.exp).toBe(Number(/;expires=(\d+)/.exec(DIRECTORY_SIGNATURE_INPUT)?.[1]))
  })

  it('still valid for at least 30 more days — re-sign from the vault before it lapses', () => {
    const expires = Number(/;expires=(\d+)/.exec(DIRECTORY_SIGNATURE_INPUT)?.[1])
    expect(expires * 1000 - Date.now()).toBeGreaterThan(30 * 86_400_000)
  })

  it('a JWKS of the one public key — never a private part', () => {
    const d = keyDirectory()
    expect(d.keys).toHaveLength(1)
    expect(d.keys[0]).not.toHaveProperty('d')
    expect(d.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519' })
  })

  it('signed only on eno.vn itself; other hosts get the key set alone', () => {
    expect(directoryHeaders('eno.vn')).toMatchObject({ 'Content-Type': DIRECTORY_CONTENT_TYPE, Signature: DIRECTORY_SIGNATURE, 'Signature-Input': DIRECTORY_SIGNATURE_INPUT })
    expect(directoryHeaders('ENO.VN:443').Signature).toBe(DIRECTORY_SIGNATURE)
    expect(directoryHeaders('apple.eno.vn').Signature).toBeUndefined()
    expect(directoryHeaders(null)['Content-Type']).toBe(DIRECTORY_CONTENT_TYPE)
  })
})
