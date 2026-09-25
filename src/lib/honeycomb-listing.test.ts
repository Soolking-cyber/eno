import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { matchesProvinceRow } from '@/lib/province-match'
import { REVER_BUILDINGS } from '@/generated/rever-buildings'
import vnUnits from '@/data/vn-units.json'
import { localizeImportText } from '@/lib/import-i18n'
import { fold } from '@/lib/fold'
import {
  allowedImage, allowedTarget, applyPreflight, assessHoneycomb, buildingFor, checkWard, cityOf, defaultSince,
  districtOf, galleryImages, hasHouseNumber, isGoneStatus, isPropertySitemap, journalDirProblem, oldDistrictsFor,
  originalImageUrl, parseAreaM2, parseDelayMs, parseHoneycombPage, parseSitemapIndex, parseUrlset, parseUsd,
  positiveCount, priceToStore, readHoneycombStage, rentLine, retireCandidates, robotsAllows, sellerRefusal,
  stageAgeProblem, stageHoneycombRecord, streetOf, usdFromDescription, usdToVnd, visiblePct, vndPerUsdFrom, wardOf,
  CITY_KEYS, CITY_NAME, CITY_PROVINCE_CODE, DEFAULT_SINCE_DAYS, DELAY_MS, HONEYCOMB_MONEY, HONEYCOMB_SELLER_ID,
  HONEYCOMB_SELLER_NAME, Infeasible, MAX_REDIRECTS, STAGE_MAX_AGE_H, STAGE_SOURCE, makePoliteGet, redirectTarget, runSince, textOf, valuedFlagProblem,
  robotsFromResponse,
  type HoneycombRecord,
} from './honeycomb-listing'

/**
 * The page shape below is copied from https://honeycomb.com.vn/property/feel-the-tranquil-air-in-this-cozy-furnished-apartment-at-estella-heights/
 * as served on 2026-09-24 (post 317878), trimmed to the blocks the parser reads plus the sidebar
 * thumbnails it must NOT read. If the theme changes, this is the fixture to refresh.
 */
function page(o: {
  postId?: string; bodyId?: string; shortId?: string; categ?: string; price?: string
  beds?: string; baths?: string; district?: string; address?: string; project?: string | null; extra?: string
} = {}): string {
  const id = o.postId ?? '317878'
  const categ = o.categ ?? '<a href="https://honeycomb.com.vn/properties/apartments-for-rent-in-hcmc/" rel="tag">Apartments</a> / '
  const project = o.project === null ? '' : `<div class="listing_detail col-md-12"><strong>Project:</strong> <a href="https://honeycomb.com.vn/apartments/the-estella-heights-apartment-for-rent/" rel="tag">${o.project ?? 'The Estella Heights'}</a></div>`
  return `<!DOCTYPE html><html><head>
<link rel='shortlink' href='https://honeycomb.com.vn/?p=${o.shortId ?? id}' />
<meta property="og:image" content="https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg"/>
</head><body class="wp-singular estate_property-template-default single single-estate_property postid-${o.bodyId ?? id} wp-custom-logo">
<div id="prop_categs" class="property_categs">${categ}</div>        <h1 class="entry-title entry-prop">Feel the tranquil air in this cozy furnished apartment at Estella Heights</h1>
<span class="price_area"><span class="price_label price_label_before"></span> $ 2,692 <span class="price_label"></span></span>
<div class="col-md-8 image_gallery lightbox_trigger special_border" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17-835x540.jpg)  ">   <div class="img_listings_overlay" ></div></div>
<div class="listing_detail col-md-12"><strong>Address:</strong> ${o.address ?? '88 Song Hanh, An Phu Ward, District 2, HCMC'}</div>${project}
<div class="listing_detail col-md-6" id="propertyid_display"><strong>Property Id:</strong> ${id}</div><div class="listing_detail col-md-6"><strong>Price:</strong> <span class="price_label price_label_before"></span> ${o.price ?? '$ 2,692'} <span class="price_label"></span></div><div class="listing_detail col-md-6"><strong>Bedrooms:</strong> ${o.beds ?? '3'}</div><div class="listing_detail col-md-6"><strong>Bathrooms:</strong> ${o.baths ?? '2'}</div><div class="listing_detail col-md-6"><strong>District:</strong> ${o.district ?? '2'}</div><div class="listing_detail col-md-6"><strong>Code:</strong> EH${id}</div>
<div class="listing_detail col-md-6"><i class="demo-icon icon-check"></i>Banking / ATM</div>
<div class="lightbox_property_slider col-md-12 lightbox_no_contact ">
  <div  id="owl-demo" class="owl-carousel owl-theme">
    <div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17-1110x640.jpg)"></div><div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-3-1110x640.jpg)"></div><div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-12-1110x640.jpg)"></div><div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-13-1110x640.jpg)"></div><div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-16-1110x640.jpg)"></div>                </div>
</div>
<div class="lighbox-image-close"><i class="fa fa-times" aria-hidden="true"></i></div>
<div class="widget_latest_internal"><img src="https://honeycomb.com.vn/wp-content/uploads/2026/09/2V-1-105x70.jpg"><div style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/MTD-1-105x70.jpg)"></div></div>
${o.extra ?? ''}
</body></html>`
}

const URL1 = 'https://honeycomb.com.vn/property/feel-the-tranquil-air-in-this-cozy-furnished-apartment-at-estella-heights/'
const RATE = 25_971.628089
const opts = { vndPerUsd: RATE, minImages: 3, cityFilter: null, buildings: REVER_BUILDINGS }

function rec(over: Partial<HoneycombRecord> = {}): HoneycombRecord {
  const r = parseHoneycombPage(page(), URL1)
  if (typeof r === 'string') throw new Error(r)
  return { ...r, ...over }
}

