import { describe, expect, it } from 'vitest'
import {
  BAD_PHOTO_FLAGS, MAX_PHOTOS, VEHICLE_SELLERS, cleanBikeName, redactContact, sourcePostedAt, stageBonbon, stageMioto, stageShopBike, titleCaseCar,
  type StageDeps,
} from './vehicle-rental-listing'
import { parseFacetTokens } from './facet-tokens'

const deps: StageDeps = { resolve: (rel) => `/data/${rel}`, fileOk: (abs) => !abs.includes('missing') }

const photos = (n: number, base = 'https://cdn.example/p') => Array.from({ length: n }, (_, i) => `${base}${i}.jpg`)
const locals = (id: string, n: number) => Array.from({ length: n }, (_, i) => `images/${id}/${String(i + 1).padStart(2, '0')}.jpg`)

function mioto(over: Record<string, unknown> = {}) {
  return {
    id: 'K2D7ZE', name: 'VINFAST FADIL 2022', seats: 4, transmission: 'automatic', fuel: 'gasoline',
    price_vnd_day: 850000, discountWeekly: 10, discountMonthly: 0, rentByHour: 1, deliveryEnable: 1, deliveryRadius: 20,
    airportDeliveryEnable: 0, limitEnable: 1, limitKM: 300, limitPrice: 3000,
    desc: 'Xe mới. Liên hệ 0909 123 456', feature_ids: ['bt', 'gp'], features: ['Bluetooth', 'Định vị GPS'],
    requiredPapers: ['GPLX & CCCD'], mortgages: ['Không yêu cầu thế chấp'],
    lat: 10.770170118, lon: 106.704302949, city: 'TP. Hồ Chí Minh', district: 'Quận 1', ward: 'Phường Bến Nghé',
    address: 'Phường Bến Nghé, Quận 1', totalTrips: 12, status: 2,
    photos: photos(5), local_images: locals('K2D7ZE', 5),
    source_url: 'https://www.mioto.vn/car/vinfast-fadil-2022/K2D7ZE', scraped_at: '2026-09-28T14:33:39+07:00',
    ...over,
  }
}
const miotoDeps = (shared: string[] = [], sha1: (string | null)[] = ['a', 'b', 'c', 'd', 'e']) =>
  ({ ...deps, sharedSha1: new Set(shared), sha1Of: () => sha1 })

describe('stageMioto', () => {
  it('stages an HCMC car per DAY, with the rental facets and a rounded pin', () => {
    const r = stageMioto(mioto(), miotoDeps())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.externalId).toBe('mioto:K2D7ZE')
    expect(r.row.price).toBe(850000)
    expect(r.row.priceUnit).toBe('VND/day')
    expect(r.row.subcategorySlug).toBe('car-rental')
    expect(r.row.city).toBe('Hồ Chí Minh')
    expect(r.row.title).toBe('VinFast Fadil 2022 self-drive rental · 4 seats · automatic — Quận 1')
    expect(r.row.titleVi).toContain('Cho thuê xe tự lái VinFast Fadil 2022')
    expect(JSON.parse(r.row.attributes)).toEqual({ rentalPeriod: 'daily', transmission: 'automatic', seats: '4', delivery: 'delivered' })
    expect(parseFacetTokens(r.row.facetTokens)).toEqual(expect.arrayContaining([
      { key: 'rentalPeriod', value: 'daily' }, { key: 'rentalPeriod', value: 'hourly' },
      { key: 'delivery', value: 'delivered' }, { key: 'delivery', value: 'pickup' },
    ]))
    // ⛔ a P2P car's coordinates are often its owner's home — ~1 km, never full precision.
    expect(r.row.lat).toBe(10.77)
    expect(r.row.lng).toBe(106.7)
    expect(r.row.affiliateUrl).toBe('https://www.mioto.vn/car/vinfast-fadil-2022/K2D7ZE')
    expect(r.row.photos[0]).toEqual({ local: '/data/images/K2D7ZE/01.jpg', source: 'https://cdn.example/p0.jpg' })
  })

  it('never publishes a phone number from the owner text', () => {
    const r = stageMioto(mioto(), miotoDeps())
    expect(r.ok && r.row.descriptionVi).not.toMatch(/0909/)
    expect(r.ok && r.row.description).not.toMatch(/0909/)
  })

  it('drops shared (fleet stock) photos and requires three real ones', () => {
    const r = stageMioto(mioto(), miotoDeps(['a', 'c']))
    expect(r.ok && r.row.photos.map((p) => p.source)).toEqual(['https://cdn.example/p1.jpg', 'https://cdn.example/p3.jpg', 'https://cdn.example/p4.jpg'])
    expect(stageMioto(mioto(), miotoDeps(['a', 'b', 'c']))).toEqual({ ok: false, reason: 'fewPhotos' })
  })

  it('skips a missing or empty local file rather than keeping a url we cannot host', () => {
    const r = stageMioto(mioto({ local_images: ['images/x/missing.jpg', ...locals('K2D7ZE', 4)] }), miotoDeps())
    expect(r.ok && r.row.photos).toHaveLength(4)
  })

  it(`caps the gallery at ${MAX_PHOTOS}`, () => {
    const r = stageMioto(mioto({ photos: photos(10), local_images: locals('K2D7ZE', 10) }), miotoDeps([], []))
    expect(r.ok && r.row.photos).toHaveLength(MAX_PHOTOS)
  })

  it('refuses rows outside scope or with an untrusted link', () => {
    expect(stageMioto(mioto({ city: 'Hà Nội' }), miotoDeps())).toEqual({ ok: false, reason: 'notHcmc' })
    expect(stageMioto(mioto({ status: 4 }), miotoDeps())).toEqual({ ok: false, reason: 'notActive' })
    expect(stageMioto(mioto({ source_url: 'https://evil.example/car/x/K2D7ZE' }), miotoDeps())).toEqual({ ok: false, reason: 'badTarget' })
    expect(stageMioto(mioto({ source_url: 'https://www.mioto.vn/car/other/ZZZZZZ' }), miotoDeps())).toEqual({ ok: false, reason: 'badTarget' })
    expect(stageMioto(mioto({ price_vnd_day: 12 }), miotoDeps())).toEqual({ ok: false, reason: 'noPrice' })
    expect(stageMioto(mioto({ price_vnd_day: null }), miotoDeps())).toEqual({ ok: false, reason: 'noPrice' })
  })

  it('stores no pin for coordinates outside Vietnam', () => {
    const r = stageMioto(mioto({ lat: 0, lon: 0 }), miotoDeps())
    expect(r.ok && [r.row.lat, r.row.lng]).toEqual([null, null])
  })
})

