/**
 * D3 — THE JOB-AD HISTORY LOG (~/eno-seo-teachers-2026-10/PLAN.md §3(d), 2026-10-19): "Start the log now (effort S,
 * internal only …): store first_seen, last_seen and parsed fields for every ingested ad. Publish later, only after counsel …
 * Rules: aggregates only, never ad text; report 'work permit support', never visa or TRC metrics."
 *
 * The pure half and the one write of the JobAdSighting table (prisma/schema.prisma; DDL scripts/job-ad-sightings-ddl.mjs),
 * unit-tested in job-ad-sightings.test.ts — the statement itself executed there in PGlite. scripts/import-jobs.ts is the only
 * path that ingests third-party job ads, and the only caller: one batched upsert per --apply run.
 *
 * ⛔ 1. AN AD THE IMPORTER TOOK IN, AS THE FACTS IT PARSED. A row is made only from an ad the run KEEPS — mapStagedJob mapped
 *    it, the import screen passed it, its cover was there: what eno would publish. An ad a screen refuses is not logged, and
 *    neither is the refusal's reason (a 'visaMention' count would itself be a visa metric); a staged ad whose cover the
 *    pipeline failed to draw is logged the next day it is staged with one; an ad whose listing a moderator REMOVED is not
 *    logged from then on (sightingsToLog); a row its earlier sightings made stays as it was. A row holds only parsed facts:
 *    the role title, the province, the employer line, the employment type, the pay's numbers, work permit support, the
 *    category, the posting and apply-by days. Never the ad's text, the pay line as written, the link, a contact, an employer
 *    line the name check reads as a person's (namesAPerson — a heuristic), or a visa / TRC / residence field: the model has no column for one, and jobAdSightingOf
 *    re-screens every text it keeps (the key too, for a visa word), so a caller that skipped the screens still cannot store
 *    one. ⚠️ The TITLE is kept as the board published it — the words the public listing shows — after the phone, contact
 *    and visa screens; a person's name inside a title is not detected (none in the 48-stage corpus). "Work permit support" (workPermitSupportOf) is read
 *    from the title and the RAW pay line — before mapStagedJob drops a line that also names a visa — and kept as
 *    true / null / false alone: never the words it was read from, never a visa or TRC flag or count.
 * ⛔ 2. A SIGHTING IS A STAGE. Its time is the stage's own `stagedAt` (the pipeline re-checked every staged posting live just
 *    before it wrote the file), never the import's clock: importing one stage twice changes nothing (bar a listing id it can
 *    now fill in), and an older stage imported late only moves firstSeenAt back. seenCount counts the stages that carried the
 *    ad, imported in time order (the daily job's order); ⚠️ a stage whose time falls strictly between firstSeenAt and
 *    lastSeenAt is not counted, so a backfill from old stage files must run NEWEST FIRST. The facts follow the newest stage.
 *    The posting day is not a fact that follows: postedOn keeps the EARLIEST day any stage carried and lastPostedOn the
 *    LATEST, so a job a board re-posts under the same link keeps its first sighting and shows the re-post
 *    (lastPostedOn > postedOn) — a report counts re-posts by lastPostedOn's week.
 * ⛔ 3. IT NEVER FAILS OR HOLDS UP AN IMPORT. One statement per SIGHTING_CHUNK ads and no read before it, no other network call;
 *    any error — the table not made yet included — is logged, and the import carries on exactly as before. ONE BAD ROW LOSES
 *    ONLY ITSELF: Postgres refuses a whole statement for one value it cannot take (SQLSTATE class 22), so such a chunk is
 *    sent again one row at a time, and the outcome names the ads it refused alone. jobAdSightingOf makes those values
 *    unlikely in the first place — control characters and broken surrogates out, impossible days refused.
 */
import { fold } from './fold'
import { containsContactInfo } from './publish-guard'
import { containsPhoneNumber } from './phone'
import { hasVisaWord, parseJobPayRange, unshout, type BoardKey, type MappedJob, type StagedJob } from './job-listing'
import { isRemovedStatus } from './listing-removed'

