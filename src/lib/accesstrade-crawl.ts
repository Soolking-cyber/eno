/**
 * HOÀNG HÀ AND SHOPDUNK USED STOCK, READ FROM THE SHOPS' OWN PAGES. Both are AccessTrade campaigns whose
 * datafeed carries no used goods, so the nightly stock/price job and the importer read the used catalogue
 * here instead. This module FETCHES AND PARSES; it never writes (same split as src/lib/partner-fetch.ts).
 *
 * ⛔ COMPLETENESS IS THE WHOLE POINT, SAME PHILOSOPHY AS partner-fetch.ts's ReadLog. The nightly job
 * retires what a read did not see, so a read MUST say when its absences mean nothing:
 *   - `fatal`: an ENUMERATION broke (index, category or model page failed after retries, a walk hit the
 *     page cap, a pager promised a page that added nothing, the deadline cut the walk). We then do not
 *     know WHAT we did not see, and nothing may be retired on the strength of this read.
 *   - per-page rate: individual PRODUCT pages (ShopDunk) or unit cards (Hoàng Hà) that could not be
 *     read go to `unknown`, never to "gone"; more than 2% of them makes the read incomplete.
 * An empty catalogue is never evidence either: zero products across every category is treated as fatal.
 *
 * ⛔ A REDIRECT IS A FAILURE, NOT A PAGE. Requests use `redirect: 'manual'`: following a 302 lands on a
 * shop's "not found" page with HTTP 200, which would parse as a model with no units (Hoàng Hà) and retire
 * them all. MEASURED 2026-11-15: ShopDunk answers a delisted product (/iphone-11) with
 * `302 Location: /page-not-found`. The one exception is named and narrow: a Hoàng Hà model page that
 * redirects to a category (isHoangHaModelGone).
 *
 * ⚠️ POLITENESS: the truthful partner-fetch UA, one request at a time per read, a `delayMs` gap
 * (DELAY_MS by default) before every request after the first, 2 retries with 2 s / 6 s backoff, and five
 * failed pages in a row stops the read (a host that stopped answering is not hammered for 500 more).
 */
import { DELAY_MS, UA, clean } from './partner-fetch'

