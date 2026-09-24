import { describe, expect, it } from 'vitest'
import { districtFieldClauses, districtMatchWhere, districtTextMatches } from './district-match'

/**
 * ⛔ `?district=d1` RETURNED QUẬN 10, 11 AND 12 (production, 2026-09-24: 2,794 rows for a district
 * holding 1,373) because "Quận 1" is a substring of all three. And the chip counts mirror the SQL
 * predicate in JavaScript, so the two must agree row for row or a count stops matching its tap.
 */

/** Evaluate the Prisma clauses the way Postgres LIKE would, for one row. */
function sqlMatches(row: { district: string | null; location: string }, match: string[]): boolean {
  // SQL three-valued logic: a LIKE on NULL is NULL, NOT NULL is NULL, and a NULL WHERE is false.
  const evalWhere = (w: any): boolean | null => {
    if (w.AND) {
      const r = w.AND.map(evalWhere)
      return r.includes(false) ? false : r.includes(null) ? null : true
    }
    if (w.OR) {
      const r = w.OR.map(evalWhere)
      return r.includes(true) ? true : r.includes(null) ? null : false
    }
    if (w.NOT) {
      const r = evalWhere(w.NOT)
      return r === null ? null : !r
    }
    const [field, f] = Object.entries(w)[0] as [keyof typeof row, any]
    const v = row[field]
    if (v === null) return null
    if ('contains' in f) return v.includes(f.contains)
    return v.endsWith(f.endsWith)
  }
  return evalWhere(districtMatchWhere(match)) === true
}

const ROWS = [
  { district: 'Quận 1', location: 'Quận 1 (P. Bến Thành mới)' },
  { district: 'Quận 10', location: 'Quận 10 (P. Hòa Hưng mới)' },
  { district: 'Quận 11', location: 'Phường 5, Quận 11, Hồ Chí Minh' },
  { district: 'Quận 12', location: 'Quận 12 (P. Đông Hưng Thuận mới)' },
  { district: null, location: 'Phường 5, Quận 1, Hồ Chí Minh' },
  { district: null, location: 'P. Tân Định, Quận 1' },
  { district: 'Quận 2', location: 'P. An Phú, Quận 2' },
  { district: 'District 1', location: 'x' },
  { district: 'District 10', location: 'x' },
  { district: 'Quận Bình Thạnh', location: 'Q. Bình Thạnh (P. Gia Định mới)' },
  { district: null, location: 'Quận 1: P. Bến Thành' },
  { district: null, location: 'Quận 1|HCM' },
  { district: null, location: 'Quận 1(P. Bến Thành)' },
  { district: null, location: 'Quận 1–Bến Thành' },
  { district: null, location: 'Quận 1\r\nHCM' },
  { district: null, location: 'Quận 1"' },
  { district: null, location: 'gần Quận 10#Quận 1#' },
  // A field naming a longer number too relies on the delimiter list — here, '('.
  { district: null, location: 'gần Quận 10, Quận 1(P. Bến Thành)' },
]

describe('district matching', () => {
  it('"Quận 1" matches Quận 1 in every stored shape and never Quận 10, 11 or 12', () => {
    const d1 = ['District 1', 'Quận 1']
    const hits = ROWS.filter((r) => sqlMatches(r, d1)).map((r) => r.district ?? r.location)
    expect(hits).toEqual(['Quận 1', 'Phường 5, Quận 1, Hồ Chí Minh', 'P. Tân Định, Quận 1', 'District 1', 'Quận 1: P. Bến Thành', 'Quận 1|HCM', 'Quận 1(P. Bến Thành)', 'Quận 1–Bến Thành', 'Quận 1\r\nHCM', 'Quận 1"', 'gần Quận 10, Quận 1(P. Bến Thành)'])
  })

  it('a lettered spelling keeps the plain substring match it always had', () => {
    expect(districtFieldClauses('district', 'Bình Thạnh')).toEqual([{ district: { contains: 'Bình Thạnh' } }])
    expect(districtMatchWhere(['Bình Thạnh'])).toEqual({ OR: [{ district: { contains: 'Bình Thạnh' } }, { location: { contains: 'Bình Thạnh' } }] })
  })

  it('a numbered scope is guarded by the one-LIKE bare match, so rows without the spelling fail cheaply', () => {
    const w: any = districtMatchWhere(['Quận 1'])
    expect(w.AND[0]).toEqual({ OR: [{ district: { contains: 'Quận 1' } }, { location: { contains: 'Quận 1' } }] })
    expect(w.AND[1].OR).toContainEqual({ location: { endsWith: 'Quận 1' } })
  })

  it('the JavaScript mirror gives the SQL predicate’s answer for every row and spelling', () => {
    const spellings = ['Quận 1', 'District 1', 'Quận 10', 'Quận 2', 'Bình Thạnh', 'Quận 12']
    for (const row of ROWS) {
      for (const m of spellings) {
        const js = [row.district ?? '', row.location].some((h) => districtTextMatches(h, m))
        expect([row, m, js]).toEqual([row, m, sqlMatches(row, [m])])
      }
    }
  })
})
