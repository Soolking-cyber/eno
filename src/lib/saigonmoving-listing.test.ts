import { describe, expect, it } from 'vitest'
import { fold } from './fold'
import { minPhotosFor, assertCleanTexts } from './publish-guard'
import { richTextGroups } from './rich-text-blocks'
import {
  SAIGONMOVING_ADDRESS, SAIGONMOVING_CARD_PRICE, SAIGONMOVING_COPY, SAIGONMOVING_EMAIL, SAIGONMOVING_EXTERNAL_ID, SAIGONMOVING_PHOTOS,
  SAIGONMOVING_TRUCKS, saigonmovingDescription, saigonmovingMoney, saigonmovingSellerRefusal, saigonmovingTitle, stageSaigonmovingListing,
  type SaigonmovingLang, type SaigonmovingSeller,
} from './saigonmoving-listing'
import { CATEGORY_BY_SLUG, facetsFor, listingMoneyFor, servicePriceBasisOf } from './taxonomy'

const LANGS: SaigonmovingLang[] = ['en', 'vi']
const text = (lang: SaigonmovingLang) => `${saigonmovingTitle(lang)}\n${saigonmovingDescription(lang)}`
const STRINGS_OF_COPY = (l: SaigonmovingLang) => Object.values(SAIGONMOVING_COPY[l]).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []))

describe('the price guide', () => {
  it('holds the owner’s figures exactly (2026-11-09): box, first 10 km, each km 11–50, loading at both ends', () => {
    expect(SAIGONMOVING_TRUCKS.map((t) => [t.label.en, t.box, t.first10km, t.perKm, t.loading])).toEqual([
      ['Transit 800 kg van', [2.4, 1.5, 1.5], 550_000, 25_000, 700_000],
      ['Truck 1 tonne', [3, 1.6, 1.6], 600_000, 25_000, 900_000],
      ['Truck 1.4 tonnes', [3.4, 1.65, 1.6], 630_000, 30_000, 1_200_000],
      ['Truck 1.9 tonnes', [4.38, 1.85, 1.8], 700_000, 40_000, 1_700_000],
      ['Tail-lift truck 1.9 t', [4.4, 1.9, 1.9], 950_000, 55_000, 2_000_000],
      ['Truck 2.2 tonnes', [4.5, 2, 2], 750_000, 45_000, 1_900_000],
      ['Long truck 2 tonnes', [6.2, 2, 2], 1_200_000, 55_000, 2_500_000],
    ])
  })

  it('puts the smallest move on the card: the Transit van’s first 10 km plus loading at both ends', () => {
    expect(SAIGONMOVING_CARD_PRICE).toBe(1_250_000)
    expect(stageSaigonmovingListing('business').price).toBe(1_250_000)
  })

  it.each(LANGS)('%s: says what the card price covers, in its own figures', (lang) => {
    const d = saigonmovingDescription(lang)
    for (const n of [1_250_000, 550_000, 700_000]) expect(d).toContain(saigonmovingMoney(n, lang))
  })

  it('prints every figure, exactly, in both number styles', () => {
    const en = saigonmovingDescription('en'), vi = saigonmovingDescription('vi')
    for (const row of [
      'Transit 800 kg van: 550,000 đ, then 25,000 đ/km', 'Truck 1.4 tonnes: 630,000 đ, then 30,000 đ/km',
      'Tail-lift truck 1.9 t: 950,000 đ, then 55,000 đ/km', 'Long truck 2 tonnes: 1,200,000 đ, then 55,000 đ/km',
      'Truck 2.2 tonnes: 1,900,000 đ', 'Long truck 2 tonnes: 2,500,000 đ', 'Truck 1.9 tonnes: 4.38 × 1.85 × 1.8 m',
      'Carton box (60 × 40 × 35 cm): 18,000 đ each', 'PE wrap: 150,000 đ for a 2.4 kg roll', '400,000 đ per unit',
      'Waiting time: 100,000–200,000 đ an hour',
    ]) expect(en).toContain(row)
    for (const row of [
      'Xe Transit 800 kg: 550.000 đ, sau đó 25.000 đ/km', 'Xe tải 1.4 tấn: 630.000 đ, sau đó 30.000 đ/km',
      'Xe 1.9 tấn bửng nâng: 950.000 đ, sau đó 55.000 đ/km', 'Xe 2 tấn thùng dài: 1.200.000 đ, sau đó 55.000 đ/km',
      'Xe tải 2.2 tấn: 1.900.000 đ', 'Xe 2 tấn thùng dài: 2.500.000 đ', 'Xe tải 1.9 tấn: 4,38 × 1,85 × 1,8 m',
      'Thùng carton (60 × 40 × 35 cm): 18.000 đ/thùng', 'Màng PE: 150.000 đ/cuộn 2,4 kg', '400.000 đ/bộ',
      'Phí chờ: 100.000–200.000 đ/giờ',
    ]) expect(vi).toContain(row)
    for (const t of SAIGONMOVING_TRUCKS) for (const lang of LANGS) {
      for (const n of [t.first10km, t.perKm, t.loading]) expect(saigonmovingDescription(lang)).toContain(saigonmovingMoney(n, lang))
    }
  })
})