function bonbon(over: Record<string, unknown> = {}) {
  return {
    sku: 'ACCENT_039', name: 'Hyundai Accent 2024', brand: 'HYUNDAI', seats: 5, transmission: 'Số tự động', fuel: 'Xăng',
    rent_unit: 'hour', price_per_day_vnd: 850000, price_1h_vnd: 150000, price_4h_vnd: 450000, price_8h_vnd: 600000, price_12h_vnd: 680000,
    weekend_surcharge_per_day_vnd: 50000, deposit_vnd: 10000000, max_delivery_km: 50, km_limit_per_24h: 400, over_km_fee: '3.000 đ/km',
    description: 'Sedan hạng B. Hotline 0901 234 567', features: ['Bluetooth'],
    city: 'Hồ Chí Minh', district: 'Quận 7', ward: 'Phường Tân Phong', latitude: 10.7291, longitude: 106.7187,
    status: 'Onboard', detail_ok: true, photos: photos(4, 'https://objects.bonboncar.vn/p'), local_images: locals('ACCENT_039', 4),
    image_meta: [{ width: 1280, height: 960 }, { width: 1184, height: 864 }, { width: 1280, height: 960 }, { width: 864, height: 1184 }],
    source_url: 'https://www.bonboncar.vn/detail/ACCENT_039', scraped_at: '2026-09-27T23:13:39+07:00',
    ...over,
  }
}

describe('stageBonbon', () => {
  it('drops the AI-edited photos by their generator sizes and keeps the real ones in order', () => {
    const r = stageBonbon(bonbon(), deps)
    expect(r.ok && r.row.photos.map((p) => p.source)).toEqual(['https://objects.bonboncar.vn/p0.jpg', 'https://objects.bonboncar.vn/p2.jpg'])
  })

  it('skips a car with only AI-edited photos', () => {
    const allGen = Array(4).fill({ width: 1344, height: 768 })
    expect(stageBonbon(bonbon({ image_meta: allGen }), deps)).toEqual({ ok: false, reason: 'onlyGeneratedPhotos' })
  })

  it('prices per 24h, lists the hourly packages, and redacts the hotline', () => {
    const r = stageBonbon(bonbon(), deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.priceUnit).toBe('VND/day')
    expect(r.row.description).toContain('Hourly packages: 1h 150,000 đ')
    expect(r.row.descriptionVi).not.toMatch(/0901/)
    expect(JSON.parse(r.row.attributes).seats).toBe('5')
  })

  it('drops the 9.5M/day source typo instead of publishing it', () => {
    expect(stageBonbon(bonbon({ price_per_day_vnd: 9_500_000 }), deps)).toEqual({ ok: false, reason: 'noPrice' })
  })

  it('stays in HCMC', () => {
    expect(stageBonbon(bonbon({ city: 'Hà Nội' }), deps)).toEqual({ ok: false, reason: 'notHcmc' })
  })
})

