import { beforeEach, describe, expect, it, vi } from 'vitest'

// The case lifecycle. The tests that matter most are the ones proving a traveller has NO path to
// a monetary column, and that every actor is resolved from the session rather than accepted as an
// argument — the structural weakness an external review found in the two previous commits.

const h = vi.hoisted(() => ({
  state: {
    profile: { id: 'traveller' } as { id: string } | null,
    admin: null as string | null,
    itineraries: {} as Record<string, { id: string; profileId: string }>,
    requests: {} as Record<string, { id: string; itineraryId: string; profileId: string; status: string; supplierTotalVnd: number | null; feeVnd: number | null; quotedAt: Date | null; assignedAdmin: string | null; createdAt: Date }>,
    events: [] as Array<{ requestId: string; actorType: string; actorRef: string; event: string; metaJson: string | null }>,
    creates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    createThrows: false,
    // Advisory-lock keys the code asked for, in order.
    locks: [] as string[],
    // Cards the lifecycle asked the DM layer to post.
    cards: [] as Array<{ kind: string; requestId: string; status?: string }>,
    // Simulates the status moving between the read and the compare-and-set.
    statusMovesTo: null as string | null,
    // Removes the row inside the compare-and-set, so the applier sees a vanished case.
    deleteBeforeCas: null as string | null,
  },
}))

// Mocked so the WIRING is observable. Without this the real dm-flow runs, finds no bound thread,
// and returns null — the calls would silently no-op and "the card follows the money" would be an
// untested claim.
vi.mock('./dm-flow', () => ({
  sendTripQuoteCard: async (input: { requestId: string }) => {
    h.state.cards.push({ kind: 'trip_quote', requestId: input.requestId })
    return { messageId: 'msg-1' }
  },
  announceTripStatus: async (input: { requestId: string; status: string }) => {
    h.state.cards.push({ kind: 'trip_status', requestId: input.requestId, status: input.status })
    return { messageId: 'msg-2' }
  },
}))


// ⚠️ THE DESK OPERATOR GATE, MOCKED TO THE SAME `h.state.admin` THESE TESTS ALREADY DRIVE.
// The production gate moved from getAdmin() to the SCOPED desk operator (src/lib/desk-operator.ts)
// so a partner running one desk does not need ADMIN_EMAILS — which would have granted them every
// dispute room and every other applicant's documents. Every assertion in this file is about the
// operator/non-operator distinction, not about which env names the operator, so pointing the new
// helper at the same flag keeps them meaningful. The entitlement itself — visa operator refused on
// trips and vice versa — is pinned in src/lib/desk-operator.test.ts.
vi.mock('../desk-operator', () => ({
  getTripDeskOperator: async () => h.state.admin,
  getVisaDeskOperator: async () => h.state.admin,
}))
vi.mock('../admin', () => ({
  getCurrentProfile: async () => h.state.profile,
  getAdmin: async () => h.state.admin,
}))

