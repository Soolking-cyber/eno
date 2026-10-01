/**
 * Nhà Tốt (nhatot.com) rentals — HCMC, Hà Nội, Đà Nẵng → eno REFERENCE LISTINGS.
 *
 * IMPORT
 *   Stage (DRY — reads the live gateway and the DB read-only, writes only the JSON file):
 *     set -a; . ./.env; set +a; npx tsx scripts/import-nhatot-com.ts [--limit 30 | --cap hcm=3000,hn=1500,dn=1500]
 *         [--city hcm,hn,dn] [--cg 1010,1020,1030,1050] [--save <staged.json>] [--max-photos 6] [--max-age-days 30]
 *         [--probe-photos]   (dry run only: fetch + judge every candidate photo of the batch, upload nothing)
 *         [--cover-by-mark]  (with --probe-photos or --apply: lead with the photo Chợ Tốt's stamp shows least — 4-bis)
 *         [--fresh-out <fresh.json>]  (the 7-day rule's FRESH SET — needs --max-age-days ≥ 7, every city, cg 1010; see 8)
 *   Write (only from a STAGED, reviewed file — never straight off the network):
 *     … scripts/import-nhatot-com.ts --src <staged.json> --journal-dir <durable dir> [--max-age-days 7] [--allow-no-isr] --apply
 *         (--allow-no-isr: ONLY on a scratch copy with no next_cache_tag table — otherwise --apply refuses)
 *
 * THE WEEKLY 7-DAY RULE (src/lib/apartment-freshness.ts, src/lib/nhatot-fresh.ts)
 *   … --cg 1010 --max-age-days 7 --save <stage.json> --fresh-out <fresh.json>       (stage: live read, DRY)
 *   … --src <stage.json> --max-age-days 7 --journal-dir <dir> --apply                  (create / update / REVIVE)
 *   npx tsx scripts/expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh <fresh.json> …
 *
 * RETIRE (hide rows whose source ad is gone — never deletes)
 *   Check (DRY): … scripts/import-nhatot-com.ts --retire [--limit N | --ids 1,2] [--save <status.json>]
 *   Write:       … scripts/import-nhatot-com.ts --retire --src <status.json> --journal-dir <durable dir> [--allow-no-isr] --apply
 *
 * Same shape as import-rever-rentals.ts / import-batdongsan-rentals.ts — the mapping itself lives in
 * src/lib/nhatot-listing.ts (pure, unit-tested). What is different here:
 *
 * ⛔ 1. STAGE, THEN WRITE (the partner-fetch pattern). A live run can only be a DRY RUN or a
 * `--save`. `--apply` refuses unless `--src` names a staged file, and refuses that file when its
 * OWN timestamp (not its mtime, which `cp`/`touch` reset) is over 72 h old OR in the future: these
 * rentals turn over in days, and publishing a stale file publishes let flats with live outbound links.
 * The field whitelist is re-applied on read, so a hand-edited file cannot smuggle a field back in.
 *
 * ⛔ 2. THE JOURNAL DIR IS CHECKED BEFORE ANYTHING ELSE. `--apply` needs `--journal-dir`, a durable
 * directory (not under /tmp, which macOS clears at boot); it is created and write-tested before the
 * staged file is read, the DB is opened or a single request is made. The upload manifest, the
 * created-row journal and the retire journal all go there, fsynced line by line.
 *
 * ⛔ 3. PERSONAL DATA IS DROPPED AT STAGING, NOT FILTERED AT WRITE. Every gateway row carries the
 * poster's real name, avatar, account ids and free text that routinely holds a phone number. The
 * staged file is a whitelist (stageNhatotAd), so it never contains them — the file is safe to keep.
 * Titles and descriptions are COMPOSED from facts; the poster's own subject/body are never used, the
 * poster-typed street is cut to a street NAME (no door or alley number), and the composed text still
 * goes through the publish-guard contact screen. The liveness pass reads the detail endpoint, which
 * adds `phone`: classifyNhatotLiveness keeps list_id + status and nothing else.
 *
 * ⛔ 4. PHOTOS ARE JUDGED, THEN RE-HOSTED AT CREATE, ALL-OR-NOTHING, AND ARE CREATE-ONLY. Every
 * candidate photo is fetched and measured BEFORE anything uploads (src/lib/import-photo-check.ts —
 * the same text-card / logo / size test muaban runs, with nhatot's size floor): a text card, a logo
 * or a thumbnail is left out so it can never be the cover, the same shot twice counts once, and a row
 * left with fewer real photos than the rentals publish floor (3 distinct) is NOT created. A fetch or
 * decode failure skips the row (the next run retries it). The kept photos are stored clean under
 * listings/affiliate/m/ via makeImageHost({ mark:'overlay' }), and the stored URLs are re-counted
 * with the publish gate's own countDistinctAngles before the row is written. `--probe-photos` runs
 * the same rule on a dry run. An EXISTING row's photos are never touched — `images` is not in the
 * update payload.
 * The photos carry Chợ Tốt's burned-in "choTOT" mark and often the uploader's own (sometimes a
 * phone number). The OWNER ACCEPTED burned-in source watermarks on 2026-09-24 (same rule as
 * Batdongsan); that covers pixels only, which is why the TEXT screen in (3) still runs.
 * ⚠️ 4-bis. --cover-by-mark (OFF by default). The stamp sits at the centre of EVERY photo, so no photo
 * is clean; with the flag, the kept photo among the first three where it shows clearly least becomes
 * the cover (src/lib/import-photo-mark.ts, which also says why it is opt-in: measured on 36 live rows,
 * no moved cover was a clearly better card by eye). The stamp's shape is learnt from eno's OWN stored
 * copies of this seller's newest rows — never a request to Chợ Tốt — and a run that cannot learn it
 * keeps the source's order and says so. The probe and --apply share nhatotPhotoPlan, so the probe
 * prints the covers --apply would pick.
 *
 * ⛔ 4b. postedAt IS THE SOURCE'S OWN POST DATE (`list_time`, clamped to now), and the starting
 * rankScore is computed from it with the same browseRankScore every create uses — never "now", which
 * ranked every imported ad as if it had been posted that second and put it above the site's own
 * listings in the default browse. Set at create, at a REVIVAL, and on an update whose list_time is
 * NEWER than the stored postedAt (the ad was re-listed) — never moved backwards. Whenever postedAt
 * moves, rankScore is recomputed the create way, and the old pair is journalled (fsync) first, with
 * a rollback .sql line, in --journal-dir. The expiry's --backstop-days reads this postedAt.
 *
 * ⛔ 5. UNCHANGED ROWS ARE NOT WRITTEN. A Prisma update bumps `updatedAt`, and sitemap.xml orders a
 * 45,000-row window by it. An existing row is updated only when a refreshable field actually differs.
 *
 * ⛔ 6. RETIRE ONLY ON A POSITIVE SIGNAL. The detail endpoint answers 404 "entity not found" for a
 * removed ad, or 200 with a non-'active' `ad.status`. Those — and only those — hide a row
 * (status 'hidden', never DELETE, never 'sold'). Absence from a run, a timeout, a 5xx, or the
 * gateway's OTHER 404 ("no Route matched" = a moved endpoint) retire nothing. Each check run also
 * probes a canary pair (one ad that is live right now, one id known to be gone) and --apply refuses
 * unless both answered as expected, or when every checked row came back gone. Each hide is journalled
 * BEFORE its write; AFTER it moved the row, a guarded rollback line (with the page's ISR tombstone) is
 * written and the page is tombstoned — a hidden ad's cached page would otherwise render for 30 days.
 *
 * ⛔ 7. POLITENESS: one request per ≥1.2 s per host, spaced from when the previous answer ARRIVED;
 * honest User-Agent; robots.txt read at RUN TIME for every host before its first request (RFC 9309:
 * a 4xx robots.txt = no rules, a 5xx or unreachable one = disallow all), plus www.nhatot.com's own
 * robots.txt as the site's policy; a 429, a Cloudflare challenge or an HTML answer STOPS the read —
 * for the gateway, the image CDN and the liveness pass alike. Nothing is ever retried into a 429.
 * A TIMEOUT or network failure is not a stop: a list page of a time-bounded read is retried once,
 * and a liveness check that times out is 'unknown' for that id (it retires nothing) — one slow
 * answer used to crash the whole --retire pass.
 *
 * ⛔ 8. THE 7-DAY RULE (owner, 2026-10-01). An imported apartment stays live only while Nhà Tốt shows it
 * listed or re-listed (`list_time`) within 7 days. Three parts here; the expiry itself is
 * scripts/expire-apartment-rentals.ts.
 *  · TIME-BOUNDED READ — ONLY ON A --fresh-out RUN (never because --max-age-days was passed: a plain dry
 *    run with --max-age-days 30 still reads every slice to its end). It reads each newest-first slice only
 *    down to the --max-age-days window (src/lib/nhatot-fresh.ts says why that is whole: overlapping pages
 *    each anchored to the pages before, a head re-read for ads re-listed DURING the read, pinned ads unable
 *    to end a slice, every page's newest-first ORDER checked — one inversion and the slice is 'unordered',
 *    never covered —, an end of results believed only when a re-request repeats it, a numeric total was
 *    seen whenever rows were, and it is not short of that total, and the per-district re-read where a
 *    region's window outruns the gateway's 10,000 cap). A 200 whose `ads` is not an array is an error
 *    (retried once), never an empty page. (The plain full read ends only THAT slice on it, and marks the
 *    read incomplete; 'stopped' is a StopRead and nothing else.)
 *  · THE STAGE'S FETCH TIME (`fetchedAt`) IS THE READ'S START, not its end — the set, the create age limit
 *    and the revival are all judged at it; an ad listed after it (+5 min skew) is `unknown` in the set.
 *  · --fresh-out: the stage run writes the FRESH SET — every cg 1010 ad dated inside 7 days at the
 *    stage's fetch time, ads eno already has and ads the mapper refuses included — only when the read
 *    PROVABLY covered the window in every city (the coverage string is that proof), and only after the
 *    set passes the expiry's own freshSetProblem. Otherwise nothing is written and the run exits 3. A
 *    previous set at that path is removed first, so a failed run can never leave last run's set behind;
 *    a --fresh-out that names the --save file is refused. Every file a later step reads (--save, the set)
 *    is written atomically: temp file, fsync, rename, fsync of the directory.
 *  · REVIVAL at --apply: an existing apartment row whose list_time is inside the window at the STAGE's
 *    fetch time and whose status is 'expired' or 'stale' (REVIVABLE_STATUSES) goes back to 'active' —
 *    never a 'hidden', 'removed' or 'sold' row. The CREATE age limit is judged at that same fetch time
 *    (mapNhatotAd ageAt), so the apply creates and revives exactly what the set calls fresh. --apply
 *    refuses before its first status write when the database has no next_cache_tag table (--allow-no-isr
 *    on a scratch copy only). Each revival: the PLAN is journalled (fsync) before the write; only after the
 *    write moved the row does its rollback line go down (guarded on status 'active' AND the postedAt it
 *    set, carrying its own ISR tombstone INSERT); then its page is tombstoned at once, and every revived
 *    page once more in a finally, so a throw mid-loop still clears the cached 404s it made stale.
 *    A refresh is an updateMany that can never touch a 'removed' row.
 *
 * EXIT CODES. Stage (--fresh-out): 0 · 3 = read and staged, but whole-window coverage NOT proven — a stop,
 * gap, inversion, unconfirmed end… — so no fresh set was written · 1 = a crash (or a refused argument);
 * (2 = a --probe-photos dry run stopped). --apply: 0 · 1 = some row failed on our side (an error, an upload,
 * an ISR tombstone) · 2 = a StopRead ended the batch early · 1 from a crash. The apply's LAST line is
 * `APPLY COMPLETED` exactly when its row loop reached the end of the batch (row errors included) — never
 * after a crash or a StopRead — so a finished apply with row errors is told apart from one that died.
 */
