import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review 2026-10-22, item 6: an inbound WhatsApp message must be matched to its account by a
 * GoTrue-CONFIRMED phone (auth.users.phone + phone_confirmed_at), never by the self-service
 * Profile.phone. These pin that the bridge queries auth.users and that a Profile.phone an attacker set
 * to a victim's number does NOT capture the victim's message.
 */

const h = vi.hoisted(() => ({
  queryRaw: vi.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>(),
  profileFindUnique: vi.fn(async () => null as unknown),
  createUser: vi.fn(),
  insertMessage: vi.fn(async () => ({ id: 'msg-1' })),
  getOrCreateSupportThread: vi.fn(async (_db: unknown, profileId: string) => ({ id: `thread-${profileId}` })),
  inboundCreate: vi.fn(async () => ({})),
  inboundUpdate: vi.fn(async () => ({})),
  inboundFindUnique: vi.fn(async () => null as unknown),
  profileUpsert: vi.fn(async () => ({})),
}))

vi.mock('server-only', () => ({}))
vi.mock('./log', () => ({ logError: () => {} }))
vi.mock('./messages', () => ({ insertMessage: h.insertMessage }))
vi.mock('./support-thread', () => ({ getOrCreateSupportThread: h.getOrCreateSupportThread, SUPPORT_SELLER_ID: 'support-seller' }))
vi.mock('./supabase-admin', () => ({ getSupabaseAdmin: () => ({ auth: { admin: { createUser: h.createUser } } }) }))
vi.mock('./db', () => ({
  db: {
    $queryRaw: (...args: unknown[]) => h.queryRaw(...args),
    profile: { findUnique: h.profileFindUnique, upsert: h.profileUpsert },
    whatsAppInbound: { create: h.inboundCreate, update: h.inboundUpdate, findUnique: h.inboundFindUnique },
  },
}))

let deliverInboundWhatsApp: typeof import('./whatsapp-bridge')['deliverInboundWhatsApp']

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  ;({ deliverInboundWhatsApp } = await import('./whatsapp-bridge'))
})
afterEach(() => vi.restoreAllMocks())

const msg = (from: string) => ({ wamid: `wamid-${from}-${Math.random()}`, from, name: 'Sender', text: 'hello' })

describe('WhatsApp sender matching uses the confirmed auth phone, not Profile.phone', () => {
  it('delivers to the account whose auth.users phone is confirmed', async () => {
    h.queryRaw.mockResolvedValue([{ id: 'victim-profile' }])
    const r = await deliverInboundWhatsApp([msg('84901234567')])
    expect(r.delivered).toBe(1)
    // the lookup was the raw auth.users query, and the message went to that account's thread
    expect(h.queryRaw).toHaveBeenCalledTimes(1)
    expect(h.getOrCreateSupportThread).toHaveBeenCalledWith(expect.anything(), 'victim-profile')
    expect(h.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ buyerProfileId: 'victim-profile' }), 'victim-profile', 'hello',
    )
    // never trusted Profile.phone for the match
    expect(h.profileFindUnique).not.toHaveBeenCalled()
    // never created a new auth user — an existing confirmed owner was found
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('when no account has the number confirmed, it creates one (does not fall back to Profile.phone)', async () => {
    h.queryRaw.mockResolvedValue([]) // nobody has this number confirmed in auth.users
    h.createUser.mockResolvedValue({ data: { user: { id: 'new-owner' } }, error: null })
    const r = await deliverInboundWhatsApp([msg('84907654321')])
    expect(r.delivered).toBe(1)
    expect(h.createUser).toHaveBeenCalledTimes(1)
    // the created user carries the number as a CONFIRMED phone
    expect(h.createUser).toHaveBeenCalledWith(expect.objectContaining({ phone: '+84907654321', phone_confirm: true }))
    expect(h.getOrCreateSupportThread).toHaveBeenCalledWith(expect.anything(), 'new-owner')
    // the squatter path is impossible: Profile.phone is never consulted for the match
    expect(h.profileFindUnique).not.toHaveBeenCalled()
  })

  it('passes the raw wa_id (no "+") to the auth.users query, matching how auth stores a phone', async () => {
    h.queryRaw.mockResolvedValue([{ id: 'owner' }])
    await deliverInboundWhatsApp([msg('84901234567')])
    // Prisma tagged-template: args[0] is the strings array, the rest are the interpolated values.
    const values = h.queryRaw.mock.calls[0].slice(1)
    expect(values).toContain('84901234567')
    expect(values).not.toContain('+84901234567')
  })
})
