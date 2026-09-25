import { beforeEach, describe, expect, it, vi } from 'vitest'

// The availability_request card, driven through the REAL insertMessage — the gates that matter
// (requester-only authorship, listing-less thread, rental-desk seller, the strict meta, the per-kind
// cap and the compare-and-set inside the transaction) all live there, so a stubbed insertMessage
// would prove none of them. Same choice as messages.trip-cards.test.ts, same harness shape.

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

describe('availability_request is registered as a card kind', () => {
  it('is a message kind and a card kind', () => {
    expect(MESSAGE_KINDS).toContain('availability_request')
    expect(isCardKind('availability_request')).toBe(true)
  })

  it('round-trips through the read-side parse', () => {
    const m = meta()
    expect(parseMessageMeta('availability_request', JSON.stringify(m))).toEqual(m)
  })
})

describe('who may post an availability request', () => {
  it('ACCEPTS the requester in a listing-less rental-desk thread', async () => {
    await insertMessage(convo, 'asker', '', card())
    expect(h.state.created).toHaveLength(1)
    expect(h.state.created[0]).toMatchObject({ conversationId: 'convo-1', kind: 'availability_request', body: '' })
    expect(JSON.parse(h.state.created[0].metaJson!)).toEqual(meta())
  })

  it('works for the forum desk too', async () => {
    h.state.live.sellerId = 'eno-rental-desk-forum'
    await insertMessage({ ...convo, sellerId: 'eno-rental-desk-forum' }, 'asker', '', card(meta({ origin: 'forum' })))
    expect(h.state.created).toHaveLength(1)
  })

  it('⛔ REFUSES the operator as author — they answer in text, never fabricate a request', async () => {
    await expect(insertMessage(convo, 'operator', '', card())).rejects.toThrow('rental_card_author_forbidden')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a thread anchored on a listing', async () => {
    await expect(insertMessage({ ...convo, listingId: 'L9' }, 'asker', '', card())).rejects.toThrow('rental_card_thread_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a thread with an ordinary seller', async () => {
    await expect(insertMessage({ ...convo, sellerId: 'some-shop' }, 'asker', '', card())).rejects.toThrow('rental_card_thread_mismatch')
  })

  /**
   * ⛔ THE ABSENCE THAT IS GATE ZERO. The ordinary send routes build ConvoForSend WITHOUT sellerId,
   * so a forwarded kind/meta can never mint this card through them — pinned so a future route that
   * starts passing a body through still cannot.
   */
  it('REFUSES a caller that did not select the thread seller (the ordinary send routes)', async () => {
    const { sellerId: _drop, ...noSeller } = convo
    void _drop
    await expect(insertMessage(noSeller, 'asker', '', card())).rejects.toThrow('rental_card_thread_mismatch')
  })

  it('REFUSES meta on a text message', async () => {
    await expect(insertMessage(convo, 'asker', 'hi', { meta: meta() as never })).rejects.toThrow('message_meta_not_allowed')
  })
})

describe('the transaction re-asserts the thread (compare-and-set)', () => {
  it('guards on id, buyer, a null listing and the desk set, and bumps the thread in the same write', async () => {
    await insertMessage(convo, 'asker', '', card())
    expect(h.state.guardWhere).toEqual({
      id: 'convo-1', buyerProfileId: 'asker', listingId: null,
      sellerId: { in: ['eno-rental-desk', 'eno-rental-desk-forum'] },
    })
    // The preview (never the contact) lands in the inbox line, and the OPERATOR's unread goes up.
    expect(h.state.convoUpdate).toMatchObject({ lastMessageText: 'Kiểm tra phòng trống · Availability check (2)', sellerUnread: { increment: 1 } })
    expect(JSON.stringify(h.state.convoUpdate)).not.toContain('84901234567')
  })

  it('ROLLS BACK when the thread gained a listing between the gate and the insert', async () => {
    h.state.live.listingId = 'L9'
    await expect(insertMessage(convo, 'asker', '', card())).rejects.toThrow('rental_card_thread_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('ROLLS BACK when the thread moved to another seller', async () => {
    h.state.live.sellerId = 'some-shop'
    await expect(insertMessage(convo, 'asker', '', card())).rejects.toThrow('rental_card_thread_mismatch')
    expect(h.state.created).toHaveLength(0)
  })
})

describe('the meta is strict and bounded', () => {
  const refused = async (m: unknown) => {
    await expect(insertMessage(convo, 'asker', '', card(m))).rejects.toThrow('rental_card_meta_invalid')
    expect(h.state.created).toHaveLength(0)
  }

  it('refuses an unknown top-level key', () => refused({ ...meta(), note: 'smuggled' }))
  it('refuses an unknown item key', () => refused(meta({ items: [{ ...meta().items[0], sellerPhone: '0901234567' } as never] })))
  it('refuses zero items', () => refused(meta({ items: [] })))
  it('refuses six items', () => refused(meta({ items: Array.from({ length: 6 }, (_, i) => ({ ...meta().items[1], id: `L${i}` })) })))
  it('refuses a duplicated item', () => refused(meta({ items: [meta().items[0], meta().items[0]] })))
  it('refuses requirements over 1000 characters', () => refused(meta({ requirements: 'x'.repeat(1001) })))
  it('refuses a bad request id', () => refused(meta({ requestId: 'short' })))
  it('refuses an item id with free text in it', () => refused(meta({ items: [{ ...meta().items[0], id: 'call me 0901234567' }] })))
  it('refuses a title over 140 characters', () => refused(meta({ items: [{ ...meta().items[0], title: 't'.repeat(141) }] })))
  it('refuses a negative or non-finite price', async () => {
    await refused(meta({ items: [{ ...meta().items[0], price: -1 }] }))
    await refused(meta({ items: [{ ...meta().items[0], price: Number.POSITIVE_INFINITY }] }))
  })
  it('refuses a currency that is neither ₫ nor an ISO code', () => refused(meta({ items: [{ ...meta().items[0], currency: 'dong' }] })))
  it('ACCEPTS ₫ — what every production rental stores', async () => {
    await insertMessage(convo, 'asker', '', card(meta()))
    expect(h.state.created).toHaveLength(1)
  })
  it.each([
    ['http://insecure.example/a.jpg'],
    ['//evil.example/a.jpg'],
    ['/\\evil.example/a.jpg'],
    ['javascript:alert(1)'],
    ['https://ok.example/a b.jpg'],
  ])('refuses the image %j', (image) => refused(meta({ items: [{ ...meta().items[0], image }] })))
  it('refuses a contact that is not a fixed point of the normaliser', async () => {
    await refused(meta({ contact: { channel: 'zalo', value: '0901234567' } })) // un-normalised
    await refused(meta({ contact: { channel: 'email', value: 'Anna@Example.com' } })) // not lowercased
    await refused(meta({ contact: { channel: 'whatsapp', value: '376312345' } })) // 9 digits → re-reads as VN
    await refused(meta({ contact: { channel: 'sms' as never, value: '84901234567' } }))
  })
  it('refuses a bad origin or language', async () => {
    await refused({ ...meta(), origin: 'elsewhere' })
    await refused({ ...meta(), lang: 'fr' })
  })
})

describe('the per-kind size cap', () => {
  it('refuses a card whose JSON exceeds 8192 characters even with every field inside its own bound', async () => {
    // Quote-heavy fields double under JSON escaping, and every id/unit at its maximum: each field
    // passes its own schema bound, and only the whole-card cap stops the row.
    const fat = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}${'x'.repeat(63)}`, title: '"'.repeat(140), titleVi: '"'.repeat(140),
      image: `https://sb.eno.vn/${'a'.repeat(489)}.webp`, price: 1e13, currency: '₫', priceUnit: '"'.repeat(32),
    }))
    const m = meta({
      requestId: 'r'.repeat(64), items: fat, requirements: '"'.repeat(1000),
      contact: { channel: 'email', value: `${'a'.repeat(240)}@example.com` },
    })
    expect(JSON.stringify(m).length).toBeGreaterThan(8192) // the precondition, so this cannot pass vacuously
    await expect(insertMessage(convo, 'asker', '', card(m))).rejects.toThrow('rental_card_meta_too_large')
    expect(h.state.created).toHaveLength(0)
  })
})

