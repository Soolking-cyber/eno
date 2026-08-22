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
  /** Per-offer READ COMMITTED snapshots, so a thread with two pending offers is representable. */
  snapshots: {} as Record<string, Row>,
  /** One mutex PER LOCK KEY, standing in for pg_advisory_xact_lock. */
  locks: {} as Record<string, Promise<void>>,
  /**
   * ⚠️ OTHER offers in the same conversation. The mock held exactly ONE message until 2026-08-06,
   * which made the state the `already accepted` guard exists for literally unrepresentable — and so
   * the first two tests for it passed against code with the guard deleted. Both external reviewers
   * caught that independently.
   */
  otherOffers: [] as Row[],
}))

vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (profileId: string, payload: Row) => { h.pushes.push({ profileId, ...payload }) },
}))

vi.mock('@/lib/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbMock: any = {
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
        // ⛔ ADDRESSABLE BY ID ACROSS THE WHOLE THREAD, not just the one target. The
        // double-spend this guard exists for is TWO DIFFERENT pending offers being
        // accepted at once, and while findFirst resolved only h.offer that state was
        // unrepresentable — the same shape of gap this file already records for
        // `count` on 2026-08-06. Mutation-tested: with the lookup narrowed back to
        // h.offer, the two-offer race test cannot even be written.
        const pool = [h.offer, ...h.otherOffers].filter(Boolean) as Row[]
        const live = pool.find((x) => x.id === where.id) ?? null
        if (!live) return null
        // Under READ COMMITTED every concurrent reader sees the same pre-write snapshot.
        const o = h.interleave ? ((h.snapshots[live.id] ||= { ...live }) as Row) : live
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
        const o = [h.offer, ...h.otherOffers].filter(Boolean).find((x) => (x as Row).id === where.id) as Row | undefined
        if (!o || o.id !== where.id) return { count: 0 }
        if (where.offerStatus && o.offerStatus !== where.offerStatus) return { count: 0 }
        Object.assign(o, data)
        return { count: 1 }
      },
      /**
       * ⚠️ ADDED WHEN `actOnOffer` GREW A SECOND GUARD (a7021b91, owner): accepting is refused if the
       * conversation ALREADY has an accepted offer, because a thread can be retargeted to a
       * different listing and a stale pending card would otherwise sell the wrong item. Modelled
       * against live state rather than the read snapshot, since the real query is its own statement.
       */
      count: async ({ where }: Row) => {
        if (where.conversationId !== CONVO.id || where.kind !== 'offer') return 0
        // Counts across EVERY offer in the thread, target included — which is the only way a
        // "some OTHER offer is already accepted" state can exist at all.
        return [h.offer, ...h.otherOffers].filter((o) => o && o.offerStatus === where.offerStatus).length
      },
      create: async ({ data }: Row) => {
        const row = { id: `msg-${h.messagesCreated.length + 1}`, createdAt: new Date(), metaJson: null, ...data }
        h.messagesCreated.push(row)
        return row
      },
    },
    /**
     * ⛔ THE ADVISORY LOCK, MODELLED AS A LOCK — not stubbed away.
     *
     * actOnOffer wraps the accept check and the claim in db.$transaction with
     * pg_advisory_xact_lock(hashtext(`offer-accept:<convoId>`)). Making $transaction
     * merely `fn(db)` would let both concurrent accepts run interleaved and the test
     * would pass while proving nothing — the failure mode this whole file exists to
     * avoid (see the mutation notes on findFirst).
     *
     * So it serialises: a second caller waits for the first to settle, exactly as a
     * second transaction waits on the advisory lock. And callbacks read LIVE state
     * rather than the frozen race snapshot, because by the time the lock is granted
     * the previous transaction has committed. That combination is what makes
     * "two CONCURRENT accepts" a real assertion.
     */
    $transaction: async (arg: unknown) => {
      // ⚠️ Prisma's $transaction has TWO shapes and this file uses both: messages.ts
      // batches promises elsewhere ($transaction([...])), while actOnOffer takes the
      // interactive callback. The array form needs no lock — it is a batch, not a
      // critical section — so only the callback form serialises.
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[])
      const fn = arg as (tx: unknown) => Promise<unknown>
      // ⛔ THE TRANSACTION ALONE MUST NOT SERIALISE — THE LOCK MUST.
      // A first version of this mock took the mutex here, and that made the lock line
      // in actOnOffer dead weight: deleting `pg_advisory_xact_lock` left the
      // concurrent test green, so it proved the wrapper and not the fix. Under READ
      // COMMITTED a bare transaction does NOT serialise two accepts, so neither does
      // this. $executeRaw below is what blocks — mutation-tested by deleting the lock
      // line and confirming the concurrent test goes red.
      // ⚠️ dbMock, NOT `await import('@/lib/db')` — inside this factory that import
      // resolves the REAL PrismaClient and the test dies on 'Database does not exist'.
      const db = dbMock
      let release: null | (() => void) = null
      const setRelease = (r: () => void) => { release = r }
      const tx = {
        ...db,
        // ⚠️ KEYED, like the real thing. A single global chain would serialise every
        // conversation against every other, so a wrong or missing lock key would still
        // pass — the mock would be asserting "some lock was taken" rather than "the
        // right one". Prisma passes the tagged template as (strings, ...values), so the
        // interpolated lockKey arrives in values[0].
        $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          const key = String(values[0] ?? 'unkeyed')
          const prev = h.locks[key] ?? Promise.resolve()
          h.locks[key] = new Promise<void>((r) => { setRelease(r) })
          await prev
          // Once the lock is granted the previous holder has committed, so reads see
          // live state rather than the frozen READ COMMITTED snapshot.
          h.interleave = false
          return 1
        },
      }
      try { return await fn(tx) } finally { (release as null | (() => void))?.() }
    },
    $executeRaw: async () => 1,
    conversation: { update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    profile: { findUnique: async () => ({ displayName: 'Buyer Bob', email: 'bob@example.test' }) },
    notification: {
      /**
       * ⚠️ ADDED WHEN `actOnOffer` GREW A SECOND GUARD (a7021b91, owner): accepting is refused if the
       * conversation ALREADY has an accepted offer, because a thread can be retargeted to a
       * different listing and a stale pending card would otherwise sell the wrong item. Modelled
       * against live state rather than the read snapshot, since the real query is its own statement.
       */
      count: async ({ where }: Row) => {
        if (where.conversationId !== CONVO.id || where.kind !== 'offer') return 0
        // Counts across EVERY offer in the thread, target included — which is the only way a
        // "some OTHER offer is already accepted" state can exist at all.
        return [h.offer, ...h.otherOffers].filter((o) => o && o.offerStatus === where.offerStatus).length
      },
      create: async ({ data }: Row) => {
        if (h.notifyThrows) throw new Error('notification table down')
        h.notifications.push(data)
        return data
      },
    },
  }
  return { db: dbMock }
})

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
  h.otherOffers = []
  h.snapshots = {}
  h.locks = {}
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

  it('⛔ TWO DIFFERENT pending offers accepted at once: only one is accepted', async () => {
    // THE DOUBLE-SPEND. The single-offer race above is already stopped by the
    // pending-guarded claim, so it passes with or without the lock — mutation-tested,
    // and that is why this second test exists. Here two DISTINCT pending offers in one
    // thread are accepted simultaneously: both read `already === 0` under READ
    // COMMITTED, both claim a row that is genuinely still pending, and the thread ends
    // up with two accepted offers at DIFFERENT PRICES with nothing recording which
    // deal is real — plus the seller's transaction count inflated twice.
    // pg_advisory_xact_lock on the conversation is what makes the second one lose.
    h.otherOffers = [{ id: 'msg-offer-2', senderProfileId: 'seller-1', offerAmount: 999, offerStatus: 'pending' }]
    h.interleave = true

    const [a, b] = await Promise.all([
      actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept'),
      actOnOffer(CONVO, 'buyer-1', 'msg-offer-2', 'accept'),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
    const accepted = [h.offer, ...h.otherOffers].filter((o) => o && o.offerStatus === 'accepted')
    expect(accepted).toHaveLength(1)
    // and exactly one of everything downstream
    expect(h.messagesCreated).toHaveLength(1)
    expect(h.notifications).toHaveLength(1)
  })

  it('the lock is keyed on the CONVERSATION — a different thread is not blocked by it', async () => {
    // Guards the key, not just the presence of a lock. If lockKey were a constant, or
    // keyed on something coarser, unrelated conversations would serialise against each
    // other under load — a correctness-preserving change that quietly becomes a
    // throughput bug nobody traces back to here.
    h.otherOffers = [{ id: 'msg-offer-2', senderProfileId: 'seller-1', offerAmount: 999, offerStatus: 'pending' }]
    await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')
    // Two distinct keys must have been taken across the two conversations we touched.
    expect(Object.keys(h.locks)).toEqual([`offer-accept:${CONVO.id}`])
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

describe('one accepted offer per conversation (owner, a7021b91)', () => {
  it('a STILL-PENDING offer is refused when a DIFFERENT one in the thread was already accepted', async () => {
    // ⚠️ THE TARGET MUST BE PENDING, OR THIS TEST PROVES NOTHING. A first version set the target
    // itself to 'accepted', which the read predicate one describe-block up (offerStatus: 'pending')
    // already rejects — so it passed with the guard deleted. Both reviewers caught it.
    //
    // The real state: a conversation's listing is MUTABLE (retargetForListing follows the buyer to
    // whatever they ask about next), so an old pending card can outlive the listing it was made on.
    // Accepting it after another offer already closed the thread sells the CURRENT listing at the
    // OLD price.
    h.offer = pendingOfferFromSeller()
    h.otherOffers = [{ id: 'msg-offer-earlier', senderProfileId: 'seller-1', offerAmount: 1, offerStatus: 'accepted' }]

    expect(await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'accept')).toBe(false)
    expect(h.offer!.offerStatus).toBe('pending') // untouched
    expect(h.messagesCreated).toEqual([])
    expect(h.notifications).toEqual([])
  })

  it('but DECLINING that same pending card is still allowed, so it can be cleared', async () => {
    // The asymmetry is deliberate and is the half a blanket "thread is closed" check would break:
    // a stale pending card must always be dismissable, or it sits in the thread for ever.
    h.offer = pendingOfferFromSeller()
    h.otherOffers = [{ id: 'msg-offer-earlier', senderProfileId: 'seller-1', offerAmount: 1, offerStatus: 'accepted' }]
    expect(await actOnOffer(CONVO, 'buyer-1', OFFER_ID, 'decline')).toBe(true)
    expect(h.offer!.offerStatus).toBe('declined')
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
