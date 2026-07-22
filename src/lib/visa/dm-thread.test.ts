import { beforeEach, describe, expect, it, vi } from 'vitest'

// dm-thread is the ONE authoring surface for visa cards and the ONE writer of
// Conversation.visaApplicationId, so its security properties are asserted here rather
// than left to a live-DB e2e: the sender is never a caller value, the binding is written
// only after ownership is proven, a rebind releases the previous case, a released case
// can still be stamped paid, and no client number decides what is charged.
//
// ⚠️ THE PRISMA MOCK IS A TINY QUERY ENGINE, NOT A STUB — it HONOURS `where` (and records
// it). That is deliberate and load-bearing: the earlier version destructured only `data`,
// so every scope in this file's queries was invisible to the suite. Dropping
// `buyerProfileId` from the thread-reuse lookup — a cross-tenant bug — left it green.
// Any clause the engine does not model THROWS rather than being ignored, so a test can
// never pass because the mock quietly dropped a filter.

/** The Conversation row shape this module reads and writes. */
type ConvoRow = {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  sellerId: string
  listingId: string
  visaApplicationId: string | null
}
/** The Message row shape (visa cards only — `createdAt` is a monotonic counter). */
type MessageRow = { id: string; conversationId: string; kind: string; metaJson: string | null; createdAt: number }

const h = vi.hoisted(() => ({
  state: {
    shop: null as null | { id: string; name: string; ownerId: string | null },
    products: [] as Array<{ id: string }>,
    /** visa_applications, by id. Absent = no row. */
    applications: {} as Record<string, { user_id: string | null; paid_at: string | null }>,
    applicationError: null as unknown,
    events: [] as Array<{ event: string }>,
    eventsError: null as unknown,
    /** THE Conversation TABLE. */
    conversations: [] as ConvoRow[],
    /** THE Message TABLE — the insertMessage mock really appends cards to it. */
    messages: [] as MessageRow[],
    createThrows: null as null | { code?: string },
    /** Row the WINNER of a P2002 create race committed while we were losing it. */
    raceWinner: null as null | ConvoRow,
    createdConversationId: 'convo-created',
    /** Fault injection: the unbind matches nothing. Proves the CLAIM is scoped too. */
    refuseUnbind: false,
    payments: null as null | { providers: string[]; feeCents: number; currency: 'USD' },
    insertThrows: null as null | Error,
    checkoutStatusResult: true,
    // observations
    writes: [] as string[],
    unbinds: 0,
    queries: [] as Array<{ model: string; op: string; where: unknown }>,
    inserted: [] as Array<{ convo: any; senderId: string; text: string; opts: any }>,
    recordedEvents: [] as Array<any[]>,
    checkoutStatusCalls: [] as Array<any[]>,
    seq: 0,
  },
}))

