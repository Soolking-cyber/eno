/**
 * Batdongsan.com.vn HCMC rentals → eno REFERENCE LISTINGS, FACTS ONLY.
 * Owner, 2026-09-21: "also add batdonsan listings".
 *
 * Run (DRY by default — a read-only database session):
 *   set -a; . ./.env; set +a; npx tsx scripts/import-batdongsan-rentals.ts --src <all_rentals.json> [--apply]
 *     [--max-age-days 7 --previous <the archived earlier all_rentals.json>] [--subcat apartment-rental]
 *     [--fresh-out <fresh set.json> [--crawl-log <all_rentals.crawl.json>]] [--journal-dir <durable dir>]
 *
 * ⚠️ FRESH-ONLY RE-IMPORT (owner, 2026-10-01: "batdongsan 1 photo apartments still fetch only 7 days fresh
 * ones"). `--max-age-days N` keeps only listings the card says were posted within N days OF THE SCRAPE —
 * the card's "Đăng 3 ngày trước" is relative to when it was read, so the scrape file must itself be ≤1 day
 * old (refused otherwise), and the scraper must start from an EMPTY file: it merges into the existing
 * all_rentals.json, whose carried-over rows keep their old "Đăng hôm nay".
 *
 * ⛔ THE 7-DAY RULE (owner, 2026-10-01 — src/lib/apartment-freshness.ts): an imported apartment stays live
 * only while Batdongsan shows it posted or re-posted within 7 days, refreshed weekly. This script is the
 * step that READS the source (the scrape file), so it writes the source's FRESH SET:
 *   --fresh-out F   every APARTMENT row of the scrape the age gate calls fresh — including rows already
 *                   in the database and rows the mapper below refuses for other reasons (negotiable
 *                   price, no coordinates, the content screen) — written atomically for
 *                   scripts/expire-apartment-rentals.ts, AFTER the import below succeeded (a set on disk
 *                   means its rows were created / revived first). Needs --max-age-days 7 (FRESH_DAYS) and
 *                   --subcat apartment-rental. Written in a dry run too; it is a file, not a write.
 *   ⛔ ONLY WITH THE SCRAPER'S CRAWL LOG (--crawl-log, default <src minus .json>.crawl.json), which
 *   scraper.py writes next to all_rentals.json. src/lib/batdongsan-crawl.ts re-derives from its per-page
 *   records that BOTH apartment lists (căn hộ chung cư + chung cư mini — the mapper below puts both in
 *   apartment-rental) were each read from page 1 to the END OF RESULTS with ≥95% of reads ok and the
 *   catch-up pass done, and that the log describes THIS file (same codes, crawl not merged into an old file).
 *   ⛔ A REFUSED SET DOES NOT STOP THE IMPORT (the lead, 2026-10-01): the rows that WERE read are still
 *   created, revived and re-dated — each on its own evidence — only the set is skipped, and the run exits
 *   3 so the weekly job alerts and does not run the expiry. Skipping the import too would leave live rows
 *   un-refreshed for exactly the weeks the backstop then reads their postedAt.
 *   ⛔ With a crawl log that describes the file, "carried over" means "not read by that crawl", NOT "same
 *   label as --previous": measured on the 2026-09-21 and 2026-10-01 scrapes, 1,037 of 11,892 shared codes
 *   showed the SAME in-window label ten days apart ("Đăng hôm nay" both times) — genuine daily/weekly
 *   re-posts that the label comparison would have expired. Without one, the label comparison stays.
 *   ONE judgement (judgeBdsRow) decides both the import gate and the set, so what is imported/revived and
 *   what is kept live can never disagree. The date is the label's WORST case — the far end of its range
 *   counted back from the earliest the label can have been read (the file's birth, or the crawl's start
 *   when earlier), dateKind 'renewal-label' — and the window is judged AT THAT FETCH MOMENT (the set's
 *   fetchedAt), not at the import: "Đăng 6 ngày trước" is inside the 7-day window when it is read.
 * REVIVAL (--max-age-days, --apply): a fresh row this pipeline took down — status 'expired' (the 7-day
 * rule) or 'stale' (retire-stale-batdongsan.ts) — goes back to 'active'; never 'hidden', 'removed' or
 * 'sold'. Its postedAt becomes the source date and its rankScore is recomputed from it. A live row whose
 * source date is AT LEAST A DAY newer than its postedAt (re-posted — isBdsRepost: the worst-case date moves
 * by hours with the read time, so a same-week re-run must not re-date every row) moves postedAt forward the
 * same way. src/lib/
 * batdongsan-apply.ts sequences them: the PLANNED change journaled (fsync) in --journal-dir before each
 * write; a rollback line only for a write that moved the row, guarded on the state it created and carrying
 * its own ISR tombstone; each revived page tombstoned as it lands (refused up front when the database has
 * no next_cache_tag table); whatever a throw or a failed tombstone leaves untombstoned goes to a
 * .retombstone.sql and the run exits 4 (5 when no set was written). New rows are created with postedAt = the source date and the
 * browseRankScore it implies (never "now") — only when the date is trusted (--max-age-days).
 * ⛔ A 'removed' row (the Law 122/2025 evidence tombstone) is never written: skipped when read so, and
 * every write is guarded on status, so one removed DURING the run is left alone too.
 * EXIT (bdsImportExitCode — scripts/apartments-weekly.sh reads them):
 *   0  done; with --fresh-out, the set was written.
 *   3  imported, but the fresh set was REFUSED (coverage not proven) — no set: do not expire.
 *   4  revived page(s) still have NO ISR tombstone — run the .retombstone.sql it names. The set, when
 *      --fresh-out asked for one, WAS written.
 *   5  tombstones owed AND --fresh-out wrote no set — refused, or the dated pass THREW part-way (a throw
 *      never writes the set): run the .retombstone.sql, and do not expire.
 *   1  any other failure: nothing owed, no set. (A throw that leaves tombstones owed exits 4/5, not 1,
 *      so the job names the repair; the error itself is printed above it.)
 * --limit is refused with --fresh-out: a set must only ever follow an import of everything it keeps live.
 *
 * Same shape as import-rever-rentals.ts — outbound `affiliateUrl`, no chat, `negotiable:false`,
 * `listingType:'rent'` (which is also the feed guard) — with TWO deliberate differences:
 *
 * ⛔ 1. THIS SCRIPT IMPORTS NO IMAGES; attach-batdongsan-photos.ts DOES, SEPARATELY. That split is
 * why `images` is create-only below — the two scripts share rows and the importer must never
 * clobber the other's work.
 * ⛔ THE AGENT HEADSHOTS ARE NEVER PUBLISHED. 9,419 of the 31,734 scraped files are `img_2.jpg`,
 * a photograph of a real, identifiable person; Vietnam's PDPD (Decree 13/2023) treats an image of
 * a person as personal data requiring consent. The attach script refuses them on filename AND on
 * decoded dimensions, failing closed.
 * ⚠️ WHAT THE OWNER DID ACCEPT (2026-09-22: "its ok if its watermarked add our watermark on top")
 * is the rival agency's burned-in watermark showing on our cards. ⚠️ SOME OF THOSE BURNED MARKS
 * ALSO CARRY THE AGENT'S NAME (e.g. "VIỆT NAM BHREALTY · Tố Trình Joyce"). That is a named private
 * individual arriving via the photo rather than via a headshot, and it is NOT the same thing the
 * owner was asked about. Flagged to the owner rather than decided here.
 *
 * ⛔ 2. LIVENESS CANNOT BE VERIFIED, SO THERE IS NO RETIRE PASS. Every url returns a Cloudflare
 * interstitial ("Just a moment…", HTTP 403) to anything automated — checked with curl AND a real
 * headless browser. A human's browser solves the challenge, so the outbound links work for readers;
 * we simply cannot re-check the 23,026 the way import-rever-rentals.ts re-checks all 3,555 before
 * every run. ⚠️ THIS IMPORT IS THEREFORE A SNAPSHOT THAT CANNOT SELF-CORRECT. It was fresh when
 * taken (99.8% posted within 7 days) and it will rot with no mechanism to notice. Re-scrape to
 * refresh; do not assume a re-run validates anything.
 *
 * ⚠️ COORDINATES COME FROM THE SOURCE and every row has them — the scrape was re-run at 15:21 on
 * 2026-09-21 adding `latitude`/`longitude`/`price_type`, so an earlier survey of this same file
 * (18 fields, no coordinates) is stale. Check the field list before trusting notes about it.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { APARTMENT_SUBCAT, FRESH_DAYS, REVIVABLE_STATUSES, freshSetProblem, type FreshSet } from '../src/lib/apartment-freshness'
import { bdsAgeDays, bdsScrapeStartMs } from '../src/lib/batdongsan-age'
import { applyBdsDatedChanges, bdsTombstoneSql, isBdsRepost, owedTombstonesOf, type BdsDatedChange, type BdsDatedOutcome } from '../src/lib/batdongsan-apply'
import { buildBdsFreshSet, coverageOfLog, crawlBindingProblem, judgeBdsRow, parseCrawlLog, type BdsVerdict, type CrawlCoverage, type ParsedCrawlLog } from '../src/lib/batdongsan-crawl'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { browseRankScore } from '../src/lib/ranking-formula'
import { invokedDirectly } from '../src/lib/cli-entry'
import { buildSearchText } from '../src/lib/fold'
import { roomAttributes } from '../src/lib/taxonomy'
import { localizeReferenceImportText, untranslatedSummary, type LocalizedImportTexts } from '../src/lib/import-i18n'
// ⛔ Every importer screens a row before it writes it — banned words + advertising-banned goods.
import { ImportScreen } from '../src/lib/import-screen'

/** ⛔ PINNED BY ID, never resolved by display name — `Seller.name` is not unique and IS user
 *  settable (`api/profile/account-type`), so a name lookup could attach these to a real shop. */
