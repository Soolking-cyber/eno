import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ACCEPTING AND DECLINING AN OFFER — the money path, untested until 2026-08-05.
 *
 * ⚠️ WHY THIS ONE. `actOnOffer` is where a price becomes an agreement. Its header comments name
 * two guarantees, and each is one line of code that a refactor could drop without any other test
 * in the suite noticing:
 *   · "Only the OTHER party can accept/decline — never your own offer." A seller who could accept
 *     their own offer sets the price unilaterally and the buyer sees an accepted deal they never
 *     agreed to.
 *   · The atomic claim. The status transition is a conditional `updateMany` on `offerStatus:
 *     'pending'`, and `count === 0` means a concurrent request already won. Without it a
 *     double-click emits TWO confirmation lines, TWO bell notifications and TWO pushes for one
 *     offer — the TOCTOU the comment calls out by name.
 *
 * ⚠️ THE FAKE db ENFORCES THE CLAIM, IT DOES NOT JUST RECORD IT. That is the same decision
 * `api/conversations/route.test.ts` made and for the same reason: a mock that only counts calls
 * would let the double-accept assertion pass against code with the guard deleted, because the
 * second call would still "succeed" against a mock with no state. Here `message.updateMany` flips
 * the row and returns `{ count: 0 }` on any later attempt, exactly as Postgres does.
 *
 * `insertMessage` is NOT mocked — it lives in this same module, so mocking it would replace
 * `actOnOffer` too. It runs for real against the fake db, which is the better test anyway: the
 * confirmation line that reaches the timeline is the thing the buyer actually sees.
 */

type Row = Record<string, any>

const CONVO = { id: 'convo-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', listingId: 'listing-1' }
const OFFER_ID = 'msg-offer-1'

const h = vi.hoisted(() => ({
  /** The offer row, with a real `offerStatus` the fake db transitions. */
  offer: null as Row | null,
  messagesCreated: [] as Row[],
  notifications: [] as Row[],
  pushes: [] as Row[],
  notifyThrows: false,
  /** When true, every findFirst is served the same pre-write snapshot (READ COMMITTED). */
  interleave: false,
  snapshot: null as Row | null,
}))

vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (profileId: string, payload: Row) => { h.pushes.push({ profileId, ...payload }) },
}))