import 'dotenv/config'
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, mkdirSync, accessSync, statSync, realpathSync, unlinkSync, existsSync, renameSync, constants as FS } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { countDistinctAngles } from '../src/lib/image-hash-url'
import { HOST_EDGE, imageVerdict, measureImage, MIN_IMAGE_LONG_EDGE, PLACEHOLDER_ENTROPY, PLACEHOLDER_FLAT, type ImageMeasure, type PhotoOutcome } from '../src/lib/import-photo-check'
import { MARK_SEED_ROWS, fetchStoredImage, markScore, markSeedUrls, markTemplateFromUrls, type MarkTemplate } from '../src/lib/import-photo-mark'
import { formatMoneyFull } from '../src/lib/vnd'
import { untranslatedSummary } from '../src/lib/import-i18n'
// ⛔ Every importer screens a row before it writes it — banned words + advertising-banned goods.
import { ImportScreen } from '../src/lib/import-screen'
import {
  NHATOT_API, NHATOT_CATEGORIES, NHATOT_CITIES, NHATOT_DEFAULT_CATEGORIES, NHATOT_GAP_MS_DEFAULT,
  NHATOT_GAP_MS_MIN, NHATOT_LOGO_FALLBACK_URL, NHATOT_LOGO_URL, NHATOT_MIN_PHOTOS, NHATOT_PAGE_MAX,
  NHATOT_PHOTO_FLOOR, NHATOT_SELLER_ID, NHATOT_SELLER_NAME, NHATOT_TOTAL_CAP, NHATOT_UA, NHATOT_UA_TOKEN,
  classifyNhatotLiveness, isNhatotAffiliateUrl, mapNhatotAd, nhatotJournalDirProblem, nhatotListIdOf,
  nhatotPhotoPlan, nhatotRateArg, nhatotRobotsAllows, nhatotSellerRefusal, nhatotShouldRetire,
  nhatotStageAgeProblem, nhatotStartingRank, nhatotStopReason, parseNhatotCaps, readNewestAcross,
  nhatotApplyExitCode, nhatotCapsProblem, nhatotHostHalt, nhatotRunReadsNetwork, nhatotSliceEnd, sliceQuotas, stageNhatotAd, stageNhatotLiveness,
  nhatotLivenessUndetermined,
  type NhatotCityKey, type NhatotLiveness, type NhatotMapped, type NhatotPhotoPlan, type NhatotStagedAd,
} from '../src/lib/nhatot-listing'
// The 7-day rule for imported apartments (header ⛔ 8).
import { FRESH_DAYS, FRESH_SET_KIND, REVIVABLE_STATUSES } from '../src/lib/apartment-freshness'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import {
  NHATOT_APARTMENT_CG, NHATOT_WINDOW_OVERLAP, nhatotExistingRowPlan, nhatotFreshDecision, nhatotFreshOutProblem,
  nhatotRepostRollbackSql, nhatotRevivalRollbackSql, nhatotSqlLit, nhatotTombstoneSql,
  nhatotWindowCutoff, nhatotWindowRow, readNhatotWindowSlice,
  type NhatotSliceWindow, type NhatotWindowParams,
} from '../src/lib/nhatot-fresh'

const argv = process.argv.slice(2)
/** ⛔ AN UNKNOWN FLAG IS AN ERROR. `--limt 30` silently meaning "no limit" is how a sample becomes a full crawl. */
const FLAGS = new Set(['--apply', '--retire', '--no-probe', '--probe-photos', '--cover-by-mark', '--allow-no-isr'])
const VALUED = new Set(['--limit', '--max-photos', '--max-age-days', '--gap-ms', '--src', '--save', '--journal-dir', '--city', '--cg', '--cap', '--ids', '--fresh-out'])
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) continue
  if (VALUED.has(a)) {
    /** A valued flag with no value (`--limit` last) used to fall back to its default — 0 = NO limit. */
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`)
    i++; continue
  }
  if (a === '--manifest') throw new Error('--manifest was replaced by --journal-dir <durable dir> (the manifest is written inside it)')
  throw new Error(`unknown argument "${a}"`)
}
const APPLY = argv.includes('--apply')
const RETIRE = argv.includes('--retire')
const NO_PROBE = argv.includes('--no-probe')
const PROBE_PHOTOS = argv.includes('--probe-photos')
if (PROBE_PHOTOS && (APPLY || RETIRE || NO_PROBE)) throw new Error('--probe-photos is a DRY-RUN import option (it fetches every candidate photo); not with --apply, --retire or --no-probe')
/** Acts only where photos are judged (--probe-photos, --apply); refused where it would silently do nothing. */
const COVER_BY_MARK = argv.includes('--cover-by-mark')
if (COVER_BY_MARK && (RETIRE || (!PROBE_PHOTOS && !APPLY))) throw new Error('--cover-by-mark changes which photo leads when photos are judged: pass it with --probe-photos (to see the covers) or --apply, never --retire')
/** A scratch copy with no ISR tag table only — production always has one, and --apply refuses without it. */
const ALLOW_NO_ISR = argv.includes('--allow-no-isr')
if (ALLOW_NO_ISR && !APPLY) throw new Error('--allow-no-isr only means something with --apply (on a scratch copy)')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const int = (k: string, d: number) => {
  const v = Number(str(k, String(d)))
  if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`)
  return v
}
const LIMIT = int('--limit', 0)
const MAX_PHOTOS = int('--max-photos', 6)
const MAX_AGE_DAYS = int('--max-age-days', 30)
/** ⛔ Never below the floor, and a value that does not parse is the DEFAULT — never NaN = no delay. */
const GAP_RAW = str('--gap-ms')
const GAP_MS = nhatotRateArg(GAP_RAW, NHATOT_GAP_MS_DEFAULT, NHATOT_GAP_MS_MIN)
if (!Number.isFinite(GAP_MS) || GAP_MS < NHATOT_GAP_MS_MIN) throw new Error('internal: rate limit is not a finite number ≥ the floor')
/** ⛔ PATHS ARE ARGUMENTS. Nothing here hard-codes a scratch dir or a home directory. */
const SRC = str('--src')
const SAVE = str('--save')
const JOURNAL_DIR_ARG = str('--journal-dir')
const CAPS = parseNhatotCaps(str('--cap'))
const HAS_CAPS = Object.keys(CAPS).length > 0
const MAX_AGE_GIVEN = str('--max-age-days') !== null
const FRESH_OUT = str('--fresh-out')
/**
 * The time-bounded read (header ⛔ 8) is the --fresh-out run's read and nothing else — never switched on
 * by --max-age-days alone, so a plain dry run keeps the full read and its meaning of `complete`.
 * (nhatotFreshOutProblem refuses --fresh-out with --src/--limit/--cap before any request.)
 */
const TIME_BOUNDED = FRESH_OUT !== null && !SRC && !RETIRE && !LIMIT && !HAS_CAPS

const CITY_ALIASES: Record<string, NhatotCityKey> = {
  hcm: 'hcm', hcmc: 'hcm', 'ho-chi-minh': 'hcm', saigon: 'hcm',
  hn: 'hn', hanoi: 'hn', 'ha-noi': 'hn',
  dn: 'dn', danang: 'dn', 'da-nang': 'dn',
}
function parseCities(): NhatotCityKey[] {
  const raw = str('--city')
  if (!raw) return ['hcm', 'hn', 'dn']
  const out = raw.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean).map((c) => {
    const k = CITY_ALIASES[c]
    if (!k) throw new Error(`--city: unknown "${c}" (use hcm, hn, dn)`)
    return k
  })
  return [...new Set(out)]
}
function parseCategories(): number[] {
  const raw = str('--cg')
  if (!raw) return [...NHATOT_DEFAULT_CATEGORIES]
  return [...new Set(raw.split(',').map((c) => {
    const v = Number(c.trim())
    if (!NHATOT_CATEGORIES[v]) throw new Error(`--cg: unknown category "${c}" (known: ${Object.keys(NHATOT_CATEGORIES).join(', ')})`)
    return v
  }))]
}
const CITIES = parseCities()
const CGS = parseCategories()

// ─── politeness: spacing, robots.txt, stops ────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lastHit = new Map<string, number>()
const perHost = new Map<string, number>()
let requests = 0
class StopRead extends Error {}
/**
 * A 200 from the list endpoint whose `ads` is not an array. NOT a StopRead (the host did not refuse us):
 * the time-bounded read retries it once, like a timeout, and a slice it ends is never covered; the plain
 * read ends only THAT slice with it (note + incomplete read) and goes on with the others. Read as `[]` it
 * used to be indistinguishable from the end of the list.
 */
class BadListBody extends Error {}

/** Hosts that answered 429 or a challenge this run: never requested again (nhatotHostHalt). */
const halted = new Map<string, string>()
/** Serialised and spaced per host, ≥GAP_MS after the previous answer ARRIVED. */
async function spaced(url: string, accept: string, redirect: RequestRedirect): Promise<Response> {
  const host = new URL(url).host
  const why = halted.get(host)
  if (why) throw new StopRead(`${host} answered ${why} earlier this run — not requesting it again`)
  const wait = (lastHit.get(host) ?? 0) + GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastHit.set(host, Date.now())
  requests++
  perHost.set(host, (perHost.get(host) ?? 0) + 1)
  try {
    const res = await fetch(url, { headers: { 'user-agent': NHATOT_UA, accept }, redirect, signal: AbortSignal.timeout(30_000) })
    const halt = nhatotHostHalt(res.status, res.headers.get('cf-mitigated'))
    if (halt) halted.set(host, halt)
    return res
  } finally {
    lastHit.set(host, Date.now())
  }
}
const drain = async (res: Response) => { try { await res.arrayBuffer() } catch { /* already consumed or aborted */ } }

type RobotsRecord = { txt: string | null; note: string }
const robots = new Map<string, RobotsRecord>()
/** RFC 9309 for one host, read once per run BEFORE the host's first request. */
async function robotsFor(u: URL): Promise<RobotsRecord> {
  const hit = robots.get(u.host)
  if (hit) return hit
  let res: Response
  try {
    /** Redirects ARE followed here (RFC 9309 §2.3.1.2, up to five) — only for robots.txt. */
    res = await spaced(`${u.origin}/robots.txt`, 'text/plain', 'follow')
  } catch (e) {
    throw new StopRead(`robots.txt on ${u.host} unreachable (${(e as Error).message}) — RFC 9309: assume disallow-all`)
  }
  const type = res.headers.get('content-type') ?? ''
  let rec: RobotsRecord
  if (res.status === 429) { await drain(res); throw new StopRead(`robots.txt on ${u.host}: HTTP 429 — stopping`) }
  if (res.headers.get('cf-mitigated')) { await drain(res); throw new StopRead(`robots.txt on ${u.host} is behind a challenge — cannot read the rules, not crawling`) }
  if (res.status >= 500) { await drain(res); throw new StopRead(`robots.txt on ${u.host}: HTTP ${res.status} — RFC 9309: assume disallow-all`) }
  if (res.status >= 400) {
    await drain(res)
    rec = { txt: null, note: `HTTP ${res.status} — no robots.txt (RFC 9309 §2.3.1.3: no rules)` }
  } else if (/text\/html/i.test(type)) {
    await drain(res)
    throw new StopRead(`robots.txt on ${u.host} answered HTML (${type}) — cannot read the rules, not crawling`)
  } else {
    const txt = await res.text()
    rec = { txt, note: `HTTP ${res.status}, ${txt.length} bytes` }
  }
  robots.set(u.host, rec)
  return rec
}
/** Every request except robots.txt itself: robots-checked, spaced, identified, no redirect following. */
async function polite(url: string, accept: string): Promise<Response> {
  const u = new URL(url)
  const r = await robotsFor(u)
  if (r.txt !== null && !nhatotRobotsAllows(r.txt, NHATOT_UA_TOKEN, u.pathname + u.search)) {
    throw new StopRead(`robots.txt on ${u.host} disallows ${u.pathname}${u.search} for ${NHATOT_UA_TOKEN} — not fetching`)
  }
  return spaced(url, accept, 'error')
}
/**
 * The SITE's own robots.txt (www.nhatot.com) — a host this importer never requests, but it is the
 * publisher's stated policy for the ads, so a Disallow for this token (or `*`) on ad pages stops the
 * run. Unreadable is reported, not fatal: RFC 9309 governs the host being crawled, and it is not.
 */
async function sitePolicy(): Promise<string> {
  let r: RobotsRecord
  try { r = await robotsFor(new URL('https://www.nhatot.com/')) } catch (e) {
    return `unreadable (${(e as Error).message}) — www.nhatot.com is never requested`
  }
  if (r.txt === null) return r.note
  for (const p of ['/', '/134859113.htm', '/thue-can-ho-chung-cu-tp-ho-chi-minh']) {
    if (!nhatotRobotsAllows(r.txt, NHATOT_UA_TOKEN, p)) throw new StopRead(`www.nhatot.com/robots.txt disallows ${p} for ${NHATOT_UA_TOKEN} — honouring the publisher's policy for the whole source`)
  }
  const signal = /^content-signal:\s*(.+)$/im.exec(r.txt)?.[1]?.trim()
  return `allows ${NHATOT_UA_TOKEN} (no group names it; '*' allows /)${signal ? ` · Content-Signal: ${signal}` : ''}`
}