describe('parseHoneycombPage — the page as served', () => {
  it('a page with NO price (the "call us" listings) parses to a null price and is dropped as noPrice', () => {
    const html = page().replace(/<strong>Price:<\/strong>[\s\S]*?<\/div>/, '').replace(/\$ 2,692/g, '')
    const r = parseHoneycombPage(html, URL1)
    if (typeof r === 'string') throw new Error(r)
    expect(r.priceText).toBeNull()
    expect(assessHoneycomb(r, opts)).toEqual({ ok: false, reason: 'noPrice' })
  })

  it('reads every field the details and address panels carry', () => {
    const r = parseHoneycombPage(page(), URL1)
    expect(r).toMatchObject({
      postId: '317878', code: 'EH317878', categorySlugs: ['apartments-for-rent-in-hcmc'],
      priceText: '$ 2,692', priceLabel: '', bedrooms: 3, bathrooms: 2, districtRaw: '2',
      address: '88 Song Hanh, An Phu Ward, District 2, HCMC', project: 'The Estella Heights', areaM2: null,
    })
  })

  it('takes the FULL-SIZE gallery photos in order, and never the sidebar thumbnails of OTHER listings', () => {
    const r = parseHoneycombPage(page(), URL1)
    if (typeof r === 'string') throw new Error(r)
    expect(r.images).toEqual([
      'https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg',
      'https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-3.jpg',
      'https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-12.jpg',
      'https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-13.jpg',
      'https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-16.jpg',
    ])
    expect(r.images.some((u) => /2V-1|MTD-1/.test(u))).toBe(false)
  })

  it('⛔ with the lightbox END marker gone, never reads on into other listings (header strip instead)', () => {
    const html = page().replace('lighbox-image-close', 'lightbox-closer-renamed')
    const got = galleryImages(html)
    expect(got.some((u) => /2V-1|MTD-1/.test(u))).toBe(false)
    expect(got).toEqual(['https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg'])
  })

  it('falls back to the header strip when the lightbox is absent', () => {
    const html = page().replace(/id="owl-demo"[\s\S]*?lighbox-image-close/, 'lighbox-image-close')
    expect(galleryImages(html)).toEqual(['https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg'])
  })

  it('⛔ refuses a page whose three post ids disagree, rather than keying on the first one', () => {
    expect(parseHoneycombPage(page({ bodyId: '999' }), URL1)).toBe('idMismatch')
    expect(parseHoneycombPage(page({ shortId: '999' }), URL1)).toBe('idMismatch')
    const noIds = page().replace(/postid-\d+/, '').replace(/\?p=\d+/, '').replace(/Property Id:<\/strong> \d+/, 'Property Id:</strong> ')
    expect(parseHoneycombPage(noIds, URL1)).toBe('noId')
  })

  it('⛔ reads "Bedrooms: 0" as ABSENT — a villa page with both counts blank is not a studio', () => {
    const r = parseHoneycombPage(page({ beds: '0', baths: '0' }), URL1)
    if (typeof r === 'string') throw new Error(r)
    expect(r.bedrooms).toBeNull()
    expect(r.bathrooms).toBeNull()
    expect(positiveCount('12')).toBe(12)
    expect(positiveCount('three')).toBeNull()
  })
})

describe('assessHoneycomb — the row as it would be stored', () => {
  it('composes the reference-listing row', () => {
    const a = assessHoneycomb(rec(), opts)
    if (!a.ok) throw new Error(a.reason)
    const m = a.row
    expect(m.externalId).toBe('honeycomb:317878')
    expect(m.affiliateUrl).toBe(URL1)
    expect(m.title).toBe('3 bed · 2 bath apartment for rent — The Estella Heights, An Phu Ward, District 2')
    expect(m.titleVi).toBe('Cho thuê căn hộ 3PN — The Estella Heights, P. An Phú, Quận 2')
    expect(m.priceUsd).toBe(2692)
    expect(m.price).toBe(69_920_000)
    expect(m.subcategorySlug).toBe('apartment-rental')
    expect(m.city).toBe('Hồ Chí Minh')
    expect(m.district).toBe('Quận 2')
    expect(m.location).toBe('P. An Phú, Quận 2')
    expect(m.attributes).toBe(JSON.stringify({ bedrooms: '3', bathrooms: '2' }))
    expect(m.buildingKey).toBe('estella-heights')
    expect(m.lat).not.toBeNull()
    expect(m.description.startsWith('Listed on Honeycomb House (honeycomb.com.vn).\n\n')).toBe(true)
    expect(m.description).toContain('Rent: US$2,692/month')
    expect(m.descriptionVi).toContain('Giá thuê: 2.692 USD/tháng')
    expect(m.searchText).toContain('estella heights')
    expect(m.searchText).toContain('quan 2')
  })

  it('⛔ a missing bedroom count writes NO bedroom attribute, 5 beds file under "5" and 9 under "6" (= 6+)', () => {
    const none = assessHoneycomb(rec({ bedrooms: null, bathrooms: null }), opts)
    const noBeds = assessHoneycomb(rec({ bedrooms: null }), opts)
    const many = assessHoneycomb(rec({ bedrooms: 5 }), opts)
    const lots = assessHoneycomb(rec({ bedrooms: 9, bathrooms: 7 }), opts)
    if (!none.ok || !noBeds.ok || !many.ok || !lots.ok) throw new Error('dropped')
    expect(none.row.attributes).toBeNull()
    expect(noBeds.row.attributes).toBe(JSON.stringify({ bathrooms: '2' }))
    expect(many.row.attributes).toBe(JSON.stringify({ bedrooms: '5', bathrooms: '2' }))
    expect(lots.row.attributes).toBe(JSON.stringify({ bedrooms: '6', bathrooms: '6' }))
  })

  it('⛔ drops an unknown category instead of guessing — that is where sale stock would appear', () => {
    expect(assessHoneycomb(rec({ categorySlugs: ['apartments-for-sale-in-hcmc'] }), opts)).toEqual({ ok: false, reason: 'category' })
    expect(assessHoneycomb(rec({ categorySlugs: [] }), opts)).toEqual({ ok: false, reason: 'category' })
  })

  it('maps all four source categories', () => {
    const sub = (s: string) => { const a = assessHoneycomb(rec({ categorySlugs: [s] }), opts); return a.ok ? a.row.subcategorySlug : a.reason }
    expect(sub('apartments-for-rent-in-hcmc')).toBe('apartment-rental')
    expect(sub('penthouses-duplexes-for-rent-in-hcmc')).toBe('apartment-rental')
    expect(sub('houses-villas-for-rent-in-hcmc')).toBe('house-rental')
    // ⛔ Serviced flats are monthly leases: apartment-rental, like nhatot and muaban file them —
    // never `homestay-serviced`, which the site labels "Homestay" next to hotels.
    expect(sub('serviced-apartments-for-rent-in-hcmc')).toBe('apartment-rental')
  })

  it('⛔ either price signal can veto: a per-m² label, a per-night label, a đồng figure, a bare number', () => {
    expect(assessHoneycomb(rec({ priceLabel: '/m2' }), opts)).toEqual({ ok: false, reason: 'perM2' })
    expect(assessHoneycomb(rec({ priceText: '$ 25 / sqm' }), opts)).toEqual({ ok: false, reason: 'perM2' })
    expect(assessHoneycomb(rec({ priceLabel: '/night' }), opts)).toEqual({ ok: false, reason: 'notMonthly' })
    expect(assessHoneycomb(rec({ priceText: '70.000.000 VND' }), opts)).toEqual({ ok: false, reason: 'notUsd' })
    expect(assessHoneycomb(rec({ priceText: '2,692' }), opts)).toEqual({ ok: false, reason: 'notUsd' })
    expect(assessHoneycomb(rec({ priceText: '$ 450,000' }), opts)).toEqual({ ok: false, reason: 'usdBand' })
    expect(assessHoneycomb(rec({ priceText: null }), opts)).toEqual({ ok: false, reason: 'noPrice' })
    expect(assessHoneycomb(rec({ priceText: '' }), opts)).toEqual({ ok: false, reason: 'noPrice' })
    expect(assessHoneycomb(rec({ priceText: '$ 60' }), opts)).toEqual({ ok: false, reason: 'usdBand' })
  })

  it('refuses an off-host or off-path outbound URL', () => {
    expect(assessHoneycomb(rec({ url: 'https://evil.example/property/x/' }), opts)).toEqual({ ok: false, reason: 'badTarget' })
    expect(assessHoneycomb(rec({ url: 'http://honeycomb.com.vn/property/x/' }), opts)).toEqual({ ok: false, reason: 'badTarget' })
    expect(assessHoneycomb(rec({ url: 'https://honeycomb.com.vn/?p=1' }), opts)).toEqual({ ok: false, reason: 'badTarget' })
  })

  it('applies --city and the photo floor', () => {
    expect(assessHoneycomb(rec(), { ...opts, cityFilter: 'hanoi' })).toEqual({ ok: false, reason: 'cityFilter' })
    expect(assessHoneycomb(rec(), { ...opts, cityFilter: 'hcmc' }).ok).toBe(true)
    expect(assessHoneycomb(rec({ images: rec().images.slice(0, 2) }), opts)).toEqual({ ok: false, reason: 'tooFewImages' })
  })

  it('leaves coordinates null when the project is not a known map building (no guessing a pin)', () => {
    const a = assessHoneycomb(rec({ project: null, address: 'Stress 10, Thao Dien Ward, District 2, HCMC' }), opts)
    if (!a.ok) throw new Error(a.reason)
    expect([a.row.lat, a.row.lng, a.row.buildingKey]).toEqual([null, null, null])
    expect(a.row.title).toBe('3 bed · 2 bath apartment for rent — Thao Dien Ward, District 2')
  })

  it('never mentions a district for a non-HCMC city', () => {
    const a = assessHoneycomb(rec({ address: '12 Tran Phu, Hai Chau, Da Nang', districtRaw: '2', categorySlugs: ['apartments-for-rent-in-hcmc'] }), opts)
    if (!a.ok) throw new Error(a.reason)
    expect(a.row.city).toBe('Đà Nẵng')
    expect(a.row.district).toBeNull()
    expect(a.row.location).toBe('Đà Nẵng')
  })
})

