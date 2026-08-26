import { describe, expect, it, vi } from 'vitest'
import { SUPPORT_SELLER_ID, getOrCreateSupportThread, type SupportThreadDb } from './support-thread'

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
