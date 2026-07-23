import { beforeEach, describe, expect, it, vi } from 'vitest'

// dm-flow is the loop between the frozen 5-step partition (dm-steps) and the one
// card-authoring surface (dm-thread). Two properties decide whether the chat wizard is
// safe to ship, and neither is observable from a live-DB e2e without spamming a real
// thread, so both are asserted here:
//
//  1. IDEMPOTENCE — the client calls /advance after every upload, every tap and every
//     reconnect. "Post the card for the current step" must mean "make sure it exists".
//  2. ENTITLEMENT — dm-thread takes no actor and says so; every refusal it cannot make is
//     made here, and a refusal must mean NOTHING WAS WRITTEN, not "written and reported".
//
// ⚠️ THE SUPABASE MOCK HONOURS ITS FILTERS. Like dm-thread.test.ts's Prisma engine, this
// is a tiny query engine rather than a stub: `.eq('user_id', …)` really scopes the rows.
// That is load-bearing — the ownership tests below are only meaningful if dropping the
// scope from a query would turn them red.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  state: {
    /** The Supabase-side visa tables. */
    tables: {} as Record<string, Row[]>,
    dbError: null as unknown,
    /** The Prisma-side Message table (visa cards only; createdAt is a counter). */
    messages: [] as Array<{ id: string; conversationId: string; kind: string; metaJson: string | null; createdAt: number }>,
    /** dm-thread stubs. */
    thread: null as null | { conversationId: string; buyerProfileId: string; sellerProfileId: string },
    mode: 'ai' as 'ai' | 'human_requested' | 'admin',
    bindResult: { ok: true, conversationId: 'convo-1', created: false } as any,
    /** visa-shop stubs. */
    shop: { id: 'seller-1', name: 'Eno Vietnam', ownerId: 'shop-owner' } as null | { id: string; name: string; ownerId: string | null },
    listings: [] as Row[],
    products: [] as Row[],
    /** fx + payments. */
    quote: null as null | Row,
    payments: { providers: ['paypal'], feeCents: 100, currency: 'USD' } as null | Row,
    cryptoReady: true,
    /** Fault injection: a concurrent writer lands between the case READ and the CAS write. */
    raceAfterLoad: false,
    /** The hidden $0 anchor a generic start binds to (null = unseeded deployment). */
    genericAnchor: null as null | { id: string },
    /** Fault injection for the fail-soft Conversation.listingId retarget. */
    retargetError: null as unknown,
    // observations
    stepCards: [] as Array<{ conversationId: string; applicationId: string; step: number; needsReview?: string[] }>,
    checkoutCards: [] as Array<{ conversationId: string; applicationId: string; amountUsd: number }>,
    pickerCards: [] as Array<{ conversationId: string; applicationId: string; byAdmin?: boolean }>,
    retargets: [] as Array<{ conversationId: string; listingId: string }>,
    events: [] as Array<{ applicationId: string; actorType: string; event: string; metadata: any }>,
    stateWrites: [] as Array<{ messageId: string; state: string }>,
    seq: 0,
  },
}))

// ── The Supabase mock ─────────────────────────────────────────────────────────────
vi.mock('./db', () => {
  const matches = (row: Row, filters: Array<[string, string, any]>) =>
    filters.every(([op, key, value]) => {
      // `.is(key, null)` — SQL IS NULL. A row that never gained the column (undefined)
      // is as NULL as an explicit null, exactly like PostgREST reading a real table.
      if (op === 'is') return value === null ? row[key] === null || row[key] === undefined : row[key] === value
      return op === 'eq' ? row[key] === value : Array.isArray(value) && value.includes(row[key])
    })

  const from = (table: string) => {
    const q = {
      op: 'select' as 'select' | 'insert' | 'update',
      filters: [] as Array<[string, string, any]>,
      payload: null as any,
      orderBy: [] as Array<[string, boolean]>,
      limitN: null as number | null,
    }
    const run = () => {
      if (h.state.dbError) return { data: null, error: h.state.dbError }
      const rows = (h.state.tables[table] ||= [])
      if (q.op === 'insert') {
        for (const row of Array.isArray(q.payload) ? q.payload : [q.payload]) rows.push({ ...row })
        return { data: null, error: null }
      }
      let hit = rows.filter((row) => matches(row, q.filters))
      if (q.op === 'update') for (const row of hit) Object.assign(row, q.payload)
      // Applied in reverse so the FIRST .order() is the primary key (Postgres semantics).
      for (const [column, ascending] of [...q.orderBy].reverse()) {
        hit = [...hit].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1))
      }
      if (q.limitN !== null) hit = hit.slice(0, q.limitN)
      // COPIES, like the real client (which hands back deserialized JSON). Returning live
      // references would let a caller's own object mutate under it — and would have made
      // the CAS test below pass for the wrong reason.
      return { data: hit.map((row) => ({ ...row })), error: null }
    }
    const api: any = {
      select: () => api,
      eq: (key: string, value: unknown) => { q.filters.push(['eq', key, value]); return api },
      in: (key: string, value: unknown) => { q.filters.push(['in', key, value]); return api },
      is: (key: string, value: unknown) => { q.filters.push(['is', key, value]); return api },
      order: (column: string, opts?: { ascending?: boolean }) => { q.orderBy.push([column, opts?.ascending !== false]); return api },
      limit: (n: number) => { q.limitN = n; return api },
      insert: (payload: any) => { q.op = 'insert'; q.payload = payload; return api },
      update: (payload: any) => { q.op = 'update'; q.payload = payload; return api },
      maybeSingle: async () => {
        const { data, error } = run()
        return { data: Array.isArray(data) ? data[0] ?? null : data, error }
      },
      // Thenable, so `await supabase.from(…).select(…).eq(…)` resolves like the real client.
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    }
    return api
  }
  return {
    getVisaDb: () => ({ from }),
    visaTableMissing: (error: { code?: string } | null | undefined) =>
      !!error && ['42P01', 'PGRST205'].includes(error.code ?? ''),
  }
})

// ── The Prisma mock (Message reads + the fail-soft Conversation retarget) ──────────
vi.mock('../db', () => ({
  db: {
    message: {
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let rows = h.state.messages.filter((m) => m.conversationId === where.conversationId && m.kind === where.kind)
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt)
        return (take ? rows.slice(0, take) : rows).map((m) => ({ id: m.id, metaJson: m.metaJson }))
      }),
    },
    conversation: {
      // retargetVisaThreadListing's write. `retargetError` injects the P2002 collision.
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (h.state.retargetError) throw h.state.retargetError
        h.state.retargets.push({ conversationId: where.id, listingId: data.listingId })
        return { count: 1 }
      }),
    },
  },
}))