/** JSON from the gateway, with the HTTP status. A 429 / challenge / HTML answer is a StopRead. */
async function gatewayJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await polite(url, 'application/json')
  const stop = nhatotStopReason(res.status, res.headers.get('content-type'), res.headers.get('cf-mitigated'))
  if (stop) { await drain(res); throw new StopRead(stop) }
  let body: unknown = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}
async function listPage(city: NhatotCityKey, cg: number, area: number | null, o: number, limit: number) {
  const url = `${NHATOT_API}?cg=${cg}&st=u&region_v2=${NHATOT_CITIES[city].region}${area ? `&area_v2=${area}` : ''}&limit=${limit}&o=${o}`
  const { status, body } = await gatewayJson(url)
  if (status !== 200 || typeof body !== 'object' || body === null) throw new StopRead(`HTTP ${status} on the list endpoint — stopping`)
  const d = body as { total?: unknown; ads?: unknown }
  /** ⛔ The real end of a list answers `{"ads":[]}` (measured 2026-10-02); a body with no `ads` array is not it. */
  if (!Array.isArray(d.ads)) throw new BadListBody(`HTTP 200 on the list endpoint with no \`ads\` array (keys: ${Object.keys(d).slice(0, 8).join(',') || 'none'}) at o=${o}`)
  return { total: typeof d.total === 'number' ? d.total : null, ads: d.ads as unknown[] }
}

// ─── the live read ─────────────────────────────────────────────────────────────────────────────
type SliceReport = {
  city: NhatotCityKey; cg: number; area: number | null; total: number | null; read: number
  /** why this slice's read is not the whole slice (limit, cap, stop, malformed answer), or null when it is */
  note: string | null
  /** ⛔ ONLY a StopRead (429, challenge, HTML, robots) — it ends the WHOLE read. */
  stopped: boolean
  /** plain read: a malformed answer (BadListBody) ended THIS slice short — not a stop; the other slices still read */
  failed?: boolean
  /** a whole-region read hit the 10k cap after its first page — to be re-read per district */
  capped?: boolean
  /** TIME-BOUNDED reads only (header ⛔ 8): how the slice ended, and the evidence. */
  window?: NhatotSliceWindow
  /** on a capped time-bounded region slice: the districts it was re-read by (null = the list failed) */
  districts?: number[] | null
  /** on a time-bounded region slice: the area_v2 values its rows carried, and how many carried none */
  areasSeen?: number[]
  arealess?: number
}
type Staged = {
  source: string
  fetchedAt: string
  userAgent: string
  params: { cities: NhatotCityKey[]; cgs: number[]; limit: number; caps?: Partial<Record<NhatotCityKey, number>>; window?: NhatotWindowParams }
  slices: SliceReport[]
  /** true only when every slice was read to its end (or, time-bounded, to the window): no --limit/--cap, no cap left unsplit, no stop */
  complete: boolean
  ads: NhatotStagedAd[]
  /** time-bounded reads: list_ids seen on apartment pages whose row could not be staged (→ the fresh set's `unknown`) */
  unjudged?: number[]
}

/** Read one slice newest-first, at most `quota` rows (null = to its end, up to the 10k cap). */
async function readSlice(city: NhatotCityKey, cg: number, area: number | null, quota: number | null, into: Map<number, NhatotStagedAd>): Promise<SliceReport> {
  const rep: SliceReport = { city, cg, area, total: null, read: 0, note: null, stopped: false }
  const want = quota ?? Number.POSITIVE_INFINITY
  let o = 0
  try {
    while (rep.read < want) {
      const d = await listPage(city, cg, area, o, Math.min(NHATOT_PAGE_MAX, want - rep.read))
      if (rep.total === null) rep.total = d.total
      if (!d.ads.length) break
      for (const raw of d.ads) {
        const a = stageNhatotAd(raw)
        if (a) into.set(a.list_id, a)   // de-duplicates ads that shift pages while we read
      }
      rep.read += d.ads.length
      o += d.ads.length
      /** ⚠️ Stop after ONE page when an unlimited whole-region read is capped: paging 200 pages
       *  of a truncated list and then re-reading it per district would double the load for nothing. */
      if (quota === null && area === null && (rep.total ?? 0) >= NHATOT_TOTAL_CAP) { rep.capped = true; break }
      if (nhatotSliceEnd(o, rep.total)) break
    }
  } catch (e) {
    /**
     * A StopRead (the host refused us) ends the WHOLE read. A malformed body (BadListBody) is not the end of
     * the list and not a refusal: it ends only THIS slice, short — the caller marks the read incomplete and
     * reads the next slice. 'stopped' is reserved for StopRead.
     */
    if (e instanceof StopRead) { rep.note = e.message; rep.stopped = true }
    else if (e instanceof BadListBody) { rep.note = `${e.message} — this slice ends here, short (not a stop; the other slices still read)`; rep.failed = true }
    else throw e
  }
  if (!rep.note && quota !== null && rep.total !== null && rep.read < rep.total) rep.note = `--limit share ${quota}`
  /** No `total` from the gateway: read to an empty page — or to the 10,000 cap, past which the tail is unknown. */
  if (!rep.note && rep.total === null) rep.note = rep.read >= NHATOT_TOTAL_CAP ? `the gateway sent no total; stopped at ${NHATOT_TOTAL_CAP} — tail unread` : 'the gateway sent no total; read to the end of the list'
  return rep
}

/** District ids for a region, from the gateway's own region list — used only to split a capped slice.
 *  Fetched once per run (it is ~230 KB and the same for every region). */
let regionList: Record<string, { area?: Record<string, unknown> }> | null = null
async function areaIds(region: number): Promise<number[]> {
  if (!regionList) {
    const { status, body } = await gatewayJson('https://gateway.chotot.com/v1/public/web-proxy-api/loadRegions')
    if (status !== 200) throw new StopRead(`HTTP ${status} on loadRegions`)
    regionList = (body as { regionFollowId?: { entities?: { regions?: Record<string, { area?: Record<string, unknown> }> } } } | null)
      ?.regionFollowId?.entities?.regions ?? {}
  }
  return Object.keys(regionList[String(region)]?.area ?? {}).map(Number).filter((x) => Number.isSafeInteger(x) && x > 0)
}

/**
 * One list page of a TIME-BOUNDED read. A timeout, a network failure or a 200 with no `ads` array
 * (BadListBody) is retried ONCE (spaced like every request); a 429, a challenge, an HTML answer or an
 * HTTP error is a StopRead and is never retried.
 */
async function listPageRetried(city: NhatotCityKey, cg: number, area: number | null, o: number, limit: number) {
  try { return await listPage(city, cg, area, o, limit) } catch (e) {
    if (e instanceof StopRead) throw e
    console.warn(`  ! list ${city}/${cg}${area ? `/area ${area}` : ''} o=${o}: ${(e as Error).name}: ${(e as Error).message.slice(0, 120)} — retrying once`)
    return listPage(city, cg, area, o, limit)
  }
}

/**
 * One slice read down to the window (src/lib/nhatot-fresh.ts readNhatotWindowSlice — the loop and its
 * proof are there, unit-tested). Every row read is staged; later observations of an ad replace earlier
 * ones, so an ad re-listed during the read carries its newest list_time.
 */
async function readWindow(city: NhatotCityKey, cg: number, area: number | null, cutoff: number, into: Map<number, NhatotStagedAd>, unjudged: Set<number>): Promise<SliceReport> {
  const res = await readNhatotWindowSlice(async (o, limit) => {
    const d = await listPageRetried(city, cg, area, o, limit)
    return { rows: d.ads.map(nhatotWindowRow), total: d.total }
  }, { cutoff })
  const areas = new Set<number>()
  let arealess = 0
  for (const r of res.rows) {
    if (r.ad) into.set(r.ad.list_id, r.ad)
    else if (r.list_id !== null && cg === NHATOT_APARTMENT_CG) unjudged.add(r.list_id)
    if (area === null) { if (r.ad?.area_v2 != null) areas.add(r.ad.area_v2); else arealess++ }
  }
  const stopped = res.error instanceof StopRead
  const failed = res.error !== null && !stopped
  return {
    city, cg, area, total: res.total, read: res.rowsRead, stopped,
    note: `${res.outcome}${failed ? ' (failed after a retry — not a stop; the other slices still read)' : ''}: ${res.why}`,
    window: { outcome: res.outcome, covered: res.covered, pages: res.pages, headPages: res.headPages, lastOffset: res.lastOffset, why: res.why, rowsRead: res.rowsRead, inWindow: res.inWindow },
    ...(area === null ? { areasSeen: [...areas].sort((a, b) => a - b), arealess } : {}),
  }
}

/**
 * THE TIME-BOUNDED READ (header ⛔ 8): every (city × category) slice down to the window, and a region
 * whose window outruns the gateway's 10,000 cap re-read district by district. A StopRead ends the WHOLE
 * read, as in the full read; a slice that failed or did not cover its window only marks it incomplete.
 */
async function fetchWindowed(into: Map<number, NhatotStagedAd>, unjudged: Set<number>, slices: SliceReport[], cutoff: number): Promise<boolean> {
  let truncated = false
  for (const city of CITIES) {
    for (const cg of CGS) {
      const rep = await readWindow(city, cg, null, cutoff, into, unjudged)
      slices.push(rep)
      if (rep.stopped) return true
      if (rep.window!.outcome !== 'capped') { if (!rep.window!.covered) truncated = true; continue }
      let areas: number[] = []
      try { areas = await areaIds(NHATOT_CITIES[city].region) } catch (e) {
        rep.note += ` — and the district list failed (${(e as Error).message})`
        if (e instanceof StopRead) { rep.districts = null; return true }
      }
      rep.districts = areas.length ? areas : null
      if (!areas.length) { truncated = true; continue }
      rep.note += ` — re-read by its ${areas.length} districts below`
      for (const area of areas) {
        const sub = await readWindow(city, cg, area, cutoff, into, unjudged)
        slices.push(sub)
        if (sub.stopped) return true
        if (!sub.window!.covered) truncated = true
      }
    }
  }
  return truncated
}

