import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE FIXED-PRICE OFFER PENALTY — a function that docks a buyer's trust score, untested until
 * 2026-08-05.
 *
 * ⚠️ WHY THIS ONE MATTERS MORE THAN ITS SIZE SUGGESTS. `recordFixedPriceOfferAttempt` is one of the
 * few paths in this codebase that takes something away from a user: it subtracts trust points, and
 * trust drives ranking, badges and the enforcement ladder. Its own header comment makes four
 * promises — grace before any penalty, at most one penalty per hour, FAIL OPEN on a backend error,
 * and never throw — and each of those is a decision someone could reasonably "simplify" later
 * without realising they are now punishing honest buyers for a Postgres blip. The comment was the
 * only thing holding them. Now these are.
 *
 * The fail-open case is the one worth reading twice: `kv` is the Postgres-backed limiter, so "kv
 * threw" and "the site is having a bad minute" are the same event. Penalising buyers during an
 * incident is exactly backwards.
 */

const h = vi.hoisted(() => ({
  /** Value returned by kv.incrby — i.e. how many attempts this buyer has made in the window. */
  count: 1,
  /** Whether the once-per-hour penalty claim succeeds (kv.set NX). */
  claimOk: true,
  incrbyThrows: false,
  setThrows: false,
  trustThrows: false,
  trustCalls: [] as { id: string; kind: string; delta: number; meta: unknown }[],
  kvSetCalls: [] as { key: string; opts: unknown }[],
}))

vi.mock('@/lib/ratelimit', () => ({
  kv: {
    incrby: async () => {
      if (h.incrbyThrows) throw new Error('kv down')
      return h.count
    },
    set: async (key: string, _v: string, opts: unknown) => {
      if (h.setThrows) throw new Error('kv down')
      h.kvSetCalls.push({ key, opts })
      return h.claimOk
    },
  },
}))

vi.mock('@/lib/trust', () => ({
  applyTrustEvent: async (id: string, kind: string, delta: number, meta: unknown) => {
    if (h.trustThrows) throw new Error('trust write failed')
    h.trustCalls.push({ id, kind, delta, meta })
  },
}))

const { recordFixedPriceOfferAttempt } = await import('@/lib/offer-guard')

const BUYER = 'buyer-1'

beforeEach(() => {
  h.count = 1
  h.claimOk = true
  h.incrbyThrows = false
  h.setThrows = false
  h.trustThrows = false
  h.trustCalls = []
  h.kvSetCalls = []
})

describe('grace before any penalty', () => {
  it.each([1, 2])('attempt %i is free — GRACE is 2', async (n) => {
    h.count = n
    await recordFixedPriceOfferAttempt(BUYER)
    expect(h.trustCalls).toEqual([])
    // It must not even CLAIM the penalty key, or the hourly cooldown would be burned by a
    // stray attempt and the buyer's next real abuse would go unpenalised.
    expect(h.kvSetCalls).toEqual([])
  })

  it('the third attempt in the window is the first penalised one', async () => {
    h.count = 3
    await recordFixedPriceOfferAttempt(BUYER)
    expect(h.trustCalls).toHaveLength(1)
    expect(h.trustCalls[0]).toMatchObject({
      id: BUYER,
      kind: 'manual_adjust',
      delta: -3, // PENALTY
      meta: { reason: 'nonneg_offer_spam' },
    })
  })

  it('the penalty is a DEDUCTION — the sign is the point', async () => {
    // A dropped minus sign would silently REWARD offer spam, and every other assertion in this
    // file would still pass. Pinned explicitly.
    h.count = 99
    await recordFixedPriceOfferAttempt(BUYER)
    expect(h.trustCalls[0].delta).toBeLessThan(0)
  })
})

describe('at most one penalty per hour', () => {
  it('a burst past grace penalises once, not once per attempt', async () => {
    h.count = 10
    h.claimOk = true
    await recordFixedPriceOfferAttempt(BUYER) // wins the claim
    h.claimOk = false // the cooldown key now exists
    await recordFixedPriceOfferAttempt(BUYER)
    await recordFixedPriceOfferAttempt(BUYER)
    expect(h.trustCalls).toHaveLength(1)
  })

  it('the cooldown is claimed with NX and an expiry, which is what makes it one-winner', async () => {
    // Without `nx` two concurrent requests both "claim" and both penalise; without `ex` the buyer
    // is immune for ever after one penalty. Both halves are load-bearing.
    h.count = 3
    await recordFixedPriceOfferAttempt(BUYER)
    expect(h.kvSetCalls).toHaveLength(1)
    expect(h.kvSetCalls[0].key).toContain(BUYER)
    expect(h.kvSetCalls[0].opts).toMatchObject({ nx: true, ex: 3600 })
  })
})

describe('it fails OPEN, because kv failing means the site is unwell', () => {
  it('a counter failure penalises nobody', async () => {
    h.incrbyThrows = true
    await expect(recordFixedPriceOfferAttempt(BUYER)).resolves.toBeUndefined()
    expect(h.trustCalls).toEqual([])
  })

  it('a cooldown-claim failure penalises nobody', async () => {
    h.count = 99
    h.setThrows = true
    await expect(recordFixedPriceOfferAttempt(BUYER)).resolves.toBeUndefined()
    expect(h.trustCalls).toEqual([])
  })

  it('a TRUST-WRITE failure is swallowed too — the last unguarded step', async () => {
    // ⚠️ ADDED AFTER REVIEW. codex pointed out the fail-open cases only covered the two kv calls,
    // leaving `applyTrustEvent` — the one that touches the database — untested, even though it sits
    // inside the same try. Verified against the source (offer-guard.ts:47 is inside the try block).
    // The behaviour it pins is deliberately asymmetric and worth stating: the hourly cooldown key
    // has ALREADY been claimed by the time this throws, so the buyer escapes this hour's penalty.
    // That is the right direction — a trust-write outage should not cost a buyer points — but it is
    // a real behaviour, not an accident, so it gets an assertion.
    h.count = 99
    h.trustThrows = true
    await expect(recordFixedPriceOfferAttempt(BUYER)).resolves.toBeUndefined()
    expect(h.kvSetCalls).toHaveLength(1) // the cooldown WAS claimed
    expect(h.trustCalls).toEqual([]) // ...and no penalty was recorded
  })

  it('never throws — the caller is a response path that must not 500 over spam accounting', async () => {
    // ⚠️ `.resolves.not.toThrow()` WAS CHALLENGED AS VACUOUS BY TWO REVIEWERS AND IS NOT.
    // Their reading was that `toThrow` needs a function while `resolves` unwraps to `undefined`.
    // Measured instead of argued: a probe asserting `.resolves.not.toThrow()` on a function that
    // DOES throw fails with "promise rejected ... instead of resolving". The `resolves` half is
    // what carries the assertion, so a regression to throwing is caught. Kept, with the evidence
    // recorded, because two families agreeing on a plausible-but-wrong reading is exactly the
    // situation this note exists for.
    h.incrbyThrows = true
    await expect(recordFixedPriceOfferAttempt(BUYER)).resolves.not.toThrow()
  })
})
