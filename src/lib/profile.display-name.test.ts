import { beforeEach, describe, expect, it, vi } from 'vitest'

// ensureProfile seeds displayName — and, from it, the public handle — with the provider's name CLEANED
// (Sign in with Apple plan, A5): every provider, before either is written.
const h = vi.hoisted(() => ({ created: null as null | Record<string, unknown>, handleFrom: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({
  db: {
    profile: { upsert: async ({ create }: { create: Record<string, unknown> }) => { h.created = create; return { id: create.id, displayName: create.displayName } } },
    seller: { findUnique: async () => null },
  },
}))
vi.mock('./enforcement', () => ({ checkBanEvasion: async () => {} }))
vi.mock('./trust', () => ({ recordNewAccount: async () => {}, recordPhoneVerified: async () => {}, recomputeTrust: async () => {} }))
vi.mock('./handle', () => ({ autoClaimHandle: async (_o: unknown, name: unknown) => { h.handleFrom.push(name) }, consolidateSellerHandle: async () => {} }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ claimGuestStorefront: async () => ({ claimed: false }) }))

const { ensureProfile } = await import('./profile')
const user = (meta: Record<string, unknown>, email = 'jane@example.com') =>
  ({ id: 'u-1', email, phone: null, phone_confirmed_at: null, user_metadata: meta, app_metadata: {} }) as never

beforeEach(() => { h.created = null; h.handleFrom = [] })

describe('ensureProfile — the seeded name', () => {
  it('strips bidi, zero-width and control characters and caps at 80, before the handle is claimed', async () => {
    await ensureProfile(user({ full_name: `Ja\u202Ene\u200B Doe\n${'x'.repeat(200)}` }))
    const name = h.created!.displayName as string
    expect(name.startsWith('Jane Doe x')).toBe(true)
    expect(name).toHaveLength(80)
    expect(name).not.toMatch(/[\u202E\u200B\n]/)
    expect(h.handleFrom).toEqual([name])
  })
  it('falls back from full_name to name, then to the masked email handle', async () => {
    await ensureProfile(user({ full_name: '\u200B\u202E', name: ' Google  Name ' }))
    expect(h.created!.displayName).toBe('Google Name')
    await ensureProfile(user({}))
    expect(h.created!.displayName).not.toContain('jane@example.com')
    expect(h.created!.displayName).toBeTruthy()
  })
})
