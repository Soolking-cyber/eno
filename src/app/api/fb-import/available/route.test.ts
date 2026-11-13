import { describe, expect, it, vi } from 'vitest'

/** GET /api/fb-import/available (route.ts): for a visitor who is not signed in — `{ on }` only, never cached. */
const on = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/fb-import/available', () => ({ fbImportOn: vi.fn(async () => on.value) }))
const { GET } = await import('./route')

describe('GET /api/fb-import/available', () => {
  it('answers anyone with { on } and nothing else, never cached', async () => {
    for (const v of [true, false]) {
      on.value = v
      const r = await GET(new Request('https://eno.vn/api/fb-import/available'))
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(await r.json()).toEqual({ on: v })
    }
  })
})