export const SELLER_ID = 'bds-vn-import-seller-0001'
const SELLER_NAME = 'Batdongsan.com.vn'

const SUBCAT: Record<string, string | null> = {
  'Căn hộ / Chung cư': 'apartment-rental',
  'Nhà phố / Biệt thự': 'house-rental',
  'Nhà trọ / Phòng trọ': 'room-rental',
  'Mặt bằng / Văn phòng': 'office-rental',
  'Kho xưởng / Đất': null,
  'Bất động sản khác': null,
}

const FLAGS = new Set(['--apply'])
const VALUED = new Set(['--src', '--limit', '--max-age-days', '--subcat', '--previous', '--fresh-out', '--crawl-log', '--journal-dir'])

/** The command line, checked — inside main(), never at import (the unit tests import compose()). */
export function parseArgs(argv: readonly string[]) {
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!FLAGS.has(a) && !VALUED.has(a)) throw new Error(`unknown argument "${a}"`)
    if (seen.has(a)) throw new Error(`${a} given twice`)
    seen.add(a)
    if (VALUED.has(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); i++ }
  }
  const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
  const limitRaw = str('--limit')
  const limit = limitRaw === null ? 0 : Number(limitRaw)
  if (!(Number.isInteger(limit) && limit >= 0)) throw new Error('--limit must be a non-negative integer')
  const maxAgeDays = str('--max-age-days') === null ? null : Number(str('--max-age-days'))
  if (maxAgeDays !== null && !(Number.isInteger(maxAgeDays) && maxAgeDays > 0)) throw new Error('--max-age-days must be a positive integer')
  const o = {
    apply: argv.includes('--apply'), src: str('--src'), limit, maxAgeDays, subcat: str('--subcat'), previous: str('--previous'),
    freshOut: str('--fresh-out'), crawlLog: str('--crawl-log'), journalDir: str('--journal-dir'),
  }
  if (!o.src) throw new Error('--src <all_rentals.json> is required')
  if (o.maxAgeDays !== null && !o.previous) throw new Error('--max-age-days needs --previous <the archived earlier scrape> — the carry-over check below')
  if (o.freshOut) {
    if (o.maxAgeDays !== FRESH_DAYS) throw new Error(`--fresh-out needs --max-age-days ${FRESH_DAYS} — the set and the import gate are one judgement`)
    if (o.subcat !== APARTMENT_SUBCAT) throw new Error(`--fresh-out needs --subcat ${APARTMENT_SUBCAT} — the 7-day rule covers apartments only`)
    // The set keeps live every fresh apartment of the scrape; a --limit import would create / revive only part of them.
    if (limitRaw !== null) throw new Error('--limit cannot be used with --fresh-out — the set must follow an import of every row it keeps live')
  } else if (o.crawlLog) throw new Error('--crawl-log is read only with --fresh-out')
  // Revival and re-post writes change status / postedAt / rankScore — journaled first, so a durable dir.
  if (o.apply && o.maxAgeDays !== null && !o.journalDir) throw new Error('--apply with --max-age-days needs --journal-dir <durable dir> (revivals and re-posts are journaled before they are written)')
  return o
}

