import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── THE CAPTURE-TIME SELECTION GUARD (Phase 2, external review D10) ────────────────
//
// The stale-tab capture: the applicant re-selected a product, then paid a provider
// session minted for the OLD one. Money is provider truth, so the payment must STAMP;
// what must NOT happen is the silent handoff of a case whose paid product and selected
// product disagree. This suite proves, against markVisaPaidAndHandoff itself:
//   1. matching selection → handoff proceeds (the guard is not a new refusal for the
//      honest path);
//   2. mismatched selection → paid_at stamps, handoff is WITHHELD, and a named
//      `payment_selection_mismatch` event makes the reason desk-visible;
//   3. an unreadable audit trail fails SOFT — the consent hash alone decides.
//
// The queue-side half of the fix (a paid draft is always visible to the desk) is the
// `.or('status.neq.draft,paid_at.not.is.null')` read in visa-admin.ts.

type Row = Record<string, any>

const APP_ID = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  state: {
    application: null as Row | null,
    documents: [] as Row[],
    paymentRow: null as Row | null,
    /** visa_events rows the mock serves, newest-relevant first is the caller's job. */
    events: [] as Row[],
    eventsError: null as unknown,
    payload: { entryType: 'single' } as Row,
    issues: [] as unknown[],
    snapshotHash: 'consent-hash',
    updates: [] as Array<{ table: string; payload: Row }>,
    recorded: [] as Array<{ event: string; metadata: Row }>,
    /** Simulate the RACE: the app is present at the initial read but a concurrent delete
     *  removed it by the time the atomic RPC runs → the RPC returns 'app_gone'. */
    appGoneAtRpc: false,
  },
}))

vi.mock('@/lib/visa/db', () => {
  const from = (table: string) => {
    const b: Row = { _op: 'select', _payload: null, _filters: [] as Array<[string, unknown]> }
    const result = () => {
      if (b._op === 'update') {
        h.state.updates.push({ table, payload: b._payload })
        if (table === 'visa_applications') {
          // The stamp/handoff UPDATE echoes the row back (maybeSingle .select('*')).
          const merged = { ...h.state.application, ...b._payload }
          h.state.application = merged
          return { data: merged, error: null }
        }
        return { data: null, error: null }
      }
      if (table === 'visa_applications') return { data: h.state.application, error: null }
      if (table === 'visa_documents') return { data: h.state.documents, error: null }
      if (table === 'visa_payments') return { data: h.state.paymentRow, error: null }
      if (table === 'visa_events') {
        if (h.state.eventsError) return { data: null, error: h.state.eventsError }
        const wanted = b._filters.find(([k]) => k === 'event')?.[1]
        return { data: h.state.events.filter((e) => e.event === wanted), error: null }
      }
      return { data: null, error: null }
    }
    b.select = () => b
    b.eq = (k: string, v: unknown) => { b._filters.push([k, v]); return b }
    b.is = () => b
    b.in = () => b
    b.order = () => b
    b.limit = () => b
    b.update = (p: Row) => { b._op = 'update'; b._payload = p; return b }
    b.maybeSingle = () => Promise.resolve().then(() => {
      const { data, error } = result() as Row
      return { data: Array.isArray(data) ? data[0] ?? null : data, error }
    })
    b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve().then(result).then(onF, onR)
    return b
  }
  // The atomic capture RPC (scripts/visa-capture-payment-fn.mjs) — mirror its outcome logic:
  // lock+verify the app, flip the payment created→paid at most once bound to application_id,
  // stamp the app (coalesce), and classify flipped | already_paid | app_gone | unexpected.
  const rpc = async (fn: string, args: Row) => {
    if (fn !== 'visa_capture_payment') return { data: null, error: null }
    const app = h.state.application
    if (h.state.appGoneAtRpc || !app || app.id !== args.p_app_id) return { data: 'app_gone', error: null }
    const appWasUnstamped = !app.paid_at // captured at the (FOR UPDATE) lock, before stamping
    const pay = h.state.paymentRow
    const refMatch = !!pay && pay.application_id === args.p_app_id
      && pay.provider === args.p_provider && pay.provider_ref === args.p_provider_ref
    let flipped = false
    if (refMatch && pay!.status === 'created') {
      pay!.status = 'paid'; pay!.paid_at = args.p_now
      pay!.amount_cents = args.p_amount_cents; pay!.currency = args.p_currency
      flipped = true
    } else if (refMatch && pay!.status === 'paid') {
      // already paid — a replay; may still complete a legacy-partial case below.
    } else {
      // Unexpected → the real RPC RAISES, rolling back the whole tx (NO app stamp). Surface as an
      // rpc error and leave the app untouched.
      return { data: null, error: { message: 'visa_capture_unexpected' } }
    }
    // Stamp the app — reached ONLY for flipped/already_paid (coalesce, so a replay keeps paid_at).
    app.paid_at = app.paid_at ?? args.p_now
    app.payment_provider = app.payment_provider ?? args.p_provider
    app.payment_ref = app.payment_ref ?? args.p_provider_ref
    app.updated_at = args.p_now
    // 'flipped' whenever THIS call advanced the capture (money freshly recorded OR case freshly
    // stamped); only a fully-settled replay is 'already_paid'.
    return { data: (flipped || appWasUnstamped) ? 'flipped' : 'already_paid', error: null }
  }
  return { getVisaDb: () => ({ from, rpc }) }
})