describe('location vocabulary', () => {
  it('every Vietnamese district this importer can write lands on an explorer chip', () => {
    const raws = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh',
      'Go Vap', 'Tan Phu', 'Binh Tan', 'Thu Duc', 'Nha Be', 'Binh Chanh', 'Hoc Mon', 'Cu Chi', 'Can Gio']
    for (const raw of raws) {
      const d = districtOf(raw, null)
      expect(d, raw).not.toBeNull()
      const chip = DISTRICTS.find((x) => x.match?.some((m) => d!.vi.includes(m)))
      expect(chip, `${raw} → ${d!.vi}`).toBeDefined()
    }
  })

  it('reads the district from the address when the panel lacks it, and refuses nonsense', () => {
    expect(districtOf(null, 'Hoang Hoa Tham Street, Ward 6, Binh Thanh District, HCMC')).toEqual({ vi: 'Quận Bình Thạnh', en: 'Binh Thanh District' })
    expect(districtOf('', '1 Street, District 7, HCMC')?.vi).toBe('Quận 7')
    expect(districtOf('13', null)).toBeNull()
    expect(districtOf('Atlantis', null)).toBeNull()
  })

  it('wards and cities', () => {
    expect(wardOf('88 Song Hanh, An Phu Ward, District 2, HCMC')).toEqual({ kind: 'named', name: 'An Phu' })
    expect(wardOf('Hoang Hoa Tham Street, Ward 6, Binh Thanh District, HCMC')).toEqual({ kind: 'numbered', n: 6 })
    expect(wardOf('No ward here')).toBeNull()
    expect(cityOf('88 Song Hanh, District 2, HCMC', [])).toBe('hcmc')
    expect(cityOf('Somewhere', ['houses-villas-for-rent-in-hcmc'])).toBe('hcmc')
    expect(cityOf('Tay Ho, Hanoi', [])).toBe('hanoi')
    expect(cityOf('Somewhere', [])).toBeNull()
  })

  it('matches a project to a map building by folded name, and an ambiguous name to nothing', () => {
    expect(buildingFor('The Estella Heights', REVER_BUILDINGS)?.slug).toBe('estella-heights')
    expect(buildingFor('Masteri Thao Dien', REVER_BUILDINGS)?.name).toBe('Masteri Thảo Điền')
    expect(buildingFor('Diamond Island', REVER_BUILDINGS)?.name).toBe('Diamond Island - Đảo Kim Cương')
    expect(buildingFor('The Estella', REVER_BUILDINGS)).toBeNull() // a different tower
    const twin = { a: { slug: 'a', name: 'The Vista', lat: 10.8, lng: 106.7 }, b: { slug: 'b', name: 'Vista', lat: 10.8, lng: 106.7 } }
    expect(buildingFor('Vista', twin)).toBeNull()
  })
})

describe('money', () => {
  it('parses dollar figures and nothing else', () => {
    expect(parseUsd('$ 2,692')).toBe(2692)
    expect(parseUsd('Price: 3,500 USD / Month')).toBe(3500)
    expect(parseUsd('$ 1,250.50')).toBe(1250.5)
    expect(parseUsd('2,692')).toBeNull()
    expect(parseUsd('25 triệu')).toBeNull()
    expect(parseUsd('')).toBeNull()
    // A range is not a price (it used to publish its low end).
    expect(parseUsd('$ 1,200 - $1,800')).toBeNull()
    expect(parseUsd('USD 900 – 1,100 / month')).toBeNull()
    expect(parseUsd('$1,000 to $1,500')).toBeNull()
  })

  it('converts at the given rate and rounds to 10,000 đ', () => {
    expect(usdToVnd(2692, RATE)).toBe(69_920_000)
    expect(usdToVnd(7000, 25_000)).toBe(175_000_000)
  })

  it('⛔ reads the USD-base feed and band-checks it — an inverted or unit-shifted rate is refused', () => {
    expect(vndPerUsdFrom({ result: 'success', rates: { VND: 25971.628089 } })).toBe(25971.628089)
    expect(vndPerUsdFrom({ result: 'success', rates: { VND: 3.9e-5 } })).toBeNull()
    expect(vndPerUsdFrom({ result: 'success', rates: { VND: 25.97 } })).toBeNull()
    expect(vndPerUsdFrom({ result: 'success', rates: { VND: '25971' } })).toBeNull()
    expect(vndPerUsdFrom({ result: 'error', rates: { VND: 25971 } })).toBeNull()
    expect(vndPerUsdFrom(null)).toBeNull()
  })

  it('⚠️ keeps the stored price when the DOLLAR figure is unchanged, so FX drift never rewrites rows', () => {
    const stored = { price: 69_920_000, description: `…\n${rentLine(2692)}\n…` }
    expect(usdFromDescription(stored.description)).toBe(2692)
    expect(priceToStore(stored, 2692, 70_310_000)).toBe(69_920_000)
    expect(priceToStore(stored, 2800, 72_720_000)).toBe(72_720_000)
    expect(priceToStore(null, 2692, 70_310_000)).toBe(70_310_000)
    expect(priceToStore({ price: 5, description: stored.description }, 2692, 70_310_000)).toBe(70_310_000)
  })
})

