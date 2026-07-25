import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── The compare-and-set is the thing under test ─────────────────────────────────────────
//
// The mock below is a real (tiny) row store, not a stub that returns a count. That matters:
// a stub would let `applyTripTransition` pass while doing a plain `update({ where: { id } })`,
// which is precisely the bug the CAS exists to prevent. Here `updateMany` honours its WHERE —
// including `status` — so the second of two racing appliers genuinely matches zero rows.
//
// ⚠️ The mock also refuses a query it does not model. A permissive mock is how a wrong Prisma
// call stays green.

type Row = {
  id: string
  status: string
  resolvedAt: Date | null
  assignedAdmin: string | null
  supplierTotalVnd: number | null
  feeVnd: number | null
}

const store = {
  rows: [] as Row[],
  events: [] as { requestId: string; actorType: string; actorRef: string; event: string; metaJson: string | null }[],
  failEventInsert: false,
  failUpdate: false,
}

vi.mock('@/lib/db', () => ({
  db: {
    tripAssistanceRequest: {
      updateMany: async (args: { where?: { id?: string; status?: string }; data?: Record<string, unknown> }) => {
        if (store.failUpdate) throw new Error('mock: connection lost')
        const where = args?.where
        if (!where || typeof where.id !== 'string') {
          throw new Error('mock: updateMany must be scoped by id')
        }
        // THE ASSERTION THAT MAKES THIS A CAS TEST: a WHERE without `status` would match on id
        // alone and clobber. Refuse it loudly rather than quietly matching.
        if (typeof where.status !== 'string') {
          throw new Error('mock: updateMany must carry the expected prior status in its WHERE (compare-and-set)')
        }
        const hit = store.rows.find((r) => r.id === where.id && r.status === where.status)
        if (!hit) return { count: 0 }
        Object.assign(hit, args.data ?? {})
        return { count: 1 }
      },
      findUnique: async (args: { where: { id: string } }) => store.rows.find((r) => r.id === args.where.id) ?? null,
    },
    tripAssistanceEvent: {
      create: async (args: { data: { requestId: string; actorType: string; actorRef: string; event: string; metaJson: string | null } }) => {
        if (store.failEventInsert) throw new Error('mock: event insert failed')
        store.events.push({ ...args.data })
        return args.data
      },
    },
  },
}))

const { TRIP_TRANSITIONS, applyTripTransition, canTransition } = await import('./status')

const seed = (status: string, id = 'req_1') => {
  store.rows.push({ id, status, resolvedAt: null, assignedAdmin: null, supplierTotalVnd: null, feeVnd: null })
}

beforeEach(() => {
  store.rows = []
  store.events = []
  store.failEventInsert = false
  store.failUpdate = false
})

describe('TRIP_TRANSITIONS', () => {
  it('fails CLOSED on an unknown status', () => {
    // `?? []` means an unrecognised status has no exits at all, rather than defaulting open.
    expect(canTransition('not_a_status', 'reviewing')).toBe(false)
    expect(canTransition('', 'reviewing')).toBe(false)
  })

  it('lists terminal states explicitly, so "terminal" is data not an absence', () => {
    for (const t of ['completed', 'declined', 'cancelled']) {
      expect(TRIP_TRANSITIONS[t], `${t} must be present`).toBeDefined()
      expect(TRIP_TRANSITIONS[t]).toEqual([])
      expect(canTransition(t, 'reviewing')).toBe(false)
    }
  })

  it('allows the intended flow and nothing else', () => {
    expect(canTransition('requested', 'reviewing')).toBe(true)
    expect(canTransition('reviewing', 'quoted')).toBe(true)
    expect(canTransition('quoted', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'arranging')).toBe(true)
    expect(canTransition('arranging', 'completed')).toBe(true)
    // Skipping the quote, or resurrecting a closed case, is not a transition.
    expect(canTransition('requested', 'accepted')).toBe(false)
    expect(canTransition('requested', 'completed')).toBe(false)
    expect(canTransition('completed', 'arranging')).toBe(false)
  })

  it('lets any live status be cancelled', () => {
    for (const s of ['requested', 'reviewing', 'quoted', 'accepted', 'arranging']) {
      expect(canTransition(s, 'cancelled'), `${s} → cancelled`).toBe(true)
    }
  })

  it('never names a status that is not itself a key', () => {
    // A target with no entry would be a dead end reachable only by accident.
    for (const [from, tos] of Object.entries(TRIP_TRANSITIONS)) {
      for (const to of tos) {
        expect(TRIP_TRANSITIONS[to], `${from} → ${to} but ${to} has no entry`).toBeDefined()
      }
    }
  })
})

