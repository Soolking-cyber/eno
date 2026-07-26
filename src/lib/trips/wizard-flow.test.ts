import { beforeEach, describe, expect, it, vi } from 'vitest'

// The wizard flow. The properties worth pinning are mostly about what does NOT happen: no answers
// are stored, no second card is inserted per step, no generation is triggered, and the step cannot
// be moved by a request body.

const h = vi.hoisted(() => ({
  state: {
    profile: { id: 'traveller' } as { id: string } | null,
    desk: { id: 'desk-seller', ownerId: 'desk-owner', name: 'eno Vietnam' } as { id: string; ownerId: string; name: string } | null,
    convo: null as Record<string, unknown> | null,
    itineraries: {} as Record<string, { id: string; profileId: string }>,
    // The newest trip_step message row, as the DB would hand it back.
    card: null as { id: string; metaJson: string | null } | null,
    cardWhere: null as unknown,
    inserted: [] as Array<{ kind: string; meta: unknown; preview: string; senderId: string }>,
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    insertThrows: false,
    // Fires between activeWizardCard's read and writeCardMeta's update: the real race window.
    mutateBeforeWrite: null as (() => void) | null,
  },
}))

vi.mock('../admin', () => ({ getCurrentProfile: async () => h.state.profile }))
vi.mock('./dm-thread', () => ({ getTripDesk: async () => h.state.desk }))
vi.mock('../messages', async (orig) => ({
  ...(await orig<typeof import('../messages')>()),
  insertMessage: async (_convo: unknown, senderId: string, _text: string, opts: any) => {
    if (h.state.insertThrows) throw new Error('trip_card_author_forbidden')
    h.state.inserted.push({ kind: opts.kind, meta: opts.meta, preview: opts.preview, senderId })
    return { id: 'card-new' }
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
  h.state.itineraries = { 'itin-1': { id: 'itin-1', profileId: 'traveller' } }
  h.state.card = null
  h.state.cardWhere = null
  h.state.inserted = []
  h.state.updates = []
  h.state.insertThrows = false
  h.state.mutateBeforeWrite = null
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
