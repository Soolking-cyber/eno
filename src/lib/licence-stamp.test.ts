import { describe, expect, it } from 'vitest'
import {
  LICENCE_GRANDFATHER,
  LICENCE_HELD_NOTE,
  LICENCE_STAMP_CLEARED,
  LICENCE_STAMP_PREFIX,
  licenceCleared,
  licenceClearedSql,
  licenceClearedWhere,
  licenceGrandfatherEndsAt,
  licenceGrandfathered,
  licenceHeldMark,
  licenceStampFor,
  licenceStateOf,
  type LicenceRow,
} from './licence-stamp'
import { PROHIBITED_AMENDMENT } from './compliance/legal-amendment'
import { TAXONOMY, subcategoriesFor } from './taxonomy'

/**
 * THE LICENCE CHECK'S APPROVAL STAMP (owner, 2026-10-14) — src/lib/licence-stamp.ts. Pinned: the stamp binds seller,
 * aisle, name and number; licenceCleared's truth table; that the SQL guard is a NECESSARY condition of licenceCleared
 * (every cleared row passes it, so the guarded publishers never refuse a row the exact check cleared); the raw-SQL text;
 * VietKite's grandfather and its end; and every state the admin tab sorts by.
 */

const VIETKITE_ID = LICENCE_GRANDFATHER.sellerId
const DESK = 'desk-seller'
const V = { legalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const attrs = (v: { legalName: string; licenceNo: string } | null, extra: Record<string, string> = {}) =>
  JSON.stringify({ ...extra, ...(v ? { providerLegalName: v.legalName, providerLicenceNo: v.licenceNo } : {}) })
const row = (over: Partial<LicenceRow> = {}): LicenceRow => ({
  categorySlug: 'services', subcategorySlug: 'visa-legal', sellerId: 's-1', attributes: attrs(V), verificationMethod: null, ...over,
})
const stamped = (over: Partial<LicenceRow> = {}): LicenceRow => {
  const r = row(over)
  return { ...r, verificationMethod: licenceStampFor(r, V) }
}

describe('licenceStampFor', () => {
  it('is deterministic, prefixed, and a sha256 hex', () => {
    const s = licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, V)
    expect(s).toBe(licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { ...V }))
    expect(s).toMatch(/^licence:v1:[0-9a-f]{64}$/)
    expect(s.startsWith(LICENCE_STAMP_PREFIX)).toBe(true)
  })

  it('changes with the seller, the aisle, the name and the number', () => {
    const base = licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, V)
    const others = [
      licenceStampFor({ sellerId: 's-2', subcategorySlug: 'visa-legal' }, V),
      licenceStampFor({ sellerId: 's-1', subcategorySlug: 'legal-permits' }, V),
      licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { ...V, legalName: 'CÔNG TY TNHH VISA5S.VN' }),
      licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { ...V, licenceNo: '79-124/2019/TCDL-GP LHQT' }),
    ]
    expect(new Set([base, ...others]).size).toBe(5)
  })

  it('normalises first: whitespace, NFD and a copied label are not a change', () => {
    const base = licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, V)
    expect(licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { legalName: ` ${V.legalName.normalize('NFD')}  `, licenceNo: `Số: ${V.licenceNo}` })).toBe(base)
  })
})

