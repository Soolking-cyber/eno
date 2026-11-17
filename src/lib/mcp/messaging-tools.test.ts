import { describe, expect, it, vi, beforeEach } from 'vitest'

/** The chat tools' own rules (messaging-tools.ts): disclosure, no contact/payment details, offers, budgets, scope of threads. */
const h = vi.hoisted(() => ({
  thread: null as Record<string, unknown> | null,
  sent: [] as { path: string; body: unknown; agent: unknown }[],
  email: 'buyer@example.com',
  listing: { price: 5_000_000, listingType: 'sell', negotiable: true, sellerId: 's9', seller: { ownerId: 'p9' } } as Record<string, unknown> | null,
  existing: null as { id: string } | null,
  sameListing: null as { id: string } | null,
  limited: new Set<string>(),
}))

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (bucket: string) => ({ success: !h.limited.has(bucket), limit: 1, remaining: 0, resetSec: 600 }),
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/log', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => ({ email: h.email }) },
    listing: { findFirst: async () => h.listing },
    conversation: { findMany: async () => [], findFirst: async ({ where }: { where: { listingId?: unknown } }) => (typeof where.listingId === 'string' ? h.sameListing : h.existing) },
  },
}))
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
async function record(path: string, req: Request) {
  const { agentOf } = await import('@/lib/api/agent-actor')
  h.sent.push({ path, body: req.method === 'POST' ? await req.json() : null, agent: agentOf(req) })
}
vi.mock('@/app/api/conversations/route', () => ({
  GET: async () => json({ conversations: [] }),
  POST: async (req: Request) => { await record('start', req); return json({ id: 'cv1', created: true }) },
}))
vi.mock('@/app/api/conversations/[id]/route', () => ({
  GET: async (req: Request) => { await record('thread', req); return json(h.thread) },
}))
vi.mock('@/app/api/conversations/[id]/messages/route', () => ({
  POST: async (req: Request) => { await record('send', req); return json({ id: 'm9', kind: 'text' }) },
}))
vi.mock('@/app/api/conversations/[id]/offer/route', () => ({
  POST: async (req: Request) => { await record('offer', req); return json({ ok: true }) },
}))

import { MESSAGING_TOOLS, AI_PREFIX, agentTextProblem, offerProblem } from './messaging-tools'
import { ToolError } from './tool-types'
import { OAUTH_ISSUER } from '@/lib/api/oauth'

const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['messages:read', 'messages:write']) } as never
const tool = (n: string) => MESSAGING_TOOLS.find((t) => t.name === n)!
const call = (n: string, args: Record<string, unknown>) => tool(n).handler(AUTH, args)
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return e instanceof ToolError ? e.code : String(e) } }

const msg = (id: string, mine: boolean, body: string, kind = 'text') => ({ id, mine, body, kind, createdAt: '2026-11-17T00:00:00.000Z', offerAmount: null, offerStatus: null })
const THREAD = (over: Record<string, unknown> = {}) => ({
  id: 'cv1', kind: 'listing', iAmSeller: false, teacher: null, counterpart: { name: 'Shop' },
  listing: { id: 'l1', title: 'Honda Vision', price: 18_000_000, priceUnit: null, negotiable: true },
  messages: [msg('m1', false, 'Hello')], ...over,
})

beforeEach(() => {
  h.sent = []; h.thread = THREAD(); h.email = 'buyer@example.com'; h.limited = new Set()
  h.listing = { price: 5_000_000, listingType: 'sell', negotiable: true, sellerId: 's9', seller: { ownerId: 'p9' } }
  h.existing = null
  h.sameListing = null
})