vi.mock('../db', () => {
  /** Equality + `in` + `NOT`, which is every clause this module uses. Anything else throws. */
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true
    for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
      if (key === 'NOT') {
        if (matches(row, cond)) return false
        continue
      }
      if (cond !== null && typeof cond === 'object') {
        const filter = cond as Record<string, unknown>
        if (Array.isArray(filter.in)) {
          if (!filter.in.includes(row[key])) return false
          continue
        }
        throw new Error(`mock: unsupported filter on ${key}: ${JSON.stringify(cond)}`)
      }
      if ((row[key] ?? null) !== (cond ?? null)) return false
    }
    return true
  }
  const find = <T extends Record<string, unknown>>(rows: T[], where: unknown): T[] =>
    rows.filter((row) => matches(row, where))

  const conversation = {
    findUnique: vi.fn(async ({ where }: any) => {
      h.state.queries.push({ model: 'conversation', op: 'findUnique', where })
      return find(h.state.conversations as any, where)[0] ?? null
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      h.state.queries.push({ model: 'conversation', op: 'findFirst', where })
      return find(h.state.conversations as any, where)[0] ?? null
    }),
    findMany: vi.fn(async ({ where, take }: any) => {
      h.state.queries.push({ model: 'conversation', op: 'findMany', where })
      const rows = find(h.state.conversations as any, where)
      return take ? rows.slice(0, take) : rows
    }),
    create: vi.fn(async ({ data }: any) => {
      h.state.writes.push('conversation.create')
      if (h.state.createThrows) {
        // The winner's row is already committed by the time our insert bounces.
        if (h.state.raceWinner) h.state.conversations.push(h.state.raceWinner)
        throw h.state.createThrows
      }
      const row: ConvoRow = {
        id: h.state.createdConversationId,
        buyerProfileId: data.buyerProfileId,
        sellerProfileId: data.sellerProfileId ?? null,
        sellerId: data.sellerId,
        listingId: data.listingId,
        visaApplicationId: null,
      }
      h.state.conversations.push(row)
      return { id: row.id }
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      h.state.queries.push({ model: 'conversation', op: 'updateMany', where })
      const unbinding = data.visaApplicationId === null
      if (unbinding && h.state.refuseUnbind) return { count: 0 }
      const rows = find(h.state.conversations as any, where)
      for (const row of rows) Object.assign(row, data)
      if (rows.length) {
        if (unbinding) {
          h.state.writes.push('unbind')
          h.state.unbinds += 1
        } else {
          h.state.writes.push(`bind:${data.visaApplicationId}`)
        }
      }
      return { count: rows.length }
    }),
  }
  const message = {
    findMany: vi.fn(async ({ where, orderBy, take }: any) => {
      h.state.queries.push({ model: 'message', op: 'findMany', where })
      const rows = find(h.state.messages as any, where)
      if (orderBy?.createdAt === 'desc') rows.sort((a: any, b: any) => b.createdAt - a.createdAt)
      return take ? rows.slice(0, take) : rows
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = h.state.messages.find((m) => m.id === where?.id)
      if (!row) throw new Error('mock: message.update on a missing row')
      Object.assign(row, data)
      h.state.writes.push(`message.update:${row.id}`)
      return row
    }),
  }
  const dbMock: any = { conversation, message, $transaction: async (fn: any) => fn(dbMock) }
  return { db: dbMock }
})

vi.mock('../visa-shop', () => ({
  getVisaShopSeller: async () => h.state.shop,
  getVisaShopProductsForSale: async () => h.state.products,
}))

vi.mock('../messages', async () => {
  // The real field-name allowlist, so the needsReview filter is tested honestly.
  const { visaPayloadSchema } = await import('./schema')
  const fields = new Set(Object.keys(visaPayloadSchema.shape))
  return {
    isVisaPayloadFieldName: (name: string) => fields.has(name),
    // The REAL parseMessageMeta cannot be imported: src/lib/messages.ts pulls in
    // `@/generated/prisma/client`, and `@/…` does not resolve under vitest (the very
    // reason dm-thread.ts uses relative specifiers). This stand-in keeps the two
    // properties dm-thread depends on — TOLERANT (a malformed blob is null, never a
    // throw) and it re-asserts the card's own shape — not the strict zod parse itself.
    parseMessageMeta: (kind: string, metaJson: string | null | undefined) => {
      if (!metaJson || (kind !== 'visa_step' && kind !== 'visa_checkout')) return null
      try {
        const parsed = JSON.parse(metaJson)
        if (!parsed || parsed.v !== 1 || typeof parsed.applicationId !== 'string') return null
        if (kind === 'visa_checkout' && !['unpaid', 'paid', 'failed'].includes(parsed.status)) return null
        return parsed
      } catch {
        return null
      }
    },
    insertMessage: async (convo: any, senderId: string, text: string, opts: any) => {
      if (h.state.insertThrows) throw h.state.insertThrows
      h.state.writes.push('insertMessage')
      h.state.inserted.push({ convo, senderId, text, opts })
      // Persist the card so a LATER lookup (markVisaThreadPaid) has a real row to find.
      const id = `message-${++h.state.seq}`
      h.state.messages.push({
        id, conversationId: convo.id, kind: opts?.kind ?? 'text',
        metaJson: opts?.meta ? JSON.stringify(opts.meta) : null, createdAt: h.state.seq,
      })
      return { id }
    },
    setVisaCheckoutStatus: async (...args: any[]) => {
      h.state.checkoutStatusCalls.push(args)
      return h.state.checkoutStatusResult
    },
  }
})

