import { beforeEach, describe, expect, it, vi } from 'vitest'

// The generate route is the COST boundary of the app's most expensive path (grounded Gemini
// search). Its contract is about ORDER as much as outcome: identify → validate → claim a
// single-flight slot → only then spend quota. Every test below pins one link in that chain.
//
// ⚠️ Why a route test and not just a schema test: an external reviewer refuted the claim that
// "both views derive from one object" is sufficient. Structural tests would still pass if the
// route stopped calling the shared schema, or if `.superRefine` were dropped from it. So the
// checks here are behavioural — a past start date is rejected by NOTHING except the shared
// schema's refinement, which makes case (b) proof that the route really validates with it.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** Saved itineraries the account already holds — drives the pre-generation cap. */
  savedItineraries: 0,
  state: {
    profileId: 'p-1' as string | null,
    kv: new Map<string, unknown>(),
    kvThrows: false,
    aiGuardCalls: 0,
    globalLimitCalls: 0,
    // Runs when the route reaches getGemini() — i.e. INSIDE the critical section, after the slot
    // is claimed and the quota is spent.
    onGenerate: null as null | (() => void),
    // Awaited by the global limiter, which is the first await AFTER the slot is claimed.
    onGlobalLimit: null as null | (() => Promise<void>),
  },
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.state.profileId }))

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => {
    h.state.globalLimitCalls++
    // An awaited hook, so a test can hold a request INSIDE the critical section — slot claimed,
    // quota spent — and fire a second one against it. Timing-free: the overlap is constructed,
    // not hoped for.
    if (h.state.onGlobalLimit) await h.state.onGlobalLimit()
    return { success: true }
  },
  kv: {
    // Models kv_set's NX semantics: create-if-absent, and report whether we won.
    set: async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (h.state.kvThrows) throw new Error('kv unreachable')
      if (opts?.nx && h.state.kv.has(key)) return null
      h.state.kv.set(key, value)
      return 'OK'
    },
    get: async (key: string) => {
      if (h.state.kvThrows) throw new Error('kv unreachable')
      return h.state.kv.get(key) ?? null
    },
    del: async (key: string) => { h.state.kv.delete(key) },
  },
}))

vi.mock('@/lib/ai-guard', () => ({
  aiGuard: async () => { h.state.aiGuardCalls++; return { ok: true, profileId: h.state.profileId } },
}))

// Stopping at "no AI configured" lets every guard ahead of it run for real while the 30-90s
// Gemini call never happens. 503 is therefore the SUCCESS signal in these tests: it means the
// request got all the way through the cost boundary.
vi.mock('@/lib/gemini', () => ({
  GEMINI_MODEL: 'test-model',
  GEMINI_MODEL_FALLBACK: 'test-model-fallback',
  getGemini: () => { void h.state.onGenerate?.(); return null },
}))

// `itinerary.count` is here because the route now checks the saved-trip cap BEFORE generating —
// see the comment at that call site. Zero saved means every test below has room, so the cap is
// transparent to them and they keep testing what they were written to test.
vi.mock('@/lib/db', () => ({ db: { itinerary: { count: async () => h.savedItineraries } } }))

import { POST } from './route.forum.svc'

const SLOT = 'itinerary-inflight:p-1'

/** A body that satisfies every bound, with a start date that is always in range. */
function validBody(overrides: Row = {}): Row {
  const soon = new Date()
  soon.setUTCDate(soon.getUTCDate() + 30)
  return {
    locale: 'en',
    startDate: soon.toISOString().slice(0, 10),
    days: 5,
    travelers: 2,
    cityIds: ['hanoi', 'hoian'],
    cityDays: [{ cityId: 'hanoi', days: 2 }],
    budgetId: 'comfort',
    pace: 'balanced',
    interests: ['food'],
    accommodation: 'hotel',
    flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
    origin: '',
    notes: '',
    ...overrides,
  }
}