vi.mock('@/lib/visa/crypto', () => ({
  decryptVisaPayload: () => h.state.payload,
  visaApplicantSnapshotHash: () => h.state.snapshotHash,
}))
vi.mock('@/lib/visa/schema', () => ({
  validateVisaForReview: () => h.state.issues,
  VISA_DECLARATION_VERSION: 'decl-1',
  VISA_AUTHORIZATION_VERSION: 'auth-1',
}))
vi.mock('@/lib/visa/records', () => ({
  recordVisaEvent: vi.fn(async (_id: string, _actor: string, event: string, _ref?: string, metadata: Row = {}) => {
    h.state.recorded.push({ event, metadata })
  }),
}))
// The post-capture card restamp is outside this suite (dm-thread's own tests own it).
vi.mock('@/lib/visa/dm-thread', () => ({ markVisaThreadPaid: async () => true }))
vi.mock('@/lib/vnd', () => ({ formatMoneyFull: () => '0 ₫' }))

const { markVisaPaidAndHandoff } = await import('./payments')

function seed(opts: { selected?: string | null; charged?: string; consent?: boolean } = {}) {
  h.state.application = {
    id: APP_ID, user_id: 'user-1', status: 'draft', encrypted_payload: 'cipher',
    paid_at: null, selected_listing_id: opts.selected ?? null,
    updated_at: '2026-07-23T00:00:00.000Z', checklist: [],
  }
  h.state.documents = []
  h.state.paymentRow = {
    application_id: APP_ID, provider: 'stripe', provider_ref: 'cs_1', status: 'created',
    amount_cents: 11_489, currency: 'USD',
    consent_snapshot_hash: opts.consent === false ? 'stale-hash' : 'consent-hash',
    consent_declaration_version: 'decl-1', consent_authorization_version: 'auth-1',
  }
  h.state.events = [
    { event: 'checkout_started', metadata: { providerRef: 'cs_1', listingId: opts.charged ?? 'listing-A' } },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, {
    application: null, documents: [], paymentRow: null, events: [], eventsError: null,
    payload: { entryType: 'single' }, issues: [], snapshotHash: 'consent-hash',
    updates: [], recorded: [], appGoneAtRpc: false,
  })
})

const capture = () => markVisaPaidAndHandoff({
  applicationId: APP_ID, provider: 'stripe', providerRef: 'cs_1',
  amountCents: 11_489, currency: 'USD', actorRef: 'webhook',
})

