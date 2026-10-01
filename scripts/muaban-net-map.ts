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
import {
  APARTMENT_SUBCAT, FRESH_DAYS, FRESH_SET_MAX_AGE_MS, REVIVABLE_STATUSES, freshSetProblem, isInWindow, makeFreshSet, type FreshItem, type FreshSet,
} from '../src/lib/apartment-freshness'
import { buildSearchText } from '../src/lib/fold'
import { localizeImportText, type MissingSegment } from '../src/lib/import-i18n'
import { pdpTombstoneTags } from '../src/lib/job-listing'
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
/** 'Căn hộ' — the only type the 7-day rule (src/lib/apartment-freshness.ts) applies to. */
export const APARTMENT_TYPE = 2812

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
  /** --cover-by-mark: lead with the kept photo where muaban's stamp shows least (src/lib/import-photo-mark.ts). */
  coverByMark: boolean
  listOnly: boolean
  forceMassRetire: boolean
  /**
   * --fresh-out <file>: the 7-day rule's FRESH SET (src/lib/apartment-freshness.ts), written by the live
   * crawl that reads muaban — every apartment ad whose detail page says `created_at` within FRESH_DAYS.
   * modeRefusal pins what it may be combined with (apartments only, every city, no --limit/--cap).
   */
  freshOut: string | null
}

/** Every flag this importer reads. ⛔ Anything else THROWS: a typo'd `--fresh-ot` must not run a crawl
 *  that silently writes no set, nor a mistyped safety flag pass as accepted. */
const VALUED_FLAGS = ['--limit', '--src', '--stage', '--journal', '--city', '--types', '--cap', '--max-pages', '--delay-ms', '--fresh-out']
const BOOLEAN_FLAGS = ['--apply', '--retire', '--probe-images', '--cover-by-mark', '--list-only', '--force-mass-retire']

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
  for (const k of VALUED_FLAGS) {
    if (argv.includes(k) && arg(k) === null) throw new Error(`${k} needs a value`)
  }
  /** Values never start with `--` (arg() refuses them), so every `--` token must be a known flag. Works
   *  with and without the leading `node script` pair (process.argv, or a test's bare list). */
  for (const t of argv) {
    if (t.startsWith('--') && !VALUED_FLAGS.includes(t) && !BOOLEAN_FLAGS.includes(t)) throw new Error(`unknown flag "${t}"`)
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
    coverByMark: flag('--cover-by-mark'),
    listOnly: flag('--list-only'),
    forceMassRetire: flag('--force-mass-retire'),
    freshOut: arg('--fresh-out'),
  }
}

/**
 * The run modes that are allowed together. Returned as a refusal string so the importer can stop
 * BEFORE it touches the network, the database or the journal dir.
 */
export function modeRefusal(a: RunArgs): string | null {
  /** ⛔ Refused rather than ignored: the retire pass never judges a photo, and neither does a dry run
   *  without --probe-images, so the flag would do nothing and say nothing. */
  if (a.coverByMark && a.retire) return '--cover-by-mark is not a --retire option: the retire pass never judges photos (drop one)'
  if (a.coverByMark && !a.probeImages && !a.apply) return '--cover-by-mark changes which photo leads when photos are judged: pass it with --probe-images (to see the covers) or --apply'
  if (a.retire && (a.src || a.stage)) return '--retire is its own pass: it reads the live rows of this seller, not a stage (drop --src/--stage)'
  if (a.apply && !a.retire && !a.src) return '--apply only imports a REVIEWED stage: run a dry run with --stage <file>, read it, then --src <file> --journal <dir> --apply'
  if (a.apply && a.stage) return '--stage is for live dry runs; --apply reads --src'
  if (a.src && a.stage) return '--src already is a staged file; --stage is for a live crawl'
  if (a.apply && !a.journalDir) return '--apply needs --journal <durable dir> (not /tmp: macOS clears it on reboot)'
  if (a.freshOut) {
    /** ⛔ THE SET IS WRITTEN BY THE RUN THAT READS MUABAN, and it must describe the WHOLE window: the
     *  expiry marks every live apartment row of this seller that is NOT in it. */
    if (a.src || a.apply || a.retire) return '--fresh-out is written by the live crawl (a dry run, with --stage); not with --src, --apply or --retire'
    if (!a.stage) return '--fresh-out needs --stage <file>: a set whose crawl is not kept cannot be applied, so its new ads would never be imported'
    if (a.types.length !== 1 || a.types[0] !== APARTMENT_TYPE) return '--fresh-out is the 7-day rule for APARTMENTS: pass --types apartment (and nothing else)'
    const missing = (Object.keys(CITIES) as CityKey[]).filter((k) => !a.cities.includes(k))
    if (missing.length) return `--fresh-out must cover every city this seller imports — ${missing.join(', ')} missing: the expiry marks every live apartment row NOT in the set, so a partial set would expire those cities' rows`
    if (a.limit) return '--limit cuts the crawl short; a fresh set must be whole'
    if (Object.keys(a.caps).length) return '--cap cuts the crawl short; a fresh set must be whole'
    if (a.listOnly) return '--list-only reads no detail page, and the date this rule uses (created_at) is only on the detail page'
  }
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
  /**
   * --fresh-out crawls only: the moment the fresh set describes (its `fetchedAt` — the crawl's start). The
   * apply judges the 7-day window of an apartment at THIS moment, exactly as the set did, instead of at the
   * record's own fetchedAt (which can be 30+ minutes later): an ad near the window's edge is then in the set
   * AND created/refreshed/revived, or in neither. Absent on an ordinary crawl's records.
   */
  setAt?: string
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
  /** ⛔ setAt moves the window the apply judges by, so it is pinned: a real instant, no later than this
   *  record's own read (skew allowed), and no more than a day before it — the age a fresh set may have. */
  let setAt: string | undefined
  if (r.setAt !== undefined) {
    const s = typeof r.setAt === 'string' ? Date.parse(r.setAt) : NaN
    const f = Date.parse(r.fetchedAt)
    if (!Number.isFinite(s) || !(s <= f + SKEW_MS) || !(f - s <= FRESH_SET_MAX_AGE_MS)) {
      throw new Error(`stage line ${line}: setAt ${JSON.stringify(r.setAt)} is not an instant within ${FRESH_SET_MAX_AGE_MS / 3_600_000} h before its fetchedAt`)
    }
    setAt = new Date(s).toISOString()
  }
  return { v: 1, fetchedAt: r.fetchedAt, ...(setAt ? { setAt } : {}), seed: { city: city as CityKey, type }, item, detail, detailStatus }
}

/** A whole JSONL stage → allowlisted records. Throws on the first unreadable line, and on a file that
 *  mixes crawls (records with different setAt, or with and without one): one stage is one crawl. */
