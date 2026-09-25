import { describe, expect, it, vi } from 'vitest'
import {
  SUPPORT_SELLER_ID, getOrCreateListinglessThread, getOrCreateSupportThread,
  type ListinglessThreadDb, type SupportThreadDb,
} from './support-thread'

/**
 * The three behaviours worth pinning: reuse, open, and the double-tap race. Each assertion below
 * was checked RED first by inverting the branch it covers — a test that cannot fail is worse than
 * no test, and this file exists because the race is the one path no manual click will reproduce.
 */

type Call = { where?: unknown; data?: unknown }

const P2002 = Object.assign(new Error('unique constraint'), { code: 'P2002' })

function stubDb(opts: {
  findResults: ({ id: string } | null)[]
  createImpl?: () => Promise<{ id: string }>
}) {
  const finds: Call[] = []
  const creates: Call[] = []
  let i = 0
  const db: SupportThreadDb = {
    conversation: {
      findFirst: async (args) => {
        finds.push({ where: args.where })
        return opts.findResults[Math.min(i++, opts.findResults.length - 1)] ?? null
      },
      create: async (args) => {
        creates.push({ data: args.data })
        if (opts.createImpl) return opts.createImpl()
        return { id: 'new-thread' }
      },
    },
  }
  return { db, finds, creates }
}

describe('getOrCreateSupportThread', () => {
  it('reuses the existing thread and does not create a second one', async () => {
    const { db, creates } = stubDb({ findResults: [{ id: 'existing' }] })
    expect(await getOrCreateSupportThread(db, 'buyer-1')).toEqual({ id: 'existing', created: false })
    expect(creates).toHaveLength(0)
  })

  it('opens a thread when none exists', async () => {
    const { db, creates } = stubDb({ findResults: [null] })
    expect(await getOrCreateSupportThread(db, 'buyer-1')).toEqual({ id: 'new-thread', created: true })
    expect(creates).toHaveLength(1)
  })

  /**
   * ⛔ THE ONLY PATH THAT MATTERS AND THE ONLY ONE A HUMAN CANNOT CLICK. Two taps race, the second
   * create is rejected by the partial unique index, and the loser must return the WINNER's thread
   * rather than 500. Without the P2002 branch this test throws.
   */
  it('returns the winner thread when a concurrent tap lost the create', async () => {
    const { db, finds } = stubDb({
      findResults: [null, { id: 'winner' }],
      createImpl: async () => { throw P2002 },
    })
    expect(await getOrCreateSupportThread(db, 'buyer-1')).toEqual({ id: 'winner', created: false })
    expect(finds).toHaveLength(2) // the initial miss, then the post-race refetch
  })

  it('rethrows a P2002 whose refetch still finds nothing, rather than inventing a thread', async () => {
    const { db } = stubDb({ findResults: [null, null], createImpl: async () => { throw P2002 } })
    await expect(getOrCreateSupportThread(db, 'buyer-1')).rejects.toThrow('unique constraint')
  })

  it('rethrows a non-P2002 error untouched', async () => {
    const { db } = stubDb({ findResults: [null], createImpl: async () => { throw new Error('db down') } })
    await expect(getOrCreateSupportThread(db, 'buyer-1')).rejects.toThrow('db down')
  })

  /**
   * ⚠️ listingId: null IS THE THREAD'S IDENTITY, asserted on both the lookup and the insert. If a
   * future edit dropped it from the `where`, this function would happily reuse an ordinary LISTING
   * conversation with the support seller as the person's support thread.
   */
  it('keys both the lookup and the insert on a null listing and the edition support seller', async () => {
    const { db, finds, creates } = stubDb({ findResults: [null] })
    await getOrCreateSupportThread(db, 'buyer-9')
    expect(finds[0].where).toEqual({ buyerProfileId: 'buyer-9', sellerId: SUPPORT_SELLER_ID, listingId: null })
    expect(creates[0].data).toEqual({ buyerProfileId: 'buyer-9', sellerId: SUPPORT_SELLER_ID, listingId: null })
  })

  /**
   * ⛔ THE EDITION SPLIT, PINNED. eno.vn and eno.forum share one database, so if both editions
   * resolved to the same seller row a forum support thread — where visa and PayPal are legitimate
   * subjects — would appear in the licensed marketplace's inbox.
   */
  it('names an edition-specific support seller', () => {
    expect(['eno-support-desk', 'eno-support-desk-forum']).toContain(SUPPORT_SELLER_ID)
  })
})

/**
 * THE GENERALISED HELPER — the rental availability check's thread. Same identity and the same race
 * as the support thread; the new behaviour is `sellerProfileId`: written on create, and RE-POINTED
 * on reuse when the operator has changed, so a thread never ends up answering to nobody.
 */
