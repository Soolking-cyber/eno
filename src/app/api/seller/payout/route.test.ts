import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The payout-account-changed alert is the mailer's SECURITY class — the last kind of mail its daily
 * budget refuses, so not even a sign-in spray can spend the quota this alert needs (see
 * infra/cloudflare/eno-mailer.js). Pinned here because the class is set at this one call site and
 * nothing else would notice it going missing.
 */

const h = vi.hoisted(() => ({ mails: [] as Array<Record<string, unknown>>, before: null as null | { bankAccountNo: string; bankBin: string } }))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => ({ id: 'user-1' }),
  getCurrentProfileId: async () => 'user-1',
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9 }) }))
vi.mock('@/lib/payments/eligibility', () => ({ vietqrPayoutReady: () => true }))
vi.mock('@/lib/kyc/identity', () => ({ verifiedIdentityFor: async () => ({ fullName: 'NGUYEN VAN A' }) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/log', () => ({ logWarn: () => {}, logError: () => {} }))
vi.mock('@/lib/mail', () => ({ sendMail: async (m: Record<string, unknown>) => { h.mails.push(m); return true } }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => ({ id: 'seller-1' }) },
    sellerPayout: { findUnique: async () => h.before, upsert: async () => ({}) },
    profile: { findUnique: async () => ({ email: 'seller.person@gmail.com' }) },
  },
}))

const { PUT } = await import('./route.forum.svc')

beforeEach(() => { h.mails = []; h.before = { bankAccountNo: '1111222233', bankBin: '970436' } })

describe('payout change alert', () => {
  it('goes out as class security', async () => {
    const res = await PUT(new Request('https://eno.forum/api/seller/payout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bankBin: '970436', bankAccountNo: '9999888877', bankAccountName: 'NGUYEN VAN A' }),
    }), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(200)
    expect(h.mails).toHaveLength(1)
    expect(h.mails[0]).toMatchObject({ to: 'seller.person@gmail.com', class: 'security', tag: 'payout-changed' })
  })
})
