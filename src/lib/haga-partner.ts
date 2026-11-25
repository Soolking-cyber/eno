/**
 * HAGA SMARTECH — phone and laptop repair and used devices in An Khánh (Thảo Điền), Ho Chi Minh City (owner, 2026-11-25:
 * "https://hagasmartech.com/ import them as a partner the 2nd hand items and available services with clear descriptions and
 * prices"). What is written, from the research in ~/eno-haga-partner-2026-11-25 (data.json: every used device and repair
 * service page read in Vietnamese AND in English on 2026-11-25). scripts/import-haga.ts is the I/O around it.
 *
 *   · USED DEVICES — one listing each (69 on 2026-11-25: 22 iPhones, 3 MacBooks, 44 laptops and PCs), in electronics, at the
 *     price HAGA publishes, condition used, in both languages from HAGA's own two pages (no machine translation).
 *     ⛔ ONE PHOTO, A MANUFACTURER IMAGE (owner, 2026-11-25, asked with the An Bình precedent in front of them: "List used with
 *     the stock photo"): HAGA's pages show one catalogue image per device, not the unit itself. The text says so, and the edit
 *     path keeps these rows at a one-photo bar (publish-guard.ts ONE_PHOTO_IMPORT_PREFIXES), or an admin could never save one.
 *   · REPAIR SERVICES — GROUPED (owner, 2026-11-25: "~15 grouped listings"): HAGA lists one page per model per repair (200 on
 *     2026-11-25). A listing per device and kind of repair ("iPhone screen and glass repair") carries every model's price in a
 *     table, and its card shows the lowest — the title says "prices by model", so the card figure never reads as the price of
 *     every repair in it.
 *
 * ⛔ PRICES AS HAGA PUBLISHES THEM, IN ĐỒNG, dated by the read; a row whose two pages disagree on the price is held.
 * ⚠️ eno's own lines on a repair listing (free check before any work, pickup and delivery, English-speaking staff) restate the
 * "Why choose HAGA" box on every HAGA product page (read 2026-11-25: "Free diagnostic", "Free pickup and delivery",
 * "English-speaking support"); the warranty and the time per repair are each page's own.
 * ⛔ NO CONTACT IN THE TEXT: HAGA's pages carry its phone, Zalo and website — a line that does is dropped, and what is left
 * passes assertCleanTexts or the row is held. Buyers message HAGA in eno chat (an official partner shares no number).
 */
import { CITY_NAME } from './honeycomb-listing'
import { buildSearchText } from './fold'
import { PublishBlockedError, assertCleanTexts } from './publish-guard'
import { listingMoneyFor } from './taxonomy'
import { formatMoneyFull } from './vnd'

export const HAGA = {
  handle: 'hagasmartech',
  name: 'HAGA Smartech',
  site: 'https://hagasmartech.com',
  /** Its contact page, as printed (read 2026-11-25). The storefront's address; a listing text never carries it. */
  address: '18 Nguyễn Văn Hưởng, Phường An Khánh, Thành phố Hồ Chí Minh',
  /** Live listings say "Thủ Đức" for the old District 2 (district-match.ts SEARCH_WIDENED_DISTRICTS). */
  district: 'Thủ Đức',
  location: 'An Khánh (Thảo Điền)',
  /** The day the research was read, printed with every price. */
  read: { en: '25 November 2026', vi: '25/11/2026' },
} as const

/** externalId prefix — and the edit path's one-photo marker (publish-guard.ts ONE_PHOTO_IMPORT_PREFIXES). */
export const HAGA_EXTERNAL_PREFIX = 'hagasmartech:'

/** One HAGA product page as parse_products.py read it (one language). */
export type HagaPage = {
  title: string | null
  sku: string | null
  price: number | null
  stock: number | null
  intro: string | null
  image: string | null
  gallery: string[]
  crumbs: string[]
  description: string | null
}
export type HagaRecord = { slug: string; url: string; kind: 'used' | 'service'; listName: string; listPrices: number[]; vi: HagaPage | null; en: HagaPage | null }

