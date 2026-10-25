import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/auth/carry (put) and /api/auth/carry/take: the teacher join form's step-1 answers, left by "Continue with
// Google" inside an app's built-in browser and taken back once by the phone's own browser (src/lib/auth/carry.ts).
const h = vi.hoisted(() => ({ puts: [] as Array<[string, string]>, takes: [] as string[], drops: [] as string[], putWins: true, taken: null as string | null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/auth/carry', () => ({
  CARRY_TOKEN_RE: /^[A-Za-z0-9_-]{40,90}$/,
  CARRY_VALUE_RE: /^[A-Za-z0-9_-]{1,4096}$/,
  canonicalCarry: (v: string) => (v === 'notahandoff' ? null : `canon-${v}`),
  putCarry: async (t: string, v: string) => { h.puts.push([t, v]); return h.putWins },
  readCarry: async (t: string) => { h.takes.push(t); return h.taken },
  dropCarry: async (t: string) => { h.drops.push(t) },
}))

const { POST: put } = await import('./route')
const { POST: take } = await import('./take/route')

const TOKEN = 'T'.repeat(43)
const req = (body: unknown) => new Request('https://eno.vn/api/auth/carry', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://eno.vn' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
beforeEach(() => { h.puts = []; h.takes = []; h.drops = []; h.putWins = true; h.taken = null })

describe('POST /api/auth/carry', () => {
  it('stores the value under the token: { ok: true }', async () => {
    const res = await put(req({ t: TOKEN, carry: 'eyJ2IjoyfQ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // Stored as the server re-encodes it (step 1 alone — carry.ts canonicalCarry), never as sent.
    expect(h.puts).toEqual([[TOKEN, 'canon-eyJ2IjoyfQ']])
  })
  it('a value that does not decode as a hand-off: 400, nothing stored', async () => {
    expect((await put(req({ t: TOKEN, carry: 'notahandoff' }))).status).toBe(400)
    expect(h.puts).toEqual([])
  })
  it('a token used before is not overwritten: { ok: false }', async () => {
    h.putWins = false
    expect(await (await put(req({ t: TOKEN, carry: 'x' }))).json()).toEqual({ ok: false })
  })
  it('refuses anything that is not a token and a bounded base64url value — nothing stored', async () => {
    for (const body of [{ t: 'short', carry: 'x' }, { t: TOKEN }, { t: TOKEN, carry: '' }, { t: TOKEN, carry: 'a b' }, { t: TOKEN, carry: 'x'.repeat(4097) }, { t: TOKEN, carry: 42 }, 'not json']) {
      const res = await put(req(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(h.puts).toEqual([])
  })
})

describe('POST /api/auth/carry/take', () => {
  it('returns the carry once it is there — { carry }, as often as asked (a lost response asks again)', async () => {
    h.taken = 'eyJ2IjoyfQ'
    const res = await take(req({ t: TOKEN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ carry: 'eyJ2IjoyfQ' })
    expect(h.takes).toEqual([TOKEN])
  })
  it('nothing (yet, or any more): { carry: null }', async () => {
    expect(await (await take(req({ t: TOKEN }))).json()).toEqual({ carry: null })
  })
  it('`done`: dropped — { carry: null }, nothing read', async () => {
    h.taken = 'eyJ2IjoyfQ'
    expect(await (await take(req({ t: TOKEN, done: true }))).json()).toEqual({ carry: null })
    expect(h.drops).toEqual([TOKEN])
    expect(h.takes).toEqual([])
  })
  it('not a token (or a `done` that is not true): 400, nothing asked or dropped', async () => {
    for (const body of [{ t: 'short' }, {}, { t: 42 }, { t: TOKEN, done: 'yes' }, { t: TOKEN, done: false }]) expect((await take(req(body))).status, JSON.stringify(body)).toBe(400)
    expect(h.takes).toEqual([])
    expect(h.drops).toEqual([])
  })
})
