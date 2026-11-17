import { describe, expect, it } from 'vitest'
import {
  CAR_PARTNERS, carDescription, carPartner, carPartnerSellerRefusal, carResearchProblem, carTitle, stageCarPartnerCar,
} from './car-partners'
import { validateHandle } from './handle-format'
import { assertCleanTexts } from './publish-guard'
import { richTextGroups } from './rich-text-blocks'

const LANGS = ['en', 'vi'] as const
const all = CAR_PARTNERS.flatMap((p) => p.cars.map((c) => ({ p, c })))

describe('the roster', () => {
  it('five shops, each with a valid unique handle and an eno-held email for it', () => {
    expect(CAR_PARTNERS.map((p) => p.handle)).toEqual(['karplus', 'carbi', 'ankhanhtravel', 'quehuong', 'anbinhtours'])
    expect(CAR_PARTNERS.filter((p) => p.held).map((p) => p.handle)).toEqual(['anbinhtours'])
    for (const p of CAR_PARTNERS) {
      expect(validateHandle(p.handle), p.handle).toBeNull()
      expect(p.email).toBe(`support+${p.handle}@eno.vn`)
    }
  })

  it('every car is unique in its shop, priced, and points at its own research row', () => {
    for (const p of CAR_PARTNERS) {
      expect(new Set(p.cars.map((c) => c.slug)).size, p.handle).toBe(p.cars.length)
      expect(new Set(p.cars.map((c) => c.src)).size, p.handle).toBe(p.cars.length)
      expect(new Set(p.cars.map((c) => c.name)).size, p.handle).toBe(p.cars.length)
      for (const c of p.cars) {
        expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        expect(c.perDay).toBeGreaterThanOrEqual(500_000)
        expect(c.perDay).toBeLessThanOrEqual(3_000_000)
      }
    }
  })
})

describe('the listing text', () => {
  it.each(LANGS)('%s: no phone, link, email or street address anywhere (chat-only partners)', (lang) => {
    for (const { p, c } of all) expect(() => assertCleanTexts([carTitle(c, lang), carDescription(p, c, lang)]), `${p.handle}:${c.slug}`).not.toThrow()
  })

  it.each(LANGS)('%s: intro, a price list, a terms list and the source line — nothing run together', (lang) => {
    for (const { p, c } of all) {
      const groups = richTextGroups(carDescription(p, c, lang))
      expect(groups.map((g) => g.kind), `${p.handle}:${c.slug}`).toEqual(['p', 'h', 'ul', 'h', 'ul', 'p'])
    }
  })

  it('states whose prices they are and when, and An Khánh\'s page date', () => {
    for (const { p, c } of all) {
      expect(carDescription(p, c, 'en')).toContain(`Prices as ${p.name}`)
      expect(carDescription(p, c, 'en')).toContain('17 November 2026')
      expect(carDescription(p, c, 'vi')).toContain('17/11/2026')
    }
    const ak = carPartner('ankhanhtravel')!
    expect(carDescription(ak, ak.cars[0], 'en')).toContain('dated April 2024')
    expect(carDescription(ak, ak.cars[0], 'vi')).toContain('tháng 4/2024')
  })

  it('prints the day price in each language\'s money format, and KarPlus\'s driver add-on', () => {
    const kp = carPartner('karplus')!
    const c300 = kp.cars.find((c) => c.slug === 'mercedes-c300')!
    expect(carDescription(kp, c300, 'en')).toContain('- Self-drive: 1,700,000 đ a day')
    expect(carDescription(kp, c300, 'vi')).toContain('- Tự lái: 1.700.000 đ/ngày')
    expect(carDescription(kp, c300, 'en')).toContain('- With a driver: +600,000 đ for 10 hours')
    expect(carDescription(kp, kp.cars[0], 'en')).toContain('- With a driver: +500,000 đ for 10 hours')
    const cb = carPartner('carbi')!
    expect(carDescription(cb, cb.cars[0], 'en')).not.toContain('driver:')
  })
})

describe('stageCarPartnerCar', () => {
  it('a daily car rental on the shop\'s district, with the seats and transmission facets', () => {
    const p = carPartner('quehuong')!
    const transit = p.cars.find((c) => c.slug === 'ford-transit')!
    const row = stageCarPartnerCar(p, transit)
    expect(row).toMatchObject({
      externalId: 'quehuong:ford-transit', subcategorySlug: 'car-rental', listingType: 'rent', priceUnit: 'VND/day',
      price: 1_800_000, currency: '₫', district: 'Quận 12', city: 'Hồ Chí Minh', lat: p.pin.lat, lng: p.pin.lng,
    })
    expect(JSON.parse(row.attributes)).toEqual({ rentalPeriod: 'daily', transmission: 'manual', seats: '9plus' })
    expect(row.title).toBe('Ford Transit self-drive rental (16 seats)')
    expect(row.description).toContain('class D1 licence or higher')
    expect(row.descriptionVi).toContain('hạng D1 trở lên')
    expect(row.titleVi).toBe('Cho thuê xe tự lái Ford Transit 16 chỗ')
  })

  it('leaves out what the shop did not state (seats, transmission)', () => {
    const p = carPartner('carbi')!
    const row = stageCarPartnerCar(p, p.cars.find((c) => c.slug === 'honda-cr-v')!)
    expect(JSON.parse(row.attributes)).toEqual({ rentalPeriod: 'daily' })
    expect(row.title).toBe('Honda CR-V self-drive rental')
    expect(row.titleVi).toBe('Cho thuê xe tự lái Honda CR-V')
  })
})

describe('the run\'s checks', () => {
  const p = carPartner('karplus')!
  const c = p.cars[0]
  it('refuses a car whose research price moved', () => {
    expect(carResearchProblem(p, c, { model: 'Ford Ecosport', selfDrive: { perDay: 600_000 } })).toBeNull()
    expect(carResearchProblem(p, c, { model: 'Ford Ecosport', selfDrive: { perDay: 650_000 } })).toMatch(/research says 650000/)
    expect(carResearchProblem(p, c, undefined)).toMatch(/no car #0/)
    // A reordered research file names another car: refused even at the same price (its photos would go on this listing).
    expect(carResearchProblem(p, c, { model: 'Ford Focus', selfDrive: { perDay: 600_000 } })).toMatch(/reordered/)
  })
  it('matches every car of the module to its own research row', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    for (const shop of CAR_PARTNERS) {
      const f = `${process.env.HOME}/eno-car-partners-2026-11-17/${shop.research}/data.json`
      if (!existsSync(f)) continue // the research lives on the owner's Mac, not in CI
      const rows = JSON.parse(readFileSync(f, 'utf8')).cars
      for (const car of shop.cars) expect(carResearchProblem(shop, car, rows[car.src]), `${shop.handle}:${car.slug}`).toBeNull()
    }
  })
  it('writes only onto the shop\'s own storefront, owned by its eno login, flagged official', () => {
    const seller = { id: 's1', ownerId: 'o1', ownerEmail: 'support+karplus@eno.vn', officialPartner: true, trustScore: 50, location: null }
    expect(carPartnerSellerRefusal(p, seller)).toBeNull()
    expect(carPartnerSellerRefusal(p, null)).toMatch(/register it first/)
    expect(carPartnerSellerRefusal(p, { ...seller, ownerId: null })).toMatch(/no owning account/)
    expect(carPartnerSellerRefusal(p, { ...seller, ownerEmail: 'someone@else.vn' })).toMatch(/owned by someone@else.vn/)
    expect(carPartnerSellerRefusal(p, { ...seller, officialPartner: false })).toMatch(/not an official partner/)
  })
})
