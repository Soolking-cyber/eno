import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * updateSellerCore — the storefront NAME carries no contact detail (security review 2026-10-22, item 32). It screened
 * the name and the bio for a phone number only, so an email, a link or a messenger handle could sit in the title every
 * listing page and the storefront print. The bio keeps its phone-only rule; the name gets the display name's rule.
 * Shared by PATCH /api/seller and the partner PATCH /api/v1/shop.
 */

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ updates: [] as Row[] }))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findUnique: async () => ({ verifiedIdentityHash: null }),
      update: async ({ data }: { data: Row }) => { h.updates.push(data); return { name: data.name ?? null, bio: null, location: null, avatarUrl: null, phone: null } },
    },
  },
}))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/trust', () => ({ recordProfileComplete: async () => {} }))
vi.mock('@/lib/tax-lookup', () => ({ lookupTaxCode: async () => null, TAX_FACTS_TTL_MS: 1 }))
vi.mock('@/lib/seller-pdp-refresh', () => ({ refreshSellerPdps: async () => {} }))

const { updateSellerCore } = await import('./seller')

beforeEach(() => { h.updates = [] })

describe('updateSellerCore — the storefront name', () => {
  it.each(['Lan Phone Shop — lanshop@example.com', 'Lan Phone Shop zalo: lanshop', 'Lan Phone Shop https://lanshop.example'])(
    '⛔ %s → 400 no_contact_in_name, nothing written',
    async (name) => {
      expect(await updateSellerCore('s1', 'p1', { name })).toEqual({ ok: false, code: 400, error: 'no_contact_in_name' })
      expect(h.updates).toEqual([])
    },
  )

  it('a phone number keeps its own code', async () => {
    expect(await updateSellerCore('s1', 'p1', { name: 'Lan Shop 0901 234 567' })).toEqual({ ok: false, code: 400, error: 'no_phone_in_profile' })
  })

  it('a clean name saves', async () => {
    expect(await updateSellerCore('s1', 'p1', { name: 'Lan Phone Shop' })).toEqual({ ok: true })
    expect(h.updates).toEqual([expect.objectContaining({ name: 'Lan Phone Shop' })])
  })
})