async function post(body: unknown): Promise<{ status: number; json: Row }> {
  const res = await POST(new Request('http://test/api/itineraries/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

beforeEach(() => {
  h.state.profileId = 'p-1'
  h.state.kv = new Map()
  h.state.kvThrows = false
  h.state.aiGuardCalls = 0
  h.state.globalLimitCalls = 0
  h.state.onGenerate = null
  h.state.onGlobalLimit = null
})

describe('nothing is spent before the request is known to be worth running', () => {
  it('refuses an unauthenticated caller without touching quota or a slot', async () => {
    h.state.profileId = null
    const { status, json } = await post(validBody())
    expect({ status, error: json.error, aiGuard: h.state.aiGuardCalls, slots: h.state.kv.size })
      .toEqual({ status: 401, error: 'auth_required', aiGuard: 0, slots: 0 })
  })

  it('⚠️ REJECTS A PAST START DATE FOR FREE — the defect this ordering fixes', async () => {
    // Before, aiGuard + the global limiter ran FIRST, so a body the server was always going to
    // refuse burned two rate-limit tokens on the most expensive path in the app.
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const { status, json } = await post(validBody({ startDate: yesterday.toISOString().slice(0, 10) }))
    expect({ status, error: json.error, aiGuard: h.state.aiGuardCalls, global: h.state.globalLimitCalls })
      .toEqual({ status: 400, error: 'invalid_trip', aiGuard: 0, global: 0 })
  })

  it('a past start date is caught by the SHARED schema, not by anything local', async () => {
    // This is the load-bearing half of the de-duplication: no bound in this file rejects it, so a
    // 400 here can only come from itineraryRequestSchema's refinement being attached and used.
    const { json } = await post(validBody({ startDate: '2020-01-01' }))
    expect(json.issues?.some((i: Row) => i.path?.[0] === 'startDate')).toBe(true)
  })

  it('rejects a malformed body without claiming a slot, so it cannot lock out a valid one', async () => {
    const { status, slots } = { ...(await post({ nonsense: true })), slots: h.state.kv.size }
    expect({ status, slots, aiGuard: h.state.aiGuardCalls }).toEqual({ status: 400, slots: 0, aiGuard: 0 })
  })

  it('⚠️ REFUSES AN OVERSIZED BODY BEFORE PARSING IT', async () => {
    // Moving validation ahead of the meter is what makes a doomed request free — and it would
    // otherwise give an authenticated caller an unmetered way to spend CPU on JSON.parse plus a
    // deep Zod traversal, because App-Router handlers have no default body limit. Raised by codex
    // against the first cut of this reordering.
    const huge = { ...validBody(), notes: 'x'.repeat(200_000) }
    const { status, json } = await post(huge)
    expect({ status, error: json.error, aiGuard: h.state.aiGuardCalls, slots: h.state.kv.size })
      .toEqual({ status: 413, error: 'body_too_large', aiGuard: 0, slots: 0 })
  })

  it('refuses an oversized body that does not declare its length', async () => {
    // content-length is a hint, not a guarantee — a chunked request need not send one.
    const res = await POST(new Request('http://test/api/itineraries/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ notes: 'x'.repeat(200_000) })))
          controller.close()
        },
      }),
      // @ts-expect-error — duplex is required for a streamed request body and is not in the DOM lib
      duplex: 'half',
    }))
    expect({ status: res.status, declared: null, aiGuard: h.state.aiGuardCalls }).toEqual({ status: 413, declared: null, aiGuard: 0 })
  })

  it('a body just under the ceiling is still processed normally', async () => {
    const { status } = await post(validBody({ notes: 'x'.repeat(600) }))
    expect({ status, aiGuard: h.state.aiGuardCalls }).toEqual({ status: 503, aiGuard: 1 })
  })

  it('enforces every shared bound — a 16th city, 31 days, 101 travellers, no interests', async () => {
    for (const bad of [
      { cityIds: Array.from({ length: 16 }, () => 'hanoi') },
      { days: 31 },
      { travelers: 101 },
      { interests: [] },
      { notes: 'x'.repeat(601) },
      { origin: 'x'.repeat(121) },
      { locale: 'klingon' },
      { flight: { include: true, cabin: 'economy', maxStops: 'any', checkedBags: false }, origin: 'a' },
    ]) {
      const { status } = await post(validBody(bad))
      expect({ bad: Object.keys(bad).join('+'), status }).toEqual({ bad: Object.keys(bad).join('+'), status: 400 })
    }
    expect(h.state.aiGuardCalls).toBe(0)
  })
})