vi.mock('../messages', () => ({
  parseMessageMeta: (kind: string, metaJson: string | null) => {
    if (!metaJson || !['visa_step', 'visa_checkout', 'visa_picker'].includes(kind)) return null
    try { return JSON.parse(metaJson) } catch { return null }
  },
  setVisaStepState: vi.fn(async (_conversationId: string, messageId: string, state: string) => {
    const row = h.state.messages.find((m) => m.id === messageId)
    if (!row?.metaJson) return null
    const meta = { ...JSON.parse(row.metaJson), state }
    row.metaJson = JSON.stringify(meta)
    h.state.stateWrites.push({ messageId, state })
    return meta
  }),
  setVisaPickerState: vi.fn(async (_conversationId: string, messageId: string, state: string, selectedListingId?: string) => {
    const row = h.state.messages.find((m) => m.id === messageId)
    if (!row?.metaJson) return null
    const meta = { ...JSON.parse(row.metaJson), state, ...(selectedListingId ? { selectedListingId } : {}) }
    row.metaJson = JSON.stringify(meta)
    h.state.stateWrites.push({ messageId, state })
    return meta
  }),
}))

vi.mock('../visa-shop', () => ({
  getVisaShopSeller: async () => h.state.shop,
  getVisaShopListings: async () => h.state.listings,
  resolveVisaProduct: async (listingId: string) => h.state.products.find((p) => p.listingId === listingId) ?? null,
  visaPrefillForProduct: (product: { entryType: string | null }) =>
    product?.entryType ? { entryType: product.entryType, stayLengthDays: 90 } : null,
  findVisaGenericAnchor: async () => h.state.genericAnchor,
}))

vi.mock('./crypto', () => ({
  visaCryptoReady: () => h.state.cryptoReady,
  // The test's "ciphertext" is the JSON itself — this module's job is not to test crypto.
  encryptVisaPayload: (payload: unknown) => JSON.stringify(payload),
  decryptVisaPayload: (value: string) => {
    // Decryption happens on the READ, so this is exactly the window a racing writer lands
    // in — the row moves after we loaded it and before our CAS update runs.
    if (h.state.raceAfterLoad) {
      h.state.raceAfterLoad = false
      for (const row of h.state.tables.visa_applications || []) row.updated_at = '2026-07-03T00:00:00.000Z'
    }
    return JSON.parse(value)
  },
}))

vi.mock('./fx', () => ({ quoteVisaUsd: async () => h.state.quote }))
vi.mock('./payments', () => ({ visaPaymentsConfig: () => h.state.payments }))
vi.mock('./records', () => ({
  recordVisaEvent: vi.fn(async (applicationId: string, actorType: string, event: string, _ref?: string, metadata: any = {}) => {
    h.state.events.push({ applicationId, actorType, event, metadata })
    // The real recordVisaEvent writes the row this module later reads back (the picked
    // product), so the mock must too or the checkout path would be untestable.
    ;(h.state.tables.visa_events ||= []).push({
      id: `evt-${++h.state.seq}`, application_id: applicationId, actor_type: actorType, event,
      metadata, created_at: new Date(1_800_000_000_000 + h.state.seq * 1000).toISOString(),
    })
  }),
}))

vi.mock('./dm-thread', () => ({
  findVisaThread: vi.fn(async () => h.state.thread),
  getVisaThreadMode: vi.fn(async () => h.state.mode),
  bindVisaThread: vi.fn(async () => h.state.bindResult),
  sendVisaStepCard: vi.fn(async (input: any) => {
    // Mirrors the real gate (dm-thread.ts): the AUTOMATED flow is refused during a takeover,
    // but an explicit byAdmin re-send by the desk is not — the desk IS the human.
    if (h.state.mode === 'admin' && !input.byAdmin) return null
    h.state.stepCards.push(input)
    const id = `msg-step-${++h.state.seq}`
    h.state.messages.push({
      id, conversationId: input.conversationId, kind: 'visa_step', createdAt: h.state.seq,
      metaJson: JSON.stringify({
        v: 1, step: input.step, applicationId: input.applicationId, state: 'active',
        ...(input.needsReview?.length ? { needsReview: input.needsReview } : {}),
      }),
    })
    return { messageId: id }
  }),
  sendVisaCheckoutCard: vi.fn(async (input: any) => {
    if (!h.state.payments) return null
    h.state.checkoutCards.push(input)
    const id = `msg-pay-${++h.state.seq}`
    h.state.messages.push({
      id, conversationId: input.conversationId, kind: 'visa_checkout', createdAt: h.state.seq,
      metaJson: JSON.stringify({ v: 1, applicationId: input.applicationId, amountUsd: input.amountUsd, status: 'unpaid' }),
    })
    return { messageId: id }
  }),
  sendVisaPickerCard: vi.fn(async (input: any) => {
    // Same takeover gate as the step card (mirrors dm-thread.ts).
    if (h.state.mode === 'admin' && !input.byAdmin) return null
    h.state.pickerCards.push(input)
    const id = `msg-picker-${++h.state.seq}`
    h.state.messages.push({
      id, conversationId: input.conversationId, kind: 'visa_picker', createdAt: h.state.seq,
      metaJson: JSON.stringify({ v: 1, applicationId: input.applicationId, state: 'active' }),
    })
    return { messageId: id }
  }),
}))

const {
  advanceVisaDmFlow, applyVisaDmFieldEdit, canonicalVisaListingId, resendVisaDmCard,
  selectVisaDmProduct, startVisaDmFlow, visaDmStep2NeedsReview,
  VISA_DM_EXTRACTABLE_FIELDS, VISA_DM_PRODUCT_EVENT, VISA_DM_RESEND_EVENT,
} = await import('./dm-flow')
const { VISA_DM_STEP_FIELDS } = await import('./dm-steps')
const { emptyVisaPayload, visaEndDateFor90DayWindow, visaPayloadSchema } = await import('./schema')
const dmThread = await import('./dm-thread')

// ── Fixtures ──────────────────────────────────────────────────────────────────────

const APPLICATION = '11111111-2222-4333-8444-555555555555'
const BUYER = 'buyer-profile-1'
const START = '2026-09-01'

/** Every value validateVisaForReview demands. The DOB/passport values are obviously fake. */
function completePayload() {
  return visaPayloadSchema.parse({
    ...emptyVisaPayload('traveller@example.com'),
    surname: 'DOE', givenNames: 'JANE', dateOfBirth: '1990-01-01', sex: 'female',
    nationality: 'GBR', placeOfBirth: 'LONDON',
    passportNumber: '123456789', passportIssuingAuthority: 'HMPO',
    passportIssueDate: '2020-01-01', passportExpiryDate: '2030-01-01',
    visaValidFrom: START, visaValidTo: visaEndDateFor90DayWindow(START), intendedEntryDate: START,
    permanentAddress: '1 Test Street', phone: '+441234567890',
    emergencyName: 'JOHN DOE', emergencyRelationship: 'Brother', emergencyPhone: '+441234567891',
    occupation: 'Engineer', temporaryAddress: '2 Hanoi Street', temporaryProvince: 'Ha Noi',
  })
}

