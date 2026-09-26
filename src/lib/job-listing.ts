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
 *    adult-venue work, fees). A hit drops the row; nothing is "cleaned" and published.
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
import { assertCleanTexts, PublishBlockedError } from './publish-guard'
import { buildSearchText, fold } from './fold'

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

type Board = { sellerId: string; name: string; hosts: readonly string[]; id: RegExp | null }

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
  // Added 2026-09-27 after the source-discovery sweep: robots allows (and welcomes crawlers), no terms clause.
  tesljobs: { sellerId: 'tesljobs-com-import-seller-0001', name: 'TeslJobs', hosts: ['tesljobs.com', 'www.tesljobs.com'], id: /^\/jobs\/[a-z0-9-]+-([A-Za-z0-9]{6,16})$/ },
  // ⚠️ PUBLISHED ON THE OWNER'S WORD (2026-09-25: "topcv and vietnamworks have permissions"). The site terms
  // alone forbid display (vietnamworks.com/thoa-thuan-su-dung); the permission is the owner's, not the terms'.
  // The id is the number before "-jv", not the title slug before it.
  vietnamworks: { sellerId: 'vietnamworks-com-import-seller-0001', name: 'VietnamWorks', hosts: ['www.vietnamworks.com', 'vietnamworks.com'], id: /^\/[^/]+-(\d{6,9})-jv$/ },
} as const satisfies Record<string, Board>
export type BoardKey = keyof typeof JOB_BOARDS

/** Pipeline source id → board. Two CareerLink searches feed one board, two Việc Làm 24h searches another.
 *  (Việc Làm 24h's earlier 403s were our own Accept header, not a block — fixed in the pipeline 2026-09-25.) */
export const JOB_SOURCES: Record<string, BoardKey> = {
  'careerlink-teach': 'careerlink', 'careerlink-english': 'careerlink',
  eslcafe: 'eslcafe', teast: 'teast', vtj: 'vtj', eslgorilla: 'eslgorilla', eslboards: 'eslboards',
  'tefl-org': 'teflorg', vas: 'vas', eiv: 'eiv', nordanglia: 'nordanglia', inspired: 'inspired',
  'vieclam24h-teach': 'vieclam24h', 'vieclam24h-english': 'vieclam24h', rmit: 'rmit', tta: 'tta',
  vietnamworks: 'vietnamworks', tesljobs: 'tesljobs',
}

export const JOB_SELLER_IDS: string[] = Object.values(JOB_BOARDS).map((b) => b.sellerId)

