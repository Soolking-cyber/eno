import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The partner shops' unread chats (src/lib/partner-inbox.ts) — owner, 2026-11-12: "Counter only, no reading".
 * A fake database records what was asked for, so the tests can prove what is counted and what is never read.
 */
type Row = Record<string, unknown>
const calls = { sellerArgs: [] as Row[], aggregates: [] as Row[] }
const T = { sellers: [] as Row[], counts: new Map<string, { chats: number; msgs: number | null }>(), blocked: new Map<string, string[]>() }

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findMany: vi.fn(async (a: Row) => { calls.sellerArgs.push(a); return T.sellers }) },
    conversation: {
      fields: { sellerDeletedAt: 'sellerDeletedAt' },
      aggregate: vi.fn(async (a: { where: { AND: Row[] } }) => {
        calls.aggregates.push(a as unknown as Row)
        const sellerId = (a.where.AND[0] as { sellerId: string }).sellerId
        const c = T.counts.get(sellerId) ?? { chats: 0, msgs: null }
        return { _count: { _all: c.chats }, _sum: { sellerUnread: c.msgs } }
      }),
    },
  },
}))
vi.mock('@/lib/user-blocks', () => ({ blockedConversationIds: vi.fn(async (me: string) => T.blocked.get(me) ?? []) }))

const { partnerInboxCounts, PARTNER_INBOX_HANDLES } = await import('./partner-inbox')

const seller = (id: string, name: string, handle: string, ownerId: string | null = `owner-${id}`, officialPartner = handle !== 'eno-trading') => ({ id, name, ownerId, officialPartner, handle: { handle } })

beforeEach(() => {
  calls.sellerArgs = []; calls.aggregates = []
  T.sellers = []; T.counts = new Map(); T.blocked = new Map()
})

describe('partnerInboxCounts', () => {
  it('reads the owner\'s five shops by handle — not every official partner — and never a message', async () => {
    T.sellers = [seller('s-vk', 'VietKite', 'vietkite')]
    await partnerInboxCounts()
    expect(PARTNER_INBOX_HANDLES).toEqual(['goplus', 'blvck', 'saigonmoving', 'vietkite', 'eno-trading'])
    const a = calls.sellerArgs[0] as { where: unknown; select: Record<string, unknown> }
    expect(a.where).toEqual({ handle: { handle: { in: ['goplus', 'blvck', 'saigonmoving', 'vietkite', 'eno-trading'] } } })
    expect(JSON.stringify(a.where)).not.toMatch(/officialPartner/)
    // the conversation is only ever aggregated: no findMany, no message, no buyer, no text
    const agg = calls.aggregates[0] as { _count: unknown; _sum: unknown; select?: unknown; include?: unknown }
    expect(agg.select).toBeUndefined()
    expect(agg.include).toBeUndefined()
    expect(JSON.stringify(agg)).not.toMatch(/lastMessageText|messages|buyer/)
  })

  it('counts each shop\'s unread chats as its own inbox does: deleted threads stay hidden, blocked people are left out', async () => {
    T.sellers = [seller('s-gp', 'GoPlus', 'goplus'), seller('s-bl', 'Blvck Motorbike', 'blvck', null)]
    T.blocked.set('owner-s-gp', ['c-spam'])
    T.counts.set('s-gp', { chats: 2, msgs: 5 })
    await partnerInboxCounts()
    const gp = calls.aggregates.find((a) => JSON.stringify(a).includes('s-gp')) as { where: { AND: Row[] } }
    expect(gp.where.AND[0]).toEqual({ sellerId: 's-gp', sellerUnread: { gt: 0 } })
    expect(JSON.stringify(gp.where.AND[1])).toMatch(/sellerDeletedAt/) // liveForSeller()
    expect(gp.where.AND[2]).toEqual({ id: { notIn: ['c-spam'] } })
    // a shop with no owner (nobody can have blocked anyone) adds no block clause
    const bl = calls.aggregates.find((a) => JSON.stringify(a).includes('s-bl')) as { where: { AND: Row[] } }
    expect(bl.where.AND[2]).toEqual({})
  })

  it('returns the counts per shop in the owner\'s order, and the totals', async () => {
    T.sellers = [seller('s-et', 'ENO Trading', 'eno-trading'), seller('s-sm', 'Saigon Moving', 'saigonmoving'), seller('s-gp', 'GoPlus', 'goplus')]
    T.counts.set('s-gp', { chats: 2, msgs: 5 })
    T.counts.set('s-et', { chats: 1, msgs: 1 })
    const r = await partnerInboxCounts()
    expect(r.shops.map((s) => s.handle)).toEqual(['goplus', 'saigonmoving', 'eno-trading'])
    expect(r.shops[0]).toEqual({ sellerId: 's-gp', name: 'GoPlus', handle: 'goplus', unreadChats: 2, unreadMessages: 5 })
    expect(r.shops[1]).toMatchObject({ unreadChats: 0, unreadMessages: 0 })
    expect(r).toMatchObject({ unreadChats: 3, unreadMessages: 6 })
    // nothing else per shop: no time, no customer, no conversation id
    expect(Object.keys(r.shops[0]).sort()).toEqual(['handle', 'name', 'sellerId', 'unreadChats', 'unreadMessages'])
  })

  it('a partner handle counts only on an official partner: a renamed-away handle taken by someone else is never counted (opus review 2026-11-12)', async () => {
    T.sellers = [seller('s-imp', 'GoPlus', 'goplus', 'owner-imp', false), seller('s-et', 'ENO Trading', 'eno-trading')]
    T.counts.set('s-imp', { chats: 9, msgs: 9 })
    const r = await partnerInboxCounts()
    expect(r.shops.map((s) => s.sellerId)).toEqual(['s-et'])
    expect(r.unreadChats).toBe(0)
    expect(calls.aggregates.some((a) => JSON.stringify(a).includes('s-imp'))).toBe(false)
  })

  it('no shop found: zeros, no conversation query', async () => {
    expect(await partnerInboxCounts()).toEqual({ shops: [], unreadChats: 0, unreadMessages: 0 })
    expect(calls.aggregates).toHaveLength(0)
  })
})
