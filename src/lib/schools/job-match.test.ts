import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jobSchoolId, jobSchoolIds } from './job-match'

// Which school a live job lands on (jobsBySchool and the PDP's "what teachers say" link share this rule).
const bySeller = new Map([['seller-ila', 'school-ila']])
const byAlias = new Map([['royal school', 'school-royal']])
const job = (over: Partial<Parameters<typeof jobSchoolId>[0]>) => ({ employer: 'Royal School', sellerId: 'someone', city: 'Hồ Chí Minh', ...over })

describe('jobSchoolId', () => {
  it('matches the employer name for a job in Ho Chi Minh City, in every stored spelling of the city', () => {
    expect(jobSchoolId(job({}), bySeller, byAlias)).toBe('school-royal')
    expect(jobSchoolId(job({ city: 'Ho Chi Minh City' }), bySeller, byAlias)).toBe('school-royal')
    expect(jobSchoolId(job({ city: 'TP. Hồ Chí Minh' }), bySeller, byAlias)).toBe('school-royal')
  })

  it('ON PURPOSE: since the 2025 merger, Bình Dương and Vũng Tàu are Ho Chi Minh City', () => {
    // EIU (Thủ Dầu Một) is in the directory; a listing filed under the old province names is the new city.
    for (const city of ['Bình Dương', 'Thủ Dầu Một', 'Vũng Tàu', 'Bà Rịa - Vũng Tàu']) expect(jobSchoolId(job({ city }), bySeller, byAlias), city).toBe('school-royal')
  })

  it('the slang spellings of the city count', () => {
    for (const city of ['Saigon', 'Sài Gòn', 'TPHCM', 'TP.HCM', 'HCMC']) expect(jobSchoolId(job({ city }), bySeller, byAlias), city).toBe('school-royal')
  })

  it('never by name outside HCMC: a Hà Nội "Royal School" is another school', () => {
    expect(jobSchoolId(job({ city: 'Hà Nội' }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ city: 'Đà Nẵng' }), bySeller, byAlias)).toBeUndefined()
    // No city is not HCMC: an unplaced ad never borrows a Saigon school by name.
    expect(jobSchoolId(job({ city: '' }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ city: null }), bySeller, byAlias)).toBeUndefined()
  })

  it("the school's own linked shop counts wherever the job is", () => {
    expect(jobSchoolId(job({ sellerId: 'seller-ila', employer: 'anything', city: 'Hà Nội' }), bySeller, byAlias)).toBe('school-ila')
  })

  it('a generic or missing employer never matches', () => {
    expect(jobSchoolId(job({ employer: 'English center' }), bySeller, new Map([['english center', 'x']]))).toBeUndefined()
    expect(jobSchoolId(job({ employer: undefined }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ employer: 42 }), bySeller, byAlias)).toBeUndefined()
  })
})

/**
 * jobSchoolIds: every school whose PAGE lists a job — each school judged alone (2026-10-20). The board and pages.xml read
 * every school at once with it, and must get, for each school, exactly what that school's own page gets.
 */
describe('jobSchoolIds', () => {
  // Three directory schools: A has a linked shop, B and C are known by name only.
  const schools = [
    { id: 'school-a', sellerId: 'seller-a', aliases: ['a school'] },
    { id: 'school-b', sellerId: null, aliases: ['b academy', 'b english'] },
    { id: 'school-c', sellerId: null, aliases: ['c centre'] },
  ]
  const allSellers = new Map(schools.filter((s) => s.sellerId).map((s) => [s.sellerId as string, s.id]))
  const allAliases = new Map(schools.flatMap((s) => s.aliases.map((a) => [a, s.id] as const)))
  const alone = (s: (typeof schools)[number]) => ({
    bySeller: new Map(s.sellerId ? [[s.sellerId, s.id]] : []),
    byAlias: new Map(s.aliases.map((a) => [a, s.id])),
  })

  it("lists a job one school's shop posts under ANOTHER school's name on both pages", () => {
    const j = job({ sellerId: 'seller-a', employer: 'B Academy' })
    expect(jobSchoolIds(j, allSellers, allAliases)).toEqual(['school-a', 'school-b'])
    // The job page's one link still goes to the shop's school.
    expect(jobSchoolId(j, allSellers, allAliases)).toBe('school-a')
  })

  it('names a school once when its own shop posts under its own name', () => {
    expect(jobSchoolIds(job({ sellerId: 'seller-a', employer: 'A School' }), allSellers, allAliases)).toEqual(['school-a'])
  })

  it('keeps every rule of jobSchoolId: HCMC only by name, the shop anywhere, never a generic name', () => {
    expect(jobSchoolIds(job({ sellerId: 'seller-a', employer: 'B Academy', city: 'Hà Nội' }), allSellers, allAliases)).toEqual(['school-a'])
    expect(jobSchoolIds(job({ employer: 'B Academy', city: 'Hà Nội' }), allSellers, allAliases)).toEqual([])
    expect(jobSchoolIds(job({ employer: 'English center' }), allSellers, new Map([['english center', 'school-c']]))).toEqual([])
    expect(jobSchoolIds(job({ employer: undefined }), allSellers, allAliases)).toEqual([])
  })

  it('⛔ with every school at once, each school gets exactly what jobSchoolId gives it with its own maps alone', () => {
    const employers: unknown[] = ['A School', 'B Academy', 'b english', 'C Centre', 'Royal School', 'English center', '', undefined, 7]
    const sellers = ['seller-a', 'someone', 'seller-x']
    const cities = ['Hồ Chí Minh', 'Saigon', 'Hà Nội', '', null]
    let cases = 0
    for (const employer of employers) for (const sellerId of sellers) for (const city of cities) {
      const j = { employer, sellerId, city }
      const all = jobSchoolIds(j, allSellers, allAliases)
      for (const s of schools) {
        const { bySeller, byAlias } = alone(s)
        expect(all.includes(s.id), `${String(employer)} / ${sellerId} / ${String(city)} → ${s.id}`).toBe(jobSchoolId(j, bySeller, byAlias) === s.id)
        cases++
      }
      // …and lists each school once.
      expect(new Set(all).size).toBe(all.length)
    }
    expect(cases).toBe(employers.length * sellers.length * cities.length * schools.length)
  })
})

describe('what jobSchoolIds relies on', () => {
  /**
   * ⛔ ONE SCHOOL PER SHOP AND PER ALIAS. A map built from every school keeps one school per key, so if two schools could
   * share a shop or an alias, the board and pages.xml would lose a school whose own page lists the job (panel review,
   * 2026-10-20). The schema forbids both — `prisma migrate diff --from-empty` emits `School_sellerId_key` (UNIQUE) and
   * `SchoolAlias_pkey` (PRIMARY KEY ("alias")) — and this pins them: dropping either must revisit jobSchoolIds first.
   */
  it('the schema keeps School.sellerId unique and SchoolAlias.alias the primary key', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const model = (name: string) => schema.match(new RegExp(`\\nmodel ${name} \\{([^}]*)\\n\\}`))?.[1] ?? ''
    expect(model('School')).toMatch(/\n\s+sellerId\s+String\?\s+@unique\b/)
    expect(model('SchoolAlias')).toMatch(/\n\s+alias\s+String\s+@id\b/)
  })
})