describe('area', () => {
  it('⛔ groups of three are thousands in EITHER convention; a lone separator is a decimal', () => {
    expect(parseAreaM2('1,200 m2')).toBe(1200)
    expect(parseAreaM2('1.200 m²')).toBe(1200)
    expect(parseAreaM2('4.5 m2')).toBe(4.5)
    expect(parseAreaM2('4,5 m2')).toBe(4.5)
    expect(parseAreaM2('120sqm')).toBe(120)
    expect(parseAreaM2('')).toBeNull()
    expect(parseAreaM2('0 m2')).toBeNull()
  })
})

describe('source plumbing', () => {
  it('honours robots.txt as the site serves it', () => {
    const robots = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nSitemap: https://honeycomb.com.vn/sitemap.xml'
    expect(robotsAllows(robots, '/property/x/')).toBe(true)
    expect(robotsAllows(robots, '/wp-sitemap.xml')).toBe(true)
    expect(robotsAllows(robots, '/wp-admin/options.php')).toBe(false)
    expect(robotsAllows(robots, '/wp-admin/admin-ajax.php')).toBe(true)
    expect(robotsAllows('User-agent: *\nDisallow: /', '/property/x/')).toBe(false)
    expect(robotsAllows('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/', '/property/x/')).toBe(true)
    expect(robotsAllows('User-agent: *\nDisallow: /*.jpg$', '/wp-content/uploads/a.jpg')).toBe(false)
  })

  it('reads the sitemap index and urlsets', () => {
    const idx = '<sitemapindex><sitemap><loc>https://honeycomb.com.vn/wp-sitemap-posts-page-1.xml</loc></sitemap><sitemap><loc>https://honeycomb.com.vn/wp-sitemap-posts-estate_property-7.xml</loc></sitemap></sitemapindex>'
    const locs = parseSitemapIndex(idx)
    expect(locs.filter(isPropertySitemap)).toEqual(['https://honeycomb.com.vn/wp-sitemap-posts-estate_property-7.xml'])
    const set = `<urlset><url><loc>${URL1}</loc><lastmod>2026-09-16T15:54:56+07:00</lastmod></url><url><loc>https://honeycomb.com.vn/property/a/</loc></url></urlset>`
    expect(parseUrlset(set)).toEqual([{ url: URL1, lastmod: '2026-09-16T15:54:56+07:00' }, { url: 'https://honeycomb.com.vn/property/a/', lastmod: null }])
  })

  it('pins hosts and derives originals', () => {
    expect(allowedTarget(URL1)).toBe(true)
    expect(allowedTarget('https://honeycomb.com.vn.evil.io/property/x/')).toBe(false)
    expect(allowedImage('https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg')).toBe(true)
    expect(allowedImage('https://cdn.example/wp-content/uploads/2026/09/EH-17.jpg')).toBe(false)
    expect(originalImageUrl('https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17-1110x640.jpg')).toBe('https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17.jpg')
  })

  it('measures logo visibility the way set-partner-avatar does', () => {
    expect(visiblePct(new Uint8Array([255, 255, 255, 0]))).toBe(25)
    expect(visiblePct(new Uint8Array([]))).toBe(0)
  })

  it('pins a seller id that cannot collide with a cuid', () => {
    expect(HONEYCOMB_SELLER_ID).toMatch(/^honeycomb-import-seller-\d{4}$/)
  })
})

// ── review fixes, 2026-09-24 — each block fails against the pre-fix module ─────────────────

describe('⛔ city = the vn-units Vietnamese name, one spelling per city (owner decision 2026-09-24)', () => {
  const provinces = vnUnits as { code: string; name: string; nameEn: string }[]

  it('each city string is the vn-units `name` the post wizard stores (and the ~98,000 existing rows carry)', () => {
    for (const key of CITY_KEYS) {
      const unit = provinces.find((p) => p.code === CITY_PROVINCE_CODE[key])!
      expect(CITY_NAME[key], key).toBe(unit.name)
    }
    expect(CITY_NAME).toEqual({ hcmc: 'Hồ Chí Minh', hanoi: 'Hà Nội', danang: 'Đà Nẵng' })
  })

  it('a mapped row is found by the province filter whichever spelling it sends (src/lib/province-match.ts)', () => {
    const rows = [
      assessHoneycomb(rec(), opts),
      assessHoneycomb(rec({ address: '12 Tran Phu, Hai Chau, Da Nang' }), opts),
      assessHoneycomb(rec({ address: 'Tay Ho, Hanoi' }), opts),
    ]
    for (const [i, key] of (['hcmc', 'danang', 'hanoi'] as const).entries()) {
      const a = rows[i]
      if (!a.ok) throw new Error(a.reason)
      const unit = provinces.find((p) => p.code === CITY_PROVINCE_CODE[key])!
      expect(a.row.city).toBe(unit.name)
      // The area filter sends nameEn ('Ho Chi Minh'); a saved search may send the Vietnamese name.
      expect(matchesProvinceRow({ city: a.row.city, location: a.row.location }, unit.nameEn), `${key} by nameEn`).toBe(true)
      expect(matchesProvinceRow({ city: a.row.city, location: a.row.location }, unit.name), `${key} by name`).toBe(true)
    }
  })

  it('the rent unit is the taxonomy one (VND/month), shared with every rentals importer', () => {
    expect(HONEYCOMB_MONEY.priceUnit).toBe('VND/month')
    expect(HONEYCOMB_MONEY.currency).toBe('₫')
  })
})

