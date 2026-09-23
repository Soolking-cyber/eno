/**
 * honeycomb.com.vn (Honeycomb House, an HCMC expat-rental agency) → eno REFERENCE LISTINGS.
 *
 * ⛔ TWO STEPS, NEVER ONE: STAGE (crawl → a reviewed file) and APPLY (that file → the database).
 *
 *   1. STAGE — reads the live site politely and the database READ-ONLY, writes nothing but the file:
 *        set -a; . ./.env; set +a; npx tsx scripts/import-honeycomb-com-vn.ts --save <staged.json>
 *          [--limit 30] [--city hcmc] [--since 2026-06-26] [--vnd-per-usd 25971] [--retire]
 *      Without --save it is a plain dry run (same crawl and report, nothing kept).
 *   2. REVIEW the file and the report. Re-reading it reads no page again — only robots.txt, the logo
 *      and one cover photo (3 requests, same rules; --retire adds one liveness check per candidate):
 *        … import-honeycomb-com-vn.ts --src <staged.json> [--retire]
 *   3. APPLY — only from a staged file under 72 h old, by its own `fetchedAt`:
 *        … import-honeycomb-com-vn.ts --src <staged.json> --apply --journal-dir <durable dir>
 *          [--limit 5 | --retire]   (--retire needs the whole import in view, so not with --limit)
 *   4. VERIFY — read-only invariants of what is stored; exits non-zero on failure:
 *        … import-honeycomb-com-vn.ts --verify
 *
 * Flags
 *   --limit N        stage: read at most N pages, newest `lastmod` first. apply: import at most N rows.
 *   --city C         hcmc | hanoi | danang — keep only that city (the source is HCMC-only today)
 *   --since D        skip listings last modified before D (default: 90 days ago — owner, 2026-09-24)
 *   --vnd-per-usd R  stage only: pin the conversion rate instead of reading open.er-api.com
 *   --delay-ms N     ms between requests: 1200 by default AND the floor — a smaller value is raised to 1200,
 *                    a non-number falls back to the default
 *   --save F         stage: write the staged file to F
 *   --src F          read a staged file instead of the live site (the only input --apply accepts)
 *   --retire         re-check rows whose page left the sitemap; with --apply, hide those answering
 *                    404/410. Needs a complete sitemap read and no --limit.
 *   --apply          WRITE: create the seller (+ avatar), upload photos, create/update rows, retire
 *   --journal-dir D  required with --apply, checked BEFORE anything else runs: the uploaded-object
 *                    manifest and created-row journal go here (NOT /tmp — macOS clears it on reboot)
 *   --verify         read-only invariant check; exits non-zero on failure
 *
 * The pure parsing/mapping/validation lives in src/lib/honeycomb-listing.ts (unit-tested); this file
 * owns fetching, the database and storage. Same shape as import-rever-rentals.ts — outbound
 * `affiliateUrl`, no chat, `negotiable:false`, `listingType:'rent'` (also the feed guard), ownerless
 * seller pinned by id, `status`/`verified`/`images`/`rankScore`/`postedAt` create-only — with these
 * differences, each deliberate:
 *
 * ⛔ 1. THE SOURCE PRICES IN US DOLLARS AND eno STORES ĐỒNG. The rent is converted at STAGE time
 * (USD-base open.er-api.com feed, band-checked, fail closed) and the rate is written into the staged
 * file, so the prices a reviewer read are the prices applied. Rounded to 10,000 đ; the dollar figure
 * is kept verbatim in both descriptions, which say the đồng price is approximate. A re-run keeps the
 * stored price while the dollar figure is unchanged, so FX drift never rewrites rows.
 *
 * ⛔ 2. PHOTOS ARE RE-HOSTED BY THIS SCRIPT, ON CREATE ONLY, ALL-OR-NOTHING. A NEW row is created
 * only after every one of its photos uploaded cleanly under listings/affiliate/m/ (makeImageHost
 * mark:'overlay'), so no row is ever born imageless or with a short gallery. Existing rows never
 * have `images` touched. Uploaded objects are journalled with fsync before the row is written.
 * Honeycomb burns its own mark into every photo; the owner ACCEPTED that on 2026-09-24 (same rule as
 * Batdongsan). The app draws eno's mark on top.
 *
 * ⚠️ 3. AVAILABILITY IS NOT PUBLISHED. No page carries a "rented" marker and a 2020 listing still
 * answers 200. The sitemap `lastmod` window (--since, 90 days) is the freshness filter; --retire acts
 * only on a POSITIVE signal (404/410), never on absence or age. A row that ages out of the window
 * stays active and is REPORTED, not hidden.
 *
 * ⚠️ 4. NO COORDINATES, NO AREA ON THE SOURCE. When the page's "Project" names a building that
 * src/generated/rever-buildings.ts knows, the row gets that `buildingKey` and the building's
 * centroid as lat/lng. Otherwise both stay null — no guessed pin.
 *
 * ⛔ 5. PLACE FIELDS ARE COMPOSED FROM CHECKED PARTS. `location` never copies the source address
 * (it prints house numbers); the ward is published only when consistent with the district
 * (checkWard); `city` is the src/data/vn-units.json Vietnamese `name` ('Hồ Chí Minh'), the one
 * spelling the post wizard and every importer store (owner decision 2026-09-24); the province
 * filter matches it through src/lib/province-match.ts.
 *
 * ⛔ 6. REDIRECTS ARE FOLLOWED BY HAND, ONLY WITHIN honeycomb.com.vn. Every hop is its own rate-gated
 * request, and a hop to any other host (or to a robots-disallowed path) is refused, not followed
 * (makePoliteGet / redirectTarget in the lib). A refused robots.txt redirect stops the run.
 */