export type HagaRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  currency: '₫'
  negotiable: false
  listingType: 'sell' | 'service'
  condition: 'used' | null
  categorySlug: 'electronics' | 'services'
  subcategorySlug: string
  city: string
  district: string
  location: string
  searchText: string
}
/** Where the listing's photos come from: HAGA image paths (site-relative), cover first. */
export type HagaPlan = { row: HagaRow; images: string[]; sourceUrl: string }
export type HagaRefusal = { ok: false; reason: string; detail: string }
const refuse = (reason: string, detail: string): HagaRefusal => ({ ok: false, reason, detail })

const TITLE_MAX = 140
const DESCRIPTION_MAX = 5000
const NO_IMAGE = /NoImage/i
/** A line that names a way to reach HAGA outside eno: a Vietnamese phone ("0925 435 688", "092.5435.688", "+84 …"), Zalo, a
 *  link, a mail address. ⚠️ A PHONE, NOT ANY RUN OF DIGITS: a spec ("1600 nits … 1.000.000:1") or a price range
 *  ("800.000–1.500.000 ₫") is not a contact (commit gate, opus 2026-11-25). assertCleanTexts checks what is left. */
const CONTACT_LINE = /(?<!\d)(?:\+?84|0)\d{1,3}[\s.]?\d{3,4}[\s.]?\d{3,4}(?!\d)|zalo|https?:|www\.|\.com\b|\.vn\b|\S+@\S+\.\w+|hotline|whatsapp|facebook|fanpage|messenger/i
/** HAGA's closing marketing block ("Why Choose HAGA?" / "Tại sao chọn HAGA") repeats on every page: the text stops there. */
const MARKETING_HEAD = /^(why (choose|customers).*haga|tại sao (lại )?chọn haga|vì sao chọn haga)/i

export const dong = (n: number, lang: 'en' | 'vi') => formatMoneyFull(n, '₫', lang)

