import { beforeEach, describe, expect, it, vi } from 'vitest'

// The wizard flow. The properties worth pinning are mostly about what does NOT happen: no answers
// are stored, no second card is inserted per step, no generation is triggered, and the step cannot
// be moved by a request body.

const h = vi.hoisted(() => ({
  state: {
    profile: { id: 'traveller' } as { id: string } | null,
    desk: { id: 'desk-seller', ownerId: 'desk-owner', name: 'eno Vietnam' } as { id: string; ownerId: string; name: string } | null,
    convo: null as Record<string, unknown> | null,
    // The seeded trip anchor. The fixture convo is about listing 'L', so the default makes an
    // ordinary desk thread eligible; tests that point the thread elsewhere prove the gate bites.
    anchorListingId: 'L' as string | null,
    itineraries: {} as Record<string, { id: string; profileId: string }>,
    // The newest trip_step message row, as the DB would hand it back.
    card: null as { id: string; metaJson: string | null } | null,
    cardWhere: null as unknown,
    inserted: [] as Array<{ kind: string; meta: unknown; preview: string; senderId: string }>,
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    insertThrows: false,
    // Fires between activeWizardCard's read and writeCardMeta's update: the real race window.
    mutateBeforeWrite: null as (() => void) | null,
    // The KV slot that serialises `start`. Modelled rather than stubbed, because the property
    // under test IS its NX semantics.
    kv: new Map<string, unknown>(),
    kvThrows: false,
    // Awaited INSIDE insertMessage, i.e. inside the start section, so a second start can be fired
    // against a first one that is provably still holding the slot.
    onInsert: null as null | (() => Promise<void>),
    // Resolved the first time a start claims the slot.
    onClaim: null as null | (() => void),
    // Resolved when a start LOSES the slot — the only sync point that proves a second racer has
    // reached the mutex and been turned away.
    onSlotLost: null as null | (() => void),
  },
}))

vi.mock('../admin', () => ({ getCurrentProfile: async () => h.state.profile }))
vi.mock('./dm-thread', () => ({
  getTripDesk: async () => h.state.desk,
  getTripAssistanceListingId: async () => h.state.anchorListingId,
}))
vi.mock('../messages', async (orig) => ({
  ...(await orig<typeof import('../messages')>()),
  insertMessage: async (_convo: unknown, senderId: string, _text: string, opts: any) => {
    if (h.state.onInsert) await h.state.onInsert()
    if (h.state.insertThrows) throw new Error('trip_card_author_forbidden')
    h.state.inserted.push({ kind: opts.kind, meta: opts.meta, preview: opts.preview, senderId })
    // A real insert makes the row VISIBLE to the next reader — which is the whole reason the
    // loser of a start race can resolve to the winner's card instead of inserting a second one.
    const row = { id: 'card-new', metaJson: JSON.stringify(opts.meta) }
    h.state.card = row
    return row
  },
}))
vi.mock('../ratelimit', () => ({
  kv: {
    set: async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (h.state.kvThrows) throw new Error('kv unreachable')
      if (opts?.nx && h.state.kv.has(key)) { h.state.onSlotLost?.(); return null }
      h.state.kv.set(key, value)
      h.state.onClaim?.()
      return 'OK'
    },
    get: async (key: string) => {
      if (h.state.kvThrows) throw new Error('kv unreachable')
      return h.state.kv.get(key) ?? null
    },
    del: async (key: string) => { h.state.kv.delete(key) },
  },
}))
vi.mock('../db', () => ({
  db: {
    conversation: { findUnique: async () => h.state.convo },
    itinerary: { findUnique: async (args: any) => h.state.itineraries[args.where.id] ?? null },
    message: {
      findFirst: async (args: any) => { h.state.cardWhere = args.where; return h.state.card },
      updateMany: async (args: any) => {
        if (h.state.mutateBeforeWrite) { h.state.mutateBeforeWrite(); h.state.mutateBeforeWrite = null }
        h.state.updates.push({ where: args.where, data: args.data })
        if (!h.state.card || args.where.id !== h.state.card.id) return { count: 0 }
        if (args.where.kind && args.where.kind !== 'trip_step') return { count: 0 }
        // Honour the compare-and-set predicate the way Postgres would.
        if (args.where.metaJson !== undefined && args.where.metaJson !== h.state.card.metaJson) return { count: 0 }
        h.state.card = { ...h.state.card, metaJson: args.data.metaJson }
        return { count: 1 }
      },
    },
  },
}))