describe('licenceCleared', () => {
  it.each<[string, LicenceRow, boolean, boolean]>([
    ['a non-aisle row, even without values', row({ subcategorySlug: 'cleaning', attributes: null }), false, true],
    ['a row with no subcategory', row({ subcategorySlug: null, attributes: null }), false, true],
    ['another category', row({ categorySlug: 'electronics', subcategorySlug: 'phones', attributes: null }), false, true],
    ['the desk, without values or stamp', row({ attributes: null }), true, true],
    ['an aisle row without values', row({ attributes: null, verificationMethod: 'licence:v1:abc' }), false, false],
    ['an aisle row with values and no stamp', row(), false, false],
    ['a stale stamp (stamped for other values)', { ...row(), verificationMethod: licenceStampFor(row(), { ...V, licenceNo: '79-999/2019/TCDL-GP LHQT' }) }, false, false],
    ['a stamp for another seller', { ...row(), verificationMethod: licenceStampFor(row({ sellerId: 's-2' }), V) }, false, false],
    ['a stamp for the other aisle', { ...row(), verificationMethod: licenceStampFor(row({ subcategorySlug: 'legal-permits' }), V) }, false, false],
    ['a matching stamp', stamped(), false, true],
    ['a matching stamp after the values changed', { ...stamped(), attributes: attrs({ ...V, licenceNo: '79-124/2019/TCDL-GP LHQT' }) }, false, false],
    ['a matching stamp after a move to the other aisle', { ...stamped(), subcategorySlug: 'legal-permits' }, false, false],
    ['a legacy "manual" value', row({ verificationMethod: 'manual' }), false, false],
  ])('%s', (_name, r, desk, want) => {
    expect(licenceCleared(r, { desk })).toBe(want)
  })

  it('a Legal & permits row stamped for its own values is cleared', () => {
    const lp = { legalName: 'CÔNG TY LUẬT ABC', licenceNo: '0312345678' }
    const r = row({ subcategorySlug: 'legal-permits', attributes: attrs(lp) })
    expect(licenceCleared({ ...r, verificationMethod: licenceStampFor(r, lp) }, { desk: false })).toBe(true)
  })

  it('values resent with other whitespace or in NFD keep the stamp valid', () => {
    const r = stamped()
    expect(licenceCleared({ ...r, attributes: attrs({ legalName: ` ${V.legalName.normalize('NFD')} `, licenceNo: ` ${V.licenceNo}` }) }, { desk: false })).toBe(true)
  })
})

/** licenceClearedWhere evaluated in JS, over exactly the operators it uses. */
type Where = Record<string, any>
function matches(r: LicenceRow, w: Where): boolean {
  return Object.entries(w).every(([k, cond]) => {
    if (k === 'OR') return (cond as Where[]).some((c) => matches(r, c))
    const v = (r as Record<string, unknown>)[k]
    if (cond === null) return v === null
    if (cond.in) return v != null && cond.in.includes(v)
    // SQL: NULL NOT IN (…) is not true — the separate `subcategorySlug: null` branch covers it.
    if (cond.notIn) return v != null && !cond.notIn.includes(v)
    if (cond.startsWith !== undefined) return typeof v === 'string' && v.startsWith(cond.startsWith)
    throw new Error(`unexpected condition on ${k}: ${JSON.stringify(cond)}`)
  })
}

