import { describe, expect, it, vi } from 'vitest'

// GET /api/auth/providers — the server's answer for a sign-in form on a page it did not seed (src/lib/facebook-flag.ts):
// public, never on the CDN, a probe that throws reads as off.
const h = vi.hoisted(() => ({ on: true as boolean | Error }))
vi.mock('@/lib/auth/facebook', () => ({ facebookSignInEnabled: async () => { if (h.on instanceof Error) throw h.on; return h.on } }))

const { GET } = await import('./route')
const call = () => GET(new Request('https://eno.vn/api/auth/providers') as never, {} as never)

describe('GET /api/auth/providers', () => {
  it('{ facebook } from GoTrue, private for a minute', async () => {
    h.on = true
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ facebook: true })
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
  })
  it('off, and a failing probe reads as off', async () => {
    h.on = false
    expect(await (await call()).json()).toEqual({ facebook: false })
    h.on = new Error('boom')
    expect(await (await call()).json()).toEqual({ facebook: false })
  })
})