describe('the saved-trip cap is enforced BEFORE anything is spent', () => {
  it('refuses with 409 when the account is full, and never claims a slot or a token', async () => {
    // ⚠️ THE SECOND CREATE PATH. POST /api/itineraries enforces the same ceiling; this test exists
    // because a cap on one of two create paths is not a cap — this route would otherwise write the
    // fourth itinerary happily.
    h.savedItineraries = 3
    const res = await post(validBody())
    expect(res.status).toBe(409)
    expect(res.json).toMatchObject({ error: 'itinerary_limit_reached', limit: 3, used: 3 })
  })

  it('lets a traveller with room through to the normal path', async () => {
    h.savedItineraries = 2
    const res = await post(validBody())
    // Not asserting success — the generation itself is mocked elsewhere in this file. The point is
    // only that the cap did not intercept it with itinerary_limit_reached.
    expect(res.json?.error).not.toBe('itinerary_limit_reached')
  })
})

// ⚠️ THE SAVE-TIME CAP RE-CHECK IS DELIBERATELY NOT TESTED HERE, and that is a statement about
// this file rather than about the guard. Every mock above stops the request at the cost boundary —
// `getGemini` returns null on purpose, and the header says 503 is the SUCCESS signal — so the save
// block is unreachable from any test in this file. I wrote a TOCTOU test anyway, it passed, and it
// passed with the guard REMOVED: the route was 503-ing long before the save, so the assertion on
// savedItineraryId was reading `undefined` and calling it null. Deleted rather than kept green.
// The re-check itself is exercised by src/lib/itinerary-drafts.test.ts at the arithmetic level and
// reasoned at the call site; covering it end-to-end needs a test that actually drives a generation.

describe('one generation in flight per account', () => {
  it('a valid request claims the slot, spends once, and RELEASES', async () => {
    let heldDuring = 0
    h.state.onGenerate = () => { heldDuring = h.state.kv.size }
    const { status } = await post(validBody())
    expect({ status, heldDuring, after: h.state.kv.size, aiGuard: h.state.aiGuardCalls })
      .toEqual({ status: 503, heldDuring: 1, after: 0, aiGuard: 1 })
  })

  it('⚠️ TWO CONCURRENT REQUESTS SPEND ONE TOKEN, NOT TWO', async () => {
    // The headline defect. The caps were never bypassed — the quota was simply spent twice for a
    // single traveller's plan, which on an 8/hour budget is a quarter of their afternoon.
    let release: () => void = () => {}
    let arrived: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => { release = resolve })
    const insideSection = new Promise<void>((resolve) => { arrived = resolve })
    h.state.onGlobalLimit = () => { arrived(); return inFlight }

    const first = post(validBody())
    await insideSection            // the first request now HOLDS the slot; no timing assumption
    const second = await post(validBody())
    release()
    const firstResult = await first

    expect({
      winner: firstResult.status,
      loser: second.status,
      loserError: second.json.error,
      aiGuard: h.state.aiGuardCalls,
      global: h.state.globalLimitCalls,
    }).toEqual({ winner: 503, loser: 409, loserError: 'already_generating', aiGuard: 1, global: 1 })
  })

  it('the slot is per ACCOUNT — a second traveller is never blocked by the first', async () => {
    h.state.kv.set('itinerary-inflight:someone-else', 'their-token')
    const { status } = await post(validBody())
    expect({ status, aiGuard: h.state.aiGuardCalls }).toEqual({ status: 503, aiGuard: 1 })
  })

  it('⚠️ RELEASE IS OWNERSHIP-CHECKED — a late finisher cannot free somebody else s slot', async () => {
    // Both reviewers found this independently. If a request outlives its own TTL, the next one
    // claims the key; an unconditional delete in `finally` would then hand a third request a slot
    // while the second is still generating.
    h.state.onGenerate = () => { h.state.kv.set(SLOT, 'a-newer-requests-token') }
    await post(validBody())
    expect(h.state.kv.get(SLOT)).toBe('a-newer-requests-token')
  })

  it('FAILS OPEN when the KV backend is down — the real caps still hold', async () => {
    // Deliberate: this is a spend-efficiency guard, not a security control. A reviewer correctly
    // noted the degraded behaviour is not bit-identical to having no guard at all (a set that
    // commits and then errors can leave a key behind); what matters is that a cache outage cannot
    // take the feature down, and that aiGuard/the global ceiling are untouched.
    h.state.kvThrows = true
    const { status } = await post(validBody())
    expect({ status, aiGuard: h.state.aiGuardCalls }).toEqual({ status: 503, aiGuard: 1 })
  })
})