describe('agentTextProblem', () => {
  it('refuses phones, emails, outside links and account numbers; lets prices and eno links through', () => {
    expect(agentTextProblem('Call me on 0901 234 567')).toMatch(/phone/)
    expect(agentTextProblem('mail me: a.b@gmail.com')).toMatch(/email/)
    expect(agentTextProblem('add me on Zalo')).toMatch(/another app/)
    expect(agentTextProblem('dm @seller_hcm')).toMatch(/another app/)
    expect(agentTextProblem('STK １９０３４５６７８９１２')).not.toBeNull() // full-width digits
    expect(agentTextProblem('STK 1903\u200b4567\u200b8912')).not.toBeNull() // zero-width splits
    expect(agentTextProblem('see https://evil.example/pay')).toMatch(/link/)
    expect(agentTextProblem('pay at bit.ly/xyz')).toMatch(/link/)
    expect(agentTextProblem('Chuyển khoản STK 1903 4567 8910 12 Techcombank')).toMatch(/long number/)
    expect(agentTextProblem('Would you take 35.000.000 đ? It is listed at 38,000,000.')).toBeNull()
    expect(agentTextProblem(`Is ${OAUTH_ISSUER}/listings/cmumdd7j604h49tq4ipbjg8w8 still available?`)).toBeNull() // this site's own links
    expect(agentTextProblem('2 bedrooms, 75 m2, floor 12')).toBeNull()
    expect(agentTextProblem('Between 35.000.000 - 36.000.000 đ?')).toBeNull() // a range is two prices
    expect(agentTextProblem('STK: 1903-4567-8910')).toMatch(/long number|bank account/)
    expect(agentTextProblem('STK 190.345.678.912 Techcombank')).toMatch(/bank account/) // dots do not make it a price
    expect(agentTextProblem('gọi 091.234.567.8')).not.toBeNull() // a leading 0 is never a price
    expect(agentTextProblem('Giá 1.250.000.000 đ, thương lượng')).toBeNull() // a 1.25 billion flat is a price
  })
})

describe('offerProblem', () => {
  it('wants whole VND near the asking price', () => {
    expect(offerProblem(3.5, 4_000_000)).toMatch(/3500000/) // "3.5 million" as 3.5
    expect(offerProblem(3_500_000, 4_000_000)).toBeNull()
    expect(offerProblem(500_000, 4_000_000)).toMatch(/under 20%/)
    expect(offerProblem(7_000_000, 4_000_000)).toMatch(/over 110%/) // a buyer's agent never overpays much
    expect(offerProblem(5_000_000, 4_000_000, 'seller')).toBeNull()
    expect(offerProblem(2_500_000, 4_000_000, 'seller')).toMatch(/under 70%/) // a seller's agent never undercuts much
    expect(offerProblem(20_000, null)).toMatch(/no asking price/) // nothing to anchor a binding offer to
  })
})

