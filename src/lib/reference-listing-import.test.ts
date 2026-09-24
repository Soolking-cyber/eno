import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { IMPORT_SELLERS } from './import-sellers'
import { REFERENCE_VI_LABELS } from './import-i18n'
import { compose as composeBatdongsan, SELLER_ID as BATDONGSAN_SELLER_ID } from '../../scripts/import-batdongsan-rentals'
import { compose as composeRever, SELLER_ID as REVER_SELLER_ID } from '../../scripts/import-rever-rentals'

/**
 * scripts/import-batdongsan-rentals.ts and scripts/import-rever-rentals.ts — the two REFERENCE-listing
 * importers. Both REFRESH title / titleVi / description / descriptionVi on a re-run (`update: mutable`),
 * so the localization lives in their compose(): a re-import composes the localized text, never the old
 * mixed one. The fixtures are REAL rows of the 2026-09-21 source files (batdongsan pr46310931, rever
 * 1654850630130_5651), with the fields compose() reads.
 */
const BDS_ROW = {
  code: 'pr46310931', ward: 'P. Hòa Bình mới', district: 'Quận 11', location: 'Quận 11 (P. Hòa Bình mới)',
  property_type: 'Nhà trọ / Phòng trọ', area_raw: '24 m²', area_m2: 24, _area: 24, bedrooms: 1, bathrooms: 1, price_vnd: 6_300_000,
}
const REVER_ROW = {
  id: '1654850630130_5651', ward: 'Thạnh Mỹ Lợi', district: 'Quận 2', city: 'Hồ Chí Minh',
  full_address: 'Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh', property_type: 'Căn hộ / Chung cư',
  area_raw: '60 m²', area_m2: 60, bedrooms: 2, bathrooms: 2, direction: 'Tây Nam', price_vnd: 10_000_000,
}

describe('the reference importers compose localized text', () => {
  it('batdongsan: English title / facts / rent, Vietnamese labels and "đ/tháng", nothing untranslated', () => {
    const c = composeBatdongsan(BDS_ROW, BDS_ROW.price_vnd)
    expect(c.title).toBe('1 bed · 1 bath · 24 m² for rent — Hòa Bình Ward (new), District 11')
    expect(c.titleVi).toBe('Cho thuê Nhà trọ / Phòng trọ 1PN 24m² — P. Hòa Bình mới, Quận 11')
    expect(c.description.split('\n\n')[1]).toBe('Type: Boarding room\nArea: 24 m²\nBedrooms: 1\nBathrooms: 1\nLocation: District 11 (Hòa Bình Ward, new)\nRent: 6,300,000 đ/month')
    expect(c.descriptionVi.split('\n\n')[1]).toBe('Loại hình: Nhà trọ / Phòng trọ\nDiện tích: 24 m²\nPhòng ngủ: 1\nPhòng vệ sinh: 1\nKhu vực: Quận 11 (P. Hòa Bình mới)\nGiá thuê: 6.300.000 đ/tháng')
    expect(c.description.startsWith('Listed on Batdongsan.com.vn.')).toBe(true)
    expect(c.descriptionVi.startsWith('Tin đăng trên Batdongsan.com.vn.')).toBe(true)
    expect(c.missing).toEqual([])
  })

  it('rever: Address and Direction become English on the English side; the Vietnamese side keeps its values', () => {
    const c = composeRever(REVER_ROW, REVER_ROW.price_vnd)
    expect(c.title).toBe('2 bed · 2 bath · 60 m² for rent — Thạnh Mỹ Lợi, District 2')
    expect(c.titleVi).toBe('Cho thuê Căn hộ / Chung cư 2PN 60m² — Thạnh Mỹ Lợi, Quận 2')
    expect(c.description.split('\n\n')[1]).toBe('Type: Apartment\nArea: 60 m²\nBedrooms: 2\nBathrooms: 2\nDirection: Southwest\nAddress: Đồng Văn Cống Street, Thạnh Mỹ Lợi, District 2, Ho Chi Minh City\nRent: 10,000,000 đ/month')
    expect(c.descriptionVi.split('\n\n')[1]).toBe('Loại hình: Căn hộ / Chung cư\nDiện tích: 60 m²\nPhòng ngủ: 2\nPhòng vệ sinh: 2\nHướng: Tây Nam\nĐịa chỉ: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh\nGiá thuê: 10.000.000 đ/tháng')
    expect(c.missing).toEqual([])
  })

  it('the seller ids are the pinned ones, both in IMPORT_SELLERS', () => {
    expect(BATDONGSAN_SELLER_ID).toBe('bds-vn-import-seller-0001')
    expect(REVER_SELLER_ID).toBe('cmub0wead0000zrq418bqq27m')
    for (const s of [BATDONGSAN_SELLER_ID, REVER_SELLER_ID]) expect(IMPORT_SELLERS as readonly string[]).toContain(s)
  })
})

