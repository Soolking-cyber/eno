/**
 * muaban.net rentals → eno REFERENCE-LISTING rows. THE PURE HALF of scripts/import-muaban-net.ts.
 *
 * ⚠️ NO NETWORK, NO DATABASE, NO ENV, NO sharp IN THIS FILE, AND THAT IS WHY IT IS A SEPARATE FILE.
 * The importer does `import 'dotenv/config'` and builds a Prisma client; a unit test that imported
 * it would load the production `.env` into the test process (vitest.config.ts explains why that
 * makes local and CI disagree). Everything a test needs to pin — argument parsing, price, area,
 * bedrooms, location, the outbound URL, the image allowlist and verdicts, the robots check, the PII
 * strip, the stage re-read, the seller refusal and the liveness verdict — lives here instead.
 *
 * SOURCE SHAPE (read 2026-09-24 from https://muaban.net/bat-dong-san/cho-thue-nha-dat and one
 * detail page): muaban.net is a server-rendered Next.js site. Category pages embed
 * `__NEXT_DATA__.props.pageProps.classified.items[]` (20 per page) and detail pages embed the full
 * record at `…pageProps.classified`. robots.txt allows `/` and disallows only `/dashboard/` and
 * `/8zr2/` (https://muaban.net/robots.txt). A missing ad answers HTTP 404 with
 * `pageProps.notFound` (measured on /bat-dong-san/cho-thue-can-ho-ho-chi-minh/x-id1, 2026-09-24).
 */
import vnUnits from '../src/data/vn-units.json'
import { buildSearchText } from '../src/lib/fold'
import { localizeImportText, type MissingSegment } from '../src/lib/import-i18n'
import { browseRankScore } from '../src/lib/ranking-formula'
import { listingMoneyFor, roomAttributes } from '../src/lib/taxonomy'

/**
 * ⛔ PINNED BY ID, NEVER LOOKED UP BY NAME. `Seller.name` has no unique constraint and is user
 * settable (`api/profile/account-type`), so a name lookup could attach every imported row to a real
 * person's shop, who would then receive the enquiries. Same rule as import-rever-rentals.ts:43-52.
 * The id follows the Batdongsan import's shape (`bds-vn-import-seller-0001`).
 */
export const SELLER_ID = 'muaban-net-import-seller-0001'
/** ⚠️ ALSO THE CTA TEXT: the PDP renders "Rent on <seller.name>" for an affiliate row. */
export const SELLER_NAME = 'Muaban.net'
/**
 * The wordmark muaban.net serves itself (HTTP 200 image/svg+xml, 281x40 viewBox, last-modified
 * 2026-01-06). ⚠️ It is the TẾT variant (apricot blossoms, a conical hat over the "m"). A plain,
 * non-seasonal mark is UNVERIFIED. This importer never uploads it: set-partner-avatar.ts owns logos.
 */
export const SELLER_LOGO_URL = 'https://muaban.net/logo/muaban.svg'
export const ORIGIN = 'https://muaban.net'
export const EXTERNAL_PREFIX = 'muaban'
/** muaban's own transaction id for "Cho thuê" (filterConfig field `subcategory_id`: 46). */
export const RENT_SUBCATEGORY_ID = 46
/** Owner precedent (partner-fetch.ts MAX_IMAGES): five photos per row keeps uploads bounded. */
export const MAX_IMAGES = 5
/**
 * ⛔ THE ONLY HOSTS THIS IMPORTER WILL EVER CONNECT TO, redirects included. `fetch` follows a 30x on
 * its own, so pinning the FIRST url (IMAGE_RE, affiliateUrlFor) is not enough: a photo host that
 * answered `302 Location: http://169.254.169.254/` would be followed from our machine. The importer
 * follows redirects by hand and checks every hop against this set.
 */
export const ALLOWED_HOSTS = new Set(['muaban.net', 'cloud.muaban.net'])

/**
 * The rent unit, taken from the ONE place the app decides it (taxonomy.ts listingMoneyFor), so a
 * card renders "/ month" (price.tsx strips 'VND/' and shows the rest). The first cut wrote the bare
 * 'VND', which renders NO suffix — a monthly rent that reads like a purchase price, and a grid that
 * mixes both styles next to Honeycomb's rows.
 */
export const RENT_PRICE_UNIT = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent' }).priceUnit

// ─── Cities ──────────────────────────────────────────────────────────────────────────────────

export type CityKey = 'hcm' | 'hn' | 'dn'
type VnProvince = { code: string; name: string; nameEn: string }
const PROVINCES = vnUnits as VnProvince[]
function province(code: string): VnProvince {
  const p = PROVINCES.find((x) => x.code === code)
  if (!p) throw new Error(`vn-units.json has no province ${code}`)
  return p
}

/**
 * ⛔ `city` IS THE vn-units VIETNAMESE `name` — 'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng' — ONE SPELLING PER
 * CITY (owner/lead decision, 2026-09-24). It is what the post wizard stores and what the ~98,000
 * existing rows say, so anything that groups by `city` (facet counts, district pages, admin
 * reports) sees one HCMC, not two. The province filter sends the English `nameEn` and matches BOTH
 * spellings against `city` (src/lib/province-match.ts), so these rows are still found by it.
 * The first cut stored `nameEn` ('Ho Chi Minh'), which the filter found but which minted a second
 * spelling of each city beside the 98,000 wizard/Batdongsan/Rever rows.
 * `city` is also the city part of the human-readable `location` and of the title outside HCMC.
 * `cityEn` is the English exonym, only for `searchText` ("hanoi").
 */
export const CITIES: Record<CityKey, { sourceId: number; slug: string; provinceCode: string; city: string; cityEn: string }> = {
  hcm: { sourceId: 30, slug: 'ho-chi-minh', provinceCode: '79', city: province('79').name, cityEn: 'Ho Chi Minh City' },
  hn: { sourceId: 24, slug: 'ha-noi', provinceCode: '01', city: province('01').name, cityEn: 'Hanoi' },
  dn: { sourceId: 15, slug: 'da-nang', provinceCode: '48', city: province('48').name, cityEn: 'Da Nang' },
}
const CITY_ALIASES: Record<string, CityKey> = {
  hcm: 'hcm', 'ho-chi-minh': 'hcm', hcmc: 'hcm', saigon: 'hcm',
  hn: 'hn', 'ha-noi': 'hn', hanoi: 'hn',
  dn: 'dn', 'da-nang': 'dn', danang: 'dn',
}

/**
 * muaban `property_type` → eno subcategory. The list slug is muaban's own URL for "rentals of this
 * type" (quicklink.category on the rentals page); `-<city slug>` narrows it to one city.
 * ⚠️ Warehouse/land maps to NULL on purpose, like import-batdongsan-rentals.ts: a null subcategory
 * is honest, forcing it into office-rental would put land plots under the shopfront filter. It is
 * also OFF by default (DEFAULT_TYPES) for the same reason.
 * ⚠️ 'Căn hộ dịch vụ, mini' (subtype 2531, under 2812) stays apartment-rental rather than
 * homestay-serviced — the rule every property importer follows: the area and bedroom facets only
 * exist on the four home/office subcategories (taxonomy.ts), and homestay sits next to hotels.
 */