describe('getOrCreateListinglessThread', () => {
  const KEY = { buyerProfileId: 'buyer-1', sellerId: 'eno-rental-desk', sellerProfileId: 'operator-1' }

  function stubListingless(opts: {
    findResults: ({ id: string; sellerProfileId: string | null } | null)[]
    createImpl?: () => Promise<{ id: string }>
  }) {
    const finds: Call[] = []
    const creates: Call[] = []
    const updates: Call[] = []
    let i = 0
    const db: ListinglessThreadDb = {
      conversation: {
        findFirst: async (args) => {
          finds.push({ where: args.where })
          return opts.findResults[Math.min(i++, opts.findResults.length - 1)] ?? null
        },
        create: async (args) => {
          creates.push({ data: args.data })
          if (opts.createImpl) return opts.createImpl()
          return { id: 'new-thread' }
        },
        updateMany: async (args) => {
          updates.push({ where: args.where, data: args.data })
          return { count: 1 }
        },
      },
    }
    return { db, finds, creates, updates }
  }

  it('opens the thread with the operator as sellerProfileId and a null listing', async () => {
    const { db, finds, creates, updates } = stubListingless({ findResults: [null] })
    expect(await getOrCreateListinglessThread(db, KEY)).toEqual({ id: 'new-thread', created: true })
    expect(finds[0].where).toEqual({ buyerProfileId: 'buyer-1', sellerId: 'eno-rental-desk', listingId: null })
    expect(creates[0].data).toEqual({ buyerProfileId: 'buyer-1', sellerId: 'eno-rental-desk', listingId: null, sellerProfileId: 'operator-1' })
    expect(updates).toHaveLength(0)
  })

  it('reuses an existing thread and leaves it alone when the operator is unchanged', async () => {
    const { db, creates, updates } = stubListingless({ findResults: [{ id: 'existing', sellerProfileId: 'operator-1' }] })
    expect(await getOrCreateListinglessThread(db, KEY)).toEqual({ id: 'existing', created: false })
    expect(creates).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('RE-POINTS an existing thread to the current operator, guarded on the thread identity', async () => {
    const { db, updates } = stubListingless({ findResults: [{ id: 'existing', sellerProfileId: 'old-operator' }] })
    await getOrCreateListinglessThread(db, KEY)
    expect(updates).toEqual([{
      where: { id: 'existing', buyerProfileId: 'buyer-1', sellerId: 'eno-rental-desk', listingId: null },
      data: { sellerProfileId: 'operator-1' },
    }])
  })

  it('re-points a thread whose sellerProfileId was null', async () => {
    const { db, updates } = stubListingless({ findResults: [{ id: 'existing', sellerProfileId: null }] })
    await getOrCreateListinglessThread(db, KEY)
    expect(updates).toHaveLength(1)
  })

  it('returns the winner when a concurrent submit lost the create, and re-points it if needed', async () => {
    const { db, finds, updates } = stubListingless({
      findResults: [null, { id: 'winner', sellerProfileId: 'old-operator' }],
      createImpl: async () => { throw P2002 },
    })
    expect(await getOrCreateListinglessThread(db, KEY)).toEqual({ id: 'winner', created: false })
    expect(finds).toHaveLength(2)
    expect(updates).toHaveLength(1)
  })

  it('rethrows a P2002 whose refetch misses, and any other error untouched', async () => {
    const a = stubListingless({ findResults: [null, null], createImpl: async () => { throw P2002 } })
    await expect(getOrCreateListinglessThread(a.db, KEY)).rejects.toThrow('unique constraint')
    const b = stubListingless({ findResults: [null], createImpl: async () => { throw new Error('db down') } })
    await expect(getOrCreateListinglessThread(b.db, KEY)).rejects.toThrow('db down')
  })
})

/**
 * ⛔ THE SUPPORT THREAD MUST NOT PICK UP THE NEW BEHAVIOUR. Its desk is unowned on purpose and its
 * `sellerProfileId` stays null (support-thread.ts explains why); if the shared find/create path ever
 * started writing a sellerProfileId or re-pointing, the admin-only support desk would acquire an
 * owner by accident.
 */
describe('getOrCreateSupportThread after the generalisation', () => {
  it('still writes exactly buyer, desk and a null listing — no sellerProfileId', async () => {
    const { db, creates } = stubDb({ findResults: [null] })
    await getOrCreateSupportThread(db, 'buyer-2')
    expect(creates[0].data).toEqual({ buyerProfileId: 'buyer-2', sellerId: SUPPORT_SELLER_ID, listingId: null })
    expect(Object.keys(creates[0].data as object)).not.toContain('sellerProfileId')
  })

  it('never calls an update on reuse', async () => {
    const updateMany = vi.fn()
    const { db } = stubDb({ findResults: [{ id: 'existing' }] })
    ;(db.conversation as unknown as { updateMany: typeof updateMany }).updateMany = updateMany
    await getOrCreateSupportThread(db, 'buyer-2')
    expect(updateMany).not.toHaveBeenCalled()
  })
})
