/**
 * LINKED JOB POSTINGS → eno REFERENCE LISTINGS: the pure half of scripts/import-jobs.ts (unit-tested
 * in job-listing.test.ts). The script owns the database, storage and the staged file; this module
 * decides what a staged job becomes, and refuses what it must not become.
 *
 * Owner, 2026-09-25: English-teaching jobs in Vietnam (and jobs for English speakers) from the last
 * 7 days, "with links so users apply at source", uploaded to eno.vn with a relevant image. The jobs
 * are fetched and staged by the lead pipeline (~/eno-lead-pipeline: fetchJobs → exportJobs), from
 * boards whose terms allow republishing FACTS — title, employer, place, pay, dates, link — never the
 * posting's text. The cover is drawn from those facts; no employer logo or photo is copied.
 *
 * Same contract as the rental reference importers (import-rever-rentals.ts, honeycomb): outbound
 * `affiliateUrl` (the PDP's Apply button; no chat — /api/conversations refuses these rows),
 * `negotiable:false`, ownerless seller pinned by id and refused if renamed/owned/badged,
 * `status`/`verified`/`images`/`postedAt`/`rankScore` create-only. What is specific to jobs:
 *
 * ⛔ 1. A CLOSED MAP OF BOARDS. A staged `source` that is not in JOB_SOURCES is refused, never turned
 *    into a new seller — a typo or a new pipeline source must not create an unreviewed shop on prod.
 *    Each board pins the hosts its links may point at.
 * ⛔ 2. externalId = `<board>:<the board's own job id>`, from the NORMALISED url (tracking params,
 *    fragment and trailing slash stripped), so the same posting re-staged with `?utm=…` is one row.
 * ⛔ 3. THE SOURCE'S WORDS ARE SCREENED like a seller's own post (publish-guard assertCleanTexts:
 *    phone, email, link, handle, banned words) plus a job denylist (discriminatory requirements,
 *    adult-venue work, fees). A hit drops the row; nothing is "cleaned" and published. The visa
 *    screen (read word by word there: hasEmployerVisaWord) and the denylist also refuse the text of a hiring post an
 *    employer writes on eno (jobTextProblem).
 * ⛔ 4. EVERY ROW HAS AN apply-by DATE: the posting's own deadline, capped at 14 days after it was posted
 *    (owner, 2026-09-25: "after 14 days posting autoremove the jobs and fetch fresh ones to have only high
 *    quality existing jobs").
 *    The PDP's Apply button closes itself on that date (JobApplyGuard) and `--expire` hides the row;
 *    a row already past it is never created.
 * ⚠️ 5. PAY: ONE stated VND amount per month or per hour becomes the price. A RANGE does not — a card
 *    reading "10,000,000 đ / month" for a 10–30 tr job states its floor as the pay, and "from …" does
 *    not fit the card's measured one-line price slot (listing-card.tsx). A range, "up to", USD or no
 *    pay at all is price 0, which <Price> labels "Salary: see details" on a job; the posting's own
 *    wording is kept verbatim in `attributes.salaryText` (PDP Details and <title>). A monthly VND
 *    figure still sets `salaryM` (a range's lower bound) so the Salary filter finds the job.
 */
import { assertCleanTexts, PublishBlockedError, type JobTextBlockCode } from './publish-guard'
import { buildSearchText, fold } from './fold'
import { richTextBlocks } from './rich-text-blocks'

export type JobCategory = 'teaching' | 'english'

/** One staged job, as ~/eno-lead-pipeline/src/cli/exportJobs.ts writes it. */
export type StagedJob = {
  key: string
  url: string
  source: string
  sourceName?: string
  title: string
  employer: string | null
  city: string | null
  salary: string | null
  employment: string | null
  datePosted: string
  applyBy: string
  category: string
  coverPath: string
}
/**
 * `gone`: postings the pipeline RE-CHECKED at staging and found removed — 404/410, redirected off the
 * posting, or past the page's own validThrough. A POSITIVE signal, so the importer hides them now
 * rather than waiting for the 14-day cutoff. Absence from `jobs` is never a signal on its own.
 */
export type GonePosting = { url: string; source: string; reason: string }
export type JobStage = { stagedAt: string; days: number; jobs: StagedJob[]; gone?: GonePosting[] }

type Board = {
  sellerId: string; name: string; hosts: readonly string[]; id: RegExp | null
  /** A board whose jobs have no page of their own, only an anchor on one listing page (WISHlistjobs:
   *  /teaching-jobs-in-vietnam#job-post-N). The id comes from the anchor, the path is pinned by `id`, and the
   *  anchor is KEPT in the Apply link — normaliseJobUrl drops it for every other board. */
  hashId?: RegExp
}

/**
 * ⛔ THE BOARDS, CLOSED. Seller ids are literals so src/lib/import-sellers.test.ts can see them; the
 * NAME is what the Apply button says ("Apply on CareerLink.vn") and what sellerRefusal checks.
 * `id` captures the board's own job id from the url PATH; null = the last path segment.
 */
export const JOB_BOARDS = {
  careerlink: { sellerId: 'careerlink-vn-import-seller-0001', name: 'CareerLink.vn', hosts: ['www.careerlink.vn'], id: /\/(\d{5,})$/ },
  eslcafe: { sellerId: 'eslcafe-com-import-seller-0001', name: "Dave's ESL Cafe", hosts: ['www.eslcafe.com'], id: /^\/postajob-detail\/([a-z0-9-]+)$/i },
  teast: { sellerId: 'teast-co-import-seller-0001', name: 'TEAST', hosts: ['teast.co'], id: /^\/job\/([A-Za-z0-9-]+)$/ },
  vtj: { sellerId: 'vietnamteachingjobs-com-import-seller-0001', name: 'Vietnam Teaching Jobs', hosts: ['vietnamteachingjobs.com'], id: /^\/jobs\/view\/([a-z0-9-]+)$/i },
  eslgorilla: { sellerId: 'eslgorilla-com-import-seller-0001', name: 'ESLGorilla', hosts: ['eslgorilla.com'], id: /^\/jobs\/([a-z0-9-]+)$/i },
  eslboards: { sellerId: 'eslboards-com-import-seller-0001', name: 'ESL Boards', hosts: ['www.eslboards.com'], id: /^\/job\/[a-z0-9-]*?-(\d+)$/i },
  teflorg: { sellerId: 'tefl-org-import-seller-0001', name: 'The TEFL Org', hosts: ['www.tefl.org'], id: /^\/tefl-jobs-centre\/job\/([a-z0-9-]+)$/i },
  vas: { sellerId: 'vas-edu-vn-import-seller-0001', name: 'Vietnam Australia International School', hosts: ['careers.vas.edu.vn'], id: null },
  eiv: { sellerId: 'eiv-edu-vn-import-seller-0001', name: 'EIV Education', hosts: ['recruitment.eiv.edu.vn'], id: null },
  nordanglia: { sellerId: 'nordanglia-com-import-seller-0001', name: 'Nord Anglia Education', hosts: ['careers.nordanglia.com'], id: /^\/job\/[^/]+\/(\d+)$/ },
  inspired: { sellerId: 'inspirededu-com-import-seller-0001', name: 'Inspired Education', hosts: ['jobs.inspirededu.com'], id: /^\/job\/[^/]+\/(\d+)$/ },
  // Added 2026-09-25 after the coverage audit (robots allow, terms carry no reuse clause).
  vieclam24h: { sellerId: 'vieclam24h-vn-import-seller-0001', name: 'Việc Làm 24h', hosts: ['vieclam24h.vn', 'www.vieclam24h.vn'], id: /id(\d{5,})\.html$/ },
  // The requisition number, not the title slug Workday puts before it: an edited title must stay one row.
  rmit: { sellerId: 'rmit-edu-vn-import-seller-0001', name: 'RMIT University Vietnam', hosts: ['rmit.wd3.myworkdayjobs.com'], id: /^\/RMIT_Careers\/job\/[^/]+\/[^/]*_(JR\d{3,})$/ },
  tta: { sellerId: 'theteflacademy-com-import-seller-0001', name: 'The TEFL Academy', hosts: ['www.theteflacademy.com'], id: /^\/blog\/tefl-jobs\/([a-z0-9-]+)$/ },
  // ⚠️ PUBLISHED ON THE OWNER'S WORD (2026-09-27: "fpt green", "wish also green"). FPT's terms require written
  // consent and WISHlistjobs' forbid republishing without explicit permission; the permission is the owner's.
  fpt: { sellerId: 'fpt-edu-vn-import-seller-0001', name: 'FPT Education', hosts: ['career.fpt.edu.vn'], id: /^\/Job\/Detail\/(\d+)$/ },
  wish: { sellerId: 'wishlistjobs-com-import-seller-0001', name: 'WISHlistjobs', hosts: ['www.wishlistjobs.com', 'wishlistjobs.com'], id: /^\/(teaching-jobs-in-vietnam)$/, hashId: /^#job-post-(\d+)$/ },
  // Added 2026-09-27 after the source-discovery sweep: robots allows (and welcomes crawlers), no terms clause.
  tesljobs: { sellerId: 'tesljobs-com-import-seller-0001', name: 'TeslJobs', hosts: ['tesljobs.com', 'www.tesljobs.com'], id: /^\/jobs\/[a-z0-9-]*-vietnam-([A-Za-z0-9_-]{4,20})$/ },
  // ⚠️ Anchored on "-vietnam-": the id itself can hold '_' and '-' ("…-vietnam-vietnam-U_yj-lBU3SJM", 2026-09-27).
  // ⚠️ PUBLISHED ON THE OWNER'S WORD (2026-09-25: "topcv and vietnamworks have permissions"). The site terms
  // alone forbid display (vietnamworks.com/thoa-thuan-su-dung); the permission is the owner's, not the terms'.
  // The id is the number before "-jv", not the title slug before it.
  vietnamworks: { sellerId: 'vietnamworks-com-import-seller-0001', name: 'VietnamWorks', hosts: ['www.vietnamworks.com', 'vietnamworks.com'], id: /^\/[^/]+-(\d{6,9})-jv$/ },
  // Added 2026-10-12 on the owner's word ("2 yes", after the source-discovery sweep): neither site has terms of use, and
  // robots allows the job paths. ASQ is a UK recruiter for international schools — the school goes unnamed, so the
  // employer is ASQ; its id is the ReferenceNumber before ".aspx" (the slug before it can change with the title).
  asq: { sellerId: 'asq-international-com-import-seller-0001', name: 'ASQ International', hosts: ['jobs.asq-international.com'], id: /^\/job\/[^/]*-(\d{3,})\.aspx$/ },
  // Language Link Vietnam's own foreign-teacher hiring site (WordPress): the id is the job's slug, ANY slug WordPress
  // makes — underscores and (decoded) Vietnamese letters included; a narrower class refused such a job without a word
  // (gate review). A published slug survives a title edit (EIV's retitled post kept its own, 2026-10-12).
  languagelink: { sellerId: 'teachatlanguagelink-com-import-seller-0001', name: 'Language Link Vietnam', hosts: ['teachatlanguagelink.com', 'www.teachatlanguagelink.com'], id: /^\/job\/([^/]+)$/ },
  // ⚠️ PUBLISHED ON THE OWNER'S WORD (2026-10-12: "yes add them"). ESLbase's terms allow short credited extracts with a
  // link and ask for written permission beyond that — requested by email the same day; the permission is the owner's
  // until they answer, and the board comes off if they object. The id is the job's slug.
  eslbase: { sellerId: 'eslbase-com-import-seller-0001', name: 'ESLbase', hosts: ['www.eslbase.com', 'eslbase.com'], id: /^\/job\/([^/]+)$/ },
} as const satisfies Record<string, Board>
export type BoardKey = keyof typeof JOB_BOARDS

/** Pipeline source id → board. Two CareerLink searches feed one board, two Việc Làm 24h searches another.
 *  (Việc Làm 24h's earlier 403s were our own Accept header, not a block — fixed in the pipeline 2026-09-25.) */
export const JOB_SOURCES: Record<string, BoardKey> = {
  'careerlink-teach': 'careerlink', 'careerlink-english': 'careerlink',
  eslcafe: 'eslcafe', teast: 'teast', vtj: 'vtj', eslgorilla: 'eslgorilla', eslboards: 'eslboards',
  'tefl-org': 'teflorg', vas: 'vas', eiv: 'eiv', nordanglia: 'nordanglia', inspired: 'inspired',
  'vieclam24h-teach': 'vieclam24h', 'vieclam24h-english': 'vieclam24h', rmit: 'rmit', tta: 'tta',
  vietnamworks: 'vietnamworks', tesljobs: 'tesljobs', fpt: 'fpt', wish: 'wish', asq: 'asq', languagelink: 'languagelink', eslbase: 'eslbase',
}

export const JOB_SELLER_IDS: string[] = Object.values(JOB_BOARDS).map((b) => b.sellerId)

/**
 * ⛔ A LINKED JOB IS BROWSABLE BUT NOT INDEXABLE (teacher visibility plan, item 18 — owner decision 10, approved; applied
 * 2026-10-20, once the teaching board at /jobs-vietnam-expats had shipped). A linked job is what this module makes: a job
 * board's or a school's posting, copied as a few facts (title, employer, place, pay, dates) with an Apply link to the
 * original. As a page it adds nothing over the posting itself — the plan measured 7 search impressions across all 38 —
 * which is the vehicle-hire case exactly (rental-places.ts isVehicleHireReference), so it gets the same treatment: the
 * listing page serves it `noindex, follow` (generateMetadata, src/app/[lang]/listings/[id]/(pdp)/page.tsx), and no sitemap
 * lists it (`submittedListingWhere`, src/lib/sitemap.ts, submits no row with an `affiliateUrl`). What stays indexable is
 * what carries the value: the board, /c/jobs, and every job an employer posts on eno itself.
 * ⚠️ THE SHAPE, NOT THE SELLER IDS, as for vehicle hire: a JOB that LINKS OUT. The STORED link, like the sitemap's rule
 * and the board's `linked` (jobs-vietnam-expats/board.ts): a row whose link fails the page's safeAffiliateUrl is still a
 * copied posting. An employer's own post has no `affiliateUrl` (nothing a user sends can set one) and stays indexable;
 * so do a Wanted ad filed under Jobs and a teacher profile, and a link-out row of any other kind keeps its own rule.
 */
export function isLinkedJobReference(l: { affiliateUrl: string | null; listingType: string | null }): boolean {
  return !!l.affiliateUrl && l.listingType === 'job'
}

/** The row key a (source, url) pair maps to — the same key mapStagedJob gives it — or null. */
export function jobExternalId(source: string, url: string): { sellerId: string; externalId: string } | null {
  const board = JOB_SOURCES[source]
  const u = board ? normaliseJobUrl(url) : null
  const id = board && u ? jobNativeId(board, u, hashOf(url)) : null
  return board && id ? { sellerId: JOB_BOARDS[board].sellerId, externalId: `${board}:${id}` } : null
}

/** A posting stays listed at most this long after it was posted, whatever its own deadline says — owner,
 *  2026-09-25: only fresh jobs, removed 14 days after posting and replaced by the daily fetch. */
export const MAX_LISTED_DAYS = 14
/** The staged file must be this fresh for --apply (by its own `stagedAt`, not the file's mtime). */
export const STAGE_MAX_AGE_H = 72

const TRACKING = /^(utm_[a-z]+|source|ref|referrer|fbclid|gclid|mc_[a-z]+|trk|src)$/i

/** https, lower-case host, no fragment, no tracking params, no trailing slash. Null when not https. */
export function normaliseJobUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:') return null
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
  return u
}