describe('the capture-time selection guard', () => {
  it('matching selection: paid stamps AND the handoff proceeds', async () => {
    seed({ selected: 'listing-A', charged: 'listing-A' })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, handedOff: true })
    expect(h.state.application!.paid_at).toBeTruthy()
    expect(h.state.application!.status).toBe('ready_for_review')
    expect(h.state.recorded.map((r) => r.event)).not.toContain('payment_selection_mismatch')
  })

  it('MISMATCH: the payment stamps, the handoff is withheld, the desk gets a named event', async () => {
    seed({ selected: 'listing-B', charged: 'listing-A' })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, handedOff: false })
    // Money is provider truth — the case IS paid…
    expect(h.state.application!.paid_at).toBeTruthy()
    // …but it stays an editable draft instead of reaching review under the wrong product.
    expect(h.state.application!.status).toBe('draft')
    const mismatch = h.state.recorded.find((r) => r.event === 'payment_selection_mismatch')
    expect(mismatch!.metadata).toMatchObject({ chargedListingId: 'listing-A', selectedListingId: 'listing-B' })
  })

  it('the event-fallback selection guards too (legacy rows without the column)', async () => {
    seed({ selected: null, charged: 'listing-A' })
    h.state.events.push({ event: 'dm_product_selected', metadata: { listingId: 'listing-B' } })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, handedOff: false })
    expect(h.state.recorded.some((r) => r.event === 'payment_selection_mismatch')).toBe(true)
  })

  it('an unreadable audit trail fails CLOSED — the handoff waits until it can be verified', async () => {
    // The consent hash is a PAYLOAD hash: a same-entry-type product swap leaves it
    // intact, so this guard is the ONLY gate for that swap and may not stand down just
    // because the trail was momentarily unreadable. The payment still stamps; the case
    // stays a desk-visible paid draft; the sibling capture path retries the read.
    seed({ selected: 'listing-B', charged: 'listing-A' })
    h.state.eventsError = new Error('events unreadable')
    const result = await capture()
    expect(result).toMatchObject({ ok: true, handedOff: false })
    expect(h.state.application!.paid_at).toBeTruthy()
    expect(h.state.application!.status).toBe('draft')
    // No mismatch event — nothing was VERIFIED, only unverifiable.
    expect(h.state.recorded.some((r) => r.event === 'payment_selection_mismatch')).toBe(false)
  })

  it('a charge whose case selects NOTHING is a mismatch, not a pass', async () => {
    seed({ selected: null, charged: 'listing-A' })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, handedOff: false })
    const mismatch = h.state.recorded.find((r) => r.event === 'payment_selection_mismatch')
    expect(mismatch!.metadata).toMatchObject({ chargedListingId: 'listing-A', selectedListingId: null })
  })
})

describe('the atomic capture (visa_capture_payment RPC) — race + idempotency outcomes', () => {
  it('flipped: records the payment_recorded event exactly once and reports alreadyPaid=false', async () => {
    seed({ selected: 'listing-A', charged: 'listing-A' })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, alreadyPaid: false })
    expect(h.state.recorded.filter((r) => r.event === 'payment_recorded')).toHaveLength(1)
    expect(h.state.paymentRow!.status).toBe('paid')
  })

  it('already_paid: a replay (payment already paid) does NOT re-record the money and reports alreadyPaid=true', async () => {
    seed({ selected: 'listing-A', charged: 'listing-A' })
    h.state.paymentRow!.status = 'paid' // a prior capture already flipped it
    h.state.application!.paid_at = '2026-07-23T01:00:00.000Z'
    const result = await capture()
    expect(result).toMatchObject({ ok: true, alreadyPaid: true })
    // No second payment_recorded — the money was recorded by the earlier call.
    expect(h.state.recorded.filter((r) => r.event === 'payment_recorded')).toHaveLength(0)
  })

  it('legacy partial (payment paid, app NOT yet stamped): completes the case AND records the event', async () => {
    // The old two-write flow could crash between the payment flip and the app stamp. Recovering that
    // state must still record payment_recorded (the case is being completed now), not treat it as a
    // settled replay (codex, 2026-07-24).
    seed({ selected: 'listing-A', charged: 'listing-A' })
    h.state.paymentRow!.status = 'paid'      // payment already flipped by the crashed call…
    h.state.application!.paid_at = null       // …but the app was never stamped
    const result = await capture()
    expect(result).toMatchObject({ ok: true, alreadyPaid: false })
    expect(h.state.recorded.filter((r) => r.event === 'payment_recorded')).toHaveLength(1)
    expect(h.state.application!.paid_at).toBeTruthy()
  })

  it('app_gone: a delete lands BETWEEN the read and the atomic flip → not_found, no paid record', async () => {
    // The app is present at the initial read (so this exercises the RPC's app_gone, not the
    // early not_found), then a concurrent delete removes it before the atomic flip runs.
    seed({ selected: 'listing-A', charged: 'listing-A' })
    h.state.appGoneAtRpc = true
    const result = await capture()
    expect(result).toMatchObject({ ok: false, error: 'not_found' })
    // The payment was NOT flipped to paid against a ghost application — no fabricated record.
    expect(h.state.paymentRow!.status).toBe('created')
    expect(h.state.recorded.some((r) => r.event === 'payment_recorded')).toBe(false)
  })

  it('unexpected: a shaky checkout row → the tx ROLLS BACK (throws, app NOT stamped paid)', async () => {
    seed({ selected: 'listing-A', charged: 'listing-A' })
    h.state.paymentRow!.status = 'cancelled' // neither created nor paid — a shaky state
    await expect(capture()).rejects.toThrow(/visa_capture_unexpected/)
    // The RPC raised before stamping → the application must NOT be marked paid off a bad payment.
    expect(h.state.application!.paid_at).toBeFalsy()
    expect(h.state.recorded.some((r) => r.event === 'payment_recorded')).toBe(false)
  })
})
