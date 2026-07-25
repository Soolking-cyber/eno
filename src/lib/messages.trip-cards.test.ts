import { beforeEach, describe, expect, it, vi } from 'vitest'

// Trip-card authoring, driven through the REAL insertMessage — the same choice the visa
// card-binding suite made and for the same reason: the gates that matter (desk-only
// authorship, thread binding, traveller match, and the compare-and-set that re-asserts the
// binding inside the transaction) live in insertMessage/buildTripCardMeta, so a stubbed
// insertMessage would prove none of them.
//
// The binding here is WEAKER than the visa one by construction and the tests are shaped around
// that: TripAssistanceRequest.conversationId is not unique, so two cases may name one thread.
// Nothing may therefore ask "which case owns this thread?" — only "is THIS case bound here?",
// which is what these tests pin.

const h = vi.hoisted(() => ({
  state: {
    // requestId -> the row buildTripCardMeta reads.
    requests: {} as Record<string, { id: string; conversationId: string | null; profileId: string; status: string }>,
    // Simulates a rebind landing BETWEEN buildTripCardMeta's read and the transaction's
    // compare-and-set: the tx sees this value instead of the one above.
    rebindTo: undefined as string | null | undefined,
    created: [] as Array<{ conversationId: string; kind: string; metaJson: string | null; body: string }>,
    requestGuardWhere: null as unknown,
    conversationExists: true,
  },
}))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('./push', () => ({ sendPushToProfile: async () => undefined }))
// buildCardMeta's lazy import — never reached by a trip card, stubbed so the module graph loads.
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => null }))

vi.mock('./db', () => {
  const create = async (args: any) => {
    h.state.created.push({
      conversationId: args.data.conversationId, kind: args.data.kind,
      metaJson: args.data.metaJson, body: args.data.body,
    })
    return { id: 'msg-1', body: args.data.body, createdAt: new Date(), kind: args.data.kind, offerAmount: null, offerStatus: null, metaJson: args.data.metaJson }
  }
  const conversationUpdateMany = async (args: any) => ({
    count: h.state.conversationExists && args.where.id === 'convo-1' ? 1 : 0,
  })
  const requestUpdateMany = async (args: any) => {
    h.state.requestGuardWhere = args.where
    const row = h.state.requests[args.where.id]
    if (!row) return { count: 0 }
    // Honour EVERY predicate the guard sends, the way Postgres would — a mock that ignored
    // `profileId`/`status` would report the compare-and-set as passing no matter what it asked.
    const live = h.state.rebindTo === undefined ? row.conversationId : h.state.rebindTo
    if (live !== args.where.conversationId) return { count: 0 }
    if (args.where.profileId !== undefined && args.where.profileId !== row.profileId) return { count: 0 }
    if (args.where.status !== undefined && args.where.status !== row.status) return { count: 0 }
    return { count: 1 }
  }
  return {
    db: {
      message: { create, findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      conversation: { updateMany: conversationUpdateMany, update: async () => ({}) },
      tripAssistanceRequest: {
        findUnique: async (args: any) => h.state.requests[args.where.id] ?? null,
        updateMany: requestUpdateMany,
      },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          conversation: { updateMany: conversationUpdateMany },
          tripAssistanceRequest: { updateMany: requestUpdateMany },
          message: { create },
        }),
    },
  }
})

import { insertMessage, parseMessageMeta } from './messages'

const REQ = 'ckrequest0000000000000001'
const convo = { id: 'convo-1', buyerProfileId: 'traveller', sellerProfileId: 'desk', listingId: 'L', visaApplicationId: null }
const quoteCard = (requestId = REQ) => ({ kind: 'trip_quote' as const, meta: { v: 1 as const, requestId }, preview: 'x' })
const statusCard = (status: string, requestId = REQ) => ({ kind: 'trip_status' as const, meta: { v: 1 as const, requestId, status }, preview: 'x' })

beforeEach(() => {
  h.state.requests = { [REQ]: { id: REQ, conversationId: 'convo-1', profileId: 'traveller', status: 'quoted' } }
  h.state.rebindTo = undefined
  h.state.created = []
  h.state.requestGuardWhere = null
  h.state.conversationExists = true
})

