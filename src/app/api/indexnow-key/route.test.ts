import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ marketplace: true }))
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))

import { GET } from './route'

const KEY = '0123456789abcdef0123456789abcdef'
const req = (k?: string) => new Request(`https://eno.vn/api/indexnow-key${k === undefined ? '' : `?k=${encodeURIComponent(k)}`}`)

beforeEach(() => { h.marketplace = true })
afterEach(() => { vi.unstubAllEnvs() })

describe('the IndexNow key file', () => {
  it('404s, no-store, when no key is set — the dormant state', async () => {
    vi.stubEnv('INDEXNOW_KEY', '')
    const res = GET(req(KEY))
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('404s for a missing, wrong or case-changed k', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    for (const k of [undefined, '', 'ffffffffffffffffffffffffffffffff', KEY.toUpperCase(), `${KEY}x`]) {
      const res = GET(req(k))
      expect(res.status, String(k)).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.text()).not.toContain(KEY)
    }
  })

  it('404s when the configured key is malformed, even for that exact k', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'bad_key_1')
    expect(GET(req('bad_key_1')).status).toBe(404)
  })

  it('404s on eno.forum', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    h.marketplace = false
    expect(GET(req(KEY)).status).toBe(404)
  })

  it('behind the rewrite, reads the key from the /<key>.txt path, never from a visitor-supplied ?k=', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    // What the handler really receives behind the afterFiles rewrite: the ORIGINAL url.
    const ok = GET(new Request(`https://eno.vn/${KEY}.txt`))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe(KEY)
    expect(GET(new Request(`https://eno.vn/ffffffffffffffffffffffffffffffff.txt?k=${KEY}`)).status).toBe(404)
    expect(GET(new Request(`https://eno.vn/robots.txt?k=${KEY}`)).status).toBe(404)
    expect(GET(new Request(`https://eno.vn/x/${KEY}.txt`)).status).toBe(404)
  })

  it('answers 200 text/plain with exactly the key for the exact key', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    const res = GET(req(KEY))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe(KEY)
  })
})