vi.mock('./db', () => ({
  getVisaDb: () => ({
    from: (table: string) => {
      if (table === 'visa_applications') {
        let columns = ''
        let id = ''
        const chain: any = {
          select: (cols: string) => { columns = cols; return chain },
          eq: (column: string, value: string) => { if (column === 'id') id = value; return chain },
          maybeSingle: async () => {
            h.state.writes.push(columns.includes('paid_at') ? 'paid-evidence-read' : 'ownership-read')
            if (h.state.applicationError) return { data: null, error: h.state.applicationError }
            return { data: h.state.applications[id] ?? null, error: null }
          },
        }
        return chain
      }
      const chain: any = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        limit: async () => (h.state.eventsError
          ? { data: null, error: h.state.eventsError }
          : { data: h.state.events, error: null }),
      }
      return chain
    },
  }),
  visaTableMissing: () => false,
}))

vi.mock('./records', () => ({
  recordVisaEvent: async (...args: any[]) => {
    if (args[2] === 'throw') throw new Error('visa_event_failed')
    h.state.recordedEvents.push(args)
  },
}))

vi.mock('./payments', () => ({ visaPaymentsConfig: () => h.state.payments }))

import {
  bindVisaThread, findVisaThread, getVisaThreadMode, markVisaThreadPaid,
  sendVisaCheckoutCard, sendVisaStepCard, setVisaThreadMode,
} from './dm-thread'
import { visaDmStepPreview } from './dm-steps'

const APP_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_APP_ID = '99999999-2222-4333-8444-555555555555'
const BUYER = 'buyer-profile-id'
const SHOP_OWNER = 'shop-owner-profile-id'
const SHOP = { id: 'seller-1', name: 'eno e-Visa', ownerId: SHOP_OWNER }
/** Payments LIVE. feeCents survives only as the dormant/live switch — never as a price. */
const LIVE_PAYMENTS = { providers: ['stripe'], feeCents: 2500, currency: 'USD' as const }

/** A conversation row in the visa desk's own storefront, unbound unless told otherwise. */
const convoRow = (over: Partial<ConvoRow> = {}): ConvoRow => ({
  id: 'convo-1', buyerProfileId: BUYER, sellerProfileId: SHOP_OWNER,
  sellerId: SHOP.id, listingId: 'listing-1', visaApplicationId: null, ...over,
})
const convoById = (id: string) => h.state.conversations.find((c) => c.id === id)
const cardsIn = (conversationId: string) =>
  h.state.messages.filter((m) => m.conversationId === conversationId && m.kind === 'visa_checkout')
const metaOf = (messageId: string) => JSON.parse(h.state.messages.find((m) => m.id === messageId)!.metaJson!)
const whereOf = (model: string, op: string) =>
  h.state.queries.filter((q) => q.model === model && q.op === op).map((q) => q.where as Record<string, unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, {
    shop: SHOP, products: [{ id: 'listing-1' }],
    applications: {
      [APP_ID]: { user_id: BUYER, paid_at: null },
      [OTHER_APP_ID]: { user_id: BUYER, paid_at: null },
    },
    applicationError: null,
    events: [], eventsError: null,
    conversations: [], messages: [],
    createThrows: null, raceWinner: null, createdConversationId: 'convo-created', refuseUnbind: false,
    payments: null, insertThrows: null, checkoutStatusResult: true,
    writes: [], unbinds: 0, queries: [], inserted: [], recordedEvents: [], checkoutStatusCalls: [], seq: 0,
  })
})

