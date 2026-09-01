import { describe, expect, it, vi, afterEach } from 'vitest'
import { isLoopbackSelfOrigin } from './proxy'

/**
 * ⛔ THE WRITE-ORIGIN GUARD MADE THE LOCAL PREVIEW UNTESTABLE. `NEXT_PUBLIC_APP_URL` is a real host
 * even in a preview, so a browser on `http://localhost:3101` sent an Origin that was never in the
 * allow-list and EVERY mutating request 403'd — discovered when a payout save failed for a reason
 * that had nothing to do with the form.
 *
 * ⚠️ THE CARVE-OUT IS A SECURITY BOUNDARY, so these tests are mostly about what it REFUSES.
 */

const req = (host: string) =>
  ({ headers: new Headers({ host }), url: `http://${host}/api/x` })

afterEach(() => vi.unstubAllEnvs())

describe('isLoopbackSelfOrigin', () => {
  it('allows a local preview to write to itself', () => {
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://localhost:3101')).toBe(true)
    expect(isLoopbackSelfOrigin(req('127.0.0.1:3000'), 'http://127.0.0.1:3000')).toBe(true)
  })

  it('⛔ an Origin claiming localhost cannot authorise a write to a REAL host', () => {
    // The half that matters. Without comparing against the request's own Host, anyone could send
    // `Origin: http://localhost` to production and bypass the guard entirely.
    expect(isLoopbackSelfOrigin(req('eno.forum'), 'http://localhost:3101')).toBe(false)
    expect(isLoopbackSelfOrigin(req('www.eno.vn'), 'http://localhost')).toBe(false)
    expect(isLoopbackSelfOrigin(req('apple.eno.vn'), 'http://localhost:3101')).toBe(false)
  })

  it('⛔ a REAL host writing to itself is still refused — this is not a same-origin rule', () => {
    /**
     * ⛔ THE HOLE THE GUARD EXISTS FOR. A general same-origin exemption would let a storefront host
     * write as its own visitor, which is exactly the attack the write-origin pin was added to stop.
     * Loopback only.
     */
    expect(isLoopbackSelfOrigin(req('apple.eno.vn'), 'https://apple.eno.vn')).toBe(false)
    expect(isLoopbackSelfOrigin(req('eno.forum'), 'https://eno.forum')).toBe(false)
  })

  it('⛔ a hostname that merely CONTAINS localhost is not loopback', () => {
    for (const o of ['https://localhost.evil.com', 'https://notlocalhost', 'https://localhost.co']) {
      expect(isLoopbackSelfOrigin(req('localhost.evil.com'), o), o).toBe(false)
    }
  })

  it('⛔ a malformed Origin or Host is refused, not thrown on', () => {
    for (const o of ['', 'not a url', 'javascript:alert(1)']) {
      expect(() => isLoopbackSelfOrigin(req('localhost:3101'), o), o).not.toThrow()
      expect(isLoopbackSelfOrigin(req('localhost:3101'), o), o).toBe(false)
    }
    expect(isLoopbackSelfOrigin({ headers: new Headers(), url: 'http://x/' }, 'http://localhost')).toBe(false)
  })

  it('⚠️ neither the port NOR the loopback spelling need match', () => {
    /**
     * ⚠️ AN EARLIER VERSION ALSO REQUIRED THE TWO HOSTNAMES TO BE IDENTICAL, and mutation-testing
     * showed that line was dead weight — the "both must be loopback" rule already refuses a real
     * host. All the equality added was rejecting a browser on `127.0.0.1` talking to a server that
     * calls itself `localhost`: the same machine, refused for no reason. These cases pin that.
     */
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://localhost:3000')).toBe(true)
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://127.0.0.1:3101')).toBe(true)
    expect(isLoopbackSelfOrigin(req('127.0.0.1:3101'), 'http://localhost:3101')).toBe(true)
  })
})