function bike(over: Record<string, unknown> = {}) {
  return {
    shop: 'janmotorbike', city: 'Ho Chi Minh City', external_id: '17459', name: 'Honda Airblade 125cc Rental', make: 'Honda', model: 'Airblade 125cc',
    engine_cc: 125, type: 'automatic scooter', availability: 'in stock',
    prices: [
      { amount: 2500000, currency: 'VND', unit: 'month', label: 'listed price (monthly rental)' },
      { amount: 2700000, currency: 'VND', unit: 'month', label: 'regular (pre-sale) monthly price' },
    ],
    deposit: 'Pay the refundable deposit.', delivery: 'Free delivery within District 2.',
    description: 'Type: Automatic\nContact JAN’S MOTORBIKE : +84909 29 0078 (WhatsApp,Zalo)\nFind Us: 5, 5th Street\nA great scooter.',
    photos: photos(3, 'https://janmotorbike.com/p'), local_images: locals('17459', 3), photo_flags: [[], ['stock'], []],
    image_meta: [{ width: 800 }, { width: 800 }, { width: 800 }],
    source_url: 'https://janmotorbike.com/honda-airblade-125cc-rental-in-hcmc-2/', scraped_at: '2026-09-27T16:43:05Z',
    ...over,
  }
}
const fx = { vndPerUsd: 26_000, source: 'test' }

describe('stageShopBike', () => {
  it("stages Jan's per MONTH (the only period it quotes), ignoring the struck-through regular price", () => {
    const r = stageShopBike(bike(), { ...deps, fx })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row.price).toBe(2_500_000)
    expect(r.row.priceUnit).toBe('VND/month')
    expect(r.row.rentalPeriod).toBe('monthly')
    expect(r.row.subcategorySlug).toBe('motorbike-rental')
    expect(r.row.district).toBe('Thủ Đức')
    expect(r.row.title).toBe("Honda Airblade 125cc for rent · automatic scooter — Jan's Motorbike, Thủ Đức")
    expect(r.row.photos.map((p) => p.source)).toEqual(['https://janmotorbike.com/p0.jpg', 'https://janmotorbike.com/p2.jpg'])
  })

  it('never carries the shop phone or address block into the description', () => {
    const r = stageShopBike(bike(), { ...deps, fx })
    expect(r.ok && r.row.description).not.toMatch(/0078|WhatsApp|Find Us/)
    expect(r.ok && r.row.descriptionVi).not.toMatch(/0078|WhatsApp|Find Us/)
    expect(r.ok && r.row.description).toContain('A great scooter.')
  })

  it('leads with the shortest period a shop quotes and tags every period', () => {
    const r = stageShopBike(bike({
      shop: 'theextramile', source_url: 'https://theextramile.co/motorbikes/yamaha-janus-2022/', availability: 'unknown',
      prices: [
        { amount: 2800000, currency: 'VND', unit: 'month', label: 'monthly' },
        { amount: 280000, currency: 'VND', unit: 'day', label: 'first day price' },
        { amount: 1400000, currency: 'VND', unit: 'week', label: 'weekly' },
      ],
    }), { ...deps, fx })
    expect(r.ok && [r.row.price, r.row.priceUnit]).toEqual([280000, 'VND/day'])
    expect(r.ok && parseFacetTokens(r.row.facetTokens).map((t) => t.value)).toEqual(['daily', 'weekly', 'monthly'])
  })

  it('converts a USD quote, says so beside the price, and fails closed without a rate', () => {
    const usd = bike({
      shop: 'dungmotorbikes', source_url: 'https://dungmotorbikes.com/bike/honda-xr-150cc/', availability: 'listed', type: 'manual',
      prices: [{ amount: 13, currency: 'USD', unit: 'day', label: 'per day' }, { amount: 300, currency: 'USD', unit: 'month', label: 'monthly (travel)' }],
    })
    const r = stageShopBike(usd, { ...deps, fx })
    expect(r.ok && [r.row.price, r.row.priceUnit]).toEqual([340_000, 'VND/day'])
    expect(r.ok && r.row.description).toContain('the shop quotes US$13/day')
    expect(r.ok && r.row.descriptionVi).toContain('cửa hàng báo giá US$13/ngày')
    expect(r.ok && JSON.parse(r.row.attributes).transmission).toBe('manual')
    expect(stageShopBike(usd, { ...deps, fx: null })).toEqual({ ok: false, reason: 'usdNoRate' })
  })

  it('refuses unpriced, out-of-stock, off-scope and photo-less bikes', () => {
    expect(stageShopBike(bike({ prices: [] }), { ...deps, fx })).toEqual({ ok: false, reason: 'noPrice' })
    expect(stageShopBike(bike({ availability: 'out of stock' }), { ...deps, fx })).toEqual({ ok: false, reason: 'notActive' })
    expect(stageShopBike(bike({ shop: 'dcmotorbikes' }), { ...deps, fx })).toEqual({ ok: false, reason: 'shopNotInScope' })
    expect(stageShopBike(bike({ city: 'Hanoi' }), { ...deps, fx })).toEqual({ ok: false, reason: 'notHcmc' })
    expect(stageShopBike(bike({ photo_flags: [['stock'], ['watermark'], ['face']] }), { ...deps, fx })).toEqual({ ok: false, reason: 'noPhotos' })
    expect(stageShopBike(bike({ source_url: 'https://janmotorbike.evil.com/x' }), { ...deps, fx })).toEqual({ ok: false, reason: 'badTarget' })
  })

  it('drops thumbnails', () => {
    const r = stageShopBike(bike({ image_meta: [{ width: 300 }, { width: 800 }, { width: 800 }], photo_flags: [[], [], []] }), { ...deps, fx })
    expect(r.ok && r.row.photos).toHaveLength(2)
  })
})

