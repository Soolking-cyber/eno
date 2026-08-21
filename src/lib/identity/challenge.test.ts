import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory kv with real TTL semantics, so expiry is tested rather than assumed.
const store = new Map<string, { v: unknown; expAt: number }>()
let clock = new Date('2026-08-20T10:00:00Z')

vi.mock('@/lib/ratelimit', () => ({
  kv: {
    async get<T>(k: string): Promise<T | null> {
      const e = store.get(k)
      if (!e) return null
      if (e.expAt <= clock.getTime()) { store.delete(k); return null }
      return e.v as T
    },
    async set(k: string, v: unknown, opts?: { ex?: number }) {
      store.set(k, { v, expAt: clock.getTime() + (opts?.ex ?? 60) * 1000 })
      return 'OK' as const
    },
    async del(k: string) { store.delete(k) },
  },
}))

const { issueChallenge, consumeChallenge, CHALLENGE_TTL_SECONDS, ISSUE_COOLDOWN_SECONDS } = await import('./challenge')
const P = 'profile-1'
const at = (s: number) => new Date(clock.getTime() + s * 1000)

beforeEach(() => { store.clear(); clock = new Date('2026-08-20T10:00:00Z') })

describe('identity challenge', () => {
  it('issues a code the seller can actually write down', async () => {
    const r = await issueChallenge(P, clock)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.code).toHaveLength(6)
    // ⚠️ THE AMBIGUOUS CHARACTERS MUST NEVER APPEAR. This is written by hand and read off a photo:
    // a 5 read as an S rejects a real seller. Generate a lot and assert none slip through.
    const many = new Set<string>()
    for (let i = 0; i < 400; i++) {
      store.clear()
      const x = await issueChallenge(P, clock)
      if (x.ok) { many.add(x.code); expect(x.code).not.toMatch(/[01258BGILOQSUVZ]/) }
    }
    expect(many.size).toBeGreaterThan(300) // not a constant masquerading as random
  })

  // ⛔ THE SPENT PLAINTEXT COMES BACK, and that is load-bearing rather than convenience: the caller
  // persists it as evidence so the REVIEWER can compare it against the paper in the selfie. Without
  // it nobody ever checks that the handwriting matches this submission, and a year-old photo passes.
  it('⛔ RETURNS THE NORMALISED CODE SO IT CAN BECOME EVIDENCE', async () => {
    const issued = await issueChallenge('p-evidence', clock)
    if (!issued.ok) throw new Error('expected a code')
    const r = await consumeChallenge('p-evidence', issued.code.toLowerCase(), clock)
    expect(r).toEqual({ ok: true, code: issued.code })
  })

  it('accepts the right code once', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    expect(await consumeChallenge(P, r.code, clock)).toMatchObject({ ok: true })
  })

  it('is case- and whitespace-forgiving — the seller wrote it by hand', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    const messy = ` ${r.code.toLowerCase().split('').join(' ')} `
    expect(await consumeChallenge(P, messy, clock)).toMatchObject({ ok: true })
  })

  it('⛔ BURNS THE CHALLENGE ON A WRONG ANSWER, not just a right one', async () => {
    // Otherwise 20^6 becomes unlimited free guesses against a code that never dies.
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    expect(await consumeChallenge(P, 'AAAAAA', clock)).toEqual({ ok: false, reason: 'mismatch' })
    // the real code no longer works either — the attempt cost the attacker the challenge
    expect(await consumeChallenge(P, r.code, clock)).toEqual({ ok: false, reason: 'no_challenge' })
  })

  it('cannot be replayed after a correct use', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    await consumeChallenge(P, r.code, clock)
    expect(await consumeChallenge(P, r.code, clock)).toEqual({ ok: false, reason: 'no_challenge' })
  })

  it('one second inside the window still works', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    expect(await consumeChallenge(P, r.code, at(CHALLENGE_TTL_SECONDS - 1))).toMatchObject({ ok: true })
  })

  it('past the window, once the TTL has swept the key, it is no_challenge', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    // Move the WORLD forward, not just the argument, so the kv expires the key the way it would in
    // production. (Advancing only `now` exercises the stored-instant check instead — that is the
    // test below, and the two paths return deliberately different reasons.)
    clock = at(CHALLENGE_TTL_SECONDS + 1)
    expect(await consumeChallenge(P, r.code, clock)).toEqual({ ok: false, reason: 'no_challenge' })
  })

  it('⛔ AND THE STORED INSTANT IS CHECKED EVEN WHEN THE KEY OUTLIVES IT', async () => {
    // The reason the code does not simply trust the TTL: kv_store is an UNLOGGED table swept on its
    // own schedule, so "the key is still there" is not "it is still valid". Simulate exactly that —
    // a live key whose recorded expiry has passed — and the answer must be `expired`, not a pass.
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    const k = [...store.keys()].find((x) => x.startsWith('idv:challenge:') && !x.includes(':cool:'))!
    const entry = store.get(k)!
    store.set(k, { v: { ...(entry.v as object), exp: clock.getTime() - 1 }, expAt: clock.getTime() + 3600_000 })
    expect(await consumeChallenge(P, r.code, clock)).toEqual({ ok: false, reason: 'expired' })
  })

  it('⛔ A CODE FOR ONE SELLER IS WORTHLESS FOR ANOTHER', async () => {
    // The hash is salted by profile, so a leaked code cannot be carried to a second account.
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    expect(await consumeChallenge('profile-2', r.code, clock)).toEqual({ ok: false, reason: 'no_challenge' })
  })

  it('⛔ REFUSES TO MINT ON DEMAND — the cooldown stops code-farming', async () => {
    // Without this an attacker requests codes until one matches an image they already hold, and
    // never submits until it does, so a submission-only rate limit never fires.
    const first = await issueChallenge(P, clock)
    expect(first.ok).toBe(true)
    const second = await issueChallenge(P, clock)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('cooldown')
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(ISSUE_COOLDOWN_SECONDS)
  })

  it('re-issuing REPLACES the outstanding code rather than adding a second live one', async () => {
    const first = await issueChallenge(P, clock)
    if (!first.ok) throw new Error('issue failed')
    clock = at(ISSUE_COOLDOWN_SECONDS + 1)
    const second = await issueChallenge(P, clock)
    if (!second.ok) throw new Error('re-issue failed')
    // Two live codes would mean an image matching EITHER is accepted.
    expect(await consumeChallenge(P, first.code, clock)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('a submission with no outstanding challenge is refused', async () => {
    expect(await consumeChallenge(P, 'ABC123', clock)).toEqual({ ok: false, reason: 'no_challenge' })
  })

  it('the stored record never contains the plaintext code', async () => {
    const r = await issueChallenge(P, clock)
    if (!r.ok) throw new Error('issue failed')
    const dump = JSON.stringify([...store.entries()])
    expect(dump).not.toContain(r.code)
  })
})