describe('⛔ never publish a house number', () => {
  const addresses = [
    'No.49, Street 66, Thao Dien Ward, District 2, HCMC',
    '628C Ha Noi Highway, An Phu Ward, District 2, HCMC',
    'No. 2 Le Thuoc, Thao Dien Ward, District 2, HCMC',
    '88 Song Hanh, An Phu Ward, District 2, HCMC',
  ]
  it.each(addresses)('location, titles, description and search text carry no house number: %s', (address) => {
    const a = assessHoneycomb(rec({ address }), opts)
    if (!a.ok) throw new Error(a.reason)
    expect(hasHouseNumber(a.row.location)).toBe(false)
    expect(a.row.location).not.toContain(address.split(',')[0])
    for (const text of [a.row.title, a.row.titleVi, a.row.description, a.row.descriptionVi, a.row.searchText]) {
      expect(text).not.toMatch(/No\.\s?\d|628C|628c|\b88 song|street 66|Street 66/i)
    }
  })

  it('keeps a bare street NAME and drops every segment that carries a digit', () => {
    expect(streetOf('No. 2 Le Thuoc, Thao Dien Ward, District 2, HCMC')).toBeNull()
    expect(streetOf('Hoang Hoa Tham Street, Ward 6, Binh Thanh District, HCMC')).toBe('Hoang Hoa Tham Street')
    expect(streetOf('Nguyen Van Huong, Thao Dien Ward, Thu Duc City, Ho Chi Minh City, Vietnam')).toBe('Nguyen Van Huong')
    expect(streetOf(null)).toBeNull()
  })

  it('hasHouseNumber allows administrative numbers only', () => {
    expect(hasHouseNumber('P. Thảo Điền, Quận 2')).toBe(false)
    expect(hasHouseNumber('Phường 22, Quận Bình Thạnh')).toBe(false)
    expect(hasHouseNumber('88 Song Hanh, An Phu Ward, District 2, HCMC')).toBe(true)
    expect(hasHouseNumber('Street 66, Thao Dien Ward')).toBe(true)
  })
})

describe('⛔ city from a whole address segment, not a substring', () => {
  it('"Ha Noi Highway" is a District 2 street, not Hà Nội', () => {
    expect(cityOf('Ha Noi Highway, An Phu Ward, District 2', ['apartments-for-rent-in-hcmc'])).toBe('hcmc')
    expect(cityOf('Ha Noi Highway, District 2, HCMC', [])).toBe('hcmc')
    expect(cityOf('Thao Dien Ward, Thu Duc City, TP. Hồ Chí Minh', [])).toBe('hcmc')
    expect(cityOf('12 Tran Phu, Hai Chau, Đà Nẵng', [])).toBe('danang')
  })
})

describe('⛔ ward/district consistency — drop the ward, keep the district', () => {
  const named = (name: string) => ({ kind: 'named' as const, name })
  const num = (n: number) => ({ kind: 'numbered' as const, n })

  it('honeycomb:317872 "Tang Nhon Phu A Ward, District 2": the ward (Quận 9) is dropped, Quận 2 kept', () => {
    const a = assessHoneycomb(rec({ address: 'Tang Nhon Phu A Ward, District 2, HCMC', districtRaw: '2', project: null }), opts)
    if (!a.ok) throw new Error(a.reason)
    expect(a.row.district).toBe('Quận 2')
    expect(a.row.location).toBe('Quận 2')
    expect(a.row.title).toBe('3 bed · 2 bath apartment for rent — District 2')
    expect(a.row.titleVi).not.toMatch(/Tăng Nhơn|Tang Nhon/)
    expect(a.row.description).not.toMatch(/Tang Nhon/)
    // …and the same ward IS kept where it belongs.
    expect(checkWard(named('Tang Nhon Phu A'), 'hcmc', 'Quận 9')).toEqual({ en: 'Tang Nhon Phu A Ward', vi: 'P. Tăng Nhơn Phú A' })
    expect(checkWard(named('Tang Nhon Phu A'), 'hcmc', 'TP. Thủ Đức')).not.toBeNull()
  })

  it('keeps consistent pre-2025 wards, with the accented name for Vietnamese', () => {
    expect(checkWard(named('Thao Dien'), 'hcmc', 'Quận 2')).toEqual({ en: 'Thao Dien Ward', vi: 'P. Thảo Điền' })
    expect(checkWard(named('Ben Nghe'), 'hcmc', 'Quận 1')).toEqual({ en: 'Ben Nghe Ward', vi: 'P. Bến Nghé' })
    expect(checkWard(named('Dakao'), 'hcmc', 'Quận 1')?.vi).toBe('P. Đa Kao')
    expect(checkWard(named('Binh Trung Tay'), 'hcmc', 'Quận 2')?.vi).toBe('P. Bình Trưng Tây')
    expect(checkWard(named('Thao Dien'), 'hcmc', 'Quận 7')).toBeNull()
  })

  it('places a 2025 ward (src/data/vn-units.json) by its GSO code block', () => {
    expect(checkWard(named('Binh Trung'), 'hcmc', 'Quận 2')).toEqual({ en: 'Binh Trung Ward', vi: 'P. Bình Trưng' })
    expect(checkWard(named('Sai Gon'), 'hcmc', 'Quận 1')?.vi).toBe('P. Sài Gòn')
    expect(checkWard(named('Sai Gon'), 'hcmc', 'Quận 2')).toBeNull()
    // A 2025 HCMC ward that used to be Bình Dương belongs to no old HCMC district.
    expect(checkWard(named('Thu Dau Mot'), 'hcmc', 'Quận 2')).toBeNull()
  })

  it('a numbered ward only in a district that numbers its wards', () => {
    expect(checkWard(num(22), 'hcmc', 'Quận Bình Thạnh')).toEqual({ en: 'Ward 22', vi: 'Phường 22' })
    expect(checkWard(num(6), 'hcmc', 'Quận Bình Thạnh')).not.toBeNull()
    expect(checkWard(num(22), 'hcmc', 'Quận 2')).toBeNull()
    expect(checkWard(num(3), 'hcmc', null)).toBeNull()
    expect(checkWard(num(45), 'hcmc', 'Quận 3')).toBeNull()
  })

  it('fails closed on a ward it cannot place, and without a district keeps only a real ward', () => {
    expect(checkWard(named('Atlantis'), 'hcmc', 'Quận 2')).toBeNull()
    expect(checkWard(named('Thao Dien'), 'hcmc', null)?.vi).toBe('P. Thảo Điền')
    expect(checkWard(named('Atlantis'), 'hcmc', null)).toBeNull()
    expect(checkWard(named('Hai Chau'), 'danang', null)).toEqual({ en: 'Hai Chau Ward', vi: 'P. Hải Châu' })
    expect(checkWard(num(1), 'danang', null)).toBeNull()
  })

  it('every district districtOf can emit has ward data behind it', () => {
    const raws = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh',
      'Go Vap', 'Tan Phu', 'Binh Tan', 'Thu Duc', 'Nha Be', 'Binh Chanh', 'Hoc Mon', 'Cu Chi', 'Can Gio']
    for (const raw of raws) expect(oldDistrictsFor(districtOf(raw, null)!.vi).length, raw).toBeGreaterThan(0)
  })
})