async function fetchLive(): Promise<Staged> {
  const into = new Map<number, NhatotStagedAd>()
  const slices: SliceReport[] = []
  const readStartedAt = Date.now()
  /**
   * ⛔ THE STAGE'S FETCH TIME IS THE READ'S START, NOT ITS END (src/lib/nhatot-fresh.ts header). The fresh
   * set is judged at it, and so are --apply's create age limit and revival (stagedAt / ageAt): every ad in
   * the window at the start was on the list when the read began, so it was read; one listed after the
   * start (+5 min skew) is `unknown` in the set, never claimed. The end would claim ads listed after their
   * slice was already read. Both read paths record the start, so a replay of either judges the same way.
   */
  const fetchedAt = new Date(readStartedAt).toISOString()
  if (TIME_BOUNDED) {
    const cutoff = nhatotWindowCutoff(readStartedAt, MAX_AGE_DAYS)
    const unjudged = new Set<number>()
    const truncated = await fetchWindowed(into, unjudged, slices, cutoff)
    return {
      source: 'gateway.chotot.com/v1/public/ad-listing',
      fetchedAt,
      userAgent: NHATOT_UA,
      params: {
        cities: CITIES, cgs: CGS, limit: 0,
        window: { maxAgeDays: MAX_AGE_DAYS, readStartedAt: new Date(readStartedAt).toISOString(), cutoff: new Date(cutoff).toISOString(), overlap: NHATOT_WINDOW_OVERLAP },
      },
      slices,
      complete: !truncated,
      ads: [...into.values()],
      unjudged: [...unjudged].filter((id) => !into.has(id)).sort((a, b) => a - b),
    }
  }
  /** A slice whose read is short for a reason that is not --limit/--cap makes the whole read incomplete. */
  let truncated = false, stoppedAll = false
  const uncapped = CITIES.filter((c) => !CAPS[c])
  const pairs = uncapped.flatMap((city) => CGS.map((cg) => ({ city, cg })))
  const quotas = sliceQuotas(LIMIT, pairs.length)

  /**
   * --cap: THE NEWEST N PER CITY ACROSS ITS CATEGORIES, by a k-way merge of the newest-first lists —
   * only as many pages as the merge needs (≈ N/50 + one per category), not N from every category.
   */
  for (const city of CITIES) {
    const cap = CAPS[city]
    if (!cap || stoppedAll) continue
    const r = await readNewestAcross(CGS, cap, async (cg, o, limit) => {
      const d = await listPage(city, cg, null, o, limit)
      const ads = d.ads.map((raw) => stageNhatotAd(raw)).filter((a): a is NhatotStagedAd => a !== null)
      return { ads, total: d.total, consumed: d.ads.length }
    })
    const pickedBy = r.picked.reduce<Record<number, number>>((a, x) => { a[x.category] = (a[x.category] ?? 0) + 1; return a }, {})
    for (const [cg, st] of r.stats) {
      slices.push({ city, cg, area: null, total: st.total, read: st.read, stopped: false, note: `newest-${cap} merge: ${pickedBy[cg] ?? 0} picked from this category` })
    }
    for (const a of r.picked) into.set(a.list_id, a)
    if (r.error) {
      if (!(r.error instanceof StopRead) && !(r.error instanceof BadListBody)) throw r.error
      /** A StopRead ends the whole read; a malformed body ends only this city's merge (not a stop). */
      const stop = r.error instanceof StopRead
      slices.push({ city, cg: 0, area: null, total: null, read: 0, stopped: stop, ...(stop ? {} : { failed: true }), note: stop ? r.error.message : `${r.error.message} — this city's merge ends here, short (not a stop; the other cities still read)` })
      truncated = true
      if (stop) stoppedAll = true
    }
  }

  for (const [i, { city, cg }] of pairs.entries()) {
    if (stoppedAll) break
    const quota = quotas[i]
    if (quota === 0) continue   // --limit smaller than the slice count: nothing for this one
    const rep = await readSlice(city, cg, null, quota, into)
    slices.push(rep)
    if (rep.stopped) { truncated = true; break }   // a 429 / challenge ends the WHOLE read
    if (rep.failed) truncated = true               // a malformed answer ends only this slice
    if (rep.total === null && rep.read >= NHATOT_TOTAL_CAP) truncated = true
    /**
     * ⚠️ THE GATEWAY CAPS `total` AT 10,000 (HCMC apartments hit it). A full read of a capped slice
     * silently misses the tail, so it is re-read district by district instead.
     */
    if (rep.capped) {
      rep.note = `capped at ${NHATOT_TOTAL_CAP} — re-read per district below`
      let areas: number[] = []
      try { areas = await areaIds(NHATOT_CITIES[city].region) } catch (e) {
        if (!(e instanceof StopRead)) throw e
        rep.note = `capped, and the district list failed (${e.message}) — tail unread`
      }
      if (!areas.length) { truncated = true; continue }
      for (const area of areas) {
        const sub = await readSlice(city, cg, area, null, into)
        slices.push(sub)
        if (sub.stopped) { truncated = true; break }
        if (sub.failed) truncated = true
        if (sub.total === null && sub.read >= NHATOT_TOTAL_CAP) truncated = true
        if ((sub.total ?? 0) >= NHATOT_TOTAL_CAP) { sub.note = 'district slice still capped — tail unread'; truncated = true }
      }
      if (truncated && slices[slices.length - 1].stopped) break
    }
  }
  return {
    source: 'gateway.chotot.com/v1/public/ad-listing',
    fetchedAt,
    userAgent: NHATOT_UA,
    params: { cities: CITIES, cgs: CGS, limit: LIMIT, ...(HAS_CAPS ? { caps: CAPS } : {}) },
    slices,
    complete: !LIMIT && !HAS_CAPS && !truncated,
    ads: [...into.values()],
  }
}

function readStaged(path: string): Staged {
  const s = JSON.parse(readFileSync(path, 'utf8')) as Staged
  if (!s || typeof s.fetchedAt !== 'string' || !Array.isArray(s.ads)) throw new Error(`${path} is not a staged nhatot file`)
  /** Re-run the whitelist on read: a hand-edited file must not smuggle a field back in. */
  const ads = s.ads.map((a) => stageNhatotAd(a)).filter((a): a is NhatotStagedAd => a !== null)
  return {
    ...s,
    params: s.params ?? { cities: [], cgs: [], limit: 0 },
    slices: Array.isArray(s.slices) ? s.slices : [],
    complete: s.complete === true,
    ads,
  }
}

// ─── journal ───────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ CALLED FIRST in every --apply path: before the staged file is read, the DB opened, or a
 * request made. Creates the dir, proves it is a writable directory, and refuses a temp root.
 */
function prepareJournalDir(): string {
  const roots = ['/tmp', '/private/tmp', tmpdir()].flatMap((p) => { try { return [p, realpathSync(p)] } catch { return [p] } })
  const abs = JOURNAL_DIR_ARG ? resolve(JOURNAL_DIR_ARG) : null
  const early = nhatotJournalDirProblem(abs, roots)
  if (early) throw new Error(early)
  mkdirSync(abs!, { recursive: true })
  const real = realpathSync(abs!)
  const late = nhatotJournalDirProblem(real, roots)   // a symlink into /tmp is still /tmp
  if (late) throw new Error(late)
  if (!statSync(real).isDirectory()) throw new Error(`--journal-dir ${real} is not a directory`)
  accessSync(real, FS.W_OK)
  const probe = join(real, `.nhatot-write-test-${process.pid}`)
  recordDurably(probe, 'ok')
  unlinkSync(probe)
  return real
}
/** Append + fsync the APPEND handle before moving on, so a kill cannot lose the record — and, the first
 *  time a journal file appears, fsync its directory too, or a crash can lose the file's entry itself. */