describe('licenceClearedWhere — a NECESSARY condition of licenceCleared', () => {
  it('every generated row the exact check clears also passes the SQL guard', () => {
    // ⚠️ Real category/subcategory pairs only: the guard does not read the category, which is sound because the two
    // aisle slugs exist only under services (taxonomy.licence.test.ts).
    const placements: [string, string | null][] = []
    for (const cat of ['services', 'electronics', 'jobs']) {
      placements.push([cat, null])
      for (const s of subcategoriesFor(cat)) placements.push([cat, s.slug])
    }
    const values = [null, V, { legalName: 'CÔNG TY LUẬT ABC', licenceNo: '0312345678' }]
    const sellers = [DESK, 's-2', VIETKITE_ID]
    let cleared = 0
    let checked = 0
    for (const deskIds of [[], [DESK]]) {
      const where = licenceClearedWhere(deskIds)
      for (const [categorySlug, subcategorySlug] of placements) {
        for (const sellerId of sellers) {
          for (const v of values) {
            const base = { categorySlug, subcategorySlug, sellerId, attributes: v ? attrs(v) : null }
            const methods = [null, 'manual', 'licence:v1:deadbeef', ...(v ? [licenceStampFor(base, v), licenceStampFor({ ...base, sellerId: 'other' }, v)] : [])]
            for (const verificationMethod of methods) {
              const r: LicenceRow = { ...base, verificationMethod }
              checked++
              if (!licenceCleared(r, { desk: deskIds.includes(sellerId) })) continue
              cleared++
              expect(matches(r, where), JSON.stringify({ r, deskIds })).toBe(true)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
    expect(cleared).toBeGreaterThan(100) // the property is not vacuous
  })

  it('refuses an unstamped non-desk aisle row, and an empty desk list omits the seller branch (fails closed)', () => {
    expect(matches(row(), licenceClearedWhere([]))).toBe(false)
    expect(matches(row({ sellerId: DESK }), licenceClearedWhere([]))).toBe(false)
    expect(matches(row({ sellerId: DESK }), licenceClearedWhere([DESK]))).toBe(true)
    expect(licenceClearedWhere([]).OR).toEqual([
      { subcategorySlug: null },
      { subcategorySlug: { notIn: ['visa-legal', 'legal-permits'] } },
      { verificationMethod: { startsWith: 'licence:v1:' } },
    ])
    expect(licenceClearedWhere([DESK]).OR).toContainEqual({ sellerId: { in: [DESK] } })
  })
})

describe('licenceClearedSql', () => {
  it('is the exact constant, aliased or not, with no desk branch', () => {
    expect(licenceClearedSql('l.')).toBe(`(l."subcategorySlug" IS NULL OR l."subcategorySlug" NOT IN ('visa-legal','legal-permits') OR l."verificationMethod" LIKE 'licence:v1:%')`)
    expect(licenceClearedSql()).toBe(`("subcategorySlug" IS NULL OR "subcategorySlug" NOT IN ('visa-legal','legal-permits') OR "verificationMethod" LIKE 'licence:v1:%')`)
    expect(licenceClearedSql()).not.toMatch(/sellerId/)
  })

  it('takes a table alias only', () => {
    for (const bad of ['l', 'l.;DROP', `l." OR 1=1 --`, '1l.']) expect(() => licenceClearedSql(bad), bad).toThrow()
  })
})

describe('LICENCE_STAMP_CLEARED', () => {
  it('clears all four repurposed columns', () => {
    expect(LICENCE_STAMP_CLEARED).toEqual({ verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null })
  })
})

describe("VietKite's grandfather", () => {
  const end = licenceGrandfatherEndsAt()
  const vk = (over: Partial<LicenceRow & { verified: boolean }> = {}) =>
    ({ ...row({ sellerId: VIETKITE_ID, attributes: attrs(null, { visaSpeed: 'standard' }) }), verified: true, ...over })

  it('ends at 00:00 ICT on `until`', () => {
    expect(new Date(end).toISOString()).toBe(new Date(`${LICENCE_GRANDFATHER.until}T00:00:00+07:00`).toISOString())
    expect(new Date(end).toISOString()).toBe('2026-10-20T17:00:00.000Z')
  })

  it('holds only for VietKite + e-Visa + live + no values, before the end', () => {
    expect(licenceGrandfathered(vk(), end - 1)).toBe(true)
    expect(licenceGrandfathered(vk(), new Date(end - 60_000))).toBe(true)
    expect(licenceGrandfathered(vk(), end)).toBe(false)
    expect(licenceGrandfathered(vk(), end + 1)).toBe(false)
    expect(licenceGrandfathered(vk({ sellerId: 's-2' }), end - 1)).toBe(false)
    expect(licenceGrandfathered(vk({ subcategorySlug: 'legal-permits' }), end - 1)).toBe(false)
    expect(licenceGrandfathered(vk({ attributes: attrs(V) }), end - 1)).toBe(false)
    expect(licenceGrandfathered(vk({ verified: false }), end - 1)).toBe(false)
    expect(licenceGrandfathered(vk({ categorySlug: 'electronics' }), end - 1)).toBe(false)
    // Half-filled is not "no values" (commit gate): a row with even one value has entered the check.
    expect(licenceGrandfathered(vk({ attributes: JSON.stringify({ providerLegalName: V.legalName }) }), end - 1)).toBe(false)
    expect(licenceGrandfathered(vk({ attributes: JSON.stringify({ providerLicenceNo: V.licenceNo }) }), end - 1)).toBe(false)
  })

  it.skipIf(Date.now() >= licenceGrandfatherEndsAt())('ends on the /prohibited in-force date — re-date both together', () => {
    expect(LICENCE_GRANDFATHER.until).toBe(PROHIBITED_AMENDMENT.inForce)
  })
})

describe('licenceStateOf', () => {
  const end = licenceGrandfatherEndsAt()
  const live = (r: LicenceRow, verified = true) => ({ ...r, verified })

  it('covers all six states', () => {
    expect(licenceStateOf(live(row({ subcategorySlug: 'cleaning' })), { desk: false })).toBe('not_aisle')
    expect(licenceStateOf(live(row({ attributes: null })), { desk: true })).toBe('exempt')
    expect(licenceStateOf(live(stamped()), { desk: false })).toBe('approved')
    expect(licenceStateOf(live(row({ sellerId: VIETKITE_ID, attributes: null })), { desk: false, now: end - 1 })).toBe('grandfathered')
    expect(licenceStateOf(live(row(), false), { desk: false })).toBe('pending')
    expect(licenceStateOf(live(row({ attributes: null }), false), { desk: false })).toBe('missing')
  })

  it('invalid values are "missing" (nothing to approve); a stale stamp is "pending" again; the window over, VietKite is "missing"', () => {
    expect(licenceStateOf(live(row({ attributes: attrs({ legalName: V.legalName, licenceNo: '0312345678' }) })), { desk: false })).toBe('missing') // bare number in e-Visa
    expect(licenceStateOf(live({ ...row(), verificationMethod: licenceStampFor(row(), { ...V, licenceNo: '79-999/2019/TCDL-GP LHQT' }) }), { desk: false })).toBe('pending')
    expect(licenceStateOf(live(row({ sellerId: VIETKITE_ID, attributes: null })), { desk: false, now: end })).toBe('missing')
    // An approved VietKite row is approved, whatever the date.
    const vkStamped = stamped({ sellerId: VIETKITE_ID })
    expect(licenceStateOf(live(vkStamped), { desk: false, now: end - 1 })).toBe('approved')
  })
})

describe('the aisles the stamp is about', () => {
  it('exist only under services', () => {
    for (const c of TAXONOMY) {
      const slugs = c.subcategories.map((s) => s.slug)
      if (c.slug === 'services') expect(slugs).toEqual(expect.arrayContaining(['visa-legal', 'legal-permits']))
      else expect(slugs.filter((s) => s === 'visa-legal' || s === 'legal-permits'), c.slug).toEqual([])
    }
  })
})

// ⛔ Commit gate, 2026-10-14: what 'licence-approve' publishes by. `verified: false` is also an admin Unverify, a moderation
// Unpublish, an auto-hold or an enforcement pull; only a row the licence check itself took down carries the mark.
describe('licenceHeldMark — the licence hold keeps its own mark only for a row that was live, parked or already held', () => {
  it.each<[string, { verified: boolean; identityHold: boolean; verificationNotes: string | null }, string | null]>([
    ['a live row the check pulls', { verified: true, identityHold: false, verificationNotes: null }, LICENCE_HELD_NOTE],
    // A publish waiting on its owner's identity: the approval's publish re-parks it if they are still unverified.
    ['a row the identity gate parked', { verified: false, identityHold: true, verificationNotes: null }, LICENCE_HELD_NOTE],
    ['a row still waiting (marked)', { verified: false, identityHold: false, verificationNotes: LICENCE_HELD_NOTE }, LICENCE_HELD_NOTE],
    ['a row something else took down (unmarked)', { verified: false, identityHold: false, verificationNotes: null }, null],
    ['a row carrying anything else in the column', { verified: false, identityHold: false, verificationNotes: 'legacy note' }, null],
  ])('%s → %s', (_label, row, mark) => {
    expect(licenceHeldMark(row)).toEqual({ verificationNotes: mark })
  })

  it('is not a stamp: no publish guard reads it as cleared, in Prisma or in SQL', () => {
    expect(LICENCE_HELD_NOTE.startsWith(LICENCE_STAMP_PREFIX)).toBe(false)
    expect(LICENCE_STAMP_CLEARED.verificationNotes).toBeNull()
  })
})