export const PROPERTY_TYPES: Record<number, { key: string; listSlug: string; subcat: string | null; en: string; vi: string }> = {
  2812: { key: 'apartment', listSlug: 'cho-thue-can-ho', subcat: 'apartment-rental', en: 'Apartment', vi: 'Căn hộ' },
  2811: { key: 'house', listSlug: 'cho-thue-nha', subcat: 'house-rental', en: 'House', vi: 'Nhà' },
  1614: { key: 'room', listSlug: 'cho-thue-nha-tro-phong-tro', subcat: 'room-rental', en: 'Room', vi: 'Phòng trọ' },
  2814: { key: 'office', listSlug: 'cho-thue-van-phong-mat-bang', subcat: 'office-rental', en: 'Office / shopfront', vi: 'Văn phòng, mặt bằng' },
  2815: { key: 'warehouse', listSlug: 'cho-thue-nha-xuong-kho-dat', subcat: null, en: 'Warehouse / land', vi: 'Nhà xưởng, kho, đất' },
}
export const DEFAULT_TYPES = [2812, 2811, 1614, 2814]

export function parseCities(arg: string | null): CityKey[] {
  if (!arg) return ['hcm', 'hn', 'dn']
  const out: CityKey[] = []
  for (const raw of arg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const k = CITY_ALIASES[raw]
    if (!k) throw new Error(`--city: unknown city "${raw}" (use hcm, hn, dn)`)
    if (!out.includes(k)) out.push(k)
  }
  return out
}