const PASSED_DOCUMENTS = [
  { id: 'doc-1', application_id: APPLICATION, kind: 'portrait', validation_status: 'passed', validation_report: {} },
  { id: 'doc-2', application_id: APPLICATION, kind: 'passport', validation_status: 'passed', validation_report: { mrzChecks: { composite: true } } },
]

function seedCase(opts: { payload?: unknown; documents?: Row[]; status?: string; userId?: string; paidAt?: string | null; checklist?: string[]; selected?: boolean } = {}) {
  // `selected` defaults TRUE and mirrors a post-backfill Phase-2 row: the canonical
  // selected_* columns are populated (matching listing-1) so the wizard's step tests run
  // past the step-0 selection gate. Pass `selected: false` for a genuinely product-less
  // case (the picker path), and use seedProductChoice() WITHOUT the columns to exercise
  // the legacy event-fallback read.
  const selected = opts.selected !== false
  h.state.tables.visa_applications = [{
    id: APPLICATION, user_id: opts.userId ?? BUYER, status: opts.status ?? 'draft',
    encrypted_payload: JSON.stringify(opts.payload ?? emptyVisaPayload('traveller@example.com')),
    checklist: opts.checklist ?? [], paid_at: opts.paidAt ?? null,
    selected_listing_id: selected ? 'listing-1' : null,
    selected_entry_type: selected ? 'single' : null,
    selected_speed: selected ? '1H' : null,
    selected_at: selected ? '2026-07-01T00:00:00.000Z' : null,
    created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-02T00:00:00.000Z',
  }]
  h.state.tables.visa_documents = opts.documents ?? []
}

/** Records the product choice the way startVisaDmFlow does, so checkout can resolve it. */
function seedProductChoice(listingId = 'listing-1') {
  ;(h.state.tables.visa_events ||= []).push({
    id: `evt-choice-${++h.state.seq}`, application_id: APPLICATION, actor_type: 'applicant',
    event: VISA_DM_PRODUCT_EVENT, metadata: { listingId },
    created_at: new Date(1_700_000_000_000 + h.state.seq * 1000).toISOString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.tables = {}
  h.state.dbError = null
  h.state.messages = []
  h.state.thread = { conversationId: 'convo-1', buyerProfileId: BUYER, sellerProfileId: 'shop-owner' }
  h.state.mode = 'ai'
  h.state.bindResult = { ok: true, conversationId: 'convo-1', created: false }
  h.state.shop = { id: 'seller-1', name: 'Eno Vietnam', ownerId: 'shop-owner' }
  h.state.listings = [{ id: 'listing-1', verified: true, status: 'active' }]
  h.state.products = [{ listingId: 'listing-1', title: 'e-Visa 1H', entryType: 'single', speed: '1H', priceVnd: 3_000_000, currency: 'VND', window: { acceptingNow: true } }]
  h.state.quote = { listingId: 'listing-1', priceVnd: 3_000_000, amountUsdCents: 11_489, vndPerUsd: 26_112, quotedAt: '2026-07-22T00:00:00.000Z', expiresAt: '2026-07-22T00:15:00.000Z' }
  h.state.payments = { providers: ['paypal'], feeCents: 100, currency: 'USD' }
  h.state.cryptoReady = true
  h.state.genericAnchor = { id: 'visa-generic' }
  h.state.retargetError = null
  h.state.stepCards = []
  h.state.checkoutCards = []
  h.state.pickerCards = []
  h.state.retargets = []
  h.state.events = []
  h.state.stateWrites = []
  h.state.seq = 0
})

// ── The partition is FROZEN at five ───────────────────────────────────────────────

describe('the five-page partition', () => {
  it('never emits a step outside 1..5', async () => {
    // Empty case → Documents. Documents passed but no answers → Confirm passport.
    seedCase()
    const first = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(first).toMatchObject({ ok: true, step: 1, complete: false })

    seedCase({ documents: PASSED_DOCUMENTS })
    h.state.messages = []
    const second = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(second).toMatchObject({ ok: true, step: 2, complete: false })

    for (const card of h.state.stepCards) expect(card.step).toBeGreaterThanOrEqual(1)
    for (const card of h.state.stepCards) expect(card.step).toBeLessThanOrEqual(5)
  })

  it('a complete case is step 5 — the pay card, not a sixth page', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, step: 5, complete: true })
    expect(h.state.stepCards).toHaveLength(0)
    expect(h.state.checkoutCards).toHaveLength(1)
  })
})

// ── IDEMPOTENCE ───────────────────────────────────────────────────────────────────

describe('advance is idempotent', () => {
  it('does not post a second identical step card', async () => {
    seedCase()
    const first = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const second = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const third = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })

    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(1)
    expect(h.state.messages.filter((m) => m.kind === 'visa_step')).toHaveLength(1)
    // …and the repeat calls hand back the SAME card, so the client re-renders rather than
    // losing track of the live one.
    expect(second).toMatchObject({ ok: true, step: 1, messageId: (first as any).messageId })
    expect(third).toMatchObject({ ok: true, messageId: (first as any).messageId })
  })

  it('asks again once the live card has been answered but the step is still incomplete', async () => {
    seedCase({ documents: PASSED_DOCUMENTS })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    // The applicant acknowledged the card without supplying the missing answers.
    const card = h.state.messages[0]
    card.metaJson = JSON.stringify({ ...JSON.parse(card.metaJson!), state: 'done' })

    const again = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(again).toMatchObject({ ok: true, step: 2 })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(2)
  })

  it('closes the cards the flow has moved past, and only those', async () => {
    seedCase()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })   // step 1 card
    const stepOneCard = h.state.messages[0].id
    // Documents now pass → the flow moves to step 2 and the step-1 card is history.
    h.state.tables.visa_documents = PASSED_DOCUMENTS
    h.state.messages[0].metaJson = JSON.stringify({ ...JSON.parse(h.state.messages[0].metaJson!), state: 'done' })
    h.state.messages[0].metaJson = JSON.stringify({ ...JSON.parse(h.state.messages[0].metaJson!), state: 'active' })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })

    expect(h.state.stateWrites).toContainEqual({ messageId: stepOneCard, state: 'done' })
    // The newly-emitted step-2 card is untouched.
    expect(h.state.stateWrites.filter((w) => w.messageId !== stepOneCard)).toHaveLength(0)
  })

  it('reuses an unpaid checkout card at the same amount, and supersedes one that drifted', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const reuse = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(dmThread.sendVisaCheckoutCard).toHaveBeenCalledTimes(1)
    expect(reuse).toMatchObject({ ok: true, step: 5, complete: true, messageId: h.state.messages[0].id })

    // The admin re-priced the listing (or FX moved): the buyer must see the NEW number.
    h.state.quote = { ...h.state.quote!, amountUsdCents: 12_000 }
    const reminted = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(dmThread.sendVisaCheckoutCard).toHaveBeenCalledTimes(2)
    expect((reminted as any).messageId).not.toBe(h.state.messages[0].id)
  })

  it('never mints a second pay card once the service is paid for', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS, paidAt: '2026-07-22T01:00:00.000Z' })
    seedProductChoice()
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, step: 5, complete: true, messageId: null })
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })
})