function recordDurably(file: string, line: string) {
  const isNew = !existsSync(file)
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  if (isNew) fsyncDir(dirname(resolve(file)))
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

// ─── ISR tombstones (a page whose row this run publishes or hides) ─────────────────────────────
type Db = ReturnType<typeof openDb>
/** The tag table the PDP's ISR cache reads tombstones from (src/lib/pdp-tombstone.ts). */
async function isrTagTablePresent(db: Db): Promise<boolean> {
  const [{ t }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
  return !!t
}
/** tombstonePdps that reports instead of throwing — a failed tombstone must not abandon the row loop. */
async function tombstoneNow(db: Db, ids: readonly string[]): Promise<boolean> {
  try { await tombstonePdps(db, ids); return true } catch (e) {
    console.warn(`  ! ISR tombstone for ${ids.length === 1 ? ids[0] : `${ids.length} pages`} failed: ${(e as Error).message.slice(0, 160)}`)
    return false
  }
}

// ─── the fresh set (header ⛔ 8) ───────────────────────────────────────────────────────────────
/**
 * Called BEFORE any request: this run's set or none. A previous Nhà Tốt fresh set at the path is removed
 * (a run that then fails must not leave last run's set for the expiry to act on); any OTHER file there is
 * refused, never overwritten.
 */
function clearPreviousFreshSet(path: string) {
  if (!existsSync(path)) return
  let raw: unknown = null
  try { raw = JSON.parse(readFileSync(path, 'utf8')) } catch { raw = null }
  const r = raw as { kind?: unknown; sellerId?: unknown } | null
  if (!r || r.kind !== FRESH_SET_KIND || r.sellerId !== NHATOT_SELLER_ID) throw new Error(`--fresh-out ${path} exists and is not a Nhà Tốt fresh set — refusing to overwrite it`)
  unlinkSync(path)
  fsyncDir(dirname(resolve(path)))   // the removal must survive a crash too
}
/** A directory entry (a rename, an unlink) is durable only once the DIRECTORY is fsync'd. */
function fsyncDir(dir: string) {
  const dfd = openSync(dir, 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}
/** Write, fsync, rename, fsync the directory: a reader sees the old file or the whole new one, never half — even across a crash. */
function writeFileAtomic(path: string, body: string) {
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, path)
  fsyncDir(dirname(resolve(path)))
}
/** The file a path names, symlinks and `..` resolved — through its parent when the file does not exist yet. */
function canonicalPath(path: string): string {
  const abs = resolve(path)
  try { return realpathSync(abs) } catch { /* not there yet */ }
  try { return join(realpathSync(dirname(abs)), basename(abs)) } catch { return abs }
}
/**
 * The stage run's fresh set: written only when nhatotFreshDecision proves the window covered AND the set
 * passes the expiry's own freshSetProblem. Otherwise nothing is written and the run exits 3.
 */
function writeFreshOut(path: string, staged: Staged) {
  const d = nhatotFreshDecision(staged, Date.now())
  if (!d.ok) {
    console.error(`⛔ FRESH SET NOT WRITTEN (${path}): ${d.why}`)
    process.exitCode = 3
    return
  }
  writeFileAtomic(path, JSON.stringify(d.set, null, 1) + '\n')
  console.log(`fresh set         ${path} — ${d.set.items.length} apartment ads listed within ${FRESH_DAYS} d of ${d.set.fetchedAt}, ${d.set.unknown?.length ?? 0} undetermined${d.skipped ? `, ${d.skipped} ids of an unexpected shape left out` : ''}`)
  console.log(`  coverage        ${d.set.coverage}`)
}

/** One source photo, fetched and measured. Never uploads. A 429/challenge THROWS StopRead (ends the run). */
/** `why`: what a fetch failure was, for the probe's report (a 404 is the source's photo gone, not a blip). */
type Judged = { outcome: PhotoOutcome; body: Buffer | null; m: ImageMeasure | null; why?: string }
async function judgePhoto(src: string): Promise<Judged> {
  const failed = (why: string): Judged => ({ outcome: 'fetchFailed', body: null, m: null, why })
  let res: Response
  try { res = await polite(src, 'image/*') } catch (e) {
    if (e instanceof StopRead) throw e
    return failed((e as Error).name === 'TimeoutError' ? 'timeout' : 'network/redirect')   // this row only
  }
  /** ⛔ A 429 or a wall on the image CDN ends the RUN, not just this row — carrying on to the next
   *  row is retrying into the 429 under another URL. */
  const stop = nhatotStopReason(res.status, res.headers.get('content-type'), res.headers.get('cf-mitigated'))
  if (stop) { await drain(res); throw new StopRead(`cdn: ${stop}`) }
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) { await drain(res); return failed(`HTTP ${res.status} ${res.headers.get('content-type') ?? ''}`.trim()) }
  let buf: Buffer
  try { buf = Buffer.from(await res.arrayBuffer()) } catch { return failed('body read failed') }
  /** ⚠️ An empty body passes `res.ok`; say why here rather than as a decode failure. */
  if (!buf.length) return failed('empty body')
  const m = await measureImage(buf, { markWindow: COVER_BY_MARK })
  return { outcome: imageVerdict(m, NHATOT_PHOTO_FLOOR), body: buf, m }
}
/**
 * Every candidate photo of one row, judged in source order, and the ONE plan (nhatotPhotoPlan) that
 * both the dry-run probe and --apply act on. Stops at the first fetch/decode failure: the row is
 * skipped anyway, so the rest would be requests for nothing.
 */
async function judgeRow(row: NhatotMapped, mark: MarkTemplate | null): Promise<{ judged: Judged[]; marks: (number | null)[]; plan: NhatotPhotoPlan }> {
  const judged: Judged[] = []
  for (const src of row.images) {
    const j = await judgePhoto(src)
    judged.push(j)
    if (j.outcome === 'fetchFailed' || j.outcome === 'undecodable') break
  }
  /** null everywhere unless --cover-by-mark learnt the stamp — nhatotPhotoPlan then keeps the source order. */
  const marks = judged.map((j) => (mark ? markScore(j.m?.markWindow, mark) : null))
  return { judged, marks, plan: nhatotPhotoPlan(judged.map((j, i) => ({ outcome: j.outcome, hash: j.m?.hash ?? null, mark: marks[i] }))) }
}

/**
 * --cover-by-mark: Chợ Tốt's stamp, learnt from eno's OWN stored copies (listings/affiliate/m/) of this
 * seller's newest rows — a GET to our storage, never a request to Chợ Tốt. null = the source's order.
 */
async function learnMark(db: ReturnType<typeof openDb>): Promise<MarkTemplate | null> {
  const rows = await db.listing.findMany({
    where: { sellerId: NHATOT_SELLER_ID, status: 'active' }, orderBy: { createdAt: 'desc' }, take: MARK_SEED_ROWS, select: { images: true },
  })
  const got = await markTemplateFromUrls(markSeedUrls(rows.map((r) => r.images), isOverlayImageUrl), fetchStoredImage, HOST_EDGE)
  console.log(got.template
    ? `cover by mark     ON — stamp learnt from ${got.fetched} stored photos of ${rows.length} rows (${got.template.strokes} px, ${got.template.strokeWidth} px wide, snr ${got.snr.toFixed(1)})`
    : `cover by mark     OFF for this run — ${got.why} (${got.fetched} stored photos read, ${got.failed} failed${got.snr !== null ? `, snr ${got.snr.toFixed(1)}` : ''}); covers keep the source order`)
  return got.template
}

const slugOf = (r: NhatotMapped) => r.externalId.replace(/[^a-z0-9]/gi, '-')

/**
 * --probe-photos: the dry run's view of the photo rule. Every candidate photo of every row this run
 * would CREATE is fetched and judged by judgeRow — the function --apply calls — and nothing is
 * uploaded. Each row's verdicts are printed with their measures so the thresholds stay reviewable.
 */
async function probePhotos(rows: NhatotMapped[], mark: MarkTemplate | null) {
  const decisions: Record<string, number> = {}
  const verdicts: Record<string, number> = {}
  const measured: { v: PhotoOutcome; short: number; long: number; e: number; f: number }[] = []
  const lines: string[] = []
  let stopped: string | null = null, duplicates = 0, judgedRows = 0, covers = 0
  for (const r of rows) {
    let got: Awaited<ReturnType<typeof judgeRow>>
    try { got = await judgeRow(r, mark) } catch (e) {
      if (!(e instanceof StopRead)) throw e
      stopped = e.message; break
    }
    judgedRows++
    decisions[got.plan.decision] = (decisions[got.plan.decision] ?? 0) + 1
    duplicates += got.plan.duplicates
    const cells = got.judged.map((j, i) => {
      verdicts[j.outcome] = (verdicts[j.outcome] ?? 0) + 1
      const m = j.m
      if (m?.width && m.height && m.entropy !== undefined && m.flat !== undefined) {
        measured.push({ v: j.outcome, short: Math.min(m.width, m.height), long: Math.max(m.width, m.height), e: m.entropy, f: m.flat })
        return `${j.outcome}(${m.width}x${m.height} e${m.entropy.toFixed(1)} f${m.flat.toFixed(2)}${got.marks[i] !== null ? ` m${got.marks[i]!.toFixed(1)}` : ''})`
      }
      return j.why ? `${j.outcome}(${j.why})` : j.outcome
    })
    const cover = got.plan.cover
    if (cover && got.plan.decision === 'create') covers++
    lines.push(`  ${r.externalId.padEnd(18)} ${cells.join(' ')}  → ${got.plan.decision} (keep ${got.plan.keep.length}${got.plan.duplicates ? `, ${got.plan.duplicates} duplicate` : ''}${cover ? `, cover = photo ${cover.from + 1}: stamp ${cover.was.toFixed(1)} → ${cover.now.toFixed(1)}` : ''})`)
  }
  const range = (xs: number[], d = 1) => xs.length ? `${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)}` : '-'
  const of = (v: PhotoOutcome) => measured.filter((x) => x.v === v)
  console.log(`\n── photo probe: every candidate photo of ${judgedRows}/${rows.length} rows this run would create, fetched and judged, 0 uploaded ──`)
  console.log(`rule              imageVerdict(floor short ≥${NHATOT_PHOTO_FLOOR.minShortEdge} px, long ≥${NHATOT_PHOTO_FLOOR.minLongEdge ?? MIN_IMAGE_LONG_EDGE} px; placeholder = entropy < ${PLACEHOLDER_ENTROPY} or flat ≥ ${PLACEHOLDER_FLAT}) → nhatotPhotoPlan (≥${NHATOT_MIN_PHOTOS} real, distinct)`)
  for (const l of lines) console.log(l)
  console.log(`row decisions     ${JSON.stringify(decisions)}   (only 'create' rows would be written)`)
  console.log(`photo verdicts    ${JSON.stringify(verdicts)}   near-duplicates dropped ${duplicates}`)
  if (mark) console.log(`cover by mark     ${covers} of ${decisions.create ?? 0} created rows would lead with a different photo (m = how much Chợ Tốt's stamp shows)`)
  for (const v of ['ok', 'placeholder', 'tooSmall'] as const) {
    const xs = of(v)
    if (xs.length) console.log(`  ${v.padEnd(12)}    ${String(xs.length).padStart(4)} · short edge ${range(xs.map((x) => x.short), 0)} px · long ${range(xs.map((x) => x.long), 0)} px · entropy ${range(xs.map((x) => x.e))} · flat ${range(xs.map((x) => x.f), 2)}`)
  }
  console.log(`requests          ${requests} total (${[...perHost].map(([h, n]) => `${h} ${n}`).join(', ')})`)
  if (stopped) { console.log(`⛔ PROBE STOPPED: ${stopped}`); process.exitCode = 2 }
}

const MUTABLE_KEYS = [
  'title', 'titleVi', 'description', 'descriptionVi', 'price', 'priceUnit', 'currency', 'negotiable',
  'listingType', 'categoryId', 'subcategorySlug', 'sellerId', 'location', 'district', 'city', 'lat', 'lng',
  'areaM2', 'attributes', 'affiliateUrl', 'searchText',
] as const

/** The set-partner-avatar.ts visibility measure, run locally on the logo so the dry run can say
 *  whether that script will accept it. No upload, no DB. */
async function probeLogo(url: string): Promise<string> {
  try {
    const res = await polite(url, 'image/*')
    const stop = nhatotStopReason(res.status, res.headers.get('content-type'), res.headers.get('cf-mitigated'))
    if (stop) { await drain(res); return stop }
    if (!res.ok) { await drain(res); return `HTTP ${res.status}` }
    const sharp = (await import('sharp')).default
    const src = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(src).metadata()
    const out = await sharp(src).resize(512, 512, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).webp({ quality: 92 }).toBuffer()
    const { data } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true })
    let visible = 0
    for (const px of data) if (px < 245) visible++
    const pct = (visible / data.length) * 100
    return `HTTP 200 ${meta.width}x${meta.height} ${meta.format} · ${pct.toFixed(1)}% visible on the padded 512² square → set-partner-avatar ${pct < 8 ? 'would REFUSE (<8%)' : 'would accept'}`
  } catch (e) {
    return `probe failed: ${(e as Error).message}`
  }
}
async function probeImage(url: string): Promise<string> {
  try {
    const res = await polite(url, 'image/*')
    const stop = nhatotStopReason(res.status, res.headers.get('content-type'), res.headers.get('cf-mitigated'))
    if (stop) { await drain(res); return stop }
    if (!res.ok) { await drain(res); return `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    const meta = await (await import('sharp')).default(buf).metadata()
    return `HTTP 200 ${res.headers.get('content-type')} ${buf.length} bytes, decodes ${meta.width}x${meta.height}`
  } catch (e) {
    return `probe failed: ${(e as Error).message}`
  }
}

function openDb(write: boolean) {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ./.env; set +a` first')
  /** ⛔ A DRY RUN IS READ-ONLY AT THE DATABASE, not just by intent: every transaction it opens is
   *  read-only, so a bug that reaches a write path fails instead of writing. */
  return new PrismaClient({
    adapter: new PrismaPg(write ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }),
    log: ['warn', 'error'],
  })
}
const SELLER_SELECT = { id: true, name: true, ownerId: true, trustScore: true, avatarUrl: true, verified: true, verifiedSeller: true, officialPartner: true } as const

// ─── import ────────────────────────────────────────────────────────────────────────────────────
async function importMain() {
  if (APPLY && !SRC) throw new Error('--apply needs --src <staged.json>: fetch with --save, review it, then import from the file')
  if (SRC && SAVE) throw new Error('--save is for a live read; --src already is a staged file')
  if (SRC && HAS_CAPS) throw new Error('--cap shapes a LIVE read; a staged file already carries its caps (narrow it with --city/--cg)')
  if (LIMIT && HAS_CAPS) throw new Error('--limit and --cap are two different samples — pass one')
  const capsProblem = nhatotCapsProblem(CITIES, CAPS)
  if (capsProblem) throw new Error(capsProblem)
  /** ⛔ --fresh-out speaks for the whole seller: refused before any request unless this read can cover it. */
  const freshOutProblem = FRESH_OUT === null ? null : nhatotFreshOutProblem({
    src: !!SRC, apply: APPLY, retire: false, limit: LIMIT, caps: HAS_CAPS,
    maxAgeDaysGiven: MAX_AGE_GIVEN, maxAgeDays: MAX_AGE_DAYS, cities: CITIES, cgs: CGS,
    freshOut: canonicalPath(FRESH_OUT), save: SAVE === null ? null : canonicalPath(SAVE),
  })
  if (freshOutProblem) throw new Error(freshOutProblem)
  if (FRESH_OUT !== null) clearPreviousFreshSet(FRESH_OUT)
  /** ⛔ FIRST, before the file, the DB or the network. */
  const journal = APPLY ? prepareJournalDir() : null

  let policy = '(not read — replaying a staged file offline)'
  if (nhatotRunReadsNetwork({ src: !!SRC, apply: APPLY, probePhotos: PROBE_PHOTOS })) policy = await sitePolicy()
  const staged = SRC ? readStaged(SRC) : await fetchLive()
  const ageH = (Date.now() - Date.parse(staged.fetchedAt)) / 3_600_000
  /** ⛔ A STALE (or future-dated) FILE REFUSES THE WRITE, IT DOES NOT WARN. */
  const ageProblem = nhatotStageAgeProblem(staged.fetchedAt, Date.now())
  if (APPLY && ageProblem) throw new Error(ageProblem)
  /** Atomic: the --apply step reads this file, and a torn one must never be what it finds. */
  if (SAVE) writeFileAtomic(SAVE, JSON.stringify(staged, null, 1))
  /** Written from THIS read, in memory, right after it — before the database is opened. */
  if (FRESH_OUT !== null) writeFreshOut(FRESH_OUT, staged)
  /** The 7-day rule's window is judged at the STAGE's fetch time — the set's fetchedAt, the read's START
   *  (fetchLive) — for the age limit at create (mapNhatotAd ageAt) and for a revival alike, so --apply acts on
   *  exactly what the set calls fresh. */
  const stagedAt = Date.parse(staged.fetchedAt)

  const now = Date.now()
  const drop: Record<string, number> = {}
  const keep: NhatotMapped[] = []
  // The database is opened BEFORE the screen, which looks up a refused row's existing listing (a live
  // banned row is hidden on --apply; a live ambiguous one is refreshed and listed for review).
  const db = openDb(APPLY)
  const screen = new ImportScreen('nhatot-com', { db, sellerIds: [NHATOT_SELLER_ID] })
  /** --city / --cg also narrow a STAGED file, so a replay imports exactly the scope asked for. */
  const regions = new Set<number>(CITIES.map((c) => NHATOT_CITIES[c].region))
  for (const ad of staged.ads) {
    if (ad.region_v2 === null || !regions.has(ad.region_v2) || !CGS.includes(ad.category)) {
      drop.outOfScope = (drop.outOfScope ?? 0) + 1; continue
    }
    const m = mapNhatotAd(ad, { now, ageAt: stagedAt, maxAgeDays: MAX_AGE_DAYS, maxPhotos: MAX_PHOTOS })
    if (!m.ok) { drop[m.reason] = (drop[m.reason] ?? 0) + 1; continue }
    /** Belt and braces: the URL is built from a number, but it becomes a live link. */
    if (!isNhatotAffiliateUrl(m.row.mutable.affiliateUrl)) { drop.badTarget = (drop.badTarget ?? 0) + 1; continue }
    // ⛔ CONTENT SCREEN BEFORE ANY WRITE (src/lib/import-screen.ts) — mapNhatotAd already ran the full
    // assertCleanTexts (contact info included); this adds the advertising-banned classifier.
    const t = m.row.mutable
    if (!(await screen.check({ title: t.title, titleVi: t.titleVi, description: t.description, descriptionVi: t.descriptionVi, category: 'rentals', subcategory: t.subcategorySlug, extraTexts: [t.location, t.district], externalId: m.row.externalId, url: t.affiliateUrl }))) {
      drop.contentScreen = (drop.contentScreen ?? 0) + 1; continue
    }
    keep.push(m.row)
  }
  const batch = LIMIT ? keep.slice(0, LIMIT) : keep

  const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
  if (!category) throw new Error('no `rentals` category — cannot place these rows')
  const seller = await db.seller.findUnique({ where: { id: NHATOT_SELLER_ID }, select: SELLER_SELECT })
  const refusal = nhatotSellerRefusal(seller)
  const already = await db.listing.count({ where: { sellerId: NHATOT_SELLER_ID } })
  /** Every existing row of the batch, WHATEVER its status — the status says what --apply may do to it. */
  const existing = new Map<string, { status: string; postedAt: Date }>()
  for (let i = 0; i < batch.length; i += 1000) {
    const ids = batch.slice(i, i + 1000).map((r) => r.externalId)
    for (const r of await db.listing.findMany({ where: { sellerId: NHATOT_SELLER_ID, externalId: { in: ids } }, select: { externalId: true, status: true, postedAt: true } })) {
      if (r.externalId) existing.set(r.externalId, { status: r.status, postedAt: r.postedAt })
    }
  }
  /** What the 7-day rule would do at --apply: revivals, and postedAt moved forward on re-listed ads. */
  const datePlans = { revive: 0, repost: 0 }
  for (const r of batch) {
    const cur = existing.get(r.externalId)
    if (!cur || cur.status === 'removed') continue
    const p = nhatotExistingRowPlan(cur, { postedAt: r.postedAt, subcategorySlug: r.mutable.subcategorySlug }, stagedAt)
    if (p.revive) datePlans.revive++
    else if (p.postedAt) datePlans.repost++
  }
  /** Same-name storefronts: not a blocker for this script (it pins by id), but set-partner-avatar
   *  resolves by NAME and refuses on ambiguity, so say so now rather than after the import. */
  const sameName = await db.seller.count({ where: { name: NHATOT_SELLER_NAME, NOT: { id: NHATOT_SELLER_ID } } })

  const hist = (f: (r: NhatotMapped) => string) => batch.reduce<Record<string, number>>((a, r) => { const k = f(r); a[k] = (a[k] ?? 0) + 1; return a }, {})
  const photos = batch.reduce((a, r) => a + r.images.length, 0)
  const newRows = batch.filter((r) => !existing.has(r.externalId))
  const newPhotos = newRows.reduce((a, r) => a + r.images.length, 0)

  console.log(`source            ${SRC ? `staged ${SRC}` : `live ${staged.source}`}  fetched ${staged.fetchedAt} (${ageH.toFixed(1)} h ago)${ageProblem ? `  ⚠ --apply would REFUSE: ${ageProblem}` : ''}`)
  const caps = staged.params.caps && Object.keys(staged.params.caps).length ? ` · --cap ${Object.entries(staged.params.caps).map(([k, v]) => `${k}=${v}`).join(',')}` : ''
  console.log(`scope             cities ${staged.params.cities.join(',')} · cg ${staged.params.cgs.join(',')}${staged.params.limit ? ` · --limit ${staged.params.limit}` : ''}${caps}`)
  for (const s of staged.slices) {
    console.log(`  slice ${s.city}/${s.cg}${s.area ? `/area ${s.area}` : ''}`.padEnd(30) + `read ${s.read} of ${s.total ?? '?'}${s.note ? `  (${s.note})` : ''}`)
  }
  console.log(`complete read     ${staged.complete ? 'yes' : 'NO (limited, capped, stopped, or a slice ended short) — fine for import; retirement never depends on it'}`)
  if (!SRC) {
    console.log(`robots.txt        ${[...robots].map(([h, r]) => `${h}: ${r.note}`).join(' · ')}`)
    console.log(`site policy       www.nhatot.com: ${policy}`)
    console.log(`requests          ${requests} (${[...perHost].map(([h, n]) => `${h} ${n}`).join(', ')}), ≥${GAP_MS} ms apart per host, UA "${NHATOT_UA}"${GAP_RAW !== null && !Number.isFinite(Number(GAP_RAW)) ? `  (⚠ --gap-ms "${GAP_RAW}" did not parse → default)` : ''}`)
  }
  console.log(`staged ads        ${staged.ads.length} unique (personal fields stripped; a street is kept only as a bare street NAME)${SAVE ? ` → saved ${SAVE}` : ''}`)
  console.log(`dropped           ${JSON.stringify(drop)}`)
  screen.report()
  console.log(`TO IMPORT         ${batch.length}  (would create ${newRows.length}, refresh ${batch.length - newRows.length})`)
  console.log(`7-day rule        would REVIVE ${datePlans.revive} apartment row(s) (expired/stale, listed within ${FRESH_DAYS} d of the stage's fetch) · move postedAt forward on ${datePlans.repost} re-listed row(s)`)
  console.log(`  by city         ${JSON.stringify(hist((r) => r.mutable.city))}`)
  console.log(`  by district     ${JSON.stringify(hist((r) => r.mutable.district ?? '(none)'))}`)
  console.log(`  by subcategory  ${JSON.stringify(hist((r) => r.mutable.subcategorySlug ?? '(none)'))}`)
  console.log(`  price unit      ${JSON.stringify(hist((r) => r.mutable.priceUnit))}`)
  console.log(`  with bedrooms   ${batch.filter((r) => r.mutable.attributes).length}   with area ${batch.filter((r) => r.mutable.areaM2 !== null).length}   with coords ${batch.filter((r) => r.mutable.lat !== null).length}   with a Street fact ${batch.filter((r) => /^Street: /m.test(r.mutable.description)).length}`)
  console.log(`  untranslated    ${untranslatedSummary(batch.flatMap((r) => r.untranslated)) || 'none — every mixed-language segment has a reviewed translation'}`)
  console.log(`photos            ${photos} candidate photos (${NHATOT_MIN_PHOTOS}–${Math.max(NHATOT_MIN_PHOTOS, MAX_PHOTOS)}/listing); ${newPhotos} for new rows — each judged at --apply (real photo, size floor, ≥${NHATOT_MIN_PHOTOS} distinct or the row is not created), the kept ones re-hosted → listings/affiliate/m/ (overlay mark; source watermarks accepted by the owner)${PROBE_PHOTOS ? '' : '  · --probe-photos runs that judgement now'}`)
  console.log(`category          ${category.name} (${category.id})`)
  console.log(`seller            ${seller
    ? `${seller.name} (${seller.id}) owner=${seller.ownerId ?? 'none'} badges=${[seller.verified, seller.verifiedSeller, seller.officialPartner].join('/')}`
    : `(will be created) { id: '${NHATOT_SELLER_ID}', name: '${NHATOT_SELLER_NAME}', verified:false, verifiedSeller:false, officialPartner:false, owner: none }`}`)
  if (refusal) console.log(`  ⛔ --apply would REFUSE: ${refusal}`)
  console.log(`seller logo       ${seller?.avatarUrl ?? `(none yet) ${NHATOT_LOGO_URL}`}`)
  console.log(`                  fallback ${NHATOT_LOGO_FALLBACK_URL} — set by set-partner-avatar.ts AFTER the import, never --official`)
  console.log(`same-name sellers ${sameName}${sameName ? ' — set-partner-avatar resolves by name and will refuse' : ''}`)
  console.log(`rows on seller    ${already}`)
  console.log(`retire pass       separate: --retire (liveness via the detail endpoint; hides only on 404-entity-not-found or a non-active status)`)
  console.log(`mode              ${APPLY ? `APPLY — UPLOADS + WRITES TO PRODUCTION (journal ${journal})` : 'DRY RUN (DB session read-only)'}`)

  /** The seller's trust as `create` will see it: the stored score, or the schema default (100) for a
   *  seller this run creates. The rank itself comes from each row's OWN source date. */
  const trust = seller?.trustScore ?? 100
  /** ONE rank rule for a create, a revival and a re-list: browseRankScore from the SOURCE date, never now. */
  const rankAt = (postedAt: Date) => nhatotStartingRank(postedAt, trust, Date.now())
  const rankOf = (r: NhatotMapped) => rankAt(r.postedAt)
  if (batch.length) {
    const ranks = batch.map(rankOf).sort((a, b) => a - b)
    const ages = batch.map((r) => (now - r.postedAt.getTime()) / 3_600_000).sort((a, b) => a - b)
    const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
    console.log(`rank at create    from each ad's own list_time (clamped to now), trust ${trust}: rankScore min ${ranks[0].toFixed(4)} · median ${q(ranks, 0.5).toFixed(4)} · max ${ranks[ranks.length - 1].toFixed(4)} · source age min ${ages[0].toFixed(1)} h · median ${q(ages, 0.5).toFixed(1)} h · max ${ages[ages.length - 1].toFixed(1)} h`)
  }

  if (!APPLY) {
    const s = batch[0]
    if (s) {
      /** The row EXACTLY as `create` would store it — the sample is how the per-m² bug was caught. */
      const asStored = {
        ...s.mutable, categoryId: category.id, sellerId: NHATOT_SELLER_ID, externalId: s.externalId,
        status: 'active', verified: true, postedAt: s.postedAt.toISOString(), rankScore: rankOf(s),
        images: `<up to ${s.images.length} photos (≥${NHATOT_MIN_PHOTOS} real + distinct required), re-hosted at --apply from: ${s.images[0]} …>`,
      }
      console.log(`\n── sample row (as create would store it) ──\n${JSON.stringify(asStored, null, 2)}`)
      if (!NO_PROBE && !SRC) {
        console.log(`\n── probes (read-only, 1 request each) ──`)
        console.log(`  sample cover   ${await probeImage(s.images[0])}`)
        console.log(`  seller logo    ${await probeLogo(NHATOT_LOGO_URL)}`)
        console.log(`  logo fallback  ${await probeLogo(NHATOT_LOGO_FALLBACK_URL)}`)
        console.log(`  robots.txt     ${[...robots].filter(([h]) => /chotot/.test(h)).map(([h, r]) => `${h}: ${r.note}`).join(' · ')}`)
      }
      console.log(`\n── more rows ──`)
      for (const r of batch.slice(1, 8)) {
        console.log(`  ${r.externalId.padEnd(18)} ${formatMoneyFull(r.mutable.price, '₫', 'vi').padStart(14)}/tháng · ${r.mutable.subcategorySlug ?? '-'} · ${r.mutable.city} · ${r.mutable.location} · ${r.mutable.title}`)
      }
    }
    if (PROBE_PHOTOS && batch.length) await probePhotos(newRows, COVER_BY_MARK ? await learnMark(db) : null)
    console.log('\nDRY RUN — nothing written, nothing uploaded. Stage with --save, review, then --src <file> --journal-dir <durable dir> --apply.')
    await db.$disconnect(); return
  }

  // ─── APPLY ──────────────────────────────────────────────────────────────────────────────────
  /** ⛔ Before storage is even opened: no upload may happen for a seller we will not write to. */
  if (refusal) throw new Error(refusal)
  /** ⛔ BEFORE THE FIRST STATUS WRITE (the screen's hides included): without the tag table a revived page
   *  keeps serving its cached 404 for 30 days. Same refusal as scripts/expire-apartment-rentals.ts. */
  const isrTable = await isrTagTablePresent(db)
  if (!isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table on this database — a revived page would keep its cached 404 from ISR; pass --allow-no-isr only on a scratch copy')
  // ⛔ Live rows the content screen refused as banned are hidden only now, past the storefront refusal.
  await screen.applyHides()
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  /** ⚠️ SUPABASE_SECRET_KEY, not SERVICE_ROLE — a guessed name leaves storage null and turns one
   *  missing credential into N per-row "failures". Refuse once, up front. */
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!SUPABASE_URL || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
  if (/supabase\.co$/.test(new URL(SUPABASE_URL).hostname)) throw new Error(`refusing to upload to ${SUPABASE_URL} — retired project`)
  const storage = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } }).storage.from('listings')
  const host = makeImageHost({ storage, storageUrl: SUPABASE_URL, bucket: 'listings', edge: 1600, quality: 82, mark: 'overlay' })
  const t = stamp()
  const MANIFEST = join(journal!, `nhatot-uploaded-objects-${t}.txt`)
  const CREATED = join(journal!, `nhatot-created-rows-${t}.jsonl`)
  /**
   * The 7-day rule's writes (header ⛔ 8). The PLAN (old values) is journalled BEFORE each write; the
   * rollback line only AFTER the write moved the row — so the rollback names nothing this run did not do.
   */
  const REVIVED = join(journal!, `nhatot-revived-rows-${t}.jsonl`)
  const REPOSTED = join(journal!, `nhatot-reposted-rows-${t}.jsonl`)
  const DATES_ROLLBACK = join(journal!, `nhatot-revive-repost-rollback-${t}.sql`)
  console.log(`upload manifest   ${MANIFEST}\ncreated journal   ${CREATED}\nrevived (planned) ${REVIVED}\nreposted (planned) ${REPOSTED}\nrollback          ${DATES_ROLLBACK}  (only rows this run moved)`)

  if (!seller) {
    await db.seller.create({
      /** Badges false and no owner: the badge must never imply we vetted these, and nobody owns them. */
      data: { id: NHATOT_SELLER_ID, name: NHATOT_SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false },
    })
  }

  /** Learnt BEFORE the first row, once — every row this run is judged against the same stamp. */
  const mark = COVER_BY_MARK ? await learnMark(db) : null
  const stat = {
    created: 0, refreshed: 0, unchanged: 0, photoFailed: 0, tooFewRealPhotos: 0, uploadFailed: 0, raced: 0, errored: 0, uploaded: 0,
    duplicatePhotos: 0, coverByMark: 0, imagesRefused: {} as Record<string, number>, revived: 0, reposted: 0,
  }
  /** Rows THIS run moved back to 'active' — each tombstoned as it lands, and all once more in the finally. */
  const revivedIds: string[] = []
  let stopped: string | null = null
  let tombstoneFailed = false
  try {
    for (const r of batch) {
      /** ⚠️ One bad row must not end the run; the next run picks up whatever was skipped. A StopRead does. */
      try {
        const data = { ...r.mutable, categoryId: category.id, sellerId: NHATOT_SELLER_ID }
        const cur = await db.listing.findUnique({
          where: { sellerId_externalId: { sellerId: NHATOT_SELLER_ID, externalId: r.externalId } },
          select: {
            id: true, title: true, titleVi: true, description: true, descriptionVi: true, price: true,
            priceUnit: true, currency: true, negotiable: true, listingType: true, categoryId: true,
            subcategorySlug: true, sellerId: true, location: true, district: true, city: true, lat: true,
            lng: true, areaM2: true, attributes: true, affiliateUrl: true, searchText: true, status: true,
            postedAt: true, rankScore: true,
          },
        })
        // ⛔ A TOMBSTONE IS LEFT AS IT IS (src/lib/listing-removed.ts): a listing a moderator or admin REMOVED keeps its externalId, so this SKU lands on it — refreshing its text, price or photos would rewrite the record kept as evidence (Law 122/2025). Not refreshed, not recreated.
        if (cur?.status === 'removed') { stat.unchanged++; continue }
        if (cur) {
          const was = cur as Record<string, unknown>, next = data as Record<string, unknown>
          /** The 7-day rule: revive an expired/stale apartment the source shows fresh; move postedAt forward on a re-list. */
          const plan = nhatotExistingRowPlan(cur, { postedAt: r.postedAt, subcategorySlug: r.mutable.subcategorySlug }, stagedAt)
          if (MUTABLE_KEYS.every((k) => was[k] === next[k]) && !plan.revive && !plan.postedAt) { stat.unchanged++; continue }
          /** postedAt and rankScore move TOGETHER, from the source date, the way create sets them. */
          const dates = plan.postedAt ? { postedAt: plan.postedAt, rankScore: rankAt(plan.postedAt) } : {}
          const old = { id: cur.id, externalId: r.externalId, oldStatus: cur.status, oldPostedAt: cur.postedAt.toISOString(), oldRankScore: cur.rankScore }
          if (plan.revive) {
            const newPostedAt = plan.postedAt ?? r.postedAt
            /** The PLAN, fsynced BEFORE the write — enough to find and repair a row a crash cut off mid-way. */
            recordDurably(REVIVED, JSON.stringify({ ...old, newPostedAt: newPostedAt.toISOString(), planned: new Date().toISOString() }))
            /** Owed its tombstone BEFORE the write: a write that commits and then loses its reply would otherwise
             *  leave an active row on its cached 404 that no later run revisits. A tombstone on a row the write did
             *  not move only re-renders its current state. */
            revivedIds.push(cur.id)
            /** ⛔ ONLY from a revivable status, re-checked IN the write — a row hidden or removed since the read is not touched. */
            const back = await db.listing.updateMany({
              where: { id: cur.id, sellerId: NHATOT_SELLER_ID, status: { in: [...REVIVABLE_STATUSES] } },
              data: { ...data, ...dates, status: 'active' },
            })
            if (back.count !== 1) { stat.raced++; continue }
            stat.revived++
            /** AFTER the write moved it: the rollback names only what this run did, guarded on the state it made. */
            recordDurably(DATES_ROLLBACK, nhatotRevivalRollbackSql({ id: cur.id, oldStatus: cur.status, oldPostedAt: cur.postedAt, oldRankScore: cur.rankScore, newPostedAt }))
            /** Its cached 404 goes NOW, not hours later after the photo uploads of the rest of the batch. */
            if (!(await tombstoneNow(db, [cur.id]))) tombstoneFailed = true
            continue
          }
          if (plan.postedAt) {
            recordDurably(REPOSTED, JSON.stringify({ id: old.id, externalId: old.externalId, oldPostedAt: old.oldPostedAt, oldRankScore: old.oldRankScore, newPostedAt: plan.postedAt.toISOString(), planned: new Date().toISOString() }))
          }
          /** ⛔ `status`, `verified`, `images` are NOT here: a refresh never re-publishes a moderated or
           *  retired row and never touches photos. The one way back to 'active' is the revival above.
           *  ⛔ NEVER A REMOVED ROW: the status is re-checked IN the write (a moderator may have removed it since
           *  the read), and a moved date only lands on the date this run read (the rollback restores that one). */
          const w = await db.listing.updateMany({
            where: { id: cur.id, sellerId: NHATOT_SELLER_ID, status: { not: 'removed' }, ...(plan.postedAt ? { postedAt: cur.postedAt } : {}) },
            data: { ...data, ...dates },
          })
          if (w.count !== 1) { stat.raced++; continue }
          if (plan.postedAt) recordDurably(DATES_ROLLBACK, nhatotRepostRollbackSql({ id: cur.id, oldPostedAt: cur.postedAt, oldRankScore: cur.rankScore, newPostedAt: plan.postedAt }))
          stat.refreshed++
          if (plan.postedAt) stat.reposted++
          continue
        }
        /** ⛔ Judged BEFORE anything uploads, by the same plan the dry-run probe prints. */
        const { judged, plan } = await judgeRow(r, mark)
        for (const [k, n] of Object.entries(plan.refused)) stat.imagesRefused[k] = (stat.imagesRefused[k] ?? 0) + (n ?? 0)
        stat.duplicatePhotos += plan.duplicates
        if (plan.decision === 'photoFailed') { stat.photoFailed++; continue }
        if (plan.decision === 'tooFewRealPhotos') { stat.tooFewRealPhotos++; continue }
        const images: string[] = []
        for (const i of plan.keep) {
          const url = await host.fromBuffer(judged[i].body!, slugOf(r))
          if (!url) break
          /** Recorded BEFORE it is judged, so even a rejected upload is on the cleanup list. */
          recordDurably(MANIFEST, url)
          if (!isOverlayImageUrl(url)) break
          images.push(url)
        }
        if (images.length !== plan.keep.length) { stat.uploadFailed++; continue }
        stat.uploaded += images.length
        /** The publish gate's own count, on the dHash each stored URL carries — the last word. */
        if (countDistinctAngles(images) < NHATOT_MIN_PHOTOS) { stat.tooFewRealPhotos++; continue }
        const made = await db.listing.create({
          data: {
            ...data, externalId: r.externalId,
            /** ⛔ `verified` is the PUBLICATION GATE (feed-query pins verified=true for every public
             *  caller), not a trust badge — the trust signal is Seller.verified, which stays false. */
            status: 'active', verified: true,
            images: JSON.stringify(images),
            /** ⛔ CREATE-ONLY, both from the SOURCE's post date: the nightly recompute owns decay after this. */
            postedAt: r.postedAt,
            rankScore: rankOf(r),
          },
          select: { id: true },
        })
        recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: r.externalId, at: new Date().toISOString() }))
        stat.created++
        if (plan.cover) stat.coverByMark++
      } catch (e) {
        if (e instanceof StopRead) { stopped = e.message; break }
        if ((e as { code?: string }).code === 'P2002') stat.raced++
        else { stat.errored++; console.warn(`  ! ${r.externalId}: ${(e as Error).message.slice(0, 160)}`) }
      }
      const done = stat.created + stat.refreshed + stat.revived + stat.unchanged + stat.photoFailed + stat.tooFewRealPhotos + stat.uploadFailed + stat.raced + stat.errored
      if (done % 100 === 0) console.log(`  ${done}/${batch.length}  ${JSON.stringify(stat)}`)
    }
  } finally {
    /** Every page revived this run once more — a per-row tombstone that failed, or a throw between a write
     *  and its tombstone, still ends with the cached 404 gone. Idempotent (a newer stamp wins). */
    if (revivedIds.length) {
      if (await tombstoneNow(db, revivedIds)) tombstoneFailed = false
      else { tombstoneFailed = true; console.error(`⛔ ISR tombstones FAILED for revived rows (ids in ${DATES_ROLLBACK}) — each rollback line carries the tombstone SQL for its row`) }
    }
    console.log(`ISR tombstones    ${revivedIds.length ? `${revivedIds.length} revived pages × en/vi, each as it landed and all once more at the end` : 'none needed'}${isrTable ? '' : ' — SKIPPED, no tag table (--allow-no-isr)'}`)
  }
  const active = await db.listing.count({ where: { sellerId: NHATOT_SELLER_ID, status: 'active' } })
  console.log(`\n${JSON.stringify(stat)}   active now ${active}`)
  if (stopped) console.log(`⛔ STOPPED EARLY: ${stopped} — the rest of the batch was not attempted; re-run later from a fresh --save.`)
  console.log(`uploaded-object manifest: ${MANIFEST}  (orphans from skipped rows are listed there too)`)
  if (stat.revived || stat.reposted) console.log(`7-day rule        revived ${stat.revived} (planned: ${REVIVED}) · postedAt moved forward on ${stat.reposted} (planned: ${REPOSTED}) · undo: ${DATES_ROLLBACK}`)
  console.log(`\nNEXT: npx tsx scripts/verify-nhatot-import.ts · set-partner-avatar.ts --seller '${NHATOT_SELLER_NAME}' --logo <url> (no --official) · node scripts/purge-isr-listings.mjs`)
  /** ⛔ Never DELETE: Order is onDelete:Restrict and six relations Cascade. Hiding is total and reversible. */
  console.log(`\nROLLBACK (safe, reversible):\n  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${NHATOT_SELLER_ID}' AND status <> 'removed';`)
  console.log(`  -- or only this run's rows: the ids in ${CREATED}`)
  console.log(`  -- this run's revivals and moved dates: ${DATES_ROLLBACK} (only rows this run moved; a revival undone only while the row is still active with the date it set, a moved date only while it is still the one this run set; each line re-tombstones its page)`)
  console.log(`  -- hard delete is NOT paste-safe: Order is onDelete:Restrict and six relations Cascade.`)
  await db.$disconnect()
  process.exitCode = nhatotApplyExitCode(stat, stopped)
  if (tombstoneFailed && !process.exitCode) process.exitCode = 1
  /**
   * ⛔ THE LAST LINE, printed only when the row loop ran to the END of the batch — row errors included (the
   * exit code stays 1 for those). A crash never reaches it, and neither does a StopRead (exit 2, the rest of
   * the batch not attempted): the weekly job reads it to tell a FINISHED apply from one that died.
   */
  if (stopped === null) console.log('APPLY COMPLETED')
}