/** One JobAdSighting row as the writer sends it: a key, the eno listing, or a parsed fact — nothing else (SIGHTING_FIELDS). */
export type JobAdSighting = {
  externalId: string
  board: BoardKey
  listingId: string | null
  title: string
  city: string
  employer: string | null
  employmentType: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: 'VND' | null
  salaryPeriod: 'month' | 'hour' | null
  /** workPermitSupportOf: true, null (named, not said to be arranged) or false (not named). */
  workPermitSupport: boolean | null
  category: 'teaching' | 'english'
  subcategory: MappedJob['subcategorySlug']
  /** Vietnam days, YYYY-MM-DD. The statement stores postedOn as both postedOn and lastPostedOn on a first sighting. */
  postedOn: string
  applyBy: string | null
}

/** Every field the writer sends — the statement's columns, in its order. The JSON it sends is built from this list alone. */
export const SIGHTING_FIELDS = [
  'externalId', 'board', 'listingId', 'title', 'city', 'employer', 'employmentType', 'salaryMin', 'salaryMax', 'salaryCurrency',
  'salaryPeriod', 'workPermitSupport', 'category', 'subcategory', 'postedOn', 'applyBy',
] as const satisfies readonly (keyof JobAdSighting)[]

/** Ads per statement: one statement for a daily stage (a few dozen ads), a bounded parameter beyond. */
export const SIGHTING_CHUNK = 500

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A real day, YYYY-MM-DD — the shape AND the calendar, by a round trip: "2026-11-31" has the shape, and Postgres refuses it
 * (22008) and with it every row in the statement. Postgres has no year 0000 either.
 */