vi.mock('../db', () => {
  const matches = (row: any, where: any): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false
    if (where.itineraryId !== undefined && row.itineraryId !== where.itineraryId) return false
    if (where.profileId !== undefined && row.profileId !== where.profileId) return false
    if (where.status !== undefined) {
      if (typeof where.status === 'string' && row.status !== where.status) return false
      if (where.status?.in && !where.status.in.includes(row.status)) return false
    }
    return true
  }
  const sorted = () => Object.values(h.state.requests).sort((a: any, b: any) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  const mod: any = {
    db: {
      itinerary: { findUnique: async (args: any) => h.state.itineraries[args.where.id] ?? null },
      tripAssistanceRequest: {
        // ⚠️ COPIES, not the stored objects. Returning live references let a later updateMany
        // mutate a row the code had already read, so a value captured BEFORE the write appeared
        // to change after it — which silently faked a passing audit trail here, and would hide
        // any real staleness bug. Prisma hands back fresh objects; the mock must too.
        findUnique: async (args: any) => {
          const row = h.state.requests[args.where.id]
          return row ? { ...row } : null
        },
        findFirst: async (args: any) => {
          const row = sorted().find((r: any) => matches(r, args.where))
          return row ? { ...row } : null
        },
        create: async (args: any) => {
          if (h.state.createThrows) throw new Error('db down')
          h.state.creates.push(args.data)
          const id = 'new-case'
          h.state.requests[id] = {
            id, itineraryId: args.data.itineraryId, profileId: args.data.profileId,
            status: 'requested', supplierTotalVnd: null, feeVnd: null, quotedAt: null,
            assignedAdmin: null, createdAt: new Date(2_000_000_000_000),
          }
          return { id, createdAt: h.state.requests[id].createdAt }
        },
        updateMany: async (args: any) => {
          h.state.updates.push({ where: args.where, data: args.data })
          // Apply the armed race BEFORE matching, so the compare-and-set sees the moved status.
          if (h.state.statusMovesTo && args.where.id && h.state.requests[args.where.id]) {
            h.state.requests[args.where.id].status = h.state.statusMovesTo
            h.state.statusMovesTo = null
          }
          if (h.state.deleteBeforeCas && args.where.id === h.state.deleteBeforeCas) {
            delete h.state.requests[h.state.deleteBeforeCas]
            h.state.deleteBeforeCas = null
          }
          const hits = Object.values(h.state.requests).filter((r: any) => matches(r, args.where))
          for (const row of hits) Object.assign(row, args.data)
          return { count: hits.length }
        },
      },
      tripAssistanceEvent: {
        create: async (args: any) => { h.state.events.push(args.data); return args.data },
        findFirst: async () => null,
      },
      // The lock is taken on the TRANSACTION client, so the mock hands the same delegates back
      // plus an $executeRaw that records the key. A tx object missing $executeRaw would make the
      // lock silently untestable.
      $executeRaw: async () => 1,
      $transaction: async (fn: any) => fn({
        tripAssistanceRequest: dbRef.tripAssistanceRequest,
        $executeRaw: async (strings: any, ...values: any[]) => {
          h.state.locks.push(String(values[0]))
          return 1
        },
      }),
    },
  }
  const dbRef = mod.db
  return mod
})

import { acceptQuote, cancelAssistance, declineQuote, moveAssistanceAsAdmin, quoteAssistance, requestAssistance, startReview, viewAssistance } from './assistance'
import { isTerminalStatus, openStatuses } from './status'

const ITIN = 'itin-1'

beforeEach(() => {
  h.state.profile = { id: 'traveller' }
  h.state.admin = null
  h.state.itineraries = { [ITIN]: { id: ITIN, profileId: 'traveller' } }
  h.state.requests = {}
  h.state.events = []
  h.state.creates = []
  h.state.updates = []
  h.state.createThrows = false
  h.state.locks = []
  h.state.cards = []
  h.state.statusMovesTo = null
  h.state.deleteBeforeCas = null
})

const seedCase = (over: Partial<{ id: string; status: string; profileId: string }> = {}) => {
  const id = over.id ?? 'case-1'
  h.state.requests[id] = {
    id, itineraryId: ITIN, profileId: over.profileId ?? 'traveller', status: over.status ?? 'quoted',
    supplierTotalVnd: null, feeVnd: null, quotedAt: null, assignedAdmin: null,
    createdAt: new Date(1_500_000_000_000),
  }
  return id
}

describe('status helpers are DERIVED from the one map', () => {
  it('calls exactly the no-exit statuses terminal', () => {
    for (const s of ['completed', 'declined', 'cancelled']) expect(isTerminalStatus(s)).toBe(true)
    for (const s of ['requested', 'reviewing', 'quoted', 'accepted', 'arranging']) expect(isTerminalStatus(s)).toBe(false)
  })

  it('does not call an UNKNOWN status terminal — it is unknown, and has no exits anyway', () => {
    expect(isTerminalStatus('refunded')).toBe(false)
  })

  it('openStatuses is the complement', () => {
    expect(openStatuses().sort()).toEqual(['accepted', 'arranging', 'quoted', 'requested', 'reviewing'])
  })
})