// ─── retire ────────────────────────────────────────────────────────────────────────────────────
type LivenessFile = {
  kind: 'nhatot-liveness'
  checkedAt: string
  userAgent: string
  canary: { live: NhatotLiveness | null; gone: NhatotLiveness | null }
  complete: boolean
  stopped: string | null
  results: NhatotLiveness[]
}
/** An id the detail endpoint must answer "entity not found" for (measured 2026-09-24). */
const KNOWN_GONE_ID = 1000000001

async function detail(id: number): Promise<NhatotLiveness> {
  const { status, body } = await gatewayJson(`${NHATOT_API}/${id}`)
  /** ⛔ `body` holds the poster's phone and name; only the classifier sees it, and it keeps list_id + status. */
  return classifyNhatotLiveness(id, status, body)
}
/** Checks that timed out or failed on the network this run (`<id>: <error name>`), for the report. */
const undetermined: string[] = []
const MAX_UNDETERMINED_IN_A_ROW = 5
/**
 * ⛔ ONE SLOW ANSWER IS NOT A CRASH. A timeout or network failure makes THAT id 'unknown' (which retires
 * nothing — nhatotShouldRetire) and the pass goes on; it used to escape the loop and end the whole check.
 * A StopRead (429, challenge, HTML) still ends the pass.
 */