export function isCalendarDay(d: string | null | undefined): d is string {
  if (typeof d !== 'string' || !ISO_DAY.test(d) || d.startsWith('0000')) return false
  const t = Date.parse(`${d}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d
}

/**
 * A text as a fact: whitespace runs read as one space; control characters (\p{Cc}: NUL, ESC, DEL, the C1 range) and lone
 * surrogates (\p{Cs}) go — neither is part of a fact, and Postgres refuses a NUL (22P05) or a lone surrogate (22P02) in the
 * statement's JSON. Run BEFORE the screens, so a control character cannot split a word they look for.
 */
const factText = (s: string) => s.replace(/[\s\p{Cc}\p{Cs}]+/gu, (run) => (/\s/.test(run) ? ' ' : '')).trim()

/** The first `n` UTF-16 units, never half a character: a cut through a surrogate pair (an emoji across unit 200) drops the
 *  lone half it would leave. */
const cutAt = (s: string, n: number) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '')

// ── a person's name ─────────────────────────────────────────────────────────────────────────────────────────────────
const EN_TITLE = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr'])
const VI_TITLE = new Set(['anh', 'chị', 'cô', 'thầy', 'ông', 'bà'])
/** After a Vietnamese title, the words that make the line a language, a country or a place: Anh ngữ / Anh văn (English),
 *  Anh Quốc (Britain), Bà Rịa. */
const VI_NOT_A_NAME = new Set(['ngữ', 'văn', 'quốc', 'rịa'])
/** The common Vietnamese surnames, folded — "Nguyễn" and "Nguyen" alike: the sixteen most common, then the next ones a
 *  review found names under (Trịnh, Đinh, Mai…; 2026-10-20). A place that starts with one ("Hà Nội", "Lâm Đồng", "Thái
 *  Bình") reads as a name and only blanks the employer. */
const VI_SURNAME = new Set([
  'nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo', 'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly',
  'trinh', 'dinh', 'mai', 'lam', 'luu', 'ha', 'cao', 'doan', 'dao', 'luong', 'truong', 'ta', 'thai', 'chau', 'quach', 'la',
  'to', 'tang', 'vuong', 'kieu', 'trieu', 'tong', 'phung', 'diep', 'thach', 'khuc', 'mac', 'tieu', 'au', 'chu', 'hua', 'ton',
])
/** Common English given names, lower case — never one that is also an everyday word or a place (Grace, May, Joy, Mark,
 *  Victoria, Jordan…), which a school or a company could be called. Matched on the word as written, not folded: "Bến",
 *  "Dân" and "Tôm" are Vietnamese words, not Ben, Dan and Tom. */
const EN_GIVEN = new Set((
  'aaron adam adrian alan alex alexander alice allen amanda amy andrea andrew andy angela ann anna anne anthony ashley ' +
  'barbara becky ben benjamin beth betty bob brandon brenda brian carl carol caroline catherine charles charlie charlotte ' +
  'cheryl chloe chris christina christine christopher cindy claire colin craig cynthia dan daniel danny dave david deborah ' +
  'denise dennis derek diana diane donald donna dorothy douglas dylan edward eleanor elizabeth ellen emily emma eric ethan ' +
  'evan frances gary george gordon graham greg gregory hannah harry heather helen henry ian isaac jack jacob jacqueline ' +
  'james jamie jane janet jason jeff jeffrey jennifer jenny jeremy jerry jessica jim jimmy joan joe john johnny jonathan ' +
  'joseph joshua joyce judith judy julia julie justin karen kate katherine kathleen kathryn katie keith kelly ken kenneth ' +
  'kevin kimberly kyle larry laura lauren linda lisa liz louise lucas lucy luke margaret maria martha martin mary matt ' +
  'matthew megan melissa michael michelle mike nancy natalie nathan neil nicholas nick nicole noah oliver olivia owen ' +
  'patricia patrick paul peter philip rachel raymond rebecca richard robert roger ronald ryan sally sam samantha samuel ' +
  'sandra sarah scott sean sharon simon sophia sophie stephanie stephen steve steven stuart susan teresa terry thomas ' +
  'tim timothy tina tom tommy tony tracy tyler vicky victor vincent wendy william zachary zoe'
).split(' '))
/** A word or pair that makes a line an institution or a business, never a person (folded, whole words). Not "trường": as
 *  the school word it STARTS a line ("Trường …") and so never reaches the surname rule, and later in a line it is a given
 *  name ("Nguyễn Xuân Trường"). */
const INSTITUTION = new RegExp(` (?:${[
  'school', 'schools', 'academy', 'academic', 'english', 'center', 'centre', 'centers', 'centres', 'education', 'educational',
  'edu', 'institute', 'institution', 'university', 'college', 'kindergarten', 'preschool', 'nursery', 'montessori', 'language',
  'languages', 'learning', 'training', 'tutoring', 'teach', 'teaching', 'tefl', 'tesol', 'ielts', 'toeic', 'esl', 'kids',
  'club', 'studio', 'office', 'group', 'company', 'corporation', 'corp', 'jsc', 'ltd', 'llc', 'inc', 'co', 'tnhh',
  'international', 'global', 'vietnam', 'city', 'high', 'primary', 'secondary', 'bilingual', 'campus', 'branch', 'agency',
  'recruitment', 'consulting', 'services', 'solutions', 'software', 'technology', 'hotel', 'resort', 'restaurant', 'cafe',
  'coffee', 'shop', 'store', 'cong ty', 'trung tam', 'mam non', 'tieu hoc', 'trung hoc', 'dai hoc', 'hoc vien', 'he thong',
  'tap doan', 'ngoai ngu', 'anh ngu', 'giao duc', 'quoc te', 'chi nhanh', 'thanh pho', 'song ngu', 'pho thong', 'thpt', 'thcs',
  'cua hang', 'nha hang', 'khach san', 'du lich',
].join('|')}) `)
/** Places that start with a surname: Hồ Chí Minh, Phan Thiết, Phan Rang. */
const SURNAME_PLACE = /^(?:ho chi minh|phan thiet|phan rang)\b/
const CAPITALISED = /^\p{Lu}\p{L}*$/u

/**
 * ⛔ AN EMPLOYER LINE THAT NAMES A PERSON IS NOT STORED — as far as a heuristic can tell (below). The line is read without a trailing
 * descriptor ("Chị Hoa (Tutor)", "Thầy Minh - Gia sư IELTS", "Chị Hoa, gia sư") and split on spaces AND dots ("Ms.Hoa
 * English", "Mrs.Linh"). It names a person when it is:
 *  · an English title before a capitalised word ("Ms Ngân English", "Mr. John Smith", "Dr. Lee English Centre");
 *  · a Vietnamese title ("giáo" after cô / thầy counts as part of it) and nothing but a name of one to three words, or four
 *    starting with a common surname ("Chị Hoa", "CHỊ HOA", "Cô giáo Lan", "Cô Mai Anh", "Cô Nguyễn Thị Mai Anh")
 *    — never "Anh ngữ / Anh văn / Anh Quốc …" (English, the language or the country) or "Bà Rịa" (a place);
 *  · a bare name, with no institution word (INSTITUTION): two to four capitalised words starting with a common Vietnamese
 *    surname ("Nguyễn Thị Lan", "Nguyen Thi Lan") — not a place that starts with one ("Hồ Chí Minh City") — or, Western
 *    order, two or three starting with a common English given name ("John Smith") or ending in a Vietnamese surname
 *    ("Linh Tran").
 * ⛔ IN ANY CASE: every word is read with its first letter capitalised, so a name typed in lower case is caught like a
 * capitalised one ("chị hoa", "ms hoa", "Nguyễn thị lan", "nguyen thi lan"). Capitals were never what made a line a name —
 * the title, the surname or the given name does — and a line read wrongly as a name only blanks the employer.
 * Measured 2026-10-20 on every job ever staged for the importer (48 files, 1,997 rows, 90 distinct employer lines as mapped):
 * exactly one hit, "Ms Ngân English" — a centre named after a person, left out; every other line is a school, centre,
 * company or recruiter, and none of them is newly left out by the rules added that day.
 * ⚠️ A heuristic, fail-closed for the shapes it knows: a school named after a historical figure ("Tiểu học Nguyễn Siêu") is
 * an institution, and stays — but one written as the bare name ("Lê Quý Đôn") is left out, which only blanks the employer.
 * Titles are not read for names: none of the 154 distinct titles that corpus would store holds one.
 */
export function namesAPerson(employer: string): boolean {
  const head = employer.normalize('NFC').replace(/\s*[(\-–—|,/].*$/u, '')
  const words = head.split(/[\s.]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  if (!words.length) return false
  const first = words[0]!.toLowerCase()
  const name = words.slice((first === 'cô' || first === 'thầy') && words[1]?.toLowerCase() === 'giáo' ? 2 : 1)
  if (/^\p{Lu}/u.test(name[0] ?? '')) {
    if (EN_TITLE.has(first)) return true
    if (VI_TITLE.has(first) && (name.length <= 3 || (name.length === 4 && VI_SURNAME.has(fold(name[0]!)))) && !VI_NOT_A_NAME.has(name[0]!.toLowerCase()) && name.every((w) => CAPITALISED.test(w))) return true
  }
  if (words.length < 2 || words.length > 4 || !words.every((w) => CAPITALISED.test(w))) return false
  const folded = words.map(fold)
  const line = folded.join(' ')
  if (INSTITUTION.test(` ${line} `) || SURNAME_PLACE.test(line)) return false
  if (VI_SURNAME.has(folded[0]!)) return true
  return words.length <= 3 && (EN_GIVEN.has(words[0]!.toLowerCase()) || VI_SURNAME.has(folded[folded.length - 1]!))
}

// ── work permit support ─────────────────────────────────────────────────────────────────────────────────────────────
/** Where a title or a pay/benefits line starts a new item: ; | • · a line break, or a sentence's end. Not a comma or a
 *  "+": "Housing, work permit, insurance" and "Free housing + work permit" are each one list of what the employer gives. */
const ITEM_BREAK = /[;|•·\n\r]|[.!?](?=\s|$)/u
/** The employer gives it — a word anywhere in the permit's item (folded): support, sponsor(ship), provide(d), arrange(d),
 *  help, assist(ance), cover(ed), include(d), offer(ed), handle(d), benefit(s), guarantee(d), reimburse(d), paid, free, giúp. */
const GIVES = /^(?:support|sponsor|provid|arrang|help|assist|cover|includ|offer|handl|benefit|guarante|reimburs)[a-z]*$|^(?:paid|free|giup)$/
/** …the same in Vietnamese, as phrases: hỗ trợ, cung cấp, bảo lãnh, tài trợ, chi trả, miễn phí, đài thọ, thu xếp. */
const GIVES_VI = / (?:ho tro|cung cap|bao lanh|tai tro|chi tra|mien phi|dai tho|thu xep) /
/** …or right before it only, being common words anywhere else: làm / xin / lo giấy phép lao động (doing, applying for,
 *  sorting it). */
const GIVES_VI_BEFORE = new Set(['lam', 'xin', 'lo'])
/** Within three words before it or two after, a word that makes it the candidate's (must hold, required, valid, already…)
 *  or says it is not given (no, not, without; không, chưa) — a mention, not support. */
const NOT_GIVEN = /^(?:must|need|needs|needed|require|required|requires|requirement|requirements|valid|hold|holds|holding|holder|holders|already|existing|eligible|mandatory|essential|preferred|prerequisite|no|not|without|non|never|khong|chua)$/
/** …the same in Vietnamese, as phrases: cần có, phải có, đã có, có sẵn, yêu cầu, bắt buộc, sở hữu. */
const NOT_GIVEN_VI = / (?:can co|phai co|da co|co san|yeu cau|bat buoc|so huu) /
/** ANYWHERE in the permit's item, however far from it: a negation (no, not, non, never, without, cannot, unable, the "t" of
 *  don't / can't / doesn't / won't; không, chưa) or the candidate sorting it out (own, yourself, themselves, responsible;
 *  tự lo, tự làm, tự chi trả) — the item is null whatever support word it also holds. */
const NOT_GIVEN_ITEM = /^(?:no|not|non|never|without|cannot|unable|t|own|yourself|yourselves|themselves|responsible|responsibility|khong|chua)$/
const NOT_GIVEN_ITEM_VI = / (?:tu lo|tu lam|tu chi tra) /

/** The permit's words at token `i`, as their count (0 = none): work permit(s), labour / labor permit, a glued "workpermit",
 *  giấy phép lao động, giấy phép làm việc, GPLĐ. */
function permitAt(t: readonly string[], i: number): number {
  const w = t[i]!
  if (/^workpermits?$/.test(w) || w === 'gpld') return 1
  if (/^(?:work|labou?r)$/.test(w) && /^permits?$/.test(t[i + 1] ?? '')) return 2
  if (w === 'giay' && t[i + 1] === 'phep' && ((t[i + 2] === 'lao' && t[i + 3] === 'dong') || (t[i + 2] === 'lam' && t[i + 3] === 'viec'))) return 4
  return 0
}

/**
 * ⛔ "WORK PERMIT SUPPORT" — the plan's one reportable non-pay fact (PLAN.md D3: report "work permit support", never visa or
 * TRC metrics), as a BOOLEAN ONLY. Read from the posting's title and its RAW pay/benefit line — before mapStagedJob drops a
 * line that also names a visa, as both support lines in the corpus do — and returned as:
 *  · true  — an item of the text names a work permit and says the employer provides, supports, sponsors, arranges, covers
 *            or helps with it ("Work Permit Support", "work permit provided", "hỗ trợ giấy phép lao động", "Benefits: work
 *            permit");
 *  · null  — it names one without saying so ("must hold a work permit", "Work permit required", "no work permit support",
 *            "We don't sponsor work permits", "Giáo viên tự lo giấy phép lao động", or a line cut off before it says);
 *  · false — it names none.
 * An item is the text between ITEM_BREAKs, read folded (case and marks off) and with camelCase split (#WorkPermitSupport).
 * ⚠️ A word test, conservative by design: a word next to the permit that makes it the candidate's, or a negation or the
 * candidate's own arranging anywhere in its item (NOT_GIVEN_ITEM), wins over any support word ("Must have work permit,
 * visa support provided", "Teachers must arrange their own work permit" are null), and an item with no support word is
 * null — so a doubt lands in "named, not arranged", never in "supported".
 */
export function workPermitSupportOf(...texts: (string | null | undefined)[]): boolean | null {
  let named = false
  for (const text of texts) {
    if (!text) continue
    for (const item of text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(ITEM_BREAK)) {
      const t = fold(item).split(/[^a-z0-9]+/).filter(Boolean)
      for (let i = 0; i < t.length; i++) {
        const n = permitAt(t, i)
        if (!n) continue
        named = true
        const near = [...t.slice(Math.max(0, i - 3), i), ...t.slice(i + n, i + n + 2)]
        const rest = [...t.slice(0, i), ...t.slice(i + n)]
        const notGiven = near.some((w) => NOT_GIVEN.test(w)) || NOT_GIVEN_VI.test(` ${near.join(' ')} `)
          || t.some((w) => NOT_GIVEN_ITEM.test(w)) || NOT_GIVEN_ITEM_VI.test(` ${t.join(' ')} `)
        if (!notGiven && (rest.some((w) => GIVES.test(w)) || GIVES_VI.test(` ${rest.join(' ')} `) || GIVES_VI_BEFORE.has(t[i - 1] ?? ''))) return true
        i += n - 1
      }
    }
  }
  return named ? null : false
}

/** A contact (phone, email, link, handle, house number) or a visa / TRC / residence word — what the log never stores. */
const refused = (text: string) => containsPhoneNumber(text) || containsContactInfo(text) || hasVisaWord(text)

/**
 * A staged ad the importer mapped (mapStagedJob ok, the import screen passed) → its history row, without a listing id (the
 * importer adds it once the run's writes are done). Null when the title fails a screen, the title, employer line or key
 * names a visa word, or a fact is malformed — never the case for a mapped ad; an employer line that holds a contact or
 * names a person is left out and the row kept. This is the never-store rule held in the one place every row passes through.
 */
export function jobAdSightingOf(staged: StagedJob, job: MappedJob): JobAdSighting | null {
  // The posting's own title — mapStagedJob's `title0`, before it adds " — <employer>" — cut where the listing title is.
  const title = cutAt(unshout(factText(staged.title ?? '')), 200)
  const line = job.attributes.employer ? factText(job.attributes.employer) : null
  // A contact or a person's name in the employer line costs the row only that fact — the ad is still one the board carried.
  const employer = line && !namesAPerson(line) && !containsPhoneNumber(line) && !containsContactInfo(line) ? line : null
  // The key is `<board>:<the board's job id>`, a URL slug on some boards: one naming a visa word is not stored. Not the
  // phone and contact screens: some boards' ids are long numbers that read as a phone number, and a slug holding a contact
  // holds it in the title too, which is refused.
  if (!title || refused(title) || (line && hasVisaWord(line)) || hasVisaWord(job.externalId)) return null
  if (staged.category !== 'teaching' && staged.category !== 'english') return null
  const postedOn = job.attributes.postedOn
  if (!isCalendarDay(postedOn)) return null
  // The pay line mapStagedJob kept (null when it held a visa word) — read for its numbers only; the line itself is never stored.
  const salaryText = job.attributes.salaryText ?? null
  const pay = salaryText && !refused(salaryText) ? parseJobPayRange(salaryText) : null
  return {
    externalId: job.externalId,
    board: job.board,
    listingId: null,
    title,
    city: job.city,
    employer,
    employmentType: job.attributes.jobtype ?? null,
    salaryMin: pay?.min ?? null,
    salaryMax: pay?.max ?? null,
    salaryCurrency: pay?.currency ?? null,
    salaryPeriod: pay?.period ?? null,
    // The RAW title and pay line (the line before mapStagedJob's visa drop): read for the boolean, never kept.
    workPermitSupport: workPermitSupportOf(staged.title, staged.salary),
    category: staged.category,
    subcategory: job.subcategorySlug,
    postedOn,
    applyBy: isCalendarDay(job.applyBy) ? job.applyBy : null,
  }
}

/**
 * ⛔ A TOMBSTONE IS LEFT AS IT IS — IN THE LOG TOO. import-jobs.ts leaves a listing a moderator or admin REMOVED "not
 * refreshed, not recreated" (src/lib/listing-removed.ts); so the ads to log are the run's sightings minus every ad whose
 * stored listing is `removed`: from then on not counted, not refreshed (a row here is what eno would publish, and a removed
 * ad is not); a row the ad's earlier sightings made stays as it was. Any other status — a job hidden as expired or gone —
 * is still an ad the board carries, and is logged.
 */
export function sightingsToLog<T extends { externalId: string }>(
  sighted: readonly T[],
  stored: readonly { externalId: string | null; status: string }[],
): T[] {
  const removed = new Set(stored.filter((s) => isRemovedStatus(s.status)).map((s) => s.externalId))
  return sighted.filter((s) => !removed.has(s.externalId))
}

/**
 * ⛔ THE ONE WRITE — an upsert per ad (rule 2 above): $1 the stage's `stagedAt` (ISO, read as UTC whatever the session's time
 * zone — the column is Prisma's UTC `timestamp(3)`), $2 the rows as JSON (sightingUpsertParams). A first sighting inserts
 * (seenCount 1; lastPostedOn = postedOn). A later one moves lastSeenAt, adds one to seenCount and refreshes the facts; an
 * older one only moves firstSeenAt back (and counts); any one widens the posting days (postedOn the earliest, lastPostedOn
 * the latest) without counting; the same stage again changes nothing — except a listing id now known, which never erases
 * one already stored.
 */
export const JOB_AD_SIGHTING_UPSERT_SQL = `INSERT INTO "JobAdSighting" AS s ("externalId", "board", "firstSeenAt", "lastSeenAt", "seenCount",
    "listingId", "title", "city", "employer", "employmentType", "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod",
    "workPermitSupport", "category", "subcategory", "postedOn", "lastPostedOn", "applyBy")
  SELECT r."externalId", r."board", $1::timestamptz AT TIME ZONE 'UTC', $1::timestamptz AT TIME ZONE 'UTC', 1,
    r."listingId", r."title", r."city", r."employer", r."employmentType", r."salaryMin", r."salaryMax", r."salaryCurrency",
    r."salaryPeriod", r."workPermitSupport", r."category", r."subcategory", r."postedOn", r."postedOn", r."applyBy"
  FROM jsonb_to_recordset($2::jsonb) AS r("externalId" text, "board" text, "listingId" text, "title" text, "city" text,
    "employer" text, "employmentType" text, "salaryMin" integer, "salaryMax" integer, "salaryCurrency" text,
    "salaryPeriod" text, "workPermitSupport" boolean, "category" text, "subcategory" text, "postedOn" date, "applyBy" date)
  ON CONFLICT ("externalId") DO UPDATE SET
    "seenCount" = s."seenCount" + CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" OR excluded."firstSeenAt" < s."firstSeenAt" THEN 1 ELSE 0 END,
    "firstSeenAt" = LEAST(s."firstSeenAt", excluded."firstSeenAt"),
    "lastSeenAt" = GREATEST(s."lastSeenAt", excluded."lastSeenAt"),
    "listingId" = COALESCE(excluded."listingId", s."listingId"),
    "postedOn" = LEAST(s."postedOn", excluded."postedOn"),
    "lastPostedOn" = GREATEST(s."lastPostedOn", excluded."lastPostedOn"),
    "title" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."title" ELSE s."title" END,
    "city" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."city" ELSE s."city" END,
    "employer" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."employer" ELSE s."employer" END,
    "employmentType" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."employmentType" ELSE s."employmentType" END,
    "salaryMin" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."salaryMin" ELSE s."salaryMin" END,
    "salaryMax" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."salaryMax" ELSE s."salaryMax" END,
    "salaryCurrency" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."salaryCurrency" ELSE s."salaryCurrency" END,
    "salaryPeriod" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."salaryPeriod" ELSE s."salaryPeriod" END,
    "workPermitSupport" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."workPermitSupport" ELSE s."workPermitSupport" END,
    "category" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."category" ELSE s."category" END,
    "subcategory" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."subcategory" ELSE s."subcategory" END,
    "applyBy" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."applyBy" ELSE s."applyBy" END
  WHERE excluded."lastSeenAt" > s."lastSeenAt" OR excluded."firstSeenAt" < s."firstSeenAt"
    OR excluded."postedOn" < s."postedOn" OR excluded."lastPostedOn" > s."lastPostedOn"
    OR (s."listingId" IS NULL AND excluded."listingId" IS NOT NULL)`

/** The statement's two parameters for one chunk: the stage's time, and the rows as JSON — SIGHTING_FIELDS only. */
export function sightingUpsertParams(rows: readonly JobAdSighting[], seenAt: string): [string, string] {
  return [seenAt, JSON.stringify(rows.map((r) => Object.fromEntries(SIGHTING_FIELDS.map((f) => [f, r[f]]))))]
}

/** The minimal database surface the write needs — a PrismaClient satisfies it. */
export type SightingDb = { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> }

/** `refused`: the ads the database refused one by one (a value it cannot take) — none when the failure was not a row's. */
export type SightingOutcome =
  | { ok: true; ads: number; written: number }
  | { ok: false; ads: number; written: number; error: string; refused: string[] }

/**
 * The SQLSTATE an error carries, however it arrives: the driver adapter's cause under Prisma's meta, the driver's own code
 * (pg, PGlite), or Prisma's "Raw query failed. Code: `22P02`" message (rum/store.ts and apple-siwa.ts read 42P01 the same
 * ways). Prisma's own codes (P2010…) are not SQLSTATEs.
 */
function sqlStateOf(e: unknown): string | null {
  const err = e as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } }; message?: unknown } | null
  for (const code of [err?.meta?.driverAdapterError?.cause?.originalCode, err?.code, err?.meta?.code]) {
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P[1-9]\d{3}$/.test(code)) return code
  }
  return /Code: `([0-9A-Z]{5})`/.exec(String(err?.message ?? ''))?.[1] ?? null
}

