import { beforeEach, describe, expect, it, vi } from 'vitest'

// SendOpts.alongside (2026-10-07): writes that commit WITH a message or not at all — the teacher contact and intro-video
// grants ride the message's own batch transaction, so a crash or a failed insert never leaves a grant with no line.
// Driven through the REAL insertMessage; the db mock records the batch it is handed.

const h = vi.hoisted(() => ({ batches: [] as unknown[][] }))
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({ sendPushToProfile: async () => {} }))
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => null }))
vi.mock('./db', () => {
  const row = (data: { body: string; kind: string }) => ({ id: 'msg-1', body: data.body, createdAt: new Date(0), kind: data.kind, offerAmount: null, offerStatus: null, metaJson: null, replyTo: null })
  return {
    db: {
      message: {
        create: (args: { data: { body: string; kind: string } }) => ({ op: 'message.create', result: row(args.data) }),
        updateMany: () => ({ op: 'message.updateMany', result: { count: 0 } }),
        findFirst: async () => null,
      },
      conversation: { update: () => ({ op: 'conversation.update', result: {} }) },
      profile: { findUnique: async () => ({ displayName: 'Jane', email: 'jane@example.com' }) },
      notification: { create: async () => ({}) },
      $transaction: async (ops: Array<{ op: string; result: unknown }>) => { h.batches.push(ops.map((o) => o.op)); return ops.map((o) => o.result) },
    },
  }
})

import { insertMessage } from './messages'

const convo = { id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', listingId: 'L1', sellerId: 's1' }
const grant = { op: 'teacherVideoShare.upsert', result: { conversationId: 'c1' } }

beforeEach(() => { h.batches = [] })

describe('SendOpts.alongside', () => {
  it('runs in the SAME batch as the message and the thread counters — and the message is still the one returned', async () => {
    const m = await insertMessage(convo, 'teacher-1', '🎬 Sent my intro video', { alongside: [grant as never] })
    expect(h.batches).toEqual([['teacherVideoShare.upsert', 'message.create', 'conversation.update']])
    expect(m.body).toBe('🎬 Sent my intro video')
  })
  it('an offer keeps its own supersede step, and still returns the offer it created', async () => {
    const m = await insertMessage(convo, 'school-1', '', { kind: 'offer', offerAmount: 300_000, alongside: [grant as never] })
    expect(h.batches).toEqual([['teacherVideoShare.upsert', 'message.updateMany', 'message.create', 'conversation.update']])
    expect(m.kind).toBe('offer')
  })
  it('without it, the batch is exactly what it was', async () => {
    await insertMessage(convo, 'teacher-1', 'hello')
    expect(h.batches).toEqual([['message.create', 'conversation.update']])
  })
  it('is refused for a card kind (an interactive transaction a batch write cannot join)', async () => {
    await expect(insertMessage(convo, 'school-1', '', { kind: 'availability_request', alongside: [grant as never] } as never)).rejects.toThrow('message_alongside_not_allowed')
    expect(h.batches).toEqual([])
  })
})