describe('helpers', () => {
  it("dates a row from the SOURCE's listing date, clamped to now, falling back to the scrape", () => {
    const now = Date.parse('2026-09-28T00:00:00Z')
    expect(sourcePostedAt('2024-05-01T10:00:00+07:00', '2026-09-27T00:00:00Z', now).toISOString()).toBe('2024-05-01T03:00:00.000Z')
    expect(sourcePostedAt('2030-01-01T00:00:00Z', '2026-09-27T00:00:00Z', now).getTime()).toBe(now)
    expect(sourcePostedAt(null, '2026-09-27T00:00:00Z', now).toISOString()).toBe('2026-09-27T00:00:00.000Z')
    expect(sourcePostedAt('garbage', undefined, now).getTime()).toBe(now)
  })

  it('stamps each source row with its own date', () => {
    const r = stageMioto(mioto({ timeCreated: '2024-01-02T03:04:05+07:00' }), miotoDeps())
    expect(r.ok && r.row.postedAt.toISOString()).toBe('2024-01-01T20:04:05.000Z')
    const b = stageBonbon(bonbon({ listed_at: '2025-10-04T03:57:43.935Z' }), deps)
    expect(b.ok && b.row.postedAt.toISOString()).toBe('2025-10-04T03:57:43.935Z')
  })

  it('title-cases shouty Mioto names without mangling models', () => {
    expect(titleCaseCar('VINFAST FADIL 2022')).toBe('VinFast Fadil 2022')
    expect(titleCaseCar('HYUNDAI I10 2016')).toBe('Hyundai i10 2016')
    expect(titleCaseCar('MAZDA CX-5 2020')).toBe('Mazda CX-5 2020')
    expect(titleCaseCar('TOYOTA VIOS E MT 2019')).toBe('Toyota Vios E MT 2019')
    expect(titleCaseCar('KIA MORNING 2018')).toBe('Kia Morning 2018')
  })

  it('cleans shop product names', () => {
    expect(cleanBikeName('Honda Cub 50cc for Rent')).toBe('Honda Cub 50cc')
    expect(cleanBikeName('Honda Airblade 125cc Rental')).toBe('Honda Airblade 125cc')
    expect(cleanBikeName('Yamaha Nouvo 5 For Rent')).toBe('Yamaha Nouvo 5')
  })

  it('redacts phones, emails and links but keeps prose', () => {
    expect(redactContact('Call +84 909 290 078 or 0909.290.078 now')).toBe('Call or now')
    expect(redactContact('Mail us: a.b@shop.vn — www.shop.vn')).toBe('Mail us: —')
    expect(redactContact('Deposit: 3,000,000 VND')).toBe('Deposit: 3,000,000 VND')
    // ⛔ dotted Vietnamese money must survive — the old pattern turned this into "Cọc 3..000đ".
    expect(redactContact('Cọc 3.000.000 - 5.000.000đ, giá 850.000/ngày')).toBe('Cọc 3.000.000 - 5.000.000đ, giá 850.000/ngày')
    expect(redactContact('Giá 10.000.000 đ/tháng')).toBe('Giá 10.000.000 đ/tháng')
    expect(redactContact('Gọi 0909 290 078 nhé')).toBe('Gọi nhé')
    expect(redactContact('Số 028.3822.1234 hoặc 84 909 290 078.')).toBe('Số hoặc .')
  })

  it('pins every seller by a fixed id and every outbound link to https on its own host', () => {
    const ids = Object.values(VEHICLE_SELLERS).map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of Object.values(VEHICLE_SELLERS)) {
      expect(s.target.test('http://' + s.target.source)).toBe(false)
      expect(s.target.test('https://evil.example/')).toBe(false)
    }
    expect(BAD_PHOTO_FLAGS.has('stock')).toBe(true)
  })
})