/** 42P01 however it arrives (sqlStateOf), or the message naming the missing table. */
function isMissingTable(e: unknown): boolean {
  const msg = String((e as { message?: unknown } | null)?.message ?? '')
  return sqlStateOf(e) === '42P01' || msg.includes('42P01') || (msg.includes('JobAdSighting') && msg.includes('does not exist'))
}

/** A data exception — SQLSTATE class 22: a value Postgres refuses (JSON it cannot read, a NUL, an impossible date, a number
 *  out of range). A row's fault, never the table's or the connection's. */
const isDataError = (e: unknown) => sqlStateOf(e)?.startsWith('22') ?? false

const messageOf = (e: unknown, max: number) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, max)

/**
 * Records one run's sightings (rule 3 above): the rows deduplicated by key (the first kept — ON CONFLICT may touch a row only
 * once per statement), SIGHTING_CHUNK to a statement, at the stage's `stagedAt`. NEVER THROWS: a failure is passed to `warn`
 * and returned, and the chunks before it stay written (each statement is its own transaction). A chunk refused for a value
 * (class 22) is sent again one row at a time; the rows refused alone are named in the outcome, and every other row is written.
 * `written` = rows inserted or changed; an ad seen again in the same stage is not one.
 */
/**
 * A stage's `stagedAt` as an exact instant, or null: an ISO date-time with a Z or ±hh:mm offset whose day is on the
 * calendar and whose clock reads 00:00:00–23:59:59. Date.parse alone reads "2026-02-30T…" as 2 March and "T24:00" as the
 * next day, and the row would be dated by the wrong stage. (The importer has already refused a stage dated in the future
 * or older than STAGE_MAX_AGE_H — jobStageProblem.)
 */
