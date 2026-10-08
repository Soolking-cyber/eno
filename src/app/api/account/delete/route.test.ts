import { beforeEach, describe, expect, it, vi } from 'vitest'

// Self-service deletion answers the Apple status (Sign in with Apple, D9): the dialog's last notice — "remove eno
// in your Apple Account" — shows for queued and manual. Everything else about the route is unchanged, except two
// commit-gate round-2 additions: the session's own Apple signal is handed to the erasure (C1 — it can only add the
// notice), and a REPEATED request after a deletion that succeeded answers ok on proof (O3).
const h = vi.hoisted(() => ({
  result: { ok: true, purge: { deleted: 0, kept: 0, foreign: 0, failed: 0 }, apple: 'queued' } as Record<string, unknown>,
  profile: { id: 'p1' } as { id: string } | null,
  claims: { id: 'p1', appleLinked: false, email: 'a@b.c' } as { id: string; appleLinked: boolean; email: string | null } | null,
  /** public."Profile" as the repeat path reads it; 'throw' = the read failed. */
  stored: null as { id: string } | null | 'throw',
  limited: false,
  /** appleStatusAfterErasure's answer: null unless GoTrue says the auth user is gone. */
  after: 'manual' as string | null,
  calls: [] as string[],
  eraseArgs: [] as unknown[][],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: { profile: { findUnique: async () => { h.calls.push('profile'); if (h.stored === 'throw') throw new Error('db down'); return h.stored } } },
}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  currentAppleClaims: async () => { h.calls.push('claims'); return h.claims },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async (_k: string, id: string) => { h.calls.push(`limit:${id}`); return { success: !h.limited } } }))
vi.mock('@/lib/core/account-erasure', () => ({
  eraseAccount: async (...args: unknown[]) => { h.calls.push('erase'); h.eraseArgs.push(args); return h.result },
  appleStatusAfterErasure: async (id: string) => { h.calls.push(`after:${id}`); return h.after },
}))

const { POST } = await import('./route')
const del = (body: unknown = { confirm: 'DELETE' }) => POST(new Request('https://eno.vn/api/account/delete', {
  method: 'POST', headers: { origin: 'https://eno.vn', host: 'eno.vn' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  h.result = { ok: true, purge: { deleted: 0, kept: 0, foreign: 0, failed: 0 }, apple: 'queued' }
  h.profile = { id: 'p1' }
  h.claims = { id: 'p1', appleLinked: false, email: 'a@b.c' }
  h.stored = null
  h.limited = false
  h.after = 'manual'
  h.calls = []
  h.eraseArgs = []
})

describe('POST /api/account/delete', () => {
  it('answers { ok, apple }', async () => {
    for (const apple of ['none', 'revoked', 'queued', 'manual']) {
      h.result = { ...h.result, apple }
      const res = await del()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, apple })
    }
  })
  it('the investigation hold is unchanged', async () => {
    h.result = { ok: false, code: 'under_review' }
    const res = await del()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'under_review' })
  })
  it('⛔ C1: the verified session\'s Apple signal rides into the erasure — it can only add the notice', async () => {
    h.claims = { id: 'p1', appleLinked: true, email: 'a@b.c' }
    await del()
    expect(h.eraseArgs.at(-1)).toEqual(['p1', { kind: 'self' }, { appleLinked: true }])
    h.claims = null // no verified claims: no signal, GoTrue's own answer decides
    await del()
    expect(h.eraseArgs.at(-1)).toEqual(['p1', { kind: 'self' }, { appleLinked: false }])
  })
})

/**
 * ⛔ O3 (opus, commit gate round 2): a slow deletion can outlast a proxy; the person presses Delete again — and, the
 * account being gone, used to get 401 "your session has expired — sign in again", for a deletion that had worked.
 */
describe('⛔ a repeated request after the deletion succeeded', () => {
  beforeEach(() => { h.profile = null })

  it('the account provably erased (no profile; GoTrue: auth user gone) → 200 { ok, apple }, nothing erased again', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, apple: 'manual' })
    expect(h.calls).toEqual(['claims', 'profile', 'limit:p1', 'after:p1'])
    h.calls = []
    h.after = 'none'
    expect(await (await del()).json()).toEqual({ ok: true, apple: 'none' })
    expect(h.calls).not.toContain('erase')
  })

  it('anything short of the proof is the old 401 — byte for byte', async () => {
    const unauthorized = async () => {
      const res = await del()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
    h.claims = null // no verified token at all (a guest)
    await unauthorized()
    h.claims = { id: 'p1', appleLinked: false, email: null }
    h.stored = { id: 'p1' } // a LIVE account whose session merely failed to resolve
    await unauthorized()
    h.stored = 'throw' // cannot tell whether the profile is gone
    await unauthorized()
    h.stored = null
    h.after = null // GoTrue does not say the auth user is gone
    await unauthorized()
    expect(h.calls).not.toContain('erase')
  })

  it('the typed confirmation first: without it, nothing is asked at all', async () => {
    const res = await del({})
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(h.calls).toEqual([])
  })

  it('a live profile never spends the strict limiter; an erased one does, and over it answers 429', async () => {
    h.stored = { id: 'p1' }
    await del()
    expect(h.calls.some((c) => c.startsWith('limit:'))).toBe(false)
    h.stored = null
    h.limited = true
    h.calls = []
    const res = await del()
    expect(res.status).toBe(429)
    expect(h.calls).toEqual(['claims', 'profile', 'limit:p1'])
  })
})