describe('bindVisaThread', () => {
  it('creates the thread and binds it when the buyer owns the case', async () => {
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-created', created: true })
    // The BINDING really landed on the row, not just a call that was made.
    expect(convoById('convo-created')?.visaApplicationId).toBe(APP_ID)
  })

  it('reuses the buyer’s existing visa-desk thread (created:false)', async () => {
    h.state.conversations = [convoRow({ id: 'convo-existing' })]
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-existing', created: false })
    expect(h.state.writes).not.toContain('conversation.create')
    expect(convoById('convo-existing')?.visaApplicationId).toBe(APP_ID)
  })

  it('is a no-op when the case is already bound to this buyer’s thread', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID })]
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-1', created: false })
    expect(h.state.writes.filter((w) => w.startsWith('bind:'))).toEqual([])
  })

  // ── the reuse lookup's SCOPE (this is a cross-tenant boundary, not a nicety) ──────
  it('never reuses ANOTHER buyer’s visa-desk thread — it opens a new one', async () => {
    h.state.conversations = [convoRow({ id: 'convo-foreign', buyerProfileId: 'another-buyer' })]
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-created', created: true })
    // The stranger's thread is untouched: no binding, no card surface into their inbox.
    expect(convoById('convo-foreign')?.visaApplicationId).toBeNull()
    // …and the query that could have found it was scoped to BOTH the shop and the buyer.
    expect(whereOf('conversation', 'findFirst')[0]).toEqual({ sellerId: SHOP.id, buyerProfileId: BUYER })
  })

  it('UNBINDS the previous case in the same transaction before claiming (rebind)', async () => {
    // A REAL previous binding, on a real row — the whole point of the test.
    h.state.conversations = [convoRow({ visaApplicationId: OTHER_APP_ID })]
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-1', created: false })
    expect(h.state.unbinds).toBe(1)
    // Order matters: releasing the @unique column has to precede the claim.
    expect(h.state.writes.indexOf('unbind')).toBeLessThan(h.state.writes.indexOf(`bind:${APP_ID}`))
    // End state: the thread names the NEW case, and the old one is released for good.
    expect(convoById('convo-1')?.visaApplicationId).toBe(APP_ID)
    expect(await findVisaThread(OTHER_APP_ID)).toBeNull()
    expect(await findVisaThread(APP_ID)).toEqual({ conversationId: 'convo-1', buyerProfileId: BUYER, sellerProfileId: SHOP_OWNER })
  })

  it('does NOT unbind a thread that was never bound', async () => {
    h.state.conversations = [convoRow({ id: 'convo-existing' })]
    await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(h.state.unbinds).toBe(0)
    expect(h.state.writes).not.toContain('unbind')
  })

  it('never overwrites a live binding it did not release', async () => {
    // Fault injection: the unbind matches nothing while the row IS bound. Postgres can't
    // produce that, but it is exactly what a claim missing its `visaApplicationId: null`
    // scope would sail through — so it is how that scope is proven to exist.
    h.state.conversations = [convoRow({ visaApplicationId: OTHER_APP_ID })]
    h.state.refuseUnbind = true
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'thread_conflict' })
    expect(convoById('convo-1')?.visaApplicationId).toBe(OTHER_APP_ID)
  })

  // ── the security core ───────────────────────────────────────────────────────────
  it('refuses a case the buyer does not own — and writes NOTHING first', async () => {
    h.state.applications[APP_ID] = { user_id: 'somebody-else', paid_at: null }
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: false, error: 'not_owner' })
    expect(h.state.writes).toEqual(['ownership-read'])
  })

  it('checks ownership BEFORE the binding write, not after', async () => {
    await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(h.state.writes[0]).toBe('ownership-read')
    expect(h.state.writes.indexOf('ownership-read')).toBeLessThan(h.state.writes.indexOf(`bind:${APP_ID}`))
  })

  it('fails CLOSED when the ownership lookup errors', async () => {
    h.state.applicationError = { message: 'boom' }
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'not_owner' })
    expect(h.state.writes).toEqual(['ownership-read'])
  })

  it('refuses a case whose row does not exist', async () => {
    h.state.applications = {}
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'not_owner' })
  })

  it('refuses to move a binding that lives under another user’s thread', async () => {
    h.state.conversations = [convoRow({ id: 'convo-other', buyerProfileId: 'someone-else', visaApplicationId: APP_ID })]
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'thread_conflict' })
    expect(h.state.writes).toEqual(['ownership-read'])
    expect(convoById('convo-other')?.visaApplicationId).toBe(APP_ID)
  })

  it('reports shop_unavailable before touching the case at all', async () => {
    h.state.shop = null
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'shop_unavailable' })
    expect(h.state.writes).toEqual([])
  })

  it('refuses the shop applying to itself', async () => {
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: SHOP_OWNER })).toEqual({ ok: false, error: 'shop_unavailable' })
  })

  it('reports listing_unavailable when the storefront has no sellable product', async () => {
    h.state.products = []
    expect(await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })).toEqual({ ok: false, error: 'listing_unavailable' })
  })

  it('rejects a non-uuid application id without any lookup', async () => {
    expect(await bindVisaThread({ applicationId: 'not-a-uuid', buyerProfileId: BUYER })).toEqual({ ok: false, error: 'not_owner' })
    expect(h.state.writes).toEqual([])
  })

  it('reuses the winner’s thread after a P2002 create race', async () => {
    h.state.createThrows = { code: 'P2002' }
    h.state.raceWinner = convoRow({ id: 'convo-winner' })
    const result = await bindVisaThread({ applicationId: APP_ID, buyerProfileId: BUYER })
    expect(result).toEqual({ ok: true, conversationId: 'convo-winner', created: false })
    expect(convoById('convo-winner')?.visaApplicationId).toBe(APP_ID)
  })
})