import { advanceTripWizard, completeTripWizard, startTripWizard, tripWizardEligibility } from './wizard-flow'

const CONVO = 'convo-1'
const cardAt = (step: number, state: 'active' | 'done' = 'active', extra: Record<string, unknown> = {}) =>
  ({ id: 'card-1', metaJson: JSON.stringify({ v: 1, step, state, ...extra }) })

const answers: Record<number, Record<string, unknown>> = {
  1: { cityIds: ['hanoi'], cityDays: [], days: 7 },
  2: { startDate: '2030-01-01', travelers: 2 },
  3: { budgetId: 'comfort', pace: 'balanced' },
  4: { accommodation: 'hotel', interests: ['food'] },
  5: { flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false }, origin: '', notes: '' },
}

beforeEach(() => {
  h.state.profile = { id: 'traveller' }
  h.state.desk = { id: 'desk-seller', ownerId: 'desk-owner', name: 'eno Vietnam' }
  h.state.convo = { id: CONVO, buyerProfileId: 'traveller', sellerProfileId: 'desk-owner', listingId: 'L', visaApplicationId: null }
  h.state.anchorListingId = 'L'
  h.state.itineraries = { 'itin-1': { id: 'itin-1', profileId: 'traveller' } }
  h.state.card = null
  h.state.cardWhere = null
  h.state.inserted = []
  h.state.updates = []
  h.state.insertThrows = false
  h.state.mutateBeforeWrite = null
  h.state.kv = new Map()
  h.state.kvThrows = false
  h.state.onInsert = null
  h.state.onClaim = null
  h.state.onSlotLost = null
})

describe('who may drive the wizard', () => {
  it('refuses a signed-out caller', async () => {
    h.state.profile = null
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('refuses somebody who is not the thread’s traveller', async () => {
    h.state.convo = { ...h.state.convo, buyerProfileId: 'another-traveller' }
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'forbidden' })
  })

  it('answers the SAME for a missing thread and someone else’s — no existence oracle', async () => {
    h.state.convo = null
    const missing = await startTripWizard({ conversationId: 'no-such-thread' })
    h.state.convo = { id: CONVO, buyerProfileId: 'another-traveller', sellerProfileId: 'desk-owner', listingId: 'L', visaApplicationId: null }
    const theirs = await startTripWizard({ conversationId: CONVO })
    expect(missing).toEqual({ ok: false, error: 'forbidden' })
    expect(missing).toEqual(theirs)
  })

  it('reports the desk unavailable rather than posting an unauthored card', async () => {
    h.state.desk = null
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'desk_unavailable' })
    expect(h.state.inserted).toHaveLength(0)
  })

  it('refuses a thread the CURRENT desk does not answer', async () => {
    h.state.convo = { ...h.state.convo, sellerProfileId: 'former-desk-owner' }
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'desk_unavailable' })
  })
})

