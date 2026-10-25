import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ A rename follows the teacher onto a TEACHER-ONLY storefront (sweep, 2026-10-22): schools' inboxes, thread headers and
 * the public storefront kept the name the profile was first published under. One conditional statement, writing the
 * profile's LIVE name: a shop, a storefront with any other listing, another owner or a missing profile renames nothing,
 * and two quick renames converge on the last. A failure is logged, never thrown (the save has already committed).
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({ owner: { accountType: 'individual' } as Row | null, fullName: 'Sebnem Agayeva' as string | null, calls: [] as Row[], count: 1, down: false, errors: [] as unknown[], revalidated: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.errors.push(e) }, logWarn: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.revalidated.push(p) } }))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => (h.down ? Promise.reject(new Error('down')) : h.owner) },
    teacherProfile: { findUnique: async () => (h.fullName === null ? null : { fullName: h.fullName }) },
    seller: { updateMany: async (a: Row) => { h.calls.push(a); return { count: h.count } } },
  },
}))
const { syncTeacherStorefrontName } = await import('./publish')

beforeEach(() => { h.owner = { accountType: 'individual' }; h.fullName = 'Sebnem Agayeva'; h.calls = []; h.count = 1; h.down = false; h.errors = []; h.revalidated = [] })

describe('syncTeacherStorefrontName', () => {
  it('one guarded statement: this owner, a different name, no non-teacher listing — and the LIVE profile name', async () => {
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(true)
    expect(h.calls).toEqual([{
      where: { id: 's1', ownerId: 'p1', NOT: { name: 'Sebnem Agayeva' }, listings: { none: { listingType: { not: 'teacher' } } } },
      data: { name: 'Sebnem Agayeva' },
    }])
    expect(h.revalidated).toEqual(['/sellers/s1'])
  })
  it('an account not yet typed counts as an individual; any other type does not', async () => {
    h.owner = { accountType: null }
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(true)
    h.owner = { accountType: 'partner' }
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
  })
  it('a business account, a missing profile or a missing teacher profile renames nothing', async () => {
    h.owner = { accountType: 'business' }
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
    h.owner = null
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
    h.owner = { accountType: 'individual' }; h.fullName = null
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
    expect(h.calls).toEqual([])
  })
  it('a storefront the statement does not match (another listing, another owner) reports no rename', async () => {
    h.count = 0
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
  })
  it('a failed read is logged, never thrown', async () => {
    h.down = true
    expect(await syncTeacherStorefrontName('s1', 'p1')).toBe(false)
    expect(h.errors).toHaveLength(1)
  })
})