/** The row key a (source, url) pair maps to — the same key mapStagedJob gives it — or null. */
export function jobExternalId(source: string, url: string): { sellerId: string; externalId: string } | null {
  const board = JOB_SOURCES[source]
  const u = board ? normaliseJobUrl(url) : null
  const id = board && u ? jobNativeId(board, u) : null
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

/** The board's own id for a posting, from its normalised path. Null = refuse the row. */
export function jobNativeId(board: BoardKey, u: URL): string | null {
  const b: Board = JOB_BOARDS[board]
  if (!b.hosts.includes(u.hostname)) return null
  let path: string
  try { path = decodeURIComponent(u.pathname) } catch { return null }
  const m = b.id ? b.id.exec(path) : /\/([^/]+)$/.exec(path)
  const id = m?.[1]
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

/**
 * A stated VND amount per month or per hour → what to store. Only the forms we can read without
 * guessing: "15,000,000–20,000,000 VND / month", "500.000 VNĐ/giờ", "From 12,000,000 VND/month".
 * A single amount is the price; a RANGE (or "from") is price 0 with `salaryM` = its lower bound.
 * "Up to …" (a ceiling, not a price), USD, per day/year, or anything unparsed → null (price 0).
 */
export function parseJobPay(text: string | null | undefined): JobPay {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (/(^|[^\p{L}])(up to|tối đa|max(imum)?)(?!\p{L})/iu.test(t)) return null
  // ⚠️ `(?!\p{L})`, not `\b`: JavaScript's \b is ASCII-only, so it never matches after "đ" or "giờ".
  const m = /^(?:from |từ )?(\d[\d.,]*)(?: ?[–-] ?(\d[\d.,]*))? ?(?:vnd|vnđ|đ|₫|dong)(?!\p{L}) ?(?:\/|per|mỗi|một)? ?(month|tháng|hour|giờ|hr)(?!\p{L})/iu.exec(t)
  if (!m) return null
  const lo = num(m[1]!)
  const hi = m[2] ? num(m[2]) : lo
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null
  const single = hi === lo && !/^(from|từ)\b/i.test(t)
  if (/^(month|tháng)$/i.test(m[3]!)) {
    if (lo < 1_000_000 || lo > 500_000_000) return null
    return { price: single ? lo : 0, priceUnit: 'VND/month', salaryM: Math.floor(lo / 1_000_000) }
  }
  if (lo < 20_000 || lo > 5_000_000) return null
  return { price: single ? lo : 0, priceUnit: 'VND/hour', salaryM: null }
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
 * FOLDED text, so diacritics cannot slip a word past it.
 */
const JOB_DENY: [RegExp, string][] = [
  [/\b(caucasian|white (only|skin|faces?|teachers? only)|no (asians?|africans?|filipinos?|indians?|blacks?)|(female|male|women|men) only|aged? (under|below) \d{2}|under \d{2} (years old|yo)|(maximum|max) age|age limit|young and (pretty|attractive)|ngoai hinh (dep|ua nhin)|(nu|nam) duoi \d{2}|duoi \d{2} tuoi|chi tuyen (nu|nam))\b/, 'discriminatory'],
  [/\b(karaoke|massage|hostess|bar girl|escort|nightclub|tiep vien nha hang|chan dai)\b/, 'adult-venue'],
  [/\b(fee required|deposit required|pay (a |the )?(fee|deposit)|training fee|registration fee|phi dao tao|dat coc|nop phi|phi ho so|phi dang ky)\b/, 'fee'],
]

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
  const id = jobNativeId(board, u)
  if (!id) return { ok: false, reason: 'noJobId' }

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
  const salaryText = j.salary ? j.salary.replace(/\s+/g, ' ').trim().slice(0, 120) : null
  const type = jobType(j.employment, rawTitle)

  // ⛔ SCREEN THE SOURCE'S WORDS, not eno's own intro (which names the board's domain and would trip
  // the link rule on every row) — same split as nhatot-listing.ts.
  try {
    assertCleanTexts([title, employer, salaryText, j.city])
  } catch (e) {
    if (e instanceof PublishBlockedError) return { ok: false, reason: e.code === 'banned_words' ? 'bannedWords' : 'contactInText' }
    throw e
  }
  const folded = ` ${fold([rawTitle, employer, salaryText].filter(Boolean).join(' '))} `
  // ⛔ eno.vn IS THE LICENSED EDITION: visa is "not even a mention" there (CLAUDE.md, owner 2026-07-31),
  // and src/lib/lang-segment.guard.test.ts holds the UI to it. An employer's "+ Visa Support" is not
  // eno offering visas, but the rule is literal, so such a posting is dropped rather than reworded.
  if (/\b(visas?|thi thuc)\b/.test(folded)) return { ok: false, reason: 'visaMention' }
  for (const [re, why] of JOB_DENY) {
    if (re.test(folded)) return { ok: false, reason: why === 'adult-venue' ? 'adultVenue' : (why as JobDrop) }
  }

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
  const description = `${lead}${employer ? ` at ${employer}` : ''} in ${place}${type ? ` (${EN_TYPE[type]!.toLowerCase()})` : ''}, posted on ${b.name} on ${postedOn}; apply by ${applyBy}.${pay}\n\neno.vn links to the original posting — read the full ad and apply there. eno.vn does not handle applications, has not vetted this employer, and never charges a fee. Never pay to get a job.`
  const descriptionVi = `${leadVi}${employer ? ` tại ${employer}` : ''}, ${place}${type ? ` (${VI_TYPE[type]!.toLowerCase()})` : ''}, đăng trên ${b.name} ngày ${postedOn}; hạn nộp hồ sơ ${applyBy}.${payVi}\n\neno.vn dẫn link tới tin tuyển dụng gốc — xem đầy đủ và ứng tuyển tại đó. eno.vn không xử lý hồ sơ, chưa kiểm duyệt nhà tuyển dụng này và không bao giờ thu phí. Đừng bao giờ trả tiền để có việc làm.`

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
      affiliateUrl: u.toString(),
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