export function parseStage(text: string): StagedRecord[] {
  const out: StagedRecord[] = []
  text.split('\n').forEach((l, i) => {
    if (!l.trim()) return
    let raw: unknown
    try { raw = JSON.parse(l) } catch { throw new Error(`stage line ${i + 1}: not JSON`) }
    out.push(restageRecord(raw, i + 1))
  })
  const sets = new Set(out.map((r) => r.setAt ?? null))
  if (sets.size > 1) throw new Error(`the stage mixes crawls: ${[...sets].map((s) => s ?? '(no setAt)').join(', ')}`)
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

/**
 * 'window': an APARTMENT whose `created_at` is older than FRESH_DAYS at `windowAt` — the 7-day rule
 * (src/lib/apartment-freshness.ts). Such a row is neither created nor refreshed; the expiry step takes
 * an existing one down.
 */
export type DropReason =
  | 'notRental' | 'city' | 'type' | 'target' | 'location' | PriceDrop
  | 'expired' | 'detailMismatch' | 'noImages' | 'postDate' | 'window'

/**
 * `now` (epoch ms, default Date.now()) is the ceiling a source post date is clamped to. `windowAt` (epoch
 * ms, default `now`) is the moment an APARTMENT's created_at is judged against the 7-day window, and
 * `readAt` (default `windowAt`) the moment its detail page was read. The importer passes the record's
 * `setAt` (a --fresh-out crawl: the fresh set's own fetchedAt) or else its `fetchedAt` as windowAt, and its
 * fetchedAt as readAt — and the judgement is judgeCreated(), the very function that built the set. So an
 * apartment the set holds is the apartment the apply creates, refreshes or revives, and vice versa, even
 * at the window's edge and even when it was posted after the crawl started (the set dates it setAt).
 */
export type MapOptions = { cities: CityKey[]; types: number[]; now?: number; windowAt?: number; readAt?: number }

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
  /**
   * muaban's FIRST-post date: the detail page's `created_at` (sourcePostedAt), never `publish_at`. Written
   * on create, on a revival, and on an update when it is newer than the stored one — always with the
   * rankScore it implies (createOnlyFields).
   */
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

/** ISO 8601 date-time WITH its offset: `Z` or `±hh:mm` (fraction any length, read to the millisecond). */
const ZONED_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/i

/**
 * ⛔ A SOURCE DATE IS AN INSTANT ONLY WHEN IT SAYS WHICH ZONE IT IS IN. muaban's created_at carries
 * `+07:00` (measured 2026-10-01). `Date.parse` reads a date-time WITHOUT an offset as the MACHINE's local
 * time (ECMA-262 Date Time String Format): the same '2026-09-24T08:00:00' is 7 hours apart on a UTC box and
 * a Saigon one, which can move an ad across the 7-day edge depending on where the job runs. So only a
 * date-time with `Z` or `±hh:mm` is read, by hand (no engine leniency, no local zone): anything else —
 * no offset, a bare date, an impossible day — is NaN, which every caller treats as unreadable.
 */
export function parseZonedInstant(s: string | undefined): number {
  const m = ZONED_DATE_TIME.exec(s ?? '')
  if (!m) return NaN
  const [, y, mo, d, h, mi, sec = '0', frac = '', z, sign, oh, om] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +h > 23 || +mi > 59 || +sec > 59) return NaN
  if (!z && (+oh > 23 || +om > 59)) return NaN
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, Number(frac.padEnd(3, '0').slice(0, 3)))
  if (new Date(wall).getUTCDate() !== +d) return NaN                                  // 2026-02-30 is not a day
  return wall - (z ? 0 : (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60_000)
}

/**
 * ⛔ `postedAt` IS THE SOURCE'S OWN POST DATE, NEVER "NOW" (owner/lead decision, 2026-09-24). An
 * imported row stamped with the import time starts with the recency term at its maximum
 * (browseRankScore: 0.5786 at trust 100) and sits above existing listings (~0.56) in the default
 * browse, which sorts by rankScore — ~5,000 borrowed rows ahead of people's own posts. It also tells
 * the card and the feed's recency key that a flat is fresher than it is.
 * ⛔ THE DATE IS THE DETAIL PAGE'S `created_at` (the first post), NEVER `publish_at` (2026-10-01). muaban
 * re-publishes every LIVE ad each night (publish_at ≈ 00:00–00:05 on every card measured 2026-10-01,
 * e.g. id 71204990: created 2026-09-04, publish_at 2026-10-01T00:00:14), so publish_at says "live
 * today", not "posted" — it would make every ad fresh every day under the 7-day rule. This takes any
 * source date string; mapRecord passes `created_at`. Clamped to `now` so a clock-skewed or forged future
 * date can never out-rank a real one. Unreadable — including a date-time with NO explicit offset
 * (parseZonedInstant: it would be read in the machine's zone) — or before MIN_SOURCE_POSTED_AT → null, and
 * the row is dropped ('postDate') rather than dated today — which is also the fate of a row staged with no
 * detail page (--list-only): the card carries no created_at.
 */
export function sourcePostedAt(sourceDate: string | undefined, now: number = Date.now()): Date | null {
  const t = parseZonedInstant(sourceDate)
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
 * The ranking fields of a row dated from the source: its source `postedAt`, and the starting rankScore
 * the importer has always computed (browseRankScore, not featured, no demand yet) — from THAT date
 * instead of from `new Date()`. Used on create, and on a revival / a newer source date (existingRowPlan),
 * so a re-dated row ranks exactly like a new one would. The nightly recompute re-decays it from
 * `postedAt` afterwards (ranking-formula.ts rankScoreExprSql), so the two agree.
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
  return mapCore(item, detail, opts, false)
}

/**
 * The checks a list CARD alone can fail — everything but the date, which lives on the detail page
 * (`created_at`). The live crawl spends a detail request only on a card this passes. Never returns a row.
 */
export function listLevelDrop(item: MuabanListItem, opts: MapOptions): DropReason | null {
  const m = mapCore(item, null, opts, true)
  return m.ok ? null : m.reason
}