const hashOf = (raw: string) => { try { return new URL(raw).hash } catch { return '' } }

/** The board's own id for a posting, from its normalised path (or its anchor, for a hashId board). Null = refuse the row. */
export function jobNativeId(board: BoardKey, u: URL, hash = ''): string | null {
  const b: Board = JOB_BOARDS[board]
  if (!b.hosts.includes(u.hostname)) return null
  let path: string
  try { path = decodeURIComponent(u.pathname) } catch { return null }
  const m = b.id ? b.id.exec(path) : /\/([^/]+)$/.exec(path)
  if (b.hashId && !m) return null
  const id = b.hashId ? b.hashId.exec(hash)?.[1] : m?.[1]
  return id && id.length <= 120 && !/[\s/?#]/.test(id) ? id : null
}

// ── cities ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ A PLACE → THE vn-units PROVINCE NAME (the post-2025 34 units), OR NOTHING. `city` is what the
 * province filter matches (province-match.ts), so a job stored as "Bình Dương" or "Hanoi" would drop
 * out of the filter. Former provinces map to the unit they merged into (July 2025): Bình Dương and
 * Bà Rịa–Vũng Tàu → Hồ Chí Minh, Hải Dương → Hải Phòng, Bắc Giang → Bắc Ninh, Quảng Nam → Đà Nẵng…
 * Keys are folded (no diacritics, lower case); the first place found in the text wins.
 */
const PLACES: [RegExp, string][] = ([
  ['ho chi minh|hcmc|tp ?hcm|hcm|sai ?gon|thu duc|binh duong|thu dau mot|di an|vung tau|ba ria', 'Hồ Chí Minh'],
  ['ha ?noi|gia lam', 'Hà Nội'],
  ['da ?nang|hoi an|quang nam|tam ky', 'Đà Nẵng'],
  ['hai ?phong|hai duong|thuy nguyen', 'Hải Phòng'],
  ['bac ninh|bac giang', 'Bắc Ninh'],
  ['can tho|soc trang|hau giang', 'Cần Thơ'],
  ['nha trang|khanh hoa|cam ranh|ninh thuan|phan rang', 'Khánh Hoà'],
  ['da ?lat|lam dong|dak nong|binh thuan|phan thiet|mui ne', 'Lâm Đồng'],
  ['thua thien hue|hue', 'Huế'],
  ['quy nhon|binh dinh|pleiku|gia lai', 'Gia Lai'],
  ['vinh(?! long| phuc| yen)|nghe an', 'Nghệ An'],
  ['thanh hoa', 'Thanh Hoá'],
  ['hung yen|thai binh', 'Hưng Yên'],
  ['bien hoa|dong nai|binh phuoc', 'Đồng Nai'],
  ['tay ninh|long an|tan an', 'Tây Ninh'],
  ['phu quoc|kien giang|rach gia|an giang|long xuyen', 'An Giang'],
  ['phu tho|viet tri|vinh phuc|vinh yen|hoa binh', 'Phú Thọ'],
  ['quang ninh|ha long', 'Quảng Ninh'],
  ['thai nguyen', 'Thái Nguyên'],
  ['ninh binh|nam dinh|ha nam', 'Ninh Bình'],
  ['quang ngai|kon tum', 'Quảng Ngãi'],
  ['dak lak|buon ma thuot|phu yen|tuy hoa', 'Đắk Lắk'],
  ['dong thap|tien giang|my tho', 'Đồng Tháp'],
  ['vinh long|ben tre|tra vinh', 'Vĩnh Long'],
  ['ca mau|bac lieu', 'Cà Mau'],
  ['quang tri|quang binh|dong hoi', 'Quảng Trị'],
  ['ha tinh', 'Hà Tĩnh'],
  ['lao cai|sa ?pa|yen bai', 'Lào Cai'],
] as [string, string][]).map(([k, name]) => [new RegExp(`\\b(?:${k})\\b`), name])

const foldPlace = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ')

/** Every province the text names, in order of first appearance, deduplicated. */
export function jobProvinces(...texts: (string | null | undefined)[]): string[] {
  const hits: { at: number; name: string }[] = []
  for (const t of texts) {
    if (!t) continue
    const f = ` ${foldPlace(t)} `
    for (const [re, name] of PLACES) {
      const m = re.exec(f)
      if (m && !hits.some((h) => h.name === name)) hits.push({ at: m.index, name })
    }
    if (hits.length) break // the first field that names a place decides; later fields are fallbacks
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name)
}

// ── pay ───────────────────────────────────────────────────────────────────────────────────────────
export type JobPay = { price: number; priceUnit: 'VND/month' | 'VND/hour'; salaryM: number | null } | null

const num = (s: string) => Number(s.replace(/[.,\s]/g, ''))

/** The bounds a stated amount must sit inside to be read at all: a month's pay, an hour's. */
const PAY_BOUNDS = { month: [1_000_000, 500_000_000], hour: [20_000, 5_000_000] } as const

/**
 * The one reading of a pay line both parsers share: its amounts, its period, and whether it opens with "from" / "từ" —
 * decided HERE, once, so the listing's price (parseJobPay) and the history log's range (parseJobPayRange) cannot read
 * one line two ways.
 */
function readJobPay(text: string | null | undefined): { lo: number; hi: number; period: 'month' | 'hour'; from: boolean } | null {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (/(^|[^\p{L}])(up to|tối đa|max(imum)?)(?!\p{L})/iu.test(t)) return null
  // ⚠️ `(?!\p{L})`, not `\b`: JavaScript's \b is ASCII-only, so it never matches after "đ" or "giờ".
  const m = /^(?:from |từ )?(\d[\d.,]*)(?: ?[–-] ?(\d[\d.,]*))? ?(?:vnd|vnđ|đ|₫|dong)(?!\p{L}) ?(?:\/|per|mỗi|một)? ?(month|tháng|hour|giờ|hr)(?!\p{L})/iu.exec(t)
  if (!m) return null
  const lo = num(m[1]!)
  const hi = m[2] ? num(m[2]) : lo
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null
  const period = /^(month|tháng)$/i.test(m[3]!) ? 'month' : 'hour'
  if (lo < PAY_BOUNDS[period][0] || lo > PAY_BOUNDS[period][1]) return null
  // The pattern admits "from " / "từ " only as the line's first word, so a prefix test, with the pattern's own flags, reads
  // it. ⛔ NOT `\b` (2026-10-20): parseJobPay tested /^(from|từ)\b/i on its own, and JavaScript's \b is ASCII-only — it never
  // matches after "ừ" — so it read "Từ 12.000.000 VNĐ/tháng" as an exact 12,000,000 đ while the log read "from". Latent, not
  // stored: measured that day, no pay line ever staged (48 stage files since 2026-09-25, 1,997 rows) opens with "Từ" and
  // a đồng figure — the one "Từ" line, "Từ $ 2,000 /tháng", is USD, which neither reading takes — and every mapped row came
  // out byte-identical under this fix; none of the 12 live jobs with a price states it so either.
  return { lo, hi, period, from: /^(?:from|từ) /iu.test(t) }
}

/**
 * A stated VND amount per month or per hour → what to store. Only the forms we can read without
 * guessing: "15,000,000–20,000,000 VND / month", "500.000 VNĐ/giờ", "From 12,000,000 VND/month".
 * A single amount is the price; a RANGE (or "from" / "từ") is price 0 with `salaryM` = its lower bound.
 * "Up to …" (a ceiling, not a price), USD, per day/year, or anything unparsed → null (price 0).
 */
export function parseJobPay(text: string | null | undefined): JobPay {
  const p = readJobPay(text)
  if (!p) return null
  const single = p.hi === p.lo && !p.from
  if (p.period === 'month') return { price: single ? p.lo : 0, priceUnit: 'VND/month', salaryM: Math.floor(p.lo / 1_000_000) }
  return { price: single ? p.lo : 0, priceUnit: 'VND/hour', salaryM: null }
}

/**
 * The same reading as parseJobPay, as the amounts themselves — the D3 job-ad history log's pay (src/lib/job-ad-sightings.ts),
 * never a listing's: min = the lower amount; max = the upper one, the amount itself for a single figure, and null for
 * "from <one amount>" (or an upper amount past the period's bound). Every line parseJobPay refuses is refused here too.
 */
export function parseJobPayRange(text: string | null | undefined): { min: number; max: number | null; currency: 'VND'; period: 'month' | 'hour' } | null {
  const p = readJobPay(text)
  if (!p) return null
  const openEnded = p.hi === p.lo && p.from
  return { min: p.lo, max: openEnded || p.hi > PAY_BOUNDS[p.period][1] ? null : p.hi, currency: 'VND', period: p.period }
}

/** The jobs `jobtype` facet value, from the posting's employment type (or its title). */
export function jobType(employment: string | null | undefined, title: string): string | null {
  const t = fold(`${employment ?? ''} ${employment ? '' : title}`)
  if (/part[ _-]?time|ban thoi gian/.test(t)) return 'parttime'
  if (/full[ _-]?time|toan thoi gian/.test(t)) return 'fulltime'
  if (/contract|hop dong/.test(t)) return 'contract'
  if (/temporary|thoi vu|maternity cover/.test(t)) return 'temporary'
  return null
}

// ── text ──────────────────────────────────────────────────────────────────────────────────────────
const KEEP_UPPER = new Set(['IELTS', 'TOEIC', 'TOEFL', 'ESL', 'EFL', 'TEFL', 'TESOL', 'CELTA', 'IB', 'STEM', 'TNHH', 'HCM', 'HCMC', 'TP', 'RES', 'WISE', 'AZ', 'VAS', 'EIV', 'BIS', 'BVIS', 'AIS', 'ILA', 'UK', 'US', 'USA', 'VN', 'IT', 'HR', 'CV', 'VAL', 'EAL', 'SEN', 'PE', 'ICT', 'KG'])

/** "GIÁO VIÊN TIẾNG ANH [ ĐÀ NẴNG ]" → "Giáo Viên Tiếng Anh [Đà Nẵng]". Only a SHOUTED string
 *  (mostly capitals) is recased; anything already mixed-case is left exactly as written. */
export function unshout(s: string): string {
  const clean = s.replace(/\s+/g, ' ').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
  const letters = clean.replace(/[^\p{L}]/gu, '')
  const upper = clean.replace(/[^\p{Lu}]/gu, '')
  if (letters.length < 8 || upper.length / letters.length < 0.7) return clean
  return clean.replace(/[\p{L}\p{M}]+/gu, (w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLocaleLowerCase('vi')))
}

const ABROAD = /\b(japan|korea|china|taiwan|thailand|cambodia|laos|myanmar|indonesia|malaysia|philippines|mongolia|kazakhstan|spain|madrid|barcelona|prague|czech republic|poland|italy|turkey|costa rica|mexico|colombia|chile|peru|brazil|saudi arabia|uae|dubai|qatar|kuwait|oman)\b/gi

/**
 * ⛔ WHAT A JOB AD MUST NOT SAY FOR eno.vn TO REPUBLISH IT, beyond the contact screen: a requirement
 * by race, skin colour, gender or age (Labour Code 2019 art. 8 bans discrimination in recruitment);
 * work in adult venues; and a fee or deposit to be hired — the classic job scam. Matched on the
 * FOLDED text, so diacritics cannot slip a word past it. One list, read two ways: as it stands by the
 * importer's drop (jobDenyReason, mapStagedJob below), and with honest negations ("no training fee")
 * taken out first by the employer-text screen (employerDenyReason, jobTextProblem).
 * ⛔ THE PLURAL AND THE PLAIN DEMAND COUNT TOO (round 4: the negations below already read "fees?" / "deposits?", so only
 * the honest wording was recognised, and the classic scam passed in its plainest words): "Training fees required",
 * "Registration fees apply", "Deposits required", "A deposit is required" (or "will be"), a placement or application fee
 * ("Placement fee: 500 USD", "Teachers pay a 500 USD placement fee"), a deposit stated with an amount ("A deposit of
 * 5,000,000 VND is required before you start" — up to two words before the figure: "of about 5 million", "of USD 500"),
 * and "Females only" / "Ladies only". Measured first on the importer's staged corpus (47 files, 1,962 rows, 518 distinct
 * titles, employers, pay lines, places and their joins): no JOB_DENY hit before or after, so no posting is newly dropped.
 * ⚠️ Still a word test with no sense of who pays: "The school covers all application fees" is refused, as "We pay the
 * training fee" always was — a fixable refusal (the snippet names the words).
 */
export type JobDenyReason = 'discriminatory' | 'adult-venue' | 'fee'
const JOB_DENY: [RegExp, JobDenyReason][] = [
  [/\b(caucasian|white (only|skin|faces?|teachers? only)|no (asians?|africans?|filipinos?|indians?|blacks?)|(females?|males?|women|men|ladies) only|aged? (under|below) \d{2}|under \d{2} (years old|yo)|(maximum|max) age|age limit|young and (pretty|attractive)|ngoai hinh (dep|ua nhin)|(nu|nam) duoi \d{2}|duoi \d{2} tuoi|chi tuyen (nu|nam))\b/, 'discriminatory'],
  [/\b(karaoke|massage|hostess|bar girl|escort|nightclub|tiep vien nha hang|chan dai)\b/, 'adult-venue'],
  [/\b(fees? (is |are |will be )?required|deposits? (is |are |will be )?required|deposits? of ([a-z]+ ){0,2}([a-z]{0,3}[$€£₫] ?)?\d+[a-z]*|pay (a |the )?(fees?|deposits?)|(training|registration|placement|application) fees?|phi dao tao|dat coc|nop phi|phi ho so|phi dang ky)\b/, 'fee'],
]

/** The JOB_DENY rule `text` breaks, or null — on the FOLDED text, padded so a rule can match at either end. The importer's
 *  reading: no negation is taken out (employerDenyReason is the employer screen's). */
export function jobDenyReason(text: string | null | undefined): JobDenyReason | null {
  if (!text) return null
  const folded = ` ${fold(text)} `
  for (const [re, why] of JOB_DENY) if (re.test(folded)) return why
  return null
}

export type JobDrop =
  | 'unknownSource' | 'badUrl' | 'noJobId' | 'badTitle' | 'badEmployer' | 'multiCountry' | 'badCategory'
  | 'badDate' | 'tooOld' | 'closed' | 'noCity' | 'contactInText' | 'bannedWords' | 'discriminatory' | 'adultVenue' | 'fee' | 'visaMention'

export type MappedJob = {
  board: BoardKey
  sellerId: string
  sellerName: string
  externalId: string
  affiliateUrl: string
  title: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  salaryM: number | null
  categorySlug: 'jobs'
  subcategorySlug: 'teaching' | 'job-other'
  city: string
  location: string
  attributes: Record<string, string>
  searchText: string
  postedAt: Date
  applyBy: string
  coverPath: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** The English residence phrases (hasVisaWord): words glued or joined by space, hyphen or underscore only. */
const JOIN = String.raw`[\s_-]*`
const RESIDENCE_PHRASE = new RegExp(
  `\\b(temporary|permanent)${JOIN}residen(ce|cy|t(?!ial))|\\btemporary${JOIN}stay|\\bstay${JOIN}permits?\\b|\\bresidents?['’]?${JOIN}(card|permit|status)` +
    `|\\bresiden(ce|cy)${JOIN}(card|permit|status|sponsor|authori|applic|renew|extens)`,
)
/**
 * The residence permit and card by their other names, and an extension of the stay (toned, NFC, lower case, whole words):
 * giấy phép cư trú, thẻ cư trú, gia hạn tạm trú, gia hạn lưu trú — never a bare "cư trú" / "lưu trú" ("cư trú tại Hà Nội" is
 * where a Vietnamese teacher lives, "lưu trú" a hotel stay). Added 2026-10-19 after measuring the importer's corpus: every
 * posting ever staged (47 files, 1,962 rows, 170 distinct links) and the 37 live job rows — 507 distinct titles, employers,
 * pay lines, places and descriptions — hold none of the four, so no posting the importer takes today is dropped by them.
 */
const STAY_GAP = String.raw`[^\p{L}\p{N}]*`
const FOREIGNER_STAY_PHRASE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(?:giấy${STAY_GAP}phép${STAY_GAP}cư${STAY_GAP}trú|thẻ${STAY_GAP}cư${STAY_GAP}trú|gia${STAY_GAP}hạn${STAY_GAP}(?:tạm|lưu)${STAY_GAP}trú)(?![\p{L}\p{N}])`,
  'u',
)
/**
 * Vietnamese, toned (NFC, lower case): thẻ thường trú, a FOREIGNER_STAY_PHRASE, or tạm trú as a word of its own unless
 * đăng ký / đăng kí / khai báo comes right before it (hasVisaWord's comment). ⛔ NO LOOKBEHIND: the browserslist admits
 * Safari 16.0–16.3, where a `(?<…)` literal is a SyntaxError for the whole chunk (cookie-consent.tsx, gate 2026-10-05) — so
 * each forward match checks the text before it instead.
 */
function hasForeignerStayWord(vi: string): boolean {
  if (/thẻ[^\p{L}\p{N}]*thường[^\p{L}\p{N}]*trú(?![\p{L}\p{N}])/u.test(vi)) return true
  if (FOREIGNER_STAY_PHRASE.test(vi)) return true
  for (const m of vi.matchAll(/(^|[^\p{L}\p{N}])tạm[^\p{L}\p{N}]*trú(?![\p{L}\p{N}])/gu)) {
    if (!/(đăng k[ýí]|khai báo)[^\p{L}\p{N}]*$/u.test(vi.slice(0, (m.index ?? 0) + m[1].length))) return true
  }
  return false
}
/**
 * ONE visa test for every field — a SUBSTRING test, fail-closed. The text is folded (lower case, no accents) and
 * stripped of everything but a–z/0–9, then any "visa" (visa, e-visa, #VisaSponsorship) or "thithuc" (thị thực,
 * thi-thuc, "thi  thuc") drops it, as do the Korean/Chinese/Japanese/Russian words. ⛔ Word-boundary matching was
 * tried and every review round found a new way past it (2026-09-27). A false match — "revisa", "siêu thị thực
 * phẩm" — only drops a posting, which is the safe direction for a licensed edition that carries no visa wording.
 * ⛔ …AND RESIDENCE, THE SAME PERMISSION-TO-STAY LINE (2026-10-18: a live title on /c/jobs read "…Work Permit and TRC
 * Sponsorship — Via English Academy"). Seven review rounds shaped how each kind of word is matched — the lesson is what
 * FOLDING AND STRIPPING THROW AWAY:
 *  · English residence PHRASES — temporary/permanent residence/resident/residency, temporary stay, stay permit(s),
 *    residence/residency + card, permit, status, sponsorship, authorisation, application, renewal, extension, and
 *    resident(s) + card, permit, status — with the words glued (a hashtag) or joined by space, hyphen or
 *    underscore, never across other punctuation: "the staff residence. Support with lesson planning" is two sentences.
 *    Each phrase starts a word ("contemporary residence", "President Card"); no support/assistance/help after residence
 *    or resident ("Residence Assistant", "Resident Assistant", "Residents Support Officer" are boarding-school jobs);
 *    "residential" never counts (a residential summer camp); "stay permit" must be its own words ("homestay permitted").
 *  · TRC is an ACRONYM: "TRC" or "T.R.C" anywhere in the RAW text (#WorkPermitTRCSupport, visa/TRC, WP_TRC), or, in lower
 *    case, at either edge of a word, or as dotted letters, once punctuation runs are spaces (trc support, #trcsponsorship,
 *    workpermittrc, t.r.c) — never "TRCN", Nigeria's teacher registration ("TRCN-certified teachers welcome"). Never a bare substring of the stripped text: there "Language Ctr, Cần Thơ", "Nguyen Trai Str,
 *    Cau Giay" and "Distr. Cầu Giấy" all hold "trc", and real centres' addresses would drop — nor a lone dot ("STR.CAU
 *    GIAY" holds "TR.C"). ⚠️ Known gap: "trc" glued INSIDE a word in lower or mixed case (#wptrcsupport, #WPTrcSupport)
 *    passes; no staged or live job spells it so.
 *  · Vietnamese is matched WITH ITS TONES (NFC): folded, tạm trú is tâm trụ ("trụ sở", head office), thường trú is thưởng
 *    trừ ("+ thưởng, trừ BHXH", a routine pay line) and thường trực ("on standing duty"). And only the FOREIGNER'S forms:
 *    tạm trú as a word of its own ("giấy phép lao động và tạm trú"), except after đăng ký (or đăng kí) / khai báo — the police
 *    registration every resident makes — and thường trú only as thẻ thường trú (the card): a Vietnamese teacher's "hộ
 *    khẩu thường trú tại TP.HCM" or "cư trú tại Hà Nội" is household registration, not a visa. Separators between the
 *    syllables are free (tạm-trú, #tạmtrú) and "trú" must end the word (a name like "Thường Trúc" stays). Unaccented,
 *    only "the tam tru" and "ho tro tam tru" count, with "tru" ending the word. Since 2026-10-19 also giấy phép cư trú, thẻ
 *    cư trú, gia hạn tạm trú and gia hạn lưu trú (FOREIGNER_STAY_PHRASE — measured on the corpus first).
 *  · The CJK and Russian words beside "visa": 在留, 居留, 체류, вид на жительство, ВНЖ, РВП.
 * ⚠️ FAIL-CLOSED, KNOWINGLY, like "revisa": informal Vietnamese "trc" (= trước, "gửi CV trc 30/10") drops a posting
 * too. Measured 2026-10-18 on every job ever staged (174) and the 38 live ones — 360 distinct titles,
 * employers, pay lines and descriptions, EN/VI: the new terms match only the TRC posting. "Work permit" stays allowed: it
 * is a labour document (src/lib/teach-guides/registry.ts header).
 */
export const hasVisaWord = (raw: string) => {
  const folded = fold(raw)
  return /visa|thithuc/.test(folded.replace(/[^a-z0-9]+/g, '')) || visaKinWords(raw, folded)
}

/**
 * Everything hasVisaWord matches BESIDE its "visa" / "thithuc" substring — the English residence phrases, TRC, the
 * foreigner's Vietnamese stay words and the CJK and Russian words (the note above) — shared as written by the employer
 * screen's word-level test (hasEmployerVisaWord), so the two can differ only in how they read "visa" and "thị thực".
 */
function visaKinWords(raw: string, folded: string): boolean {
  const spaced = ` ${folded.replace(/[^a-z0-9]+/g, ' ')} `
  return RESIDENCE_PHRASE.test(folded) ||
    /TRC(?!N)|T\.R\.C/.test(raw) || / trc(?!n)|trc | t r c |(the|ho ?tro) ?tam ?tru /.test(spaced) ||
    hasForeignerStayWord(raw.normalize('NFC').toLowerCase()) ||
    /비자|签证|簽證|ビザ|виза|在留|居留|체류|вид на жительство|ВНЖ|РВП/i.test(raw)
}

/**
 * ⛔ THE EMPLOYER SCREEN READS "VISA" AND "THỊ THỰC" AS WORDS (owner, 2026-10-19: "go with recommended") — hasVisaWord with
 * its one SUBSTRING test swapped for word tests, every other pattern shared as written (visaKinWords). A false match
 * costs the importer nothing (a dropped posting); an employer refused on eno must reword a line their school really
 * writes, and the substring refused the heading "Vì sao nên chọn chúng tôi?" ("why choose us" — "visao" once the spaces
 * go), "advisable" and "kỳ thi thực hành" (a practical exam — "thithuc"). So, on one block as the reader sees it:
 *  · "visa" as a WORD of the folded text, an "e-" / "e" before it and a plural allowed: visa, visas, e-visa, evisa,
 *    visa-free, "Visa/TRC" — in ANY of the block's spellings (visaSpellings): as typed, and with its glued words split
 *    ("WorkPermitVisa", "VISASupport"). ⛔ Never the split alone (round 4): it cuts a word typed with two leading capitals — a
 *    held-Shift typo — into "V Isa" ("VIsa", "VISa", "E-VIsa", "VIsas" passed that way, where the importer's substring
 *    refuses them). A hashtag is read as the glued words it is ("#visasupport", "#VisaSponsorship", "#VIsaSupport",
 *    "#thithuc");
 *  · "thị thực" WITH ITS TONES (NFC, lower case), the two syllables glued, spaced, or joined by one hyphen or underscore —
 *    never "thi thực" (the exam), across a stop ("…tiếp thị. Thực hiện…" is two sentences) or a spaced dash (a title's
 *    "Nhân viên tiếp thị - Thực tập sinh");
 *  · "thi thuc" as words of the FOLDED text only when the block carries no mark at all (someone typing without accents:
 *    "ho tro thi thuc") — in text that has marks, the unmarked syllables are other words.
 * ⚠️ KNOWN FALSE POSITIVES, fail-closed and fixable (the refusal names the words): "siêu thị thực phẩm" (supermarket food),
 * "tiếp thị thực phẩm" (food marketing) and "kinh nghiệm tiếp thị thực tế" hold "thị thực" as words; so does a paragraph
 * whose line ends "…tiếp thị" above a line starting "Thực hiện…" — one paragraph on the page, read "…tiếp thị Thực hiện…"
 * (a bullet or a full stop splits it); an unaccented "ky thi thuc hanh"; a "Visa card" salary payment; a lower-case hashtag
 * that holds "visa" once folded ("#vìsao", "#visaochonchungtoi" — a camelCase one, "#VìSaoChọnChúngTôi", is read split).
 * ⚠️ OUT OF SCOPE — MODERATION'S JOB, NOT THIS SCREEN'S: deliberate obfuscation — letters split by punctuation or spaces
 * ("v.i.s.a", "V·I·S·A", "Vi|sa", "thị·thực"), homoglyphs, zero-width characters, text in images. IN SCOPE: anything a
 * real poster writes plainly, text pasted from a PDF or a Word file with hard line breaks mid-sentence included
 * (jobTextProblem reads the rendered paragraph, not the line).
 */
const VISA_WORD = /(?:^|[^a-z0-9])e?-?visas?(?![a-z0-9])/
/** A hashtag holding the word — read on the SPLIT spellings only (review, 2026-10-19): as typed, "#VìSaoChọnChúngTôi" folds
 *  to "#visaochonchungtoi"; split, it is "#vi sao chon chung toi", while "#VisaSponsorship" is "#visa sponsorship". */
const VISA_HASHTAG = /#[a-z0-9_]*(?:visa|thithuc)/
const THI_THUC_TONED = /(?:^|[^\p{L}\p{N}])thị(?:\s+|[_-])?thực(?![\p{L}\p{N}])/u
const THI_THUC_UNMARKED = /(?:^|[^a-z0-9])thi(?:\s+|[_-])?thuc(?![a-z0-9])/
/** Whether the text carries a mark — a tone or vowel mark once decomposed (U+0300–U+036F), or đ. */
const hasMarks = (s: string): boolean => /[\u0300-\u036f]/.test(s.normalize('NFD')) || /[đĐ]/.test(s)
/**
 * The block's spellings the "visa" word test reads, folded (the note above): as typed; with its camelCase joins split
 * ("WorkPermitVisa" → "Work Permit Visa"); and with its ACRONYMWord joins split as well ("VISASupport" → "VISA Support").
 * ⚠️ The acronym split also cuts a word typed with two leading capitals ("VIsa" → "V Isa"), so it is never the only reading:
 * "VIsa" is a word as typed, and "WorkPermitVIsa" once only its camelCase join is split (round 4).
 */
const visaSpellings = (raw: string, folded: string): string[] => {
  const camel = raw.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
  return [folded, fold(camel), fold(camel.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2'))]
}
export const hasEmployerVisaWord = (raw: string): boolean => {
  const folded = fold(raw)
  const spellings = visaSpellings(raw, folded)
  return spellings.some((s) => VISA_WORD.test(s)) || spellings.slice(1).some((s) => VISA_HASHTAG.test(s)) ||
    THI_THUC_TONED.test(raw.normalize('NFC').toLowerCase()) ||
    // Unmarked "thi thuc" on every spelling, so a camelCase hashtag ("#HoTroThiThuc" → "#ho tro thi thuc") is read too.
    (!hasMarks(raw) && spellings.some((s) => THI_THUC_UNMARKED.test(s))) || visaKinWords(raw, folded)
}

const DENY_CODE: Record<JobDenyReason, JobTextBlockCode> = { discriminatory: 'job_discrimination', 'adult-venue': 'job_adult_venue', fee: 'job_candidate_fee' }

/**
 * Is this listing a HIRING post — the only kind the job-text screen reads (owner, 2026-10-18: "go with recommended")?
 * Jobs' `job` intent; never its `wanted` one, where a person looking for work describes THEMSELVES ("Valid TRC", "two years
 * in cafés") — a line about who they are, not a requirement an employer sets, so the job-ad rules do not apply to it.
 */
export const isHiringPost = (categorySlug: string | null | undefined, listingType: string | null | undefined): boolean =>
  categorySlug === 'jobs' && listingType === 'job'

/**
 * ⛔ THE UNIT IS THE BLOCK THE READER SEES (the contract, 2026-10-19 — owner: "go with recommended"). Two review rounds asked
 * for opposite things — "never join words across lines", then "per-line splitting is bypassed, because the page joins a
 * paragraph's lines" — and both resolve into one rule: A HIRING POST IS SCREENED EXACTLY AS THE READER SEES IT. The
 * description is rendered by formatRichText, and its blocks are that renderer's (src/lib/rich-text-blocks.ts, one parse for
 * both): a paragraph is its consecutive non-blank lines joined with a space — so "…thẻ tạm" on one line and "trú" on the next
 * is "…thẻ tạm trú", as the page prints it — while each list item ("- ", "* ", "• ", "1.", "1)", a tick), each "#" heading
 * and each row of a fact table is a block of its own (a fact run that is not a table folds back into its paragraph, as on
 * the page). Every other field — the title, a place, an attribute row ("Label: value", as Details prints it) — is ONE line,
 * whatever line breaks an API client sent (an <h1> or a table cell shows them as spaces). Whitespace runs read as one space.
 */
export type JobTextField = readonly [field: string, text: string | null | undefined, kind?: 'rich' | 'line', key?: string]

/** A field's text as the blocks the reader sees (the note above), whitespace runs as one space, empty ones dropped. */
function blocksOf(text: string, kind: 'rich' | 'line' = 'line'): string[] {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  return (kind === 'rich' ? richTextBlocks(text).map(flat) : [flat(text)]).filter(Boolean)
}

/**
 * Where a SENTENCE ends inside a block, for the denylist (employerDenyReason) — sentence punctuation only: a run of up to
 * eight . ! ? … ; (or their full-width forms) after two non-space characters and before a space or the end (bounded, so a
 * long run of stops costs linear time). "25.000.000 đ" and "TP.HCM" are no ends; nor is a dash, which runs a clause on ("No
 * training fee – deducted from your first salary" is one sentence, and its fee words count); nor a line break inside a
 * paragraph, which the reader sees as a space ("No training fee\nwill be charged later" is one sentence).
 */
const SENTENCE_END = /(\S\S)[.!?…;。！？]{1,8}(?=\s|$)/gu

/** A block's sentences, trimmed, empty ones dropped — the stops themselves go. */
function sentencesOf(block: string): string[] {
  const out: string[] = []
  let from = 0
  for (const m of block.matchAll(SENTENCE_END)) {
    // The two characters a stop needs before it are the end of its own sentence (no lookbehind — hasForeignerStayWord's note).
    out.push(block.slice(from, (m.index ?? 0) + m[1].length))
    from = (m.index ?? 0) + m[0].length
  }
  out.push(block.slice(from))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** The longest snippet a refusal carries (a word run longer than this is cut, with "…"). */
const SNIPPET_MAX = 80

/**
 * The poster's own words that trip the rule, cut from the refused block or sentence so they read exactly as shown — what
 * they are asked to take out or reword ("Visa", "TRC", "training fee required", "tạm trú"). The fewest whole words around
 * the FIRST hit (words come off the back while the rest still trips, then off the front) joined to the fewest around the
 * LAST (front, then back), so a line with two ("hostess for a karaoke bar") shows both and one fix clears it. Exactly the
 * first and the last when more words can only add hits — always so for the visa test; a negation taken out can make the rule
 * trip on fewer words and not on more ("Training fee:" against "Training fee: none"), and then the cut lands on a hit near
 * them. Edge punctuation goes ("Visa." → "Visa"), and so does a bracket or quote left without its pair ("(visa" → "visa"); a
 * pair ("Visa (thị thực)") and a hashtag's # stay as typed.
 * ⛔ TWO HITS FAR APART — the joined span past SNIPPET_MAX — give the FIRST hit's own words only (Opus, round 3): a whole
 * paragraph is a block now, and a cut "first … last" run would end in "…" before the last hit and name words nobody could
 * find. The first hit alone is one contiguous run of the block, so the wizard's note (post-wizard.tsx jobTextStill) still
 * finds it in the field; the refusal comes back for the next hit once that one is fixed. A single run past the limit (one
 * very long word) is cut, with "…", as ever.
 * ⚠️ EACH CUT IS A BINARY SEARCH between a span that trips and one that does not, so a 5,000-character line costs a few
 * dozen tests of the rule (O(n log n) in all), not one per word each way (measured 2026-10-18: ~350 ms for 1,200 words that way) — and it
 * ends, like the word-by-word cut, on words that trip while one fewer does not.
 */
function trippingWords(piece: string, trips: (s: string) => boolean): string {
  const words = [...piece.matchAll(/\S+/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const)
  const span = (a: number, b: number) => piece.slice(words[a][0], words[b - 1][1])
  const narrow = (backFirst: boolean): [number, number] => {
    let a = 0
    let b = words.length
    // The last end that still trips: [a, hi) trips, [a, lo) does not (an empty span never does).
    const back = () => {
      let lo = a
      let hi = b
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trips(span(a, mid))) hi = mid; else lo = mid }
      b = hi
    }
    // The last start that still trips: [lo, b) trips, [hi, b) does not.
    const front = () => {
      let lo = a
      let hi = b
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trips(span(mid, b))) lo = mid; else hi = mid }
      a = lo
    }
    if (backFirst) { back(); front() } else { front(); back() }
    return [a, b]
  }
  const [first, last] = [narrow(true), narrow(false)]
  // Edge punctuation and an unpaired bracket or quote off a cut — kept only while what is left still trips.
  const tidy = (cut: string): string => {
    let trimmed = cut.replace(/^[.,;:!?…]+|[.,;:!?…]+$/gu, '')
    for (const [open, close] of [['(', ')'], ['[', ']'], ['“', '”'], ['«', '»']]) {
      if (trimmed.startsWith(open) && !trimmed.includes(close)) trimmed = trimmed.slice(open.length)
      if (trimmed.endsWith(close) && !trimmed.includes(open)) trimmed = trimmed.slice(0, -close.length)
    }
    return trimmed && trimmed !== cut && trips(trimmed) ? trimmed : cut
  }
  let out = tidy(span(Math.min(first[0], last[0]), Math.max(first[1], last[1])))
  if (Array.from(out).length > SNIPPET_MAX) out = tidy(span(first[0], first[1]))
  const chars = Array.from(out)
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX - 1).join('')}…` : out
}

/**
 * ⛔ HONEST NEGATIONS ARE TAKEN OUT BEFORE JOB_DENY READS EMPLOYER TEXT (owner, 2026-10-18: "go with recommended") — "no age
 * limit", "no training fee", "không thu phí đào tạo" say the OPPOSITE of the rule's words, which JOB_DENY reads as they
 * stand ("without any fee", "không thu phí" and "không giới hạn tuổi", the owner's other examples, hold no JOB_DENY phrase). THE EMPLOYER SCREEN ONLY: the importer's drop (mapStagedJob) keeps
 * JOB_DENY exactly as it was — a false drop costs it nothing. Read per SENTENCE (SENTENCE_END), with ONE rule:
 *  · a negation goes only when it IS THE SENTENCE — ⛔ after three review rounds (codex + Opus, 2026-10-18) each found a new
 *    way a fee rides on a negation inside a longer sentence, and a fifth the same for an age limit ("No age limit for men,
 *    35 for women", "Age limit: none for native speakers, max 35 for others"): put off ("No training fee upfront –
 *    deducted from your first salary", "Không thu phí đào tạo, trừ vào lương tháng đầu", "(No training fee) will be
 *    deducted…"), a condition ("Without the registration fee, your application will not be processed", "Nếu không đặt cọc,
 *    bạn sẽ mất suất"), partly waived ("Miễn phí đào tạo 3 tháng đầu"), or limited ("…quá 2 triệu", "…for the first month").
 *    No list of such words can be finished, so none is kept: once the negations (FEE_NEGATIONS, "miễn phí" FREE_WORDS,
 *    AGE_LOOKS_NEGATIONS) and the harmless ones beside them ("no experience needed", "không yêu cầu kinh nghiệm" —
 *    HARMLESS_NEGATIONS) are taken out, every word left must be FILLER ("there is", "we", "for this role", "chúng tôi"…) —
 *    else the sentence is read as written, and the refusal names the words. "No training fee." / "- Không thu phí đào tạo"
 *    / "There is no age limit for this role." / "No training fee, no deposit." pass; "Lương cao, không thu phí đào tạo, có
 *    hoa hồng" is refused — the safe side, and putting the negation on its own line passes it. The way a form writes such a
 *    line is no extra word (Opus, round 3): a leading list marker or number ("1.", "a)", "-", "•", a tick, an emoji) and
 *    one or two labels of a CLOSED set before a colon ("Benefits:", "Quyền lợi:" — LEAD) are dropped before the FILLER
 *    test, so "1. No fees" and "Quyền lợi: không thu phí" pass while "No fees until you start, then a training fee" does not.
 * A FEE negation is a negated noun phrase ("no" / "zero" / "without" / "không" / "ko" / "chẳng" + determiners and the fee's
 * kind + the fee words), the employer's verb negated ("we do not charge / require / ask for", "không thu / lấy / yêu cầu /
 * nhận / có"), the candidate's payment under a modal or "never" ("you don't have to pay", "no need to pay", "không phải /
 * cần nộp"), or the fee words then "not required" / ": none" / ": free (of charge)" / ": không" / ": 0đ"; more items only
 * after "or" / "nor" / "hay" / "hoặc". "Miễn phí" is FREE, a fee negation like those — unless a negation stands before it
 * ("không (được / phải / còn) miễn phí": NOT free, so the fee words count). And a sentence whose NEXT sentence in the same
 * field is a consequence ("Không đặt cọc. Không nhận việc.", "No training fee. No job.") is a condition: its fee words count
 * (`condition`). An AGE-LIMIT or LOOKS negation is "no age limit", "no max age", "Age limit: none", "không yêu cầu ngoại hình
 * đẹp", "không giới hạn tuổi". A removed phrase leaves " | ", so what is left never joins into a new phrase. Every case above
 * is pinned, both ways, in job-listing.test.ts.
 */
const NJ = String.raw`[\s/&+-]+`
const EN_DET = String.raw`(?:any|a|an|the|training|registration|application|recruitment|placement|agency|admin|joining|or|nor)`
const EN_FEE = String.raw`(?:fees?|deposits?)`
const EN_MORE = String.raw`(?:${NJ}(?:or|nor)(?:${NJ}${EN_DET}){0,4}${NJ}${EN_FEE})*`
const EN_TAIL = String.raw`(?:${NJ}(?:(?:(?:is|are|will${NJ}be)${NJ})?(?:required|needed|charged|payable|necessary)|whatsoever|at${NJ}all)){0,2}`
const EN_FEE_PHRASE = String.raw`(?:${NJ}${EN_DET}){0,4}${NJ}${EN_FEE}${EN_MORE}${EN_TAIL}(?![a-z0-9])`
const VI_VERB = String.raw`(?:thu|lay|tinh|yeu cau|doi hoi|mat|ton|nhan|co|(?:phai|can|bat buoc)(?:${NJ}(?:nop|dong|dat|tra))?)`
const VI_DET = String.raw`(?:bat ky|bat cu|khoan|loai|chi|tien|cac|moi|mot)`
const VI_FEE = String.raw`(?:phi dao tao|phi ho so|phi dang ky|le phi|phi|dat coc|tien coc|coc)`
const VI_MORE = String.raw`(?:${NJ}(?:hay|hoac)(?:${NJ}${VI_DET}){0,3}${NJ}${VI_FEE})*`
const VI_TAIL = String.raw`(?:${NJ}(?:nao|gi|ca|het)){0,2}`
/** The fee negations (the note above) — taken out only when what is left of the sentence is FILLER. */
const FEE_NEGATIONS: readonly RegExp[] = [
  // "no / zero / without (any, the, training…) fee(s) / deposit(s)", "… or registration fees", "… (is) required".
  new RegExp(String.raw`\b(?:no|zero|without)${EN_FEE_PHRASE}`, 'g'),
  // "we do not / never / don't charge / require / ask for (you) (a) fee", "you will not be charged a fee".
  new RegExp(String.raw`\b(?:not|never|[a-z]+n['’]t)(?:${NJ}be)?${NJ}(?:charge[sd]?|charging|require[sd]?|ask(?:s|ed)?${NJ}for|collect|take)(?:${NJ}(?:you|candidates|applicants|teachers|staff))?${EN_FEE_PHRASE}`, 'g'),
  // "you don't have to / no need to / are not required to pay (a) fee", "you never pay a deposit".
  new RegExp(String.raw`\b(?:(?:no${NJ}need|not${NJ}required|not${NJ}have|never${NJ}have|[a-z]+n['’]t${NJ}have)${NJ}to|never)${NJ}pay${EN_FEE_PHRASE}`, 'g'),
  // "training fee (is) not required", "deposit: none", "fee: free (of charge)".
  new RegExp(String.raw`\b(?:(?:training|registration|application|placement|recruitment)${NJ})?${EN_FEE}(?:${NJ}(?:is|are|will${NJ}be))?${NJ}(?:not|never)${NJ}(?:required|needed|charged|payable|necessary)(?![a-z0-9])`, 'g'),
  new RegExp(String.raw`\b(?:(?:training|registration|application|placement|recruitment)${NJ})?${EN_FEE}\s*[:=–—-]+\s*(?:none|nil|n/a|free(?:${NJ}of${NJ}charge)?)(?![a-z0-9])`, 'g'),
  // "(hoàn toàn) không / ko / chẳng (thu / có / yêu cầu / phải nộp / cần đặt…) (bất kỳ, khoản…) phí (đào tạo / hồ sơ…) / đặt
  // cọc / cọc".
  new RegExp(String.raw`\b(?:hoan toan${NJ})?(?:khong|ko|chang)(?:${NJ}${VI_VERB})?(?:${NJ}${VI_DET}){0,3}${NJ}${VI_FEE}${VI_MORE}${VI_TAIL}(?![a-z0-9])`, 'g'),
]
/**
 * "phí đào tạo: không (thu)", "đặt cọc: miễn phí", "phí hồ sơ: 0đ" (never "0.5 triệu") — as the END of the sentence only, so
 * "phí đào tạo: không miễn phí" (not free) and "đặt cọc – không hoàn" (non-refundable) keep counting (Opus, round 4). Read
 * BEFORE FREE_WORDS, which would otherwise take the "miễn phí" this form ends on (Opus, round 5); the end anchor means it can
 * hide no "không" in front of a "miễn phí".
 */
const VI_FEE_ANSWER = new RegExp(String.raw`\b(?:phi dao tao|phi ho so|phi dang ky|le phi|dat coc|tien coc)\s*[:=–—-]+\s*(?:khong(?:${NJ}(?:co|thu|mat|can))?|mien phi|0(?![\d]|[.,]\d)(?:\s?(?:d|dong|vnd))?)(?=\s*$)`, 'g')
/** "miễn phí (đào tạo / hồ sơ / đăng ký)" — FREE, a fee negation like those above; never when a negation stands before it. */
const FREE_WORDS = new RegExp(String.raw`(\b(?:khong|ko|chang|chua)(?:${NJ}(?:duoc|phai|con|hoan toan|la)){0,2}${NJ})?\bmien${NJ}phi(?:${NJ}(?:dao tao|ho so|dang ky))?(?![a-z0-9])`, 'g')
/** The age-limit and looks negations — taken out, like the fee ones, only when what is left of the sentence is FILLER. */
const AGE_LOOKS_NEGATIONS: readonly RegExp[] = [
  // "no (upper / maximum) age limit", "without any age limit", "no max age", "age limit: none".
  new RegExp(String.raw`\b(?:no|without(?:${NJ}(?:an?|any))?)(?:${NJ}(?:upper|maximum|max|strict))?${NJ}age${NJ}(?:limits?|caps?|restrictions?|requirements?)(?![a-z0-9])`, 'g'),
  new RegExp(String.raw`\bno${NJ}(?:maximum|max|upper)${NJ}age(?![a-z0-9])`, 'g'),
  new RegExp(String.raw`\bage${NJ}limits?\s*[:=–—-]+\s*(?:none|nil|n/a)(?![a-z0-9])`, 'g'),
  // "không (yêu cầu / cần / giới hạn / phân biệt …) (về) ngoại hình (đẹp / ưa nhìn) / độ tuổi / tuổi / giới tính".
  new RegExp(String.raw`\bkhong(?:${NJ}(?:yeu cau|can|doi hoi|quan trong|phan biet|gioi han|bat buoc)){1,2}(?:${NJ}ve)?${NJ}(?:ngoai hinh(?:${NJ}(?:dep|ua nhin))?|do tuoi|tuoi|gioi tinh)(?![a-z0-9])`, 'g'),
]
/** Negations beside a fee negation that ask nothing of the candidate — taken out only to judge what is left. A CLOSED list. */
const HARMLESS_NEGATIONS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:no|without)${NJ}(?:(?:prior|previous|teaching|work)${NJ})?(?:experience|degree|certificates?|certification|overtime|uniform)(?:${NJ}(?:needed|required|necessary))?(?![a-z0-9])`, 'g'),
  new RegExp(String.raw`\bkhong${NJ}(?:(?:can|yeu cau|doi hoi)${NJ})?(?:kinh nghiem|bang cap|chung chi|lam them gio|tang ca|dong phuc)(?![a-z0-9])`, 'g'),
]
/**
 * ⛔ THE VIETNAMESE FILLER IS MATCHED WITH ITS TONES, BEFORE FOLDING (Opus, round 3). Folded, "trung tâm" (the centre) was the
 * two filler syllables "trung" + "tam" — and "tam" is also tạm ("for now": "Tạm không thu phí đào tạo" waives the fee only
 * for a while), "toi" also tới ("until"), "ty" also tỷ (a billion), "ca" also ca (a shift): a bare folded syllable let a word
 * of time or money pass as filler. So each phrase below is taken out AS WRITTEN (NFC, lower case, whole words; its
 * syllables joined by any space) and only then is the sentence folded — and no folded Vietnamese syllable is filler on its
 * own. "sẽ" (will) is an auxiliary (AUXILIARIES). Text typed with NO marks at all matches the folded many-syllable phrases
 * instead ("Trung tam khong thu phi dao tao"), never a lone syllable. A CLOSED list, like FILLER: pronouns, the
 * school, the candidate, "committed", "absolutely", "all", "also", "and", "for", "with", "at", "is" / "will"…
 * ⚠️ NOT "hay" / "hoặc" ("or"): they belong to the negation itself ("không thu phí đào tạo hay phí hồ sơ" — FEE_NEGATIONS'
 * "or" chain), which reads the folded text, so they stay folded words of FILLER like "or" / "nor".
 */
const VI_FILLER_WORD = 'vifiller'
const VI_FILLER_AUX = 'vifilleraux'
const VI_FILLER_PHRASES = [
  'chúng tôi', 'chúng mình', 'bên mình', 'bên em', 'trung tâm', 'công ty', 'nhà trường', 'tuyệt đối', 'cam kết', 'ứng viên',
  'giáo viên', 'học viên', 'tất cả', 'tôi', 'mình', 'bên', 'trường', 'bạn', 'cũng', 'là', 'và', 'cho', 'với', 'đều', 'nhé',
  'ở', 'tại', 'được',
  // Southern sentence particles and "completely" (review, 2026-10-19): toned matching keeps "nha" apart from "nhà".
  'nha', 'nhen', 'nghen', 'nè', 'hoàn toàn',
]
/** Whole words, NFC lower case, the longest phrase first; the capture keeps the character before it (no lookbehind). */
const viFillerRe = (phrases: readonly string[]) =>
  new RegExp(String.raw`(^|[^\p{L}\p{N}])(${[...phrases].sort((a, b) => b.length - a.length).map((x) => x.split(' ').join(String.raw`\s+`)).join('|')})(?![\p{L}\p{N}])`, 'gu')
const VI_FILLER = viFillerRe(VI_FILLER_PHRASES)
const VI_FILLER_AUX_RE = viFillerRe(['sẽ'])
const VI_FILLER_UNMARKED = viFillerRe(VI_FILLER_PHRASES.filter((x) => x.includes(' ')).map(fold))
/** The sentence with its Vietnamese filler as FILLER tokens (the note above), ready to fold. */
function withViFiller(sentence: string): string {
  const nfc = sentence.normalize('NFC').toLowerCase()
  const toned = nfc.replace(VI_FILLER, `$1 ${VI_FILLER_WORD} `).replace(VI_FILLER_AUX_RE, `$1 ${VI_FILLER_AUX} `)
  return hasMarks(nfc) ? toned : toned.replace(VI_FILLER_UNMARKED, `$1 ${VI_FILLER_WORD} `)
}

/**
 * The words a sentence may hold beside a fee negation and still be only that negation (folded, one word each). A CLOSED
 * list: no word of time, money, number, refund, condition or requirement is on it — not "required", "needed", "apply",
 * "join", "upfront", "trước", "until", "if", "nếu", "trừ", "lương", "hoàn" (refund), "first", "tháng" or a digit (codex +
 * Opus, round 4: "No training fee to apply – it is required to join", "Đặt cọc – không hoàn") — so any such word, bracketed
 * or not, leaves the fee words counting. A fee predicate belongs to its negation, not here ("no fee required", "deposit is
 * not required": FEE_NEGATIONS' tails), and "hoàn toàn" (completely) to the Vietnamese negation it comes before.
 */
const FILLER = new Set([
  'there', 'is', 'are', 'be', 'do', 'does', 'did', 'will', 'would', 's', 'we', 'our', 'us', 'you', 'your', 'this', 'that',
  'the', 'a', 'an', 'any', 'all', 'also', 'and', 'or', 'nor', 'of', 'for', 'to', 'at', 'candidates', 'candidate', 'applicants',
  'applicant', 'teachers', 'teacher', 'staff', 'students', 'student', 'role', 'job', 'jobs', 'position', 'post', 'vacancy',
  'school', 'centre', 'center', 'company', 'absolutely', 'completely', 'totally', 'entirely', 'strictly', 'whatsoever', 'ever',
  'every', 'nationality', 'nationalities', 'welcome', 'welcomed',
  // The Vietnamese filler, as the tokens VI_FILLER leaves (no other folded syllable: the note there) — and "hay" / "hoặc"
  // ("or"), which the negation's own "or" chain reads folded.
  VI_FILLER_WORD, VI_FILLER_AUX, 'hay', 'hoac',
])
/**
 * The auxiliaries of FILLER — only BEFORE the first negation taken out ("we do not charge…", "there will be no…"), never after
 * it, where they hand the fee on to someone else: "We don't charge a training fee — the school does", "…, the company will"
 * (Opus, round 6), "…, trung tâm sẽ thu".
 */
const AUXILIARIES = new Set(['is', 'are', 'be', 'do', 'does', 'did', 'will', 'would', VI_FILLER_AUX])
const onlyFiller = (text: string): boolean => {
  const cut = text.indexOf('|')
  const words = (s: string) => s.match(/[a-z0-9]+/g) ?? []
  return words(cut < 0 ? text : text.slice(0, cut)).every((w) => FILLER.has(w))
    && (cut < 0 || words(text.slice(cut)).every((w) => FILLER.has(w) && !AUXILIARIES.has(w)))
}
/**
 * What a form puts before a line, dropped before the FILLER test (the note above): a run of list markers — a number or a
 * letter with ".", ")", "/", ":" or "-" ("1.", "a)", "1/", "1 -"), a keycap number ("2️⃣"), a dash, a bullet, a tick, an
 * emoji — then one or two labels of a CLOSED set before a colon, on the folded sentence. Never the negation's own "|" (a
 * sentence that opens with its negation keeps it).
 */
const LEAD_LABEL = String.raw`(?:quyen loi|phuc loi|che do|luu y|chu y|notes?|benefits|perks|we offer|other)`
const LEAD = new RegExp(String.raw`^\s*(?:(?:\d{1,3}|[a-z])\s?[.)/:-]|\d{1,3}\uFE0F?\u20E3|[^a-z0-9\s|])*\s*(?:${LEAD_LABEL}(?:\s*(?:&|and|va|,)?\s*${LEAD_LABEL})?\s*:)?`)
/** A narrow CONSEQUENCE opening the next sentence of a field — the sentence before it a condition ("Không nhận việc."). */
const OPENS_WITH_CONSEQUENCE = new RegExp(String.raw`^\s*(?:thi${NJ})?(?:no|khong|ko|chang)${NJ}(?:(?:duoc|the)${NJ})?(?:job|work|start|hire|place|class|contract|offer|interview|nhan(?:${NJ}(?:viec|lop))?|lam(?:${NJ}viec)?|di${NJ}lam|vao${NJ}lam|ky(?:${NJ}hop${NJ}dong)?|co${NJ}viec|giu${NJ}cho|hoc)(?=\s*(?:$|[,;:.!?()|—–-]))`)

/**
 * Which JOB_DENY rule a SENTENCE of employer text breaks, or null — the importer's matcher with honest negations taken out
 * (the note above). `condition`: the field's next sentence opens with a consequence, so no fee negation here is honest.
 */
function employerDenyReason(text: string, opts: { only?: JobDenyReason; condition?: boolean } = {}): JobDenyReason | null {
  const { only, condition = false } = opts
  const folded = ` ${fold(text)} `
  let read = folded
  if (!condition) {
    const rest = withoutNegations(folded)
    // What is left must be FILLER — judged on the same sentence with its Vietnamese filler matched as written (withViFiller)
    // and the form's lead (LEAD) dropped; JOB_DENY then reads `rest`, the sentence itself with its negations out.
    if (rest !== folded) {
      const probe = withoutNegations(` ${fold(withViFiller(text))} `).replace(LEAD, ' ')
      if (onlyFiller(HARMLESS_NEGATIONS.reduce((t, re) => t.replace(re, ' '), probe))) read = rest
    }
  }
  for (const [re, why] of JOB_DENY) if ((!only || why === only) && re.test(read)) return why
  return null
}

/** A folded sentence with its honest negations as " | " (the note above). */
function withoutNegations(folded: string): string {
  // The "…: không / miễn phí" answer first; then "miễn phí" on the sentence as written — a fee negation taken out before it
  // could hide the "không" that makes it NOT free ("phí đào tạo: không miễn phí", Opus round 4); then the rest.
  const free = folded.replace(VI_FEE_ANSWER, ' | ').replace(FREE_WORDS, (words, negated: string | undefined) => (negated ? words : ' | '))
  return [...FEE_NEGATIONS, ...AGE_LOOKS_NEGATIONS].reduce((t, re) => t.replace(re, ' | '), free)
}

/** A job-text refusal: which rule, which field, and the poster's own words that tripped it (trippingWords). */
export type JobTextProblem = { code: JobTextBlockCode; field: string; snippet: string }

/**
 * ⛔ THE SAME SCREENS ON JOB TEXT AN EMPLOYER WRITES (teacher visibility plan §3a item 6; approved in the plan, 2026-10-18 —
 * owner: "go with recommended"). Until then only IMPORTED rows were screened (mapStagedJob above): a Jobs post made through
 * the wizard, /api/v1 or MCP published whatever its title and description said, and the plan pairs this screen with the
 * prompt that invites schools to post (teaching-links.tsx PostJobLink) — the two ship together. createListingCore,
 * updateListingCore, the bulk core (CSV, /api/v1 bulk, MCP bulk, a sync's creates) and a re-activation (setStatusCore,
 * confirmCore) run it on every HIRING post (isHiringPost: Jobs, `job` intent — never a `wanted` post), over the text its
 * page prints: the title, the description, each attribute row, the location, the district and the city (`fields`:
 * [field, text, kind] — the field is what the refusal's `detail` names, and where the wizard points):
 *  · hasEmployerVisaWord → `job_residence_wording`, ON BOTH EDITIONS (owner, 2026-10-18): the two builds write ONE database
 *    and eno.vn shows the same rows, so a forum-made job ad is an eno.vn job ad — as the importer's drop has always run
 *    whichever build imports (mapStagedJob's ⛔ carries no edition test). "Work permit" stays allowed: a labour document.
 *  · JOB_DENY, negations taken out first (employerDenyReason) → `job_discrimination` / `job_adult_venue` /
 *    `job_candidate_fee`.
 * ⛔ AS THE READER SEES IT (the contract above JobTextField): the visa test judges a WHOLE block — a paragraph joined as the
 * page joins it, a list item, a heading, a table row, a one-line field; the denylist judges each SENTENCE within a block
 * (sentencesOf: sentence punctuation only, never a line break the reader sees as a space), where a fee negation is judged
 * whole (employerDenyReason); a sentence's condition is read from the next sentence the reader reads in the same field.
 * ⚠️ The price, knowingly: lines with no bullet and no stop are ONE run-on paragraph on the page ("Lương cao" / "Không thu
 * phí đào tạo" / "Có hoa hồng" reads "Lương cao Không thu phí đào tạo Có hoa hồng"), so an honest negation on its own line
 * there is judged with its neighbours and refused; the refusal names the words, and a "- ", "* " or "• " bullet, a numbered
 * line or a full stop passes it ("+ ", "– " and "> " are no bullets to the renderer, so they do not).
 * And the refusal carries the words that tripped it (`snippet`, trippingWords) — the routes send `detail`
 * '<field>:<snippet>', and the wizard shows them under the field — so "remove that line" always names words the poster
 * can find. The first hit wins, visa wording first (the importer's order). Refused, never cleaned: the poster takes the
 * words out and publishes again.
 * ⚠️ STILL FAIL-CLOSED, KNOWINGLY, like the importer — word tests with no sense of who a phrase is about: hasEmployerVisaWord's
 * known false positives ("siêu thị thực phẩm", a "Visa card" salary), informal "trc" (= trước), and JOB_DENY refusing
 * students "under 12 years old" or a hotel's "spa và massage". Each is a fixable refusal: the snippet shows the exact words.
 * ⚠️ OUT OF SCOPE — moderation's job: deliberate obfuscation (hasEmployerVisaWord's note).
 */
export function jobTextProblem(fields: readonly JobTextField[]): JobTextProblem | null {
  const read = fields.map(([field, text, kind]) => [field, text ? blocksOf(text, kind) : []] as const)
  for (const [field, blocks] of read) {
    for (const block of blocks) {
      if (hasEmployerVisaWord(block)) return { code: 'job_residence_wording', field, snippet: trippingWords(block, hasEmployerVisaWord) }
    }
  }
  // ⛔ AN ATTRIBUTE KEY IS ALSO READ AS THE IDENTIFIER IT IS (review, 2026-10-19), with the importer's glued reading
  // (hasVisaWord): the page humanizes a key by its capitals (taxonomy.ts detailRowLabel), so "visasponsorship" prints
  // whole and "VISA_SPONSORSHIP" prints letter-spaced — both visa wording on the page, both unreadable to the word-level
  // test. A key is never prose, so the glued reading's false positives ("Vì sao", "advisable") cannot arise here, and no
  // facet key or JOB_TEXT_ATTRIBUTES key trips it (job-listing.test.ts). The snippet is the label as the page prints it.
  // After the printed text (its snippet is the narrower one), before the denylist.
  for (const [field, text, , key] of fields) {
    if (key && hasVisaWord(key)) return { code: 'job_residence_wording', field, snippet: (text ?? key).split(': ')[0] || key }
  }
  for (const [field, blocks] of read) {
    const sentences = blocks.flatMap(sentencesOf)
    for (let i = 0; i < sentences.length; i++) {
      const condition = i + 1 < sentences.length && OPENS_WITH_CONSEQUENCE.test(` ${fold(sentences[i + 1])} `)
      const why = employerDenyReason(sentences[i], { condition })
      if (why) return { code: DENY_CODE[why], field, snippet: trippingWords(sentences[i], (s) => employerDenyReason(s, { only: why, condition }) !== null) }
    }
  }
  return null
}

/** A refusal's `detail` on the wire: '<field>:<snippet>' (the field never holds a colon: sanitizeAttributes keeps only
 *  [A-Za-z0-9_] keys). */
export const jobTextDetail = (p: JobTextProblem): string => `${p.field}:${p.snippet}`

/**
 * The refusal beside each job-text code — POST + PATCH /api/listings send it as `message` (the native apps' sentence);
 * /api/v1 and MCP send the English. The post wizard types the same sentences inline for the i18n harvest
 * (core/listings.job-text.test.ts holds them equal). No ASCII apostrophes: the harvester reads single-quoted strings only.
 * Each says what to take out — the words themselves ride in `detail` — and none names an edition: every rule runs on both.
 * The residence one says the work permit may stay — the line a school most often writes beside it. "Job ads" / "Tin tuyển
 * dụng": only hiring posts are screened (isHiringPost).
 */
export const JOB_TEXT_REFUSAL: Record<JobTextBlockCode, { en: string; vi: string }> = {
  job_residence_wording: {
    en: 'Job ads on eno can’t mention visas or residence cards — remove that line. A work permit is fine to mention.',
    vi: 'Tin tuyển dụng trên eno không được nhắc đến visa (thị thực) hay thẻ tạm trú — hãy xóa phần đó. Bạn vẫn có thể nhắc đến giấy phép lao động.',
  },
  job_discrimination: {
    en: 'Job ads can’t set an age, gender, race, nationality or appearance requirement — remove that line.',
    vi: 'Tin tuyển dụng không được nêu yêu cầu về tuổi, giới tính, chủng tộc, quốc tịch hay ngoại hình — hãy xóa phần đó.',
  },
  job_candidate_fee: {
    en: 'Job ads can’t mention a fee or deposit for candidates — remove that line.',
    vi: 'Tin tuyển dụng không được nhắc đến phí hay tiền đặt cọc mà ứng viên phải nộp — hãy xóa phần đó.',
  },
  job_adult_venue: {
    en: 'Job ads can’t mention karaoke, massage, nightclub or hostess work — remove that line.',
    vi: 'Tin tuyển dụng không được nhắc đến việc làm ở karaoke, massage, hộp đêm hay làm tiếp viên nhà hàng — hãy xóa phần đó.',
  },
}
/** Today's date in Vietnam, YYYY-MM-DD — every apply-by is a Vietnamese calendar day. */
export const vnToday = (now: number) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
const vnDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })

const TEACHING_ROLE = /teacher|teaching|tutor|lecturer|instructor|educator|trainer|giáo viên|giảng viên|trợ giảng|gia sư/i

const EN_TYPE: Record<string, string> = { fulltime: 'Full-time', parttime: 'Part-time', contract: 'Contract', temporary: 'Temporary' }
const VI_TYPE: Record<string, string> = { fulltime: 'Toàn thời gian', parttime: 'Bán thời gian', contract: 'Hợp đồng', temporary: 'Thời vụ' }

/**
 * A staged job → the row to store, or the reason it is dropped. `now` is injected so the tests and a
 * replayed stage see the same clock.
 */
export function mapStagedJob(j: StagedJob, now: number): { ok: true; job: MappedJob } | { ok: false; reason: JobDrop } {
  const board = JOB_SOURCES[j.source]
  if (!board) return { ok: false, reason: 'unknownSource' }
  const b = JOB_BOARDS[board]
  const u = normaliseJobUrl(j.url)
  if (!u || !(b.hosts as readonly string[]).includes(u.hostname)) return { ok: false, reason: 'badUrl' }
  const hash = hashOf(j.url)
  const id = jobNativeId(board, u, hash)
  if (!id) return { ok: false, reason: 'noJobId' }
  const link = (b as Board).hashId ? `${u.toString()}#${/^#[\w-]+$/.test(hash) ? hash.slice(1) : ''}` : u.toString()

  // A parse that read page chrome instead of the job (the ESL Boards banner, a class attribute) —
  // the whole row is suspect, so it is dropped rather than patched.
  const rawTitle = (j.title ?? '').replace(/\s+/g, ' ').trim()
  if (rawTitle.length < 6 || rawTitle.length > 220 || /[<>]|class=|^find your next\b/i.test(rawTitle)) return { ok: false, reason: 'badTitle' }
  const employer = j.employer ? unshout(j.employer) : null
  if (employer && (employer.length > 120 || /[<>"=]|^\//.test(employer))) return { ok: false, reason: 'badEmployer' }
  if (new Set((rawTitle.match(ABROAD) ?? []).map((s) => s.toLowerCase())).size >= 2) return { ok: false, reason: 'multiCountry' }
  if (j.category !== 'teaching' && j.category !== 'english') return { ok: false, reason: 'badCategory' }

  const posted = Date.parse(j.datePosted)
  if (!Number.isFinite(posted) || posted > now + 86_400_000) return { ok: false, reason: 'badDate' }
  if (posted < now - MAX_LISTED_DAYS * 86_400_000) return { ok: false, reason: 'tooOld' }
  const cap = vnDay(new Date(posted + MAX_LISTED_DAYS * 86_400_000))
  if (!ISO_DAY.test(j.applyBy ?? '')) return { ok: false, reason: 'badDate' }
  const applyBy = j.applyBy < cap ? j.applyBy : cap
  if (applyBy < vnToday(now)) return { ok: false, reason: 'closed' }

  const provinces = jobProvinces(j.city, rawTitle, u.pathname.replace(/[-_/]+/g, ' '))
  if (!provinces.length) return { ok: false, reason: 'noCity' }

  const title0 = unshout(rawTitle)
  // Unique, informative titles: "<role> — <employer>" unless the title already names the employer.
  const title = (employer && !fold(title0).includes(fold(employer).slice(0, 12)) ? `${title0} — ${employer}` : title0).slice(0, 200)
  // ⚠️ A pay/benefits line that mentions a visa ("…; work permit and visa/TRC support") is DROPPED, not the job:
  // eno.vn carries no visa wording, but the vacancy itself is fine (2026-09-27, VTJ/VUS postings). A title or
  // employer that says visa still drops the job below — that text cannot be left out.
  const salaryFull = j.salary ? j.salary.replace(/\s+/g, ' ').trim() : null
  // Tested on the FULL line, before it is cut to 120 characters — a visa clause past the cut still counts.
  const salaryText = salaryFull && !hasVisaWord(salaryFull) ? salaryFull.slice(0, 120) : null
  const type = jobType(j.employment, rawTitle)

  // ⛔ SCREEN THE SOURCE'S WORDS, not eno's own intro (which names the board's domain and would trip
  // the link rule on every row) — same split as nhatot-listing.ts.
  try {
    assertCleanTexts([title, employer, salaryText, j.city])
  } catch (e) {
    if (e instanceof PublishBlockedError) return { ok: false, reason: e.code === 'banned_words' ? 'bannedWords' : 'contactInText' }
    throw e
  }
  // ⛔ eno.vn IS THE LICENSED EDITION: visa is "not even a mention" there (CLAUDE.md, owner 2026-07-31),
  // and src/lib/lang-segment.guard.test.ts holds the UI to it. An employer's "+ Visa Support" is not
  // eno offering visas, but the rule is literal, so such a posting is dropped rather than reworded.
  if (hasVisaWord([rawTitle, employer].filter(Boolean).join(' '))) return { ok: false, reason: 'visaMention' }
  // The FULL pay line is screened for fees/discrimination even when it is left off the listing for a visa word.
  const deny = jobDenyReason([rawTitle, employer, salaryFull].filter(Boolean).join(' '))
  if (deny) return { ok: false, reason: deny === 'adult-venue' ? 'adultVenue' : deny }

  const salary = parseJobPay(salaryText)
  const postedOn = vnDay(new Date(posted))
  const place = provinces.join(', ')
  const teaching = j.category === 'teaching'
  const lead = teaching ? 'English-teaching job' : 'Job for English speakers'
  const leadVi = teaching ? 'Việc làm giáo viên tiếng Anh' : 'Việc làm cho người nói tiếng Anh'
  // The facts themselves are the PDP's Details rows (attributes, below) — repeating them here rendered
  // as one run-on line, since the description renderer joins single newlines.
  const pay = salaryText ? ` Salary: ${salaryText}.` : ''
  const payVi = salaryText ? ` Mức lương: ${salaryText}.` : ''
  const description = `${lead}${employer ? ` at ${employer}` : ''} in ${place}${type ? ` (${EN_TYPE[type]!.toLowerCase()})` : ''}, posted on ${b.name} on ${postedOn}; apply by ${applyBy}.${pay}\n\neno.vn links to the original posting — read the full ad and apply there. eno.vn does not handle applications, has not verified this employer, and never charges a fee. Never pay to get a job.`
  const descriptionVi = `${leadVi}${employer ? ` tại ${employer}` : ''}, ${place}${type ? ` (${VI_TYPE[type]!.toLowerCase()})` : ''}, đăng trên ${b.name} ngày ${postedOn}; hạn nộp hồ sơ ${applyBy}.${payVi}\n\neno.vn dẫn link tới tin tuyển dụng gốc — xem đầy đủ và ứng tuyển tại đó. eno.vn không xử lý hồ sơ, chưa xác minh nhà tuyển dụng này và không bao giờ thu phí. Đừng bao giờ trả tiền để có việc làm.`

  const attributes: Record<string, string> = {}
  if (employer) attributes.employer = employer
  if (salaryText) attributes.salaryText = salaryText
  if (type) attributes.jobtype = type
  attributes.english = 'required'
  attributes.postedOn = postedOn
  attributes.applyBy = applyBy
  attributes.source = b.name

  return {
    ok: true,
    job: {
      board, sellerId: b.sellerId, sellerName: b.name,
      externalId: `${board}:${id}`,
      affiliateUrl: link,
      title, description, descriptionVi,
      price: salary?.price ?? 0, priceUnit: salary?.priceUnit ?? 'VND/month', salaryM: salary?.salaryM ?? null,
      categorySlug: 'jobs',
      subcategorySlug: teaching || TEACHING_ROLE.test(rawTitle) ? 'teaching' : 'job-other',
      city: provinces[0]!, location: place,
      attributes,
      searchText: buildSearchText([title, employer, place, b.name, teaching ? 'english teacher teaching esl giáo viên tiếng anh' : 'english speaking job việc làm tiếng anh']),
      postedAt: new Date(Math.min(posted, now)),
      applyBy,
      coverPath: j.coverPath,
    },
  }
}

/** Stage-file problems that refuse --apply. `stagedAt` is the file's own clock, not its mtime. */
export function jobStageProblem(stage: unknown, now: number): string | null {
  const s = stage as Partial<JobStage> | null
  if (!s || typeof s !== 'object' || !Array.isArray(s.jobs)) return 'not a jobs stage file (no jobs array)'
  const t = Date.parse(s.stagedAt ?? '')
  if (!Number.isFinite(t)) return 'stage has no valid stagedAt'
  if (t > now + 3_600_000) return `stagedAt ${s.stagedAt} is in the future`
  if (now - t > STAGE_MAX_AGE_H * 3_600_000) return `stage is ${((now - t) / 3_600_000).toFixed(0)} h old (> ${STAGE_MAX_AGE_H} h) — re-run exportJobs`
  return null
}

/** Rows whose apply-by has passed — what `--expire` hides. Unparseable or missing = expired too:
 *  a job row with no readable deadline has no date on which its Apply button would ever close. */
export function isExpiredJob(attributes: string | null, now: number): boolean {
  let a: unknown = null
  try { a = JSON.parse(attributes ?? 'null') } catch { return true }
  const d = (a as { applyBy?: unknown } | null)?.applyBy
  return typeof d !== 'string' || !ISO_DAY.test(d) || d < vnToday(now)
}

/** ISR tombstone tags for one listing's PDP, both language variants (cache-handler.cjs reads them;
 *  purge-isr-listings.mjs writes the route-wide ones the same way). */
export const pdpTombstoneTags = (id: string) => ['en', 'vi'].map((l) => `eno:isrtag:_N_T_/${l}/listings/${id}`)