/**
 * The run's exit code (header: EXIT). `setAsked` = --fresh-out; `setWritten` = this run's set is on disk.
 * A set asked for and not written — refused, or the run threw — is never expired against.
 */
export function bdsImportExitCode(s: { owed: number; setAsked: boolean; setWritten: boolean }): 0 | 3 | 4 | 5 {
  const noSet = s.setAsked && !s.setWritten
  if (s.owed > 0) return noSet ? 5 : 4
  return noSet ? 3 : 0
}

/** all_rentals.json → all_rentals.crawl.json, where scraper.py writes its crawl log. */
export const defaultCrawlLog = (src: string) => src.replace(/\.json$/i, '') + '.crawl.json'

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'
const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi
/**
 * ⛔ RE-PARSE THE AREA FROM `area_raw`; THE STORED `area_m2` IS WRONG BY 1000× ON 701 ROWS.
 * Vietnamese groups thousands with a DOT, so `'2.040 m²'` is 2,040 m² — the scraper read it as
 * 2.04. It surfaces as absurd rent-per-m² (a 1,080 m² Thảo Điền building at 981 million đ/m²) and
 * would publish "2.04 m²" in the title and in the area facet. Exactly the failure I shipped myself
 * in the Rever price parser (`4.5 tr` → 45,000,000): same separator, opposite direction.
 * ⚠️ The pattern must require GROUPS OF THREE (`1.080`, `2.040`) — a bare `4.5` is a real decimal
 * and must stay 4.5, so a blanket strip of dots would corrupt every small area instead.
 */