// ── RE-SEND IS THE OPPOSITE OF ADVANCE ────────────────────────────────────────────
//
// The chip's whole reason to exist is that the card scrolled out of reach, so "make sure it
// exists" is worthless here — it must PUT ONE AT THE BOTTOM. These tests are written to go
// red the moment resendVisaDmCard grows an "already asking that" shortcut of its own, and to
// go red just as loudly if it starts changing the case it is supposed to be re-showing.

const DESK = 'shop-owner'

describe('resend posts a card, every time', () => {
  it('POSTS A SECOND CARD for the step advance is already asking — and a third on the next tap', async () => {
    seedCase()
    const first = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    // Advance, asked twice, still refuses to duplicate. That is the property being preserved.
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(1)

    const resent = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(resent).toMatchObject({ ok: true, step: 1, kind: 'visa_step' })
    // ⚠️ THE ASSERTION THIS FILE EXISTS FOR: a re-send that quietly became idempotent would
    // hand back first.messageId and leave the count at 1.
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(2)
    expect(h.state.messages.filter((m) => m.kind === 'visa_step')).toHaveLength(2)
    expect((resent as any).messageId).not.toBe((first as any).messageId)

    const again = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(3)
    expect((again as any).messageId).not.toBe((resent as any).messageId)
  })

  it('makes the NEW card the newest one, and leaves the old copy exactly as it was', async () => {
    seedCase()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const original = h.state.messages[0]
    const originalMeta = original.metaJson

    const resent = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    const newest = [...h.state.messages].sort((a, b) => b.createdAt - a.createdAt)[0]
    // "Newest card wins" is the renderer's rule (visa-cards.tsx + liveVisaStepId), so the
    // re-sent card is the live one purely by ORDER — which only holds if it really is newest
    // and really is 'active'.
    expect(newest.id).toBe((resent as any).messageId)
    expect(JSON.parse(newest.metaJson!)).toMatchObject({ step: 1, applicationId: APPLICATION, state: 'active' })
    // …and nothing was flipped on the old one: no state write at all, so it becomes history
    // by position rather than by a 'done' that would be a lie about an unfinished step.
    expect(h.state.stateWrites).toHaveLength(0)
    expect(original.metaJson).toBe(originalMeta)
  })

  it('does not advance the case: no payload write, no step transition, no new answers', async () => {
    seedCase({ documents: PASSED_DOCUMENTS })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const before = { ...h.state.tables.visa_applications[0] }

    const resent = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(resent).toMatchObject({ ok: true, step: 2 })
    expect(h.state.tables.visa_applications[0]).toEqual(before)
    expect(h.state.events.filter((e) => e.event === 'dm_step_fields_saved')).toHaveLength(0)
  })

  it('leaves advance idempotent afterwards — the re-sent card is the one it reuses', async () => {
    seedCase()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    const resent = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })

    const after = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(after).toMatchObject({ ok: true, step: 1, messageId: (resent as any).messageId })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(2) // 1 advance + 1 resend, no third
  })

  it('records WHO asked for it, with names of nothing', async () => {
    seedCase()
    await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })
    await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    const events = h.state.events.filter((e) => e.event === VISA_DM_RESEND_EVENT)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ actorType: 'admin', metadata: { step: 1, kind: 'visa_step' } })
    expect(events[1]).toMatchObject({ actorType: 'applicant', metadata: { step: 1, kind: 'visa_step' } })
  })
})

describe('who may resend', () => {
  it('lets the DESK re-send into a thread whose case it does not own', async () => {
    // The visa desk is nobody's visa_applications.user_id — an ownership-scoped check would
    // lock out the exact actor the owner asked for.
    seedCase()
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })
    expect(result).toMatchObject({ ok: true, step: 1, kind: 'visa_step' })
    expect(h.state.stepCards).toHaveLength(1)
  })

  it('refuses a stranger, and writes nothing', async () => {
    seedCase()
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: 'someone-else' })
    expect(result).toMatchObject({ ok: false, error: 'not_a_participant', status: 403 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
    expect(h.state.events).toHaveLength(0)
  })

  it('refuses when the case has no thread to put a card in', async () => {
    seedCase()
    h.state.thread = null
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'no_thread', status: 404 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
  })

  it("refuses when the thread's seller is not the visa desk", async () => {
    seedCase()
    h.state.thread = { conversationId: 'convo-1', buyerProfileId: BUYER, sellerProfileId: 'some-other-seller' }
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'shop_unavailable', status: 503 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
  })

  it('refuses while the desk is unreachable', async () => {
    seedCase()
    h.state.shop = null
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'shop_unavailable', status: 503 })
  })
})

describe('resend and a human in the thread', () => {
  it('refuses a STEP card to the APPLICANT during an admin takeover', async () => {
    // From the applicant's seat the wizard is automation, and dm-thread will not author a
    // step card in 'admin' mode — a "successful" post would be an inert card with no controls.
    seedCase()
    h.state.mode = 'admin'
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'admin_takeover', status: 409, step: 1 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
    expect(h.state.events).toHaveLength(0)
  })

  it('LETS THE DESK re-send a step card during its own takeover', async () => {
    // The owner's ask was literally "admin can send visa application form from chip". The
    // invariant is "the AUTOMATED flow must not post over a human" — during a takeover the
    // desk IS that human, so refusing here disabled the feature for the only actor named.
    // byAdmin is what distinguishes the two, and it is set only after isDesk is proven.
    seedCase()
    h.state.mode = 'admin'
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })

    expect(result).toMatchObject({ ok: true, step: 1, kind: 'visa_step' })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledWith(expect.objectContaining({ byAdmin: true }))
  })

  it('never sets byAdmin on the AUTOMATED advance path', async () => {
    // The guarantee the exception must not erode: advance is the wizard, and the wizard may
    // never post over a human no matter who triggered the recompute.
    seedCase()
    h.state.mode = 'ai'
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    for (const call of vi.mocked(dmThread.sendVisaStepCard).mock.calls) {
      expect(call[0].byAdmin).toBeUndefined()
    }
  })

  it('still re-sends the PAY card during a takeover — the admin needs the applicant to pay', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    h.state.mode = 'admin'
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })
    expect(result).toMatchObject({ ok: true, step: 5, kind: 'visa_checkout' })
    expect(dmThread.sendVisaCheckoutCard).toHaveBeenCalledTimes(2)
  })
})

