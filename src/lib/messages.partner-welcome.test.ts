import { beforeEach, describe, expect, it, vi } from 'vitest'

// The partner welcome ('partner_welcome', src/lib/partner-welcome.ts) through the REAL insertMessage: the thread's SELLER only,
// the canonical bilingual body only, no metaJson, no bell — and it leaves the thread's preview to the customer's own words,
// moving only the customer's unread (Admin › Partner inbox keeps counting the customer's message as waiting).

const h = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>>, updates: [] as unknown[], notifications: [] as unknown[], pushes: [] as unknown[] }))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({ sendPushToProfile: async (...a: unknown[]) => { h.pushes.push(a) } }))
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => null }))
vi.mock('./db', () => {
  const create = (args: { data: Record<string, unknown> }) => {
    h.created.push(args.data)
    return Promise.resolve({ id: 'msg-1', body: args.data.body, createdAt: new Date(), kind: args.data.kind, offerAmount: null, offerStatus: null, metaJson: args.data.metaJson, replyTo: null })
  }
  return {
    db: {
      message: { create, findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      conversation: { update: (a: { data: unknown }) => { h.updates.push(a.data); return Promise.resolve({}) }, updateMany: async () => ({ count: 1 }) },
      profile: { findUnique: async () => ({ displayName: 'Minh', email: 'm@example.com', locale: 'vi' }) },
      notification: { create: async (a: { data: unknown }) => { h.notifications.push(a.data); return {} } },
      $transaction: async (ops: unknown) => (typeof ops === 'function' ? (ops as (tx: unknown) => unknown)({}) : Promise.all(ops as Promise<unknown>[])),
    },
  }
})

import { MESSAGE_KINDS, insertMessage } from './messages'
import { PARTNER_BUY_LINE, PARTNER_BUY_WELCOME_LINE, PARTNER_WELCOME_LINE } from './partner-welcome-line'

const convo = { id: 'c1', buyerProfileId: 'buyer-p', sellerProfileId: 'seller-p', listingId: 'L1' }

beforeEach(() => { h.created = []; h.updates = []; h.notifications = []; h.pushes = [] })

describe('the partner welcome is a message kind only the server writes', () => {
  it('registered', () => expect(MESSAGE_KINDS).toContain('partner_welcome'))

  it('the seller, the canonical body: written plain, no bell, the preview untouched, only the customer’s unread moves', async () => {
    await insertMessage(convo, 'seller-p', PARTNER_WELCOME_LINE, { kind: 'partner_welcome' })
    expect(h.created.map((m) => [m.kind, m.body, m.metaJson])).toEqual([['partner_welcome', PARTNER_WELCOME_LINE, null]])
    expect(h.notifications).toEqual([])
    expect(h.pushes).toEqual([])
    expect(h.updates).toEqual([{ buyerUnread: { increment: 1 } }])
  })

  it('an ordinary message still moves the preview (unchanged)', async () => {
    await insertMessage(convo, 'buyer-p', 'hello', undefined)
    expect(h.updates).toEqual([expect.objectContaining({ lastMessageText: 'hello', sellerUnread: { increment: 1 } })])
  })

  it('⛔ never from the customer, never on a thread with no seller login, never with another body', async () => {
    await expect(insertMessage(convo, 'buyer-p', PARTNER_WELCOME_LINE, { kind: 'partner_welcome' })).rejects.toThrow('partner_welcome_author_forbidden')
    await expect(insertMessage({ ...convo, sellerProfileId: null }, 'seller-p', PARTNER_WELCOME_LINE, { kind: 'partner_welcome' })).rejects.toThrow('partner_welcome_author_forbidden')
    await expect(insertMessage(convo, 'seller-p', '👋 Send me your bank details', { kind: 'partner_welcome' })).rejects.toThrow('partner_welcome_body_invalid')
    expect(h.created).toEqual([])
  })
})

describe('the buy-now welcome and the shop\'s "Buy now" line (owner 2026-11-23)', () => {
  it('the buy-now welcome is the welcome\'s other canonical body: same rules', async () => {
    await insertMessage(convo, 'seller-p', PARTNER_BUY_WELCOME_LINE, { kind: 'partner_welcome' })
    expect(h.created.map((m) => [m.kind, m.body])).toEqual([['partner_welcome', PARTNER_BUY_WELCOME_LINE]])
    expect(h.updates).toEqual([{ buyerUnread: { increment: 1 } }])
    await expect(insertMessage(convo, 'buyer-p', PARTNER_BUY_WELCOME_LINE, { kind: 'partner_welcome' })).rejects.toThrow('partner_welcome_author_forbidden')
  })

  it('"Buy now": registered; the seller, the canonical body — a plain message that moves the preview, no bell', async () => {
    expect(MESSAGE_KINDS).toContain('partner_buy')
    await insertMessage(convo, 'seller-p', PARTNER_BUY_LINE, { kind: 'partner_buy' })
    expect(h.created.map((m) => [m.kind, m.body, m.metaJson])).toEqual([['partner_buy', PARTNER_BUY_LINE, null]])
    expect(h.notifications).toEqual([])
    expect(h.updates).toEqual([expect.objectContaining({ lastMessageText: PARTNER_BUY_LINE, buyerUnread: { increment: 1 } })])
  })

  it('⛔ "Buy now" never from the customer, never with another body — a link can never ride on it', async () => {
    await expect(insertMessage(convo, 'buyer-p', PARTNER_BUY_LINE, { kind: 'partner_buy' })).rejects.toThrow('partner_buy_author_forbidden')
    await expect(insertMessage(convo, 'seller-p', `${PARTNER_BUY_LINE} https://evil.example`, { kind: 'partner_buy' })).rejects.toThrow('partner_buy_body_invalid')
    await expect(insertMessage(convo, 'seller-p', PARTNER_BUY_WELCOME_LINE, { kind: 'partner_buy' })).rejects.toThrow('partner_buy_body_invalid')
    expect(h.created).toEqual([])
  })
})