function mapCore(item: MuabanListItem, detail: MuabanDetail | null, opts: MapOptions, listLevel: boolean): { ok: true; row: MappedRow } | { ok: false; reason: DropReason } {
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
  const now = opts.now ?? Date.now()
  /** ⛔ created_at, never publish_at (sourcePostedAt says why). listLevel: the card has no created_at. */
  const postedAt = listLevel ? new Date(now) : sourcePostedAt(detail?.created_at, now)
  if (!postedAt) return { ok: false, reason: 'postDate' }
  /** ⛔ THE 7-DAY RULE, apartments only: an ad first posted more than FRESH_DAYS before the set's moment is
   *  not imported, refreshed or revived. judgeCreated — the set's own verdict — at the set's moment. */
  if (!listLevel && type.subcat === APARTMENT_SUBCAT) {
    const at = opts.windowAt ?? now
    if (judgeCreated(detail?.created_at, opts.readAt ?? at, at).kind !== 'fresh') return { ok: false, reason: 'window' }
  }

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
    description: `Listed on ${SELLER_NAME}.\n\n${factsEn}`,
    descriptionVi: `Tin đăng trên ${SELLER_NAME}.\n\n${factsVi}`,
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

/** A SQL string literal: quotes doubled. */
const sqlLit = (x: string) => `'${x.replace(/'/g, "''")}'`
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The per-page ISR tombstones of these listing ids, both languages, as SQL — what a ROLLBACK line carries
 * so that a page it brings back (or takes down) does not keep rendering its cached state for 30 days.
 * The same tags and upsert as src/lib/pdp-tombstone.ts (and expire-apartment-rentals.ts's rollback).
 */
export function isrTombstoneSql(ids: readonly string[]): string {
  const tags = ids.flatMap(pdpTombstoneTags).map(sqlLit).join(',')
  return `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
}

/**
 * A row a write moved, as `updateManyAndReturn({ select: { id: true, updatedAt: true } })` returned it. The
 * `updatedAt` that write stamped (Prisma's @updatedAt) is every rollback line's last guard: any LATER write
 * moves it forward, so an old rollback file cannot undo a change made after its run.
 */
export type MovedRow = { id: string; updatedAt: Date | string }

/** The `"updatedAt" <= '…'` literal of a moved row's stamp (UTC ISO, to the millisecond); null when it is not an instant. */
function stampLit(t: Date | string): string | null {
  const ms = t instanceof Date ? t.getTime() : parseZonedInstant(t)
  return Number.isFinite(ms) ? sqlLit(new Date(ms).toISOString()) : null
}

/**
 * The rollback for a retire pass: re-activates exactly the rows it hid, and only while each is still
 * 'hidden' AND untouched since the hide (`"updatedAt" <=` the stamp the hide returned) — a moderator's later
 * decision, or a later run's write, is never overwritten by a stale file — and tombstones their pages
 * (cached as gone while hidden). One UPDATE per row; the importer writes it right AFTER that row's hide
 * landed. A row with an unsafe id or no readable stamp gets no line; null when none.
 */
export function retireRollbackSql(rows: readonly MovedRow[]): string | null {
  const safe = rows.flatMap((r) => {
    const at = SAFE_ID.test(r.id) ? stampLit(r.updatedAt) : null
    return at ? [{ id: r.id, at }] : []
  })
  if (!safe.length) return null
  const lines = safe.map((r) => `UPDATE "Listing" SET status = 'active' WHERE "sellerId" = '${SELLER_ID}' AND status = 'hidden' AND id = '${r.id}' AND "updatedAt" <= ${r.at};`)
  return `${lines.join('\n')}\n${isrTombstoneSql(safe.map((r) => r.id))}\n`
}

/** One revival or re-date at --apply, journaled (fsync) BEFORE its write: the old values are the undo. */
export type DatedEntry = {
  kind: 'revive' | 'redate'
  id: string
  externalId: string
  /** The status the write was conditional on (and, for a revival, the one the rollback restores). */
  oldStatus: string
  oldPostedAt: string
  oldRankScore: number
  newPostedAt: string
  newRankScore: number
}

/** A dated entry's dates as SQL literals; throws on one that is not an instant. */
const rollbackDate = (iso: string) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) throw new Error(`refusing a rollback line with date ${JSON.stringify(iso)}`)
  return sqlLit(new Date(t).toISOString())
}

/**
 * Why a dated entry can have NO rollback line — a value that could not have come from the database — or
 * null. The importer asks this BEFORE the write (the line itself needs the write's returned updatedAt).
 */
export function datedEntryProblem(e: DatedEntry): string | null {
  if (!SAFE_ID.test(e.id)) return `refusing a rollback line for id ${JSON.stringify(e.id)}`
  for (const d of [e.oldPostedAt, e.newPostedAt]) {
    if (!Number.isFinite(Date.parse(d))) return `refusing a rollback line with date ${JSON.stringify(d)}`
  }
  if (!Number.isFinite(e.oldRankScore)) return `refusing a rollback line with rankScore ${e.oldRankScore}`
  const revive = e.kind === 'revive'
  if (revive ? !(REVIVABLE_STATUSES as readonly string[]).includes(e.oldStatus) : !/^[a-z_]{1,32}$/.test(e.oldStatus) || e.oldStatus === 'removed') {
    return `refusing a rollback line to status ${JSON.stringify(e.oldStatus)}`
  }
  return null
}

/**
 * ⛔ THE UNDO OF ONE DATED WRITE, written only AFTER that write moved the row, and GUARDED ON THE STATE IT
 * CREATED: postedAt back only while it is still the value this run wrote, and the status back (a revival)
 * only while the row is still 'active' — a re-date's line is guarded on the unchanged status instead, so
 * neither can touch a row someone hid or removed since — and only while the row is untouched since the
 * write (`"updatedAt" <=` the stamp updateManyAndReturn returned for it), so an old rollback cannot undo a
 * later change. Each line carries its page's ISR tombstones (a revival undone takes a live page down).
 * Throws on a value that could not have come from the database (datedEntryProblem, or no stamp).
 */
export function datedRollbackSql(e: DatedEntry, updatedAt: Date | string): string {
  const problem = datedEntryProblem(e)
  if (problem) throw new Error(problem)
  const at = stampLit(updatedAt)
  if (!at) throw new Error(`refusing a rollback line with updatedAt ${JSON.stringify(updatedAt)}`)
  const revive = e.kind === 'revive'
  const sets = [...(revive ? [`status = ${sqlLit(e.oldStatus)}`] : []), `"postedAt" = ${rollbackDate(e.oldPostedAt)}`, `"rankScore" = ${e.oldRankScore}`]
  const guard = revive ? `status = 'active'` : `status = ${sqlLit(e.oldStatus)}`
  return `UPDATE "Listing" SET ${sets.join(', ')} WHERE id = ${sqlLit(e.id)} AND "sellerId" = ${sqlLit(SELLER_ID)} AND ${guard} AND "postedAt" = ${rollbackDate(e.newPostedAt)} AND "updatedAt" <= ${at};\n${isrTombstoneSql([e.id])}\n`
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
 * ⛔ --apply OF AN EMPTY STAGE IS A CLEAN NO-OP (exit 0), decided BEFORE the age check (which calls an empty
 * stage "of unknown age") and before the database is opened. A --fresh-out crawl whose lists could not be
 * proven reads no detail page, so its finished stage holds nothing — and the weekly job applies it anyway
 * (scripts/apartments-weekly.sh). The line to print, or null when the stage has work.
 */
export function emptyStageNoop(records: readonly unknown[], src: string): string | null {
  return records.length ? null : `stage ${src} holds no records — nothing to apply (no database connection, no write)`
}

/**
 * The exit code of a --fresh-out run that read muaban but could NOT prove whole-window coverage
 * (freshCoverageProblem / the set's own validation): no set is written, the finished stage is KEPT (what was
 * read is still applied), and the weekly job skips this source's expiry and alerts. Distinct from 1, a crash.
 */
export const COVERAGE_REFUSED_EXIT = 3

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

// ─── The 7-day rule: the fresh set (--fresh-out) and the apply-side dating ────────────────────

/**
 * WHAT THE FRESH CRAWL READS, AND WHY (all measured 2026-10-01 with 57 polite GETs):
 *   · ⛔ A LIST URL SHOWS AT MOST 51 PAGES (1,020 cards): page 52 of the 1,038-card Bình Thạnh apartment
 *     list repeats page 51. HCMC has 8,906 apartment cards, so the city list cannot reach them all.
 *   · Every list reports `classified.total` and echoes its filters in `filterResult.filters`. The city
 *     page's `quicklink.district.items` names 23 HCMC districts; their own totals summed to 8,907 against
 *     a city total of 8,906 read two minutes earlier (one ad arrived). Two exceed the cap (Bình Thạnh 1,038,
 *     Tân Bình 1,235); `price=<lo>-<hi>` (inclusive, echoed as {min,max}) splits them exactly:
 *     0-8000000 + 8000001-1000000000000 = 652 + 386 and 757 + 478. Hà Nội (636) and Đà Nẵng (937) fit.
 *   · No order is creation order: sort 0 ≈ 1 (publish_at, re-stamped nightly), 2/3 price, 4/5 filter to
 *     business/personal ads. So the WHOLE list is read, and the age comes from each ad's detail page.
 *   · Lists include EXPIRED ads (100 of Quận 4's 119 cards) — they are cards like any other here.
 *   · A list ends with a short page, then an empty one (Hóc Môn: 20, 20, 5, 0 — total still 45).
 *   · ⛔ Ad ids rise with created_at (71156160 → 2026-08-18, 71172051 → 08-22, 71204990 → 09-04,
 *     71230410 → 09-13; ~2,000–3,400 ids a day site-wide), which is what lets an ID FLOOR stand in for a
 *     detail request on a card that is clearly older than the window (IdFloor).
 *   · Pages are read in PRICE order (sort=2): a bump or the nightly re-publish moves a card in the
 *     publish-ordered list (a card bumped from an unread page to page 1 is skipped), but not here.
 *     Quận 4 read whole both ways: 119 distinct ids each, the same 119.
 */
export const PAGE_SIZE = 20
export const SOURCE_PAGE_CAP = 51
/** A list is read whole only at or under this many cards: headroom under 51×20 for ads arriving mid-read. */
export const LEAF_MAX = 960
export const FRESH_SORT = 2
/**
 * Price split points, VND/month. A band is a pair of ladder indices [i, j] meaning prices
 * [i = 0 ? 0 : LADDER[i] + 1, LADDER[j]] — so two halves of one band are contiguous and disjoint.
 */
export const PRICE_LADDER = [0, 1e6, 2e6, 3e6, 4e6, 5e6, 6e6, 7e6, 8e6, 9e6, 10e6, 12e6, 15e6, 20e6, 30e6, 50e6, 100e6, 1e12]
/** A card is CLEARLY older than the window when its created_at is this much earlier than the window's start. */
export const FLOOR_MARGIN_DAYS = 1
/** Consecutive clearly-old detail pages (walking ids downward) before the floor is set. */
export const FLOOR_CONFIRM = 3
/** A crawl that needs more detail pages than this never found the window's edge — refused, not continued. */
export const MAX_FRESH_DETAILS = 6000
/**
 * Live rows above the floor that no list showed are each read on their own page; this many of them still
 * LIVE there (200, not expired) means the lists are not whole. A 404/410 is a deleted ad — churn, not a hole.
 */
export const DB_MISS_MAX = 20
export const DB_MISS_MAX_SHARE = 0.05
/**
 * The read-only db net reads at most this many held rows on their own pages (≈ 40 min at 1.6 s): the
 * unlisted ones above the floor, plus every one BELOW the floor whose postedAt is inside the window (the
 * floor's per-run evidence — see FreshCrawler.dbNet). Needing more refuses the set without reading any.
 */
export const DB_RECHECK_MAX = 1500
const DAY_MS = 86_400_000
const SKEW_MS = 5 * 60_000

export type Band = [number, number]
export type FreshSeed = { city: CityKey; district: { id: number; path: string } | null; band: Band | null }

export function priceRange([i, j]: Band): [number, number] {
  return [i === 0 ? 0 : PRICE_LADDER[i] + 1, PRICE_LADDER[j]]
}

/** The two halves of a band (null = the whole price range). null when it is one ladder step already. */
export function splitBand(band: Band | null): [Band, Band] | null {
  const [i, j] = band ?? [0, PRICE_LADDER.length - 1]
  if (j - i < 2) return null
  const m = Math.floor((i + j) / 2)
  return [[i, m], [m, j]]
}

export function seedLabel(s: FreshSeed): string {
  const band = s.band ? ` price ${priceRange(s.band).join('-')}` : ''
  return `${s.city}${s.district ? ` district ${s.district.id}` : ''}${band}`
}

/** The apartment list of a seed, price-ordered: the city list, a district list, either narrowed to a band. */
export function freshSeedUrl(s: FreshSeed, page: number): string {
  const path = s.district ? s.district.path : `/bat-dong-san/${PROPERTY_TYPES[APARTMENT_TYPE].listSlug}-${CITIES[s.city].slug}`
  const q = [`sort=${FRESH_SORT}`]
  if (s.band) q.push(`price=${priceRange(s.band).join('-')}`)
  if (page > 1) q.push(`page=${page}`)
  return `${ORIGIN}${path}?${q.join('&')}`
}

/**
 * The city page's district lists (`quicklink.district.items`) as seeds. ⛔ null when absent or when ANY
 * entry is not a plain apartment-list path of this city — a skipped district would be a hole the
 * parts-sum check has to catch; refusing the list outright is clearer.
 */
export function districtSeeds(pageProps: any, city: CityKey): FreshSeed[] | null {
  const items = pageProps?.quicklink?.district?.items
  if (!Array.isArray(items) || !items.length) return null
  const re = new RegExp(`^/bat-dong-san/${PROPERTY_TYPES[APARTMENT_TYPE].listSlug}-[a-z0-9-]+-${CITIES[city].slug}$`)
  const out: FreshSeed[] = []
  for (const d of items) {
    const id = Number(d?.id)
    if (!Number.isSafeInteger(id) || id <= 0 || typeof d?.url !== 'string' || !re.test(d.url)) return null
    if (!out.some((o) => o.district!.id === id)) out.push({ city, district: { id, path: d.url }, band: null })
  }
  return out
}

/** The parts a seed splits into: a city by its districts (when the page lists them), anything else by price. */
export function splitSeed(s: FreshSeed, pageProps: any): FreshSeed[] | null {
  if (!s.district && !s.band) {
    const ds = districtSeeds(pageProps, s.city)
    if (ds) return ds
  }
  const halves = splitBand(s.band)
  return halves ? halves.map((band) => ({ ...s, band })) : null
}

/**
 * ⛔ THE PAGE MUST BE THE LIST WE ASKED FOR: rentals, apartments, this city, this district (or none),
 * this price band (or none), price order. A redirect to a broader list, or a filter muaban stopped
 * honouring, would otherwise pass another list's cards — and its total — off as this seed's.
 */
export function seedEchoProblem(pageProps: any, s: FreshSeed): string | null {
  const f = pageProps?.filterResult?.filters
  if (!f) return 'the page echoes no filters'
  if (f.subcategory_id?.id !== RENT_SUBCATEGORY_ID) return `not the rentals list (subcategory ${JSON.stringify(f.subcategory_id?.id)})`
  if (f.city_id?.id !== CITIES[s.city].sourceId) return `city ${JSON.stringify(f.city_id?.id)}, expected ${CITIES[s.city].sourceId}`
  if (f.property_type?.id !== APARTMENT_TYPE) return `property_type ${JSON.stringify(f.property_type?.id)}, expected ${APARTMENT_TYPE}`
  if (f.sort?.id !== FRESH_SORT) return `sort ${JSON.stringify(f.sort?.id)}, expected ${FRESH_SORT}`
  if (s.district ? f.district_id?.id !== s.district.id : f.district_id !== undefined) return `district ${JSON.stringify(f.district_id?.id ?? null)}, expected ${s.district?.id ?? 'none'}`
  if (s.band) {
    const [lo, hi] = priceRange(s.band)
    if (f.price?.min !== lo || f.price?.max !== hi) return `price ${JSON.stringify([f.price?.min, f.price?.max])}, expected ${lo}-${hi}`
  } else if (f.price !== undefined) return 'a price filter we did not ask for'
  return null
}

/** One page of a list being read to its end: go on, the end (a short or empty page), or the source's page cap (a repeat). */
export function leafPageVerdict(ids: readonly number[], prevIds: readonly number[] | null): 'next' | 'end' | 'repeat' {
  if (prevIds && ids.length && ids.length === prevIds.length && ids.every((x, i) => x === prevIds[i])) return 'repeat'
  return ids.length < PAGE_SIZE ? 'end' : 'next'
}

/**
 * ⛔ A LIST READ TO ITS END STILL HAS TO ADD UP: its distinct ids must reach the total it reported on its
 * first AND its last page. A card that moved behind the reader (an ad deleted from an earlier page shifts
 * the next one back onto it; an ad leaving the live block) shows as a shortfall, and the list is re-read.
 */
export function leafProblem(distinct: number, firstTotal: number, lastTotal: number): string | null {
  const need = Math.max(firstTotal, lastTotal)
  return distinct >= need ? null : `${distinct} distinct cards read, the list reported ${firstTotal === lastTotal ? firstTotal : `${firstTotal} then ${lastTotal}`}`
}

/**
 * ⛔ THE PARTS MUST ADD UP TO THE WHOLE: a split is proven only when its parts' totals sum to at least the
 * parent's — read once before the parts and once after (min: an ad removed in between is not a hole).
 * An ad in no part (no district, a price outside every band) is exactly what this catches.
 */
export function splitProblem(partsTotal: number, before: number, after: number): string | null {
  const need = Math.min(before, after)
  return partsTotal >= need ? null : `the parts total ${partsTotal}, the whole ${before === after ? before : `${before}→${after}`} — ${need - partsTotal} card(s) in no part`
}

export type CreatedVerdict = { kind: 'fresh'; sourceDate: string } | { kind: 'old'; clearlyOld: boolean } | { kind: 'unknown'; why: string }

/**
 * One ad's age under the 7-day rule, from its detail page's `created_at` (precise to the microsecond,
 * +07:00 — not day-granular, so its worst case is itself). `setAt` is the moment the fresh set describes
 * (the crawl's start); an ad created after it (posted mid-crawl) is dated `setAt` — older, never newer.
 * Unreadable (incl. NO explicit `Z`/`±hh:mm` offset — parseZonedInstant), implausible, or later than the
 * read itself (beyond clock skew) → unknown: not knowing is not evidence of age, so the expiry keeps it.
 */
export function judgeCreated(createdAt: string | undefined, readAt: number, setAt: number): CreatedVerdict {
  const t = parseZonedInstant(createdAt)
  if (!Number.isFinite(t) || t < MIN_SOURCE_POSTED_AT) return { kind: 'unknown', why: `created_at ${JSON.stringify(createdAt ?? null)} unreadable` }
  if (t > readAt + SKEW_MS) return { kind: 'unknown', why: `created_at ${createdAt} is after the page was read` }
  const d = new Date(Math.min(t, setAt))
  if (isInWindow(d, setAt)) return { kind: 'fresh', sourceDate: d.toISOString() }
  return { kind: 'old', clearlyOld: t < setAt - (FRESH_DAYS + FLOOR_MARGIN_DAYS) * DAY_MS }
}

/**
 * ⛔ THE ID FLOOR, CALIBRATED FROM DETAIL PAGES, NEVER ASSUMED. Fed the verdicts walking card ids
 * DOWNWARD; once FLOOR_CONFIRM consecutive cards are clearly old (created over FLOOR_MARGIN_DAYS before
 * the window opens), the floor is the LOWEST of them: since ids rise with created_at, every lower id was
 * created earlier still, so it needs no detail request. The floor therefore sits at least a day below the
 * window's true edge. Unknown verdicts neither count nor break a run; a fresh or recently-old one resets it.
 */
export class IdFloor {
  floor: number | null = null
  /** created_at of the card that set the floor (evidence for the coverage line). */
  floorCreated: string | null = null
  private run: number[] = []
  private last = Infinity
  constructor(private readonly confirm = FLOOR_CONFIRM) {}
  observe(id: number, v: CreatedVerdict, createdAt?: string): void {
    if (id > this.last) throw new Error(`IdFloor: ids must be fed in descending order (${id} after ${this.last})`)
    this.last = id
    if (this.floor !== null || v.kind === 'unknown') return
    if (v.kind === 'old' && v.clearlyOld) {
      this.run.push(id)
      if (this.run.length >= this.confirm) { this.floor = id; this.floorCreated = createdAt ?? null }
    } else this.run = []
  }
  /** Old by the floor alone. */
  below(id: number): boolean {
    return this.floor !== null && id < this.floor
  }
}

export type FreshSeedReport = { city: CityKey; label: string; ok: boolean; why?: string; total: number; pages: number; split: boolean }

/** The read-only db net (FreshCrawler.dbNet): what it had to read, and what the pages said. */
export type DbNetReport = {
  /** Live apartment rows of this seller at or above the floor (or all of them, with no floor). */
  aboveFloor: number
  /** Of those, on no list page — each read on its own page. */
  unlisted: number
  /** Live rows BELOW the floor whose postedAt is inside the window — each read: the floor's per-run evidence. */
  recentBelow: number
  /** unlisted + recentBelow; over DB_RECHECK_MAX → nothing is read and the set is refused. */
  toRead: number
  /** Pages actually read. */
  read: number
  /** Unlisted rows whose page answered 200 and is still LIVE there — real holes in the lists. */
  missed: number
  /** Answered 404/410 (deleted at the source — churn, not a hole). */
  gone: number
  /** Answered 200 but expired / out of date / unpublished at the source — not a hole either. */
  inactive: number
  /** Could not be judged (no link, a 5xx, a page about another ad) — kept live, counted as undetermined. */
  unknown: number
  /** recentBelow rows whose page says created inside the window — the floor alone would have called them old. */
  floorBreaks: number
}

export type FreshCoverage = {
  seeds: FreshSeedReport[]
  /** A challenge, a 429 or a robots refusal ended the crawl. */
  stopped: string | null
  floor: number | null
  floorCreated: string | null
  detailCapHit: boolean
  cards: number
  belowFloor: number
  details: { read: number; fresh: number; old: number; gone: number; unknown: number }
  /** Walked detail pages whose created_at is over FLOOR_MARGIN_DAYS EARLIER than a lower id's (idOrderInversions). */
  inversions: number
  /** Pages (list or detail) read a second time after a status 0 / 5xx. */
  retries: number
  /** null until the db net ran. */
  db: DbNetReport | null
}

/** The list half of the verdict: every city read, every seed whole, the floor formed, nothing stopped. */
export function listsProblem(c: Omit<FreshCoverage, 'db'>): string | null {
  if (c.stopped) return `the crawl stopped: ${c.stopped}`
  for (const city of Object.keys(CITIES) as CityKey[]) {
    if (!c.seeds.some((s) => s.city === city)) return `no list of ${city} was read`
  }
  const bad = c.seeds.find((s) => !s.ok)
  if (bad) return `${bad.label}: ${bad.why ?? 'not read whole'}`
  if (c.detailCapHit) return `over ${MAX_FRESH_DETAILS} detail pages without ${FLOOR_CONFIRM} consecutive cards created before the window — the id floor never formed`
  return null
}

/**
 * ⛔ WHEN THE SET MAY BE WRITTEN. The lists (listsProblem), then the db net: it must have run, within its
 * read budget, and found few held rows that are LIVE at the source yet on no list page. Any failure → the
 * reason, and no set (the expiry then keeps everything; the backstop still runs).
 */
export function freshCoverageProblem(c: FreshCoverage): string | null {
  const lists = listsProblem(c)
  if (lists) return lists
  if (!c.db) return 'the read-only db net did not run'
  // ⛔ The id floor skips every lower id unread on the premise that ids rise with created_at. One inversion
  // seen this run means that premise failed, and fresh ads below the floor may have been skipped unseen.
  if (c.inversions > 0) return `${c.inversions} id/created_at inversion(s) over ${FLOOR_MARGIN_DAYS} day(s) among the pages read — the id floor cannot be trusted this run`
  if (c.db.toRead > DB_RECHECK_MAX) {
    return `${c.db.toRead} held rows need their own page read (${c.db.unlisted} above the id floor on no list page, ${c.db.recentBelow} below it dated within the window) — over ${DB_RECHECK_MAX}; nothing was read`
  }
  if (c.db.missed > Math.max(DB_MISS_MAX, DB_MISS_MAX_SHARE * c.db.aboveFloor)) {
    return `${c.db.missed} of ${c.db.aboveFloor} live rows above the id floor are live at the source yet on no list page — the lists are not whole`
  }
  return null
}

/** The set's `coverage` line: the evidence, concretely, for whoever reads the set (and the expiry log). */
export function freshCoverageEvidence(c: FreshCoverage): string {
  const cities = (Object.keys(CITIES) as CityKey[]).map((city) => {
    const mine = c.seeds.filter((s) => s.city === city)
    const leaves = mine.filter((s) => !s.split)
    const splits = mine.filter((s) => s.split)
    const top = mine.find((s) => s.label === city)
    return `${city} ${top?.total ?? '?'} cards: ${leaves.length} list(s) read to their last page (${leaves.reduce((n, s) => n + s.pages, 0)} pages, each ≤ ${LEAF_MAX} cards, distinct kept ids ≥ reported total)${splits.length ? `, ${splits.length} split(s) whose parts summed to the whole` : ''}`
  })
  const d = c.details
  const db = c.db
  return [
    `muaban apartment rentals (property_type ${APARTMENT_TYPE}), price order: ${cities.join('; ')}${c.retries ? ` (${c.retries} page(s) re-read after a timeout/5xx)` : ''}`,
    `${c.cards} distinct cards; detail page (created_at) read for every card ${c.floor !== null ? `with id ≥ ${c.floor}` : '(no floor)'}: ${d.read} read — ${d.fresh} created within ${FRESH_DAYS} days, ${d.old} older, ${d.gone} gone, ${d.unknown} undetermined; ${c.inversions} id/created_at inversion(s) over ${FLOOR_MARGIN_DAYS} day(s) among them`,
    c.floor !== null
      ? `${c.belowFloor} cards below the floor judged older without a request: ids rise with created_at and the floor is the lowest of ${FLOOR_CONFIRM} consecutive cards created over ${FLOOR_MARGIN_DAYS} day(s) before the window (floor card created ${c.floorCreated ?? '?'})`
      : 'no id floor: every card\'s detail page was read',
    db
      ? `db net: ${db.unlisted} of ${db.aboveFloor} live rows above the floor were on no list page and ${db.recentBelow} live rows below it carry a postedAt inside the window — all ${db.read} read on their own page: ${db.missed} live there (list holes), ${db.inactive} expired there, ${db.gone} gone, ${db.unknown} undetermined; ${db.floorBreaks} below the floor were in fact fresh (kept)`
      : 'db net: not run',
  ].join('. ')
}

export const freshItemOf = (sourceId: number, sourceDate: string): FreshItem => ({ externalId: `${EXTERNAL_PREFIX}:${sourceId}`, sourceDate, dateKind: 'created' })

/**
 * The set, built and then checked by the SAME validator the expiry runs on it (freshSetProblem) — so a
 * set this run would refuse is never written. An id judged fresh is never also listed as undetermined.
 */
export function buildFreshSet(setAt: Date, coverage: string, items: FreshItem[], unknownIds: number[], now: number = Date.now()): { set: FreshSet; problem: null } | { set: null; problem: string } {
  const fresh = new Set(items.map((i) => i.externalId))
  const unknown = [...new Set(unknownIds.map((id) => `${EXTERNAL_PREFIX}:${id}`))].filter((x) => !fresh.has(x))
  const set = makeFreshSet(SELLER_ID, setAt, coverage, items, unknown)
  const problem = freshSetProblem(set, now, SELLER_ID)
  return problem ? { set: null, problem } : { set, problem: null }
}

/**
 * What --apply does to an EXISTING row beyond the text refresh. `revive`: an apartment row the rule took
 * down (REVIVABLE_STATUSES — never hidden/removed/sold) whose ad maps again, i.e. its created_at is inside
 * this run's window (mapRecord refuses it otherwise). `redate`: postedAt becomes the source date — on a
 * revival, and whenever the source date is NEWER than the stored one (a re-post); rankScore follows it
 * (createOnlyFields). A re-dated row is written even when every text field is unchanged.
 */
export function existingRowPlan(row: Pick<MappedRow, 'postedAt' | 'mutable'>, ex: { status: string; postedAt: Date }): { revive: boolean; redate: boolean } {
  const revive = row.mutable.subcategorySlug === APARTMENT_SUBCAT && (REVIVABLE_STATUSES as readonly string[]).includes(ex.status)
  return { revive, redate: revive || row.postedAt.getTime() > ex.postedAt.getTime() }
}

// ─── The fresh crawl itself: orchestration over an INJECTED page getter (tested against fake pages) ───

/**
 * ⛔ Thrown by a page getter to END a crawl — a bot challenge, a 429, robots.txt, a host off the pin. It is
 * never read as one page's failure: the crawl stops where it is, and freshCoverageProblem refuses the set.
 */
export class Infeasible extends Error {}

/** One GET as the crawl sees it: the HTTP status (0 = network error / timeout) and the page's __NEXT_DATA__ (null unless 200). */
export type GetPage = (url: string) => Promise<{ status: number; data: any | null }>

/** A list- or detail-page answer worth exactly one more read (after the getter's politeness gap): none at all, or a 5xx. */
export const isTransient = (status: number): boolean => status === 0 || status >= 500

/** A live apartment row this seller holds, as the db net reads it (read-only). */
export type HeldRow = { externalId: string | null; affiliateUrl: string | null; postedAt: Date }
export type DbNetPlan = { aboveFloor: number; unlisted: { id: number; url: string | null }[]; recentBelow: { id: number; url: string | null }[] }

/**
 * Which held rows the db net must read on their own page, and why:
 *   · at or above the floor and on NO list page — the lists may have a hole (a card paginated past mid-read,
 *     an ad in no district): its page says whether it is fresh, and whether it is a hole at all;
 *   · BELOW the floor with a postedAt inside the window — ⛔ THE FLOOR'S PER-RUN EVIDENCE. The floor says
 *     "older" by id alone, which holds only while ids rise with created_at. A row's postedAt is never earlier
 *     than its ad's created_at (create and revival write created_at itself; a re-date only moves it later; the
 *     legacy rows carry publish_at, which is later still), so every row we hold that COULD be fresh has a
 *     recent postedAt, and is read rather than trusted to the floor. An unreadable postedAt is read too.
 * Rows whose externalId is not a muaban id are not this crawl's to judge (as before).
 */
export function planDbNet(rows: readonly HeldRow[], o: { floor: number | null; listed: ReadonlySet<number>; setAt: number }): DbNetPlan {
  const windowStart = o.setAt - FRESH_DAYS * DAY_MS
  const plan: DbNetPlan = { aboveFloor: 0, unlisted: [], recentBelow: [] }
  for (const r of rows) {
    const ext = String(r.externalId ?? '')
    const id = ext.startsWith(`${EXTERNAL_PREFIX}:`) ? Number(ext.slice(EXTERNAL_PREFIX.length + 1)) : NaN
    if (!Number.isSafeInteger(id) || id <= 0) continue
    const url = affiliateUrlFor(id, r.affiliateUrl)
    if (o.floor !== null && id < o.floor) {
      if (!(r.postedAt.getTime() < windowStart)) plan.recentBelow.push({ id, url })
      continue
    }
    plan.aboveFloor++
    if (!o.listed.has(id)) plan.unlisted.push({ id, url })
  }
  return plan
}

/**
 * Per-run evidence on the id order the floor rests on: how many read (id, created_at) pairs carry a
 * created_at over `marginMs` EARLIER than some LOWER id's — the shape of a cloned or migrated ad, a high id
 * with an old date, which is what would set a floor too high. Reported in the set's coverage line; the db
 * net's below-floor reads are what protect the rows we hold.
 */
export function idOrderInversions(pairs: readonly (readonly [number, number])[], marginMs: number = FLOOR_MARGIN_DAYS * DAY_MS): number {
  let maxBelow = -Infinity
  let n = 0
  for (const [, t] of [...pairs].sort((a, b) => a[0] - b[0])) {
    if (maxBelow - t > marginMs) n++
    maxBelow = Math.max(maxBelow, t)
  }
  return n
}

type Head = { ok: true; pp: any; total: number; items: any[] } | { ok: false; why: string }
type Card = { raw: any; city: CityKey }
type Tally = { read: number; fresh: number; old: number; gone: number; unknown: number }
type DetailRead = { verdict: CreatedVerdict | 'gone'; detail: MuabanDetail | null; status: number; liveness: Liveness }

export type FreshCrawlOptions = {
  cities: readonly CityKey[]
  /** The clock (epoch ms) — the set's moment is its value when the crawler is built. */
  now?: () => number
  log?: (line: string) => void
  /** Each staged record (a card with its detail page), as it is made — the importer appends it to the stage. */
  onRecord?: (r: StagedRecord) => void
  onDrop?: (k: 'gone' | 'detailHttp' | 'detailParse') => void
}

/**
 * ⛔ THE FRESH SET'S CRAWL: EVERY apartment card of every city, then a detail page for every card above
 * the id floor, then (dbNet) the held rows the lists and the floor cannot vouch for. The measurements behind
 * each step are in "THE 7-DAY RULE" above.
 *   1. Each city's apartment list, price-ordered. Over LEAF_MAX cards → split (a city by its districts,
 *      anything else by price): the parts' page 1 in one sweep, then the whole re-read, and the parts must
 *      add up to the whole (splitProblem). At or under LEAF_MAX → read to its last page, and its distinct
 *      KEPT ids (this city's apartments only — an injected off-filter card never pads the count) must reach
 *      its reported total (leafProblem) — else it is read once more. A list page that answers 0 / 5xx is
 *      read once more before it fails its seed (isTransient).
 *   2. Every card, highest id first: its detail page's created_at says fresh / old / undetermined, until the
 *      IdFloor forms; every lower id is older without a request. A detail page that answers 0 / 5xx is read
 *      once more (the db net's reads too) before it is undetermined.
 * A list that fails ends the list phase (no detail request is spent on a set that cannot be written); an
 * Infeasible from the getter stops the crawl. freshCoverageProblem then decides. Every detail page read for
 * a listed card is staged (with this crawl's setAt); the apply's mapRecord drops the old ones as 'window'.
 */
export class FreshCrawler {
  /** The moment the set describes — its fetchedAt — and the moment every window is judged at. */
  readonly setAt: number
  readonly seeds: FreshSeedReport[] = []
  readonly cards = new Map<number, Card>()
  readonly records: StagedRecord[] = []
  readonly items = new Map<number, FreshItem>()
  readonly unknown = new Set<number>()
  readonly floor = new IdFloor()
  readonly details: Tally = { read: 0, fresh: 0, old: 0, gone: 0, unknown: 0 }
  pages = 0
  retries = 0
  offSeed = 0
  belowFloor = 0
  detailCapHit = false
  stopped: string | null = null
  db: DbNetReport | null = null
  private readonly dated: [number, number][] = []
  private readonly now: () => number
  private readonly log: (line: string) => void

  constructor(private readonly get: GetPage, private readonly o: FreshCrawlOptions) {
    this.now = o.now ?? Date.now
    this.log = o.log ?? (() => {})
    this.setAt = this.now()
  }

  /** Every card id a list showed (its age is settled by its detail page, or by the floor). */
  get listed(): ReadonlySet<number> { return new Set(this.cards.keys()) }

  coverage(): FreshCoverage {
    return {
      seeds: this.seeds, stopped: this.stopped, floor: this.floor.floor, floorCreated: this.floor.floorCreated,
      detailCapHit: this.detailCapHit, cards: this.cards.size, belowFloor: this.belowFloor, details: { ...this.details },
      inversions: idOrderInversions(this.dated), retries: this.retries, db: this.db && { ...this.db },
    }
  }

  /** Steps 1 and 2. Never throws an Infeasible: it becomes `stopped`. */
  async run(): Promise<this> {
    try {
      let whole = true
      for (const city of this.o.cities) {
        if (!(await this.expand({ city, district: null, band: null }))) { whole = false; break }
      }
      this.log(`fresh crawl       ${this.pages} list pages, ${this.cards.size} apartment cards${this.offSeed ? ` (${this.offSeed} off-filter card slots not counted)` : ''}${whole ? '' : ' — ⛔ a list was not read whole; no detail pages requested'}`)
      if (whole) await this.walk()
    } catch (e) {
      if (!(e instanceof Infeasible)) throw e
      this.stopped = e.message
    }
    return this
  }

  /** One list page of a seed, its echo checked; a status 0 / 5xx is read once more first. */
  async head(seed: FreshSeed, page = 1): Promise<Head> {
    const url = freshSeedUrl(seed, page)
    let got = await this.get(url)
    this.pages++
    if (isTransient(got.status)) {
      this.retries++
      this.log(`  ↻ ${seedLabel(seed)} page ${page}: HTTP ${got.status} — reading it once more`)
      got = await this.get(url)
      this.pages++
    }
    const pp = got.data?.props?.pageProps
    if (got.status !== 200 || !pp) return { ok: false, why: `HTTP ${got.status} on page ${page}` }
    const echo = seedEchoProblem(pp, seed)
    if (echo) return { ok: false, why: `${echo} (page ${page})` }
    const total = Number(pp.classified?.total)
    if (!Number.isSafeInteger(total) || total < 0) return { ok: false, why: `no total on page ${page}` }
    const list = pp.classified?.items
    return { ok: true, pp, total, items: Array.isArray(list) ? list : [] }
  }

  /**
   * A page's card ids: `all` (every slot, for the page verdict — a short page ends the list, a repeat is the
   * cap) and `kept` (this seed's city and apartment type, with a real id — the only ones that count toward
   * the list's total and go on to be judged).
   */
  keep(seed: FreshSeed, list: readonly any[]): { all: number[]; kept: number[] } {
    const all: number[] = []
    const kept: number[] = []
    for (const it of list) {
      const id = Number(it?.id)
      all.push(id)
      if (!Number.isSafeInteger(id) || id <= 0 || Number(it?.city_id) !== CITIES[seed.city].sourceId || Number(it?.property_type) !== APARTMENT_TYPE) { this.offSeed++; continue }
      kept.push(id)
      if (!this.cards.has(id)) this.cards.set(id, { raw: it, city: seed.city })
    }
    return { all, kept }
  }

  /** A list at or under LEAF_MAX, read to its last page and proven whole — or read once more, then failed. */
  async readLeaf(seed: FreshSeed, first: Extract<Head, { ok: true }>): Promise<FreshSeedReport> {
    const label = seedLabel(seed)
    let used = 0
    let why = 'not read'
    for (let attempt = 1; attempt <= 2; attempt++) {
      const h = attempt === 1 ? first : await this.head(seed)
      used++
      if (!h.ok) { why = h.why; continue }
      const seen = new Set<number>()
      let page = 1
      let pageItems = h.items
      let prev: number[] | null = null
      let lastTotal = h.total
      let fail: string | null = null
      for (;;) {
        const { all, kept } = this.keep(seed, pageItems)
        const v = leafPageVerdict(all, prev)
        if (v === 'repeat') { fail = `page ${page} repeats page ${page - 1} — the source's ${SOURCE_PAGE_CAP}-page cap`; break }
        for (const id of kept) seen.add(id)
        if (v === 'end') break
        if (page >= SOURCE_PAGE_CAP) { fail = `page ${page} is still full — past the source's ${SOURCE_PAGE_CAP}-page cap`; break }
        prev = all
        page++
        const next = await this.head(seed, page)
        used++
        if (!next.ok) { fail = next.why; break }
        lastTotal = next.total
        pageItems = next.items
      }
      fail ??= leafProblem(seen.size, h.total, lastTotal)
      if (!fail) return { city: seed.city, label, ok: true, total: lastTotal, pages: used, split: false }
      why = fail
      if (attempt === 1) this.log(`  ⚠️ ${label}: ${fail} — reading it once more`)
    }
    return { city: seed.city, label, ok: false, why, total: first.total, pages: used, split: false }
  }

  /** A seed: read whole when it fits under LEAF_MAX, else split and its parts expanded (their page 1 reused). */
  async expand(seed: FreshSeed, given?: Head): Promise<boolean> {
    const label = seedLabel(seed)
    const h = given ?? await this.head(seed)
    if (!h.ok) { this.seeds.push({ city: seed.city, label, ok: false, why: h.why, total: 0, pages: 1, split: false }); return false }
    if (h.total <= LEAF_MAX) {
      const r = await this.readLeaf(seed, h)
      this.seeds.push(r)
      return r.ok
    }
    const parts = splitSeed(seed, h.pp)
    if (!parts) { this.seeds.push({ city: seed.city, label, ok: false, why: `${h.total} cards, over ${LEAF_MAX}, and no finer split exists`, total: h.total, pages: 1, split: true }); return false }
    // The parts' page 1 in one sweep, then the whole again: the sum is judged over a minute, not the crawl.
    const heads: Head[] = []
    for (const p of parts) heads.push(await this.head(p))
    const again = await this.head(seed)
    const failed = heads.find((x): x is Extract<Head, { ok: false }> => !x.ok)
    const sum = heads.reduce((n, x) => n + (x.ok ? x.total : 0), 0)
    const why = failed ? `a part failed: ${failed.why}` : !again.ok ? `re-read failed: ${again.why}` : splitProblem(sum, h.total, again.total)
    this.seeds.push({ city: seed.city, label, ok: !why, ...(why ? { why } : {}), total: h.total, pages: 2, split: true })
    this.log(`  ${label}: ${h.total} cards → ${parts.length} parts (Σ ${sum}${again.ok ? `, whole re-read ${again.total}` : ''})${why ? ` ⛔ ${why}` : ''}`)
    if (why) return false
    for (const [i, p] of parts.entries()) if (!(await this.expand(p, heads[i]))) return false
    return true
  }

  /** Step 2: every card's detail page, highest id first, until the floor forms (or MAX_FRESH_DETAILS). */
  async walk(): Promise<void> {
    for (const id of [...this.cards.keys()].sort((a, b) => b - a)) {
      if (this.floor.below(id)) { this.belowFloor++; continue }
      if (this.details.read >= MAX_FRESH_DETAILS) { this.detailCapHit = true; break }
      const card = this.cards.get(id)!
      const url = sourcePageUrl(id, card.raw?.url)
      if (!url) { this.unknown.add(id); this.details.unknown++; continue }
      const j = await this.readCreated(id, url, this.details)
      if (j.verdict === 'gone') continue
      this.floor.observe(id, j.verdict, j.detail?.created_at)
      const t = parseZonedInstant(j.detail?.created_at)
      if (Number.isFinite(t)) this.dated.push([id, t])
      // ⛔ An ad the source itself shows as inactive (expired, unpublished) is not live there, however new:
      // in the set it would keep eno's row active. It is simply not fresh.
      if (j.verdict.kind === 'fresh' && j.liveness !== 'inactive') this.items.set(id, freshItemOf(id, j.verdict.sourceDate))
      else if (j.verdict.kind === 'unknown') this.unknown.add(id)
      if (j.detail) this.stage(card, j)
      if (this.details.read % 100 === 0) this.log(`  ${this.details.read} detail pages (${this.details.fresh} fresh), at id ${id}`)
    }
  }

  /**
   * ⛔ THE SAFETY NET UNDER THE LISTS AND THE FLOOR, over the rows WE hold (the expiry acts on nothing else):
   * planDbNet's rows, each read on its own page and judged exactly as the walk judges — but only within
   * DB_RECHECK_MAX reads, and not at all when the lists already failed. Only an unlisted row whose page
   * answers 200 and is still LIVE there counts as a hole in the lists (a 404/410 is a deleted ad; an expired
   * one is over); a below-floor row its page calls fresh is kept and counted as a floor break.
   */
  async dbNet(rows: readonly HeldRow[]): Promise<DbNetReport> {
    const plan = planDbNet(rows, { floor: this.floor.floor, listed: this.listed, setAt: this.setAt })
    const db: DbNetReport = {
      aboveFloor: plan.aboveFloor, unlisted: plan.unlisted.length, recentBelow: plan.recentBelow.length,
      toRead: plan.unlisted.length + plan.recentBelow.length, read: 0, missed: 0, gone: 0, inactive: 0, unknown: 0, floorBreaks: 0,
    }
    this.db = db
    this.log(`db check          ${rows.length} live apartment rows; ${db.aboveFloor} at or above the floor, ${db.unlisted} of them on no list page; ${db.recentBelow} below the floor with a postedAt inside the window${db.toRead ? ` — ${db.toRead} to read on their own page` : ''}`)
    if (listsProblem(this.coverage()) || db.toRead > DB_RECHECK_MAX) return db
    const tally: Tally = { read: 0, fresh: 0, old: 0, gone: 0, unknown: 0 }
    const jobs = [...plan.unlisted.map((m) => ({ ...m, below: false })), ...plan.recentBelow.map((m) => ({ ...m, below: true }))]
    try {
      for (const m of jobs) {
        const card = this.cards.get(m.id)
        const url = (card ? sourcePageUrl(m.id, card.raw?.url) : null) ?? m.url
        if (!url) { this.unknown.add(m.id); db.unknown++; continue }
        const j = await this.readCreated(m.id, url, tally)
        db.read++
        if (j.verdict === 'gone') { db.gone++; continue }
        if (j.liveness === 'inactive') db.inactive++
        else if (j.liveness === 'alive' && !m.below) db.missed++
        if (j.verdict.kind === 'fresh' && j.liveness !== 'inactive') { this.items.set(m.id, freshItemOf(m.id, j.verdict.sourceDate)); if (m.below) db.floorBreaks++ }
        else if (j.verdict.kind === 'unknown') { this.unknown.add(m.id); db.unknown++ }
        if (card && j.detail) this.stage(card, j)
      }
    } catch (e) {
      if (!(e instanceof Infeasible)) throw e
      this.stopped = e.message
    }
    return db
  }

  /**
   * One ad's detail page → its created_at verdict at the set's moment ('gone' on 404/410), and its liveness
   * there. A status 0 / 5xx is read once more first (isTransient) — after the getter's own per-host
   * politeness gap, exactly as a list page is — and counted in `retries`; `tally.read` counts the ad once.
   */
  private async readCreated(id: number, url: string, tally: Tally): Promise<DetailRead> {
    let got = await this.get(url)
    if (isTransient(got.status)) {
      this.retries++
      this.log(`  ↻ detail id ${id}: HTTP ${got.status} — reading it once more`)
      got = await this.get(url)
    }
    tally.read++
    if (got.status === 404 || got.status === 410) { tally.gone++; this.o.onDrop?.('gone'); return { verdict: 'gone', detail: null, status: got.status, liveness: 'gone' } }
    if (got.status !== 200) { tally.unknown++; this.o.onDrop?.('detailHttp'); return { verdict: { kind: 'unknown', why: `HTTP ${got.status}` }, detail: null, status: got.status, liveness: 'unknown' } }
    const c = got.data?.props?.pageProps?.classified
    if (!c || Number(c.id) !== id) { tally.unknown++; this.o.onDrop?.('detailParse'); return { verdict: { kind: 'unknown', why: 'page is not this listing' }, detail: null, status: got.status, liveness: 'unknown' } }
    const detail = stageDetail(c)
    const verdict = judgeCreated(detail.created_at, this.now(), this.setAt)
    tally[verdict.kind]++
    return { verdict, detail, status: got.status, liveness: livenessVerdict(id, got.status, got.data).verdict }
  }

  /** A listed card with its detail page → a staged record carrying this crawl's setAt. */
  private stage(card: Card, j: DetailRead): void {
    const rec: StagedRecord = {
      v: 1, fetchedAt: new Date(this.now()).toISOString(), setAt: new Date(this.setAt).toISOString(),
      seed: { city: card.city, type: APARTMENT_TYPE }, item: stageItem(card.raw), detail: j.detail, detailStatus: j.status,
    }
    this.records.push(rec)
    this.o.onRecord?.(rec)
  }
}