describe('requestAssistance', () => {
  it('refuses a signed-out caller', async () => {
    h.state.profile = null
    expect(await requestAssistance({ itineraryId: ITIN })).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('refuses an itinerary that is not the callers', async () => {
    // Ownership of the TRIP, proven before a case can expose it to an operator.
    h.state.itineraries[ITIN].profileId = 'someone-else'
    expect(await requestAssistance({ itineraryId: ITIN })).toEqual({ ok: false, error: 'forbidden' })
    expect(h.state.creates).toHaveLength(0)
  })

  it('gives an unknown itinerary the SAME answer as someone else\'s, so ids cannot be enumerated', async () => {
    // Both must be 'forbidden'. If these two ever differ again, a signed-in user can probe
    // itinerary ids and read the difference to confirm another traveller's trip exists.
    const unknown = await requestAssistance({ itineraryId: 'nope' })
    expect(unknown).toEqual({ ok: false, error: 'forbidden' })
  })

  it('creates a case with NO money on it', async () => {
    const result = await requestAssistance({ itineraryId: ITIN })
    expect(result).toEqual({ ok: true, requestId: 'new-case' })
    // The insert names only the itinerary and the traveller — no status, no amounts.
    expect(h.state.creates[0]).toEqual({ itineraryId: ITIN, profileId: 'traveller' })
    expect(h.state.requests['new-case'].supplierTotalVnd).toBeNull()
    expect(h.state.requests['new-case'].feeVnd).toBeNull()
  })

  it('returns the case already open instead of opening a second', async () => {
    const id = seedCase({ status: 'reviewing' })
    expect(await requestAssistance({ itineraryId: ITIN })).toEqual({ ok: true, requestId: id })
    expect(h.state.creates).toHaveLength(0)
  })

  it('opens a new case when the previous one is TERMINAL', async () => {
    seedCase({ id: 'old', status: 'cancelled' })
    expect(await requestAssistance({ itineraryId: ITIN })).toEqual({ ok: true, requestId: 'new-case' })
  })

  it('takes an advisory lock keyed on the itinerary BEFORE checking', async () => {
    // The check and the insert must be one critical section. A convergence scheme cannot replace
    // this: under READ COMMITTED an uncommitted older insert is invisible, so both writers keep
    // their row (refuted independently by both external reviewers).
    await requestAssistance({ itineraryId: ITIN })
    expect(h.state.locks).toEqual([`trip-assist:${ITIN}`])
  })

  it('finds an already-open case INSIDE the lock and inserts nothing', async () => {
    seedCase({ status: 'reviewing' })
    const result = await requestAssistance({ itineraryId: ITIN })
    expect(result).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.creates).toHaveLength(0)
    expect(h.state.locks).toEqual([`trip-assist:${ITIN}`])
    // No event for a case this call did not open.
    expect(h.state.events).toHaveLength(0)
  })

  it('records the requested event only for a case it actually opened', async () => {
    await requestAssistance({ itineraryId: ITIN })
    expect(h.state.events.map((e) => e.event)).toEqual(['requested'])
  })

  it('reports a failed insert rather than throwing', async () => {
    h.state.createThrows = true
    expect(await requestAssistance({ itineraryId: ITIN })).toEqual({ ok: false, error: 'update_failed' })
  })
})

describe('quoteAssistance — the ONLY writer of money', () => {
  it('REFUSES a non-admin outright, before it looks at anything else', async () => {
    // The money gate. A traveller (or an unauthenticated caller) cannot reach a monetary column.
    h.state.admin = null
    seedCase({ status: 'reviewing' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 1_000, feeVnd: 100 }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(h.state.updates).toHaveLength(0)
  })

  it.each([
    ['a fraction', 1_000.5],
    ['a negative', -1],
    ['above Postgres INTEGER', 2_147_483_648],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('REFUSES %s amount', async (_label, amount) => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: amount, feeVnd: 1 }))
      .toEqual({ ok: false, error: 'invalid_amount' })
    expect(h.state.updates).toHaveLength(0)
  })

  // ── the advertised 10% (T333) ─────────────────────────────────────────────────────────────
  // Three surfaces promise the traveller "the fee is 10% of the bookings we arrange". Until this
  // pass nothing connected the two columns, so a mistyped fee was quoted as if it were that rate.

  it('REFUSES a fee ABOVE the advertised 10%', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 12_000_000, feeVnd: 1_200_001 }))
      .toEqual({ ok: false, error: 'invalid_amount' })
    // Nothing written at all — the money columns are untouched by a rejected quote.
    expect(h.state.updates).toHaveLength(0)
  })

  it('ACCEPTS exactly 10%, and anything below it', async () => {
    h.state.admin = 'ops@eno.vn'
    for (const fee of [1_200_000, 900_000, 0]) {
      h.state.updates.length = 0
      seedCase({ status: 'reviewing' })
      expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 12_000_000, feeVnd: fee }).then((r) => r.ok))
        .toBe(true)
    }
  })

  it('uses FLOOR, not round — a rounded bound lets the fee exceed the thing it bounds', async () => {
    // agy's counter-example at the plan stage: Math.round(15 * 0.10) is 2, and 2/15 is 13.3%.
    // floor(15 / 10) is 1. If this ever regresses to round(), a fee of 2 here starts passing.
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 15, feeVnd: 2 }))
      .toEqual({ ok: false, error: 'invalid_amount' })
    h.state.updates.length = 0
    seedCase({ status: 'reviewing' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 15, feeVnd: 1 }).then((r) => r.ok)).toBe(true)
  })

  it('writes both amounts, the status, quotedAt and the admin in ONE statement', async () => {
    // Two writes could leave a `quoted` case with no quote in it, which the both-or-neither
    // CHECK cannot catch because both columns would still be null together.
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    const result = await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 12_000_000, feeVnd: 900_000 })
    expect(result).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0].where).toEqual({ id: 'case-1', status: 'reviewing' })
    expect(h.state.updates[0].data).toMatchObject({
      status: 'quoted', supplierTotalVnd: 12_000_000, feeVnd: 900_000, assignedAdmin: 'ops@eno.vn',
    })
    expect(h.state.updates[0].data.quotedAt).toBeInstanceOf(Date)
  })

  it('REFUSES a status the map does not allow to reach quoted', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 1_000, feeVnd: 100 }))
      .toEqual({ ok: false, error: 'invalid_status_transition' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('writes NOTHING when the case moved under the compare-and-set', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    h.state.statusMovesTo = 'cancelled'
    expect(await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 1_000, feeVnd: 100 }))
      .toEqual({ ok: false, error: 'case_changed_reload' })
    expect(h.state.requests['case-1'].supplierTotalVnd).toBeNull()
    expect(h.state.requests['case-1'].feeVnd).toBeNull()
    expect(h.state.requests['case-1'].status).toBe('cancelled')
  })

  it('records the quote event with NO amount in it', async () => {
    // TripAssistanceEvent has no owner column and outlives the case; a fee in there is a money
    // fact in a place nothing governs.
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 12_000_000, feeVnd: 900_000 })
    const event = h.state.events.find((e) => e.event === 'quoted')
    expect(event).toBeTruthy()
    expect(event!.metaJson).not.toContain('12000000')
    expect(event!.metaJson).not.toContain('900000')
    expect(JSON.parse(event!.metaJson!)).toEqual({ from: 'reviewing', to: 'quoted' })
  })

  it('reports an unknown case', async () => {
    h.state.admin = 'ops@eno.vn'
    expect(await quoteAssistance({ requestId: 'nope', supplierTotalVnd: 1_000, feeVnd: 100 }))
      .toEqual({ ok: false, error: 'request_not_found' })
  })

  it('POSTS THE CARD after a successful quote — the traveller is always told', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 12_000_000, feeVnd: 900_000 })
    expect(h.state.cards).toEqual([{ kind: 'trip_quote', requestId: 'case-1' }])
  })

  it('posts NO card when the quote was refused', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 1_000, feeVnd: 100 })
    expect(h.state.cards).toHaveLength(0)
  })

  it('posts NO card when the compare-and-set lost', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    h.state.statusMovesTo = 'cancelled'
    await quoteAssistance({ requestId: 'case-1', supplierTotalVnd: 1_000, feeVnd: 100 })
    expect(h.state.cards).toHaveLength(0)
  })
})