describe('resending the pay card cannot re-price it', () => {
  it('copies the amount off the live card instead of re-quoting', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(h.state.checkoutCards[0].amountUsd).toBe(114.89)

    // FX moves (or the desk re-prices the listing) between the two taps. advance would — and
    // should — supersede the card with the new number; a RE-SEND must not, because the chip's
    // job is to move the card the buyer is already looking at, not to renegotiate it.
    h.state.quote = { ...h.state.quote!, amountUsdCents: 20_000 }
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })
    expect(result).toMatchObject({ ok: true, step: 5, kind: 'visa_checkout' })
    expect(h.state.checkoutCards[1].amountUsd).toBe(114.89)
  })

  it('mints the FIRST pay card through the ordinary server price chain', async () => {
    // Nothing to copy and nothing agreed yet, so this is a first emission — and it fails
    // closed exactly like the loop does.
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: true, step: 5, kind: 'visa_checkout' })
    expect(h.state.checkoutCards[0].amountUsd).toBe(114.89)

    h.state.checkoutCards = []
    h.state.messages = []
    h.state.quote = null
    const refused = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(refused).toMatchObject({ ok: false, error: 'fx_unavailable', status: 503 })
    expect(h.state.checkoutCards).toHaveLength(0)
  })

  it('refuses once the service is paid for — there is nothing left to ask', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS, paidAt: '2026-07-22T01:00:00.000Z' })
    seedProductChoice()
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK })
    expect(result).toMatchObject({ ok: false, error: 'already_paid', status: 409 })
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })

  it('refuses a case that has left the applicant’s hands, and a cancelled one', async () => {
    seedCase({ status: 'under_review' })
    expect(await resendVisaDmCard({ applicationId: APPLICATION, actorId: DESK }))
      .toMatchObject({ ok: false, error: 'application_locked', status: 409 })
    seedCase({ status: 'cancelled' })
    expect(await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER }))
      .toMatchObject({ ok: false, error: 'application_cancelled', status: 409 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
  })

  it('refuses while payments are dormant instead of posting a card nobody can pay', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    h.state.payments = null
    const result = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'payments_not_configured', status: 503 })
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })
})

// ── ENTITLEMENT ───────────────────────────────────────────────────────────────────

describe('entitlement refusals', () => {
  it("refuses a case that is not the caller's, and writes nothing", async () => {
    seedCase({ userId: 'someone-else' })
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'not_found', status: 404 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
    expect(dmThread.findVisaThread).not.toHaveBeenCalled()
  })

  it("refuses when the bound thread belongs to another buyer", async () => {
    seedCase()
    h.state.thread = { conversationId: 'convo-9', buyerProfileId: 'other-buyer', sellerProfileId: 'shop-owner' }
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'thread_conflict', status: 409 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
  })

  it('refuses when no thread is bound to the case', async () => {
    seedCase()
    h.state.thread = null
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'thread_not_bound', status: 409 })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
  })

  it("refuses a field edit on somebody else's case", async () => {
    seedCase({ userId: 'someone-else' })
    const result = await applyVisaDmFieldEdit({ applicationId: APPLICATION, userId: BUYER, step: 3, fields: { occupation: 'Engineer' } })
    expect(result).toMatchObject({ ok: false, error: 'not_found', status: 404 })
    expect(h.state.tables.visa_applications[0].encrypted_payload).toContain('"occupation":""')
  })

  it('refuses a field the step does not own — including the admin/system-owned keys', async () => {
    seedCase()
    for (const key of ['adminMessage', 'governmentRegistrationCode', 'schemaVersion', 'passportNumber']) {
      const result = await applyVisaDmFieldEdit({ applicationId: APPLICATION, userId: BUYER, step: 3, fields: { [key]: 'x' } })
      expect(result).toMatchObject({ ok: false, error: 'field_not_in_step', status: 400 })
      expect((result as any).fields).toEqual([key])
    }
    // Nothing was written for any of them.
    expect(h.state.tables.visa_applications[0].updated_at).toBe('2026-07-02T00:00:00.000Z')
  })

  it('writes an allowed field through the ENCRYPTED payload and nowhere else', async () => {
    seedCase()
    const result = await applyVisaDmFieldEdit({ applicationId: APPLICATION, userId: BUYER, step: 3, fields: { occupation: 'Engineer', phone: '+441234567890' } })
    expect(result).toEqual({ ok: true })
    const row = h.state.tables.visa_applications[0]
    expect(JSON.parse(row.encrypted_payload).occupation).toBe('Engineer')
    // The value lives in the payload column only — no plaintext column gained it, and the
    // audit event carries FIELD NAMES.
    expect(Object.entries(row).filter(([key]) => key !== 'encrypted_payload').map(([, v]) => JSON.stringify(v)).join(' ')).not.toContain('Engineer')
    const saved = h.state.events.find((e) => e.event === 'dm_step_fields_saved')
    expect(saved!.metadata.fields).toEqual(['occupation', 'phone'])
    expect(JSON.stringify(saved!.metadata)).not.toContain('Engineer')
  })

  it('refuses a lost update rather than overwriting a racing save', async () => {
    seedCase()
    // A concurrent writer (the passport extraction merging its suggestions) lands between
    // our read and our write. The CAS is on the updated_at we loaded, so the update must
    // MISS — silently overwriting it would drop somebody's answer from a government form.
    h.state.raceAfterLoad = true
    const result = await applyVisaDmFieldEdit({ applicationId: APPLICATION, userId: BUYER, step: 3, fields: { occupation: 'Engineer' } })
    expect(result).toMatchObject({ ok: false, error: 'application_changed_retry', status: 409 })
    expect(JSON.parse(h.state.tables.visa_applications[0].encrypted_payload).occupation).toBe('')
  })

  it('refuses to edit a case the applicant no longer owns (under review)', async () => {
    seedCase({ status: 'under_review' })
    const result = await applyVisaDmFieldEdit({ applicationId: APPLICATION, userId: BUYER, step: 3, fields: { occupation: 'Engineer' } })
    expect(result).toMatchObject({ ok: false, error: 'application_locked', status: 409 })
  })
})

// ── ADMIN TAKEOVER ────────────────────────────────────────────────────────────────

describe('a human in the thread', () => {
  it('stops the wizard emitting anything while an admin has taken over', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    h.state.mode = 'admin'
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, messageId: null, complete: true })
    expect(dmThread.sendVisaStepCard).not.toHaveBeenCalled()
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })

  it('keeps guiding while the applicant is merely QUEUED for help', async () => {
    seedCase()
    h.state.mode = 'human_requested'
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, step: 1 })
    expect(dmThread.sendVisaStepCard).toHaveBeenCalledTimes(1)
  })
})

// ── AI GUIDANCE: NAMES, NEVER VALUES ──────────────────────────────────────────────