describe('⛔ stage → apply', () => {
  const NOW = Date.parse('2026-09-24T12:00:00Z')
  const staged = () => ({ ...rec(), lastmod: '2026-09-16T15:54:56+07:00' })
  const file = (over: Record<string, unknown> = {}) => ({
    source: STAGE_SOURCE, fetchedAt: '2026-09-24T10:00:00Z', userAgent: 'x',
    params: { since: '2026-06-26', limit: 0, city: null },
    fx: { vndPerUsd: RATE, source: 'test' },
    sitemap: { maps: 7, mapsOk: 7, complete: true, entries: [{ url: URL1, lastmod: '2026-09-16T15:54:56+07:00' }] },
    pages: { read: 1, drop: {}, stopped: null },
    records: [staged()],
    ...over,
  })

  it('the allowlist rebuilds a record: unknown fields dropped, off-host links and photos refused', () => {
    const smuggled = { ...staged(), sellerId: 'someone-else', verified: false, images: [...rec().images, 'https://evil.example/x.jpg'] }
    const out = stageHoneycombRecord(smuggled)!
    expect(out).not.toHaveProperty('sellerId')
    expect(out).not.toHaveProperty('verified')
    expect(out.images).toEqual(rec().images)
    expect(stageHoneycombRecord({ ...staged(), url: 'https://evil.example/property/x/' })).toBeNull()
    expect(stageHoneycombRecord({ ...staged(), postId: '1; drop' })).toBeNull()
    expect(stageHoneycombRecord({ ...staged(), bedrooms: '3' })!.bedrooms).toBeNull()
  })

  it('a staged file is re-validated on read', () => {
    const ok = readHoneycombStage(file())
    expect(ok.ok && ok.stage.records.length).toBe(1)
    expect(readHoneycombStage(file({ source: 'nhatot.com' }))).toMatchObject({ ok: false })
    expect(readHoneycombStage(file({ fx: { vndPerUsd: 3.9e-5 } }))).toMatchObject({ ok: false })
    expect(readHoneycombStage(file({ fetchedAt: 'yesterday' }))).toMatchObject({ ok: false })
    const dup = readHoneycombStage(file({ records: [staged(), staged(), { junk: 1 }] }))
    expect(dup.ok && [dup.stage.records.length, dup.rejected]).toEqual([1, 2])
    const partial = readHoneycombStage(file({ sitemap: { complete: 'yes', entries: [] } }))
    expect(partial.ok && partial.stage.sitemap.complete).toBe(false)
  })

  it(`refuses a staged file over ${STAGE_MAX_AGE_H} h old, undated, or from the future`, () => {
    expect(stageAgeProblem('2026-09-24T10:00:00Z', NOW)).toBeNull()
    expect(stageAgeProblem('2026-09-21T11:00:00Z', NOW)).toMatch(/over 72 h/)
    expect(stageAgeProblem('garbage', NOW)).toMatch(/not a date/)
    expect(stageAgeProblem(undefined, NOW)).toMatch(/not a date/)
    expect(stageAgeProblem('2026-09-25T12:00:00Z', NOW)).toMatch(/future/)
  })

  it('--apply only from --src, only with a journal dir; checked before anything runs', () => {
    const base = { apply: false, src: null, save: null, journalDir: null, retire: false, limit: 0 }
    expect(applyPreflight(base)).toBeNull()
    expect(applyPreflight({ ...base, apply: true })).toMatch(/--src/)
    expect(applyPreflight({ ...base, apply: true, src: 'f.json' })).toMatch(/--journal-dir/)
    expect(applyPreflight({ ...base, apply: true, src: 'f.json', journalDir: '/Users/x/j' })).toBeNull()
    expect(applyPreflight({ ...base, src: 'f.json', save: 'g.json' })).toMatch(/--save/)
    expect(applyPreflight({ ...base, retire: true, limit: 5 })).toMatch(/--retire/)
  })

  it('the journal dir is durable: not relative, not under a temp root', () => {
    const tmp = ['/tmp', '/private/tmp', '/var/folders/ab/T/']
    expect(journalDirProblem('/Users/mk1e3/eno-import-journals/honeycomb', tmp)).toBeNull()
    expect(journalDirProblem('/tmp/j', tmp)).toMatch(/under \/tmp/)
    expect(journalDirProblem('/private/tmp', tmp)).toMatch(/under/)
    expect(journalDirProblem('/var/folders/ab/T/x', tmp)).toMatch(/under/)
    expect(journalDirProblem('/tmpfoo/j', tmp)).toBeNull()
    expect(journalDirProblem('journals', tmp)).toMatch(/absolute/)
    expect(journalDirProblem(null, tmp)).toMatch(/empty/)
  })

  it(`the default window is ${DEFAULT_SINCE_DAYS} days (owner, 2026-09-24)`, () => {
    expect(DEFAULT_SINCE_DAYS).toBe(90)
    expect(defaultSince(NOW)).toBe('2026-06-26')
  })
})

describe('⛔ the rate limit cannot be switched off by a typo', () => {
  it('non-numbers fall back to the default; numbers are clamped', () => {
    expect(parseDelayMs(null)).toBe(1200)
    expect(parseDelayMs('1500ms')).toBe(1200)
    expect(parseDelayMs('NaN')).toBe(1200)
    expect(parseDelayMs('Infinity')).toBe(1200)
    expect(parseDelayMs('')).toBe(1200)
    expect(parseDelayMs('1e10')).toBe(60_000)
    expect(parseDelayMs('2500')).toBe(2500)
    expect(parseDelayMs('1200')).toBe(1200)
  })

  it('⛔ the FLOOR is 1.2 s, not just the default: nothing under 1200 ms gets through', () => {
    expect(DELAY_MS.min).toBe(1200)
    expect(parseDelayMs('1000')).toBe(1200)
    expect(parseDelayMs('1199')).toBe(1200)
    expect(parseDelayMs('0')).toBe(1200)
    expect(parseDelayMs('-5')).toBe(1200)
  })
})

// ── the fetcher ─────────────────────────────────────────────────────────────────────────────

/** A fake network and clock: every request is recorded with the time it STARTED; a request takes
 *  50 ms; `sleep` advances the clock. Unknown URLs answer 404. */
function net(routes: Record<string, { status: number; location?: string; body?: string; headers?: Record<string, string> }>, delayMs = 1200, robots: string | null = 'User-agent: *\nDisallow: /wp-admin/') {
  let t = 1_000_000
  const calls: { url: string; at: number; end: number; redirect: string; ua: string }[] = []
  const getter = makePoliteGet({
    fetch: async (url, init) => {
      const at = t
      t += 50
      calls.push({ url, at, end: t, redirect: init.redirect, ua: init.headers['User-Agent'] })
      const r = routes[url] ?? { status: 404 }
      const h: Record<string, string> = { 'content-type': 'text/html', ...(r.location !== undefined ? { location: r.location } : {}), ...r.headers }
      return {
        status: r.status,
        headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
        arrayBuffer: async () => new TextEncoder().encode(r.body ?? '').buffer as ArrayBuffer,
      }
    },
    sleep: async (ms) => { t += ms },
    now: () => t,
    delayMs, userAgent: 'honest-UA', robotsTxt: () => robots,
  })
  /** Idle time between one request ending and the next starting. */
  const gaps = () => calls.slice(1).map((c, i) => c.at - calls[i].end)
  return { getter, calls, gaps }
}
const HC = 'https://honeycomb.com.vn'