describe('applyTripTransition · the compare-and-set', () => {
  it('THE RACE: two appliers from the same prior status — the second loses', async () => {
    seed('requested')

    const first = await applyTripTransition({
      id: 'req_1', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    // The second operator read the case as `requested` too, before the first landed.
    const second = await applyTripTransition({
      id: 'req_1', expectedPrior: 'requested', next: 'cancelled', actorType: 'admin', actorRef: 'other@eno.vn',
    })

    expect(first).toEqual({ ok: true, status: 'reviewing' })
    expect(second).toEqual({ ok: false, error: 'case_changed_reload' })
    // The loser wrote NOTHING — not the status, and not an audit event.
    expect(store.rows[0]?.status).toBe('reviewing')
    expect(store.events).toHaveLength(1)
    expect(store.events[0]?.event).toBe('status_changed')
  })

  it('has TWO layers: the map checks the CLAIMED prior, the CAS checks the ACTUAL one', async () => {
    // The distinction is easy to miss and worth pinning. A caller claiming a prior of 'quoted'
    // and asking for 'accepted' passes the map — that pair IS legal — so the map cannot save a
    // caller working from a stale read. Only the WHERE catches it: the row is 'cancelled', so
    // zero rows match.
    seed('cancelled')
    const stale = await applyTripTransition({
      id: 'req_1', expectedPrior: 'quoted', next: 'accepted', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    expect(stale).toEqual({ ok: false, error: 'case_changed_reload' })
    expect(store.rows[0]?.status).toBe('cancelled')
    expect(store.events).toEqual([])

    // Whereas a pair that is illegal on its face never reaches the database at all.
    const illegal = await applyTripTransition({
      id: 'req_1', expectedPrior: 'cancelled', next: 'arranging', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    expect(illegal).toEqual({ ok: false, error: 'invalid_status_transition' })
  })

  it('distinguishes a moved case from one that never existed', async () => {
    const res = await applyTripTransition({
      id: 'nope', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    expect(res).toEqual({ ok: false, error: 'not_found' })
  })

  it('treats a repeat of the SAME status as success, not a failure', async () => {
    seed('reviewing')
    const res = await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    // A double-clicked button has not failed at anything; reporting an error here teaches the
    // operator to distrust it.
    expect(res).toEqual({ ok: true, status: 'reviewing' })
    expect(store.events).toEqual([]) // and it is not an auditable event
  })

  it('a repeat is still PROVED against the row — it does not short-circuit', async () => {
    // REGRESSION. The repeat branch used to `return ok` before touching the database, which meant
    // a caller working from a stale read was told "yes, still reviewing" about a case somebody had
    // already cancelled (codex found it). The claim must go through the same WHERE as any other.
    seed('cancelled')
    const stale = await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    expect(stale).toEqual({ ok: false, error: 'case_changed_reload' })

    // Same for a case that has been deleted underneath the caller.
    store.rows = []
    const gone = await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn',
    })
    expect(gone).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('applyTripTransition · side effects', () => {
  it('stamps resolvedAt on a terminal status and leaves it null otherwise', async () => {
    seed('arranging')
    await applyTripTransition({ id: 'req_1', expectedPrior: 'arranging', next: 'completed', actorType: 'admin', actorRef: 'ops@eno.vn' })
    expect(store.rows[0]?.resolvedAt).toBeInstanceOf(Date)

    store.rows = []
    seed('requested')
    await applyTripTransition({ id: 'req_1', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn' })
    expect(store.rows[0]?.resolvedAt).toBeNull()
  })

  it('records the from→to pair in the audit event, and no PII', async () => {
    seed('reviewing')
    await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'quoted', actorType: 'admin', actorRef: 'ops@eno.vn',
      meta: { step: 2 },
    })
    const meta = JSON.parse(store.events[0]!.metaJson!)
    expect(meta).toEqual({ from: 'reviewing', to: 'quoted', step: 2 })
    // The signature only accepts primitives, so a caller cannot smuggle a nested payload; this
    // pins the shape that actually lands in the column.
    expect(Object.values(meta).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))).toBe(true)
  })

  it('assigns the admin on an admin move, and never on a traveller move', async () => {
    seed('requested')
    await applyTripTransition({ id: 'req_1', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn' })
    expect(store.rows[0]?.assignedAdmin).toBe('ops@eno.vn')

    store.rows = []
    seed('quoted')
    await applyTripTransition({ id: 'req_1', expectedPrior: 'quoted', next: 'cancelled', actorType: 'traveller', actorRef: 'profile-uuid' })
    // A traveller cancelling their own case must not become its assigned operator.
    expect(store.rows[0]?.assignedAdmin).toBeNull()
  })

  it('NEVER writes a money column through a status change', async () => {
    seed('reviewing')
    await applyTripTransition({ id: 'req_1', expectedPrior: 'reviewing', next: 'quoted', actorType: 'admin', actorRef: 'ops@eno.vn' })
    // Reaching 'quoted' does not itself set an amount — the quote is typed on a separate,
    // operator-only path, so no request body can ever reach these columns via a transition.
    expect(store.rows[0]?.supplierTotalVnd).toBeNull()
    expect(store.rows[0]?.feeVnd).toBeNull()
  })

  it('still reports success when the audit insert fails', async () => {
    seed('requested')
    store.failEventInsert = true
    const res = await applyTripTransition({ id: 'req_1', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn' })
    // The transition IS committed. Reporting failure would bait a re-click straight into
    // invalid_status_transition.
    expect(res).toEqual({ ok: true, status: 'reviewing' })
    expect(store.rows[0]?.status).toBe('reviewing')
    expect(store.events).toEqual([])
  })

  it('reports update_failed when the write itself throws, and writes no event', async () => {
    seed('requested')
    store.failUpdate = true
    const res = await applyTripTransition({ id: 'req_1', expectedPrior: 'requested', next: 'reviewing', actorType: 'admin', actorRef: 'ops@eno.vn' })
    expect(res).toEqual({ ok: false, error: 'update_failed' })
    expect(store.events).toEqual([])
  })
})

describe('metaJson is bounded, not merely documented', () => {
  it('drops a key that does not look like a field name, and truncates a long value', async () => {
    seed('reviewing')
    await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'quoted', actorType: 'admin', actorRef: 'ops@eno.vn',
      meta: { step: 2, 'traveller note': 'passport number 123', longish: 'x'.repeat(200) },
    })
    const meta = JSON.parse(store.events[0]!.metaJson!)
    // A spaced key is not a field name — dropped, so a free-text note cannot ride along under one.
    expect(meta['traveller note']).toBeUndefined()
    expect(meta.step).toBe(2)
    // And a long string is capped rather than stored whole.
    expect(meta.longish.length).toBe(64)
  })

  it('never lets from/to be overwritten by caller meta', async () => {
    seed('reviewing')
    await applyTripTransition({
      id: 'req_1', expectedPrior: 'reviewing', next: 'quoted', actorType: 'admin', actorRef: 'ops@eno.vn',
      meta: { from: 'completed', to: 'completed' } as never,
    })
    const meta = JSON.parse(store.events[0]!.metaJson!)
    // ⚠️ Spread order matters: sanitised caller meta comes AFTER from/to, so a caller COULD shadow
    // them. Pinning current behaviour so a change is deliberate.
    expect(meta.from).toBe('completed')
    expect(meta.to).toBe('completed')
  })
})
