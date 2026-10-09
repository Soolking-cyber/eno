import { describe, expect, it, vi } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { longerPlaceNames, matchesProvinceRow, provinceCityAliases, provinceWhere, wardAliases, wardWhere } from './province-match'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, marketplaceListingScope: async () => ({}), teacherExclusion: async () => null }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { matchesProvince } from './facet-counts'
import { HCMC, HCMC_DISTRICT_KEYS } from '@/lib/teachers/places'
import { teacherHome } from '@/lib/teachers/projection'

/**
 * ⛔ THE AREA FILTER SENDS vn-units `nameEn`; THE WIZARD AND THE PROPERTY IMPORTS STORE `name`.
 *
 * These are the three strings the explorer puts on the wire for the three cities that carry
 * listings (area-filter.tsx → `params.set('province', activeProvince.nameEn)` in
 * listings-explorer.tsx), read from the dataset rather than retyped, so a dataset edit that renames
 * one fails here first.
 */
const SENT = Object.fromEntries(
  (vnUnits as { code: string; name: string; nameEn: string }[])
    .filter((u) => ['79', '01', '48'].includes(u.code))
    .map((u) => [u.code, { sent: u.nameEn, stored: u.name }]),
)

describe('what the province filter sends', () => {
  it('is the vn-units English name — exactly these three strings', () => {
    expect(SENT['79']).toEqual({ sent: 'Ho Chi Minh', stored: 'Hồ Chí Minh' })
    expect(SENT['01']).toEqual({ sent: 'Ha Noi', stored: 'Hà Nội' })
    expect(SENT['48']).toEqual({ sent: 'Da Nang', stored: 'Đà Nẵng' })
  })
})

describe('the province predicate', () => {
  /**
   * ⛔ THE BUG: 'Hồ Chí Minh'.includes('Ho Chi Minh') is false, so the HCMC filter hid every
   * wizard-posted HCMC listing and the ~98,000 imported ones. Each of these was false before.
   */
  it.each([
    ['Ho Chi Minh', 'Hồ Chí Minh'],
    ['Ha Noi', 'Hà Nội'],
    ['Da Nang', 'Đà Nẵng'],
  ])('%s matches a row stored as %s (the wizard’s and the importers’ spelling)', (sent, stored) => {
    expect(matchesProvinceRow({ city: stored, location: '' }, sent)).toBe(true)
    expect(matchesProvince({ city: stored, location: '' }, sent)).toBe(true)
  })

  it('still matches everything it matched before (the sent string over city OR location)', () => {
    expect(matchesProvinceRow({ city: 'Ho Chi Minh City', location: '' }, 'Ho Chi Minh')).toBe(true)
    expect(matchesProvinceRow({ city: 'Ha Noi', location: '' }, 'Ha Noi')).toBe(true)
    expect(matchesProvinceRow({ city: null, location: 'Quận 1, Ho Chi Minh' }, 'Ho Chi Minh')).toBe(true)
    expect(matchesProvinceRow({ city: 'Hanoi', location: '' }, 'Ha Noi')).toBe(true) // legacy English label
  })

  it('does not widen onto street names: the other spellings are matched against city only', () => {
    // "Xa lộ Hà Nội" is a highway in Thủ Đức, HCMC.
    expect(matchesProvinceRow({ city: 'Hồ Chí Minh', location: '12 Xa lộ Hà Nội, Thủ Đức' }, 'Ha Noi')).toBe(false)
    expect(matchesProvinceRow({ city: 'Hà Nội', location: '' }, 'Ho Chi Minh')).toBe(false)
  })

  it('leaves an unknown value exactly as before — no aliases, the two original clauses', () => {
    expect(provinceCityAliases('Atlantis')).toEqual([])
    expect(provinceWhere('Atlantis')).toEqual({ OR: [{ city: { contains: 'Atlantis' } }, { location: { contains: 'Atlantis' } }] })
    expect(matchesProvinceRow({ city: 'hanoi', location: '' }, 'Atlantis')).toBe(false)
  })

  it('resolves a legacy label (an old saved search) to the same place', () => {
    expect(matchesProvinceRow({ city: 'Hà Nội', location: '' }, 'Hanoi')).toBe(true)
    expect(matchesProvinceRow({ city: 'Hồ Chí Minh', location: '' }, 'Ho Chi Minh City')).toBe(true)
    expect(provinceCityAliases('Hanoi')).toContain('Hà Nội')
  })

  it('is what the feed actually filters on', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('province=Ho Chi Minh'))
    const clause = andFilters.find((f) => JSON.stringify(f).includes('"city"'))
    expect(clause).toEqual({
      OR: [
        { city: { contains: 'Ho Chi Minh' } },
        { location: { contains: 'Ho Chi Minh' } },
        { city: { contains: 'Hồ Chí Minh' } },
        { city: { contains: 'TP. Hồ Chí Minh' } },
        { city: { contains: 'Ho Chi Minh City' } },
      ],
    })
  })
})

