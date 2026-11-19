import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * maybeSendPartnerWelcome (owner 2026-11-18: "when someone texts partner stores have an auto message that admins will assist
 * them asap and ask for their phone number"). When it writes the welcome, when it never does, and that it never throws into
 * the customer's send.
 */

type Convo = Record<string, unknown>
const h = vi.hoisted(() => ({
  convo: null as Convo | null,
  spoke: null as { id: string } | null,
  spokeArgs: null as unknown,
  blocked: false,
  nx: 'OK' as 'OK' | null,
  kvSets: [] as unknown[][],
  kvDels: [] as string[],
  inserts: [] as unknown[][],
  insertThrows: false,
  errors: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo },
    message: { findFirst: async (a: unknown) => { h.spokeArgs = a; return h.spoke } },
  },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    set: async (...a: unknown[]) => { h.kvSets.push(a); return h.nx },
    del: async (k: string) => { h.kvDels.push(k) },
  },
}))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (...a: unknown[]) => { if (h.insertThrows) throw new Error('db down'); h.inserts.push(a); return { id: 'm1' } },
}))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => h.blocked }))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.errors.push(e) } }))
vi.mock('@/lib/partner-inbox', () => ({ isPartnerInboxSeller: (s: { handle?: { handle: string } | null } | null) => ['evisasaigon', 'vietkite'].includes(s?.handle?.handle ?? '') }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'eno-support-desk', FOREIGN_SUPPORT_SELLER_ID: 'eno-support-desk-forum' }))

import { PARTNER_WELCOME_QUIET_DAYS, maybeSendPartnerWelcome } from './partner-welcome'
import { PARTNER_WELCOME_LINE } from './partner-welcome-line'

const NOW = new Date('2026-11-18T08:00:00Z')
const partnerThread = (over: Convo = {}): Convo => ({
  id: 'c1', buyerProfileId: 'cust', sellerProfileId: 'shop-login', sellerId: 'es', listingId: 'L1', visaApplicationId: null,
  listing: { listingType: 'service' },
  seller: { id: 'es', ownerId: 'shop-login', officialPartner: true, handle: { handle: 'evisasaigon' } },
  ...over,
})

beforeEach(() => {
  h.convo = partnerThread(); h.spoke = null; h.spokeArgs = null; h.blocked = false; h.nx = 'OK'
  h.kvSets = []; h.kvDels = []; h.inserts = []; h.insertThrows = false; h.errors = []
})

describe('maybeSendPartnerWelcome', () => {
  it('a rostered partner that answers from its OWN account (VietKite, GoPlus, Blvck, Saigon Moving) gets it too (owner 2026-11-19: "yes")', async () => {
    // Its owner login is VietKite's own (no @eno.vn address is read or required any more).
    h.convo = partnerThread({ sellerId: 'vk', seller: { id: 'vk', ownerId: 'shop-login', officialPartner: true, handle: { handle: 'vietkite' } }, listing: { listingType: 'service', subcategorySlug: 'tours' } })
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('sent')
    expect(h.inserts).toHaveLength(1)
  })

  it('a customer writes to a quiet partner shop: the shop posts the welcome, as its own login', async () => {
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('sent')
    expect(h.inserts).toEqual([[
      { id: 'c1', buyerProfileId: 'cust', sellerProfileId: 'shop-login', listingId: 'L1' },
      'shop-login', PARTNER_WELCOME_LINE, { kind: 'partner_welcome' },
    ]])
    // One welcome for two sends at the same instant: an NX claim, short-lived.
    expect(h.kvSets).toEqual([['partner-welcome:c1', 1, { nx: true, ex: 120 }]])
  })

  it(`"quiet" = nothing from the shop's side, of any kind, in ${PARTNER_WELCOME_QUIET_DAYS} days`, async () => {
    await maybeSendPartnerWelcome('c1', NOW)
    const since = new Date(NOW.getTime() - PARTNER_WELCOME_QUIET_DAYS * 86_400_000)
    expect(h.spokeArgs).toEqual({ where: { conversationId: 'c1', senderProfileId: { not: 'cust' }, createdAt: { gte: since } }, select: { id: true } })
  })

  it('⛔ the shop (an admin, or an earlier welcome) spoke recently: nothing', async () => {
    h.spoke = { id: 'm0' }
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('skipped')
    expect(h.inserts).toEqual([])
  })

  it.each([
    ['a shop not on the partner inbox roster', { seller: { id: 'x', ownerId: 'shop-login', officialPartner: true, handle: { handle: 'someshop' } } }],
    ['a thread whose seller side is not the shop’s current login', { sellerProfileId: 'old-login' }],
    ['a thread with no seller login', { sellerProfileId: null }],
    ['a self-thread', { buyerProfileId: 'shop-login' }],
    ['a visa thread', { visaApplicationId: 'v1' }],
    ['a teacher listing', { listing: { listingType: 'teacher' } }],
    ['an e-Visa listing, whoever sells it (eno.vn licensing boundary)', { listing: { listingType: 'service', subcategorySlug: 'visa-legal' } }],
    ['the support desk', { sellerId: 'eno-support-desk' }],
    ['a rental desk', { sellerId: 'eno-rental-desk' }],
  ])('⛔ %s: nothing', async (_l, over) => {
    h.convo = partnerThread(over)
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('skipped')
    expect(h.inserts).toEqual([])
  })

  it('⛔ either side blocked the other: nothing', async () => {
    h.blocked = true
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('skipped')
    expect(h.inserts).toEqual([])
  })

  it('⛔ another send holds the claim: nothing', async () => {
    h.nx = null
    expect(await maybeSendPartnerWelcome('c1', NOW)).toBe('skipped')
    expect(h.inserts).toEqual([])
  })

  it('⛔ the insert fails: the claim is released for the next message, the error is logged, nothing is thrown', async () => {
    h.insertThrows = true
    await expect(maybeSendPartnerWelcome('c1', NOW)).resolves.toBe('skipped')
    expect(h.kvDels).toEqual(['partner-welcome:c1'])
    expect(h.errors).toHaveLength(1)
  })

  it('a thread that is gone: nothing, nothing thrown', async () => {
    h.convo = null
    await expect(maybeSendPartnerWelcome('c1', NOW)).resolves.toBe('skipped')
  })
})