describe('every language', () => {
  it.each(LANGS)('%s: three tables of seven trucks, two lists, and nothing run together into one paragraph', (lang) => {
    const groups = richTextGroups(saigonmovingDescription(lang))
    const tables = groups.filter((g) => g.kind === 'dl')
    expect(tables).toHaveLength(3)
    for (const t of tables) expect(t.kind === 'dl' && t.rows.map((r) => r[0])).toEqual(SAIGONMOVING_TRUCKS.map((x) => x.label[lang]))
    // What it covers, how the price is worked out, the three tables, extras, good to know.
    expect(groups.filter((g) => g.kind === 'h')).toHaveLength(7)
    expect(groups.filter((g) => g.kind === 'ul').map((g) => g.kind === 'ul' && g.items.length)).toEqual([5, 5])
    // The intro, the offices line, the formula, the card note and the caveat — each its own paragraph.
    expect(groups.filter((g) => g.kind === 'p')).toHaveLength(5)
  })

  it.each(LANGS)('%s: passes the publish guard, so an admin editing the listing is not refused', (lang) => {
    expect(() => assertCleanTexts([saigonmovingTitle(lang), saigonmovingDescription(lang)])).not.toThrow()
  })

  it.each(LANGS)('%s: no phone, email, street, link or emoji of the partner', (lang) => {
    expect(text(lang)).not.toMatch(/0909|0879|885\s?158|707\s?789|gmail|@|Nơ Trang Long|285|saigonmoving\.com|zalo|https?:|www\./i)
    expect(text(lang)).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it.each(LANGS)('%s: names no other moving company', (lang) => {
    expect(fold(text(lang))).not.toMatch(/anh ?chuyen ?nha|kien vang|thanh hung|chuyen nha 24h/)
  })

  it.each(LANGS)('%s: the title is short and carries no price, number or phone', (lang) => {
    const t = saigonmovingTitle(lang)
    expect(t.length).toBeLessThanOrEqual(80)
    expect(t).not.toMatch(/\d|đ/)
  })

  it.each(LANGS)('%s: fits the post form’s 5,000-character description, so an admin can edit it without a cut', (lang) => {
    expect(saigonmovingDescription(lang).length).toBeLessThanOrEqual(5000)
  })

  it.each(LANGS)('%s: says the prices are a guide, confirmed after a free survey', (lang) => {
    const note = SAIGONMOVING_COPY[lang].note
    expect(saigonmovingDescription(lang).endsWith(note)).toBe(true)
    expect(fold(note)).toMatch(lang === 'en' ? /guide.*exact price after the free survey.*varies/ : /tham khao.*bao gia chinh xac sau khi khao sat mien phi.*thay doi/)
  })

  it('vi is its own text, not the English copy', () => {
    const en = new Set(STRINGS_OF_COPY('en'))
    for (const s of STRINGS_OF_COPY('vi')) expect(en.has(s), s).toBe(false)
    expect(saigonmovingDescription('vi')).toMatch(/[ạảãàáâậầấẩẫăắằặẳẵđêềếệểễôồốộổỗơờớợởỡưừứựửữ]/)
  })
})

describe('stageSaigonmovingListing', () => {
  const row = stageSaigonmovingListing('business')

  it('files under Services › Moving as a service, in a slot the taxonomy has', () => {
    const services = CATEGORY_BY_SLUG.services
    expect(services.types).toContain(row.listingType)
    expect(services.subcategories.map((s) => s.slug)).toContain(row.subcategorySlug)
    expect(row.subcategorySlug).toBe('moving-delivery')
    expect(row.externalId).toBe(SAIGONMOVING_EXTERNAL_ID)
  })

  it('is a one-time price per service, fixed, as a hand-posted one-time service is stored', () => {
    expect(row.priceUnit).toBe('VND/service')
    expect(row.priceUnit).toBe(listingMoneyFor({ categorySlug: 'services', subcategorySlug: row.subcategorySlug, listingType: 'service', priceBasis: servicePriceBasisOf(row.attributes) }).priceUnit)
    expect(row.currency).toBe('₫')
    expect(row.negotiable).toBe(false)
  })

  it('writes facet values the Services filters offer: at the customer’s, one-time, and the derived provider type', () => {
    const attrs = JSON.parse(row.attributes) as Record<string, string>
    expect(attrs).toEqual({ serviceLocation: 'at-customer', priceBasis: 'one-time', providerType: 'business' })
    const facets = facetsFor('services', 'moving-delivery')
    for (const [key, value] of Object.entries(attrs)) {
      expect(facets.find((f) => f.key === key)?.options?.map((o) => o.value), key).toContain(value)
    }
    expect(JSON.parse(stageSaigonmovingListing('individual').attributes).providerType).toBe('individual')
  })

  it('sits in Bình Thạnh, HCMC; the street address stays on the storefront', () => {
    expect(row.city).toBe('Hồ Chí Minh')
    expect(row.district).toBe('Quận Bình Thạnh')
    expect(row.location).not.toContain('Nơ Trang Long')
    expect(SAIGONMOVING_ADDRESS).toContain('Quận Bình Thạnh')
    expect(row.lat).toBeGreaterThan(10.8)
    expect(row.lat).toBeLessThan(10.83)
    expect(row.lng).toBeGreaterThan(106.68)
    expect(row.lng).toBeLessThan(106.72)
  })

  it('is found by the words a mover is searched for, in both languages', () => {
    for (const w of ['chuyen nha tron goi', 'moving', 'saigon moving', 'binh thanh']) expect(row.searchText).toContain(w)
  })
})

describe('the photos', () => {
  it('are the partner’s own, pinned by content, and clear the Services photo floor', () => {
    expect(SAIGONMOVING_PHOTOS.length).toBeGreaterThanOrEqual(minPhotosFor('services'))
    for (const p of SAIGONMOVING_PHOTOS) {
      expect(p.url.startsWith('https://saigonmoving.com/upload/')).toBe(true)
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(new Set(SAIGONMOVING_PHOTOS.map((p) => p.sha256)).size).toBe(SAIGONMOVING_PHOTOS.length)
  })
})

describe('saigonmovingSellerRefusal', () => {
  const seller: SaigonmovingSeller = { id: 's', ownerId: 'o', ownerEmail: SAIGONMOVING_EMAIL, officialPartner: true, trustScore: 60 }
  it('takes the partner storefront, whatever the case of the stored email', () => {
    expect(saigonmovingSellerRefusal(seller)).toBeNull()
    expect(saigonmovingSellerRefusal({ ...seller, ownerEmail: 'SaigonMoving.com@gmail.com' })).toBeNull()
  })
  it('refuses no storefront, no owner, another owner, or one not chat-only yet', () => {
    expect(saigonmovingSellerRefusal(null)).toMatch(/register it first/)
    expect(saigonmovingSellerRefusal({ ...seller, ownerId: null })).toMatch(/no owning account/)
    expect(saigonmovingSellerRefusal({ ...seller, ownerEmail: 'someone@else.vn' })).toMatch(/owned by/)
    expect(saigonmovingSellerRefusal({ ...seller, ownerEmail: null })).toMatch(/owned by/)
    expect(saigonmovingSellerRefusal({ ...seller, officialPartner: false })).toMatch(/official partner/)
  })

  it('takes the tobacco mark out of every photo before upload: a crop clear of it, or a blur box over it, inside the 720×960 frame', () => {
    // Both of the partner's photos show a reused "CRAVEN" cigarette carton (Vietnam bans tobacco advertising).
    for (const p of SAIGONMOVING_PHOTOS) {
      expect(Boolean(p.crop) || p.blur.length > 0, p.url).toBe(true)
      for (const b of [...(p.crop ? [p.crop] : []), ...p.blur]) {
        expect(b.left).toBeGreaterThanOrEqual(0)
        expect(b.top).toBeGreaterThanOrEqual(0)
        expect(b.left + b.width).toBeLessThanOrEqual(720)
        expect(b.top + b.height).toBeLessThanOrEqual(960)
      }
    }
    // The cover's carton (x ≈ 505–552, y ≈ 490–615) is under its blur; the second photo's mark (x ≥ 650) is cropped away.
    const [cover, packing] = SAIGONMOVING_PHOTOS
    expect(cover.blur.some((b) => b.left <= 505 && b.left + b.width >= 552 && b.top <= 490 && b.top + b.height >= 615)).toBe(true)
    expect(packing.crop && packing.crop.left + packing.crop.width).toBeLessThanOrEqual(640)
  })
})