async function detailChecked(id: number): Promise<NhatotLiveness> {
  try { return await detail(id) } catch (e) {
    if (e instanceof StopRead) throw e
    undetermined.push(`${id}: ${(e as Error).name}`)
    return nhatotLivenessUndetermined(id)
  }
}

function readLiveness(path: string): LivenessFile {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LivenessFile>
  if (!raw || raw.kind !== 'nhatot-liveness' || typeof raw.checkedAt !== 'string' || !Array.isArray(raw.results)) {
    throw new Error(`${path} is not a nhatot liveness file (make one with --retire --save)`)
  }
  /** Re-run the whitelist on read: a hand edit cannot add a field, or turn a 200 into a 'gone'. */
  const results = raw.results.map((r) => stageNhatotLiveness(r)).filter((r): r is NhatotLiveness => r !== null)
  return {
    kind: 'nhatot-liveness',
    checkedAt: raw.checkedAt,
    userAgent: typeof raw.userAgent === 'string' ? raw.userAgent : '',
    canary: { live: stageNhatotLiveness(raw.canary?.live), gone: stageNhatotLiveness(raw.canary?.gone) },
    complete: raw.complete === true,
    stopped: typeof raw.stopped === 'string' ? raw.stopped : null,
    results,
  }
}

/** ⛔ The endpoint must still mean what the classifier thinks it means, or nothing is retired. */
function livenessTrustProblem(f: Pick<LivenessFile, 'canary' | 'results'>): string | null {
  if (f.canary.live?.verdict !== 'live') return `canary: a just-listed ad did not read as live (${JSON.stringify(f.canary.live)}) — the endpoint changed; retiring nothing`
  if (f.canary.gone?.verdict !== 'gone') return `canary: id ${KNOWN_GONE_ID} did not read as gone (${JSON.stringify(f.canary.gone)}) — the "not found" signal changed; retiring nothing`
  const checked = f.results.filter((r) => r.verdict !== 'unknown')
  if (checked.length >= 20 && checked.every(nhatotShouldRetire)) return `all ${checked.length} checked rows read as gone — that is an endpoint fault, not a market; retiring nothing`
  return null
}