describe('the ward predicate', () => {
  it('matches the Vietnamese ward name the rows carry, within the chosen province', () => {
    expect(wardAliases('Long Phuoc', 'Ho Chi Minh')).toEqual(['Long Phước'])
    expect(wardWhere('Long Phuoc', 'Ho Chi Minh')).toEqual({
      OR: [
        { district: { contains: 'Long Phuoc' } },
        { location: { contains: 'Long Phuoc' } },
        { district: { contains: 'Long Phước' } },
        { location: { contains: 'Long Phước' } },
      ],
    })
  })

  it('matches the other direction too: a Vietnamese ward value picks up the English spelling', () => {
    expect(wardAliases('Long Phước', 'Ho Chi Minh')).toEqual(['Long Phuoc'])
    expect(wardAliases('Long Phuoc', 'Ho Chi Minh City')).toEqual(['Long Phước']) // legacy province label
  })

  it('without a province, adds nothing — ward names repeat across provinces', () => {
    expect(wardAliases('Long Phuoc', null)).toEqual([])
    expect(wardWhere('Long Phuoc')).toEqual({ OR: [{ district: { contains: 'Long Phuoc' } }, { location: { contains: 'Long Phuoc' } }] })
  })

  it('a province with two wards sharing an English name matches both Vietnamese spellings', () => {
    const hcm = (vnUnits as { code: string; wards: { name: string; nameEn: string }[] }[]).find((u) => u.code === '79')!
    const twins = hcm.wards.filter((w) => w.nameEn === 'Thanh An').map((w) => w.name)
    expect(twins.length).toBe(2)
    expect(wardAliases('Thanh An', 'Ho Chi Minh').sort()).toEqual(twins.filter((n) => n !== 'Thanh An').sort())
  })

  it('the in-memory mirror trims like the query does', () => {
    expect(matchesProvinceRow({ city: null, location: 'Quận 1, Ho Chi Minh' }, ' Ho Chi Minh ')).toBe(true)
  })

  it('adds nothing for an unknown ward or a ward of another province', () => {
    expect(wardAliases('Atlantis', 'Ho Chi Minh')).toEqual([])
    expect(wardAliases('Long Phuoc', 'Ha Noi')).toEqual([])
    expect(wardWhere('Atlantis', 'Ho Chi Minh')).toEqual({ OR: [{ district: { contains: 'Atlantis' } }, { location: { contains: 'Atlantis' } }] })
  })

  it('is what the feed actually filters on', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('province=Ho Chi Minh&ward=Long Phuoc'))
    expect(andFilters).toContainEqual(wardWhere('Long Phuoc', 'Ho Chi Minh'))
    expect(JSON.stringify(andFilters)).toContain('Long Phước')
  })
})

type Row = { city: string; district: string | null; location: string; verified: boolean; status: string }
type Unit = { code: string; name: string; nameEn: string; wards: { code: string; name: string; nameEn: string }[] }
const UNITS = vnUnits as Unit[]
const HCM_WARDS = UNITS.find((u) => u.code === '79')!.wards
const row = (district: string | null, location: string, city = 'Hồ Chí Minh'): Row => ({ city, district, location, verified: true, status: 'active' })

/** Evaluate a Prisma `where` for one row the way Postgres does: `contains`/`startsWith`/`endsWith` are LIKE, NULL is
 *  three-valued, keys side by side are AND. Anything else throws, so a clause this cannot read never passes silently. */
function sqlEval(w: any, r: Row): boolean | null {
  const and = (xs: (boolean | null)[]) => (xs.includes(false) ? false : xs.includes(null) ? null : true)
  const or = (xs: (boolean | null)[]) => (xs.includes(true) ? true : xs.includes(null) ? null : false)
  return and(Object.entries(w).map(([k, v]: [string, any]): boolean | null => {
    if (k === 'AND') return and((Array.isArray(v) ? v : [v]).map((x) => sqlEval(x, r)))
    if (k === 'OR') return or(v.map((x: any) => sqlEval(x, r)))
    // NOT is three-valued too: NOT NULL is NULL (Prisma: one object = NOT (its keys AND-ed); an array = every one false).
    if (k === 'NOT') {
      const not = (x: boolean | null) => (x === null ? null : !x)
      return Array.isArray(v) ? and(v.map((x: any) => not(sqlEval(x, r)))) : not(sqlEval(v, r))
    }
    if (!(k in r)) throw new Error(`the test row has no column "${k}"`)
    const cell = r[k as keyof Row]
    // `{ col: null }` is IS NULL — true on a NULL cell (never SQL's unknown `= NULL`).
    if (v === null) return cell === null
    if (typeof v !== 'object') return cell === null ? null : cell === v
    if (cell === null) return null
    return and(Object.entries(v).map(([op, arg]) => {
      if (op === 'contains') return String(cell).includes(arg as string)
      if (op === 'startsWith') return String(cell).startsWith(arg as string)
      if (op === 'endsWith') return String(cell).endsWith(arg as string)
      throw new Error(`unhandled filter ${op}`)
    }))
  }))
}