describe('traveller actions write no money and prove ownership', () => {
  it('accepts a quote the caller owns', async () => {
    seedCase({ status: 'quoted' })
    expect(await acceptQuote({ requestId: 'case-1' })).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.requests['case-1'].status).toBe('accepted')
    // No monetary column was touched.
    expect(h.state.updates.every((u) => !('feeVnd' in u.data) && !('supplierTotalVnd' in u.data))).toBe(true)
  })

  it('REFUSES to act on someone elses case', async () => {
    seedCase({ status: 'quoted', profileId: 'another-traveller' })
    expect(await acceptQuote({ requestId: 'case-1' })).toEqual({ ok: false, error: 'forbidden' })
    expect(h.state.requests['case-1'].status).toBe('quoted')
  })

  it('REFUSES a signed-out caller', async () => {
    h.state.profile = null
    seedCase({ status: 'quoted' })
    expect(await declineQuote({ requestId: 'case-1' })).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('declines a quote', async () => {
    seedCase({ status: 'quoted' })
    expect(await declineQuote({ requestId: 'case-1' })).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.requests['case-1'].status).toBe('declined')
  })

  it('ANNOUNCES a successful transition, and only a successful one', async () => {
    seedCase({ status: 'quoted' })
    await acceptQuote({ requestId: 'case-1' })
    expect(h.state.cards).toEqual([{ kind: 'trip_status', requestId: 'case-1', status: 'accepted' }])
    h.state.cards = []
    // An illegal move announces nothing.
    await acceptQuote({ requestId: 'case-1' })
    expect(h.state.cards).toHaveLength(0)
  })

  it('REFUSES an illegal move under the ONE map', async () => {
    seedCase({ status: 'requested' })
    expect(await acceptQuote({ requestId: 'case-1' })).toEqual({ ok: false, error: 'invalid_status_transition' })
  })

  it('cancels from a non-terminal status', async () => {
    seedCase({ status: 'arranging' })
    expect(await cancelAssistance({ requestId: 'case-1' })).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.requests['case-1'].status).toBe('cancelled')
  })

  it('cannot cancel a case that already ended', async () => {
    seedCase({ status: 'completed' })
    expect(await cancelAssistance({ requestId: 'case-1' })).toEqual({ ok: false, error: 'invalid_status_transition' })
  })

  it('maps the appliers not_found onto ONE name for the caller', async () => {
    // The row exists at the ownership read and is GONE by the compare-and-set. The applier calls
    // that 'not_found'; a caller should see the same 'request_not_found' it would get from a bad
    // id, because the distinction is meaningless to them.
    seedCase({ status: 'quoted' })
    h.state.deleteBeforeCas = 'case-1'
    expect(await acceptQuote({ requestId: 'case-1' })).toEqual({ ok: false, error: 'request_not_found' })
  })

  it('reports case_changed_reload when the case MOVED rather than vanished', async () => {
    seedCase({ status: 'quoted' })
    h.state.statusMovesTo = 'cancelled'
    expect(await acceptQuote({ requestId: 'case-1' })).toEqual({ ok: false, error: 'case_changed_reload' })
  })
})