describe('⛔ the fetcher: ≥1.2 s between requests, redirects only within honeycomb.com.vn', () => {
  it('waits at least 1.2 s between requests — even when the caller asks for less', async () => {
    for (const ask of [1200, 1000, 0, Number.NaN]) {
      const { getter, calls, gaps } = net({ [`${HC}/a/`]: { status: 200 }, [`${HC}/b/`]: { status: 200 }, [`${HC}/c/`]: { status: 200 } }, ask)
      await getter.get(`${HC}/a/`)
      await getter.get(`${HC}/b/`)
      await getter.get(`${HC}/c/`)
      expect(calls.length, `delayMs ${ask}`).toBe(3)
      for (const g of gaps()) expect(g, `delayMs ${ask}`).toBeGreaterThanOrEqual(1200)
      expect(getter.count()).toBe(3)
    }
  })

  it('never lets fetch follow a redirect itself (`redirect: manual` on every request), and sends the honest UA', async () => {
    const { getter, calls } = net({ [`${HC}/property/old/`]: { status: 301, location: '/property/new/' }, [`${HC}/property/new/`]: { status: 200, body: 'ok' } })
    await getter.get(`${HC}/property/old/`)
    expect(calls.map((c) => c.redirect)).toEqual(['manual', 'manual'])
    expect(calls.every((c) => c.ua === 'honest-UA')).toBe(true)
  })

  it('follows a redirect on honeycomb.com.vn as its own rate-gated request', async () => {
    const { getter, calls, gaps } = net({ [`${HC}/property/old/`]: { status: 301, location: '/property/new/' }, [`${HC}/property/new/`]: { status: 200, body: 'ok' } })
    const got = await getter.get(`${HC}/property/old/`)
    expect(got).toMatchObject({ status: 200, finalUrl: `${HC}/property/new/`, refusedRedirect: null })
    expect(got.body.toString()).toBe('ok')
    expect(calls.map((c) => c.url)).toEqual([`${HC}/property/old/`, `${HC}/property/new/`])
    expect(gaps()[0]).toBeGreaterThanOrEqual(1200)
  })

  it.each([
    'https://evil.example/x',
    'https://honeycomb.com.vn.evil.io/property/x/',
    'https://www.honeycomb.com.vn/property/x/',
    'http://honeycomb.com.vn/property/x/',
    '//evil.example/x',
    'https://user@honeycomb.com.vn/property/x/',
    'https://honeycomb.com.vn:8443/property/x/',
  ])('⛔ REFUSES a redirect to %s — the other host is never requested', async (location) => {
    const { getter, calls } = net({ [`${HC}/property/a/`]: { status: 302, location }, [location]: { status: 200 } })
    const got = await getter.get(`${HC}/property/a/`)
    expect(calls.map((c) => c.url)).toEqual([`${HC}/property/a/`])
    expect(got.status).toBe(302)
    expect(got.finalUrl).toBe(`${HC}/property/a/`)
    expect(got.refusedRedirect).toMatch(/not followed/)
  })

  it('⛔ refuses a same-site redirect to a path robots.txt disallows', async () => {
    const { getter, calls } = net({ [`${HC}/property/a/`]: { status: 307, location: '/wp-admin/x' }, [`${HC}/wp-admin/x`]: { status: 200 } })
    const got = await getter.get(`${HC}/property/a/`)
    expect(calls).toHaveLength(1)
    expect(got.refusedRedirect).toMatch(/robots\.txt/)
  })

  it('⛔ refuses any redirect from another host (the FX feed), and a Location-less 3xx', async () => {
    const fx = 'https://open.er-api.com/v6/latest/USD'
    const a = net({ [fx]: { status: 301, location: `${HC}/property/x/` } })
    expect((await a.getter.get(fx)).refusedRedirect).toMatch(/only honeycomb\.com\.vn/)
    expect(a.calls).toHaveLength(1)
    const b = net({ [`${HC}/a/`]: { status: 301 } })
    expect((await b.getter.get(`${HC}/a/`)).refusedRedirect).toMatch(/Location/)
    expect(b.calls).toHaveLength(1)
  })

  it(`stops a redirect loop after ${MAX_REDIRECTS} hops`, async () => {
    const { getter, calls } = net({ [`${HC}/a/`]: { status: 302, location: '/b/' }, [`${HC}/b/`]: { status: 302, location: '/a/' } })
    const got = await getter.get(`${HC}/a/`)
    expect(calls).toHaveLength(MAX_REDIRECTS + 1)
    expect(got.refusedRedirect).toMatch(/more than 5 redirects/)
  })

  it('⛔ a 429 or a bot challenge throws Infeasible — never retried around', async () => {
    const r429 = net({ [`${HC}/a/`]: { status: 429 } })
    await expect(r429.getter.get(`${HC}/a/`)).rejects.toBeInstanceOf(Infeasible)
    const chal = net({ [`${HC}/a/`]: { status: 403, body: '<title>Just a moment...</title>' } })
    await expect(chal.getter.get(`${HC}/a/`)).rejects.toBeInstanceOf(Infeasible)
    const cf = net({ [`${HC}/a/`]: { status: 200, headers: { 'cf-mitigated': 'challenge' } } })
    await expect(cf.getter.get(`${HC}/a/`)).rejects.toBeInstanceOf(Infeasible)
    // A challenge on a redirect HOP stops the run too.
    const hop = net({ [`${HC}/a/`]: { status: 301, location: '/b/' }, [`${HC}/b/`]: { status: 429 } })
    await expect(hop.getter.get(`${HC}/a/`)).rejects.toBeInstanceOf(Infeasible)
  })

  it('⛔ a robots.txt behind a refused redirect is disallow-all, never "no rules"', async () => {
    const { getter } = net({ [`${HC}/robots.txt`]: { status: 301, location: 'https://evil.example/robots.txt' } }, 1200, null)
    const got = await getter.get(`${HC}/robots.txt`)
    expect(robotsFromResponse({ ...got, body: got.body.toString() })).toMatchObject({ ok: false, reason: expect.stringMatching(/redirect refused .*evil\.example.*disallow-all/) })
    expect(robotsFromResponse({ status: 200, refusedRedirect: null, body: 'User-agent: *' })).toEqual({ ok: true, robotsTxt: 'User-agent: *' })
    expect(robotsFromResponse({ status: 404, refusedRedirect: null, body: 'nope' })).toEqual({ ok: true, robotsTxt: '' })
    expect(robotsFromResponse({ status: 503, refusedRedirect: null, body: '' })).toMatchObject({ ok: false })
    expect(robotsFromResponse({ status: 304, refusedRedirect: null, body: '' })).toMatchObject({ ok: false })
  })

  it('redirectTarget resolves a relative Location and drops the fragment', () => {
    expect(redirectTarget(`${HC}/property/a/`, '../b/?x=1#frag', null)).toEqual({ ok: true, url: `${HC}/property/b/?x=1` })
    expect(redirectTarget(`${HC}/property/a/`, 'https://honeycomb.com.vn:443/c/', null)).toEqual({ ok: true, url: `${HC}/c/` })
    expect(redirectTarget(`${HC}/a/`, 'https://evil.example/', null)).toMatchObject({ ok: false })
  })

  it('⛔ a valued flag with no value is refused — `--limit --apply` is not "no limit"', () => {
    expect(valuedFlagProblem(['node', 'x', '--src', 'f.json', '--limit', '--apply'])).toMatch(/--limit needs a value/)
    expect(valuedFlagProblem(['node', 'x', '--src'])).toMatch(/--src needs a value/)
    expect(valuedFlagProblem(['node', 'x', '--src', 'f.json', '--limit', '5', '--apply'])).toBeNull()
    const src = readFileSync(join(process.cwd(), 'scripts/import-honeycomb-com-vn.ts'), 'utf8')
    expect(src).toMatch(/const flagProblem = valuedFlagProblem\(argv\)\n\s+if \(flagProblem\) throw new Error\(flagProblem\)/)
  })

  it('⛔ a replay keeps the window it was staged with; --since still overrides', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    expect(runSince(null, '2026-06-26', now)).toBe('2026-06-26')
    expect(runSince('2026-07-01', '2026-06-26', now)).toBe('2026-07-01')
    expect(runSince(null, null, now)).toBe(defaultSince(now))
    expect(runSince(null, 'not a date', now)).toBe(defaultSince(now))
    const src = readFileSync(join(process.cwd(), 'scripts/import-honeycomb-com-vn.ts'), 'utf8')
    expect(src).toMatch(/SINCE = runSince\(SINCE_ARG, stage\.params\.since, Date\.now\(\)\)\n\s+sinceMs = Date\.parse/)
  })

  it('⛔ an entity-encoded tag in a source field never comes out as a tag', () => {
    expect(textOf('Tropic Garden &lt;script&gt;alert(1)&lt;/script&gt; Q2')).toBe('Tropic Garden alert(1) Q2')
    expect(textOf('<b>Thảo Điền</b> &amp; An Phú')).toBe('Thảo Điền & An Phú')
  })

  it('⛔ a replay reads robots.txt before any request, dry run included (it fetches the logo and cover)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/import-honeycomb-com-vn.ts'), 'utf8')
    const replay = src.slice(src.indexOf('  if (SRC) {\n    const parsed = readHoneycombStage('), src.indexOf('    stage = await crawl(sinceMs)'))
    expect(replay).toMatch(/\n    await checkRobots\(\)\n/)
    expect(replay).not.toMatch(/if \(APPLY\) await checkRobots\(\)/)
  })

  it('⛔ the importer script reaches the network ONLY through makePoliteGet', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/import-honeycomb-com-vn.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toMatch(/makePoliteGet\(\{/)
    expect(src).not.toMatch(/redirect:\s*['"]follow['"]/)
    // Exactly one call to fetch: the one handed to makePoliteGet.
    expect(src.match(/\bfetch\(/g)).toHaveLength(1)
    expect(src).toMatch(/fetch:\s*\(url, init\)\s*=>\s*fetch\(url, init\)/)
  })
})

describe('⛔ seller refusals and retirement', () => {
  const clean = { name: HONEYCOMB_SELLER_NAME, ownerId: null, verified: false, verifiedSeller: false, officialPartner: false }
  it('refuses a renamed, owned or badged seller; a missing one is created', () => {
    expect(sellerRefusal(null)).toBeNull()
    expect(sellerRefusal(clean)).toBeNull()
    expect(sellerRefusal({ ...clean, name: 'Honeycomb' })).toMatch(/named/)
    expect(sellerRefusal({ ...clean, ownerId: 'u1' })).toMatch(/owner/)
    expect(sellerRefusal({ ...clean, verified: true })).toMatch(/verified/)
    expect(sellerRefusal({ ...clean, verifiedSeller: true })).toMatch(/verifiedSeller/)
    expect(sellerRefusal({ ...clean, officialPartner: true })).toMatch(/officialPartner/)
  })

  it('retires only on 404/410, and only re-checks rows that left the sitemap', () => {
    expect([200, 301, 403, 404, 410, 500].filter(isGoneStatus)).toEqual([404, 410])
    const rows = [{ id: 'a', affiliateUrl: URL1 }, { id: 'b', affiliateUrl: 'https://honeycomb.com.vn/property/gone/' }, { id: 'c', affiliateUrl: null }]
    expect(retireCandidates(rows, new Set([URL1])).map((r) => r.id)).toEqual(['b'])
    // An edited, off-host link is never probed (nor hidden on whatever that host answers).
    expect(retireCandidates([{ id: 'x', affiliateUrl: 'https://evil.example/property/gone/' }, { id: 'y', affiliateUrl: 'http://honeycomb.com.vn/property/gone/' }], new Set()).map((r) => r.id)).toEqual([])
  })
})

/**
 * ⛔ THE VIETNAMESE TEXT IS MADE VIETNAMESE IN THE MAPPER (src/lib/import-i18n.ts): the source is an
 * English site, and every text field is refreshed (mutableOf), so a database-only fix would be
 * reverted by the next run.
 */
describe('assessHoneycomb — the Vietnamese text is Vietnamese (import-i18n)', () => {
  it('localizes the Vietnamese street line and leaves the English text — and its US$ rent line — alone', () => {
    const a = assessHoneycomb(rec({ address: 'No.12, Song Hanh Street, An Phu Ward, District 2, HCMC' }), opts)
    if (!a.ok) throw new Error(a.reason)
    const m = a.row
    expect(m.descriptionVi).toMatch(/^Đường: Đường Song Hành$/m)
    expect(m.descriptionVi).not.toMatch(/Song Hanh Street/)
    expect(m.description).toMatch(/^Street: Song Hanh Street$/m)
    expect(m.description).toContain('Rent: US$2,692/month')
    // The re-run price guard still reads the source dollar figure from the stored description.
    expect(usdFromDescription(m.description)).toBe(2692)
    expect(m.title).toBe('3 bed · 2 bath apartment for rent — The Estella Heights, An Phu Ward, District 2')
    expect(m.searchText.startsWith(fold(`${m.title} ${m.titleVi} `))).toBe(true)
    expect(m.untranslated).toEqual([])
    const again = localizeImportText(m)
    expect([again.title, again.titleVi, again.description, again.descriptionVi]).toEqual([m.title, m.titleVi, m.description, m.descriptionVi])
  })

  it('an English street the dictionary lacks stays in the Vietnamese block, and is reported', () => {
    const a = assessHoneycomb(rec({ address: 'Untranslated Boulevard, An Phu Ward, District 2, HCMC' }), opts)
    if (!a.ok) throw new Error(a.reason)
    expect(a.row.descriptionVi).toMatch(/^Đường: Untranslated Boulevard$/m)
    expect(a.row.untranslated).toEqual([{ target: 'vi', kind: 'descVi:Đường', src: 'Untranslated Boulevard' }])
  })
})
