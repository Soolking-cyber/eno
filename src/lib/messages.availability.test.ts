import { beforeEach, describe, expect, it, vi } from 'vitest'

// The availability_request card — READ-ONLY since 2026-11-25, when the renters' availability check was removed (owner:
// "remove the check availability feature entirely"). The requests already in people's threads must keep reading as the card
// they were (the strict read schema), and the REAL insertMessage must refuse to write a new one for anyone, in any thread.

const h = vi.hoisted(() => ({
  state: {
    created: [] as Array<{ conversationId: string; kind: string; metaJson: string | null; body: string }>,
    guardWhere: null as unknown,
    convoUpdate: null as unknown,
    // What the transaction's compare-and-set "finds": the thread as it is at commit time.
    live: { id: 'convo-1', buyerProfileId: 'asker', listingId: null as string | null, sellerId: 'eno-rental-desk' },
    notifications: [] as Array<Record<string, unknown>>,
    pushes: [] as Array<{ to: string; payload: Record<string, unknown> }>,
    notificationThrows: false,
  },
}))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({
  sendPushToProfile: async (to: string, payload: Record<string, unknown>) => { h.state.pushes.push({ to, payload }) },
}))
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => null }))

vi.mock('./db', () => {
  const create = async (args: any) => {
    h.state.created.push({ conversationId: args.data.conversationId, kind: args.data.kind, metaJson: args.data.metaJson, body: args.data.body })
    return { id: 'msg-1', body: args.data.body, createdAt: new Date(), kind: args.data.kind, offerAmount: null, offerStatus: null, metaJson: args.data.metaJson, replyTo: null }
  }
  // Honour EVERY predicate the guard sends, the way Postgres would — a mock that ignored one would
  // report the compare-and-set as passing no matter what it asked.
  const conversationUpdateMany = async (args: any) => {
    h.state.guardWhere = args.where
    h.state.convoUpdate = args.data
    const w = args.where, row = h.state.live
    if (w.id !== row.id) return { count: 0 }
    if ('buyerProfileId' in w && w.buyerProfileId !== row.buyerProfileId) return { count: 0 }
    if ('listingId' in w && w.listingId !== row.listingId) return { count: 0 }
    if (w.sellerId?.in && !w.sellerId.in.includes(row.sellerId)) return { count: 0 }
    return { count: 1 }
  }
  return {
    db: {
      message: { create, findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      conversation: { updateMany: conversationUpdateMany, update: async () => ({}) },
      profile: { findUnique: async () => ({ displayName: 'Anna', email: 'anna@example.com' }) },
      notification: {
        create: async (args: any) => {
          if (h.state.notificationThrows) throw new Error('bell insert failed')
          h.state.notifications.push(args.data)
          return {}
        },
      },
      $transaction: async (fn: any) => (typeof fn === 'function'
        ? fn({ conversation: { updateMany: conversationUpdateMany }, message: { create } })
        : Promise.all(fn)),
    },
  }
})

import { insertMessage, isCardKind, parseMessageMeta, MESSAGE_KINDS } from './messages'
import type { AvailabilityRequestMeta } from './rental-check/shared'
import { notificationScope } from './notification-scope'

const convo = { id: 'convo-1', buyerProfileId: 'asker', sellerProfileId: 'operator', listingId: null, sellerId: 'eno-rental-desk' }

function meta(over: Partial<AvailabilityRequestMeta> = {}): AvailabilityRequestMeta {
  return {
    v: 1,
    requestId: 'req-00000001',
    items: [
      { id: 'L1', title: 'Studio in D1', titleVi: 'Căn hộ Q1', image: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', price: 9_000_000, currency: '₫', priceUnit: 'VND/month' },
      { id: 'L2', title: 'Flat in D2', titleVi: null, image: null, price: 12_000_000, currency: '₫', priceUnit: 'VND/month' },
    ],
    requirements: 'Pets allowed?\nFrom 1 October',
    contact: { channel: 'zalo', value: '84901234567' },
    origin: 'vn',
    lang: 'en',
    ...over,
  }
}
const card = (m: unknown = meta()) => ({ kind: 'availability_request' as const, meta: m as never, preview: 'Kiểm tra phòng trống · Availability check (2)' })

beforeEach(() => {
  h.state.created = []
  h.state.guardWhere = null
  h.state.convoUpdate = null
  h.state.live = { id: 'convo-1', buyerProfileId: 'asker', listingId: null, sellerId: 'eno-rental-desk' }
  h.state.notifications = []
  h.state.pushes = []
  h.state.notificationThrows = false
})

describe('availability_request stays a card kind, for the threads that hold one', () => {
  it('is a message kind and a card kind', () => {
    expect(MESSAGE_KINDS).toContain('availability_request')
    expect(isCardKind('availability_request')).toBe(true)
  })

  it('round-trips through the read-side parse', () => {
    const m = meta()
    expect(parseMessageMeta('availability_request', JSON.stringify(m))).toEqual(m)
  })

  it('eno.vn\'s bell still filters a forum-origin request out, and keeps its own', () => {
    expect((notificationScope('operator', true) as { type: { notIn: string[] } }).type.notIn).toContain('availability_request_forum')
    expect((notificationScope('operator', true) as { type: { notIn: string[] } }).type.notIn).not.toContain('availability_request')
  })
})

describe('⛔ no new request can be written (the feature was removed 2026-11-25)', () => {
  it('refuses the requester in a listing-less rental-desk thread — the one case the old gate accepted', async () => {
    await expect(insertMessage(convo, 'asker', '', card())).rejects.toThrow('rental_card_retired')
    expect(h.state.created).toHaveLength(0)
    expect(h.state.guardWhere).toBeNull()
  })

  it('refuses it on the forum desk, from the operator, and in any other thread too', async () => {
    for (const [c, sender] of [
      [{ ...convo, sellerId: 'eno-rental-desk-forum' }, 'asker'],
      [convo, 'operator'],
      [{ ...convo, listingId: 'L1' }, 'asker'],
      [{ ...convo, sellerId: 'someone-else' }, 'asker'],
    ] as const) {
      await expect(insertMessage(c, sender, '', card())).rejects.toThrow('rental_card_retired')
    }
    expect(h.state.created).toHaveLength(0)
  })

  it('notifies nobody', async () => {
    await expect(insertMessage(convo, 'asker', '', card())).rejects.toThrow('rental_card_retired')
    expect(h.state.notifications).toHaveLength(0)
    expect(h.state.pushes).toHaveLength(0)
  })

  it('still refuses meta on a text message', async () => {
    await expect(insertMessage(convo, 'asker', 'hi', { meta: meta() as never })).rejects.toThrow('message_meta_not_allowed')
    expect(h.state.created).toHaveLength(0)
  })
})

describe('the read schema stays strict and bounded', () => {
  const unread = (m: unknown) => expect(parseMessageMeta('availability_request', JSON.stringify(m))).toBeNull()

  it('refuses an unknown top-level key', () => unread({ ...meta(), note: 'smuggled' }))
  it('refuses an unknown item key', () => unread(meta({ items: [{ ...meta().items[0], sellerPhone: '0901234567' } as never] })))
  it('refuses zero items', () => unread(meta({ items: [] })))
  it('refuses six items', () => unread(meta({ items: Array.from({ length: 6 }, (_, i) => ({ ...meta().items[1], id: `L${i}` })) })))
  it('refuses a duplicated item', () => unread(meta({ items: [meta().items[0], meta().items[0]] })))
  it('refuses requirements over 1000 characters', () => unread(meta({ requirements: 'x'.repeat(1001) })))
  it('refuses a bad request id', () => unread(meta({ requestId: 'short' })))
  it('refuses an item id with free text in it', () => unread(meta({ items: [{ ...meta().items[0], id: 'call me 0901234567' }] })))
  it('refuses a title over 140 characters', () => unread(meta({ items: [{ ...meta().items[0], title: 't'.repeat(141) }] })))
  it('refuses a negative or non-finite price', () => {
    unread(meta({ items: [{ ...meta().items[0], price: -1 }] }))
    unread({ ...meta(), items: [{ ...meta().items[0], price: 'Infinity' }] })
  })
  it('refuses a currency that is neither ₫ nor an ISO code', () => unread(meta({ items: [{ ...meta().items[0], currency: 'dong' }] })))
  it.each([
    ['http://insecure.example/a.jpg'],
    ['//evil.example/a.jpg'],
    ['/\\evil.example/a.jpg'],
    ['javascript:alert(1)'],
    ['https://ok.example/a b.jpg'],
  ])('refuses the image %j', (image) => unread(meta({ items: [{ ...meta().items[0], image }] })))
  it('refuses a bad origin or language', () => {
    unread({ ...meta(), origin: 'elsewhere' })
    unread({ ...meta(), lang: 'fr' })
  })
  // SHAPE only on read: a stored card whose contact has the right shape but is not the old form's fixed point still reads.
  it('READS a contact of the right shape that is not the old normaliser\'s fixed point', () => {
    const m = meta({ contact: { channel: 'whatsapp', value: '376312345' } })
    expect(parseMessageMeta('availability_request', JSON.stringify(m))).toEqual(m)
  })
  it.each([
    ['zalo', '+84901234567'],
    ['zalo', '0901234567'],
    ['whatsapp', '+14155550100'],
    ['email', 'a@b.co?body=x'],
    ['email', 'no-at-sign'],
    ['sms', '84901234567'],
  ])('refuses a %s contact of the wrong SHAPE (%j)', (channel, value) => {
    unread(meta({ contact: { channel: channel as never, value } }))
  })
})