describe('findVisaThread', () => {
  it('returns the bound thread', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID })]
    expect(await findVisaThread(APP_ID)).toEqual({ conversationId: 'convo-1', buyerProfileId: BUYER, sellerProfileId: SHOP_OWNER })
    // Looked up BY THE BINDING COLUMN — not by scanning for whatever came back first.
    expect(whereOf('conversation', 'findUnique')[0]).toEqual({ visaApplicationId: APP_ID })
  })

  it('is null for an unbound case, an unclaimed seller, or a non-uuid', async () => {
    expect(await findVisaThread(APP_ID)).toBeNull()
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID, sellerProfileId: null })]
    expect(await findVisaThread(APP_ID)).toBeNull()
    expect(await findVisaThread('nope')).toBeNull()
  })

  it('does not answer with a thread bound to a DIFFERENT case', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: OTHER_APP_ID })]
    expect(await findVisaThread(APP_ID)).toBeNull()
  })
})

describe('sendVisaStepCard', () => {
  beforeEach(() => { h.state.conversations = [convoRow({ visaApplicationId: APP_ID })] })

  it('authors the card AS THE SHOP SELLER, with an empty body and the constant preview', async () => {
    const result = await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 2 })
    expect(result).toEqual({ messageId: 'message-1' })
    const [call] = h.state.inserted
    // The sender is the storefront owner the module resolved — no argument supplied one.
    expect(call.senderId).toBe(SHOP_OWNER)
    expect(call.text).toBe('')
    expect(call.opts.kind).toBe('visa_step')
    expect(call.opts.preview).toBe(visaDmStepPreview(2))
    expect(call.opts.meta).toEqual({ v: 1, step: 2, applicationId: APP_ID, state: 'active' })
  })

  it('keeps only payload FIELD NAMES in needsReview', async () => {
    await sendVisaStepCard({
      conversationId: 'convo-1', applicationId: APP_ID, step: 2,
      needsReview: ['surname', 'passportNumber', 'surname', 'Nguyen Van A', 'not_a_field'],
    })
    expect(h.state.inserted[0].opts.meta.needsReview).toEqual(['surname', 'passportNumber'])
  })

  it('omits needsReview entirely when nothing survives the filter', async () => {
    await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1, needsReview: ['A1234567'] })
    expect(h.state.inserted[0].opts.meta).not.toHaveProperty('needsReview')
  })

  it('refuses when the thread is bound to a DIFFERENT case', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: OTHER_APP_ID })]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
    expect(h.state.inserted).toEqual([])
  })

  it('refuses on an unbound thread, a foreign seller, a missing thread, or no shop', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: null })]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID, sellerProfileId: 'another-seller' })]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
    h.state.conversations = []
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID })]
    h.state.shop = null
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
    expect(h.state.inserted).toEqual([])
  })

  it('addresses the thread it was ASKED for, not whichever one comes first', async () => {
    h.state.conversations = [convoRow({ id: 'convo-decoy', visaApplicationId: null }), convoRow({ id: 'convo-1', visaApplicationId: APP_ID })]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toEqual({ messageId: 'message-1' })
    expect(h.state.inserted[0].convo.id).toBe('convo-1')
    expect(await sendVisaStepCard({ conversationId: 'convo-decoy', applicationId: APP_ID, step: 1 })).toBeNull()
  })

  it('goes quiet once an admin has taken the thread over, and speaks again after handback', async () => {
    h.state.events = [{ event: 'admin_takeover_started' }]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 3 })).toBeNull()
    h.state.events = [{ event: 'admin_takeover_ended' }]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 3 })).toEqual({ messageId: 'message-1' })
  })

  it('keeps emitting while the applicant merely WAITS for a human', async () => {
    h.state.events = [{ event: 'human_help_requested' }]
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 3 })).toEqual({ messageId: 'message-1' })
  })

  it('degrades to null instead of throwing when the write is refused', async () => {
    h.state.insertThrows = new Error('visa_card_author_forbidden')
    expect(await sendVisaStepCard({ conversationId: 'convo-1', applicationId: APP_ID, step: 1 })).toBeNull()
  })
})