describe('the step-2 acknowledgement list', () => {
  it('every extractable field is a real payload key owned by step 2', () => {
    const shape = new Set(Object.keys(visaPayloadSchema.shape))
    const stepTwo = new Set(VISA_DM_STEP_FIELDS[2])
    for (const name of VISA_DM_EXTRACTABLE_FIELDS) {
      expect(shape.has(name)).toBe(true)
      expect(stepTwo.has(name)).toBe(true)
    }
  })

  it('carries FIELD NAMES only — no applicant value reaches the card', async () => {
    const payload = { ...emptyVisaPayload('traveller@example.com'), surname: 'DOE', givenNames: 'JANE', passportNumber: 'X1234567' }
    seedCase({ payload, documents: PASSED_DOCUMENTS })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })

    const card = h.state.stepCards[0]
    expect(card.step).toBe(2)
    expect(card.needsReview).toEqual(expect.arrayContaining(['surname', 'givenNames', 'passportNumber']))
    // The values are read to decide membership and thrown away.
    const serialized = JSON.stringify(h.state.messages)
    for (const value of ['DOE', 'JANE', 'X1234567', 'traveller@example.com']) expect(serialized).not.toContain(value)
  })

  it('claims nothing was read when no extraction has run', () => {
    const payload = { ...emptyVisaPayload('traveller@example.com'), surname: 'DOE' }
    const kase = {
      application: { id: APPLICATION, checklist: [] } as any,
      documents: [{ kind: 'passport', validation_report: {} }] as any,
      payload: payload as any,
    }
    expect(visaDmStep2NeedsReview(kase)).toEqual([])
    // …and the checklist marker alone is enough, even after a save cleared the doc report.
    // `passportType` rides along because visaPayloadSchema DEFAULTS it to 'ordinary' — a
    // field that always holds a value is still a field worth confirming (a diplomatic
    // passport holder has to correct exactly this one), so it is included on purpose.
    expect(visaDmStep2NeedsReview({ ...kase, application: { ...kase.application, checklist: ['ai_extraction_needs_review'] } }))
      .toEqual(['surname', 'passportType'])
  })
})

// ── MONEY: SERVER-RESOLVED OR NOTHING ─────────────────────────────────────────────

describe('the pay card fails closed', () => {
  it('charges the SERVER quote, never an input', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(h.state.checkoutCards[0].amountUsd).toBe(114.89)
  })

  it('refuses when FX is unavailable', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    h.state.quote = null
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'fx_unavailable', status: 503, step: 5, complete: true })
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })

  it('refuses while payments are dormant', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    h.state.payments = null
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'payments_not_configured', status: 503 })
    expect(dmThread.sendVisaCheckoutCard).not.toHaveBeenCalled()
  })

  it('a complete case with no product gets the PICKER, not a refusal (Phase 2)', async () => {
    // Pre-Phase-2 this was a 409 product_not_selected dead-end. Now the missing selection
    // is a step-0 state the applicant can fix in the thread — the pay card is simply
    // never reached until they do.
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS, selected: false })
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, picker: true, complete: false })
    expect(h.state.pickerCards).toHaveLength(1)
    expect(h.state.checkoutCards).toHaveLength(0)
  })

  it('refuses a product that left the catalogue mid-flow', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    seedProductChoice()
    h.state.products = []
    h.state.listings = [{ id: 'listing-1', verified: false, status: 'active' }]
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: false, error: 'product_not_for_sale', status: 409 })
  })
})

// ── STARTING THE FLOW ─────────────────────────────────────────────────────────────

describe('start', () => {
  it('reuses an editable draft, binds it, records the product and emits the first card', async () => {
    seedCase()
    const result = await startVisaDmFlow({ userId: BUYER, email: 'traveller@example.com', listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: true, applicationId: APPLICATION, conversationId: 'convo-1', step: 1 })
    expect(h.state.tables.visa_applications).toHaveLength(1)
    expect(dmThread.bindVisaThread).toHaveBeenCalledWith({ applicationId: APPLICATION, buyerProfileId: BUYER })
    const choice = h.state.events.find((e) => e.event === VISA_DM_PRODUCT_EVENT)
    expect(choice!.metadata.listingId).toBe('listing-1')
    expect(h.state.stepCards).toHaveLength(1)
  })

  it("prefills the entry type the picked product determines", async () => {
    seedCase()
    h.state.products = [{ ...h.state.products[0], entryType: 'multiple' }]
    await startVisaDmFlow({ userId: BUYER, email: 'traveller@example.com', listingId: 'listing-1' })
    expect(JSON.parse(h.state.tables.visa_applications[0].encrypted_payload).entryType).toBe('multiple')
  })

  it('creates a case when there is no draft, and honours the create quota', async () => {
    h.state.tables.visa_applications = []
    const denied = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => false })
    expect(denied).toMatchObject({ ok: false, error: 'rate_limited', status: 429 })
    expect(h.state.tables.visa_applications).toHaveLength(0)

    const created = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => true })
    expect(created).toMatchObject({ ok: true, step: 1 })
    expect(h.state.tables.visa_applications).toHaveLength(1)
    expect(h.state.tables.visa_applications[0].user_id).toBe(BUYER)
  })

  it('does not touch a case that is under review', async () => {
    seedCase({ status: 'under_review' })
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: true })
    // A NEW draft was minted; the locked case is untouched.
    expect(h.state.tables.visa_applications).toHaveLength(2)
    expect(h.state.tables.visa_applications[0].status).toBe('under_review')
  })

  it('refuses a listing that is not on the visa storefront', async () => {
    h.state.products = []
    h.state.listings = []
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-999' })
    expect(result).toMatchObject({ ok: false, error: 'listing_not_found', status: 404 })
    expect(dmThread.bindVisaThread).not.toHaveBeenCalled()
  })

  it('refuses a half-built product before creating anything', async () => {
    seedCase()
    h.state.products = [{ ...h.state.products[0], speed: null }]
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: false, error: 'product_not_configured', status: 409 })
    expect(dmThread.bindVisaThread).not.toHaveBeenCalled()
  })

  it('refuses when the visa desk has no storefront, before minting a case', async () => {
    h.state.tables.visa_applications = []
    h.state.shop = null
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: false, error: 'shop_unavailable', status: 503 })
    expect(h.state.tables.visa_applications).toHaveLength(0)
  })
})

// ── PHASE 2: THE STEP-0 PICKER ─────────────────────────────────────────────────────