describe('trip card authorship', () => {
  it('ACCEPTS a quote from the desk on a bound case owned by the thread buyer', async () => {
    await insertMessage(convo, 'desk', '', quoteCard())
    expect(h.state.created).toHaveLength(1)
    expect(h.state.created[0].conversationId).toBe('convo-1')
  })

  it('stores the literal kind — `Message.kind` defaults to text, so `!kind` matches nothing', async () => {
    // The board's warning, pinned: every consumer must compare kind to the LITERAL. A card is
    // never distinguishable by an absent/falsy kind, because the column has a default.
    await insertMessage(convo, 'desk', '', quoteCard())
    expect(h.state.created[0].kind).toBe('trip_quote')
    // The announcement has to be TRUE to post, so move the case first (see the status guard).
    h.state.requests[REQ].status = 'arranging'
    await insertMessage(convo, 'desk', '', statusCard('arranging'))
    expect(h.state.created[1].kind).toBe('trip_status')
  })

  it('REFUSES the traveller as author — they act on cards, never mint them', async () => {
    await expect(insertMessage(convo, 'traveller', '', quoteCard())).rejects.toThrow('trip_card_author_forbidden')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a case bound to a DIFFERENT thread', async () => {
    h.state.requests[REQ].conversationId = 'someone-elses-convo'
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow('trip_card_conversation_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a case bound to NO thread', async () => {
    h.state.requests[REQ].conversationId = null
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow('trip_card_conversation_mismatch')
  })

  it('REFUSES a case whose traveller is not this thread’s buyer', async () => {
    // The gate that would stop a mis-bound case surfacing one traveller's trip to another.
    h.state.requests[REQ].profileId = 'someone-else'
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow('trip_card_traveller_mismatch')
  })

  it('REFUSES a case that does not exist', async () => {
    await expect(insertMessage(convo, 'desk', '', quoteCard('ckmissing000000000000001'))).rejects.toThrow('trip_card_request_not_found')
  })
})

describe('trip card meta shape', () => {
  it('persists EXACTLY the handle — no money, no extra keys', async () => {
    await insertMessage(convo, 'desk', '', quoteCard())
    expect(JSON.parse(h.state.created[0].metaJson!)).toEqual({ v: 1, requestId: REQ })
  })

  it('REFUSES a smuggled money key — .strict() is what makes "no amount from a body" structural', async () => {
    const card = { kind: 'trip_quote' as const, meta: { v: 1, requestId: REQ, feeVnd: 5_000_000 } as never, preview: 'x' }
    await expect(insertMessage(convo, 'desk', '', card)).rejects.toThrow('trip_card_meta_invalid')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES a status that is not a node of the ONE transition map', async () => {
    await expect(insertMessage(convo, 'desk', '', statusCard('refunded'))).rejects.toThrow('trip_card_meta_invalid')
  })

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'REFUSES the inherited Object key %s as a status',
    async (status) => {
      // Object.hasOwn, not `status in TRIP_TRANSITIONS` and not a truthy lookup: both would
      // accept every one of these, so a card could claim status:'constructor'.
      await expect(insertMessage(convo, 'desk', '', statusCard(status))).rejects.toThrow('trip_card_meta_invalid')
    },
  )

  it('accepts every real node of the transition map — when the case IS at that status', async () => {
    const nodes = ['requested', 'reviewing', 'quoted', 'accepted', 'arranging', 'completed', 'declined', 'cancelled']
    for (const status of nodes) {
      h.state.requests[REQ].status = status
      await insertMessage(convo, 'desk', '', statusCard(status))
    }
    expect(h.state.created).toHaveLength(nodes.length)
  })

  it('REFUSES an announcement the case has already moved past', async () => {
    // codex refuted the ungated version: without this predicate the desk could publish any
    // valid status as a fact that had happened. A superseded announcement is misinformation
    // about someone's trip, so it is dropped rather than posted.
    h.state.requests[REQ].status = 'arranging'
    await expect(insertMessage(convo, 'desk', '', statusCard('reviewing'))).rejects.toThrow('trip_card_conversation_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES meta on a plain text message', async () => {
    const card = { kind: 'text' as const, meta: { v: 1, requestId: REQ } as never }
    await expect(insertMessage(convo, 'desk', 'hello', card)).rejects.toThrow('message_meta_not_allowed')
  })
})

describe('the transaction guard re-asserts the binding', () => {
  it('is an UPDATE whose WHERE carries every re-assertable gate — a read would not lock', async () => {
    await insertMessage(convo, 'desk', '', quoteCard())
    // A quote has no status to assert; the binding AND the traveller are both re-proven.
    expect(h.state.requestGuardWhere).toEqual({ id: REQ, conversationId: 'convo-1', profileId: 'traveller' })
  })

  it('adds the announced status to the guard for a trip_status card', async () => {
    await insertMessage(convo, 'desk', '', statusCard('quoted'))
    expect(h.state.requestGuardWhere).toEqual({ id: REQ, conversationId: 'convo-1', profileId: 'traveller', status: 'quoted' })
  })

  it('REFUSES when the traveller changed under the transaction', async () => {
    // Gate (3) is no longer resting on a read a concurrent write could invalidate.
    h.state.requests[REQ].profileId = 'someone-else-entirely'
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow(/trip_card_(traveller_mismatch|conversation_mismatch)/)
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES when the case is rebound BETWEEN the gate and the insert', async () => {
    // buildTripCardMeta saw convo-1; the transaction sees the rebind. Zero rows match, so the
    // whole transaction — message included — rolls back.
    h.state.rebindTo = 'a-newer-thread'
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow('trip_card_conversation_mismatch')
    expect(h.state.created).toHaveLength(0)
  })

  it('REFUSES when the conversation vanished under the transaction', async () => {
    h.state.conversationExists = false
    await expect(insertMessage(convo, 'desk', '', quoteCard())).rejects.toThrow('trip_card_conversation_gone')
    expect(h.state.created).toHaveLength(0)
  })
})

describe('read side', () => {
  it('round-trips both kinds', () => {
    expect(parseMessageMeta('trip_quote', JSON.stringify({ v: 1, requestId: REQ }))).toEqual({ v: 1, requestId: REQ })
    expect(parseMessageMeta('trip_status', JSON.stringify({ v: 1, requestId: REQ, status: 'quoted' }))).toEqual({ v: 1, requestId: REQ, status: 'quoted' })
  })

  it('re-validates on READ, so a row that bypassed insertMessage cannot render as a live card', () => {
    // Raw SQL, a migration, a hand-edit: none of them went through the write gate.
    expect(parseMessageMeta('trip_quote', JSON.stringify({ v: 1, requestId: REQ, feeVnd: 9 }))).toBeNull()
    expect(parseMessageMeta('trip_status', JSON.stringify({ v: 1, requestId: REQ, status: 'refunded' }))).toBeNull()
    expect(parseMessageMeta('trip_status', JSON.stringify({ v: 1, requestId: REQ, status: 'toString' }))).toBeNull()
  })

  it('degrades to null rather than throwing on junk', () => {
    expect(parseMessageMeta('trip_quote', 'not json')).toBeNull()
    expect(parseMessageMeta('trip_quote', null)).toBeNull()
    expect(parseMessageMeta('trip_status', JSON.stringify({ v: 2, requestId: REQ, status: 'quoted' }))).toBeNull()
  })

  it('returns null for a kind that carries no meta', () => {
    expect(parseMessageMeta('text', JSON.stringify({ v: 1, requestId: REQ }))).toBeNull()
    expect(parseMessageMeta('offer', JSON.stringify({ v: 1, requestId: REQ }))).toBeNull()
  })
})

// The registry pin. META_SCHEMAS maps kind -> schema, and MetaForKind claims those two agree.
// tsc only half-enforces that (a too-WIDE schema compiles clean — see the note on META_SCHEMAS),
// so the other half is proven here: every schema must accept its OWN payload and reject every
// other kind's. Because all of them are .strict(), a mis-mapped row shows up as an unknown key.
describe('the registry maps each kind to ITS OWN schema', () => {
  const APP = '1a2b3c4d-0001-4001-8001-000000000001'
  const DOC = '7c1d2e3f-4444-4555-8666-777788889999'
  const payloads = {
    visa_step: { v: 1, step: 1, applicationId: APP, state: 'active' },
    visa_checkout: { v: 1, applicationId: APP, amountUsd: 25, status: 'unpaid' },
    visa_result: { v: 1, applicationId: APP, documentId: DOC, reference: 'EV-1042' },
    visa_picker: { v: 1, applicationId: APP, state: 'active' },
    trip_quote: { v: 1, requestId: REQ },
    trip_status: { v: 1, requestId: REQ, status: 'quoted' },
  } as const
  const kinds = Object.keys(payloads) as Array<keyof typeof payloads>

  it.each(kinds)('%s accepts its own payload', (kind) => {
    expect(parseMessageMeta(kind, JSON.stringify(payloads[kind]))).not.toBeNull()
  })

  it('rejects every cross-kind payload', () => {
    const accepted: string[] = []
    for (const kind of kinds) {
      for (const other of kinds) {
        if (kind === other) continue
        if (parseMessageMeta(kind, JSON.stringify(payloads[other])) !== null) accepted.push(`${kind} accepted ${other}`)
      }
    }
    // Named rather than counted, so a regression says WHICH pair collapsed.
    expect(accepted).toEqual([])
  })
})