describe('the operator is notified', () => {
  it('writes a bell row and a push to the operator, naming the requester, the count and the origin', async () => {
    await insertMessage(convo, 'asker', '', card())
    expect(h.state.notifications).toEqual([{
      recipientId: 'operator',
      type: 'availability_request',
      title: 'Kiểm tra phòng trống · Availability check',
      body: 'Anna · 2 căn / 2 rentals · eno.vn',
      actorName: 'Anna',
      conversationId: 'convo-1',
    }])
    expect(h.state.pushes).toEqual([{ to: 'operator', payload: expect.objectContaining({ url: '/messages/convo-1', tag: 'convo-convo-1' }) }])
  })

  it('names eno.forum for a forum-origin request, under a type eno.vn’s bell filters out', async () => {
    await insertMessage(convo, 'asker', '', card(meta({ origin: 'forum', items: [meta().items[0]] })))
    expect(h.state.notifications[0].body).toBe('Anna · 1 căn / 1 rental · eno.forum')
    expect(h.state.notifications[0].type).toBe('availability_request_forum')
    // The forum-origin type is hidden on the marketplace bell (its thread cannot open there) …
    expect((notificationScope('operator', true) as { type: { notIn: string[] } }).type.notIn).toContain('availability_request_forum')
    // … and a vn-origin request is not.
    expect((notificationScope('operator', true) as { type: { notIn: string[] } }).type.notIn).not.toContain('availability_request')
  })

  it('never puts the contact in the bell or the push', async () => {
    await insertMessage(convo, 'asker', '', card())
    expect(JSON.stringify([h.state.notifications, h.state.pushes])).not.toContain('84901234567')
  })

  it('a failed bell row does not cost the push — and never fails the send', async () => {
    h.state.notificationThrows = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await insertMessage(convo, 'asker', '', card())
    err.mockRestore()
    expect(h.state.created).toHaveLength(1)
    expect(h.state.pushes).toHaveLength(1)
  })

  it('is skipped when the requester IS the operator — and no unread is counted that nobody can clear', async () => {
    h.state.live.buyerProfileId = 'operator'
    await insertMessage({ ...convo, buyerProfileId: 'operator' }, 'operator', '', card())
    expect(h.state.created).toHaveLength(1)
    expect(h.state.notifications).toHaveLength(0)
    expect(h.state.pushes).toHaveLength(0)
    expect(h.state.convoUpdate).not.toHaveProperty('sellerUnread')
    expect(h.state.convoUpdate).not.toHaveProperty('buyerUnread')
  })
})

