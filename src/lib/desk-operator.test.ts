import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SCOPED DESK ENTITLEMENT.
 *
 * ⚠️ WHAT THIS FILE EXISTS TO FORBID: a partner desk operator being able to do anything OUTSIDE
 * their own desk. Before this module, every operator action gated on ADMIN_EMAILS — so letting
 * VietKite file the visas they sell meant granting them /admin, i.e. every user's dispute room,
 * every report, the enforcement console and every other applicant's identity documents. The two
 * assertions that matter most here are the NEGATIVE ones: the visa operator is refused on trips,
 * and the trip operator is refused on visa. They are different companies.
 */

const h = vi.hoisted(() => ({
  email: null as string | null,
  adminList: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.email ? { email: h.email } : null } }) },
  }),
}))
vi.mock('@/lib/admin', () => ({
  isAdminEmail: (e: string | null | undefined) => !!e && h.adminList.includes(e.toLowerCase()),
}))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['info@vietkite.com.vn'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['info@giacmobayre.com'] }))

const { getVisaDeskOperator, getTripDeskOperator } = await import('./desk-operator')

beforeEach(() => {
  h.email = null
  h.adminList = ['boss@eno.vn']
})

describe('the desks are SEPARATE entitlements', () => {
  it('the visa desk owner operates visa', async () => {
    h.email = 'info@vietkite.com.vn'
    await expect(getVisaDeskOperator()).resolves.toBe('info@vietkite.com.vn')
  })

  it('⛔ the visa desk owner is REFUSED on trips — a different company entirely', async () => {
    h.email = 'info@vietkite.com.vn'
    await expect(getTripDeskOperator()).resolves.toBeNull()
  })

  it('the trip desk owner operates trips', async () => {
    h.email = 'info@giacmobayre.com'
    await expect(getTripDeskOperator()).resolves.toBe('info@giacmobayre.com')
  })

  it('⛔ the trip desk owner is REFUSED on visa', async () => {
    h.email = 'info@giacmobayre.com'
    await expect(getVisaDeskOperator()).resolves.toBeNull()
  })
})

describe('it is ADDITIVE to admin, never a replacement', () => {
  it('an admin operates BOTH desks, exactly as before this module existed', async () => {
    h.email = 'boss@eno.vn'
    await expect(getVisaDeskOperator()).resolves.toBe('boss@eno.vn')
    await expect(getTripDeskOperator()).resolves.toBe('boss@eno.vn')
  })
})

describe('it fails CLOSED', () => {
  it('refuses a signed-out session', async () => {
    h.email = null
    await expect(getVisaDeskOperator()).resolves.toBeNull()
    await expect(getTripDeskOperator()).resolves.toBeNull()
  })

  it('refuses an ordinary signed-in user', async () => {
    h.email = 'buyer@example.com'
    await expect(getVisaDeskOperator()).resolves.toBeNull()
    await expect(getTripDeskOperator()).resolves.toBeNull()
  })

  it('matches case-insensitively, so a capitalised session email is not silently locked out', async () => {
    h.email = 'Info@VietKite.com.vn'
    await expect(getVisaDeskOperator()).resolves.toBe('info@vietkite.com.vn')
  })

  /**
   * ⚠️ THE DIRECTION THAT MATTERS. An unset desk variable must LOCK the desk, not open it — the
   * opposite default would mean a deployment that forgot to configure a desk grants it to nobody's
   * account, or worse, to everybody's.
   */
  it('an EMPTY desk list grants nobody but an admin', async () => {
    vi.resetModules()
    vi.doMock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: [] }))
    vi.doMock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: [] }))
    const m = await import('./desk-operator')
    h.email = 'info@vietkite.com.vn'
    await expect(m.getVisaDeskOperator()).resolves.toBeNull()
    h.email = 'boss@eno.vn'
    await expect(m.getVisaDeskOperator()).resolves.toBe('boss@eno.vn')
    vi.doUnmock('@/lib/visa-shop')
    vi.doUnmock('@/lib/trips/dm-thread')
  })
})
