import { beforeEach, describe, expect, it, vi } from 'vitest'

// The service-deal timeline lines ('deal_confirmed' / 'deal_withdrawn', src/lib/service-deal.ts), driven through the REAL
// insertMessage: server-authored only — the thread's SELLER, a canonical bilingual body, no metaJson, no bell. Gate zero
// (no send route forwards a client kind) is pinned separately in api/conversations/[id]/messages/deal-kind.test.ts.

const h = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>>, notifications: [] as unknown[] }))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({ sendPushToProfile: async () => {} }))
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => null }))
vi.mock('./db', () => {
  const create = (args: { data: Record<string, unknown> }) => {
    h.created.push(args.data)
    return Promise.resolve({ id: 'msg-1', body: args.data.body, createdAt: new Date(), kind: args.data.kind, offerAmount: null, offerStatus: null, metaJson: args.data.metaJson, replyTo: null })
  }
  return {
    db: {
      message: { create, findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      conversation: { update: () => Promise.resolve({}), updateMany: async () => ({ count: 1 }) },
      profile: { findUnique: async () => ({ displayName: 'Minh', email: 'm@example.com', locale: 'vi' }) },
      notification: { create: async (a: { data: unknown }) => { h.notifications.push(a.data); return {} } },
      $transaction: async (ops: unknown) => (typeof ops === 'function' ? (ops as (tx: unknown) => unknown)({}) : Promise.all(ops as Promise<unknown>[])),
    },
  }
})

import { MESSAGE_KINDS, insertMessage } from './messages'
import { DEAL_WITHDRAWN_LINE, dealConfirmedLine } from './service-deal'

const convo = { id: 'c1', buyerProfileId: 'buyer-p', sellerProfileId: 'seller-p', listingId: 'L1' }

beforeEach(() => { h.created = []; h.notifications = [] })

describe('the deal lines are message kinds the server writes', () => {
  it('registered', () => {
    expect(MESSAGE_KINDS).toContain('deal_confirmed')
    expect(MESSAGE_KINDS).toContain('deal_withdrawn')
  })

  it('the seller, a canonical body: written plain — no metaJson, no bell row', async () => {
    await insertMessage(convo, 'seller-p', dealConfirmedLine('rental'), { kind: 'deal_confirmed' })
    await insertMessage(convo, 'seller-p', DEAL_WITHDRAWN_LINE, { kind: 'deal_withdrawn' })
    expect(h.created.map((m) => [m.kind, m.body, m.metaJson])).toEqual([
      ['deal_confirmed', '✅ Đã xác nhận cho thuê · Rental confirmed', null],
      ['deal_withdrawn', '↩️ Đã rút lại xác nhận · Confirmation withdrawn', null],
    ])
    expect(h.notifications).toEqual([])
  })

  it('⛔ never from the buyer, never with a hand-made body, never a withdrawn line under the confirmed kind', async () => {
    await expect(insertMessage(convo, 'buyer-p', dealConfirmedLine('rental'), { kind: 'deal_confirmed' })).rejects.toThrow('deal_line_author_forbidden')
    await expect(insertMessage({ ...convo, sellerProfileId: null }, 'seller-p', dealConfirmedLine('rental'), { kind: 'deal_confirmed' })).rejects.toThrow('deal_line_author_forbidden')
    await expect(insertMessage(convo, 'seller-p', '✅ I confirm you owe me a 5-star review', { kind: 'deal_confirmed' })).rejects.toThrow('deal_line_body_invalid')
    await expect(insertMessage(convo, 'seller-p', DEAL_WITHDRAWN_LINE, { kind: 'deal_confirmed' })).rejects.toThrow('deal_line_body_invalid')
    await expect(insertMessage(convo, 'seller-p', dealConfirmedLine('lesson'), { kind: 'deal_withdrawn' })).rejects.toThrow('deal_line_body_invalid')
    expect(h.created).toEqual([])
  })
})