describe('⛔ a re-import writes the COMPOSED (localized) text — wiring pinned at the source', () => {
  for (const file of ['scripts/import-batdongsan-rentals.ts', 'scripts/import-rever-rentals.ts']) {
    const src = readFileSync(file, 'utf8')
    it(`${file}: the upsert refreshes exactly compose()'s four texts, and searchText folds the localized titles`, () => {
      expect(src).toMatch(/return localizeReferenceImportText\(\{\n\s+title: /)
      expect(src).toMatch(/const \{ title, titleVi, description, descriptionVi \} = compose\(r, price\)\n\s+const c = \{ title, titleVi, description, descriptionVi \}\n/)
      expect(src).toMatch(/const mutable = \{\n\s+\.\.\.c,\n/)
      // The WHOLE fold — the one-off's agreement test (localize-import-listings.test.ts) rebuilds the
      // stored searchText from exactly these parts, so a changed tail must fail here first.
      expect(src).toMatch(file.includes('batdongsan')
        ? /searchText: buildSearchText\(\[c\.title, c\.titleVi, r\.location, r\.district, r\.property_type\]\),/
        : /searchText: buildSearchText\(\[c\.title, c\.titleVi, r\.full_address, r\.district, r\.property_type\]\),/)
      expect(src).toMatch(/create: \{ \.\.\.mutable, externalId, /)
      expect(src).toMatch(/update: mutable,\n/)
      // One loop body composes the row; nothing else writes a title or description.
      expect(src.match(/\btitle(?:Vi)?:\s/g)?.length).toBe(2)
    })
    it(`${file}: every fact label compose() writes has a Vietnamese label — a new field cannot ship English into descriptionVi`, () => {
      // localizeReferenceImportText maps a FIXED set and reports nothing for a label it does not know,
      // so the set compose() emits is pinned here instead (opus, round 2).
      const body = src.slice(src.indexOf('export function compose('), src.indexOf('\nasync function main('))
      const labels = [...body.matchAll(/\[\s*'([A-Z][A-Za-z ]*)',/g)].map((m) => m[1])
      expect(labels.length).toBeGreaterThanOrEqual(6)
      for (const l of labels) expect(Object.keys(REFERENCE_VI_LABELS), l).toContain(l)
    })
    it(`${file}: importable without running — main() only when executed, and no database client at import`, () => {
      // On REAL paths: the pathToFileURL(argv[1]) comparison skipped main() in silence through a symlink.
      expect(src).toMatch(/\nif \(invokedDirectly\(import\.meta\.url\)\) \{\n\s+main\(\)/)
      expect(src).not.toMatch(/pathToFileURL/)
      expect(src).not.toMatch(/^import .*generated\/prisma/m)
      expect(src).not.toMatch(/^import .*@prisma\/adapter-pg/m)
      expect(src).toMatch(/await import\('\.\.\/src\/generated\/prisma\/client'\)/)
    })
  }
})