describe('starting is idempotent under CONCURRENCY, not only under a double tap', () => {
  // `start` was read-then-insert: check for a live card, then insert one. A second tap re-reads
  // and resumes, so it always looked idempotent — but two genuinely concurrent starts (a second
  // tab, a retried request) both read "no card" and both insert, and the thread ends up with two
  // live wizard cards. The reader picks the newest, so the state does not split; what the
  // traveller sees is a duplicate bubble whose step counter appears to run backwards.

  /**
   * Hold a start inside its section, fire a second one against it, then let the first finish.
   *
   * ⚠️ THE PARK POINT IS THE INSERT, NOT THE CLAIM. An earlier version of this helper waited for
   * the slot to be claimed and then cleared the hook — but there is an `await` between the claim
   * and the insert, so the first start sailed past an already-cleared hook, inserted, and the
   * second start simply resumed its card. The test passed against the UNFIXED code, which a
   * mutation run caught. Parking the first call inside insertMessage is what makes the overlap
   * real: while it is parked the slot is provably held and no card exists yet.
   */
  async function twoConcurrentStarts() {
    let release: () => void = () => {}
    let parked: () => void = () => {}
    let contested: () => void = () => {}
    const inserting = new Promise<void>((resolve) => { release = resolve })
    const firstParked = new Promise<void>((resolve) => { parked = resolve })
    const slotContested = new Promise<void>((resolve) => { contested = resolve })
    let inserts = 0
    h.state.onInsert = () => {
      inserts += 1
      if (inserts > 1) return Promise.resolve()   // a second insert must never be blocked FOR us
      parked()
      return inserting
    }
    h.state.onSlotLost = contested

    const first = startTripWizard({ conversationId: CONVO })
    await firstParked            // first is inside insertMessage: slot held, no card yet
    const second = startTripWizard({ conversationId: CONVO })
    await slotContested          // second has REACHED the mutex and been turned away
    release()                    // only now may the winner finish
    return Promise.all([first, second])
  }

  it('⚠️ TWO CONCURRENT STARTS INSERT EXACTLY ONE CARD', async () => {
    const [first, second] = await twoConcurrentStarts()
    expect({ inserts: h.state.inserted.length, first, second }).toEqual({
      inserts: 1,
      first: { ok: true, step: 1, messageId: 'card-new' },
      // The loser resolves to the WINNER's card — the same answer a double tap gets. Refusing
      // would be correct-but-useless: the traveller tapped a button and deserves a wizard.
      second: { ok: true, step: 1, messageId: 'card-new' },
    })
  })

  it('releases the slot, so the next start is not locked out', async () => {
    await startTripWizard({ conversationId: CONVO })
    expect(h.state.kv.size).toBe(0)
  })

  it('⚠️ RELEASE IS OWNERSHIP-CHECKED — a late finisher cannot free somebody else s slot', async () => {
    // Both external reviewers raised this independently: if a start ever outlived its TTL, the
    // next one would hold the key, and an unconditional delete would release ITS section.
    h.state.onInsert = async () => { h.state.kv.set(`trip-wizard-start:${CONVO}`, 'a-newer-token') }
    await startTripWizard({ conversationId: CONVO })
    expect(h.state.kv.get(`trip-wizard-start:${CONVO}`)).toBe('a-newer-token')
  })

  it('FAILS OPEN when the KV backend is down — a traveller can still open the wizard', async () => {
    h.state.kvThrows = true
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: true, step: 1, messageId: 'card-new' })
    expect(h.state.inserted).toHaveLength(1)
  })

  it('does not claim a slot at all when a wizard is already running', async () => {
    // The common case by far. It must stay a single read: no slot, no contention, no waiting.
    h.state.card = cardAt(3, 'active')
    const result = await startTripWizard({ conversationId: CONVO })
    expect({ result, slots: h.state.kv.size, inserts: h.state.inserted.length })
      .toEqual({ result: { ok: true, step: 3, messageId: 'card-1' }, slots: 0, inserts: 0 })
  })
})