/** HAGA's text for one language: its own lines, the marketing block and every contact line cut. */
export function hagaText(intro: string | null, description: string | null): string[] {
  const lines: string[] = []
  // ⛔ The marketing block ends HAGA's text for good — in the intro as in the description (commit gate, opus 2026-11-25).
  for (const raw of [intro ?? '', description ?? ''].join('\n').split('\n')) {
    const l = raw.trim()
    if (!l) continue
    if (MARKETING_HEAD.test(l.replace(/^#+\s*/, ''))) break
    if (CONTACT_LINE.test(l)) continue
    if (!lines.includes(l)) lines.push(l)
  }
  return lines
}

/** Lines → listing text: a "- " item joins the line before it with one newline; every other line is its own paragraph. */
const joinBody = (lines: string[]) => lines.map((l, i) => (i && l.startsWith('- ') ? `\n${l}` : `${i ? '\n\n' : ''}${l}`)).join('')

/** Cut whole lines from the end until the text fits — never mid-sentence. */
function fit(compose: (lines: string[]) => string, lines: string[]): string | null {
  let body = lines
  let text = compose(body)
  while (text.length > DESCRIPTION_MAX && body.length > 2) { body = body.slice(0, -1); text = compose(body) }
  return text.length > DESCRIPTION_MAX ? null : text
}

/** One line of title: whitespace folded, a dangling separator HAGA left at the end ("… Replacement |") cut. */
const clean = (title: string) => title.replace(/\s+/g, ' ').trim().replace(/\s*[|–—-]+\s*$/, '').slice(0, TITLE_MAX)

function checked(texts: string[]): HagaRefusal | null {
  try { assertCleanTexts(texts) } catch (e) {
    if (e instanceof PublishBlockedError) return refuse(e.code === 'banned_words' ? 'bannedWords' : 'contactInText', `${e.code}${e.message ? `: ${e.message}` : ''}`)
    throw e
  }
  return null
}

const usedSubcategory = (r: HagaRecord): 'phones-tablets' | 'laptops-pcs' => {
  const where = `${r.en?.crumbs.join(' ') ?? ''} ${r.en?.title ?? ''}`.toLowerCase()
  return /iphone|ipad|galaxy|samsung/.test(where) && !/macbook|laptop/.test(where) ? 'phones-tablets' : 'laptops-pcs'
}

/** A used device → its listing, or why not. */
export function mapHagaUsed(r: HagaRecord): { ok: true; plan: HagaPlan } | HagaRefusal {
  const { vi, en } = r
  if (!vi || !en || !vi.title || !en.title) return refuse('missingPage', 'the Vietnamese or English page did not parse')
  if (!vi.price || vi.price <= 0) return refuse('noPrice', 'no published price')
  if (en.price !== vi.price) return refuse('priceConflict', `vi ${vi.price} ≠ en ${en.price}`)
  if (!vi.image || NO_IMAGE.test(vi.image)) return refuse('noPhoto', 'no product image')
  const price = vi.price
  const title = clean(en.title)
  const titleVi = clean(vi.title)
  const enLines = hagaText(en.intro, en.description)
  const viLines = hagaText(vi.intro, vi.description)
  const description = fit((lines) => [
    joinBody(lines),
    `# Price\n- ${dong(price, 'en')}, as HAGA publishes it (read ${HAGA.read.en}).`,
    'The photo is the manufacturer\'s image of this model, not the unit itself: ask HAGA for photos of the device, its battery health and what comes with it.',
    `Sold by ${HAGA.name} in ${HAGA.location}, Ho Chi Minh City. Message HAGA here on eno to check it is in stock, see it in the shop or arrange delivery.`,
  ].join('\n\n'), enLines)
  const descriptionVi = fit((lines) => [
    joinBody(lines),
    `# Giá\n- ${dong(price, 'vi')}, theo giá HAGA công bố (cập nhật ${HAGA.read.vi}).`,
    'Ảnh là ảnh mẫu của hãng cho dòng máy này, không phải ảnh chiếc máy thật: hãy nhắn HAGA để xem ảnh máy, tình trạng pin và phụ kiện đi kèm.',
    `Bán bởi ${HAGA.name} tại ${HAGA.location}, TP.HCM. Nhắn tin cho HAGA ngay trên eno để hỏi còn hàng, xem máy tại cửa hàng hoặc giao tận nơi.`,
  ].join('\n\n'), viLines)
  if (!description || !descriptionVi) return refuse('descriptionTooLong', 'over 5,000 characters')
  const bad = checked([title, titleVi, description, descriptionVi])
  if (bad) return bad
  const money = listingMoneyFor({ categorySlug: 'electronics', listingType: 'sell' })
  return {
    ok: true,
    plan: {
      sourceUrl: r.url,
      images: [vi.image],
      row: {
        externalId: `${HAGA_EXTERNAL_PREFIX}${r.slug.replace(/\.html$/, '')}`,
        title, titleVi, description, descriptionVi,
        price, priceUnit: money.priceUnit, currency: '₫', negotiable: false, listingType: 'sell', condition: 'used',
        categorySlug: 'electronics', subcategorySlug: usedSubcategory(r),
        city: CITY_NAME.hcmc, district: HAGA.district, location: HAGA.location,
        searchText: buildSearchText([title, titleVi, HAGA.location, HAGA.district, 'Thao Dien', HAGA.name, 'used cũ đã qua sử dụng second hand like new']),
      },
    },
  }
}

// ─── the repair services, grouped ───────────────────────────────────────────────────────────────

type Device = 'iphone' | 'samsung' | 'macbook'
type Kind = 'screen' | 'housing' | 'camera' | 'board' | 'charging' | 'battery' | 'parts' | 'care'

/** The device from HAGA's own breadcrumb ("Sửa chữa iPhone" / "Sửa chữa Samsung" / "Sửa chữa Macbook"), never the title. */
export function serviceDevice(r: HagaRecord): Device | null {
  const c = (r.vi?.crumbs ?? []).join(' ').toLowerCase()
  if (c.includes('macbook')) return 'macbook'
  if (c.includes('samsung')) return 'samsung'
  if (c.includes('iphone')) return 'iphone'
  return null
}

/** The kind of repair, from HAGA's English title. ORDER MATTERS: chip-level work first ("touch screen chipset" is a board
 *  repair), "keyboard" before anything with "board", a cable before "power" ("power cable" is a cable). */
export function serviceKind(titleEn: string): Kind {
  const t = titleEn.toLowerCase()
  if (/water|liquid|software|install/.test(t)) return 'care'
  if (/camera/.test(t)) return 'camera'
  if (/battery/.test(t)) return 'battery'
  if (/keyboard|trackpad/.test(t)) return 'parts'
  if (/chip|\bic\b|mainboard|logic board|motherboard|face ?id|nand|baseband|wi-?fi|network/.test(t)) return 'board'
  if (/housing|back glass|rear glass|back cover|casing|frame/.test(t)) return 'housing'
  if (/screen|display|front glass|touch|lcd|oled|glass|bezel/.test(t)) return 'screen'
  if (/speaker|micro|vibrat|taptic|button|sensor|earpiece|proximity|fan|hinge|sim/.test(t)) return 'parts'
  if (/charg|port|lightning|usb|flex|cable/.test(t)) return 'charging'
  if (/power|board|hard/.test(t)) return 'board'
  return 'parts'
}

type Group = { key: string; device: Device; kinds: Kind[]; title: { en: string; vi: string }; intro: { en: string; vi: string } }
/** Twelve listings (2026-11-25): eight for iPhone, two for Samsung, two for MacBook. */
export const SERVICE_GROUPS: readonly Group[] = [
  { key: 'iphone-screen', device: 'iphone', kinds: ['screen'], title: { en: 'iPhone screen and glass repair – prices by model', vi: 'Thay màn hình, mặt kính iPhone – giá theo từng đời máy' },
    intro: { en: 'Screen, front glass and touch repairs for iPhone X to iPhone 15, in OEM or Apple parts, at HAGA in An Khánh (Thảo Điền).', vi: 'Thay màn hình, mặt kính và cảm ứng iPhone từ iPhone X đến iPhone 15, linh kiện OEM hoặc chính hãng Apple, tại HAGA An Khánh (Thảo Điền).' } },
  { key: 'iphone-housing', device: 'iphone', kinds: ['housing'], title: { en: 'iPhone back housing and back glass replacement – prices by model', vi: 'Thay vỏ, kính lưng iPhone – giá theo từng đời máy' },
    intro: { en: 'Back housing, casing and rear glass replacement for a bent frame, cracked back or worn body.', vi: 'Thay vỏ, khung và kính lưng iPhone khi máy cong khung, vỡ lưng hoặc trầy xước nặng.' } },
  { key: 'iphone-camera', device: 'iphone', kinds: ['camera'], title: { en: 'iPhone camera repair – prices by model', vi: 'Sửa, thay camera iPhone – giá theo từng đời máy' },
    intro: { en: 'Rear, front and main camera replacement and camera glass repair.', vi: 'Thay camera sau, camera trước, camera chính và kính camera iPhone.' } },
  { key: 'iphone-board', device: 'iphone', kinds: ['board'], title: { en: 'iPhone mainboard, power IC and Face ID repair – prices by model', vi: 'Sửa main, IC nguồn, Face ID iPhone – giá theo từng đời máy' },
    intro: { en: 'Board-level repairs: power IC, charging and network chips, Wi-Fi, Face ID and mainboard replacement.', vi: 'Sửa chữa chuyên sâu trên bo mạch: IC nguồn, chip sạc, chip sóng, Wi-Fi, Face ID và thay mainboard.' } },
  { key: 'iphone-charging', device: 'iphone', kinds: ['charging'], title: { en: 'iPhone charging port and cable repair – prices by model', vi: 'Thay chân sạc, cáp iPhone – giá theo từng đời máy' },
    intro: { en: 'Charging port, charging cable and internal flex cable replacement.', vi: 'Thay cổng sạc, cáp sạc và các cáp kết nối bên trong iPhone.' } },
  { key: 'iphone-battery', device: 'iphone', kinds: ['battery'], title: { en: 'iPhone battery replacement – prices by model', vi: 'Thay pin iPhone – giá theo từng đời máy' },
    intro: { en: 'Battery replacement, original Apple or OEM cells.', vi: 'Thay pin iPhone, pin chính hãng Apple hoặc OEM.' } },
  { key: 'iphone-parts', device: 'iphone', kinds: ['parts'], title: { en: 'iPhone speaker, vibration and sensor repair – prices by model', vi: 'Thay loa, rung, cảm biến iPhone – giá theo từng đời máy' },
    intro: { en: 'Speaker, earpiece, vibration motor, buttons and sensor repairs.', vi: 'Thay loa, loa trong, motor rung, nút bấm và cảm biến iPhone.' } },
  { key: 'iphone-care', device: 'iphone', kinds: ['care'], title: { en: 'iPhone water damage cleaning and software installation – prices by service', vi: 'Vệ sinh iPhone vào nước, cài đặt phần mềm iPhone – giá theo dịch vụ' },
    intro: { en: 'Cleaning and drying an iPhone that got wet, and installing or restoring its software.', vi: 'Vệ sinh, sấy iPhone bị vào nước và cài đặt, khôi phục phần mềm.' } },
  { key: 'samsung-screen', device: 'samsung', kinds: ['screen'], title: { en: 'Samsung Galaxy screen and glass repair – prices by model', vi: 'Thay màn hình, mặt kính Samsung Galaxy – giá theo từng đời máy' },
    intro: { en: 'Screen, display assembly and glass repairs for Galaxy S, Note, Z Flip and Z Fold.', vi: 'Thay màn hình, cụm màn hình và mặt kính Samsung Galaxy S, Note, Z Flip, Z Fold.' } },
  { key: 'samsung-other', device: 'samsung', kinds: ['housing', 'camera', 'board', 'charging', 'battery', 'parts', 'care'], title: { en: 'Samsung Galaxy battery, charging port and other repairs – prices by model', vi: 'Thay pin, chân sạc và sửa chữa khác Samsung Galaxy – giá theo từng đời máy' },
    intro: { en: 'Battery, charging port, frame cable, camera and other repairs for Galaxy phones.', vi: 'Thay pin, cổng sạc, cáp khung, camera và các sửa chữa khác cho điện thoại Samsung Galaxy.' } },
  { key: 'macbook-screen', device: 'macbook', kinds: ['screen'], title: { en: 'MacBook screen replacement – prices by model', vi: 'Thay màn hình MacBook – giá theo từng đời máy' },
    intro: { en: 'MacBook Air and MacBook Pro screen and display cable replacement, in original or OEM panels.', vi: 'Thay màn hình và cáp màn hình MacBook Air, MacBook Pro, tấm nền chính hãng hoặc OEM.' } },
  { key: 'macbook-other', device: 'macbook', kinds: ['housing', 'camera', 'board', 'charging', 'battery', 'parts', 'care'], title: { en: 'MacBook battery, keyboard and board repair – prices by model', vi: 'Thay pin, bàn phím, sửa main MacBook – giá theo từng đời máy' },
    intro: { en: 'Battery, keyboard, fan and power IC repairs, and software installation for MacBook Air and MacBook Pro.', vi: 'Thay pin, bàn phím, quạt, sửa IC nguồn và cài đặt phần mềm cho MacBook Air, MacBook Pro.' } },
]

/** HAGA's own service intro lines worth carrying per item: the warranty and the time it takes ("Warranty: 3months" /
 *  "Bảo hành 3 tháng", "Estimate time: 2-3 days" / "Thời gian hoàn thành: 2-3 ngày"). */
export function itemTerms(intro: string | null, lang: 'en' | 'vi'): string | null {
  let warranty: string | null = null
  let time: string | null = null
  for (const raw of (intro ?? '').split('\n')) {
    const l = raw.trim()
    const w = lang === 'en' ? l.match(/^warranty\s*:?\s*(.+)$/i) : l.match(/^bảo hành\s*:?\s*(.+)$/i)
    const t = lang === 'en' ? l.match(/^estimated? time\s*:\s*(.+)$/i) : l.match(/^thời gian[^:]*:\s*(.+)$/i)
    if (w && !warranty) warranty = w[1].trim().replace(/(\d)\s*(months?|tháng)/i, '$1 $2')
    if (t && !time) time = t[1].trim()
  }
  const none = (x: string) => /^(no|none|không)$/i.test(x)
  const parts = [
    warranty ? (none(warranty) ? (lang === 'en' ? 'no warranty' : 'không bảo hành') : `${lang === 'en' ? 'warranty' : 'bảo hành'} ${warranty}`) : null,
    time,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** Where an iPhone model sits in the table (X, XR, XS … 15 Pro Max); null for anything else, which sorts after by name. */
export function iphoneRank(title: string): number | null {
  const m = title.toLowerCase().match(/(?:iphone|\bip)\s*(\d{1,2}|x[rs]?)\b(\s*(?:pro\s*max|pro|plus|max|mini|e)\b)?/)
  if (!m) return null
  const gen = /^\d/.test(m[1]) ? Number(m[1]) : m[1] === 'x' ? 10 : m[1] === 'xr' ? 10.1 : 10.2
  // "Pro Max", "ProMax" and "pro  max" are one model (commit gate, opus 2026-11-25: an unknown key made the rank NaN).
  const v = (m[2] ?? '').replace(/\s+/g, '')
  return gen + ({ '': 0, e: 0.005, mini: 0.01, plus: 0.02, max: 0.04, pro: 0.03, promax: 0.04 } as Record<string, number>)[v]
}

export type ServiceItem = { record: HagaRecord; titleEn: string; titleVi: string; price: number; termsEn: string | null; termsVi: string | null }

/** Every service grouped, with the records that could not be placed and why. */
export function groupHagaServices(records: HagaRecord[]): { groups: { group: Group; items: ServiceItem[] }[]; refused: { slug: string; reason: string }[] } {
  const refused: { slug: string; reason: string }[] = []
  const byKey = new Map<string, ServiceItem[]>()
  for (const r of records) {
    if (r.kind !== 'service') continue
    const { vi, en } = r
    if (!vi || !en || !vi.title || !en.title) { refused.push({ slug: r.slug, reason: 'missingPage' }); continue }
    if (!vi.price || vi.price <= 0) { refused.push({ slug: r.slug, reason: 'noPrice' }); continue }
    if (en.price !== vi.price) { refused.push({ slug: r.slug, reason: `priceConflict vi ${vi.price} ≠ en ${en.price}` }); continue }
    const device = serviceDevice(r)
    if (!device) { refused.push({ slug: r.slug, reason: 'noDevice' }); continue }
    const kind = serviceKind(en.title)
    const group = SERVICE_GROUPS.find((g) => g.device === device && g.kinds.includes(kind))
    if (!group) { refused.push({ slug: r.slug, reason: `noGroup ${device}/${kind}` }); continue }
    const item: ServiceItem = { record: r, titleEn: clean(en.title), titleVi: clean(vi.title), price: vi.price, termsEn: itemTerms(en.intro, 'en'), termsVi: itemTerms(vi.intro, 'vi') }
    const list = byKey.get(group.key) ?? []
    // HAGA lists some repairs twice (an older and a newer page, the same name and price): one line each in the table.
    const dupe = list.find((x) => x.price === item.price && x.titleVi.toLowerCase() === item.titleVi.toLowerCase())
    if (dupe) { refused.push({ slug: r.slug, reason: `duplicate of ${dupe.record.slug}` }); continue }
    byKey.set(group.key, [...list, item])
  }
  const groups = SERVICE_GROUPS.filter((g) => byKey.has(g.key)).map((group) => ({
    group,
    // By model (iPhone X → 15 Pro Max), then name, then price; models HAGA names no other way sort by name after them.
    items: [...byKey.get(group.key)!].sort((a, b) => {
      const ra = iphoneRank(a.titleEn) ?? Infinity, rb = iphoneRank(b.titleEn) ?? Infinity
      return ra !== rb ? ra - rb : a.titleEn.localeCompare(b.titleEn) || a.price - b.price
    }),
  }))
  return { groups, refused }
}

/** One grouped service listing. */
export function mapHagaServiceGroup(group: Group, items: ServiceItem[]): { ok: true; plan: HagaPlan } | HagaRefusal {
  if (!items.length) return refuse('empty', group.key)
  // The card's figure: the lowest price in the table (the title says "prices by model").
  const price = Math.min(...items.map((i) => i.price))
  const line = (i: ServiceItem, lang: 'en' | 'vi') => {
    const terms = lang === 'en' ? i.termsEn : i.termsVi
    return `- ${lang === 'en' ? i.titleEn : i.titleVi}: ${dong(i.price, lang)}${terms ? ` (${terms})` : ''}`
  }
  // ⛔ NEVER TRIMMED: a table that loses rows would price fewer models than its search text names — over the limit, the
  // group is held (commit gate, opus 2026-11-25; the largest group on 2026-11-25 is 2,802 characters).
  // ⚠️ THE PROSE BEFORE THE TABLE, ON PURPOSE: the PDP clamps a long text to 8 lines below md (listing-content.tsx), and a clamp
  // that falls inside a list draws the hidden lines over the next block (seen 2026-11-25 on the first import's layout).
  const whole = (compose: (lines: string[]) => string, lines: string[]) => { const t = compose(lines); return t.length > DESCRIPTION_MAX ? null : t }
  const description = whole((lines) => [
    group.intro.en,
    `Prices as HAGA publishes them (read ${HAGA.read.en}). HAGA checks the device first, free, and confirms the price before any work.`,
    `${HAGA.name}, ${HAGA.location}, Ho Chi Minh City: English-speaking staff, pickup and delivery in the city. Message HAGA here on eno with your model to book a repair.`,
    `# Prices by model\n${lines.join('\n')}`,
  ].join('\n\n'), items.map((i) => line(i, 'en')))
  const descriptionVi = whole((lines) => [
    group.intro.vi,
    `Giá theo bảng giá HAGA công bố (cập nhật ${HAGA.read.vi}). HAGA kiểm tra máy miễn phí và báo giá trước khi sửa.`,
    `${HAGA.name}, ${HAGA.location}, TP.HCM: nhân viên nói tiếng Anh, nhận và giao máy tận nơi trong thành phố. Nhắn tin cho HAGA ngay trên eno, kèm đời máy, để đặt lịch sửa.`,
    `# Giá theo từng đời máy\n${lines.join('\n')}`,
  ].join('\n\n'), items.map((i) => line(i, 'vi')))
  if (!description || !descriptionVi) return refuse('descriptionTooLong', `${group.key}: over 5,000 characters`)
  const title = clean(group.title.en)
  const titleVi = clean(group.title.vi)
  const bad = checked([title, titleVi, description, descriptionVi])
  if (bad) return bad
  // Photos: the group's own HAGA images (no "NoImage" placeholder), distinct, at most four, in table order.
  const images = [...new Set(items.map((i) => i.record.vi?.image).filter((x): x is string => !!x && !NO_IMAGE.test(x)))].slice(0, 4)
  if (!images.length) return refuse('noPhoto', group.key)
  const money = listingMoneyFor({ categorySlug: 'services', subcategorySlug: 'repair', listingType: 'service' })
  return {
    ok: true,
    plan: {
      // HAGA's repair list, where these prices were read (scripts/backfill-partner-source-links.ts links staff to it too).
      sourceUrl: `${HAGA.site}/dich-vu-sua-chua/`,
      images,
      row: {
        externalId: `${HAGA_EXTERNAL_PREFIX}service-${group.key}`,
        title, titleVi, description, descriptionVi,
        price, priceUnit: money.priceUnit, currency: '₫', negotiable: false, listingType: 'service', condition: null,
        categorySlug: 'services', subcategorySlug: 'repair',
        city: CITY_NAME.hcmc, district: HAGA.district, location: HAGA.location,
        searchText: buildSearchText([title, titleVi, HAGA.location, HAGA.district, 'Thao Dien', HAGA.name, 'repair sửa chữa thay',
          ...items.map((i) => i.titleEn), ...items.map((i) => i.titleVi)]),
      },
    },
  }
}

export type HagaSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }
/** Why the storefront may not take these listings, or null: it must be HAGA's own, eno-held, official. */
export function hagaSellerRefusal(seller: HagaSeller | null): string | null {
  if (!seller) return `no /${HAGA.handle} storefront — register it first (scripts/register-partner-seller.mjs ${HAGA.handle} --apply)`
  if (!seller.ownerId) return `/${HAGA.handle} has no owner account`
  if (seller.ownerEmail !== `support+${HAGA.handle}@eno.vn`) return `/${HAGA.handle} is owned by ${seller.ownerEmail ?? '?'}, not eno's support+${HAGA.handle}@eno.vn`
  if (!seller.officialPartner) return `/${HAGA.handle} is not an official partner — scripts/set-official-partner.mjs ${HAGA.handle} --apply`
  return null
}