export type CrawlRow = { sku: string; name: string; price: number; url: string; inStock: boolean; images: string[]; desc: string }
export type CrawlRead = {
  /** Seen AND parsed, in stock or not. */
  rows: Map<string, CrawlRow>
  /** Seen (id known) but not readable: stock/price UNKNOWN — never treat as gone. */
  unknown: Set<string>
  /** Distinct titles that declare NEW goods, left out (see isNewGoodsTitle). */
  skippedNew: number
  /**
   * Their ids — POSITIVE evidence, not an absence (commit gate, codex 2026-11-15): a unit we hold whose title now declares
   * new goods leaves the used shelf through the night's uncapped not-used path, never through the capped absence path.
   */
  newSkus: Set<string>
  complete: boolean
  log: { pages: number; failed: number; fatal: boolean; reason?: string }
}
export type CrawlOpts = {
  /** Epoch ms. Past it the read stops: complete=false, reason 'deadline'. */
  deadline: number
  /** Read gallery photos (Hoàng Hà: one extra request per unit). */
  withPhotos?: boolean
  fetchImpl?: typeof fetch
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export const HH_ORIGIN = 'https://hoanghamobile.com'
export const SD_ORIGIN = 'https://shopdunk.com'
/** Waits before the 1st and 2nd retry of a page; a page counts as failed after the 3rd attempt. */
export const RETRY_BACKOFF_MS = [2_000, 6_000] as const
const TIMEOUT_MS = 30_000
const MAX_IMAGES = 5
/** Same tolerance as partner-fetch.ts's MAX_READ_FAILURE_RATE. */
const MAX_FAILURE_RATE = 0.02
/** This many failed pages in a row = the host stopped answering; stop instead of hammering it. */
const MAX_FAILURE_STREAK = 5
/** A walk still finding new entries this deep is broken (Hoàng Hà's longest model had 11 pages). */
const MAX_PAGES = 60
/**
 * More than this share of model pages answering "gone" (a redirect to a category) is not sold-out stock,
 * it is a site that changed or is turning us away. MEASURED: 9 of 525 model pages on 2026-11-14.
 */
const MAX_GONE_MODEL_SHARE = 0.1

/**
 * ⛔ NEW GOODS ARE LEFT OUT. A used-goods listing must not carry a sealed / never-activated device.
 * ⚠️ "Mới 99%", "Like new", "Trôi bảo hành" / "Trôi BH" are USED grades and must NOT match.
 * ⚠️ NFC FIRST: ShopDunk writes titles decomposed ("Tro&#x302;i BH" = o + U+0302), so "nguyên" arrives as
 * "nguye" + combining circumflex + "n" and a composed pattern would never match it.
 */
// "Mới 99%" / "Like new" / "Máy mới 99%" are used GRADES and stay; these declare new goods (commit gate, codex: + brand new,
// sealed, hàng/máy mới without a grade, full box new).
export const NEW_GOODS_TITLE = /nguyên\s*seal|new\s*seal|\bsealed\b|brand[\s-]*new|chưa\s*kích\s*hoạt|mới\s*100\s*%|(?:hàng|máy)\s*mới(?!\s*(?:\d|về))|fullbox\s*mới|new\s*100\s*%|\bunopened\b|^\s*new\s/iu
export const isNewGoodsTitle = (title: string): boolean => NEW_GOODS_TITLE.test(title.normalize('NFC'))

/** clean() (tags out, entities decoded) and composed, so "Tro&#x302;i" compares equal to "Trôi". */
const text = (html: string): string => clean(html).normalize('NFC')
const digits = (s: string): number => {
  const m = /(\d[\d.]*)\s*(?:đ|₫)/.exec(s) ?? /(\d[\d.]*)/.exec(s)
  const n = m ? Number(m[1].replace(/\./g, '')) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** An attribute of one opening tag, quoted or not (ShopDunk's minified HTML drops the quotes). */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${escapeRe(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+?)(?=\\s|/?>))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}
const classes = (tag: string): Set<string> => new Set((attr(tag, 'class') ?? '').split(/\s+/).filter(Boolean))
/** Every non-nested `<name …>inner</name>` element. Fine for a, h3, p, span, dt, dd. */
function elements(html: string, name: string): { tag: string; inner: string }[] {
  const out: { tag: string; inner: string }[] = []
  const re = new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)</${name}>`, 'gi')
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ tag: m[1], inner: m[2] })
  return out
}
const unique = <T>(xs: T[]): T[] => [...new Set(xs)]
/** html[from…] up to the first `end` after it (or to the end of the page). */
const sliceTo = (html: string, from: number, end: string): string => {
  const e = html.indexOf(end, from)
  return html.slice(from, e < 0 ? undefined : e)
}

// ── Fetching ────────────────────────────────────────────────────────────────────────────────────────

/** Unwinds a read: the deadline passed, or the host stopped answering. */
class StopRead extends Error {
  constructor(readonly why: string) { super(why) }
}

/** `html` is '' when the answer was an accepted redirect (see `get`'s `gone`). */
type Got = { ok: true; html: string } | { ok: false; reason: string }

/** One per read call — never module state (see partner-fetch.ts on the overlapping-runs race). */
class Fetcher {
  pages = 0
  failed = 0
  private streak = 0
  private started = false
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly delayMs: number
  private readonly deadline: number

  constructor(opts: CrawlOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.delayMs = opts.delayMs ?? DELAY_MS
    this.deadline = opts.deadline
  }

  private checkDeadline() {
    if (Date.now() >= this.deadline) throw new StopRead('deadline')
  }

  /**
   * HTTP 200 that `valid` accepts, after up to 2 retries. A 200 that `valid` rejects (a page the parser
   * does not recognise) is retried like a 503 — a half-rendered page must not read as "nothing here".
   * `gone(status, location)` names the one non-200 answer that is a definitive "nothing here": it is
   * returned at once as an empty page, not retried and not a failure.
   */
  async get(
    url: string, valid: (html: string) => boolean = () => true, gone?: (status: number, location: string | null) => boolean,
  ): Promise<Got> {
    this.pages++
    let reason = ''
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
      if (this.started) {
        this.checkDeadline()
        await this.sleep(attempt === 0 ? this.delayMs : Math.max(this.delayMs, RETRY_BACKOFF_MS[attempt - 1]))
      }
      this.checkDeadline()
      this.started = true
      try {
        const res = await this.fetchImpl(url, {
          headers: { 'User-Agent': UA, Accept: 'text/html' },
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (res.status !== 200) {
          const loc = res.headers.get('location')
          reason = `HTTP ${res.status}${loc ? ` → ${loc}` : ''}`
          // Free the connection; the body of a page we refuse is never read.
          try { await res.body?.cancel() } catch { /* already closed */ }
          if (gone?.(res.status, loc)) { this.streak = 0; return { ok: true, html: '' } }
          continue
        }
        const html = await res.text()
        if (!valid(html)) { reason = 'HTTP 200 but not the page expected'; continue }
        this.streak = 0
        return { ok: true, html }
      } catch (e) {
        reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      }
    }
    this.failed++
    if (++this.streak >= MAX_FAILURE_STREAK) throw new StopRead(`${this.streak} pages in a row failed, last ${url}: ${reason}`)
    return { ok: false, reason }
  }
}

/**
 * Pages 1, 2, … until a page adds no key (model link, unit id, product id) this walk has not seen —
 * that is the end. Returns null when the walk ended cleanly, else why it did not.
 * ⛔ A PAGER THAT PROMISED MORE IS CHECKED: when page n offered page n+1 ("Xem thêm 188 sản phẩm") and
 * page n+1 adds nothing, that is not the end, it is a broken read. MEASURED 2026-11-15 on Hoàng Hà
 * (viettel-t2-4g, 208 units): ?p=10 offers 11, ?p=11 has 8 cards and no pager, ?p=12 is an empty grid.
 */
async function walk(
  f: Fetcher, label: string, urlFor: (n: number) => string, valid: (html: string) => boolean,
  keysOf: (html: string) => string[], onPage: (html: string) => void, nextOf?: (html: string) => number | null,
  gone?: (status: number, location: string | null) => boolean,
): Promise<string | null> {
  const seen = new Set<string>()
  let offered: number | null = null
  for (let n = 1; n <= MAX_PAGES; n++) {
    const got = await f.get(urlFor(n), valid, gone)
    if (!got.ok) return `${label} page ${n}: ${got.reason}`
    const keys = keysOf(got.html)
    if (!keys.some((k) => !seen.has(k))) {
      return offered === n ? `${label}: page ${n - 1} offered page ${n}, which added nothing` : null
    }
    for (const k of keys) seen.add(k)
    onPage(got.html)
    offered = nextOf?.(got.html) ?? null
  }
  return `${label}: still finding new entries at page ${MAX_PAGES}`
}

const emptyRead = (): CrawlRead => ({
  rows: new Map(), unknown: new Set(), skippedNew: 0, newSkus: new Set(), complete: false, log: { pages: 0, failed: 0, fatal: false },
})

// ── Hoàng Hà ────────────────────────────────────────────────────────────────────────────────────────

/** Index → `/kho-san-pham-cu/<cat>` (one segment). A unit link (`/kho-san-pham-cu/<slug>-p<id>`) is also one segment and is not a category. */
export function parseHoangHaCategoryLinks(html: string): string[] {
  return unique([...html.matchAll(/href="(\/kho-san-pham-cu\/[A-Za-z0-9-]+)"/g)].map((m) => m[1]))
    .filter((h) => !/-p\d+$/.test(h))
}

/** Category page → model links `/kho-san-pham-cu/<cat>/<slug>`. The <cat> segment is often not the category read. */
export function parseHoangHaModelLinks(html: string): string[] {
  return unique([...html.matchAll(/href="(\/kho-san-pham-cu\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+)"/g)].map((m) => m[1]))
}

export function parseHoangHaUnitIds(html: string): string[] {
  return unique([...html.matchAll(/data-used-device-id="(\d+)"/g)].map((m) => m[1]))
}

/** Every Hoàng Hà listing page — category or model, full or empty — carries the product grid. */
export const isHoangHaListing = (html: string): boolean => /\sdata-category-products[\s>]/.test(html)

/** The page the "Xem thêm N sản phẩm" button loads next, or null when there is no such button. */
export function hoangHaNextPage(html: string): number | null {
  const tag = /<button\b[^>]*\sdata-category-more\b[^>]*>/.exec(html)?.[0]
  const n = tag ? Number(attr(tag, 'data-next-page')) : NaN
  return Number.isInteger(n) && n > 1 ? n : null
}

/**
 * ⛔ A MODEL PAGE THAT REDIRECTS TO A CATEGORY IS A MODEL WITH NO UNITS LEFT, not a failed page.
 * MEASURED 2026-11-15: /kho-san-pham-cu/dien-thoai-di-dong/apple-iphone-14-pro-max-512gb-chinh-hang-vn-a,
 * still linked from the dien-thoai category, answers `301 Location: /kho-san-pham-cu/dien-thoai`; the
 * 2026-11-14 recon (curl -L) counted 9 such models as "empty". Only a redirect to the warehouse or one of
 * its categories counts — anywhere else (home, a login, another host) stays a failure, and so does a
 * share of these above MAX_GONE_MODEL_SHARE.
 */
export function isHoangHaModelGone(status: number, location: string | null): boolean {
  if (![301, 302, 303, 307, 308].includes(status) || !location) return false
  let to: URL
  try { to = new URL(location, HH_ORIGIN) } catch { return false }
  return to.origin === HH_ORIGIN && /^\/kho-san-pham-cu(?:\/[A-Za-z0-9-]+)?\/?$/.test(to.pathname)
}

export type HoangHaUnit = {
  sku: string; name: string; price: number; url: string
  badges: string[]; spec: string; warranty: string; store: string; thumb: string | null
}

/** The bare image URL: no `;p=thumb-md` size suffix. */
const hhBare = (u: string) => u.replace(/;.*$/, '')

/**
 * Model page → its unit cards. `unit` is null for a card that would not parse (its id is still known).
 * ⚠️ PRICE = the card's MAIN price (`text-danger-900`), never the struck-through was-price (`line-through`).
 */
/**
 * ⛔ NO DEVICE IDENTIFIER IS PUBLISHED. 184 of 2,446 Hoàng Hà unit titles (measured 2026-11-15) carry the unit's 15-digit
 * IMEI; on an eno listing that is a phone's network identity handed to anyone who opens the page. Removed from the title
 * and the spec line before anything else reads them (the unit id, not the IMEI, is the row's identity).
 */
export function stripImei(s: string): string {
  return s.replace(/(?:\bIMEI\s*[:#]?\s*)?(?<!\d)\d{15}(?!\d)/gi, ' ')
    .replace(/\s*[-_|/]\s*(?=[-_|/]|$)/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

export function parseHoangHaUnits(html: string): { sku: string; unit: HoangHaUnit | null }[] {
  const out: { sku: string; unit: HoangHaUnit | null }[] = []
  for (const { tag, inner } of elements(html, 'article')) {
    const sku = attr(tag, 'data-used-device-id')
    if (!sku || !/^\d+$/.test(sku)) continue
    const href = new RegExp(`href="(/kho-san-pham-cu/[A-Za-z0-9-]+-p${sku})"`).exec(inner)?.[1]
    const h3 = elements(inner, 'h3')[0]
    const name = stripImei(h3 ? text(elements(h3.inner, 'a')[0]?.inner ?? h3.inner) : '')
    const main = elements(inner, 'p').find(({ tag: t }) => {
      const c = classes(t)
      return c.has('text-danger-900') && c.has('font-bold') && !c.has('line-through')
    })
    const price = main ? digits(text(main.inner)) : 0
    const badges = elements(inner, 'span')
      .filter(({ tag: t }) => { const c = classes(t); return c.has('rounded') && c.has('text-[11px]') && c.has('font-semibold') })
      .map(({ inner: i }) => text(i)).filter(Boolean)
    const specP = elements(inner, 'p').find(({ tag: t }) => { const c = classes(t); return c.has('line-clamp-1') && c.has('text-[11px]') })
    let warranty = ''
    let store = ''
    for (const m of inner.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)) {
      const label = text(m[1])
      const value = text(m[2])
      if (/^cửa hàng/i.test(label)) store = value
      else if (/^bảo hành/i.test(label)) warranty = value
    }
    const thumbSrc = /<img\b[^>]*\ssrc="(https:\/\/i\.hoanghamobile\.vn\/Uploads\/[^"]+)"/.exec(inner)?.[1]
    const ok = !!href && !!name && price > 0
    out.push({
      sku,
      unit: ok ? {
        sku, name, price, url: HH_ORIGIN + href, badges, spec: specP ? stripImei(text(specP.inner)) : '', warranty, store,
        thumb: thumbSrc ? hhBare(thumbSrc) : null,
      } : null,
    })
  }
  return out
}

/** Vietnamese, one fact per line: badges, the spec line, the warranty line, the store holding the unit. */
export function hoangHaDesc(u: HoangHaUnit): string {
  return [u.badges.join(' · '), u.spec, u.warranty, u.store ? `Cửa hàng: ${u.store}` : '']
    .filter(Boolean).join('\n')
}

const hoangHaRow = (u: HoangHaUnit): CrawlRow => ({
  sku: u.sku, name: u.name, price: u.price, url: u.url, inStock: true, images: u.thumb ? [u.thumb] : [], desc: hoangHaDesc(u),
})

/** Same picture: `;p=<size>` variants, and Hoàng Hà's `<name>_<digits>.<ext>` re-encode of `<name>.<ext>`. */
const hhImageKey = (u: string) => hhBare(u).toLowerCase().replace(/_\d+(\.[a-z0-9]+)$/, '$1')

function hhImages(segment: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of segment.matchAll(/https:\/\/i\.hoanghamobile\.vn\/Uploads\/[^\s"'<>;]+?\.(?:jpe?g|png|webp)(?![A-Za-z0-9])/gi)) {
    const key = hhImageKey(m[0])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m[0])
  }
  return out
}

/**
 * Unit page → its gallery photos, bare URLs, deduped, in order, ≤5. [] when the page has no gallery
 * (the caller keeps the card thumbnail).
 * ⚠️ ONLY THE GALLERY PANELS, never the page: a unit page also carries the header promo slider and ten
 * related units' thumbnails. MEASURED 2026-11-15 (unit 69333): 80 Uploads URLs on the page, 4 in the gallery.
 * ⚠️ "ẢNH THỰC TẾ" (THIS UNIT) FIRST, AND ALONE WHEN PRESENT. The second panel, "Ảnh sản phẩm", is the
 * maker's photo of the model new, which the shop itself captions "không phải ảnh của chiếc máy này" (not a
 * photo of this unit) — on a used listing it would hide the unit's condition. It is used only when the
 * unit has no real photos at all.
 */
export function parseHoangHaGallery(html: string): string[] {
  const panel = (name: string) => {
    const a = html.indexOf(`data-used-device-gallery-panel="${name}"`)
    if (a < 0) return ''
    // ⛔ A panel ends at the NEXT panel, or at the first unit card after it, whichever comes first (commit gate, codex): the
    // last panel otherwise ran to the end of the page and could take another unit's thumbnails from the related rail.
    const ends = [html.indexOf('data-used-device-gallery-panel=', a + 1), html.indexOf('<article', a + 1), html.indexOf('data-used-device-id=', a + 1)]
      .filter((x) => x > a)
    return html.slice(a, ends.length ? Math.min(...ends) : Math.min(html.length, a + 20_000))
  }
  const real = hhImages(panel('real'))
  return (real.length ? real : hhImages(panel('source'))).map(hhBare).slice(0, MAX_IMAGES)
}

const hhUrl = (path: string, n: number) => `${HH_ORIGIN}${path}${n > 1 ? `?p=${n}` : ''}`

/**
 * Hoàng Hà's used warehouse, ONE ROW PER UNIT (each unit is its own page and price).
 * index → categories (?p=N) → model pages (?p=N) → unit cards. Every listed unit is in stock.
 * MEASURED 2026-11-15: 24 categories, 525 model pages, 1,093 pages, 52 models paginate, 9 empty, 2,833 units.
 * ⛔ ANY enumeration page failing after retries — a 404 on a model page linked that night included — makes
 * the read fatal: its units are unknown, not gone. A model page with an empty grid, or one that redirects
 * to a category (isHoangHaModelGone), is a valid empty model.
 */
export async function readHoangHaUsed(opts: CrawlOpts): Promise<CrawlRead> {
  const f = new Fetcher(opts)
  const read = emptyRead()
  const skipped = new Set<string>()
  const fatal = (reason: string) => { read.log.fatal = true; read.log.reason ??= reason }
  let enumerated = false
  let stopped = false

  const addUnits = (html: string) => {
    for (const { sku, unit } of parseHoangHaUnits(html)) {
      if (read.rows.has(sku) || skipped.has(sku)) continue // a unit listed on several models: first wins
      if (!unit) { read.unknown.add(sku); continue }
      read.unknown.delete(sku)
      if (isNewGoodsTitle(unit.name)) { skipped.add(sku); continue }
      read.rows.set(sku, hoangHaRow(unit))
    }
  }

  try {
    const index = await f.get(`${HH_ORIGIN}/kho-san-pham-cu`, (h) => parseHoangHaCategoryLinks(h).length > 0)
    if (!index.ok) fatal(`index: ${index.reason}`)
    else {
      const models: string[] = []
      const known = new Set<string>()
      for (const cat of parseHoangHaCategoryLinks(index.html)) {
        const why = await walk(f, cat, (n) => hhUrl(cat, n), isHoangHaListing, parseHoangHaModelLinks, (h) => {
          for (const m of parseHoangHaModelLinks(h)) if (!known.has(m)) { known.add(m); models.push(m) }
        }, hoangHaNextPage)
        if (why) fatal(why)
      }
      if (!models.length) fatal('no model links on any category page')
      let goneModels = 0
      for (const model of models) {
        const why = await walk(f, model, (n) => hhUrl(model, n), isHoangHaListing, parseHoangHaUnitIds, addUnits, hoangHaNextPage,
          (status, location) => isHoangHaModelGone(status, location) && ++goneModels > 0)
        if (why) fatal(why)
      }
      if (goneModels > MAX_GONE_MODEL_SHARE * models.length) fatal(`${goneModels}/${models.length} model pages redirect to a category`)
      if (models.length && !read.rows.size && !read.unknown.size && !skipped.size) fatal('no units on any model page')
      enumerated = true

      if (opts.withPhotos) {
        // ⚠️ Photos are not a completeness signal: a unit page that fails keeps the card thumbnail.
        try {
          for (const row of read.rows.values()) {
            const got = await f.get(row.url)
            const pics = got.ok ? parseHoangHaGallery(got.html) : []
            if (pics.length) row.images = pics
          }
        } catch (e) {
          if (!(e instanceof StopRead) || e.why === 'deadline') throw e
          // the host stopped answering unit pages: the rest keep their thumbnails
        }
      }
    }
  } catch (e) {
    if (!(e instanceof StopRead)) throw e
    stopped = true
    if (!enumerated) read.log.fatal = true
    read.log.reason = e.why
  }

  read.skippedNew = skipped.size
  read.newSkus = new Set(skipped)
  const seen = read.rows.size + read.unknown.size
  const unreadable = seen ? read.unknown.size / seen : 0
  if (unreadable > MAX_FAILURE_RATE) read.log.reason ??= `${read.unknown.size}/${seen} unit cards would not parse`
  read.complete = !read.log.fatal && !stopped && unreadable <= MAX_FAILURE_RATE
  read.log.pages = f.pages
  read.log.failed = f.failed
  return read
}

// ── ShopDunk ────────────────────────────────────────────────────────────────────────────────────────

/** /may-cu → `<h2 class=title><a href=/iphone-cu-dep>` (minified, usually unquoted). */
export function parseShopDunkCategoryLinks(html: string): string[] {
  return unique([...html.matchAll(/<h2\s+class=["']?title["']?\s*>\s*<a\s+href=["']?(\/[A-Za-z0-9-]+)/g)].map((m) => m[1]))
}

/** Every ShopDunk category page — full, or past its end ("no-result") — carries the products container. */
export const isShopDunkListing = (html: string): boolean => /class=["']?products-container\b/.test(html)

export type ShopDunkCard = { sku: string; name: string; price: number; url: string; thumb: string | null }

/**
 * Category page → its product cards, the "Sản phẩm HOT" block included. MEASURED 2026-11-15 on
 * /iphone-cu-dep: the HOT block holds 4 cards and two of them (6776, 6780) are NOT in the grid, so it is
 * read too; page 2 is that same HOT block over an empty grid, which is where the walk ends.
 */
export function parseShopDunkCards(html: string): { sku: string; card: ShopDunkCard | null }[] {
  const starts = [...html.matchAll(/<div\b[^>]*\bclass=["']?product-item\b[^>]*>/g)]
  return starts.flatMap((m, i) => {
    const sku = attr(m[0], 'data-productid')
    if (!sku || !/^\d+$/.test(sku)) return []
    const body = html.slice(m.index! + m[0].length, starts[i + 1]?.index ?? undefined)
    const title = /<h3\b[^>]*\bclass=["']?product-title\b[^>]*>\s*(<a\b[^>]*>)([\s\S]*?)<\/a>/.exec(body)
    const href = title ? attr(title[1], 'href') : null
    const name = title ? text(title[2]) : ''
    const priceTag = elements(body, 'span').find(({ tag }) => { const c = classes(tag); return c.has('price') && c.has('actual-price') })
    const thumb = [...body.matchAll(/<img\b[^>]*>/g)].map((t) => attr(t[0], 'src')).find((s) => !!s && s.startsWith(`${SD_ORIGIN}/images/thumbs/`)) ?? null
    const ok = !!href && href.startsWith('/') && !!name
    return [{ sku, card: ok ? { sku, name, price: priceTag ? digits(text(priceTag.inner)) : 0, url: SD_ORIGIN + href, thumb } : null }]
  })
}

export type ShopDunkProduct = { name: string; price: number; availability: string; inStock: boolean; images: string[]; desc: string }

const SD_IN_STOCK = new Set(['InStock', 'LimitedAvailability', 'OnlineOnly', 'InStoreOnly'])

/**
 * Product page → the authoritative price and stock, or null when it is not product `sku`'s page.
 *
 * ⛔ WHAT SAYS "SOLD OUT" HERE — MEASURED 2026-11-15, 14 requests, truthful UA:
 *   - 5939 (listed in /iphone-cu-dep) and 6633, 6783, 7277 (used, in the sitemap and site search, NOT in
 *     the category) render IDENTICALLY: HTTP 200, microdata `availability` = http://schema.org/InStock,
 *     a visible "Mua ngay" add-to-cart button, the "Sắp về hàng" subscribe block hidden (`d-none`).
 *   - The `outstock` / `tbhethang` / "Sản phẩm tạm hết" marker is on ALL FOUR pages: it is a JS template
 *     string that a click handler injects when an AJAX lookup finds no unit. It is not a stock signal.
 *   - The page's own stock check is dead code (`$(document).ready(function(){!0||checkProductAvailablity()})`),
 *     and /Product/LoadOldProductDetail returns an empty unit list for listed and unlisted alike.
 *   - The one sold-out product found (/iphone-11, tagged `het_hang.png` in site search) answers
 *     `302 Location: /page-not-found` — which the fetcher counts as a FAILED page (→ `unknown`), not a sale.
 * So the page carries no out-of-stock signal for a product it still renders. `inStock` follows the
 * microdata (OutOfStock and the other non-sellable values are honoured if they ever appear); the real
 * "gone" signal is the category listing — a product it stops showing drops out of `rows` and `unknown`,
 * which the nightly job may act on only when the read is complete.
 * ⚠️ Microdata missing = not a page we understand → null (retried, then `unknown`).
 */
export function parseShopDunkProduct(html: string, sku: string): ShopDunkProduct | null {
  if (!new RegExp(`data-productid=["']?${sku}(?:["'\\s>])`).test(html)) return null
  const offerAt = /itemtype=["']?https?:\/\/schema\.org\/Offer\b/.exec(html)
  const offer = offerAt ? sliceTo(html, offerAt.index, '</div>') : ''
  const meta = new Map<string, string>()
  for (const m of offer.matchAll(/<meta\b[^>]*>/g)) {
    const prop = attr(m[0], 'itemprop')
    const content = attr(m[0], 'content')
    if (prop && content !== null && !meta.has(prop)) meta.set(prop, content)
  }
  const availability = (meta.get('availability') ?? '').split('/').pop() ?? ''
  if (!availability) return null
  let price = Math.round(Number(meta.get('price') ?? NaN))
  if (!(price > 0)) {
    const span = new RegExp(`<span\\b[^>]*\\bid=["']?price-value-${sku}\\b[^>]*>([\\s\\S]*?)</span>`).exec(html)
    price = span ? digits(text(span[1])) : 0
  }
  if (!(price > 0)) return null
  const nameEl = elements(html, 'span').find(({ tag }) => classes(tag).has('main-name'))
  const specs: string[] = []
  const box = html.indexOf('product-specs-box')
  if (box >= 0) {
    const table = sliceTo(html, box, '</table>')
    for (const row of table.matchAll(/<td\b[^>]*\bclass=["']?spec-name["']?[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*\bclass=["']?spec-value["']?[^>]*>([\s\S]*?)<\/td>/g)) {
      const k = text(row[1])
      const v = text(row[2])
      if (k && v) specs.push(`${k}: ${v}`)
    }
  }
  return {
    name: nameEl ? text(nameEl.inner) : '',
    price,
    availability,
    inStock: SD_IN_STOCK.has(availability),
    images: parseShopDunkGallery(html),
    desc: specs.join('\n'),
  }
}

/**
 * Product page → gallery photos `…/images/thumbs/<n>_<slug>[_<size>].<ext>`, one per image number, the
 * largest size present (no size suffix = the full-size original: MEASURED 447 KB against 219 KB for
 * `_550`), in order, ≤5. Only the gallery: the page header carries other products' `_240` menu images.
 */
export function parseShopDunkGallery(html: string): string[] {
  const start = /class=(?:"gallery"|gallery[\s>])/.exec(html)
  if (!start) return []
  const rest = html.slice(start.index)
  const end = /class=(?:"overview"|overview[\s>])/.exec(rest)
  const segment = end ? rest.slice(0, end.index) : rest
  const best = new Map<string, { url: string; size: number }>()
  for (const m of segment.matchAll(/https:\/\/shopdunk\.com\/images\/thumbs\/(\d+)_[A-Za-z0-9-]+?(?:_(\d+))?\.(?:png|jpe?g|webp)(?![A-Za-z0-9])/g)) {
    const size = m[2] ? Number(m[2]) : Infinity
    const had = best.get(m[1])
    if (!had || size > had.size) best.set(m[1], { url: m[0], size }) // Map keeps first-seen order
  }
  return [...best.values()].map((b) => b.url).slice(0, MAX_IMAGES)
}

/**
 * ShopDunk's used catalogue, ONE ROW PER PRODUCT id: /may-cu → categories (?pagenumber=N) → cards →
 * EVERY product page (authoritative price + stock). ~214 products measured 2026-11-14.
 * ⛔ A product page that fails after retries puts its sku in `unknown`; more than 2% of them makes the read
 * incomplete. Any category page failing is fatal.
 */
export async function readShopDunkUsed(opts: CrawlOpts): Promise<CrawlRead> {
  const f = new Fetcher(opts)
  const read = emptyRead()
  const cards = new Map<string, ShopDunkCard>()
  const badCards = new Set<string>()
  const skipped = new Set<string>()
  const fatal = (reason: string) => { read.log.fatal = true; read.log.reason ??= reason }
  let productPages = 0
  let productFailures = 0
  let enumerated = false
  let stopped = false

  const addCards = (html: string) => {
    for (const { sku, card } of parseShopDunkCards(html)) {
      if (cards.has(sku) || skipped.has(sku)) continue // in two categories: first wins
      if (!card) { badCards.add(sku); continue }
      badCards.delete(sku)
      if (isNewGoodsTitle(card.name)) { skipped.add(sku); continue }
      cards.set(sku, card)
    }
  }

  try {
    const index = await f.get(`${SD_ORIGIN}/may-cu`, (h) => parseShopDunkCategoryLinks(h).length > 0)
    if (!index.ok) fatal(`index: ${index.reason}`)
    else {
      for (const cat of parseShopDunkCategoryLinks(index.html)) {
        const why = await walk(f, cat, (n) => `${SD_ORIGIN}${cat}?pagenumber=${n}`, isShopDunkListing,
          (h) => parseShopDunkCards(h).map((c) => c.sku), addCards)
        if (why) fatal(why)
      }
      if (!cards.size && !badCards.size && !skipped.size) fatal('no products on any category page')
      enumerated = true
      for (const sku of badCards) { productPages++; productFailures++; read.unknown.add(sku) }
      for (const [sku, card] of cards) {
        productPages++
        const parsed: { p: ShopDunkProduct | null } = { p: null }
        const got = await f.get(card.url, (h) => (parsed.p = parseShopDunkProduct(h, sku)) !== null)
        const p = parsed.p
        if (!got.ok || !p) { productFailures++; read.unknown.add(sku); continue }
        const name = p.name || card.name
        if (isNewGoodsTitle(name)) { skipped.add(sku); continue }
        read.rows.set(sku, {
          sku, name, price: p.price, url: card.url, inStock: p.inStock,
          images: opts.withPhotos && p.images.length ? p.images : card.thumb ? [card.thumb] : [],
          desc: p.desc,
        })
      }
    }
  } catch (e) {
    if (!(e instanceof StopRead)) throw e
    stopped = true
    if (!enumerated) read.log.fatal = true
    read.log.reason = e.why
    // ⛔ Seen but not read is UNKNOWN, never gone.
    for (const sku of [...cards.keys(), ...badCards]) if (!read.rows.has(sku) && !skipped.has(sku)) read.unknown.add(sku)
  }

  read.skippedNew = skipped.size
  read.newSkus = new Set(skipped)
  const rate = productPages ? productFailures / productPages : 0
  if (rate > MAX_FAILURE_RATE) read.log.reason ??= `${productFailures}/${productPages} product pages failed`
  read.complete = !read.log.fatal && !stopped && rate <= MAX_FAILURE_RATE
  read.log.pages = f.pages
  read.log.failed = f.failed
  return read
}