/**
 * ⚠️ TOLERANT READ, STRICT WRITE. The fixed point of the normaliser is enforced when a card is
 * WRITTEN; on READ only the shape is checked, so a future change to the shared phone normaliser can
 * never make committed cards unreadable — or invisible to the route's replay lookup.
 */
describe('the contact check splits read from write', () => {
  it('READS a stored card whose contact has the right shape but is not today’s fixed point', () => {
    const m = meta({ contact: { channel: 'whatsapp', value: '376312345' } })
    expect(parseMessageMeta('availability_request', JSON.stringify(m))).toEqual(m)
  })

  it('still refuses to WRITE it', async () => {
    await expect(insertMessage(convo, 'asker', '', card(meta({ contact: { channel: 'whatsapp', value: '376312345' } }))))
      .rejects.toThrow('rental_card_meta_invalid')
    expect(h.state.created).toHaveLength(0)
  })

  it.each([
    ['zalo', '+84901234567'],
    ['zalo', '0901234567'],
    ['whatsapp', '+14155550100'],
    ['email', 'a@b.co?body=x'],
    ['email', 'no-at-sign'],
  ])('refuses a %s contact of the wrong SHAPE even on read (%j)', (channel, value) => {
    expect(parseMessageMeta('availability_request', JSON.stringify(meta({ contact: { channel: channel as never, value } })))).toBeNull()
  })
})