describe('startReview', () => {
  it('is admin-only', async () => {
    h.state.admin = null
    seedCase({ status: 'requested' })
    expect(await startReview({ requestId: 'case-1' })).toEqual({ ok: false, error: 'forbidden' })
  })

  it('moves requested to reviewing and claims the case for that admin', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    expect(await startReview({ requestId: 'case-1' })).toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.requests['case-1'].status).toBe('reviewing')
    expect(h.state.requests['case-1'].assignedAdmin).toBe('ops@eno.vn')
  })
})

describe('no existence oracle', () => {
  // Both external reviewers found this independently: returning 'request_not_found' for a
  // nonexistent case and 'forbidden' for one that exists lets a SIGNED-IN stranger enumerate real
  // case ids by comparing statuses. Missing and not-yours must be indistinguishable.

  it('viewAssistance answers the same for a missing case and someone elses', async () => {
    seedCase({ id: 'theirs', profileId: 'another-traveller' })
    const missing = await viewAssistance({ requestId: 'no-such-case' })
    const theirs = await viewAssistance({ requestId: 'theirs' })
    expect(missing).toEqual({ ok: false, error: 'forbidden' })
    expect(theirs).toEqual({ ok: false, error: 'forbidden' })
    expect(missing).toEqual(theirs)
  })

  it('traveller actions answer the same for a missing case and someone elses', async () => {
    seedCase({ id: 'theirs', status: 'quoted', profileId: 'another-traveller' })
    const missing = await acceptQuote({ requestId: 'no-such-case' })
    const theirs = await acceptQuote({ requestId: 'theirs' })
    expect(missing).toEqual({ ok: false, error: 'forbidden' })
    expect(missing).toEqual(theirs)
  })

  it('still shows the OWNER their own case', async () => {
    // The collapse must not blind a legitimate traveller to their own data.
    seedCase({ id: 'mine', status: 'quoted' })
    h.state.requests['mine'].supplierTotalVnd = 12_000_000
    h.state.requests['mine'].feeVnd = 900_000
    const result = await viewAssistance({ requestId: 'mine' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.mine).toBe(true)
      expect(result.data.supplierTotalVnd).toBe(12_000_000)
    }
  })

  it('lets an ADMIN read a case that is not theirs, with mine=false', async () => {
    // An operator must be able to see the case; `mine` false is what keeps the accept button away.
    seedCase({ id: 'theirs', status: 'quoted', profileId: 'another-traveller' })
    h.state.admin = 'ops@eno.vn'
    const result = await viewAssistance({ requestId: 'theirs' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.mine).toBe(false)
  })

  it('refuses a signed-out reader before any lookup', async () => {
    h.state.profile = null
    expect(await viewAssistance({ requestId: 'anything' })).toEqual({ ok: false, error: 'not_signed_in' })
  })
})

describe('moveAssistanceAsAdmin — the ONE admin transition both surfaces use', () => {
  // Exists to delete a second copy of the announce rule. The admin queue route composed
  // transition-then-announce itself because this was private; two copies of "when does a card get
  // posted" is how a double click starts posting duplicates on one surface and not the other.

  it('is admin-only', async () => {
    h.state.admin = null
    seedCase({ status: 'requested' })
    expect(await moveAssistanceAsAdmin({ requestId: 'case-1', next: 'reviewing' }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(h.state.cards).toHaveLength(0)
  })

  it('moves the case and announces the move', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    expect(await moveAssistanceAsAdmin({ requestId: 'case-1', next: 'reviewing' }))
      .toEqual({ ok: true, requestId: 'case-1' })
    expect(h.state.requests['case-1'].status).toBe('reviewing')
    expect(h.state.cards).toEqual([{ kind: 'trip_status', requestId: 'case-1', status: 'reviewing' }])
  })

  it('does NOT announce a repeat — the rule the duplication was risking', async () => {
    // applyTripTransition returns ok for a repeat but records no audit event; a card must follow
    // suit or the second click posts a duplicate into the traveller's thread.
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'reviewing' })
    expect((await moveAssistanceAsAdmin({ requestId: 'case-1', next: 'reviewing' })).ok).toBe(true)
    expect(h.state.cards).toHaveLength(0)
  })

  it('REFUSES an illegal move and announces nothing', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    expect(await moveAssistanceAsAdmin({ requestId: 'case-1', next: 'completed' }))
      .toEqual({ ok: false, error: 'invalid_status_transition' })
    expect(h.state.cards).toHaveLength(0)
    expect(h.state.requests['case-1'].status).toBe('requested')
  })

  it('reports an unknown case', async () => {
    h.state.admin = 'ops@eno.vn'
    expect(await moveAssistanceAsAdmin({ requestId: 'nope', next: 'reviewing' }))
      .toEqual({ ok: false, error: 'request_not_found' })
  })

  it('writes no money on any path', async () => {
    h.state.admin = 'ops@eno.vn'
    seedCase({ status: 'requested' })
    await moveAssistanceAsAdmin({ requestId: 'case-1', next: 'reviewing' })
    expect(h.state.updates.every((u) => !('feeVnd' in u.data) && !('supplierTotalVnd' in u.data))).toBe(true)
  })
})
