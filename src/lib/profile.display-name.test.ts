import { beforeEach, describe, expect, it, vi } from 'vitest'

// ensureProfile seeds displayName — and, from it, the public handle — with the provider's name CLEANED
// (Sign in with Apple plan, A5): every provider, before either is written.
const h = vi.hoisted(() => ({
  created: null as null | Record<string, unknown>, updated: null as null | Record<string, unknown>, handleFrom: [] as unknown[],
  // The row's email as it stands before the sign-in (null: no row yet).
  held: null as null | { email: string | null },
}))
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({
  db: {
    profile: {
      findUnique: async () => h.held,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { h.created = create; h.updated = update; return { id: create.id, displayName: create.displayName } },
    },
    seller: { findUnique: async () => null },
  },
}))
vi.mock('./enforcement', () => ({ checkBanEvasion: async () => {} }))
vi.mock('./trust', () => ({ recordNewAccount: async () => {}, recordPhoneVerified: async () => {}, recomputeTrust: async () => {} }))
vi.mock('./handle', () => ({ autoClaimHandle: async (_o: unknown, name: unknown) => { h.handleFrom.push(name) }, consolidateSellerHandle: async () => {} }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ claimGuestStorefront: async () => ({ claimed: false }) }))

const { ensureProfile, providerAvatarUrl } = await import('./profile')
const user = (meta: Record<string, unknown>, email = 'jane@example.com') =>
  ({ id: 'u-1', email, phone: null, phone_confirmed_at: null, user_metadata: meta, app_metadata: {} }) as never

beforeEach(() => { h.created = null; h.updated = null; h.handleFrom = []; h.held = null })

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

// ⛔ Facebook's picture link EXPIRES (2026-10-16): a new account keeps a provider photo only from Google's lasting host.
describe('ensureProfile — the seeded photo', () => {
  it('Google\'s photo is kept; Facebook\'s expiring link and anything else is not', async () => {
    const google = 'https://lh3.googleusercontent.com/a/ACg8ocJ-x=s96-c'
    await ensureProfile(user({ full_name: 'Jane Doe', avatar_url: google }))
    expect(h.created!.avatarUrl).toBe(google)
    for (const fb of [
      'https://platform-lookaside.fbsbx.com/platform/profilepic/?asid=10229&height=100&width=100&ext=1790000000&hash=AbX',
      'https://scontent.fsgn5-10.fna.fbcdn.net/v/t39.30808-1/123_n.jpg?stp=c0&_nc_ht=x&oh=00_x&oe=67000000',
    ]) {
      await ensureProfile(user({ full_name: 'Jane Doe', avatar_url: fb }))
      expect(h.created!.avatarUrl, fb).toBeNull()
    }
  })
  it('providerAvatarUrl: https on *.googleusercontent.com only — no look-alikes, credentials, ports or junk', () => {
    expect(providerAvatarUrl('https://lh3.googleusercontent.com/a/x')).toBe('https://lh3.googleusercontent.com/a/x')
    for (const bad of [
      'http://lh3.googleusercontent.com/a/x', 'https://googleusercontent.com.evil.example/a', 'https://evilgoogleusercontent.com/a',
      'https://u:p@lh3.googleusercontent.com/a', 'https://lh3.googleusercontent.com:8443/a', 'javascript:alert(1)', '', 42, null,
      `https://lh3.googleusercontent.com/${'x'.repeat(2100)}`,
    ]) expect(providerAvatarUrl(bad), String(bad).slice(0, 60)).toBeNull()
  })
})

// ⛔ ONCE A REVIEW SEAT, ALWAYS ONE (src/lib/review-seat-accounts.ts): a seat that changed its sign-in address itself keeps
// the seat's address on its Profile, so every guard that reads it still holds.
describe('ensureProfile — a review seat\'s address is never replaced', () => {
  it('a row holding a seat\'s address keeps it, whatever the sign-in now says', async () => {
    h.held = { email: 'ai-review@eno.vn' }
    await ensureProfile(user({}, 'reviewer@example.com'))
    expect(h.updated!.email).toBe('ai-review@eno.vn')
    expect(h.created!.email).toBe('ai-review@eno.vn')
  })
  it('anyone else is mirrored as before: a changed address, and a new account', async () => {
    h.held = { email: 'jane@example.com' }
    await ensureProfile(user({}, 'jane.doe@example.com'))
    expect(h.updated!.email).toBe('jane.doe@example.com')
    h.held = null
    await ensureProfile(user({}, 'new@example.com'))
    expect(h.created!.email).toBe('new@example.com')
  })
})