// ── PER-PRODUCT PRICING (owner, 2026-07-21) ───────────────────────────────────────
// The 2 × 7 grid (single | multiple × 1H…normal) replaced the flat fee, so this layer
// no longer compares the amount to visaPaymentsConfig().feeCents — that would refuse
// every real price. It validates that the number is MONEY and writes the normalized
// value; resolving WHICH price is the calling route's job.
describe('sendVisaCheckoutCard', () => {
  beforeEach(() => { h.state.conversations = [convoRow({ visaApplicationId: APP_ID })] })

  it('is null while payments are dormant', async () => {
    expect(await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: 25 })).toBeNull()
    expect(h.state.inserted).toEqual([])
  })

  it('mints an UNPAID card at the price the ROUTE resolved, not at the legacy flat fee', async () => {
    h.state.payments = { ...LIVE_PAYMENTS } // feeCents 2500 — deliberately NOT the price
    const result = await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: 79 })
    expect(result).toEqual({ messageId: 'message-1' })
    const [call] = h.state.inserted
    expect(call.senderId).toBe(SHOP_OWNER)
    expect(call.opts.kind).toBe('visa_checkout')
    expect(call.opts.meta).toEqual({ v: 1, applicationId: APP_ID, amountUsd: 79, status: 'unpaid' })
    expect(call.opts.preview).toBe('Phí dịch vụ e-Visa · e-Visa service fee — $79.00')
  })

  it('carries each grid cell’s own price through, normalized to whole cents', async () => {
    h.state.payments = { ...LIVE_PAYMENTS }
    for (const price of [25.99, 79.5, 149, 249.95, 0.01]) {
      h.state.inserted = []
      await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: price })
      expect(h.state.inserted[0]?.opts.meta.amountUsd, `price ${price}`).toBe(price)
    }
  })

  it('refuses anything that is not a positive whole-cent amount', async () => {
    h.state.payments = { ...LIVE_PAYMENTS }
    for (const amount of [0, -25, Number.NaN, Number.POSITIVE_INFINITY, 25.999, -0.004]) {
      expect(await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: amount }), `amount ${amount}`).toBeNull()
    }
    expect(h.state.inserted).toEqual([])
  })

  it('never mints a card already claiming to be paid', async () => {
    h.state.payments = { ...LIVE_PAYMENTS }
    await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: 79 })
    expect(h.state.inserted[0].opts.meta.status).toBe('unpaid')
  })

  it('refuses a thread bound to another case', async () => {
    h.state.payments = { ...LIVE_PAYMENTS }
    h.state.conversations = [convoRow({ visaApplicationId: OTHER_APP_ID })]
    expect(await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: 79 })).toBeNull()
  })

  it('still asks for payment during an admin takeover', async () => {
    h.state.payments = { ...LIVE_PAYMENTS }
    h.state.events = [{ event: 'admin_takeover_started' }]
    expect(await sendVisaCheckoutCard({ conversationId: 'convo-1', applicationId: APP_ID, amountUsd: 79 })).toEqual({ messageId: 'message-1' })
  })
})