/** The whole `where` the FEED builds for `?province=&ward=` (buildFeedFilters — the one the grid, the total, the chip
 *  counts and the map share). An empty province sends none. */
const feedWhere = async (ward: string, province = 'Ho Chi Minh') => ({ AND: (await buildFeedFilters(new URLSearchParams({ province, ward }))).andFilters })
/** Does the feed return this row, evaluated as Postgres would? */
const feedFinds = async (r: Row, ward: string, province = 'Ho Chi Minh') => sqlEval(await feedWhere(ward, province), r) === true

/** Where every HCMC-district teacher lives, as the Listing stores it (teacherHome, the projection publish.ts writes). */
const teacherRow = (key: string): Row => ({ ...teacherHome({ livesIn: 'city', currentCity: HCMC, currentDistrictKey: key, currentProvince: '', teachAreas: [] }), verified: true, status: 'active' })

describe('the ward predicate matches a WHOLE name, never the start or end of a longer place', () => {
  /**
   * ⛔ THE BUG (2026-10-09): the ward clause was a bare `contains`, and a ward's name is a substring of every longer
   * place that starts with it. HCMC's Phú Mỹ ward (the old Phú Mỹ town, ex-Bà Rịa–Vũng Tàu) returned every District 7
   * teacher and every Phú Mỹ Hưng rental, none of which is in it. Each of these was true before.
   */
  it('Phú Mỹ no longer returns Phú Mỹ Hưng: the District 7 teachers, its rentals, its projects', async () => {
    expect(teacherRow('d7')).toMatchObject({ district: 'Quận 7 (Phú Mỹ Hưng)', location: 'District 7 (Phu My Hung), Ho Chi Minh City' })
    expect(await feedFinds(teacherRow('d7'), 'Phu My')).toBe(false)
    expect(await feedFinds(row('Quận 7', 'Phú Mỹ Hưng, Quận 7, Hồ Chí Minh'), 'Phu My')).toBe(false)
    expect(await feedFinds(row(null, 'Phú Mỹ Hưng Midtown, Quận 7'), 'Phu My')).toBe(false)
    expect(await feedFinds(row('Quận 7 (Phú Mỹ Hưng)', 'Quận 7 (Phú Mỹ Hưng)'), 'Phu My')).toBe(false)
  })

  it('Phú Mỹ still finds the ward in every shape the rows write it', async () => {
    for (const [district, location] of [
      ['Phú Mỹ', 'Phú Mỹ'], // the post wizard: both columns are the vn-units name
      [null, 'Phường Phú Mỹ'],
      [null, 'P. Phú Mỹ, Quận 7'], // Honeycomb
      [null, 'Phú Mỹ, Quận 7'],
      ['TP. Phú Mỹ', 'TP. Phú Mỹ (P. Phú Mỹ mới)'], // Batdongsan / nhatot: the post-2025 ward
      [null, 'Đường Số 1, Phú Mỹ, Thị xã Phú Mỹ'], // Rever: street, ward, district
      [null, 'Phu My Ward, Ho Chi Minh City'], // the English spelling, as written
      [null, 'Phu My'],
      ['Quận 7 (Phú Mỹ Hưng)', 'P. Phú Mỹ, Quận 7'], // naming the longer place as well does not hide the ward
    ] as const) {
      expect([location, await feedFinds(row(district, location), 'Phu My')]).toEqual([location, true])
    }
    // The shape this module's own header quotes for the imported rows.
    expect(await feedFinds(row('TP. Thủ Đức', 'TP. Thủ Đức (P. Long Phước mới)'), 'Long Phuoc')).toBe(true)
  })

  it('another ward that BEGINS a longer one, from the ward list: An Phú is not An Phú Đông, Tân Sơn is not Tân Sơn Nhất', async () => {
    const names = HCM_WARDS.map((w) => w.name)
    for (const n of ['An Phú', 'An Phú Đông', 'Tân Sơn', 'Tân Sơn Nhất']) expect(names).toContain(n)
    const anPhuDong = row('Quận 12', 'Quận 12 (P. An Phú Đông mới)')
    const anPhu = row(null, 'P. An Phú, Thuận An')
    expect(await feedFinds(anPhuDong, 'An Phu')).toBe(false)
    expect(await feedFinds(row(null, 'An Phu Dong Ward, District 12'), 'An Phu')).toBe(false)
    expect(await feedFinds(anPhuDong, 'An Phu Dong')).toBe(true)
    expect(await feedFinds(anPhu, 'An Phu')).toBe(true)
    expect(await feedFinds(anPhu, 'An Phu Dong')).toBe(false)
    expect(await feedFinds(row('Quận Tân Bình', 'Quận Tân Bình (P. Tân Sơn Nhất mới)'), 'Tan Son')).toBe(false)
    expect(await feedFinds(row('Quận Tân Bình', 'Quận Tân Bình (P. Tân Sơn Nhất mới)'), 'Tan Son Nhat')).toBe(true)
  })

  it('…and one that ENDS a longer one: Vĩnh Lộc is not Tân Vĩnh Lộc', async () => {
    expect(HCM_WARDS.map((w) => w.name)).toEqual(expect.arrayContaining(['Vĩnh Lộc', 'Tân Vĩnh Lộc']))
    const tanVinhLoc = row('Huyện Bình Chánh', 'Huyện Bình Chánh (Xã Tân Vĩnh Lộc mới)')
    expect(await feedFinds(tanVinhLoc, 'Vinh Loc')).toBe(false)
    expect(await feedFinds(tanVinhLoc, 'Tan Vinh Loc')).toBe(true)
    expect(await feedFinds(row('Huyện Bình Chánh', 'Huyện Bình Chánh (Xã Vĩnh Lộc mới)'), 'Vinh Loc')).toBe(true)
  })

  /**
   * ⛔ BOUNDED (commit gate, 2026-10-09 — Opus): exclusions are built only for a ward that resolves in the sent province
   * (the Area panel always sends both). A free-typed `?ward=a`, an unknown ward, or no province keeps the original two
   * LIKEs — it once became one NOT LIKE per ward of the country containing "a", from a public parameter.
   */
  it('no province, or an unknown ward, keeps the bare substring — never one clause per ward of the country', () => {
    const bare = (s: string) => ({ OR: [{ district: { contains: s } }, { location: { contains: s } }] })
    expect(wardWhere('a')).toEqual(bare('a'))
    expect(wardWhere('a', 'Ho Chi Minh')).toEqual(bare('a'))
    expect(wardWhere('Phu My')).toEqual(bare('Phu My'))
    expect(longerPlaceNames(['a'])).toEqual([])
    // …while the real ward of a real province gets its exclusions.
    expect(wardWhere('Phu My', 'Ho Chi Minh')).not.toEqual(bare('Phu My'))
  })

  /**
   * NOT ONE WARD'S ACCIDENT, SO NOT ONE WARD'S FIX: every pair of same-province wards in the dataset where one name
   * begins or ends the other's (117, Vietnamese or English spelling — Đông/Tây/Bắc/Nam, Nhất/Nhì, "1"/"2"…). The
   * longer ward's rows, in every shape the writers produce, are never the shorter ward's; its own rows always are.
   */
  it('no ward in any province returns a longer ward that begins or ends with its name, in any stored shape', async () => {
    const shapes = (w: { name: string; nameEn: string }): [string | null, string][] => [
      [w.name, w.name],
      ['Quận 1', `Quận 1 (P. ${w.name} mới)`],
      ['Quận 1', `Quận 1 (Phường ${w.name})`],
      [null, `Xã ${w.name}, Quận 1`],
      [null, `P. ${w.name}, Quận 1`],
      [null, `Đường Số 1, ${w.name}, Quận 1`],
      [null, `${w.nameEn} Ward, District 1`],
    ]
    const extends_ = (a: string, b: string) => b.startsWith(a + ' ') || b.endsWith(' ' + a)
    let pairs = 0
    for (const p of UNITS) {
      for (const a of p.wards) {
        const longer = p.wards.filter((b) => extends_(a.name, b.name) || extends_(a.nameEn, b.nameEn))
        if (!longer.length) continue
        const where = await feedWhere(a.nameEn, p.nameEn)
        const finds = ([district, location]: [string | null, string]) => sqlEval(where, row(district, location, p.name)) === true
        for (const s of shapes(a)) expect([p.nameEn, a.name, s, finds(s)]).toEqual([p.nameEn, a.name, s, true])
        for (const b of longer) {
          pairs++
          for (const s of shapes(b)) expect([p.nameEn, a.name, s, finds(s)]).toEqual([p.nameEn, a.name, s, false])
        }
      }
    }
    expect(pairs).toBe(117) // the collisions this guards — a dataset edit that changes them is read here first
  })

  /**
   * The "Lives in" filter over the teachers: a curated district's teacher row is returned by exactly the HCMC wards
   * that bear the district's own name — the 2025 ward is the old district's core, and the text cannot tell them apart
   * — and by no ward whose name merely begins one.
   */
  it('a district teacher is returned only by the wards that bear the district’s whole name', async () => {
    const teachers = HCMC_DISTRICT_KEYS.map((key) => [key, teacherRow(key)] as const)
    const hits: string[] = []
    for (const w of HCM_WARDS) {
      const where = await feedWhere(w.nameEn)
      for (const [key, r] of teachers) if (sqlEval(where, r) === true) hits.push(`${key}:${w.name}`)
    }
    // ⛔ Until 2026-10-09 this also held 'd7:Phú Mỹ' — every District 7 teacher under the Phú Mỹ ward — and the d2 / d9 /
    // thu-duc teachers under the WARD Thủ Đức: their district is the longer place "TP Thủ Đức" / "Quận 2 (Thủ Đức)" (the
    // former city), which is not Phường Thủ Đức. A district teacher now meets only the ward that IS its district's name.
    expect(hits.sort()).toEqual([
      'binh-chanh:Bình Chánh', 'binh-tan:Bình Tân', 'binh-thanh:Bình Thạnh', 'can-gio:Cần Giờ', 'cu-chi:Củ Chi',
      'go-vap:Gò Vấp', 'hoc-mon:Hóc Môn', 'nha-be:Nhà Bè', 'phu-nhuan:Phú Nhuận', 'tan-binh:Tân Bình', 'tan-phu:Tân Phú',
    ])
  })

  it('is what the feed filters on: ONE predicate — the substring, minus the longer places the app knows', async () => {
    expect((await feedWhere('Phu My')).AND).toEqual(expect.arrayContaining([wardWhere('Phu My', 'Ho Chi Minh')]))
    // The collisions taken out for Phú Mỹ: the curated "Phú Mỹ Hưng" spellings (DISTRICTS d7) — never the ward itself.
    const longer = longerPlaceNames(['Phu My', 'Phú Mỹ'], 'Ho Chi Minh')
    expect(longer).toEqual(expect.arrayContaining(['Phú Mỹ Hưng', 'Phu My Hung', 'Quận 7 (Phú Mỹ Hưng)', 'District 7 (Phu My Hung)']))
    expect(longer).not.toContain('Phú Mỹ')
    expect(longer).not.toContain('Phu My')
  })

  /**
   * ⛔ RECALL IS THE SUBSTRING'S (commit gate, 2026-10-09 — Opus): a first fix accepted the name only beside a closed list
   * of words and lost every free-text shape outside it. These all name Phú Mỹ ward and must be found.
   */
  it('keeps every free-text shape the substring found: lower-case admin words, shorthand, prefixes', async () => {
    for (const location of ['căn hộ thị xã Phú Mỹ', 'KDC Phú Mỹ, Quận 7', 'Phú Mỹ Q7', 'Phú Mỹ HCM', 'Khu phố 3 Phú Mỹ', 'phường Phú Mỹ', 'Phu My town']) {
      expect([location, await feedFinds(row(null, location), 'Phu My')]).toEqual([location, true])
    }
  })

  it('⛔ a row with NO district still finds the ward — the exclusion is null-safe (NOT LIKE on NULL is NULL)', async () => {
    expect(await feedFinds(row(null, 'Phường Phú Mỹ, Quận 7'), 'Phu My')).toBe(true)
    expect(await feedFinds(row(null, 'Phú Mỹ Hưng, Quận 7'), 'Phu My')).toBe(false)
  })

  it('a ward no known place contains keeps the bare substring, exactly as before', () => {
    const w = (vnUnits as { nameEn: string; wards?: { name: string; nameEn: string }[] }[])
      .flatMap((u) => (u.wards ?? []).map((x) => ({ x, p: u.nameEn })))
      .find(({ x, p }) => longerPlaceNames([x.name, x.nameEn], p).length === 0)!
    expect(wardWhere(w.x.nameEn, w.p)).toEqual({ OR: [w.x.nameEn, ...wardAliases(w.x.nameEn, w.p)].flatMap((s) => [{ district: { contains: s } }, { location: { contains: s } }]) })
  })
})
