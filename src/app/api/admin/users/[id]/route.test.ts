import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Users console's erase action answers the Apple status with the purge, so the console can tell the admin
// when the support reply must send the person to remove eno in their Apple Account (Sign in with Apple, D9).
const h = vi.hoisted(() => ({
  admin: 'admin@eno.vn' as string | null,
  erased: [] as Array<[string, unknown]>,
  result: { ok: true, purge: { deleted: 2, kept: 0, foreign: 0, failed: 0 }, apple: 'manual' } as Record<string, unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.admin, isAdminEmail: (e: string | null) => e === 'admin@eno.vn' }))
vi.mock('@/lib/admin-users', () => ({
  getAdminUserDetail: async (id: string) => ({ profile: { id, email: 'person@privaterelay.appleid.com', phone: null } }),
  revokeIdentity: async () => ({ ok: true, status: 'revoked' }),
}))
vi.mock('@/lib/core/account-erasure', () => ({
  eraseAccount: async (id: string, actor: unknown) => { h.erased.push([id, actor]); return h.result },
}))

const { POST } = await import('./route')
const ID = '11111111-2222-4333-8444-555555555555'
const erase = (body: Record<string, unknown>) =>
  (POST as unknown as (r: Request, n: { params: Promise<Record<string, string>> }) => Promise<Response>)(
    new Request(`https://eno.vn/api/admin/users/${ID}`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ID }) },
  )

beforeEach(() => {
  h.admin = 'admin@eno.vn'
  h.erased = []
  h.result = { ok: true, purge: { deleted: 2, kept: 0, foreign: 0, failed: 0 }, apple: 'manual' }
})

describe('POST /api/admin/users/[id] — erase', () => {
  it('returns the Apple status next to the purge', async () => {
    const res = await erase({ action: 'erase', reason: 'ticket 1234', confirmEmail: 'person@privaterelay.appleid.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, purge: { deleted: 2, kept: 0, foreign: 0, failed: 0 }, apple: 'manual' })
    expect(h.erased).toEqual([[ID, { kind: 'admin', email: 'admin@eno.vn', reason: 'ticket 1234' }]])
  })
  it('every status passes through unchanged', async () => {
    for (const apple of ['none', 'revoked', 'queued', 'manual']) {
      h.result = { ...h.result, apple }
      const res = await erase({ action: 'erase', reason: 'r', confirmEmail: 'person@privaterelay.appleid.com' })
      expect((await res.json()).apple).toBe(apple)
    }
  })
  it('the confirmation still gates it', async () => {
    const res = await erase({ action: 'erase', reason: 'r', confirmEmail: 'someone@else.example' })
    expect(res.status).toBe(400)
    expect(h.erased).toEqual([])
  })
})