describe('the step-0 picker', () => {
  it('a product-less case gets the picker, idempotently', async () => {
    seedCase({ selected: false })
    const first = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(first).toMatchObject({ ok: true, picker: true, complete: false })
    expect(h.state.pickerCards).toHaveLength(1)
    // Second advance REUSES the active picker — same messageId, no double-post.
    const second = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(second).toMatchObject({ ok: true, picker: true, messageId: (first as any).messageId })
    expect(h.state.pickerCards).toHaveLength(1)
    expect(h.state.stepCards).toHaveLength(0)
  })

  it('an admin takeover suppresses the picker like any wizard card', async () => {
    seedCase({ selected: false })
    h.state.mode = 'admin'
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, messageId: null })
    expect(h.state.pickerCards).toHaveLength(0)
  })

  it('a LEGACY event-only selection still counts (no picker, steps proceed)', async () => {
    seedCase({ selected: false })
    seedProductChoice()
    const result = await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER })
    expect(result).toMatchObject({ ok: true, step: 1 })
    expect((result as any).picker).toBeUndefined()
    expect(h.state.pickerCards).toHaveLength(0)
    expect(h.state.stepCards).toHaveLength(1)
  })

  it('canonicalVisaListingId: the column beats the event; the event is the fallback', async () => {
    seedCase()          // column says listing-1
    seedProductChoice('listing-2')  // newer event says listing-2
    expect(await canonicalVisaListingId(APPLICATION)).toBe('listing-1')
    h.state.tables.visa_applications[0].selected_listing_id = null
    expect(await canonicalVisaListingId(APPLICATION)).toBe('listing-2')
  })

  it('resend re-posts the picker for a product-less case, and the desk may do it during a takeover', async () => {
    seedCase({ selected: false })
    const applicant = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(applicant).toMatchObject({ ok: true, kind: 'visa_picker' })
    h.state.mode = 'admin'
    const refused = await resendVisaDmCard({ applicationId: APPLICATION, actorId: BUYER })
    expect(refused).toMatchObject({ ok: false, error: 'admin_takeover', status: 409 })
    const desk = await resendVisaDmCard({ applicationId: APPLICATION, actorId: 'shop-owner' })
    expect(desk).toMatchObject({ ok: true, kind: 'visa_picker' })
    expect(h.state.pickerCards.at(-1)).toMatchObject({ byAdmin: true })
  })
})

// ── PHASE 2: SELECTING THE PRODUCT IN THE THREAD ───────────────────────────────────

describe('selectVisaDmProduct', () => {
  it('writes the canonical columns + entryType prefill in ONE update, records the event, retargets and advances', async () => {
    seedCase({ selected: false })
    h.state.products = [{ ...h.state.products[0], entryType: 'multiple' }]
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: true, changed: true })
    const row = h.state.tables.visa_applications[0]
    expect(row.selected_listing_id).toBe('listing-1')
    expect(row.selected_entry_type).toBe('multiple')
    expect(row.selected_speed).toBe('1H')
    expect(row.selected_at).toBeTruthy()
    expect(JSON.parse(row.encrypted_payload).entryType).toBe('multiple')
    // Consent stamps nulled by the same write (selection change voids consent).
    expect(row.applicant_confirmed_at).toBeNull()
    expect(h.state.events.filter((e) => e.event === VISA_DM_PRODUCT_EVENT)).toHaveLength(1)
    expect(h.state.retargets).toEqual([{ conversationId: 'convo-1', listingId: 'listing-1' }])
    // The chained advance posted the next card (step 1 for an empty payload).
    expect((result as any).advance).toMatchObject({ ok: true, step: 1 })
    expect(h.state.stepCards).toHaveLength(1)
  })

  it('re-selecting the SAME product is a no-op write — no event, no consent reset — but follow-ups re-run', async () => {
    seedCase() // column already = listing-1 (entry single), payload entryType default 'single'
    const before = h.state.tables.visa_applications[0].updated_at
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: true, changed: false })
    expect(h.state.tables.visa_applications[0].updated_at).toBe(before)
    expect(h.state.events.filter((e) => e.event === VISA_DM_PRODUCT_EVENT)).toHaveLength(0)
    // Follow-ups still converge: the retarget re-ran (idempotent server-side).
    expect(h.state.retargets).toHaveLength(1)
  })

  it('a concurrent writer voids the CAS — application_changed_retry, nothing written', async () => {
    seedCase({ selected: false })
    h.state.raceAfterLoad = true
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: false, error: 'application_changed_retry', status: 409 })
    expect(h.state.tables.visa_applications[0].selected_listing_id).toBeNull()
  })

  it('refuses a paid case, a locked case and a cancelled case', async () => {
    seedCase({ selected: false, paidAt: '2026-07-20T00:00:00.000Z' })
    expect(await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' }))
      .toMatchObject({ ok: false, error: 'already_paid', status: 409 })
    seedCase({ selected: false, status: 'under_review' })
    expect(await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' }))
      .toMatchObject({ ok: false, error: 'application_locked', status: 409 })
    seedCase({ selected: false, status: 'cancelled' })
    expect(await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' }))
      .toMatchObject({ ok: false, error: 'application_cancelled', status: 409 })
  })

  it('refuses the hidden anchor and any unchargeable listing — the picker cannot buy the unbuyable', async () => {
    seedCase({ selected: false })
    h.state.listings = [...h.state.listings, { id: 'visa-generic', verified: true, status: 'hidden' }]
    expect(await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'visa-generic' }))
      .toMatchObject({ ok: false, error: 'product_not_for_sale', status: 409 })
    expect(h.state.tables.visa_applications[0].selected_listing_id).toBeNull()
  })

  it('a P2002 retarget collision is SKIPPED — the selection still lands', async () => {
    seedCase({ selected: false })
    h.state.retargetError = Object.assign(new Error('unique'), { code: 'P2002' })
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: true, changed: true })
    expect(h.state.tables.visa_applications[0].selected_listing_id).toBe('listing-1')
  })

  it('closes the active picker card once a product is chosen', async () => {
    seedCase({ selected: false })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER }) // posts the picker
    await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    const picker = h.state.messages.find((m) => m.kind === 'visa_picker')!
    expect(JSON.parse(picker.metaJson!)).toMatchObject({ state: 'done', selectedListingId: 'listing-1' })
  })

  it('changing product after an unpaid checkout card re-quotes: a new amount supersedes the card', async () => {
    seedCase({ payload: completePayload(), documents: PASSED_DOCUMENTS })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER }) // mints the pay card
    expect(h.state.checkoutCards).toHaveLength(1)
    h.state.products = [
      ...h.state.products,
      { listingId: 'listing-2', title: 'e-Visa 1D', entryType: 'single', speed: '1D', priceVnd: 1_000_000, currency: 'VND', window: { acceptingNow: true } },
    ]
    h.state.quote = { ...h.state.quote, listingId: 'listing-2', priceVnd: 1_000_000, amountUsdCents: 3_830 }
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-2' })
    expect(result).toMatchObject({ ok: true, changed: true })
    // The chained advance re-quoted and superseded the stale amount with a fresh card.
    expect(h.state.checkoutCards).toHaveLength(2)
    expect(h.state.checkoutCards.at(-1)!.amountUsd).toBeCloseTo(38.30)
    expect(h.state.tables.visa_applications[0].selected_listing_id).toBe('listing-2')
  })
})