describe('the chat tools', () => {
  it('mark every message as an AI\'s, and act as the person through the route', async () => {
    await call('send_message', { conversation_id: 'cv1', message: 'Is it still available?' })
    const send = h.sent.find((s) => s.path === 'send')!
    expect(send.body).toEqual({ body: `${AI_PREFIX}Is it still available?` })
    expect(send.agent).toEqual({ profileId: 'p1', keyId: 'k1' })
    h.sent = []
    await call('contact_seller', { listing_id: 'l1', offer_amount: 4_500_000 })
    // The text opens the thread; the offer goes through the thread's send, so the offer row itself carries "🤖 AI".
    expect(h.sent.find((s) => s.path === 'start')!.body).toEqual({ listingId: 'l1', message: '🤖 AI' })
    expect(h.sent.find((s) => s.path === 'send')!.body).toEqual({ body: '🤖 AI', offerAmount: 4_500_000 })
  })

  it('read with peek, and refuse threads agents are kept out of', async () => {
    await call('get_conversation', { conversation_id: 'cv1' })
    expect(h.sent[0]).toMatchObject({ path: 'thread', agent: { profileId: 'p1' } })
    for (const over of [{ teacher: { shared: false } }, { desk: 'rental' }, { kind: 'visa' }, { listing: null }]) {
      h.thread = THREAD(over)
      expect(await code(call('get_conversation', { conversation_id: 'cv1' }))).toBe('not_available_to_agents')
    }
  })

  it('refuse contact and payment details before anything is sent', async () => {
    expect(await code(call('send_message', { conversation_id: 'cv1', message: 'Zalo me 0912345678' }))).toBe('contact_details')
    expect(h.sent).toEqual([])
  })

  it('stop after three unanswered agent messages in a row', async () => {
    h.thread = THREAD({ messages: [msg('m1', false, 'Hi'), msg('m2', true, `${AI_PREFIX}a`), msg('m3', true, `${AI_PREFIX}b`), msg('m4', true, `${AI_PREFIX}c`)] })
    expect(await code(call('send_message', { conversation_id: 'cv1', message: 'd' }))).toBe('waiting_for_reply')
    h.thread = THREAD({ messages: [msg('m2', true, `${AI_PREFIX}a`), msg('m3', true, `${AI_PREFIX}b`), msg('m5', false, 'ok')] })
    expect(await code(call('send_message', { conversation_id: 'cv1', message: 'd' }))).toBe('ok')
  })

  it('refuse offers on a fixed-price listing before the route (no trust docked), and a teacher profile', async () => {
    h.thread = THREAD({ listing: { id: 'l1', title: 'x', price: 1_000_000, negotiable: false } })
    expect(await code(call('send_message', { conversation_id: 'cv1', offer_amount: 900_000 }))).toBe('not_negotiable')
    h.listing = { price: 5_000_000, listingType: 'sell', negotiable: false, sellerId: 's9', seller: { ownerId: 'p9' } }
    expect(await code(call('contact_seller', { listing_id: 'l1', offer_amount: 4_000_000 }))).toBe('not_negotiable')
    h.listing = { price: 0, listingType: 'teacher', negotiable: false, sellerId: 's9', seller: { ownerId: 'p9' } }
    expect(await code(call('contact_seller', { listing_id: 'l1', message: 'Hello' }))).toBe('not_available_to_agents')
    expect(h.sent.filter((s) => s.path !== 'thread')).toEqual([])
  })

  it('contact_seller on a listing the person already talks about sends ONE message, offer and note together', async () => {
    h.sameListing = { id: 'cv1' }
    await call('contact_seller', { listing_id: 'l1', message: 'Would you take this?', offer_amount: 4_500_000 })
    expect(h.sent.filter((s) => s.path === 'start')).toEqual([])
    expect(h.sent.filter((s) => s.path === 'send').map((s) => s.body)).toEqual([{ body: `${AI_PREFIX}Would you take this?`, offerAmount: 4_500_000 }])
  })

  it('contact_seller into a thread the person already has with that seller keeps that thread\'s caps', async () => {
    h.existing = { id: 'cv1' }
    h.thread = THREAD({ messages: [msg('m2', true, `${AI_PREFIX}a`), msg('m3', true, `${AI_PREFIX}b`), msg('m4', true, `${AI_PREFIX}c`)] })
    expect(await code(call('contact_seller', { listing_id: 'l1', message: 'hello again' }))).toBe('waiting_for_reply')
    expect(h.sent.filter((s) => s.path === 'start')).toEqual([])
    h.listing = { price: 5_000_000, listingType: 'sell', negotiable: true, sellerId: 's9', seller: { ownerId: null } }
    expect(await code(call('contact_seller', { listing_id: 'l1', message: 'hi' }))).toBe('not_available_to_agents')
  })

  it('never let a store-review test account write, and honour the per-person budgets', async () => {
    h.email = 'ai-review@eno.vn'
    expect(await code(call('send_message', { conversation_id: 'cv1', message: 'hi' }))).toBe('test_account')
    h.email = 'buyer@example.com'
    h.limited.add('agent-thread-new')
    expect(await code(call('contact_seller', { listing_id: 'l1', message: 'hi' }))).toBe('rate_limited')
  })

  it('decline only: the route call says decline, and inputs are checked', async () => {
    await call('decline_offer', { conversation_id: 'cv1', message_id: 'm2' })
    expect(h.sent.find((s) => s.path === 'offer')!.body).toEqual({ messageId: 'm2', action: 'decline' })
    expect(await code(call('decline_offer', { conversation_id: '../x', message_id: 'm2' }))).toBe('invalid_input')
    expect(MESSAGING_TOOLS.map((t) => t.name)).not.toContain('accept_offer')
  })
})