import 'dotenv/config'
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { browseRankScore } from '../src/lib/ranking-formula'
import { minPhotosFor } from '../src/lib/publish-guard'
import { REVER_BUILDINGS } from '../src/generated/rever-buildings'
import {
  HONEYCOMB_SELLER_ID as SELLER_ID, HONEYCOMB_SELLER_NAME as SELLER_NAME, HONEYCOMB_LOGO_URL as LOGO_URL,
  HONEYCOMB_MONEY, HONEYCOMB_ORIGIN, CITY_KEYS, CITY_NAME, DEFAULT_SINCE_DAYS, MIN_LOGO_VISIBLE_PCT, STAGE_MAX_AGE_H, STAGE_SOURCE,
  VND_PER_USD_BAND, Infeasible, allowedImage, allowedTarget, applyPreflight, assessHoneycomb, defaultSince, hasHouseNumber, runSince, valuedFlagProblem,
  isGoneStatus, isPropertySitemap, journalDirProblem, makePoliteGet, parseDelayMs, parseHoneycombPage, parseSitemapIndex,
  parseUrlset, priceToStore, readHoneycombStage, retireCandidates, robotsAllows, robotsFromResponse, sellerRefusal,
  stageAgeProblem, stageHoneycombRecord, visiblePct, vndPerUsdFrom,
  type CityKey, type Got, type HoneycombStage, type MappedHoneycomb, type SitemapEntry, type StagedHoneycomb,
} from '../src/lib/honeycomb-listing'

const CATEGORY_SLUG = 'rentals'
const BUCKET = 'listings'

const argv = process.argv
const APPLY = argv.includes('--apply')
const VERIFY = argv.includes('--verify')
const RETIRE = argv.includes('--retire')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const LIMIT = Number(str('--limit', '0'))
const CITY = str('--city') as CityKey | null
const SINCE_ARG = str('--since')
/** The run's window (runSince): reassigned once a replay has read the window its file was staged with. */
let SINCE = runSince(SINCE_ARG, null, Date.now())
const DEFAULT_SINCE_LABEL = `${defaultSince(Date.now())}, ${DEFAULT_SINCE_DAYS} days`
const FX_OVERRIDE = str('--vnd-per-usd')
/** ⛔ PATH ARGUMENTS, NOT CONSTANTS. */
const SRC = str('--src')
const SAVE = str('--save')
const JOURNAL_DIR = str('--journal-dir')
/** ⛔ Finite-number guard and 1200 ms floor: a typo such as `--delay-ms 1500ms` falls back to 1200,
 *  and `--delay-ms 1000` is raised to 1200 — never faster. */
const DELAY_MS = parseDelayMs(str('--delay-ms'))

/**
 * ⚠️ A TRUTHFUL USER-AGENT (src/lib/partner-fetch.ts:90 is the model). A sysadmin reading a log
 * must be able to tell what this is and block it if they object. Never a spoofed browser.
 */
const UA = 'Mozilla/5.0 (compatible; eno-property-fetch/1.0; +https://eno.vn)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

/** honeycomb.com.vn's robots.txt once `checkRobots` has read it; redirect hops are checked against it. */
let robotsTxtSeen: string | null = null
/**
 * ⛔ THE ONLY WAY THIS SCRIPT TOUCHES THE NETWORK (src/lib/honeycomb-listing.ts `makePoliteGet`):
 * one request at a time, ≥DELAY_MS (floor 1200) after the previous one FINISHED — so ≥1.2 s per
 * host — with every redirect hop gated the same way and followed only within honeycomb.com.vn.
 * A bot challenge, a captcha or a 429 throws Infeasible; this script never retries around, solves
 * or evades one.
 */
const polite = makePoliteGet({
  fetch: (url, init) => fetch(url, init),
  sleep, now: Date.now, delayMs: DELAY_MS, userAgent: UA,
  robotsTxt: () => robotsTxtSeen,
})
const politeGet = polite.get

/** Append + fsync the SAME handle, before the write it protects (attach-rever-photos.ts:97-110). */
function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}

/**
 * ⛔ THE JOURNAL DIR IS PROVEN WRITABLE BEFORE ANY CRAWL, DATABASE CALL OR UPLOAD. A run that
 * would lose its record of what it uploaded must fail while it has done nothing. Not a temp dir.
 */
