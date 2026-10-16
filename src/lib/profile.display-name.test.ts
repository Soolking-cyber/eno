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

describe('ensureProfile — a LinkedIn sign-up (2026-10-15)', () => {
  const withProvider = (provider: string) =>
    ({ id: 'u-2', email: 'li@example.com', phone: null, phone_confirmed_at: null, user_metadata: { name: 'Li Nguyen', avatar_url: 'https://media.licdn.com/p.jpg' }, app_metadata: { provider, providers: [provider] } }) as never
  it('⛔ starts with the marketing digest OFF (its email is LinkedIn Content — API Terms 3.1(10))', async () => {
    await ensureProfile(withProvider('linkedin_oidc'))
    expect(h.created!.weeklyDigestOptIn).toBe(false)
    expect(h.created!.displayName).toBe('Li Nguyen')
  })
  it('every other sign-up keeps the schema default', async () => {
    await ensureProfile(withProvider('google'))
    expect(h.created).not.toHaveProperty('weeklyDigestOptIn')
    expect(h.created!.avatarUrl).toBe('https://media.licdn.com/p.jpg')
  })
  it('⛔ never takes a LinkedIn photo as the account photo (the notice: "we never show your LinkedIn photo")', async () => {
    await ensureProfile(withProvider('linkedin_oidc'))
    expect(h.created!.avatarUrl).toBeNull()
  })
})
