import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The public pages a teacher row is on (src/lib/teachers/revalidate.ts): the profile, /c/teachers, each district page
 * named — and since the home page's "Find a teacher" shelf (owner, 2026-10-13) the home page, whose 6h-ISR HTML carries
 * up to eight teacher cards. revalidatePublicPath covers both languages itself (revalidate-lang.ts).
 */
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))

const { districtPagesOf, revalidateTeacherPages } = await import('./revalidate')
const { revalidatePublicPath } = await import('@/lib/revalidate-lang')
const purged = () => vi.mocked(revalidatePublicPath).mock.calls.map(([p]) => p)

beforeEach(() => { vi.mocked(revalidatePublicPath).mockClear() })

describe('revalidateTeacherPages', () => {
  it('purges the profile, /c/teachers, each district page once — and the home page\'s shelf', () => {
    revalidateTeacherPages('l1', ['d7', null, 'd7', '', undefined, 'thu-duc'])
    expect(purged()).toEqual(['/listings/l1', '/c/teachers', '/c/teachers/d7', '/c/teachers/thu-duc', '/'])
  })

  it('without a listing (an erased account\'s row): /c/teachers and the home page still go', () => {
    revalidateTeacherPages(null, [])
    expect(purged()).toEqual(['/c/teachers', '/'])
  })
})

describe('districtPagesOf', () => {
  it('the stored key, and the district a not-yet-migrated row\'s old text names', () => {
    expect(districtPagesOf(null)).toEqual([])
    expect(districtPagesOf({ currentDistrictKey: 'd7', currentDistrict: null })).toEqual(['d7', ''])
    expect(districtPagesOf({ currentDistrictKey: null, currentDistrict: 'Thủ Đức' })).toEqual([null, 'thu-duc'])
  })
})
