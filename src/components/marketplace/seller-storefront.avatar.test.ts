import { describe, expect, it, vi } from 'vitest'

// storefrontCard is pure over the loaded row; the module's data imports are stubbed so it loads without a database.
vi.mock('@/lib/db', () => ({ db: {} }))

import { storefrontCard } from './seller-storefront'

type Loaded = Parameters<typeof storefrontCard>[0]

const FACE = 'https://lh3.googleusercontent.com/a/face'
const seller = (avatarUrl: string | null, owner: { accountType: string | null; avatarUrl: string | null } | null) =>
  ({
    id: 'cm-person', name: 'Lan', avatarColor: null, avatarUrl, officialPartner: false,
    ownerId: owner ? '00000000-0000-0000-0000-000000000001' : null, owner: owner && { ...owner, lastSeenAt: null },
    memberSince: new Date('2026-01-01'), reviewCount: 0, rating: 0, trustScore: 100, trustTier: 'trusted',
    responseRate: null, responseTime: null, responseMetricAt: null, listings: [],
  }) as unknown as Loaded

// Owner, 2026-10-15: "the persons page doesnt show their profile image, but in messages i can clearly see the profile image".
describe('storefrontCard — the storefront picture', () => {
  it("a person's storefront shows its owner's profile photo", () => {
    expect(storefrontCard(seller(null, { accountType: 'individual', avatarUrl: FACE }), 0).cardSeller.avatarUrl).toBe(FACE)
  })
  it('a business storefront with no logo keeps the initials', () => {
    expect(storefrontCard(seller(null, { accountType: 'business', avatarUrl: FACE }), 0).cardSeller.avatarUrl).toBeNull()
  })
})