// ── PHASE 2: THE GENERIC (PRODUCT-LESS) START ──────────────────────────────────────

describe('generic start', () => {
  it('creates a case with NO prefill and NO selection, binds to the anchor, and the first card is the picker', async () => {
    h.state.tables.visa_applications = []
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: true, conversationId: 'convo-1' })
    const row = h.state.tables.visa_applications[0]
    expect(row.selected_listing_id).toBeUndefined()
    expect(JSON.parse(row.encrypted_payload).entryType).toBe('single') // the schema default, not a prefill
    expect(dmThread.bindVisaThread).toHaveBeenCalledWith(
      expect.objectContaining({ anchorListingId: 'visa-generic' }),
    )
    expect(h.state.events.find((e) => e.event === VISA_DM_PRODUCT_EVENT)).toBeUndefined()
    expect(h.state.pickerCards).toHaveLength(1)
    expect(h.state.stepCards).toHaveLength(0)
  })

  it('an unseeded anchor falls back to the floor rather than blocking the applicant', async () => {
    h.state.tables.visa_applications = []
    h.state.genericAnchor = null
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: true })
    expect(dmThread.bindVisaThread).toHaveBeenCalledWith(
      expect.not.objectContaining({ anchorListingId: expect.anything() }),
    )
  })

  it('a generic start RESUMES an already-selected draft (no picker, no duplicate case)', async () => {
    seedCase()
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com' })
    expect(result).toMatchObject({ ok: true, applicationId: APPLICATION, step: 1 })
    expect(h.state.tables.visa_applications).toHaveLength(1)
    expect(h.state.pickerCards).toHaveLength(0)
    expect(h.state.stepCards).toHaveLength(1)
  })

  it('a NAMED-product start now dual-writes the canonical columns on create', async () => {
    h.state.tables.visa_applications = []
    await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => true })
    const row = h.state.tables.visa_applications[0]
    expect(row.selected_listing_id).toBe('listing-1')
    expect(row.selected_entry_type).toBe('single')
    expect(row.selected_speed).toBe('1H')
  })

  it('a paid-but-still-draft case is never "reused" by a fresh start', async () => {
    seedCase({ paidAt: '2026-07-20T00:00:00.000Z' })
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', listingId: 'listing-1', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: true })
    // A NEW case was minted; the paid one was left exactly as it was.
    expect(h.state.tables.visa_applications).toHaveLength(2)
    expect(h.state.tables.visa_applications[0].paid_at).toBe('2026-07-20T00:00:00.000Z')
  })
})

// ── PHASE 2: THE POST-REVIEW HARDENINGS (codex diff verdict, 2026-07-23) ───────────

describe('selection follow-up hardenings', () => {
  it('an advance that FAILS outright leaves the picker active and the selection intact', async () => {
    seedCase({ selected: false })
    await advanceVisaDmFlow({ applicationId: APPLICATION, userId: BUYER }) // posts the picker
    // Selection write succeeds; the chained advance then blows up on a dead thread.
    const thread = h.state.thread
    let first = true
    const { findVisaThread } = await import('./dm-thread')
    ;(findVisaThread as any).mockImplementation(async () => {
      if (first) { first = false; return thread } // the selection's own thread check
      return null                                  // the chained advance's check → thread_not_bound
    })
    const result = await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-1' })
    expect(result).toMatchObject({ ok: true, changed: true })
    expect((result as any).advance).toMatchObject({ ok: false })
    // The picker is STILL the live affordance — not closed over a failed advance.
    const picker = h.state.messages.find((m) => m.kind === 'visa_picker')!
    expect(JSON.parse(picker.metaJson!).state).toBe('active')
    ;(findVisaThread as any).mockImplementation(async () => h.state.thread)
  })

  it('a stale request converges the retarget to the CURRENT canonical, never backwards', async () => {
    seedCase() // canonical column = listing-1
    h.state.products = [
      ...h.state.products,
      { listingId: 'listing-2', title: 'e-Visa 1D', entryType: 'single', speed: '1D', priceVnd: 1_000_000, currency: 'VND', window: { acceptingNow: true } },
    ]
    // Request for listing-2 lands and the column now says listing-2. A LATE duplicate
    // request for listing-1-era state re-picks listing-2 idempotently; but even a re-POST
    // of listing-1 would first WRITE listing-1 canonically — so the stale-overwrite case
    // the review named is the no-op path: same-selection retry retargets to the RE-READ
    // canonical, which this asserts.
    await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-2' })
    expect(h.state.tables.visa_applications[0].selected_listing_id).toBe('listing-2')
    const retargets = h.state.retargets.map((r) => r.listingId)
    expect(retargets[retargets.length - 1]).toBe('listing-2')
    // The idempotent re-POST of the SAME selection retargets to canonical (listing-2).
    await selectVisaDmProduct({ applicationId: APPLICATION, userId: BUYER, listingId: 'listing-2' })
    expect(h.state.retargets[h.state.retargets.length - 1].listingId).toBe('listing-2')
  })
})

describe('generic start header honesty', () => {
  it('a REUSED thread serving a selection-less generic case is retargeted to the anchor', async () => {
    seedCase({ selected: false })
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com' })
    expect(result).toMatchObject({ ok: true })
    expect(h.state.retargets).toEqual([{ conversationId: 'convo-1', listingId: 'visa-generic' }])
  })

  it('a resumed case WITH a selection keeps its truthful product header (no retarget)', async () => {
    seedCase()
    await startVisaDmFlow({ userId: BUYER, email: 'a@b.com' })
    expect(h.state.retargets).toEqual([])
  })
})

// ── PROD INCIDENT 2026-07-23: forum-era rows under the previous encryption key ──────

describe('an unreadable draft never bricks the account', () => {
  it('start SKIPS a draft whose payload cannot be decrypted and mints a fresh case', async () => {
    seedCase({ selected: false })
    // Ciphertext from the previous key: the mock's decrypt (JSON.parse) throws on it,
    // exactly like AES-GCM's auth failure does in production.
    h.state.tables.visa_applications[0].encrypted_payload = '{not-decryptable'
    const result = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', allowCreate: async () => true })
    expect(result).toMatchObject({ ok: true })
    // A NEW case exists; the unreadable one was left exactly as it was for migration.
    expect(h.state.tables.visa_applications).toHaveLength(2)
    expect(h.state.tables.visa_applications[0].encrypted_payload).toBe('{not-decryptable')
  })

  it('the create-quota still applies to the fresh case (no free mints via poisoned drafts)', async () => {
    seedCase({ selected: false })
    h.state.tables.visa_applications[0].encrypted_payload = '{not-decryptable'
    const denied = await startVisaDmFlow({ userId: BUYER, email: 'a@b.com', allowCreate: async () => false })
    expect(denied).toMatchObject({ ok: false, error: 'rate_limited', status: 429 })
    expect(h.state.tables.visa_applications).toHaveLength(1)
  })
})