function areaOf(raw: unknown, stored: unknown): number | null {
  const m = /([\d.,]+)/.exec(String(raw ?? ''))
  if (m) {
    const t = m[1]
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
    const n = Number(t.replace(',', '.'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null
}

/** The outbound CTA is only as trustworthy as this check — pin the host, not just the scheme. */
const allowedTarget = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/batdongsan\.com\.vn\//.test(u)

type Row = Record<string, any>

/**
 * The four texts of one row. ⛔ LOCALIZED HERE, INSIDE COMPOSE, because `update: mutable` below
 * REFRESHES title / titleVi / description / descriptionVi on every re-run: a fix made only in the
 * database would be reverted by the next import. localizeReferenceImportText (src/lib/import-i18n.ts)
 * makes the English text English (title location, Type / Location values from the reviewed
 * dictionary, English-grouped rent) and gives the Vietnamese fact block Vietnamese labels
 * ("Loại hình:", "Giá thuê: … đ/tháng"); `missing` lists what the dictionary does not cover yet.
 * scripts/localize-import-listings.ts applies the same function to the rows already stored.
 */
export function compose(r: Row, price: number): LocalizedImportTexts {
  const bits: string[] = []
  if (r.bedrooms) bits.push(`${r.bedrooms} bed`)
  if (r.bathrooms) bits.push(`${r.bathrooms} bath`)
  if (r._area) bits.push(`${r._area} m²`)
  const where = [r.ward, r.district].filter(Boolean).join(', ')
  const kind = r.property_type ?? 'Property'
  const facts = ([
    ['Type', r.property_type], ['Area', r.area_raw], ['Bedrooms', r.bedrooms],
    ['Bathrooms', r.bathrooms], ['Location', r.location], ['Rent', `${vnd(price)}/month`],
  ] as [string, any][]).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  return localizeReferenceImportText({
    title: `${bits.join(' · ') || 'Property'} for rent — ${where}`,
    titleVi: `Cho thuê ${kind}${r.bedrooms ? ` ${r.bedrooms}PN` : ''}${r._area ? ` ${r._area}m²` : ''} — ${where}`,
    description: `Listed on Batdongsan.com.vn.\n\n${facts}`,
    descriptionVi: `Tin đăng trên Batdongsan.com.vn.\n\n${facts}`,
  })
}

/** A DIRECTORY entry (a create, a rename, an unlink) is durable only once the directory itself is fsync'd. */
function fsyncDir(dir: string) {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
/** Append + fsync the SAME handle, before the write it protects — and the directory, when this created the file. */
function appendDurably(file: string, line: string) {
  const created = !existsSync(file)
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  if (created) fsyncDir(dirname(resolve(file)))
}
function tmpRoots() {
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  return roots
}
/** Checked BEFORE any database call: an absolute dir the OS will not empty, that takes an fsync'd write. */
function prepareJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = tmpRoots()
  let problem = journalDirProblem(abs, roots)
  if (!problem && existsSync(abs)) problem = journalDirProblem(realpathSync(abs), roots.map((t) => { try { return realpathSync(t) } catch { return t } }))
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.bds-journal-probe-${process.pid}`)
  appendDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}
/** Write-then-rename, fsync'd (file AND directory): the reader sees the old file or the whole new one, never half of one. */
function writeFileAtomic(file: string, text: string) {
  const abs = resolve(file)
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp-${process.pid}`
  try {
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, abs)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* never written, or already renamed */ }
    throw e
  }
  fsyncDir(dirname(abs))
}
/** Removed, and the removal durable: a crash right after must not bring last week's set back. */
function removeDurably(file: string) {
  if (!existsSync(file)) return
  unlinkSync(file)
  fsyncDir(dirname(resolve(file)))
}
const isUniqueViolation = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002'

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const SRC = o.src!
  const MAX_AGE_DAYS = o.maxAgeDays
  const NOW = Date.now()
  // The --fresh-out path holds THIS run's set or nothing: an older set left there must not outlive a refusal below.
  // ⛔ Never one of the run's INPUTS — it is deleted first, and a typo there would destroy the scrape.
  if (o.freshOut) {
    const out = resolve(o.freshOut)
    for (const [flag, p] of [['--src', SRC], ['--previous', o.previous], ['--crawl-log', o.crawlLog ?? defaultCrawlLog(SRC)]] as const) {
      if (p && resolve(p) === out) throw new Error(`--fresh-out is the same file as ${flag} — refusing to delete an input`)
    }
    removeDurably(o.freshOut)
  }
  if (o.subcat && !Object.values(SUBCAT).includes(o.subcat)) throw new Error(`--subcat ${o.subcat} is not one of ${Object.values(SUBCAT).filter(Boolean).join(', ')}`)
  const journal = o.apply && MAX_AGE_DAYS !== null ? prepareJournalDir(o.journalDir!) : null

  /**
   * Why this run writes NO fresh set, or null. ⛔ A REFUSED SET DOES NOT STOP THE IMPORT (the lead,
   * 2026-10-01): the rows that were read are still created, revived and re-dated below — each on its own
   * evidence — and the run exits 3, so the weekly job alerts and does not run the expiry.
   */
  let setRefusal: string | null = null
  /**
   * What the crawl log says was READ (the carried-over test, and the earliest read) — kept only once it is
   * shown to describe this file. `coverage`: that every list was read whole (src/lib/batdongsan-crawl.ts).
   */
  let crawl: ParsedCrawlLog | null = null
  let coverage: CrawlCoverage | null = null
  const crawlLogPath = o.freshOut ? (o.crawlLog ?? defaultCrawlLog(SRC)) : null
  if (crawlLogPath) {
    if (!existsSync(crawlLogPath)) setRefusal = `no crawl log at ${crawlLogPath} — scrape with scraper.py --apartments --to-end --new (it writes one), or pass --crawl-log`
    else {
      let raw: unknown
      try { raw = JSON.parse(readFileSync(crawlLogPath, 'utf8')) } catch (e) { setRefusal = `crawl log ${crawlLogPath} is unreadable: ${e instanceof Error ? e.message : String(e)}` }
      if (setRefusal === null) {
        const parsed = parseCrawlLog(raw, NOW)
        if (parsed.problem !== null) setRefusal = `crawl log ${crawlLogPath}: ${parsed.problem}`
        else {
          crawl = parsed.log
          const cov = coverageOfLog(parsed.log)
          if (cov.problem !== null) setRefusal = `crawl log ${crawlLogPath}: ${cov.problem}`
          else coverage = cov.coverage
        }
      }
    }
  }

  /**
   * The card's age is relative to the scrape, so a --max-age-days import needs a scrape that is BOTH
   * recent (written ≤24 h ago, counted in exact hours — codex) AND started from an EMPTY file (created
   * ≤36 h ago). ⛔ The second is the one that matters (Opus, commit gate): the scraper merges into an
   * existing all_rentals.json, rewriting it in place, so carried-over rows keep their old "Đăng hôm nay"
   * while the file's mtime looks fresh — and a retired, let flat would be revived as "posted today".
   * Rewriting in place keeps the file's BIRTH time; only moving the old file aside makes a new one.
   */
  const st = statSync(SRC)
  const fileBornHoursAgo = (NOW - st.birthtimeMs) / 3_600_000
  if (MAX_AGE_DAYS !== null && !(fileBornHoursAgo <= 24)) throw new Error(`${SRC} was CREATED ${fileBornHoursAgo.toFixed(0)} h ago — the scraper merged into an old file, so its "Đăng hôm nay" labels cannot be trusted. Move the old file aside and scrape into a new one`)
  // ⛔ ONE row per listing code, the first in file order (the rule buildBdsFreshSet always used): a code the
  // scraper wrote twice with different labels would otherwise be judged twice — left out of the set by its
  // old label and created/revived by its fresh one, then expired minutes later by the same run's expiry.
  // Of a code's copies the FRESHEST label wins (a catch-up re-read of an ad re-posted mid-crawl comes after
  // its main-pass copy); ties and unreadable labels keep file order.
  const src: Row[] = (() => {
    const all: Row[] = JSON.parse(readFileSync(SRC, 'utf8'))
    const best = new Map<string, number>()
    const ageOf = (r: Row) => bdsAgeDays(r.published as string | undefined)?.maxDays ?? Infinity
    all.forEach((r, i) => {
      const k = String(r.code ?? '')
      if (!k) return
      const j = best.get(k)
      if (j === undefined || ageOf(r) < ageOf(all[j])) best.set(k, i)
    })
    return all.filter((r, i) => { const k = String(r.code ?? ''); return !k || best.get(k) === i })
  })()
  // ⛔ THE LOG MUST DESCRIBE THIS FILE, or it proves nothing about it — neither the set nor "read by this crawl".
  if (crawl) {
    const unbound = crawlBindingProblem(src.map((r) => r.code), crawl.codes)
    if (unbound) { setRefusal ??= `${unbound} (${crawlLogPath})`; crawl = null; coverage = null }
  }
  // WORST CASE: a row can date from any point since the file was CREATED, not just its last write
  // (Opus, commit gate) — so the scrape's age is counted from the file's birth, or from the crawl's own
  // start when that is earlier (scraper.py creates the file only at its first checkpoint).
  const readAtMs = bdsScrapeStartMs(st.birthtimeMs, crawl?.startedAtMs)
  const scrapeAgeHours = (NOW - readAtMs) / 3_600_000
  if (crawl && MAX_AGE_DAYS !== null && !(scrapeAgeHours <= 24)) throw new Error(`the crawl behind ${SRC} started ${scrapeAgeHours.toFixed(0)} h ago — over 24 h, its labels are too old to judge a 7-day window by. Scrape again`)
  /**
   * ⛔ CONTENT PROOF, NOT JUST TIMESTAMPS (codex + Opus, commit gate): file birth time is circumstantial —
   * a copy, a rename-save or another filesystem defeats it. A row CARRIED OVER from an earlier scrape
   * keeps that scrape's label verbatim; a listing genuinely re-posted since shows a NEW label. So a code
   * present in the previous scrape with the IDENTICAL `published` text is treated as carried over and
   * dropped. The error is one-sided by design: a re-post that happens to repeat its old label is skipped.
   * ⛔ WITH A CRAWL LOG THAT DESCRIBES THE FILE THE PROOF IS STRONGER AND THE LABEL TEST IS DROPPED: a row
   * is carried over iff that crawl did not read it (and crawlBindingProblem has already shown none is).
   * The label test's one-sided error is not small — see the header.
   */
  const previousLabel = new Map<string, string>()
  if (o.previous) for (const r of JSON.parse(readFileSync(o.previous, 'utf8')) as Row[]) if (r.code) previousLabel.set(r.code, String(r.published ?? ''))
  const read = crawl?.codes ?? null
  const judge = (r: Row): BdsVerdict => judgeBdsRow(r, {
    readAtMs, limitDays: MAX_AGE_DAYS ?? FRESH_DAYS,
    carried: read ? (code) => !read.has(code) : (code, label) => previousLabel.get(code) === label,
  })
  const isApartment = (pt: unknown) => SUBCAT[pt as string] === APARTMENT_SUBCAT

  /** Built and checked now; WRITTEN only after the import below ran — a set on disk means its rows exist. */
  let freshSet: FreshSet | null = null
  if (o.freshOut && coverage && setRefusal === null) {
    const cov = coverage
    // ⛔ Every row read on an apartment list must be an apartment here, or the set would leave it out while
    // the database may hold it as one (scraper.py classifies a card by the list it came from).
    const misfit = src.filter((r) => cov.apartmentCodes.has(r.code) && !isApartment(r.property_type)).length
    if (misfit) setRefusal = `${misfit} row(s) read on a Batdongsan apartment list are not classified 'Căn hộ / Chung cư' in ${SRC} — the set would leave them out`
    else {
      const sameLabel = src.filter((r) => isApartment(r.property_type) && previousLabel.get(r.code) === String(r.published ?? '')).length
      // The fetch moment is the EARLIEST read: the set's window and its 24 h limit both count from it.
      const fetchedAt = new Date(Math.floor(readAtMs))
      const { set, counts } = buildBdsFreshSet(src, {
        sellerId: SELLER_ID,
        fetchedAt,
        coverage: `${cov.evidence}; scrape file ${SRC} (born ${new Date(st.birthtimeMs).toISOString()}, ${src.length} rows, every one read by that crawl); labels judged at their worst case at the fetch moment ${fetchedAt.toISOString()}`,
        isApartment,
        judge,
      })
      const problem = freshSetProblem(set, NOW, SELLER_ID)
      if (problem) setRefusal = `the set fails its own check — ${problem}`
      else {
        freshSet = set
        console.log(`fresh set         ${set.items.length} apartments fresh at ${fetchedAt.toISOString()}, ${set.unknown?.length ?? 0} undetermined (unreadable label) · ${counts.old} older · ${counts.carried} not read by the crawl · ${counts.apartments} apartments in ${counts.rows} rows${counts.duplicate || counts.badCode ? ` · ${counts.duplicate} duplicate, ${counts.badCode} off-shape code` : ''} — written to ${o.freshOut} once the import has run`)
        console.log(`                  ${sameLabel} apartment rows repeat --previous's label verbatim — read by this crawl, so judged as re-posts, not carried over`)
        console.log(`coverage          ${cov.evidence}`)
      }
    }
  }
  if (setRefusal !== null) console.log(`⛔ FRESH SET      REFUSED — ${setRefusal}\n                  the import below still runs from what was read; no set is written, exit 3`)

  const { PrismaClient } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      // A dry run cannot write, whatever a bug below tries.
      ...(o.apply ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })

  /** Revived pages a throw or a failed tombstone left without their ISR tombstone (exit 4 / 5). */
  let owedTombstones: string[] = []
  /** The run threw AFTER owed tombstones were reported — the error is printed, no set is written (exit 5 / 4). */
  let threwOwing = false
  try {
    const drop = { subcat: 0, carried: 0, age: 0, label: 0, priceType: 0, priceRawPerM2: 0, price: 0, target: 0, area: 0, coords: 0, contentScreen: 0 }
    const keep: Row[] = []
    const screen = new ImportScreen('batdongsan-rentals', { db, sellerIds: [SELLER_ID] })
    for (const r of src) {
      if (o.subcat && SUBCAT[r.property_type] !== o.subcat) { drop.subcat++; continue }
      if (MAX_AGE_DAYS !== null) {
        // The same judgement the fresh set was built with (judgeBdsRow): carried over, unreadable, too old.
        const v = judge(r)
        if (v.kind === 'carried') { drop.carried++; continue }
        if (v.kind === 'unknown') { drop.label++; continue }
        if (v.kind === 'old') { drop.age++; continue }
        r._sourceDate = v.sourceDate
      }
      /** ⛔ `price_type` IS THE SOURCE'S OWN FLAG AND BEATS PARSING `price_raw`. 348 rows are quoted
       *  PER M² — publishing those as the monthly rent shows a 200m² office at 1.12tr instead of
       *  224tr. 219 more are "negotiable", i.e. no real figure at all. */
      if (r.price_type !== 'lump_sum') { drop.priceType++; continue }
      /**
       * ⛔ TWO INDEPENDENT GUARDS, BECAUSE THE SOURCE CONTRADICTS ITSELF. Four rows are flagged
       * `lump_sum` while their own `price_raw` reads "1,12 triệu/m²" — including a 200m² Bitexco
       * office that would publish at 1.12tr/month instead of 224tr. Trusting the structured flag
       * alone is a single point of failure on the one field a renter actually reads, and the dry
       * run surfaced it only because it prints a sample row. Either signal saying per-m² is enough
       * to drop it; agreeing is what lets it through.
       */
      if (String(r.price_raw ?? '').includes('/m')) { drop.priceRawPerM2++; continue }
      if (!Number.isFinite(r.price_vnd) || r.price_vnd < 1_000_000 || r.price_vnd > 2_000_000_000) { drop.price++; continue }
      if (!allowedTarget(r.url)) { drop.target++; continue }
      const area = areaOf(r.area_raw, r.area_m2)
      if (area === null) { drop.area++; continue }
      r._area = area
      if (!inRange(r.latitude, 8, 24) || !inRange(r.longitude, 102, 110)) { drop.coords++; continue }
      // ⛔ CONTENT SCREEN BEFORE ANY WRITE (src/lib/import-screen.ts) — on the exact texts the upsert
      // writes. A refused row is never created; an existing LIVE one is hidden (banned, applyHides below)
      // or refreshed and listed for review (ambiguous). The dry run counts refusals in `dropped`.
      // Spread, not field by field: src/lib/reference-listing-import.test.ts pins that the upsert is the
      // only place in this file that names the title columns.
      const { missing: _missing, ...texts } = compose(r, r.price_vnd)
      if (!(await screen.check({ ...texts, category: 'rentals', subcategory: SUBCAT[r.property_type] ?? null, extraTexts: [r.location, r.district], externalId: `bds:${r.code}`, url: r.url }))) { drop.contentScreen++; continue }
      keep.push(r)
    }
    const batch = o.limit ? keep.slice(0, o.limit) : keep

    const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
    if (!category) throw new Error('no `rentals` category')
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true, trustScore: true } })
    const already = await db.listing.count({ where: { sellerId: SELLER_ID } })
    /** The batch's existing rows (any status), read once: what a revival or a re-post changes is journaled from here. */
    const existing = new Map<string, { id: string; status: string; postedAt: Date; rankScore: number }>()
    const batchIds = batch.map((r) => `bds:${r.code}`)
    for (let i = 0; i < batchIds.length; i += 5000) {
      for (const l of await db.listing.findMany({ where: { sellerId: SELLER_ID, externalId: { in: batchIds.slice(i, i + 5000) } }, select: { id: true, externalId: true, status: true, postedAt: true, rankScore: true } })) {
        if (l.externalId) existing.set(l.externalId, { id: l.id, status: l.status, postedAt: l.postedAt, rankScore: l.rankScore })
      }
    }
    /** The starting rank every create computes — browseRankScore from the SOURCE date, never "now". */
    const trust = seller?.trustScore ?? 100
    const rankOf = (d: Date) => browseRankScore({ sellerTrustScore: trust, postedAt: d, featured: false }, NOW)
    const isRevivable = (status: string) => (REVIVABLE_STATUSES as readonly string[]).includes(status)
    /**
     * The DATED changes this run plans, from the rows as read: a REVIVAL brings back ONLY a row this
     * pipeline took down — 'expired' (the 7-day rule) or 'stale' (retire-stale-batdongsan.ts) — never
     * 'hidden' (a moderator's or another pipeline's decision), 'removed' or 'sold'; a RE-POST is a row whose
     * source date is at least a day newer than its postedAt (isBdsRepost — a same-week re-run's worst-case
     * dates differ by hours, and must not re-date every row). Both move postedAt to the source date and recompute rankScore
     * the create's way. Applied by src/lib/batdongsan-apply.ts (journal → guarded write → rollback → tombstone).
     */
    const planned: BdsDatedChange[] = []
    for (const r of batch) {
      const externalId = `bds:${r.code}`
      const b = existing.get(externalId)
      const d = (r._sourceDate as Date | undefined) ?? null
      if (!b || !d || b.status === 'removed') continue
      const revive = isRevivable(b.status)
      // A re-date is for LIVE rows only: a hidden (moderated) or sold row keeps its date and rank.
      if (!revive && (b.status !== 'active' || !isBdsRepost(d, b.postedAt))) continue
      planned.push({ id: b.id, externalId, sellerId: SELLER_ID, action: revive ? 'revive' : 'repost', oldStatus: b.status, oldPostedAt: b.postedAt, oldRankScore: b.rankScore, newPostedAt: d, newRankScore: rankOf(d) })
    }
    const wouldRevive = planned.filter((c) => c.action === 'revive').length
    const wouldRepost = planned.length - wouldRevive

    console.log(`source            ${src.length}`)
    console.log(`dropped           ${JSON.stringify(drop)}`)
    screen.report()
    console.log(`TO IMPORT         ${batch.length}${o.limit ? ` (--limit of ${keep.length})` : ''}`)
    console.log(`category          ${category.name}`)
    console.log(`seller            ${seller ? `${seller.name} (${seller.id})` : `(will be created as ${SELLER_ID})`}`)
    console.log(`rows on seller    ${already}`)
    if (MAX_AGE_DAYS !== null) {
      console.log(`freshness         ≤${MAX_AGE_DAYS} days worst-case at the fetch moment (labels read from ${new Date(readAtMs).toISOString()}, ${scrapeAgeHours.toFixed(1)} h ago) · ${batch.length - batchIds.filter((x) => existing.has(x)).length} new (postedAt = source date) · ${wouldRevive} ${REVIVABLE_STATUSES.join('/')} rows fresh again → re-activated · ${wouldRepost} re-posted ≥1 day after their postedAt → postedAt moves forward`)
    }
    console.log(`images            NONE — see the header; agent headshots + rival watermarks`)
    console.log(`mode              ${o.apply ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN (read-only session)'}`)
    console.log(`untranslated      ${untranslatedSummary(batch.flatMap((r) => compose(r, r.price_vnd).missing)) || 'none — every mixed-language segment has a reviewed translation'}`)

    if (!o.apply) {
      const s = batch[0]
      if (s) {
        const c = compose(s, s.price_vnd)
        console.log(`\n── sample ──\n  ${c.title}\n  ${vnd(s.price_vnd)}/mo · ${s.district} · ${SUBCAT[s.property_type] ?? '(no subcategory)'}\n  (${s.latitude}, ${s.longitude})${s._sourceDate ? `\n  source date (worst case) ${(s._sourceDate as Date).toISOString()} → rankScore ${rankOf(s._sourceDate).toFixed(4)}` : ''}\n  -> ${s.url}`)
      }
      console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    } else {
      if (seller && seller.name !== SELLER_NAME) throw new Error(`seller ${SELLER_ID} is "${seller.name}" — refusing`)
      if (seller?.ownerId) throw new Error(`seller ${SELLER_ID} is owned by ${seller.ownerId} — refusing to attach imported rows`)
      if (planned.length && !journal) throw new Error('dated changes planned without a journal dir — refusing')
      // ⛔ CHECKED BEFORE ANY WRITE: a revived page whose tombstone cannot be written keeps its cached 404 for
      // 30 days of ISR while the row shows in every feed. Same refusal as scripts/expire-apartment-rentals.ts.
      if (wouldRevive) {
        const [{ t: isrTable }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
        if (!isrTable) throw new Error(`no next_cache_tag table on this database — ${wouldRevive} revived page(s) would keep their cached 404 from ISR; refusing before any write`)
      }
      // ⛔ Live rows the content screen refused as banned are hidden only now, past the storefront refusals.
      await screen.applyHides()
      if (!seller) {
        await db.seller.create({
          data: { id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false },
        })
      }

      // ⛔ A TOMBSTONE IS LEFT AS IT IS (src/lib/listing-removed.ts): a listing a moderator or admin REMOVED keeps its externalId, so this SKU lands on it — refreshing its text, price or photos would rewrite the record kept as evidence (Law 122/2025). Not refreshed, not recreated, not re-dated.
      let created = 0, updated = 0, skippedRemoved = 0
      const leftAlone = new Set<string>()
      for (const r of batch) {
        const externalId = `bds:${r.code}`
        const before = existing.get(externalId)
        if (before?.status === 'removed') { skippedRemoved++; leftAlone.add(externalId); continue }
        const price = r.price_vnd as number
        /** The four text columns only — `missing` is a report (the `untranslated` line above), never a column. */
        const { title, titleVi, description, descriptionVi } = compose(r, price)
        const c = { title, titleVi, description, descriptionVi }
        // Bedrooms AND bathrooms, clamped at the taxonomy's open-ended top bucket (6+) — roomAttributes.
        const attributes = roomAttributes({ bedrooms: r.bedrooms, bathrooms: r.bathrooms })
        const mutable = {
          ...c,
          price, priceUnit: 'VND', currency: '₫',
          negotiable: false,
          listingType: 'rent',
          categoryId: category.id,
          subcategorySlug: SUBCAT[r.property_type] ?? null,
          sellerId: SELLER_ID,
          location: r.location ?? [r.ward, r.district].filter(Boolean).join(', '),
          district: r.district ?? null,
          city: 'Hồ Chí Minh',
          lat: r.latitude, lng: r.longitude,
          areaM2: r._area,
          attributes,
          affiliateUrl: r.url,
          searchText: buildSearchText([c.title, c.titleVi, r.location, r.district, r.property_type]),
        }
        const sourceDate = (r._sourceDate as Date | undefined) ?? null
        /**
         * The source date and the rank it implies — CREATE-ONLY like `images`; afterwards only the revival
         * and re-post writes (src/lib/batdongsan-apply.ts) move them, journaled. Only when the date is
         * trusted (--max-age-days); a plain import keeps the column defaults it always had.
         */
        const dated = sourceDate ? { postedAt: sourceDate, rankScore: rankOf(sourceDate) } : {}
        try {
          await db.listing.upsert({
            // ⛔ STATUS-GUARDED: a row a moderator REMOVED after the read above does not match, so the
            // upsert falls to its create, which collides on (sellerId, externalId) — caught below, left alone.
            where: { sellerId_externalId: { sellerId: SELLER_ID, externalId }, status: { not: 'removed' } },
            /** `verified` is the PUBLICATION GATE, not a trust badge — `feed-query` pins
             *  `verifiedFilter = true` for every public caller. Create-only so a moderator can hold a row. */
            /**
             * ⛔ `images` IS CREATE-ONLY OR A RE-IMPORT ERASES EVERY ATTACHED PHOTO. It used to sit in the
             * shared `mutable` payload, so `update: mutable` reset it to '[]' — the next price-refresh run
             * would have silently wiped all 19,152 uploads from attach-batdongsan-photos.ts and left ~1 GB
             * of orphaned objects in storage with nothing pointing at them. hide-imageless-imports would
             * then have hidden the entire import. Both reviewers caught this independently.
             * `[]` not null: serializeListingCard does `safeParse<string[]>(l.images, [])`.
             */
            create: { ...mutable, externalId, status: 'active', verified: true, images: '[]', ...dated },
            update: mutable,
            select: { id: true },
          })
        } catch (e) {
          if (!isUniqueViolation(e)) throw e
          const now = await db.listing.findUnique({ where: { sellerId_externalId: { sellerId: SELLER_ID, externalId } }, select: { status: true } })
          if (now?.status !== 'removed') throw e
          skippedRemoved++; leftAlone.add(externalId); continue
        }
        if (before) updated++; else created++
        if ((created + updated) % 500 === 0) console.log(`  ${created + updated}/${batch.length}`)
      }

      // The dated changes, in their own pass (src/lib/batdongsan-apply.ts): planned → journaled → guarded write → rollback line → tombstone.
      const todo = planned.filter((ch) => !leftAlone.has(ch.externalId))
      const stamp = new Date(NOW).toISOString().replace(/[:.]/g, '-')
      const JOURNAL = journal ? join(journal, `batdongsan-revive-repost-${stamp}.jsonl`) : null
      const ROLLBACK = journal ? join(journal, `batdongsan-revive-repost-${stamp}.rollback.sql`) : null
      if (todo.length) console.log(`journal           ${JOURNAL}\nrollback          ${ROLLBACK}`)
      /** Owed pages → a repair .sql (or, if that write fails, the SQL itself on stderr) + the exit code. */
      const reportOwed = (owed: string[]) => {
        owedTombstones = owed
        const retombstone = join(journal!, `batdongsan-revive-repost-${stamp}.retombstone.sql`)
        const sql = bdsTombstoneSql(owed) + '\n'
        try { writeFileAtomic(retombstone, sql) } catch (e) { console.error(`(could not write ${retombstone}: ${e instanceof Error ? e.message : String(e)} — the SQL follows)\n${sql}`) }
        console.error(`⛔ ${owed.length} revived page(s) have NO ISR tombstone — each keeps a cached 404 for up to 30 days. Repair: psql -v ON_ERROR_STOP=1 -f ${retombstone}   (journal: ${JOURNAL})`)
      }
      let outcome: BdsDatedOutcome
      try {
        outcome = await applyBdsDatedChanges(todo, {
          revive: async (ch) => (await db.listing.updateMany({
            where: { id: ch.id, sellerId: SELLER_ID, status: { in: [...REVIVABLE_STATUSES] } },
            data: { status: 'active', postedAt: ch.newPostedAt, rankScore: ch.newRankScore },
          })).count === 1,
          repost: async (ch) => (await db.listing.updateMany({
            where: { id: ch.id, sellerId: SELLER_ID, status: 'active', postedAt: { lt: ch.newPostedAt } },
            data: { postedAt: ch.newPostedAt, rankScore: ch.newRankScore },
          })).count === 1,
          tombstone: (ids) => tombstonePdps(db, ids),
          journal: (line) => appendDurably(JOURNAL!, line),
          rollback: (line) => appendDurably(ROLLBACK!, line),
          log: (line) => console.log(line),
        })
      } catch (e) {
        // ⛔ A THROW PART-WAY (a timeout on a later row, a full disk): the pages it had already revived and
        // could not tombstone ride on the error — the repair file is written before the error goes on.
        const owed = owedTombstonesOf(e)
        if (owed.length) reportOwed(owed)
        throw e
      }
      console.log(`ISR tombstones    ${outcome.tombstoned} revived page(s) × en/vi, each as it landed`)
      if (outcome.owed.length) reportOwed(outcome.owed)

      const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
      console.log(`\ncreated ${created}   updated ${updated}   revived ${outcome.revived.length}   re-posted (postedAt moved forward) ${outcome.reposted.length}${outcome.notMoved ? `   changed since the read (left as they are) ${outcome.notMoved}` : ''}   removed (left alone) ${skippedRemoved}   active now ${active}`)
      console.log(`\nROLLBACK (safe, reversible):\n  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${SELLER_ID}' AND status <> 'removed';`)
      if (outcome.revived.length || outcome.reposted.length) console.log(`  revivals / re-posts only: psql -v ON_ERROR_STOP=1 -f ${ROLLBACK}   (each line undoes only a row still exactly as this run left it, with its ISR tombstone)`)
      console.log(`  -- hard delete is NOT paste-safe: Order is onDelete:Restrict and six relations Cascade.`)
    }
  } catch (e) {
    // Owed tombstones already reported (repair file named above): print the failure and exit 4/5, not 1, so
    // the job names the repair. Any other throw is a plain failure.
    if (!owedTombstones.length) throw e
    console.error(e)
    threwOwing = true
  } finally {
    await db.$disconnect()
  }

  // The set, only now and only after an import that ran to its end: the rows it keeps live were created / revived above (or, dry, reported).
  let setWritten = false
  if (freshSet && !threwOwing) {
    writeFileAtomic(o.freshOut!, JSON.stringify(freshSet, null, 1) + '\n')
    setWritten = true
    console.log(`fresh set         written: ${o.freshOut} (${freshSet.items.length} items)`)
  }
  const code = bdsImportExitCode({ owed: owedTombstones.length, setAsked: !!o.freshOut, setWritten })
  if (threwOwing) console.error(`\n⛔ THE RUN THREW PART-WAY with ${owedTombstones.length} revived page(s) still owed their ISR tombstone (repair file above)${o.freshOut ? '; no set was written, so the expiry must not run this week' : ''} (exit ${code}).`)
  else if (setRefusal !== null) console.error(`\n⛔ FRESH SET REFUSED — ${setRefusal}\n   The import above ran from what was read; no set was written, so the expiry must not run this week (exit ${code}).`)
  process.exitCode = code
}
/** Run only when executed — compose() above is imported by the unit test (real paths: src/lib/cli-entry.ts). */
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