describe('markVisaThreadPaid', () => {
  /** Bind a case, mint its checkout card. Returns the card's message id. */
  async function openCaseWithCard(applicationId: string): Promise<string> {
    const bound = await bindVisaThread({ applicationId, buyerProfileId: BUYER })
    expect(bound.ok).toBe(true)
    h.state.payments = { ...LIVE_PAYMENTS }
    const card = await sendVisaCheckoutCard({
      conversationId: (bound as { conversationId: string }).conversationId, applicationId, amountUsd: 79,
    })
    expect(card).not.toBeNull()
    return card!.messageId
  }

  it('delegates to the evidence-gated stamper for the bound thread', async () => {
    h.state.conversations = [convoRow({ visaApplicationId: APP_ID })]
    expect(await markVisaThreadPaid(APP_ID)).toBe(true)
    expect(h.state.checkoutStatusCalls).toEqual([['convo-1', APP_ID, 'paid']])
  })

  it('is false — never a throw — with no thread and no card', async () => {
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
    expect(h.state.checkoutStatusCalls).toEqual([])
    expect(await markVisaThreadPaid('not-a-uuid')).toBe(false)
  })

  it('swallows a lookup failure rather than 500ing a completed capture', async () => {
    const { db } = (await import('../db')) as any
    db.conversation.findUnique.mockImplementationOnce(async () => { throw new Error('db down') })
    await expect(markVisaThreadPaid(APP_ID)).resolves.toBe(false)
  })

  // ── THE REBIND ORPHAN (money bug) ────────────────────────────────────────────────
  // A repeat applicant's second case takes the thread's @unique binding, so the FIRST
  // case can no longer be found by that column. Resolving the card by the APPLICATION is
  // what keeps a capture that really completed from leaving an 'unpaid' card forever.
  it('still stamps a case whose thread was REBOUND to a later case', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    // The repeat applicant starts case B in the same buyer↔visa-desk thread.
    const rebound = await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    expect(rebound.ok).toBe(true)
    expect(await findVisaThread(APP_ID)).toBeNull() // case A is released — the bug's cause
    // …and case A's capture completes.
    h.state.applications[APP_ID].paid_at = '2026-07-22T00:00:00.000Z'
    expect(await markVisaThreadPaid(APP_ID)).toBe(true)
    expect(metaOf(cardA)).toEqual({ v: 1, applicationId: APP_ID, amountUsd: 79, status: 'paid' })
  })

  it('is idempotent for a released case (webhook + confirm-on-return both fire)', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    h.state.applications[APP_ID].paid_at = '2026-07-22T00:00:00.000Z'
    expect(await markVisaThreadPaid(APP_ID)).toBe(true)
    expect(await markVisaThreadPaid(APP_ID)).toBe(true)
    expect(h.state.writes.filter((w) => w === `message.update:${cardA}`)).toHaveLength(1)
  })

  it('refuses to stamp a released case with NO provider evidence', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    expect(h.state.applications[APP_ID].paid_at).toBeNull() // no capture recorded
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
    expect(metaOf(cardA).status).toBe('unpaid')
    expect(h.state.writes).not.toContain(`message.update:${cardA}`)
  })

  it('fails CLOSED when the evidence read errors', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    h.state.applicationError = { message: 'supabase down' }
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
    expect(metaOf(cardA).status).toBe('unpaid')
  })

  it('stamps only the card that NAMES this case, never a neighbour in the same thread', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    // Case B is bound and paid, but has no card of its own yet: the live-binding stamper
    // refuses (the newest card names A), and the fallback must refuse too.
    h.state.checkoutStatusResult = false
    h.state.applications[OTHER_APP_ID].paid_at = '2026-07-22T00:00:00.000Z'
    expect(await markVisaThreadPaid(OTHER_APP_ID)).toBe(false)
    expect(metaOf(cardA).status).toBe('unpaid')
    expect(cardsIn('convo-created')).toHaveLength(1)
  })

  it('never stamps a card living outside the case owner’s own visa-desk threads', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    h.state.applications[APP_ID] = { user_id: 'a-different-user', paid_at: '2026-07-22T00:00:00.000Z' }
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
    expect(metaOf(cardA).status).toBe('unpaid')
  })

  it('fails CLOSED when one case’s cards appear in more than one thread', async () => {
    const cardA = await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    // Corrupt state that this module cannot produce (the binding is @unique) — hand-built.
    h.state.conversations.push(convoRow({ id: 'convo-second' }))
    h.state.messages.push({
      id: 'message-rogue', conversationId: 'convo-second', kind: 'visa_checkout', createdAt: 99,
      metaJson: JSON.stringify({ v: 1, applicationId: APP_ID, amountUsd: 79, status: 'unpaid' }),
    })
    h.state.applications[APP_ID].paid_at = '2026-07-22T00:00:00.000Z'
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
    expect(metaOf(cardA).status).toBe('unpaid')
    expect(metaOf('message-rogue').status).toBe('unpaid')
  })

  it('ignores a card whose metaJson does not parse', async () => {
    await openCaseWithCard(APP_ID)
    await bindVisaThread({ applicationId: OTHER_APP_ID, buyerProfileId: BUYER })
    h.state.messages[0].metaJson = 'not json at all'
    h.state.applications[APP_ID].paid_at = '2026-07-22T00:00:00.000Z'
    expect(await markVisaThreadPaid(APP_ID)).toBe(false)
  })
})

