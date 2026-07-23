import { beforeEach, describe, expect, it, vi } from 'vitest'

// The card-authoring binding guard, exercised through the REAL insertMessage (not the mock
// the visa suites use). An external review (GPT-5.6 + Gemini 3.1, 2026-07-23) showed the
// stranding/data-loss fix could not be proven while insertMessage was stubbed: the one gate
// that refuses a rebound-case card lives here. These tests drive it directly.
//
// THE SCENARIO: one buyer<->desk conversation, rebound from case to case. Its live pointer
// (Conversation.visaApplicationId) names only the CURRENT case (B). A finished-visa card for
// an EARLIER case (A) whose cards legitimately live in this same thread must be ACCEPTED —
// resolved by the IMMUTABLE visa_applications.conversation_id — while a genuine spoof (a card
// for a case whose immutable home is a DIFFERENT thread) must still be REFUSED.

const h = vi.hoisted(() => ({
  state: {
    // applicationId -> its immutable conversation_id (visa_applications.conversation_id).
    homeOf: {} as Record<string, string | null>,
    created: [] as Array<{ conversationId: string; kind: string; metaJson: string | null }>,
    guardWhere: null as unknown,
    conversationExists: true,
  },
}))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({ sendPushToProfile: async () => undefined }))
// The lazy import inside buildCardMeta: the case's immutable home thread.
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async (id: string) => h.state.homeOf[id] ?? null }))

vi.mock('./db', () => {
  const create = async (args: any) => {
    h.state.created.push({ conversationId: args.data.conversationId, kind: args.data.kind, metaJson: args.data.metaJson })
    return { id: 'msg-1', body: args.data.body, createdAt: new Date(), kind: args.data.kind, offerAmount: null, offerStatus: null, metaJson: args.data.metaJson }
  }
  const updateMany = async (args: any) => {
    h.state.guardWhere = args.where
    // Honour the guard's WHERE: it now locks by conversation id alone.
    return { count: h.state.conversationExists && args.where.id === 'convo-1' ? 1 : 0 }
  }
  return {
    db: {
      message: { create, findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      conversation: { updateMany },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ conversation: { updateMany }, message: { create } }),
    },
  }
})

import { insertMessage } from './messages'

const A = '1a2b3c4d-0001-4001-8001-000000000001'
const B = '1a2b3c4d-0002-4002-8002-000000000002'
const X = '1a2b3c4d-0003-4003-8003-000000000003'
const Z = '1a2b3c4d-0004-4004-8004-000000000004'
const DOC = '7c1d2e3f-4444-4555-8666-777788889999'
const convo = { id: 'convo-1', buyerProfileId: 'buyer', sellerProfileId: 'shop', listingId: 'L', visaApplicationId: B }
const resultCard = (applicationId: string) => ({
  kind: 'visa_result' as const,
  meta: { v: 1 as const, applicationId, documentId: DOC, reference: 'EV-1042' },
  preview: 'x',
})

beforeEach(() => {
  h.state.homeOf = {}
  h.state.created = []
  h.state.guardWhere = null
  h.state.conversationExists = true
})

describe('visa card binding — the immutable link, not the live pointer', () => {
  it('ACCEPTS a card for the LIVE-bound case (the ordinary path)', async () => {
    // convo is live-bound to B; a card for B needs no immutable lookup.
    await insertMessage(convo, 'shop', '', resultCard(B))
    expect(h.state.created).toHaveLength(1)
    expect(h.state.created[0].conversationId).toBe('convo-1')
  })

  it('ACCEPTS a REBOUND case A whose immutable home is this thread', async () => {
    // The exact stranding scenario: live pointer is B, but A's cards belong here.
    h.state.homeOf[A] = 'convo-1'
    await insertMessage(convo, 'shop', '', resultCard(A))
    expect(h.state.created).toHaveLength(1)
    // The atomic guard now locks by conversation id alone — no visaApplicationId predicate.
    expect(h.state.guardWhere).toEqual({ id: 'convo-1' })
  })

  it('REFUSES a spoof — a card for a case whose immutable home is a DIFFERENT thread', async () => {
    h.state.homeOf[X] = 'someone-elses-convo'
    await expect(insertMessage(convo, 'shop', '', resultCard(X))).rejects.toThrow('visa_card_application_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a case with no immutable home at all', async () => {
    // homeOf['Z'] is undefined -> visaConversationIdFor returns null -> not hosted here.
    await expect(insertMessage(convo, 'shop', '', resultCard(Z))).rejects.toThrow('visa_card_application_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES when the conversation vanished under the transaction', async () => {
    h.state.homeOf[A] = 'convo-1'
    h.state.conversationExists = false
    await expect(insertMessage(convo, 'shop', '', resultCard(A))).rejects.toThrow('visa_card_conversation_gone')
  })

  it('still REFUSES a non-shop author', async () => {
    h.state.homeOf[B] = 'convo-1'
    await expect(insertMessage(convo, 'buyer', '', resultCard(B))).rejects.toThrow('visa_card_author_forbidden')
  })
})