const STAGED_AT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
function exactInstant(stagedAt: string): number | null {
  const m = STAGED_AT.exec(stagedAt)
  if (!m || !isCalendarDay(m[1])) return null
  const t = Date.parse(stagedAt)
  return Number.isFinite(t) ? t : null
}

export async function recordJobAdSightings(
  db: SightingDb,
  rows: readonly JobAdSighting[],
  stagedAt: string,
  warn: (message: string) => void = console.warn,
): Promise<SightingOutcome> {
  const byKey = new Map<string, JobAdSighting>()
  for (const r of rows) if (!byKey.has(r.externalId)) byKey.set(r.externalId, r)
  const unique = [...byKey.values()]
  const refusedIds: string[] = []
  let refusal = ''
  let written = 0
  try {
    const t = exactInstant(stagedAt)
    if (t === null) throw new Error(`the stage has no valid stagedAt (${JSON.stringify(stagedAt)})`)
    const seenAt = new Date(t).toISOString()
    const write = (chunk: readonly JobAdSighting[]) => db.$executeRawUnsafe(JOB_AD_SIGHTING_UPSERT_SQL, ...sightingUpsertParams(chunk, seenAt))
    for (let i = 0; i < unique.length; i += SIGHTING_CHUNK) {
      const chunk = unique.slice(i, i + SIGHTING_CHUNK)
      try {
        written += await write(chunk)
      } catch (e) {
        // ⛔ ONE BAD ROW MUST NOT VOID THE RUN: only a data exception is a row's; anything else (the table, the connection)
        // ends the write as before.
        if (!isDataError(e)) throw e
        if (chunk.length === 1) { refusedIds.push(chunk[0]!.externalId); refusal ||= messageOf(e, 160); continue }
        for (const row of chunk) {
          try {
            written += await write([row])
          } catch (one) {
            if (!isDataError(one)) throw one
            refusedIds.push(row.externalId)
            refusal ||= messageOf(one, 160)
          }
        }
      }
    }
  } catch (e) {
    const error = isMissingTable(e)
      ? 'the JobAdSighting table does not exist yet — run scripts/job-ad-sightings-ddl.mjs'
      : messageOf(e, 300)
    warn(`  ! job-ad history log NOT written (${unique.length} ads, ${written} rows before the failure): ${error}`)
    return { ok: false, ads: unique.length, written, error, refused: refusedIds }
  }
  if (refusedIds.length) {
    const names = refusedIds.slice(0, 10).map((id) => JSON.stringify(id)).join(', ') + (refusedIds.length > 10 ? ` (+${refusedIds.length - 10} more)` : '')
    const error = `${refusedIds.length} of ${unique.length} ads NOT written, their values refused by the database (${refusal}): ${names} — the other ${unique.length - refusedIds.length} were recorded`
    warn(`  ! job-ad history log: ${error}`)
    return { ok: false, ads: unique.length, written, error, refused: refusedIds }
  }
  return { ok: true, ads: unique.length, written }
}