describe('visa thread mode', () => {
  it('answers ai before any takeover event', async () => {
    expect(await getVisaThreadMode(APP_ID)).toBe('ai')
  })

  it('maps the newest event to its mode', async () => {
    for (const [event, mode] of [
      ['human_help_requested', 'human_requested'],
      ['admin_takeover_started', 'admin'],
      ['admin_takeover_ended', 'ai'],
    ] as const) {
      h.state.events = [{ event }]
      expect(await getVisaThreadMode(APP_ID)).toBe(mode)
    }
  })

  it('fails soft to ai on a lookup error or a non-uuid', async () => {
    h.state.eventsError = { message: 'boom' }
    expect(await getVisaThreadMode(APP_ID)).toBe('ai')
    expect(await getVisaThreadMode('not-a-uuid')).toBe('ai')
  })

  it('ignores an event name it does not know', async () => {
    h.state.events = [{ event: 'application_created' }]
    expect(await getVisaThreadMode(APP_ID)).toBe('ai')
  })

  it('writes the matching event, attributed to the actor', async () => {
    await setVisaThreadMode({ applicationId: APP_ID, mode: 'admin', actorType: 'admin', actorRef: 'admin@eno.vn' })
    await setVisaThreadMode({ applicationId: APP_ID, mode: 'human_requested', actorType: 'applicant' })
    await setVisaThreadMode({ applicationId: APP_ID, mode: 'ai', actorType: 'admin' })
    expect(h.state.recordedEvents.map((args) => [args[1], args[2], args[3]])).toEqual([
      ['admin', 'admin_takeover_started', 'admin@eno.vn'],
      ['applicant', 'human_help_requested', undefined],
      ['admin', 'admin_takeover_ended', undefined],
    ])
  })

  it('THROWS when the transition cannot be recorded (the one loud path)', async () => {
    const records = await import('./records')
    vi.spyOn(records, 'recordVisaEvent').mockRejectedValueOnce(new Error('visa_event_failed'))
    await expect(setVisaThreadMode({ applicationId: APP_ID, mode: 'admin', actorType: 'admin' })).rejects.toThrow('visa_event_failed')
  })
})