describe('starting', () => {
  it('inserts ONE card at step 1, authored by the desk', async () => {
    const result = await startTripWizard({ conversationId: CONVO })
    expect(result).toEqual({ ok: true, step: 1, messageId: 'card-new' })
    expect(h.state.inserted).toHaveLength(1)
    // Rule: the author is the resolved desk, never the caller.
    expect(h.state.inserted[0].senderId).toBe('desk-owner')
    expect(h.state.inserted[0].kind).toBe('trip_step')
    expect(h.state.inserted[0].meta).toEqual({ v: 1, step: 1, state: 'active' })
  })

  it('looks the card up by the LITERAL kind — Message.kind defaults to text', async () => {
    await startTripWizard({ conversationId: CONVO })
    expect(h.state.cardWhere).toMatchObject({ conversationId: CONVO, kind: 'trip_step' })
  })

  it('RESUMES instead of restarting — a double tap must not discard answered steps', async () => {
    h.state.card = cardAt(3)
    const result = await startTripWizard({ conversationId: CONVO })
    expect(result).toEqual({ ok: true, step: 3, messageId: 'card-1' })
    expect(h.state.inserted).toHaveLength(0)
  })

  it('starts a fresh wizard when the previous one is done', async () => {
    h.state.card = cardAt(5, 'done', { itineraryId: 'itin-1' })
    const result = await startTripWizard({ conversationId: CONVO })
    expect(result).toEqual({ ok: true, step: 1, messageId: 'card-new' })
  })

  it('reports a refused card write rather than throwing', async () => {
    h.state.insertThrows = true
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'update_failed' })
  })
})