function prepareJournalDir(dir: string): string {
  const tmpRoots = [tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp']
  const abs = resolve(dir)
  let problem = journalDirProblem(abs, tmpRoots)
  if (!problem) {
    mkdirSync(abs, { recursive: true })
    /** A symlink into /tmp is still /tmp. */
    problem = journalDirProblem(realpathSync(abs), tmpRoots.map((t) => { try { return realpathSync(t) } catch { return t } }))
  }
  if (problem) throw new Error(problem)
  const probe = join(abs, `.honeycomb-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok')
  unlinkSync(probe)
  return abs
}

function makeDb(readOnly: boolean) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      /** Belt and braces: a dry run or --verify opens every session read-only, so no code path
       *  below can write even by mistake. */
      ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
    }),
    log: ['warn', 'error'],
  })
}

/** The refreshable columns. Everything else is create-only. `buildingKey`/`lat`/`lng` are only
 *  SET when we have a building, never cleared, so a module regeneration cannot un-group rows. */
function mutableOf(m: MappedHoneycomb, categoryId: string, price: number) {
  return {
    title: m.title, titleVi: m.titleVi, description: m.description, descriptionVi: m.descriptionVi,
    price, priceUnit: HONEYCOMB_MONEY.priceUnit, currency: HONEYCOMB_MONEY.currency,
    negotiable: false,
    listingType: 'rent',
    categoryId,
    subcategorySlug: m.subcategorySlug,
    sellerId: SELLER_ID,
    location: m.location, district: m.district, city: m.city,
    areaM2: m.areaM2,
    attributes: m.attributes,
    affiliateUrl: m.affiliateUrl,
    searchText: m.searchText,
    ...(m.buildingKey ? { buildingKey: m.buildingKey } : {}),
    ...(m.lat !== null && m.lng !== null ? { lat: m.lat, lng: m.lng } : {}),
  }
}
type Mutable = ReturnType<typeof mutableOf>

/** Which refreshable fields differ from what is stored. Unchanged rows are not written at all, so
 *  a re-run does not bump `updatedAt` (the sitemap orders a 45,000-row window by it). */
function changedFields(stored: Record<string, unknown>, next: Mutable): string[] {
  return Object.entries(next).filter(([k, v]) => (stored[k] ?? null) !== (v ?? null)).map(([k]) => k)
}

/** robots.txt, read on every run (stage AND apply — it can change between them). */
async function checkRobots() {
  const robots = await politeGet(`${HONEYCOMB_ORIGIN}/robots.txt`)
  /** 200 → rules, 4xx → no rules; 5xx, a refused redirect or anything else → disallow-all (lib). */
  const verdict = robotsFromResponse({ status: robots.status, refusedRedirect: robots.refusedRedirect, body: robots.body.toString('utf8') })
  if (!verdict.ok) throw new Infeasible(verdict.reason)
  const robotsTxt = verdict.robotsTxt
  for (const p of ['/wp-sitemap.xml', '/wp-sitemap-posts-estate_property-1.xml', '/property/x/', '/wp-content/uploads/2026/09/x.jpg']) {
    if (!robotsAllows(robotsTxt, p)) throw new Infeasible(`robots.txt disallows ${p} for user-agent * — INFEASIBLE`)
  }
  robotsTxtSeen = robotsTxt
}

async function logoCheck(): Promise<{ ok: boolean; out: Buffer | null; line: string }> {
  try {
    const res = await politeGet(LOGO_URL)
    if (res.status !== 200) return { ok: false, out: null, line: `HTTP ${res.status}` }
    const sharp = (await import('sharp')).default
    const meta = await sharp(res.body).metadata()
    /** Identical to set-partner-avatar.ts: 512² contain on white, flattened, webp q92. */
    const out = await sharp(res.body).resize(512, 512, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }).webp({ quality: 92 }).toBuffer()
    const { data } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true })
    const pct = visiblePct(data)
    const ok = pct >= MIN_LOGO_VISIBLE_PCT
    return { ok, out, line: `${meta.width}x${meta.height} ${meta.format} → 512² webp ${out.length} B, ${pct.toFixed(1)}% visible on white (floor ${MIN_LOGO_VISIBLE_PCT}%) → ${ok ? 'PASS' : 'REFUSED'}` }
  } catch (e) {
    if (e instanceof Infeasible) throw e
    return { ok: false, out: null, line: `logo check failed: ${(e as Error).message.slice(0, 120)}` }
  }
}

/** STAGE: robots → rate → sitemaps → detail pages, into a staged object. Writes nothing. */
async function crawl(sinceMs: number): Promise<HoneycombStage> {
  await checkRobots()

  let vndPerUsd: number
  let fxSource: string
  if (FX_OVERRIDE) {
    vndPerUsd = Number(FX_OVERRIDE)
    if (!(vndPerUsd >= VND_PER_USD_BAND.min && vndPerUsd <= VND_PER_USD_BAND.max)) throw new Error(`--vnd-per-usd ${FX_OVERRIDE} is outside ${VND_PER_USD_BAND.min}–${VND_PER_USD_BAND.max}`)
    fxSource = '--vnd-per-usd'
  } else {
    const fx = await politeGet('https://open.er-api.com/v6/latest/USD')
    if (fx.refusedRedirect) throw new Error(`open.er-api.com: ${fx.refusedRedirect} — pass --vnd-per-usd to pin a rate`)
    let json: unknown = null
    try { json = JSON.parse(fx.body.toString('utf8')) } catch { /* null → refused below */ }
    const r = vndPerUsdFrom(json)
    /** ⛔ FAIL CLOSED: no rate, no import. A guessed rate mis-prices every row. */
    if (r === null) throw new Error('no plausible VND/USD rate from open.er-api.com — pass --vnd-per-usd to pin one')
    vndPerUsd = r
    fxSource = `open.er-api.com USD base, updated ${(json as { time_last_update_utc?: string }).time_last_update_utc ?? '?'}`
  }

  const index = await politeGet(`${HONEYCOMB_ORIGIN}/wp-sitemap.xml`)
  if (index.status !== 200) throw new Error(`sitemap index answered ${index.status}${index.refusedRedirect ? ` (${index.refusedRedirect})` : ''}`)
  const maps = parseSitemapIndex(index.body.toString('utf8')).filter(isPropertySitemap)
  const byUrl = new Map<string, SitemapEntry>()
  let mapsOk = 0
  for (const m of maps) {
    const res = await politeGet(m)
    if (res.status !== 200) { console.warn(`  ! ${m} answered ${res.status}${res.refusedRedirect ? ` (${res.refusedRedirect})` : ''}`); continue }
    mapsOk++
    for (const e of parseUrlset(res.body.toString('utf8'))) if (allowedTarget(e.url)) byUrl.set(e.url, e)
  }
  const entries = [...byUrl.values()]
  const inWindow: (SitemapEntry & { t: number })[] = []
  for (const e of entries) {
    const t = Date.parse(e.lastmod ?? '')
    // ⚠️ `t >= since` keeps; NaN (a missing or malformed lastmod) compares false and is left out.
    if (t >= sinceMs) inWindow.push({ ...e, t })
  }
  inWindow.sort((a, b) => b.t - a.t)
  const batch = LIMIT ? inWindow.slice(0, LIMIT) : inWindow

  const drop: Record<string, number> = {}
  const bump = (k: string) => { drop[k] = (drop[k] ?? 0) + 1 }
  const records: StagedHoneycomb[] = []
  let read = 0
  let stopped: string | null = null
  for (const e of batch) {
    let res: Got
    try { res = await politeGet(e.url) } catch (err) {
      /** A 429 or a challenge ends the READ, not the run: what was read so far is still staged. */
      if (err instanceof Infeasible) { stopped = err.message; break }
      bump('fetchError'); continue
    }
    read++
    /** ⛔ A redirect off the site (or to a robots-disallowed path) was NOT followed: drop the page. */
    if (res.refusedRedirect) { bump('redirectRefused'); continue }
    if (isGoneStatus(res.status)) { bump('gone'); continue }
    if (res.status !== 200) { bump(`http${res.status}`); continue }
    if (res.finalUrl !== e.url || !allowedTarget(res.finalUrl)) { bump('redirected'); continue }
    const parsed = parseHoneycombPage(res.body.toString('utf8'), e.url)
    if (typeof parsed === 'string') { bump(parsed); continue }
    /** ⛔ Through the allowlist on the way IN, as well as on the way back out of the file. */
    const staged = stageHoneycombRecord({ ...parsed, lastmod: e.lastmod })
    if (!staged) { bump('allowlist'); continue }
    records.push(staged)
  }
  return {
    source: STAGE_SOURCE,
    fetchedAt: new Date().toISOString(),
    userAgent: UA,
    params: { since: SINCE, limit: LIMIT, city: CITY },
    fx: { vndPerUsd, source: fxSource },
    sitemap: { maps: maps.length, mapsOk, complete: maps.length > 0 && mapsOk === maps.length && entries.length > 0, entries },
    pages: { read, drop, stopped },
    records,
  }
}

async function verify() {
  const db = makeDb(true)
  const where = { sellerId: SELLER_ID }
  const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { name: true, ownerId: true, verified: true, verifiedSeller: true, officialPartner: true, avatarUrl: true } })
  const total = await db.listing.count({ where })
  const active = await db.listing.count({ where: { ...where, status: 'active' } })
  console.log(`  honeycomb rows        ${total}  (active ${active}, not active ${total - active})`)
  /** ⛔ Every check below counts BAD rows, so zero rows would score a perfect pass. Assert first. */
  const vacuous = !seller ? `seller ${SELLER_ID} does not exist`
    : seller.name !== SELLER_NAME ? `seller ${SELLER_ID} is named "${seller.name}", not "${SELLER_NAME}"`
    : total === 0 ? `seller ${SELLER_ID} has no listings — nothing to verify` : null
  if (vacuous) { console.error(`  PRECONDITION FAILED: ${vacuous}`); await db.$disconnect(); process.exitCode = 1; return }

  const badTarget = await db.listing.count({ where: { ...where, OR: [{ affiliateUrl: null }, { NOT: { affiliateUrl: { startsWith: `${HONEYCOMB_ORIGIN}/property/` } } }] } })
  const negotiable = await db.listing.count({ where: { ...where, negotiable: true } })
  const notRent = await db.listing.count({ where: { ...where, listingType: { not: 'rent' } } })
  const badUnit = await db.listing.count({ where: { ...where, NOT: { priceUnit: HONEYCOMB_MONEY.priceUnit } } })
  const homestay = await db.listing.count({ where: { ...where, subcategorySlug: 'homestay-serviced' } })
  const badCity = await db.listing.count({ where: { ...where, NOT: { city: { in: CITY_KEYS.map((k) => CITY_NAME[k]) } } } })
  const held = await db.listing.count({ where: { ...where, status: 'active', verified: false } })
  const allHeld = active > 0 && held >= active * 0.9
  const refusal = sellerRefusal(seller!)
  const minPhotos = minPhotosFor(CATEGORY_SLUG)
  const activeRows = await db.listing.findMany({ where: { ...where, status: 'active' }, select: { images: true, rankScore: true, location: true } })
  let badImages = 0, unranked = 0, houseNo = 0
  for (const r of activeRows) {
    let imgs: unknown = null
    try { imgs = JSON.parse(r.images) } catch { /* counted below */ }
    if (!Array.isArray(imgs) || imgs.length < minPhotos || !imgs.every((u) => typeof u === 'string' && isOverlayImageUrl(u))) badImages++
    if (!(r.rankScore > 0)) unranked++
    if (hasHouseNumber(r.location)) houseNo++
  }
  const dupes = await db.listing.groupBy({ by: ['externalId'], where, _count: { externalId: true }, having: { externalId: { _count: { gt: 1 } } } })
  const line = (label: string, n: number, bad: string) => console.log(`  ${pad(label, 26)}${n}   ${n ? `FAIL — ${bad}` : 'ok'}`)
  line('bad affiliateUrl', badTarget, 'missing or off-host outbound link')
  line('negotiable=true', negotiable, 'offer UI on an ownerless row; the server 409s')
  line('listingType != rent', notRent, 'rent is the ads-feed guard')
  line(`priceUnit != ${HONEYCOMB_MONEY.priceUnit}`, badUnit, 'card loses its "/ month" suffix')
  line('homestay-serviced rows', homestay, 'serviced flats belong under apartment-rental')
  line('city not the vn-units name', badCity, `city must be one of ${CITY_KEYS.map((k) => CITY_NAME[k]).join(' / ')} — one spelling per city`)
  line('house number in location', houseNo, 'a street address is published')
  console.log(`  ${pad('held (verified=false)', 26)}${held}   ${allHeld ? 'FAIL — supermajority held, category renders empty' : held ? '(moderator holds — not a failure)' : 'ok'}`)
  line('seller refused', refusal ? 1 : 0, `seller ${refusal}`)
  line(`active <${minPhotos} overlay imgs`, badImages, 'imageless, short or non-overlay gallery')
  line('duplicate externalIds', dupes.length, 'upsert key broken')
  console.log(`  ${pad('rankScore <= 0', 26)}${unranked}   ${unranked ? '(sits last until the nightly recompute — not a failure)' : 'ok'}`)
  console.log(`  ${pad('seller avatar', 26)}${seller!.avatarUrl ?? '(none)'}`)
  await db.$disconnect()
  const failures = badTarget + negotiable + notRent + badUnit + homestay + badCity + houseNo + (allHeld ? held : 0) + (refusal ? 1 : 0) + badImages + dupes.length
  if (failures) { console.error(`\n  ${failures} INVARIANT FAILURE(S) — exiting non-zero`); process.exitCode = 1 }
}

async function main() {
  if (VERIFY) return verify()

  // ── preflight: flags, then the journal dir — BEFORE any network or database call ─────────
  const flagProblem = valuedFlagProblem(argv)
  if (flagProblem) throw new Error(flagProblem)
  if (!Number.isInteger(LIMIT) || LIMIT < 0) throw new Error('--limit must be a non-negative integer')
  const pre = applyPreflight({ apply: APPLY, src: SRC, save: SAVE, journalDir: JOURNAL_DIR, retire: RETIRE, limit: LIMIT })
  if (pre) throw new Error(pre)
  const journal = APPLY ? prepareJournalDir(JOURNAL_DIR!) : null
  if (CITY && !CITY_KEYS.includes(CITY)) throw new Error(`--city must be one of ${CITY_KEYS.join(', ')}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error('--since must be YYYY-MM-DD')
  let sinceMs = Date.parse(`${SINCE}T00:00:00+07:00`)
  if (!Number.isFinite(sinceMs)) throw new Error('--since must be YYYY-MM-DD')
  if (SRC && FX_OVERRIDE) throw new Error('--vnd-per-usd is a stage option; a staged file carries the rate it was reviewed with')

  // ── the staged data: a reviewed file, or a live read ──────────────────────────────────────
  let stage: HoneycombStage
  let rejectedOnRead = 0
  if (SRC) {
    const parsed = readHoneycombStage(JSON.parse(readFileSync(SRC, 'utf8')))
    if (!parsed.ok) throw new Error(`${SRC}: ${parsed.reason}`)
    stage = parsed.stage
    rejectedOnRead = parsed.rejected
    /** A replay filters by the window the file was staged and reviewed with, not a fresh 90 days. */
    SINCE = runSince(SINCE_ARG, stage.params.since, Date.now())
    sinceMs = Date.parse(`${SINCE}T00:00:00+07:00`)
    if (!Number.isFinite(sinceMs)) throw new Error(`${SRC}: staged --since "${SINCE}" is not a date`)
    const stale = stageAgeProblem(stage.fetchedAt, Date.now())
    /** ⛔ A STALE FILE REFUSES THE WRITE, IT DOES NOT WARN. */
    if (stale && APPLY) throw new Error(`${SRC}: ${stale}`)
    if (stale) console.warn(`  ! ${stale} — fine to read, refused by --apply`)
    /** Politeness and robots apply to every request a replay makes: the photos and retire fetches of
     *  an apply, and the logo and cover a dry-run replay checks (it skipped robots.txt until 2026-09-24,
     *  so those hops had no rules to be checked against). */
    await checkRobots()
  } else {
    stage = await crawl(sinceMs)
  }
  if (SAVE) {
    writeFileSync(SAVE, JSON.stringify(stage, null, 1), { mode: 0o600 })
  }
  const ageH = (Date.now() - Date.parse(stage.fetchedAt)) / 3_600_000

  // ── map (the same code on stage and apply, so a review sees exactly what will be written) ─
  const minImages = minPhotosFor(CATEGORY_SLUG)
  const drop: Record<string, number> = { ...stage.pages.drop }
  const keepAll: (MappedHoneycomb & { postedAt: Date; lastmod: string })[] = []
  for (const r of stage.records) {
    const t = Date.parse(r.lastmod ?? '')
    if (!(t >= sinceMs)) { drop.beforeSince = (drop.beforeSince ?? 0) + 1; continue }
    const a = assessHoneycomb(r, { vndPerUsd: stage.fx.vndPerUsd, minImages, cityFilter: CITY, buildings: REVER_BUILDINGS })
    if (!a.ok) { drop[a.reason] = (drop[a.reason] ?? 0) + 1; continue }
    /** postedAt = the source's last modification, clamped to now: the card's age and the recency
     *  rank then say how fresh the AGENCY's listing is, not when we copied it. Create-only. */
    keepAll.push({ ...a.row, postedAt: new Date(Math.min(t, Date.now())), lastmod: r.lastmod ?? '' })
  }
  const keep = SRC && LIMIT ? keepAll.slice(0, LIMIT) : keepAll

  // ── database (read-only until --apply) ────────────────────────────────────────────────────
  const db = makeDb(!APPLY)
  const category = await db.category.findFirst({ where: { slug: CATEGORY_SLUG }, select: { id: true, name: true } })
  if (!category) throw new Error(`no \`${CATEGORY_SLUG}\` category — cannot place these rows`)
  const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true, avatarUrl: true, trustScore: true, verified: true, verifiedSeller: true, officialPartner: true } })
  const refusal = sellerRefusal(seller)
  const already = await db.listing.count({ where: { sellerId: SELLER_ID } })
  const storedRows = keep.length ? await db.listing.findMany({
    where: { sellerId: SELLER_ID, externalId: { in: keep.map((k) => k.externalId) } },
    select: {
      id: true, externalId: true, status: true, title: true, titleVi: true, description: true, descriptionVi: true,
      price: true, priceUnit: true, currency: true, negotiable: true, listingType: true, categoryId: true,
      subcategorySlug: true, sellerId: true, location: true, district: true, city: true, areaM2: true,
      attributes: true, affiliateUrl: true, searchText: true, buildingKey: true, lat: true, lng: true,
    },
  }) : []
  const stored = new Map(storedRows.map((r) => [r.externalId!, r]))
  const plan = keep.map((k) => {
    const s = stored.get(k.externalId) ?? null
    const price = priceToStore(s, k.priceUsd, k.price)
    const mutable = mutableOf(k, category.id, price)
    const changed = s ? changedFields(s as unknown as Record<string, unknown>, mutable) : null
    return { k, s, mutable, changed }
  })
  const toCreate = plan.filter((p) => !p.s)
  const toUpdate = plan.filter((p) => p.s && p.changed!.length)
  const unchanged = plan.filter((p) => p.s && !p.changed!.length)
  const fieldHist: Record<string, number> = {}
  for (const p of toUpdate) for (const f of p.changed!) fieldHist[f] = (fieldHist[f] ?? 0) + 1
  const sampleRank = browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: keep[0]?.postedAt ?? new Date(), featured: false })
  const hist = (f: (k: MappedHoneycomb) => string) => keep.reduce<Record<string, number>>((a, k) => { const v = f(k); a[v] = (a[v] ?? 0) + 1; return a }, {})

  /** Retire candidates and age report, from the staged sitemap. */
  const sitemapUrls = new Set(stage.sitemap.entries.map((e) => e.url))
  const lastmodByUrl = new Map(stage.sitemap.entries.map((e) => [e.url, e.lastmod]))
  const activeOnSeller = await db.listing.findMany({ where: { sellerId: SELLER_ID, status: 'active' }, select: { id: true, affiliateUrl: true } })
  const candidates = stage.sitemap.complete ? retireCandidates(activeOnSeller, sitemapUrls) : []
  const agedOut = activeOnSeller.filter((r) => r.affiliateUrl && sitemapUrls.has(r.affiliateUrl) && !(Date.parse(lastmodByUrl.get(r.affiliateUrl) ?? '') >= sinceMs)).length

  const logo = !seller?.avatarUrl ? await logoCheck() : null

  console.log(`source            ${SRC ? `staged ${SRC}` : `live ${HONEYCOMB_ORIGIN}`}  fetched ${stage.fetchedAt} (${ageH.toFixed(1)} h ago; --apply refuses over ${STAGE_MAX_AGE_H} h)`)
  console.log(`robots / UA       allowed for every path used · "${stage.userAgent}" · ≥${DELAY_MS} ms between requests`)
  console.log(`fx                ${stage.fx.vndPerUsd} đ/US$  (${stage.fx.source})`)
  console.log(`sitemaps          ${stage.sitemap.mapsOk}/${stage.sitemap.maps} property sitemaps read${stage.sitemap.complete ? '' : ' — INCOMPLETE (no retire pass)'} · ${stage.sitemap.entries.length} urls`)
  console.log(`window            lastmod ≥ ${SINCE} (default ${DEFAULT_SINCE_LABEL})${SRC ? ` · staged with --since ${stage.params.since}` : ''}`)
  console.log(`pages read        ${stage.pages.read}${stage.params.limit ? ` (--limit ${stage.params.limit}, newest first)` : ''}${stage.pages.stopped ? ` — STOPPED: ${stage.pages.stopped}` : ''}`)
  if (SRC) console.log(`staged records    ${stage.records.length} (${rejectedOnRead} rejected by the allowlist on read)`)
  if (SAVE) console.log(`staged file       ${resolve(SAVE)}  (${stage.records.length} records)`)
  console.log(`dropped           ${JSON.stringify(drop)}`)
  console.log(`TO IMPORT         ${keep.length}${SRC && LIMIT ? ` (--limit ${LIMIT} of ${keepAll.length})` : ''}   (create ${toCreate.length} · update ${toUpdate.length} · unchanged ${unchanged.length})${toUpdate.length ? `  fields ${JSON.stringify(fieldHist)}` : ''}`)
  console.log(`  by subcategory  ${JSON.stringify(hist((k) => k.subcategorySlug))}`)
  console.log(`  by city         ${JSON.stringify(hist((k) => k.city))}   (the vn-units Vietnamese name — what the wizard stores)`)
  console.log(`  by district     ${JSON.stringify(hist((k) => k.district ?? '(none)'))}`)
  console.log(`  by location     ${JSON.stringify(hist((k) => k.location))}`)
  console.log(`city filter       ${CITY ?? '(none — hcmc, hanoi, danang all accepted; this source is HCMC-only)'}`)
  console.log(`category          ${category.name} (${category.id}) · priceUnit ${HONEYCOMB_MONEY.priceUnit} · currency ${HONEYCOMB_MONEY.currency}`)
  if (seller) {
    console.log(`seller            ${seller.name} (${seller.id}) owner=${seller.ownerId ?? 'none'} badges=${[seller.verified, seller.verifiedSeller, seller.officialPartner].join('/')} avatar=${seller.avatarUrl ?? '(none)'}`)
  } else {
    console.log(`seller            (will be CREATED) ${JSON.stringify({ id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false, ownerId: null })}`)
  }
  if (refusal) console.log(`                  ⛔ --apply WILL REFUSE: seller ${SELLER_ID} ${refusal}`)
  if (logo) console.log(`seller logo       ${LOGO_URL}\n                  ${logo.line}${APPLY ? '' : ' — uploaded to listings/partner/avatar-<id>-<ts36>.webp on --apply'}`)
  console.log(`rows on seller    ${already}`)
  console.log(`rankScore (new)   ${sampleRank.toFixed(4)} for the newest row (browseRankScore, trust ${seller?.trustScore ?? 100}, create-only)`)
  console.log(`photos            ${keep.reduce((n, k) => n + k.images.length, 0)} source photos on ${keep.length} rows (min ${minImages}/row); re-hosted to listings/affiliate/m/ ONLY for created rows on --apply`)
  console.log(`buildings         ${keep.filter((k) => k.buildingKey).length}/${keep.length} rows matched a map building (buildingKey + centroid); the rest get no coordinates`)
  console.log(`aged out          ${agedOut} active rows' pages were last modified before ${SINCE} — REPORTED, not hidden (age is not a retire signal)`)
  console.log(`retire pass       ${!RETIRE ? `OFF (--retire not passed) · ${candidates.length} active rows absent from the sitemap` : !stage.sitemap.complete ? 'OFF — the staged sitemap read is incomplete' : `${candidates.length} active rows absent from the sitemap → re-checked below`}`)

  if (keep.length) {
    console.log(`\n── rows (${keep.length}) ──`)
    for (const k of keep) {
      const p = plan.find((x) => x.k === k)!
      console.log(`  ${pad(k.externalId, 17)} ${pad(k.subcategorySlug, 17)} ${pad(`US$${k.priceUsd}`, 10)} ${pad(vnd(p.mutable.price), 16)} ${pad(k.location, 28)} ${pad(k.buildingKey ?? '-', 26)} ${k.images.length}img ${k.lastmod.slice(0, 10)} ${p.s ? (p.changed!.length ? 'UPDATE' : 'same') : 'CREATE'}  ${k.title}`)
    }
    console.log(`\n── sample rows, composed exactly as stored (images: SOURCE urls here; on --apply they are re-hosted first) ──`)
    for (const p of plan.slice(0, 3)) {
      const create = { ...p.mutable, externalId: p.k.externalId, status: 'active', verified: true, images: p.k.images, rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: p.k.postedAt, featured: false }), postedAt: p.k.postedAt.toISOString() }
      console.log(JSON.stringify(create, null, 2))
    }
    if (!APPLY) {
      // One photo of the first sample, decoded — proves the originals are reachable and full-size.
      try {
        const cover = await politeGet(keep[0].images[0])
        const sharp = (await import('sharp')).default
        const meta = await sharp(cover.body).metadata()
        console.log(`\ncover check       ${keep[0].images[0]} → HTTP ${cover.status} ${cover.type} ${cover.body.length} B ${meta.width}x${meta.height}`)
      } catch (e) {
        if (e instanceof Infeasible) throw e
        console.log(`\ncover check       failed: ${(e as Error).message.slice(0, 120)}`)
      }
    }
  }

  /**
   * ⛔ RETIRE ONLY ON A POSITIVE SIGNAL. A row missing from the sitemap is RE-FETCHED, and is a
   * retire candidate only when its page answers 404 or 410. Absence, age, or a failed fetch
   * retires nothing. A dry run probes and reports; only --apply hides.
   */
  const gone: string[] = []
  if (RETIRE && stage.sitemap.complete && candidates.length) {
    for (const r of candidates) {
      const got = await politeGet(r.affiliateUrl!).catch((e) => { if (e instanceof Infeasible) throw e; return null })
      if (got && isGoneStatus(got.status)) gone.push(r.id)
    }
    console.log(`retire probe      ${candidates.length} re-checked · ${gone.length} answer 404/410${APPLY ? ' → hidden below' : ' → WOULD be hidden with --apply'}`)
  }

  if (!APPLY) {
    console.log(`requests total    ${polite.count()}`)
    console.log(`mode              DRY RUN (database session read-only) — nothing written, nothing uploaded.`)
    console.log(SRC
      ? `\nNEXT: --src ${SRC} --apply --journal-dir <durable dir>   (within ${STAGE_MAX_AGE_H} h of ${stage.fetchedAt})`
      : `\nNEXT: stage with --save <file>, review it, then --src <file> --apply --journal-dir <durable dir>`)
    await db.$disconnect(); return
  }

  // ── APPLY ─────────────────────────────────────────────────────────────────────────────────
  /** ⛔ Refused BEFORE any write: renamed, owned, verified, verifiedSeller or officialPartner. */
  if (refusal) throw new Error(`seller ${SELLER_ID} ${refusal}; refusing to write`)
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  /** ⚠️ SUPABASE_SECRET_KEY, not SERVICE_ROLE — guessing wrong leaves storage null (attach-bds:50-53). */
  const KEY = process.env.SUPABASE_SECRET_KEY
  if (!SUPABASE_URL || !KEY) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
  if (/supabase\.co$/.test(new URL(SUPABASE_URL).hostname)) throw new Error(`refusing to upload to ${SUPABASE_URL} — retired project`)
  const bucket = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } }).storage.from(BUCKET)
  const host = makeImageHost({ storage: bucket, storageUrl: SUPABASE_URL, bucket: BUCKET, edge: 1600, quality: 82, mark: 'overlay' })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const UPLOADED = join(journal!, `honeycomb-uploaded-objects-${stamp}.txt`)
  const CREATED = join(journal!, `honeycomb-created-rows-${stamp}.jsonl`)
  console.log(`\nmode              APPLY — WRITES TO PRODUCTION\njournal           ${CREATED}\nupload manifest   ${UPLOADED}`)

  if (!seller) {
    /** ⚠️ No owner and no badges: the badge must never imply we vetted them (contract §2). */
    await db.seller.create({ data: { id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false } })
    console.log(`seller created    ${SELLER_ID}`)
  }
  /** The avatar is set only when there is none — never overwrites one someone chose. */
  if (!seller?.avatarUrl && logo?.ok && logo.out) {
    const name = `partner/avatar-${SELLER_ID}-${Date.now().toString(36)}.webp`
    const { error } = await bucket.upload(name, logo.out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) console.warn(`  ! avatar upload failed: ${String((error as Error).message ?? error)}`)
    else {
      const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`
      recordDurably(UPLOADED, avatarUrl)
      await db.seller.updateMany({ where: { id: SELLER_ID, avatarUrl: null }, data: { avatarUrl } })
      console.log(`seller avatar     ${avatarUrl}`)
    }
  } else if (!seller?.avatarUrl) console.warn(`  ! seller avatar NOT set: ${logo?.line ?? 'no check ran'}`)

  const sharp = (await import('sharp')).default
  const stat = { created: 0, updated: 0, unchanged: unchanged.length, photosShort: 0, uploadFailed: 0, raced: 0, errored: 0, uploaded: 0, retired: 0 }
  for (const p of [...toUpdate, ...toCreate]) {
    try {
      if (p.s) {
        /** Only the fields that differ — an unchanged column is not rewritten. */
        const data: Partial<Mutable> = {}
        for (const f of p.changed! as (keyof Mutable)[]) Object.assign(data, { [f]: p.mutable[f] })
        await db.listing.update({ where: { id: p.s.id }, data })
        stat.updated++
        continue
      }
      /**
       * ⛔ ALL-OR-NOTHING, BEFORE THE ROW EXISTS. Every usable photo is uploaded first; a single upload
       * failure abandons the row (orphans are in the manifest), so a listing is never born with a
       * short gallery that later runs would treat as done (attach-rever-photos.ts:36-40).
       * A photo that is not a real full-size image — undecodable, redirected off the uploads folder,
       * or under 300 px on its short edge (a thumbnail or a headshot-sized crop) — is LEFT OUT,
       * failing closed; the row still needs the category's minimum after that.
       */
      const usable: Buffer[] = []
      for (const src of p.k.images) {
        const got = await politeGet(src)
        if (got.status !== 200 || !allowedImage(got.finalUrl) || !/^image\//.test(got.type) || !got.body.length || got.body.length > 15_000_000) continue
        const meta = await sharp(got.body).metadata().catch(() => null)
        if (!meta?.width || !meta?.height || Math.min(meta.width, meta.height) < 300) continue
        usable.push(got.body)
      }
      if (usable.length < minImages) { stat.photosShort++; continue }
      const slug = p.k.externalId.replace(/[^a-z0-9]/gi, '-')
      const urls: string[] = []
      for (const buf of usable) {
        const url = await host.fromBuffer(buf, slug)
        if (!url) break
        /** Recorded BEFORE it is judged, so even a rejected upload is on the cleanup list. */
        recordDurably(UPLOADED, url)
        if (!isOverlayImageUrl(url)) break
        urls.push(url)
      }
      if (urls.length !== usable.length) { stat.uploadFailed++; continue }
      stat.uploaded += urls.length
      const created = await db.listing.create({
        data: {
          ...p.mutable,
          externalId: p.k.externalId,
          /** ⛔ CREATE-ONLY: `verified` is the PUBLICATION GATE (feed-query.ts:143-150), status and
           *  images are owned by moderation and by this create — a refresh must never reset them. */
          status: 'active', verified: true,
          images: JSON.stringify(urls),
          postedAt: p.k.postedAt,
          rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: p.k.postedAt, featured: false }),
        },
        select: { id: true },
      })
      recordDurably(CREATED, JSON.stringify({ id: created.id, externalId: p.k.externalId, images: urls.length }))
      stat.created++
      if (stat.created % 25 === 0) console.log(`  ${stat.created} created · ${stat.uploaded} photos`)
    } catch (e) {
      if (e instanceof Infeasible) throw e
      /** P2002 = the unique (sellerId, externalId) — another run created it between read and write. */
      if ((e as { code?: string }).code === 'P2002') stat.raced++
      else { stat.errored++; console.warn(`  ! ${p.k.externalId}: ${(e as Error).message.slice(0, 160)}`) }
    }
  }

  /** 'hidden', never 'sold' — it was not sold through eno. Never DELETE. One-way: status is create-only. */
  if (gone.length) {
    stat.retired = (await db.listing.updateMany({ where: { id: { in: gone }, sellerId: SELLER_ID, status: 'active' }, data: { status: 'hidden' } })).count
    recordDurably(CREATED, JSON.stringify({ retired: gone }))
  }

  const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
  console.log(`\n${JSON.stringify(stat)}   active now ${active}   requests ${polite.count()}`)
  console.log(`\nVERIFY:   npx tsx scripts/import-honeycomb-com-vn.ts --verify`)
  /** Never DELETE: Order is onDelete:Restrict and six relations Cascade (contract §13). */
  console.log(`ROLLBACK (safe, reversible — removes them from every public surface):`)
  console.log(`  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${SELLER_ID}';`)
  console.log(`  -- hard delete is NOT paste-safe. Uploaded objects: ${UPLOADED} (leave them until the edge cache expires).`)
  console.log(`AFTER AN AVATAR CHANGE: node scripts/purge-isr-listings.mjs (storefront cards are baked into ISR pages).`)
  await db.$disconnect()
}


main().catch((e) => {
  console.error(e instanceof Infeasible ? `\nINFEASIBLE: ${e.message}` : e)
  process.exit(1)
})