async function retireMain() {
  if (SRC && SAVE) throw new Error('--save is for a live check; --src already is a status file')
  if (APPLY && !SRC) throw new Error('--retire --apply needs --src <status.json> from a reviewed --retire --save run')
  if (HAS_CAPS) throw new Error('--cap is an import option')
  if (FRESH_OUT !== null) throw new Error(nhatotFreshOutProblem({ src: !!SRC, apply: APPLY, retire: true, limit: LIMIT, caps: HAS_CAPS, maxAgeDaysGiven: MAX_AGE_GIVEN, maxAgeDays: MAX_AGE_DAYS, cities: CITIES, cgs: CGS }) ?? '--fresh-out is not a --retire option')
  const IDS = str('--ids')
  if (IDS && (SRC || APPLY)) throw new Error('--ids is for a dry liveness probe only')
  /** ⛔ FIRST, before the file, the DB or the network. */
  const journal = APPLY ? prepareJournalDir() : null
  const db = openDb(APPLY)
  const seller = await db.seller.findUnique({ where: { id: NHATOT_SELLER_ID }, select: SELLER_SELECT })
  const refusal = nhatotSellerRefusal(seller)

  if (APPLY) {
    const f = readLiveness(SRC!)
    const age = nhatotStageAgeProblem(f.checkedAt, Date.now())
    if (age) throw new Error(age)
    const trust = livenessTrustProblem(f)
    if (trust) throw new Error(trust)
    if (!seller) throw new Error(`seller ${NHATOT_SELLER_ID} does not exist — nothing to retire`)
    if (refusal) throw new Error(refusal)
    const gone = f.results.filter(nhatotShouldRetire)
    /** ⛔ BEFORE THE FIRST HIDE: without the tag table a hidden ad's cached page renders for 30 more days. */
    const isrTable = await isrTagTablePresent(db)
    if (!isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table on this database — a hidden page would keep rendering from ISR; pass --allow-no-isr only on a scratch copy')
    const t = stamp()
    const RETIRED = join(journal!, `nhatot-retired-rows-${t}.jsonl`)
    const ROLLBACK = join(journal!, `nhatot-retired-rows-${t}.rollback.sql`)
    console.log(`status file       ${SRC} (checked ${f.checkedAt}) · ${f.results.length} results, ${gone.length} gone/inactive`)
    console.log(`retire journal    ${RETIRED}  (planned, before each write)\nrollback          ${ROLLBACK}  (only rows this run hid)`)
    const stat = { hidden: 0, notOnSeller: 0, notActive: 0, raced: 0 }
    const hiddenIds: string[] = []
    let tombstoneFailed = false
    try {
      for (const g of gone) {
        const row = await db.listing.findUnique({
          where: { sellerId_externalId: { sellerId: NHATOT_SELLER_ID, externalId: `nhatot:${g.list_id}` } },
          select: { id: true, status: true },
        })
        if (!row) { stat.notOnSeller++; continue }
        if (row.status !== 'active') { stat.notActive++; continue }
        /** The PLAN, journalled + fsynced BEFORE the write. */
        recordDurably(RETIRED, JSON.stringify({ id: row.id, externalId: `nhatot:${g.list_id}`, from: 'active', to: 'hidden', evidence: g, planned: new Date().toISOString() }))
        /** Before as well as after: if the process dies between the write and the second tombstone, a page not re-rendered in between is already invalidated. */
        await tombstoneNow(db, [row.id])
        /** ⛔ HIDE, NEVER DELETE, and only a row that is still active on OUR seller (never a removed one). */
        const n = await db.listing.updateMany({ where: { id: row.id, sellerId: NHATOT_SELLER_ID, status: 'active' }, data: { status: 'hidden' } })
        if (n.count !== 1) { stat.raced++; continue }
        hiddenIds.push(row.id); stat.hidden++
        /** AFTER the write moved it: one guarded line per row this run hid, carrying its page's tombstone. */
        recordDurably(ROLLBACK, `UPDATE "Listing" SET status = 'active' WHERE id = ${nhatotSqlLit(row.id)} AND "sellerId" = ${nhatotSqlLit(NHATOT_SELLER_ID)} AND status = 'hidden';\n${nhatotTombstoneSql(row.id)}`)
        if (!(await tombstoneNow(db, [row.id]))) tombstoneFailed = true
      }
    } finally {
      if (hiddenIds.length) {
        if (await tombstoneNow(db, hiddenIds)) tombstoneFailed = false
        else { tombstoneFailed = true; console.error(`⛔ ISR tombstones FAILED for hidden rows (ids in ${ROLLBACK})`) }
      }
      console.log(`ISR tombstones    ${hiddenIds.length ? `${hiddenIds.length} hidden pages × en/vi, before and after each write and all once more at the end` : 'none needed'}${isrTable ? '' : ' — SKIPPED, no tag table (--allow-no-isr)'}`)
    }
    console.log(`\n${JSON.stringify(stat)}`)
    console.log(`UNDO: ${ROLLBACK}  (each line re-activates one row this run hid, only while it is still hidden, and re-tombstones its page)`)
    await db.$disconnect()
    if (tombstoneFailed) process.exitCode = 1
    return
  }

  // DRY: the live check.
  const startedAt = new Date().toISOString()
  let stopped: string | null = null
  const canary: LivenessFile['canary'] = { live: null, gone: null }
  const results: NhatotLiveness[] = []
  let policy = ''
  let targets: number[] = []
  let onSeller = new Map<number, string>()
  try {
    policy = await sitePolicy()
    /** Canary pair: the newest HCMC apartment (live by construction) and an id known to be gone.
     *  A timeout here leaves the canary unread/'unknown' — and --apply then refuses (livenessTrustProblem). */
    let first: NhatotStagedAd | null | undefined = null
    try { first = (await listPage('hcm', 1010, null, 0, 1)).ads.map((a) => stageNhatotAd(a)).find((a) => a !== null) } catch (e) {
      if (e instanceof StopRead) throw e
      undetermined.push(`canary list page: ${(e as Error).name}`)
    }
    if (first) canary.live = await detailChecked(first.list_id)
    canary.gone = await detailChecked(KNOWN_GONE_ID)
  } catch (e) {
    if (!(e instanceof StopRead)) throw e
    stopped = e.message
  }
  if (IDS) {
    targets = [...new Set(IDS.split(',').map((x) => Number(x.trim())))].filter((x) => Number.isSafeInteger(x) && x > 0)
    const mine = await db.listing.findMany({
      where: { sellerId: NHATOT_SELLER_ID, status: 'active', externalId: { in: targets.map((id) => `nhatot:${id}`) } },
      select: { id: true, externalId: true },
    })
    onSeller = new Map(mine.flatMap((r) => { const id = nhatotListIdOf(r.externalId); return id ? [[id, r.id] as [number, string]] : [] }))
  } else {
    /** Oldest-touched first: those are the likeliest to be gone, so a --limit sample spends well. */
    const rows = await db.listing.findMany({
      where: { sellerId: NHATOT_SELLER_ID, status: 'active' },
      select: { id: true, externalId: true },
      orderBy: { updatedAt: 'asc' },
      ...(LIMIT ? { take: LIMIT } : {}),
    })
    onSeller = new Map(rows.flatMap((r) => { const id = nhatotListIdOf(r.externalId); return id ? [[id, r.id] as [number, string]] : [] }))
    targets = [...onSeller.keys()]
  }
  if (!stopped) {
    /** One timeout is that id's 'unknown'; a RUN of them is a gateway that is not answering — stop, rather
     *  than spend 30 s on each of thousands of rows. */
    let inARow = 0
    for (const id of targets) {
      try { results.push(await detailChecked(id)) } catch (e) {
        if (!(e instanceof StopRead)) throw e
        stopped = e.message; break
      }
      inARow = results[results.length - 1].http === 0 ? inARow + 1 : 0
      if (inARow >= MAX_UNDETERMINED_IN_A_ROW) { stopped = `${inARow} checks in a row timed out or failed on the network — the gateway is not answering; stopping`; break }
    }
  }
  const file: LivenessFile = {
    kind: 'nhatot-liveness', checkedAt: startedAt, userAgent: NHATOT_UA, canary,
    complete: !stopped && !LIMIT && !IDS && results.length === targets.length, stopped, results,
  }
  if (SAVE) writeFileAtomic(SAVE, JSON.stringify(file, null, 1))
  const verdicts = results.reduce<Record<string, number>>((a, r) => { a[r.verdict] = (a[r.verdict] ?? 0) + 1; return a }, {})
  const statuses = results.reduce<Record<string, number>>((a, r) => { const k = `${r.http}${r.status ? `/${r.status}` : ''}`; a[k] = (a[k] ?? 0) + 1; return a }, {})
  const wouldHide = results.filter(nhatotShouldRetire)
  const trust = livenessTrustProblem(file)

  console.log(`mode              RETIRE — DRY liveness check (DB session read-only; nothing hidden)`)
  console.log(`robots.txt        ${[...robots].map(([h, r]) => `${h}: ${r.note}`).join(' · ')}`)
  console.log(`site policy       www.nhatot.com: ${policy || '(not reached)'}`)
  console.log(`seller            ${seller ? `${seller.name} (${seller.id}) owner=${seller.ownerId ?? 'none'} badges=${[seller.verified, seller.verifiedSeller, seller.officialPartner].join('/')}` : `${NHATOT_SELLER_ID} does not exist yet — no rows to check`}${refusal ? `  ⛔ --apply would REFUSE: ${refusal}` : ''}`)
  console.log(`canary            live ${JSON.stringify(canary.live)} · gone ${JSON.stringify(canary.gone)}`)
  console.log(`targets           ${IDS ? `--ids ${targets.join(',')}` : `${targets.length} active rows on the seller${LIMIT ? ` (oldest-touched ${LIMIT})` : ''}`}`)
  console.log(`checked           ${results.length}  verdicts ${JSON.stringify(verdicts)}  http/status ${JSON.stringify(statuses)}`)
  if (undetermined.length) console.log(`undetermined      ${undetermined.length} timed out / failed on the network → 'unknown', retire nothing: ${undetermined.slice(0, 8).join(', ')}${undetermined.length > 8 ? ' …' : ''}`)
  for (const r of results.slice(0, 12)) console.log(`  ${String(r.list_id).padEnd(12)} ${r.verdict.padEnd(9)} http ${r.http}${r.status ? ` status ${r.status}` : ''}${onSeller.has(r.list_id) ? '' : '  (not an active row on the seller — --apply would skip it)'}`)
  console.log(`would hide        ${wouldHide.filter((r) => onSeller.has(r.list_id)).length} row(s)${trust ? `  ⛔ --apply would REFUSE: ${trust}` : ''}`)
  if (stopped) console.log(`⛔ STOPPED: ${stopped}`)
  console.log(`requests          ${requests} (${[...perHost].map(([h, n]) => `${h} ${n}`).join(', ')}), ≥${GAP_MS} ms apart per host`)
  console.log(`\nDRY RUN — nothing hidden. ${SAVE ? `Status file: ${SAVE} — review it, then` : 'Save with --save <status.json>, review it, then'} --retire --src <status.json> --journal-dir <durable dir> --apply (within 72 h).`)
  await db.$disconnect()
  if (stopped) process.exitCode = 2
}

;(RETIRE ? retireMain() : importMain()).catch((e) => { console.error(e); process.exit(1) })