vi.mock('@/lib/db', () => ({
  db: {
    message: {
      findFirst: async ({ where }: Row) => {
        // ⚠️ IN RACE MODE EVERY READER SEES THE SAME PRE-WRITE SNAPSHOT, WHICH IS WHAT POSTGRES
        // DOES. Under READ COMMITTED two concurrent requests can both SELECT the row while it is
        // still pending, and only then does one of them win the UPDATE. That gap is the entire
        // reason `claim.count === 0` exists, and it is the only state in which the guard is
        // load-bearing — sequentially, the `offerStatus: 'pending'` predicate below rejects the
        // second attempt first.
        //
        // Proven by mutation, twice. Deleting the claim guard left all tests green when this mock
        // simply re-read live state, and STILL left them green when it merely yielded on a timer
        // (the two timers fire in separate macrotasks, so the first caller finishes before the
        // second reads). Serving a frozen snapshot is what finally reproduces the race.
        const src = h.interleave ? (h.snapshot ||= { ...h.offer }) : h.offer
        const o = src
        if (!o) return null
        // Model the real predicate: id + conversation + kind + STILL pending.
        if (where.id !== o.id) return null
        if (where.conversationId !== CONVO.id) return null
        if (where.kind !== 'offer') return null
        if (where.offerStatus && o.offerStatus !== where.offerStatus) return null
        return { id: o.id, senderProfileId: o.senderProfileId, offerAmount: o.offerAmount }
      },
      // ⚠️ THE CONDITIONAL UPDATE, MODELLED. Returns count 0 once the row has left 'pending',
      // which is what makes the double-accept case a real test rather than a call count.
      updateMany: async ({ where, data }: Row) => {
        const o = h.offer
        if (!o || o.id !== where.id) return { count: 0 }
        if (where.offerStatus && o.offerStatus !== where.offerStatus) return { count: 0 }
        Object.assign(o, data)
        return { count: 1 }
      },
      create: async ({ data }: Row) => {
        const row = { id: `msg-${h.messagesCreated.length + 1}`, createdAt: new Date(), metaJson: null, ...data }
        h.messagesCreated.push(row)
        return row
      },
    },
    conversation: { update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    profile: { findUnique: async () => ({ displayName: 'Buyer Bob', email: 'bob@example.test' }) },
    notification: {
      create: async ({ data }: Row) => {
        if (h.notifyThrows) throw new Error('notification table down')
        h.notifications.push(data)
        return data
      },
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}))

const { actOnOffer } = await import('@/lib/messages')

/** A pending offer authored by the SELLER, so the buyer is the one entitled to act on it. */
function pendingOfferFromSeller(overrides: Row = {}): Row {
  return { id: OFFER_ID, senderProfileId: 'seller-1', offerAmount: 5_000_000, offerStatus: 'pending', ...overrides }
}

beforeEach(() => {
  h.offer = pendingOfferFromSeller()
  h.messagesCreated = []
  h.notifications = []
  h.pushes = []
  h.notifyThrows = false
  h.interleave = false
  h.snapshot = null
})

describe('only the other party can act on an offer', () => {
  it('the RECIPIENT can accept', async () => {
    const ok = await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    expect(ok).toBe(true)
    expect(h.offer!.offerStatus).toBe('accepted')
  })

  it('the AUTHOR cannot accept their own offer', async () => {
    // The money invariant. A seller accepting their own offer sets the price with no counterparty.
    const ok = await actOnOffer(CONVO, 'seller-1', OFFER_ID, 'accept')
    expect(ok).toBe(false)
    expect(h.offer!.offerStatus).toBe('pending') // untouched
    expect(h.messagesCreated).toEqual([]) // and no confirmation line was emitted
    expect(h.notifications).toEqual([])
  })

  it('the AUTHOR cannot decline their own offer either', async () => {
    const ok = await actOnOffer(CONVO, 'seller-1', OFFER_ID, 'decline')
    expect(ok).toBe(false)
    expect(h.offer!.offerStatus).toBe('pending')
  })
})

describe('an offer can only be acted on once — the TOCTOU guard', () => {
  it('two CONCURRENT accepts: one wins, and only one of everything is emitted', async () => {
    // ⚠️ THE ONLY CASE THAT EXERCISES `claim.count === 0`. Both callers read the offer while it is
    // still pending — the real double-click — and then race to transition it. Sequentially the
    // `offerStatus: 'pending'` read predicate would stop the second one first, which is why the
    // earlier version of this test passed against code with the claim deleted.
    h.interleave = true
    const [first, second] = await Promise.all([
      actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept'),
      actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept'),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1) // exactly one winner
    expect(h.messagesCreated).toHaveLength(1)
    expect(h.notifications).toHaveLength(1)
    expect(h.pushes).toHaveLength(1)
  })

  it('a sequential second accept is rejected by the read predicate', async () => {
    // The other half, kept separate so the two mechanisms are not confused for one another.
    const first = await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    const second = await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(h.messagesCreated).toHaveLength(1)
  })

  it('an accept cannot be followed by a decline', async () => {
    await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    const flipped = await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'decline')
    expect(flipped).toBe(false)
    expect(h.offer!.offerStatus).toBe('accepted') // the outcome does not flip after the fact
  })

  it.each(['accepted', 'declined', 'countered'])('an already-%s offer is not actionable', async (status) => {
    h.offer = pendingOfferFromSeller({ offerStatus: status })
    expect(await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')).toBe(false)
    expect(h.messagesCreated).toEqual([])
  })
})

describe('what the parties actually see', () => {
  it('the confirmation line is BILINGUAL and carries the amount', async () => {
    // ⚠️ THIS STRING IS PERSISTED into Message.body and the push, so it cannot be tr()'d at render
    // time — the reason it is a bilingual composite is recorded at messages.ts:917 as an i18n audit
    // finding. An "improvement" to an English-only string would be a regression on a money surface.
    await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    const body = h.messagesCreated[0].body as string
    expect(body).toContain('Đã chấp nhận') // vi
    expect(body).toContain('Offer accepted') // en
    expect(body).toMatch(/5[.,]000[.,]000/) // and the money, formatted
  })

  it('a decline says declined, in both languages', async () => {
    await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'decline')
    const body = h.messagesCreated[0].body as string
    expect(body).toContain('Đã từ chối')
    expect(body).toContain('Offer declined')
  })

  it('the OFFERER is the one notified, not the actor', async () => {
    await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    expect(h.notifications[0]).toMatchObject({ recipientId: 'seller-1', type: 'offer' })
    expect(h.pushes[0]).toMatchObject({ profileId: 'seller-1' })
  })
})

describe('the notification is best-effort, the transition is not', () => {
  it('a notification failure still leaves the offer accepted and returns true', async () => {
    // messages.ts:932 swallows this deliberately: the offer HAS been accepted in the database, so
    // reporting failure to the caller would be a lie that invites a retry — and a retry would now
    // lose the atomic claim and report failure again. Pinned so the try/catch is not "cleaned up".
    h.notifyThrows = true
    const ok = await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    expect(ok).toBe(true)
    expect(h.offer!.offerStatus).toBe('accepted')
    expect(h.messagesCreated).toHaveLength(1) // the timeline line still landed
    expect(h.notifications).toEqual([]) // only the bell was lost
  })
})