export function parseTypes(arg: string | null): number[] {
  if (!arg) return [...DEFAULT_TYPES]
  const byKey = new Map(Object.entries(PROPERTY_TYPES).map(([id, t]) => [t.key, Number(id)]))
  const out: number[] = []
  for (const raw of arg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const id = byKey.get(raw)
    if (id === undefined) throw new Error(`--types: unknown type "${raw}" (use ${[...byKey.keys()].join(', ')})`)
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * `--cap hcm=3000,hn=1000,dn=1000` → per-city ceilings on KEPT rows. ⛔ A malformed cap THROWS; it
 * never falls back to "no cap", because the cap is what keeps a first wave small.
 */
export function parseCaps(arg: string | null): Partial<Record<CityKey, number>> {
  const out: Partial<Record<CityKey, number>> = {}
  if (!arg) return out
  for (const part of arg.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z-]+)=(\d+)$/i.exec(part)
    const k = m ? CITY_ALIASES[m[1].toLowerCase()] : undefined
    if (!m || !k) throw new Error(`--cap: "${part}" is not <city>=<positive integer> (cities: hcm, hn, dn)`)
    const n = Number(m[2])
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--cap: "${part}" must be a positive integer`)
    out[k] = n
  }
  return out
}

/**
 * A numeric flag. ⛔ FINITE OR THE DEFAULT, THEN CLAMPED. The first cut did
 * `Math.max(1000, Number(x))`, and `Math.max(1000, NaN)` is NaN — so a typo like `--delay-ms 1500ms`
 * made every politeness wait `NaN`, which `setTimeout` treats as 0: no delay at all, image fetches
 * at --apply included. `Infinity` is not finite either, so it also falls back.
 */
export function numArg(raw: string | null, def: number, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw)
  let v = Number.isFinite(n) ? n : def
  if (opts.integer) v = Math.floor(v)
  if (opts.min !== undefined) v = Math.max(opts.min, v)
  if (opts.max !== undefined) v = Math.min(opts.max, v)
  return v
}

/** ⛔ Never faster than this per host, whatever `--delay-ms` says (the run's politeness floor). */
export const MIN_DELAY_MS = 1200
export const DEFAULT_DELAY_MS = 1500
export const DEFAULT_MAX_PAGES = 100

export type RunArgs = {
  apply: boolean
  retire: boolean
  src: string | null
  stage: string | null
  journalDir: string | null
  cities: CityKey[]
  types: number[]
  caps: Partial<Record<CityKey, number>>
  limit: number
  maxPages: number
  delayMs: number
  probeImages: boolean
  listOnly: boolean
  forceMassRetire: boolean
}

/**
 * The whole command line, parsed in one tested place. The importer calls exactly this, so the
 * NaN guards above are the ones that run. `--limit` is the exception to "fall back to the default":
 * its default is "no limit", so a typo THROWS instead of silently importing everything.
 */
export function parseRunArgs(argv: string[]): RunArgs {
  const flag = (k: string) => argv.includes(k)
  const arg = (k: string): string | null => {
    const i = argv.indexOf(k)
    return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
  }
  /** ⛔ A valued flag with no value is refused, not read as "unset": `--limit --apply` used to mean
   *  "no limit" and `--cap --city hcm` "no cap" — the opposite of what was typed. */
  for (const k of ['--limit', '--src', '--stage', '--journal', '--city', '--types', '--cap', '--max-pages', '--delay-ms']) {
    if (argv.includes(k) && arg(k) === null) throw new Error(`${k} needs a value`)
  }
  const rawLimit = arg('--limit')
  const limit = rawLimit === null ? 0 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error(`--limit must be a non-negative integer (got "${rawLimit}")`)
  return {
    apply: flag('--apply'),
    retire: flag('--retire'),
    src: arg('--src'),
    stage: arg('--stage'),
    journalDir: arg('--journal'),
    cities: parseCities(arg('--city')),
    types: parseTypes(arg('--types')),
    caps: parseCaps(arg('--cap')),
    limit,
    maxPages: numArg(arg('--max-pages'), DEFAULT_MAX_PAGES, { min: 1, max: 1000, integer: true }),
    delayMs: numArg(arg('--delay-ms'), DEFAULT_DELAY_MS, { min: MIN_DELAY_MS, max: 60_000 }),
    probeImages: flag('--probe-images'),
    listOnly: flag('--list-only'),
    forceMassRetire: flag('--force-mass-retire'),
  }
}

/**
 * The run modes that are allowed together. Returned as a refusal string so the importer can stop
 * BEFORE it touches the network, the database or the journal dir.
 */
export function modeRefusal(a: RunArgs): string | null {
  if (a.retire && (a.src || a.stage)) return '--retire is its own pass: it reads the live rows of this seller, not a stage (drop --src/--stage)'
  if (a.apply && !a.retire && !a.src) return '--apply only imports a REVIEWED stage: run a dry run with --stage <file>, read it, then --src <file> --journal <dir> --apply'
  if (a.apply && a.stage) return '--stage is for live dry runs; --apply reads --src'
  if (a.src && a.stage) return '--src already is a staged file; --stage is for a live crawl'
  if (a.apply && !a.journalDir) return '--apply needs --journal <durable dir> (not /tmp: macOS clears it on reboot)'
  return null
}

/**
 * `--journal` must survive a reboot: macOS clears /tmp and the per-user temp dirs, and the journal
 * is the only record of which rows and uploads a run made (the rollback reads it).
 * `dir` and `tmpRoots` must already be absolute and resolved (the importer does that).
 */
export function journalDirProblem(dir: string, tmpRoots: string[]): string | null {
  for (const root of tmpRoots) {
    const r = root.replace(/\/+$/, '')
    if (dir === r || dir.startsWith(r + '/')) return `--journal ${dir} is under ${r}, which the OS clears; use a durable directory`
  }
  return null
}

/**
 * The city × type list URL, in muaban's own "Mới nhất" (newest) order: `sort=1` (filterConfig
 * field `sort`: 0 default, 1 newest, 2/3 price). Measured 2026-09-24: with sort=1 the page echoes
 * `filterResult.filters.sort = {id: 1}` and orders by `publish_at` descending after a few pinned
 * ads; the crawler checks that echo so a silently ignored sort cannot pass for "newest".
 */
export function listPageUrl(type: number, city: CityKey, page: number): string {
  const t = PROPERTY_TYPES[type]
  if (!t) throw new Error(`unknown property type ${type}`)
  return `${ORIGIN}/bat-dong-san/${t.listSlug}-${CITIES[city].slug}?sort=1${page > 1 ? `&page=${page}` : ''}`
}

// ─── Page parsing ────────────────────────────────────────────────────────────────────────────

/** The `__NEXT_DATA__` JSON of a server-rendered page, or null when the page has none. */
export function parseNextData(html: string): any | null {
  const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

/**
 * ⛔ A BOT CHALLENGE ENDS THE RUN; IT IS NEVER SOLVED OR WORKED AROUND. Normal muaban pages DO carry
 * Cloudflare's passive `challenge-platform/scripts/jsd/main.js`, so that string alone is not a
 * challenge (it is on every page measured). The interstitial is the "Just a moment…" title, a
 * `cf-chl-` token, or Cloudflare's own `cf-mitigated: challenge` header.
 */
export function isChallenge(status: number, html: string, cfMitigated: string | null): boolean {
  if (cfMitigated && /challenge/i.test(cfMitigated)) return true
  if (/<title>\s*Just a moment/i.test(html)) return true
  if (/cf-chl-/i.test(html)) return true
  return (status === 403 || status === 503) && /cloudflare/i.test(html)
}

/**
 * robots.txt check for the paths this importer fetches: the `*` group (and a group naming our own
 * token), longest match wins, Allow wins a tie. Deliberately small: muaban's file is four lines.
 */
export function robotsAllows(robotsTxt: string, path: string, agentToken = 'eno-property-import'): boolean {
  type Rule = { allow: boolean; prefix: string }
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let cur: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase(), val = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur) }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && val === '') continue // "Disallow:" with no path allows everything
      cur.rules.push({ allow: key === 'allow', prefix: val })
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agentToken.toLowerCase().includes(a)))
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules)
  let best: Rule | null = null
  for (const r of rules) {
    const prefix = r.prefix.replace(/\*$/, '')
    if (!path.startsWith(prefix)) continue
    if (!best || prefix.length > best.prefix.length || (prefix.length === best.prefix.length && r.allow)) {
      best = { allow: r.allow, prefix }
    }
  }
  return best ? best.allow : true
}

/**
 * What a robots.txt ANSWER means (RFC 9309 §2.3.1): 200 → its rules; a 4xx → no file, crawl
 * allowed; anything else (5xx, network error) → unreachable, crawl DISALLOWED. Returns the rules
 * text to apply ('' = allow everything) or null = do not crawl this host.
 */
export function robotsRules(status: number, body: string): string | null {
  if (status === 200) return body
  if (status >= 400 && status < 500) return ''
  return null
}

// ─── Source records, and the PII strip that happens BEFORE anything touches disk ─────────────

export type MuabanListItem = {
  id: number
  url: string
  city_id: number
  district_id?: number
  subcategory_id: number
  property_type: number
  property_subtype?: number
  category_name?: string
  covers?: string[]
  total_images?: number
  price: number
  price_display?: string
  location?: string
  attributes?: { value: string }[]
  locations_display?: { id: number; name: string }[]
  publish_at?: string
  is_expired?: boolean
}

export type MuabanDetail = {
  id: number
  url: string
  city_id?: number
  district_id?: number
  ward_id?: number
  subcategory_id?: number
  property_type?: number
  price?: number
  price_display?: string
  images?: { url: string }[]
  attributes?: { value: string }[]
  parameters?: { label: string; value: string }[]
  lat_lng?: string
  location?: string
  is_expired?: boolean
  is_outdate?: boolean
  publish?: boolean
  created_at?: string
}

/** One examined listing as staged to disk by a live run, and as read back by `--src`. */
export type StagedRecord = {
  v: 1
  fetchedAt: string
  seed: { city: CityKey; type: number }
  item: MuabanListItem
  detail: MuabanDetail | null
  detailStatus: number | null
}

/**
 * Parameter labels worth keeping. ⚠️ AN ALLOWLIST, NOT A DENYLIST: a label muaban adds tomorrow is
 * dropped until someone decides it is safe, rather than staged because nobody said otherwise.
 */
const PARAM_KEEP = /^(Loại hình bất động sản|Diện tích|Tổng số tầng|Số tầng|Số phòng ngủ|Số phòng vệ sinh|Số phòng tắm|Hướng)/i

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const attrs = (v: unknown): { value: string }[] | undefined =>
  Array.isArray(v) ? v.filter((a) => a && typeof a.value === 'string').map((a) => ({ value: String(a.value) })) : undefined

// ─── Administrative place names (and the house-number guard) ─────────────────────────────────

/** A place name: letters (any script, with their combining marks), spaces, and . ' ’ - — NO DIGITS. */
const NAME = "[\\p{L}][\\p{L}\\p{M} .'’-]*"
const WARD_STRICT = new RegExp(`^(?:Phường|Xã|Thị trấn|P\\.)\\s*(?:\\d{1,2}|${NAME})$`, 'u')
const DISTRICT_STRICT = new RegExp(
  `^(?:(?:Quận|Q\\.)\\s*(?:\\d{1,2}|${NAME})|(?:Huyện|Thị xã|Thành phố|TP\\.?)\\s*${NAME}(?:\\s*-\\s*Quận\\s*(?:\\d{1,2}|${NAME}))?)$`,
  'u',
)
/** The city itself, as it appears at the end of a `location` string ('TP.HCM', 'Hà Nội'). */
const CITY_PART_RE = /^(TP\.?\s*|Thành phố\s+)?(HCM|Hồ Chí Minh|Hà Nội|Đà Nẵng)$/iu
const WARD_RE = /^(Phường|Xã|Thị trấn|P\.)\s*/iu
const DISTRICT_RE = /^(Quận|Q\.|Huyện|Thị xã|Thành phố|TP\.?)\s*/iu

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()

/**
 * ⛔ IS THIS COMMA-PART A WARD, A DISTRICT OR THE CITY — AND NOTHING ELSE? A street address
 * ("867 Lũy Bán Bích", "Số 12 Nguyễn Trãi", "12/3 hẻm 45") fails, because a place name here may
 * carry at most a ONE- OR TWO-DIGIT ward/district number and only after its administrative prefix.
 * This is the guard that keeps a house number out of `location` (the rule every property importer
 * follows: never publish a house or street number).
 */
export function isAdminPart(part: string): boolean {
  const p = clean(part)
  return WARD_STRICT.test(p) || DISTRICT_STRICT.test(p) || CITY_PART_RE.test(p)
}

/** A comma-separated place string reduced to its administrative parts. undefined when none remain. */
export function adminOnly(location: string | undefined): string | undefined {
  if (location === undefined) return undefined
  const parts = location.split(',').map(clean).filter((p) => p && isAdminPart(p))
  return parts.length ? parts.join(', ') : undefined
}

/**
 * The ward in the house form ('Phường 15', 'Phường Tân Thành', 'Xã Tân Tạo'). 'P.' is expanded and a
 * zero-padded number ('Phường 01') is unpadded. null when it is not a ward.
 */
export function canonicalWard(raw: string): string | null {
  const s = clean(raw)
  if (!WARD_STRICT.test(s)) return null
  const n = /^(?:Phường|P\.)\s*0*(\d{1,2})$/iu.exec(s)
  if (n) return `Phường ${Number(n[1])}`
  return s.replace(/^P\.\s*/u, 'Phường ')
}

/**
 * The district in the forms live rentals already use (prod, 2026-09-24: 'Quận Bình Thạnh' 1,855,
 * 'TP. Thủ Đức' 707, 'Quận 2' …). Every HCMC value substring-matches its explorer chip
 * (listings-explorer.constants.ts DISTRICTS[].match): 'Quận Tân Phú' ⊃ 'Tân Phú', 'TP. Thủ Đức' ⊃
 * 'Thủ Đức'. muaban writes Thủ Đức as 'TP. Thủ Đức - Quận 9' / '- Quận 2'; those collapse to the one
 * stored form 'TP. Thủ Đức' instead of minting a third spelling (and a third district landing page).
 * null when it is not a district.
 */
export function canonicalDistrict(raw: string): string | null {
  const s = clean(raw)
  if (!DISTRICT_STRICT.test(s)) return null
  if (/^(?:TP\.?|Thành phố|Quận)\s*Thủ Đức(?:\s*-.*)?$/iu.test(s)) return 'TP. Thủ Đức'
  const n = /^(?:Quận|Q\.)\s*0*(\d{1,2})$/iu.exec(s)
  if (n) return `Quận ${Number(n[1])}`
  const q = /^Q\.\s*(.+)$/u.exec(s)
  if (q) return `Quận ${q[1]}`
  const tp = /^(?:Thành phố|TP\.?)\s*(.+)$/u.exec(s)
  if (tp) return `TP. ${tp[1]}`
  return s
}

/**
 * ⛔ THE PII STRIP. A list item carries `phone_display` ('090 288 ****'), `phone_enc`, `user_id`,
 * a free-text `title` and `summary`; a detail page adds `contact_name` ('Chị Vân'), the full `body`
 * and a street `address` with the house number. NONE of it is needed to publish a facts-only row,
 * and all of it is personal data under Decree 13/2023 the moment it identifies a landlord. So the
 * staged file is built from an ALLOWLIST of fields and never holds them — a reviewer reading
 * `--stage` output cannot leak what was never written. Even the `location` strings are reduced to
 * ward/district/city parts, so a poster who typed a street address there does not stage it, and the
 * `url` is reduced to the id-only link (affiliateUrlFor): the canonical URL's last segment IS the
 * free-text title, slugified ('172-cho-thue-nha-…-trung-nu-vuong' = a house number and street).
 */
export function stageItem(raw: any): MuabanListItem {
  return {
    id: Number(raw?.id),
    url: affiliateUrlFor(raw?.id, raw?.url) ?? '',
    city_id: Number(raw?.city_id),
    district_id: num(raw?.district_id),
    subcategory_id: Number(raw?.subcategory_id),
    property_type: Number(raw?.property_type),
    property_subtype: num(raw?.property_subtype),
    category_name: str(raw?.category_name),
    covers: Array.isArray(raw?.covers) ? raw.covers.filter((u: unknown) => typeof u === 'string') : undefined,
    total_images: num(raw?.total_images),
    price: Number(raw?.price),
    price_display: str(raw?.price_display),
    location: adminOnly(str(raw?.location)),
    attributes: attrs(raw?.attributes),
    locations_display: Array.isArray(raw?.locations_display)
      ? raw.locations_display
        .filter((l: any) => l && typeof l.name === 'string' && isAdminPart(l.name))
        .map((l: any) => ({ id: Number(l.id), name: clean(String(l.name)) }))
      : undefined,
    publish_at: str(raw?.publish_at),
    is_expired: bool(raw?.is_expired),
  }
}

export function stageDetail(raw: any): MuabanDetail {
  return {
    id: Number(raw?.id),
    url: affiliateUrlFor(raw?.id, raw?.url) ?? '',
    city_id: num(raw?.city_id),
    district_id: num(raw?.district_id),
    ward_id: num(raw?.ward_id),
    subcategory_id: num(raw?.subcategory_id),
    property_type: num(raw?.property_type),
    price: num(raw?.price),
    price_display: str(raw?.price_display),
    images: Array.isArray(raw?.images)
      ? raw.images.filter((i: any) => i && typeof i.url === 'string').map((i: any) => ({ url: String(i.url) }))
      : undefined,
    attributes: attrs(raw?.attributes),
    parameters: Array.isArray(raw?.parameters)
      ? raw.parameters
        .filter((p: any) => p && !p.group && typeof p.label === 'string' && typeof p.value === 'string' && PARAM_KEEP.test(p.label))
        .map((p: any) => ({ label: String(p.label), value: String(p.value) }))
      : undefined,
    lat_lng: str(raw?.lat_lng),
    location: adminOnly(str(raw?.location)),
    is_expired: bool(raw?.is_expired),
    is_outdate: bool(raw?.is_outdate),
    publish: bool(raw?.publish),
    created_at: str(raw?.created_at),
  }
}

/**
 * ⛔ A `--src` LINE IS UNTRUSTED UNTIL IT HAS BEEN THROUGH THE ALLOWLIST AGAIN. The stage file is a
 * plain JSONL on disk: it can be hand-edited, produced by an older build of this script, or be a
 * different source's file altogether. Reading it with a bare `JSON.parse` (the first cut) handed
 * whatever it held — a phone number, a contact name, an unknown field — straight to the mapper.
 * Every record is rebuilt through stageItem()/stageDetail(), and a record that is not a v1 muaban
 * record throws with its line number: one bad line refuses the whole file (fail closed).
 */
export function restageRecord(raw: unknown, line: number): StagedRecord {
  const r = raw as any
  if (!r || typeof r !== 'object' || r.v !== 1) throw new Error(`stage line ${line}: not a v1 muaban record`)
  if (typeof r.fetchedAt !== 'string') throw new Error(`stage line ${line}: no fetchedAt`)
  const city = r.seed?.city
  const type = Number(r.seed?.type)
  if (typeof city !== 'string' || !Object.hasOwn(CITIES, city) || !PROPERTY_TYPES[type]) {
    throw new Error(`stage line ${line}: unknown seed ${JSON.stringify(r.seed)}`)
  }
  const item = stageItem(r.item)
  if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error(`stage line ${line}: item has no numeric id`)
  const detail = r.detail === null || r.detail === undefined ? null : stageDetail(r.detail)
  const detailStatus = Number.isInteger(r.detailStatus) ? Number(r.detailStatus) : null
  return { v: 1, fetchedAt: r.fetchedAt, seed: { city: city as CityKey, type }, item, detail, detailStatus }
}

/** A whole JSONL stage → allowlisted records. Throws on the first unreadable line. */
export function parseStage(text: string): StagedRecord[] {
  const out: StagedRecord[] = []
  text.split('\n').forEach((l, i) => {
    if (!l.trim()) return
    let raw: unknown
    try { raw = JSON.parse(l) } catch { throw new Error(`stage line ${i + 1}: not JSON`) }
    out.push(restageRecord(raw, i + 1))
  })
  return out
}

// ─── Field parsers ───────────────────────────────────────────────────────────────────────────

/**
 * A Vietnamese-formatted number. ⛔ THE THOUSANDS DOT: '2.550' is two thousand five hundred and
 * fifty (a real card on the rentals page, measured), while '4.5' and '4,5' are four and a half.
 * Only GROUPS OF THREE after a dot mean thousands — the rule import-batdongsan-rentals.ts:67-85
 * learned after 701 rows came out 1000x too small.
 */
export function parseViNumber(t: string): number | null {
  const s = t.trim()
  if (!/^\d[\d.,]*$/.test(s)) return null
  /** ⚠️ A COMMA IS ALWAYS THE DECIMAL MARK here ('4,3 triệu'); muaban never groups with commas on
   *  the pages measured, so '25,000,000' is refused (NaN → null) rather than guessed at. */
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)
    ? Number(s.replace(/\./g, '').replace(',', '.'))
    : Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Area in m² from a card attribute such as '89 m²' or '2.550 m²'. null, never 0, when absent. */
export function parseAreaM2(raw: unknown): number | null {
  const m = /(\d[\d.,]*)\s*m(?:²|2)(?!\d)/i.exec(String(raw ?? ''))
  if (!m) return null
  const n = parseViNumber(m[1])
  return n !== null && n > 0 ? n : null
}

/**
 * The amount in `price_display` ('20 triệu/tháng', '4,3 triệu/tháng', '25.000.000 đ/tháng'), in VND.
 * null when it is not an amount at all ('Thỏa thuận' = negotiable, no figure).
 */
export function parseDisplayVnd(display: unknown): number | null {
  const m = /([\d][\d.,]*)\s*(tỷ|triệu|tr|nghìn|ngàn|k|đồng|đ|vnđ|vnd)?/i.exec(String(display ?? ''))
  if (!m) return null
  const n = parseViNumber(m[1])
  if (n === null) return null
  const unit = (m[2] ?? '').toLowerCase()
  const mult = unit === 'tỷ' ? 1e9 : unit === 'triệu' || unit === 'tr' ? 1e6 : ['nghìn', 'ngàn', 'k'].includes(unit) ? 1e3 : 1
  return Math.round(n * mult)
}

export type PriceDrop = 'noPrice' | 'perM2' | 'pricePeriod' | 'priceMismatch' | 'priceRange'

/**
 * ⛔ TWO INDEPENDENT SIGNALS MUST AGREE BEFORE A NUMBER BECOMES A MONTHLY RENT ON A PUBLIC CARD.
 * `price` is muaban's integer; `price_display` is the text it shows next to it. The row is kept
 * only when the display says per MONTH, does not say per m², and its own amount matches `price`
 * within 1%. Either field alone has already burned this repo: Batdongsan rows flagged lump-sum
 * whose text read "1,12 triệu/m²" (a 200 m² office at 1.12tr instead of 224tr), and the Rever
 * parser's '4.5 tr' → 45,000,000.
 */
export function priceDrop(price: unknown, display: unknown): PriceDrop | null {
  const d = String(display ?? '')
  if (!(typeof price === 'number' && Number.isFinite(price)) || price <= 0 || /thỏa thuận|thoả thuận|liên hệ/i.test(d)) return 'noPrice'
  /** Deliberately broad, like the Batdongsan guard: ANY '/m…' after the amount drops the row. */
  if (/\/\s*m/i.test(d)) return 'perM2'
  if (!/\/\s*tháng\s*$/i.test(d)) return 'pricePeriod'
  const shown = parseDisplayVnd(d)
  if (shown === null || Math.abs(shown - price) > price * 0.01) return 'priceMismatch'
  if (price < 1_000_000 || price > 2_000_000_000) return 'priceRange'
  return null
}

/** '5 PN' → 5 from the card attributes, else a 'Số phòng ngủ' parameter. null when absent. */
export function countFrom(attributes: { value: string }[] | undefined, parameters: { label: string; value: string }[] | undefined, what: 'bed' | 'bath'): number | null {
  const attrRe = what === 'bed' ? /^\s*(\d{1,2})\s*PN\s*$/i : /^\s*(\d{1,2})\s*(WC|VS)\s*$/i
  for (const a of attributes ?? []) {
    const m = attrRe.exec(a.value)
    if (m) return Number(m[1])
  }
  const labelRe = what === 'bed' ? /phòng ngủ/i : /(vệ sinh|phòng tắm|WC)/i
  for (const p of parameters ?? []) {
    if (!labelRe.test(p.label)) continue
    const m = /^\s*(\d{1,2})\b/.exec(p.value)
    if (m) return Number(m[1])
  }
  return null
}

/**
 * ⛔ A MISSING BEDROOM COUNT IS NOT A STUDIO. The facet reads '0' as "Studio"; `|| 0` would file
 * every office and shopfront under it (import-rever-rentals.ts:289-295 caught 446 of those).
 * Absent → null → no attribute. Counts are exact up to 5 and '6' means 6+ (taxonomy.ts
 * roomAttributes); the bathroom count rides along the same way. It used to clamp at '3'.
 */
export function bedroomsAttribute(beds: number | null, baths: number | null = null): string | null {
  return roomAttributes({ bedrooms: beds, bathrooms: baths })
}

/**
 * Ward and district from the structured `locations_display` (ward, district, city), falling back to
 * the comma-separated `location`. The city entry is recognised by its id, not its spelling —
 * 'TP.HCM' and 'Thành phố Thủ Đức' both start like a district. Both come back in their canonical
 * stored forms (canonicalWard / canonicalDistrict), or null.
 */
export function locationParts(item: Pick<MuabanListItem, 'locations_display' | 'location' | 'city_id'>): { ward: string | null; district: string | null } {
  let ward: string | null = null, district: string | null = null
  for (const l of item.locations_display ?? []) {
    if (l.id === item.city_id) continue
    if (!ward && WARD_RE.test(l.name)) ward = canonicalWard(l.name)
    else if (!district && DISTRICT_RE.test(l.name)) district = canonicalDistrict(l.name)
  }
  if (!ward || !district) {
    for (const part of String(item.location ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!ward && WARD_RE.test(part)) ward = canonicalWard(part)
      else if (!district && DISTRICT_RE.test(part) && !CITY_PART_RE.test(part)) district = canonicalDistrict(part)
    }
  }
  return { ward, district }
}

const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

/**
 * `lat_lng` ('10.77,106.70'), range-checked to Vietnam. ⛔ Never (0,0), never a string, never a
 * swapped pair: anything outside lat 8–24 / lng 102–110 is null, which draws no pin instead of a
 * pin in the Gulf of Guinea. It is empty on most rows measured.
 */
export function parseLatLng(raw: unknown): { lat: number; lng: number } | null {
  const parts = String(raw ?? '').split(/[,;\s]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const lat = Number(parts[0]), lng = Number(parts[1])
  return inRange(lat, 8, 24) && inRange(lng, 102, 110) ? { lat, lng } : null
}

/**
 * A muaban detail path: `/bat-dong-san/<muaban's category segment>/<poster's title slug>-id<N>`, or
 * the id-only form `/bat-dong-san/<category segment>/id<N>` this importer stores. The category
 * segment is muaban's own taxonomy ('nha-mat-tien-quan-hai-chau-da-nang', 'cho-thue-can-ho-chung-cu-
 * quan-12-ho-chi-minh'): at most a one- or two-digit district number, so a 3+ digit run there is not
 * a muaban segment and the path is refused.
 */
function detailPath(id: unknown, url: unknown): { category: string; path: string } | null {
  const u = String(url ?? '')
  const path = u.startsWith(ORIGIN + '/') ? u.slice(ORIGIN.length) : u
  const m = /^\/bat-dong-san\/([a-z0-9-]+)\/(?:[a-z0-9-]+-)?id(\d+)$/.exec(path)
  if (!m || m[2] !== String(id) || /\d{3,}/.test(m[1])) return null
  return { category: m[1], path }
}

/**
 * ⛔ THE OUTBOUND CTA IS ONLY AS TRUSTWORTHY AS THIS CHECK. `affiliateUrl` becomes a live link on the
 * PDP and `safeAffiliateUrl()` only enforces https, so the HOST is pinned here, and the path must
 * be a muaban detail path whose id is this listing's own id — a record cannot point its CTA at a
 * different listing, a different section, or a different site.
 * ⛔ AND IT LINKS BY ID ONLY, never with the poster's title slug. The canonical URL's last segment is
 * the free-text title slugified, and real ones carry house and room numbers
 * ('172-cho-thue-nha-nguyen-can-mat-tien-trung-nu-vuong' = 172 Trưng Nữ Vương, '…-kinh-duong-vuong-
 * p304'), or a phone number; that would put them in our database and every PDP's HTML. muaban
 * resolves a listing by its id alone (measured 2026-09-24): `/bat-dong-san/<category>/id71245081`
 * answers 301 to the canonical page — so does any slug, or another category segment — and a missing
 * id answers 404 (`/bat-dong-san/cho-thue-can-ho-ho-chi-minh/id1`), which the --retire pass relies on.
 * Idempotent: the id-only form maps to itself, so verify can compare a stored link with it.
 */
export function affiliateUrlFor(id: unknown, url: unknown): string | null {
  const p = detailPath(id, url)
  return p ? `${ORIGIN}/bat-dong-san/${p.category}/id${String(id)}` : null
}

/**
 * The page to FETCH for this listing during a crawl: the source's own canonical URL, under the same
 * pins as affiliateUrlFor. Fetching the id-only link would cost a 301 per row. It is used in memory
 * only — never staged, never stored.
 */
export function sourcePageUrl(id: unknown, url: unknown): string | null {
  const p = detailPath(id, url)
  return p ? ORIGIN + p.path : null
}

/**
 * The only photo URLs this importer will ever fetch. ⛔ ALSO THE SSRF GUARD: these URLs come from a
 * third party's JSON and are fetched from our machine at --apply, so the host, folder and file-name
 * shape are pinned (cloud.muaban.net, `thumb-detail`, dated path, 32-hex name). Measured: the
 * `thumb-detail` size is the largest the pages reference (378x504 and 672x448 on two samples);
 * `thumb-md`/`thumb-sm` are smaller crops. ⚠️ `thumb-detail` carries muaban's faint centred
 * "muaban.net" mark; the owner accepted burned-in source marks (2026-09-24, same rule as Batdongsan).
 */
export const IMAGE_RE = /^https:\/\/cloud\.muaban\.net\/images\/thumb-detail\/\d{4}\/\d{2}\/\d{2}\/\d{1,4}\/[0-9a-f]{32}\.(jpe?g|png|webp)$/i

/** A card cover ('thumb-md'/'thumb-sm') re-pointed at the same file's 'thumb-detail' size. */
export function coverToDetail(u: string): string {
  return u.replace(/^(https:\/\/cloud\.muaban\.net\/images\/)thumb-(?:md|sm)\//, '$1thumb-detail/')
}

/**
 * Photos for a row, in the source's order: the detail page's own `images[]` when we have it,
 * otherwise the list card's covers re-pointed at `thumb-detail` (an INFERRED mapping — the dry run
 * prints how often it agrees with the detail page). Deduped, allowlisted, capped at MAX_IMAGES.
 */
export function imageUrls(item: Pick<MuabanListItem, 'covers'>, detail: Pick<MuabanDetail, 'images'> | null): string[] {
  const src = detail?.images?.length ? detail.images.map((i) => i.url) : (item.covers ?? []).map(coverToDetail)
  const out: string[] = []
  for (const u of src) {
    if (IMAGE_RE.test(u) && !out.includes(u)) out.push(u)
    if (out.length >= MAX_IMAGES) break
  }
  return out
}

/**
 * Per-image verdict, text-card test and gallery rule: ⛔ THE SHARED ONE (src/lib/import-photo-check.ts),
 * which was extracted from this file so every property importer that re-hosts a portal's photos
 * applies the same measured rule instead of a copy that drifts. muaban uses its defaults: the
 * long-edge floor only (thumb-detail fits a real portrait into 232x504), entropy < 5.0 or flat ≥ 0.7
 * is a placeholder, an undecodable image fails closed, and a fetch/decode failure fails the row.
 * ⚠️ 'tooSmall' is also muaban's only headshot guard: it has no filename convention for agent
 * portraits the way Batdongsan's img_2 has. Re-exported here so the importer and its tests keep one
 * import surface.
 */
export {
  MIN_IMAGE_LONG_EDGE, PLACEHOLDER_ENTROPY, PLACEHOLDER_FLAT, flatnessOf, galleryPlan, imageVerdict,
  type ImageMeasure, type ImageVerdict, type PhotoOutcome,
} from '../src/lib/import-photo-check'

// ─── The mapping ─────────────────────────────────────────────────────────────────────────────

export type DropReason =
  | 'notRental' | 'city' | 'type' | 'target' | 'location' | PriceDrop
  | 'expired' | 'detailMismatch' | 'noImages' | 'postDate'

/** `now` (epoch ms, default Date.now()) is the ceiling a source post date is clamped to. */
export type MapOptions = { cities: CityKey[]; types: number[]; now?: number }

/** Everything `create`/`update` writes that a re-import may refresh. images/status/verified/rankScore/postedAt are NOT here. */
export type MutableFields = {
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  currency: '₫'
  negotiable: false
  listingType: 'rent'
  subcategorySlug: string | null
  location: string
  district: string | null
  city: string
  lat: number | null
  lng: number | null
  areaM2: number | null
  attributes: string | null
  affiliateUrl: string
  searchText: string
}

export type MappedRow = {
  externalId: string
  sourceId: number
  cityKey: CityKey
  mutable: MutableFields
  /** Source photo URLs to re-host at --apply. NEVER stored as-is. */
  imageSources: string[]
  /** muaban's own post date (sourcePostedAt). CREATE-ONLY, with the rankScore it implies (createOnlyFields). */
  postedAt: Date
  /** Mixed-language segments the reviewed dictionary does not cover yet (import-i18n.ts) — a report, never stored. */
  untranslated: MissingSegment[]
}

/**
 * The earliest date read as a real muaban post date. muaban's ids and dates on the pages measured
 * are all 2026; an unset field serialised as the epoch ('1970-01-01…') or a year-1 default would
 * otherwise become a card that says "posted 56 years ago".
 */
export const MIN_SOURCE_POSTED_AT = Date.parse('2010-01-01T00:00:00Z')

/**
 * ⛔ `postedAt` IS THE SOURCE'S OWN POST DATE, NEVER "NOW" (owner/lead decision, 2026-09-24). An
 * imported row stamped with the import time starts with the recency term at its maximum
 * (browseRankScore: 0.5786 at trust 100) and sits above existing listings (~0.56) in the default
 * browse, which sorts by rankScore — ~5,000 borrowed rows ahead of people's own posts. It also tells
 * the card and the feed's recency key that a flat is fresher than it is.
 * The date is muaban's `publish_at`, clamped to `now` so a clock-skewed or forged future date can
 * never out-rank a real one. Unreadable, or before MIN_SOURCE_POSTED_AT → null, and the row is
 * dropped ('postDate') rather than dated today.
 * ⚠️ muaban RE-PUBLISHES renewed ads (publish_at moves; the detail page's `created_at` does not), so
 * this is "last published on muaban", not "first posted". Measured on the 2026-09-24 newest-first
 * dry run: publish_at 0.7–3.1 h old on 30/30 rows, so the starting rank is within 0.002 of "now".
 */
export function sourcePostedAt(publishAt: string | undefined, now: number = Date.now()): Date | null {
  const t = Date.parse(publishAt ?? '')
  if (!Number.isFinite(t) || t < MIN_SOURCE_POSTED_AT) return null
  return new Date(Math.min(t, now))
}

/**
 * What verify-muaban-import.ts checks on a stored row: its postedAt is a source date that was
 * clamped at import, so it can never be later than the row's own createdAt, nor older than
 * MIN_SOURCE_POSTED_AT. null when it is fine. The clamp used the importer machine's clock and
 * createdAt is the database's, so 5 minutes of skew is allowed (the same allowance the stage age
 * check gives a fetchedAt).
 */
export const POSTED_AT_SKEW_MS = 5 * 60_000
export function postedAtProblem(postedAt: Date, createdAt: Date): 'future' | 'implausible' | null {
  if (postedAt.getTime() > createdAt.getTime() + POSTED_AT_SKEW_MS) return 'future'
  if (!(postedAt.getTime() >= MIN_SOURCE_POSTED_AT)) return 'implausible'
  return null
}

/**
 * The CREATE-ONLY ranking fields of a new row: its source `postedAt`, and the starting rankScore the
 * importer has always computed (browseRankScore, not featured, no demand yet) — from THAT date
 * instead of from `new Date()`. The nightly recompute re-decays it from `postedAt` afterwards
 * (ranking-formula.ts rankScoreExprSql), so the two agree.
 */
export function createOnlyFields(row: Pick<MappedRow, 'postedAt'>, sellerTrustScore: number, now: number = Date.now()): { postedAt: Date; rankScore: number } {
  return { postedAt: row.postedAt, rankScore: browseRankScore({ sellerTrustScore, postedAt: row.postedAt, featured: false }, now) }
}

/**
 * ⛔ THE LAST WORD ON `location` BEFORE IT IS PUBLISHED: every comma part is a ward, a district or
 * the city's own name, and nothing looks like a street number (3+ digits, a '/' pair, 'số N').
 */
export function locationIsSafe(location: string, city: string): boolean {
  if (/\d{3,}|\d\s*\/\s*\d|\bsố\s*\d/iu.test(location)) return false
  return location.split(',').map(clean).every((p) => p === city || isAdminPart(p))
}

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'
const areaEn = (a: number) => String(Math.round(a * 100) / 100)
const areaVi = (a: number) => areaEn(a).replace('.', ',')

export function mapRecord(item: MuabanListItem, detail: MuabanDetail | null, opts: MapOptions): { ok: true; row: MappedRow } | { ok: false; reason: DropReason } {
  if (item.subcategory_id !== RENT_SUBCATEGORY_ID || (detail?.subcategory_id !== undefined && detail.subcategory_id !== RENT_SUBCATEGORY_ID)) {
    return { ok: false, reason: 'notRental' }
  }
  const cityKey = (Object.keys(CITIES) as CityKey[]).find((k) => CITIES[k].sourceId === item.city_id)
  if (!cityKey || !opts.cities.includes(cityKey)) return { ok: false, reason: 'city' }
  const type = PROPERTY_TYPES[item.property_type]
  if (!type || !opts.types.includes(item.property_type)) return { ok: false, reason: 'type' }
  if (detail && (detail.id !== item.id || (detail.city_id !== undefined && detail.city_id !== item.city_id)
    || (detail.property_type !== undefined && detail.property_type !== item.property_type))) {
    return { ok: false, reason: 'detailMismatch' }
  }
  const affiliateUrl = affiliateUrlFor(item.id, item.url)
  if (!affiliateUrl) return { ok: false, reason: 'target' }

  /** The detail page is read seconds after the card, so where both exist the detail wins. */
  const price = detail?.price ?? item.price
  const display = detail?.price_display ?? item.price_display
  const pd = priceDrop(price, display)
  if (pd) return { ok: false, reason: pd }

  const c = CITIES[cityKey]
  const { ward, district } = locationParts(item)
  if (!district) return { ok: false, reason: 'location' }
  const location = [ward, district, c.city].filter(Boolean).join(', ')
  if (!locationIsSafe(location, c.city)) return { ok: false, reason: 'location' }

  if (item.is_expired || detail?.is_expired || detail?.is_outdate || detail?.publish === false) return { ok: false, reason: 'expired' }
  const postedAt = sourcePostedAt(item.publish_at, opts.now ?? Date.now())
  if (!postedAt) return { ok: false, reason: 'postDate' }

  const imageSources = imageUrls(item, detail)
  if (!imageSources.length) return { ok: false, reason: 'noImages' }

  const attributes = detail?.attributes?.length ? detail.attributes : item.attributes
  const areaAttr = (attributes ?? []).find((a) => /m(²|2)/i.test(a.value))?.value
  const areaM2 = parseAreaM2(areaAttr)
  const beds = countFrom(attributes, detail?.parameters, 'bed')
  const baths = countFrom(attributes, detail?.parameters, 'bath')
  const floors = (detail?.parameters ?? []).find((p) => /số tầng/i.test(p.label))?.value ?? null
  const facing = (detail?.parameters ?? []).find((p) => /^Hướng cửa chính/i.test(p.label))?.value
    ?? (detail?.parameters ?? []).find((p) => /^Hướng/i.test(p.label))?.value ?? null
  const coords = parseLatLng(detail?.lat_lng)
  /** Outside HCMC the city goes into the title too: these are the first Hà Nội / Đà Nẵng rentals,
   *  and a card that says only "Quận Ba Đình" beside HCMC rows reads as an HCMC district. */
  const where = [ward, district, cityKey === 'hcm' ? null : c.city].filter(Boolean).join(', ')
  const kindVi = item.category_name?.trim() || type.vi

  const bits = [type.en]
  if (beds) bits.push(`${beds} bed`)
  if (baths) bits.push(`${baths} bath`)
  if (areaM2) bits.push(`${areaEn(areaM2)} m²`)
  const title = `${bits.join(' · ')} for rent — ${where}`
  const titleVi = `Cho thuê ${kindVi}${beds ? ` ${beds}PN` : ''}${areaM2 ? ` ${areaVi(areaM2)}m²` : ''} — ${where}`

  const factsEn = ([
    ['Type', kindVi], ['Area', areaM2 ? `${areaEn(areaM2)} m²` : null], ['Bedrooms', beds], ['Bathrooms', baths],
    ['Floors', floors], ['Facing', facing], ['Location', location], ['Rent', `${vnd(price)}/month`],
  ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n')
  const factsVi = ([
    ['Loại hình', kindVi], ['Diện tích', areaM2 ? `${areaVi(areaM2)} m²` : null], ['Phòng ngủ', beds], ['Phòng vệ sinh', baths],
    ['Số tầng', floors], ['Hướng', facing], ['Khu vực', location], ['Giá thuê', `${vnd(price)}/tháng`],
  ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n')

  /**
   * ⛔ THE ENGLISH TEXT IS MADE ENGLISH HERE, NOT LATER IN THE DATABASE (src/lib/import-i18n.ts): the
   * title's "— Phường 22, Quận Bình Thạnh", "Type: Nhà trọ, phòng trọ", "Facing: Bắc", the Location
   * line and the Vietnamese-grouped "Rent: 2.500.000 đ/month" all reach the English text from the
   * source. Every field here is refreshed (sameMutable), so only a fix in the mapper survives a re-run.
   * Before `searchText`, which folds the localized titles.
   */
  const text = localizeImportText({
    title,
    titleVi,
    description: `Listed on ${SELLER_NAME}. eno links to the original — enquiries and viewings are handled there, not by eno.\n\n${factsEn}`,
    descriptionVi: `Tin đăng trên ${SELLER_NAME}. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\n${factsVi}`,
  })

  const mutable: MutableFields = {
    title: text.title,
    titleVi: text.titleVi,
    description: text.description,
    descriptionVi: text.descriptionVi,
    price,
    priceUnit: RENT_PRICE_UNIT,
    currency: '₫',
    /** ⛔ Against the schema default `true`: an offer needs a counterparty, and there is none here. */
    negotiable: false,
    /** ⛔ Also the ads-feed guard: feedListingTypes() never includes 'rent'. */
    listingType: 'rent',
    subcategorySlug: type.subcat,
    location,
    district,
    city: c.city,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    areaM2,
    attributes: bedroomsAttribute(beds, baths),
    affiliateUrl,
    /** ⚠️ title and titleVi FIRST — rebaseSearchText (src/lib/import-i18n.ts) relies on that order. */
    searchText: buildSearchText([text.title, text.titleVi, location, district, kindVi, type.en, c.city, c.cityEn]),
  }
  return { ok: true, row: { externalId: `${EXTERNAL_PREFIX}:${item.id}`, sourceId: item.id, cityKey, mutable, imageSources, postedAt, untranslated: text.missing } }
}

/** Field-by-field equality, so a re-run skips unchanged rows and does not bump `updatedAt`. */
export function sameMutable(a: MutableFields, b: Partial<Record<keyof MutableFields, unknown>>): boolean {
  return (Object.keys(a) as (keyof MutableFields)[]).every((k) => {
    const x = a[k], y = b[k]
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-9
    return (x ?? null) === (y ?? null)
  })
}

/** muaban's `publish_at` as epoch ms, for the newest-first merge; -Infinity when unreadable. */
export function publishMs(item: Pick<MuabanListItem, 'publish_at'>): number {
  const t = Date.parse(item.publish_at ?? '')
  return Number.isFinite(t) ? t : -Infinity
}

/** Array.sort comparator: newest `publish_at` first, then the higher id; unreadable dates last. */
export function compareNewest(a: Pick<MuabanListItem, 'publish_at' | 'id'>, b: Pick<MuabanListItem, 'publish_at' | 'id'>): number {
  const ta = publishMs(a), tb = publishMs(b)
  if (ta !== tb) return ta > tb ? -1 : 1
  return (Number(b.id) || 0) - (Number(a.id) || 0)
}

/**
 * Index of the head that is NEWEST, for the k-way merge that turns several newest-first type lists
 * into one newest-first city list. -1 when every head is empty.
 */
export function newestHead(heads: (Pick<MuabanListItem, 'publish_at' | 'id'> | undefined)[]): number {
  let best = -1
  heads.forEach((h, i) => {
    if (h && (best === -1 || compareNewest(h, heads[best]!) < 0)) best = i
  })
  return best
}

/**
 * The rollback for a retire pass: re-activates exactly the rows it hid, and only while they are
 * still 'hidden' (a moderator's later decision is not overwritten by a stale file). null when none.
 */
export function retireRollbackSql(ids: string[]): string | null {
  const safe = ids.filter((id) => /^[A-Za-z0-9_-]+$/.test(id))
  if (!safe.length) return null
  return `UPDATE "Listing" SET status = 'active' WHERE "sellerId" = '${SELLER_ID}' AND status = 'hidden' AND id IN (${safe.map((id) => `'${id}'`).join(', ')});\n`
}

/**
 * Staged records older than this refuse --apply: a let flat with a live outbound link is what a
 * stale stage publishes, and rentals here turn over in days. The same 72 h every property importer
 * uses (nhatot's NHATOT_STAGE_MAX_AGE_H); the first cut allowed 7 days.
 */
export const MAX_STAGE_AGE_HOURS = 72
/**
 * ⚠️ AGE COMES FROM EACH RECORD'S OWN `fetchedAt`, NOT THE FILE'S mtime: `cp`, `git checkout` and
 * `touch` all reset an mtime, which is exactly how a month-old Rever status file could have passed
 * its freshness check (import-rever-rentals.ts:166-173). A missing, unparseable or FUTURE timestamp
 * (more than 5 minutes ahead — clock skew allowed, a forged "fresh" date not) counts as stale.
 */
export function oldestStageAgeHours(records: Pick<StagedRecord, 'fetchedAt'>[], now = Date.now()): number {
  if (!records.length) return Infinity
  let worst = 0
  for (const r of records) {
    const t = Date.parse(r.fetchedAt)
    if (!Number.isFinite(t) || t > now + 5 * 60_000) return Infinity
    worst = Math.max(worst, (now - t) / 3_600_000)
  }
  return worst
}
export function stageAgeRefusal(records: Pick<StagedRecord, 'fetchedAt'>[], now = Date.now()): string | null {
  const h = oldestStageAgeHours(records, now)
  return h <= MAX_STAGE_AGE_HOURS ? null
    : `stage is ${Number.isFinite(h) ? `${h.toFixed(1)} h` : 'of unknown age (empty, or an unreadable/future fetchedAt)'} old — over ${MAX_STAGE_AGE_HOURS} h; re-crawl with --stage before --apply`
}

/**
 * ⛔ NEVER WRITE INTO A SELLER THAT IS NOT PLAINLY OURS. Renamed → someone else may have claimed the
 * id's row; owned → a real account receives the enquiries; any badge → it claims a vetting or a
 * partnership that does not exist (and verify-rever-import-style checks fail on it). Used by both
 * the import and the retire pass, before any write.
 */
export function sellerRefusal(s: { name: string; ownerId: string | null; verified: boolean; verifiedSeller: boolean; officialPartner: boolean } | null): string | null {
  if (!s) return null
  if (s.name !== SELLER_NAME) return `seller ${SELLER_ID} is named "${s.name}", expected "${SELLER_NAME}" — refusing`
  if (s.ownerId) return `seller ${SELLER_ID} has ownerId ${s.ownerId} — a real account owns it; refusing`
  const badges = (['verified', 'verifiedSeller', 'officialPartner'] as const).filter((k) => s[k])
  if (badges.length) return `seller ${SELLER_ID} carries ${badges.join(', ')} — refusing`
  return null
}

// ─── Liveness (the --retire pass) ────────────────────────────────────────────────────────────

export type Liveness = 'gone' | 'inactive' | 'alive' | 'unknown'
/**
 * ⛔ RETIRE ONLY ON A POSITIVE SIGNAL, never on absence from a crawl: HTTP 404/410 (a missing ad
 * answers 404, measured), or the ad's OWN page saying it is over (`is_expired`, `is_outdate`,
 * `publish: false`) — and only when that page is THIS listing (its `classified.id`). A 5xx, a
 * network error, a page about another listing or anything unparseable is 'unknown' and hides
 * nothing.
 */
export function livenessVerdict(sourceId: number, status: number, nextData: any): { verdict: Liveness; why: string } {
  if (status === 404 || status === 410) return { verdict: 'gone', why: `HTTP ${status}` }
  if (status !== 200) return { verdict: 'unknown', why: `HTTP ${status}` }
  const c = nextData?.props?.pageProps?.classified
  if (!c || Number(c.id) !== sourceId) return { verdict: 'unknown', why: 'page is not this listing' }
  if (c.is_expired === true) return { verdict: 'inactive', why: 'is_expired' }
  if (c.is_outdate === true) return { verdict: 'inactive', why: 'is_outdate' }
  if (c.publish === false) return { verdict: 'inactive', why: 'unpublished' }
  return { verdict: 'alive', why: 'live' }
}

/**
 * ⛔ A MASS 404 IS A SITE CHANGE, NOT CHURN. If muaban moved its URLs tomorrow every row would answer
 * 404 and a retire pass would hide the whole import. Past `minSample` answered checks, a gone share
 * above `maxShare` refuses the write (`--force-mass-retire` overrides, after a human has looked).
 */
export function massRetireRefusal(gone: number, answered: number, maxShare = 0.5, minSample = 20): string | null {
  if (answered < minSample || gone / answered <= maxShare) return null
  return `${gone}/${answered} checked rows (${Math.round((gone / answered) * 100)}%) look gone — that is more like a site change than churn; refusing to hide them (re-check by hand, then --force-mass-retire)`
}