describe('advancing', () => {
  it('UPDATES the live card instead of inserting a second one', async () => {
    // Five inserts would mean five unread bumps and five rewrites of lastMessageText in the
    // traveller's own open thread.
    h.state.card = cardAt(1)
    const result = await advanceTripWizard({ conversationId: CONVO, step: 1, answers: answers[1] })
    expect(result).toEqual({ ok: true, step: 2, messageId: 'card-1' })
    expect(h.state.inserted).toHaveLength(0)
    expect(h.state.updates).toHaveLength(1)
    expect(JSON.parse(h.state.updates[0].data.metaJson as string)).toEqual({ v: 1, step: 2, state: 'active' })
  })

  it('walks 1 → 5 and then stops, because the last step is answered by GENERATING', async () => {
    const seen: Array<number | null> = []
    for (const step of [1, 2, 3, 4, 5]) {
      h.state.card = cardAt(step)
      const result = await advanceTripWizard({ conversationId: CONVO, step, answers: answers[step] })
      seen.push(result.ok ? result.step : -1)
    }
    expect(seen).toEqual([2, 3, 4, 5, 5])
  })

  it('STORES NO ANSWERS — the card only ever holds a step and a state', async () => {
    h.state.card = cardAt(5)
    await advanceTripWizard({
      conversationId: CONVO, step: 5,
      answers: { ...answers[5], notes: 'honeymoon, wheelchair access', origin: 'Da Nang' },
    })
    const written = JSON.stringify(h.state.updates.map((u) => u.data))
    expect(written).not.toContain('honeymoon')
    expect(written).not.toContain('Da Nang')
  })

  it('REFUSES a step two or more behind the live card', async () => {
    h.state.card = cardAt(3)
    expect(await advanceTripWizard({ conversationId: CONVO, step: 1, answers: answers[1] }))
      .toEqual({ ok: false, error: 'step_mismatch' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('is IDEMPOTENT for a retry of the advance that already landed', async () => {
    // A flaky network or a double tap re-sends the previous step. Answering 409 there made the
    // client recover by hand for something that had actually succeeded (Gemini).
    h.state.card = cardAt(3)
    const result = await advanceTripWizard({ conversationId: CONVO, step: 2, answers: answers[2] })
    expect(result).toEqual({ ok: true, step: 3, messageId: 'card-1' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('REFUSES a jump forward — the body cannot move the step', async () => {
    h.state.card = cardAt(1)
    expect(await advanceTripWizard({ conversationId: CONVO, step: 5, answers: answers[5] }))
      .toEqual({ ok: false, error: 'step_mismatch' })
  })

  it('REFUSES answers that fail the step’s own schema', async () => {
    h.state.card = cardAt(1)
    // Allocations exceeding the trip length — the cross-field rule step 1 owns.
    const bad = { cityIds: ['hanoi', 'hoian'], cityDays: [{ cityId: 'hanoi', days: 9 }], days: 3 }
    expect(await advanceTripWizard({ conversationId: CONVO, step: 1, answers: bad }))
      .toEqual({ ok: false, error: 'invalid_answers' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('REFUSES an unknown field smuggled into the answers', async () => {
    h.state.card = cardAt(2)
    expect(await advanceTripWizard({ conversationId: CONVO, step: 2, answers: { ...answers[2], feeVnd: 1 } }))
      .toEqual({ ok: false, error: 'invalid_answers' })
  })

  it('REFUSES when no wizard is running', async () => {
    expect(await advanceTripWizard({ conversationId: CONVO, step: 1, answers: answers[1] }))
      .toEqual({ ok: false, error: 'no_active_wizard' })
  })

  it('REFUSES when the wizard is already done', async () => {
    h.state.card = cardAt(5, 'done')
    expect(await advanceTripWizard({ conversationId: CONVO, step: 5, answers: answers[5] }))
      .toEqual({ ok: false, error: 'no_active_wizard' })
  })
})

describe('completing', () => {
  it('closes the card against the itinerary the traveller owns', async () => {
    h.state.card = cardAt(5)
    const result = await completeTripWizard({ conversationId: CONVO, itineraryId: 'itin-1' })
    expect(result).toEqual({ ok: true, step: null, messageId: 'card-1' })
    expect(JSON.parse(h.state.updates[0].data.metaJson as string)).toEqual({ v: 1, step: 5, state: 'done', itineraryId: 'itin-1' })
  })

  it('REFUSES an itinerary belonging to somebody else', async () => {
    // Without this the closing card would link one traveller's thread to another's trip.
    h.state.card = cardAt(5)
    h.state.itineraries['itin-theirs'] = { id: 'itin-theirs', profileId: 'another-traveller' }
    expect(await completeTripWizard({ conversationId: CONVO, itineraryId: 'itin-theirs' }))
      .toEqual({ ok: false, error: 'itinerary_not_found' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('answers the same for a missing itinerary as for someone else’s', async () => {
    h.state.card = cardAt(5)
    h.state.itineraries['itin-theirs'] = { id: 'itin-theirs', profileId: 'another-traveller' }
    const missing = await completeTripWizard({ conversationId: CONVO, itineraryId: 'nope' })
    const theirs = await completeTripWizard({ conversationId: CONVO, itineraryId: 'itin-theirs' })
    expect(missing).toEqual(theirs)
  })

  it('scopes the write by kind, so a mistargeted id cannot blank an ordinary message', async () => {
    h.state.card = cardAt(5)
    await completeTripWizard({ conversationId: CONVO, itineraryId: 'itin-1' })
    expect(h.state.updates[0].where).toMatchObject({ id: 'card-1', kind: 'trip_step' })
  })
})

describe('the card update is a COMPARE-AND-SET', () => {
  // codex refuted the claim that updating in place was safe: matching on id alone let a STALE
  // advance overwrite a card that had since been completed, resetting state:'done' to 'active' and
  // dropping the itineraryId — the traveller's finished plan losing the link to itself.

  it('carries the exact prior blob in the WHERE', async () => {
    h.state.card = cardAt(2)
    const before = h.state.card.metaJson
    await advanceTripWizard({ conversationId: CONVO, step: 2, answers: answers[2] })
    expect(h.state.updates[0].where).toEqual({ id: 'card-1', kind: 'trip_step', metaJson: before })
  })

  it('REFUSES a write whose card was completed IN THE RACE WINDOW', async () => {
    // The window the active-state check cannot close: an advance reads the card as active, a
    // concurrent complete commits, and only THEN does the advance write. Without the
    // compare-and-set that write lands and resets state:'done' to 'active', dropping the
    // itineraryId — the traveller's finished plan losing the link to itself.
    h.state.card = cardAt(4)
    h.state.mutateBeforeWrite = () => {
      h.state.card = cardAt(5, 'done', { itineraryId: 'itin-1' })
    }
    const result = await advanceTripWizard({ conversationId: CONVO, step: 4, answers: answers[4] })
    expect(result).toEqual({ ok: false, error: 'case_changed_reload' })
    // The completion survived intact.
    expect(JSON.parse(h.state.card!.metaJson!)).toMatchObject({ state: 'done', itineraryId: 'itin-1' })
  })

  it('REFUSES completing a card that is already done', async () => {
    h.state.card = cardAt(5, 'done', { itineraryId: 'itin-1' })
    expect(await completeTripWizard({ conversationId: CONVO, itineraryId: 'itin-1' }))
      .toEqual({ ok: false, error: 'no_active_wizard' })
    expect(h.state.updates).toHaveLength(0)
  })
})

describe('eligibility — the entry point the feature would be unreachable without', () => {
  it('is eligible with no wizard running, so the chip is offered', async () => {
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: true, step: null })
  })

  it('reports the running step, so the chip hides rather than offering a restart', async () => {
    h.state.card = cardAt(3)
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: true, step: 3 })
  })

  it('treats a FINISHED wizard as startable again', async () => {
    h.state.card = cardAt(5, 'done', { itineraryId: 'itin-1' })
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: true, step: null })
  })

  it('is NOT eligible in an ordinary seller thread — the chip never appears there', async () => {
    h.state.convo = { ...h.state.convo, sellerProfileId: 'some-other-seller' }
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: false, step: null })
  })

  it('leaks nothing: someone else’s thread and a missing one answer identically', async () => {
    h.state.convo = { ...h.state.convo, buyerProfileId: 'another-traveller' }
    const theirs = await tripWizardEligibility({ conversationId: CONVO })
    h.state.convo = null
    const missing = await tripWizardEligibility({ conversationId: 'nope' })
    expect(theirs).toEqual({ eligible: false, step: null })
    expect(theirs).toEqual(missing)
  })

  it('is not eligible when the desk is unavailable', async () => {
    h.state.desk = null
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: false, step: null })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The thread must be about the TRIP ANCHOR, not merely answered by the desk.
//
// ⚠️ THIS IS A REGRESSION FENCE FOR A SHIP BLOCKER. The trip desk and the e-Visa shop are the
// SAME Seller — Seller.ownerId is @unique, so one Profile cannot own two storefronts — and that
// seller has 15 active listings, 14 of them visa products. While eligibility gated on the desk
// alone, every e-Visa thread offered the trip wizard and `start` would author a trip card into
// one. Both entry points are pinned, because a chip that hides while the route stays open is the
// same bug with extra steps.
describe('the wizard is confined to the trip listing', () => {
  it('a desk thread about a DIFFERENT listing (e.g. an e-Visa product) cannot start one', async () => {
    h.state.convo = { ...h.state.convo!, listingId: 'visa-product-7' }
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'desk_unavailable' })
    expect(h.state.inserted).toHaveLength(0)
  })

  it('and is not offered one — the launcher asks the same question the route answers', async () => {
    h.state.convo = { ...h.state.convo!, listingId: 'visa-product-7' }
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: false, step: null })
  })

  it('the anchor thread is still eligible, so the gate is not simply off', async () => {
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: true, step: null })
    expect((await startTripWizard({ conversationId: CONVO })).ok).toBe(true)
    expect(h.state.inserted).toHaveLength(1)
  })

  it('fails CLOSED when the anchor listing is not seeded', async () => {
    h.state.anchorListingId = null
    expect(await startTripWizard({ conversationId: CONVO })).toEqual({ ok: false, error: 'desk_unavailable' })
    expect(await tripWizardEligibility({ conversationId: CONVO })).toEqual({ eligible: false, step: null })
  })
})
