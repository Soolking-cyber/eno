/**
 * muaban.net rentals (HCMC, Hà Nội, Đà Nẵng) → eno REFERENCE LISTINGS, facts only.
 *
 * Run (DRY by default: reads muaban.net politely and the DB READ-ONLY, writes nothing anywhere
 * except the optional local --stage file):
 *   set -a; . ./.env; set +a; npx tsx scripts/import-muaban-net.ts \
 *     [--city hcm,hn,dn] [--types apartment,house,room,office] [--cap hcm=3000,hn=1000,dn=1000] \
 *     [--limit N] [--stage <out.jsonl>] [--probe-images] [--list-only] [--max-pages 100] [--delay-ms 1500]
 * Re-map a reviewed stage offline:   ... --src <staged.jsonl> [--limit N] [--probe-images]
 * Write (ONLY from a reviewed stage): ... --src <staged.jsonl> --journal <durable dir> --apply
 * Liveness (dry):                    ... --retire [--limit N]
 * Liveness (write, hides only):      ... --retire --journal <durable dir> --apply
 *
 * Pipeline contract followed (see import-rever-rentals.ts / import-batdongsan-rentals.ts):
 *   - seller PINNED BY ID, refused when renamed, owned or badged, created ownerless and unbadged;
 *   - `affiliateUrl` always set, host-pinned and BY ID ONLY (never the poster's title slug, which
 *     carries house numbers), `negotiable:false`, `listingType:'rent'`, `priceUnit` the app's own rent
 *     unit ('VND/month'), `city` the vn-units Vietnamese name ('Hồ Chí Minh') like every other row;
 *   - `status`, `verified`, `images`, `postedAt` and `rankScore` are CREATE-ONLY, and `postedAt` is
 *     muaban's own `publish_at` (clamped to now), never the import time — rankScore follows from it;
 *   - photos re-hosted CLEAN via makeImageHost({ mark:'overlay' }), all-or-nothing per listing, text
 *     cards refused (galleryPlan — the same rule the dry run's --probe-images reports);
 *   - retirement only on a POSITIVE signal (404/410 or the ad's own inactive flags), to 'hidden',
 *     never DELETE; rollback is a soft hide.
 *
 * ⛔ STAGE, REVIEW, THEN --apply. `--apply` refuses a live crawl and requires `--src`, the JSONL a
 * previous dry run wrote with `--stage` (the partner-fetch.ts pattern: fetching never publishes).
 * Each staged record carries its own `fetchedAt`; a stage over 72 h old refuses --apply, and every
 * line is rebuilt through the field allowlist on read (restageRecord) — a hand-edited stage cannot
 * smuggle a field in. The journal dir is checked (durable, writable) BEFORE any network or DB work.
 *
 * ⛔ THE STAGE HOLDS NO PERSONAL DATA. muaban cards carry a masked phone, an encrypted phone and the
 * poster's user id; detail pages add the contact's name, the free-text body and the street address
 * with house number. stageItem()/stageDetail() in muaban-net-map.ts build records from an
 * ALLOWLIST, so none of it is written to disk, let alone to the database.
 *
 * ⚠️ PHOTOS CARRY MUABAN'S OWN WATERMARK. The `thumb-detail` size (the largest the pages reference)
 * has a faint, centred "muaban.net" mark burned in. The owner accepted burned-in source marks
 * (2026-09-24, same rule as Batdongsan); eno's own mark is drawn on top by the overlay URL.
 *
 * ⚠️ "NEWEST" IS MUABAN'S OWN ORDER. Each city × type list is read with `sort=1` ("Mới nhất",
 * publish_at descending — muaban re-publishes renewed ads, so this is "most recently live", not
 * "first posted"), and the types are merged newest-first per city, so `--cap hcm=3000` takes the
 * 3,000 newest HCMC rentals rather than 750 of each type.
 *
 * ⚠️ PAGINATION IS CAPPED BY THE SOURCE. Measured 2026-09-24 on the HCMC rentals URL: ?page=100 and
 * ?page=1000 return the SAME 20 items, so one listing URL yields at most ~100 pages (~2,000 cards).
 * The crawler stops a seed when a page repeats; four type seeds reach ~8,000 HCMC cards.
 */
import 'dotenv/config'
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { makeImageHost } from '../src/lib/host-product-image'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { measureImage } from '../src/lib/import-photo-check'
import {
  ALLOWED_HOSTS, CITIES, EXTERNAL_PREFIX, MAX_STAGE_AGE_HOURS, PLACEHOLDER_ENTROPY, PLACEHOLDER_FLAT, PROPERTY_TYPES,
  RENT_PRICE_UNIT, SELLER_ID, SELLER_LOGO_URL, SELLER_NAME,
  affiliateUrlFor, coverToDetail, createOnlyFields, galleryPlan, imageVerdict, isChallenge, journalDirProblem, listPageUrl,
  livenessVerdict, mapRecord, massRetireRefusal, modeRefusal, newestHead, oldestStageAgeHours, parseNextData, parseRunArgs,
  parseStage, retireRollbackSql, robotsAllows, robotsRules, sameMutable, sellerRefusal, sourcePageUrl, stageAgeRefusal,
  stageDetail, stageItem, compareNewest,
  type CityKey, type DropReason, type ImageMeasure, type ImageVerdict, type Liveness, type MappedRow, type MuabanDetail, type MuabanListItem,
  type PhotoOutcome, type StagedRecord,
} from './muaban-net-map'

const A = parseRunArgs(process.argv)
const { apply: APPLY, retire: RETIRE, src: SRC, stage: STAGE, journalDir: JOURNAL_DIR, cities: CITY_KEYS, types: TYPES } = A
const { caps: CAPS, limit: LIMIT, maxPages: MAX_PAGES, delayMs: DELAY_MS, probeImages: PROBE_IMAGES, listOnly: LIST_ONLY } = A
/**
 * ⚠️ A TRUTHFUL USER-AGENT. Whoever reads muaban's logs can see what this is and block it if they
 * object; spoofing a browser is what turns a crawl into an incident (partner-fetch.ts:84-90).
 */
const UA = 'Mozilla/5.0 (compatible; eno-property-import/1.0; +https://eno.vn)'
const BUCKET = 'listings'
/** A photo or page larger than this is refused rather than buffered. */
const MAX_BODY_BYTES = 20 * 1024 * 1024

class Infeasible extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'

// ─── Polite fetching ─────────────────────────────────────────────────────────────────────────

const lastHit = new Map<string, number>()
const requestCount = new Map<string, number>()
const robotsCache = new Map<string, string>()

/** One request, after the per-host politeness gap. A network error or timeout is status 0. */
async function rawGet(url: URL, accept: string): Promise<{ status: number; body: Buffer; cfMitigated: string | null; location: string | null }> {
  const host = url.host
  const wait = (lastHit.get(host) ?? 0) + DELAY_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastHit.set(host, Date.now())
  requestCount.set(host, (requestCount.get(host) ?? 0) + 1)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept, 'accept-language': 'vi,en;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    })
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) return { status: 0, body: Buffer.alloc(0), cfMitigated: null, location: null }
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > MAX_BODY_BYTES) return { status: 0, body: Buffer.alloc(0), cfMitigated: null, location: null }
    return { status: res.status, body, cfMitigated: res.headers.get('cf-mitigated'), location: res.headers.get('location') }
  } catch {
    return { status: 0, body: Buffer.alloc(0), cfMitigated: null, location: null }
  }
}

/** ⛔ Pinned host, https only — checked on the first URL and on EVERY redirect hop. */
function pinned(u: URL): void {
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname) || u.port) throw new Infeasible(`refusing to fetch ${u.href}: not an allowed https host`)
}

/** robots.txt for this origin, fetched once (RFC 9309: 4xx → allow all, 5xx/0 → do not crawl). */
async function robotsFor(origin: string): Promise<string> {
  const cached = robotsCache.get(origin)
  if (cached !== undefined) return cached
  const got = await rawGet(new URL('/robots.txt', origin), 'text/plain')
  const rules = robotsRules(got.status, got.body.toString('utf8'))
  if (rules === null) throw new Infeasible(`robots.txt for ${origin} answered HTTP ${got.status}; not crawling without it`)
  robotsCache.set(origin, rules)
  return rules
}

/**
 * GET with the host pin, robots.txt and the per-host gap applied to EVERY hop. Redirects are
 * followed by hand (at most 5), because `fetch` would follow them to any host without asking.
 */
async function politeGet(url: string, accept = 'text/html'): Promise<{ status: number; body: Buffer; cfMitigated: string | null; finalUrl: string }> {
  let u = new URL(url)
  for (let hop = 0; hop <= 5; hop++) {
    pinned(u)
    if (!robotsAllows(await robotsFor(u.origin), u.pathname + u.search)) throw new Infeasible(`robots.txt disallows ${u.pathname}`)
    const got = await rawGet(u, accept)
    if (got.status >= 300 && got.status < 400 && got.location) { u = new URL(got.location, u); continue }
    return { status: got.status, body: got.body, cfMitigated: got.cfMitigated, finalUrl: u.href }
  }
  return { status: 0, body: Buffer.alloc(0), cfMitigated: null, finalUrl: u.href }
}

/** HTML page → its __NEXT_DATA__, or a thrown Infeasible on a challenge / rate limit. */
async function getPage(url: string): Promise<{ status: number; data: any | null }> {
  const { status, body, cfMitigated } = await politeGet(url)
  const html = body.toString('utf8')
  if (isChallenge(status, html, cfMitigated)) {
    throw new Infeasible(`bot challenge at ${url} (HTTP ${status}) — INFEASIBLE; stopping, not working around it`)
  }
  if (status === 429) throw new Infeasible(`HTTP 429 at ${url} — rate limited; stopping the crawl`)
  return { status, data: status === 200 ? parseNextData(html) : null }
}

// ─── Crawl (live) ────────────────────────────────────────────────────────────────────────────

type Drops = Partial<Record<DropReason | 'duplicate' | 'gone' | 'detailHttp' | 'detailParse', number>>
const bump = (d: Drops, k: keyof Drops) => { d[k] = (d[k] ?? 0) + 1 }

type Seed = { city: CityKey; type: number; page: number; done: string | null; buffer: any[]; lastPageIds: string }
type CityRun = { city: CityKey; kept: number; cap: number; done: string | null }

async function crawl(drops: Drops, onRecord: (r: StagedRecord) => void): Promise<{ records: StagedRecord[]; seeds: Seed[]; cities: CityRun[]; pages: number; stopped: string | null }> {
  const seeds: Seed[] = CITY_KEYS.flatMap((city) => TYPES.map((type) => ({ city, type, page: 0, done: null, buffer: [], lastPageIds: '' })))
  const cities: CityRun[] = CITY_KEYS.map((city) => ({ city, kept: 0, cap: CAPS[city] ?? Infinity, done: null }))
  const seen = new Set<number>()
  const records: StagedRecord[] = []
  const opts = { cities: CITY_KEYS, types: TYPES }
  let kept = 0
  let pages = 0
  let stopped: string | null = null

  /** Keep a seed's buffer non-empty, or mark it done. Each page is sorted newest-first on arrival,
   *  because muaban pins a few ads at the top of page 1 whose publish_at is older. */
  async function fill(s: Seed): Promise<void> {
    while (!s.done && !s.buffer.length) {
      if (s.page >= MAX_PAGES) { s.done = `max-pages ${MAX_PAGES}`; return }
      s.page++
      const url = listPageUrl(s.type, s.city, s.page)
      const { status, data } = await getPage(url)
      pages++
      const pp = data?.props?.pageProps
      const items: any[] = pp?.classified?.items ?? []
      const f = pp?.filterResult?.filters
      if (status !== 200 || !pp) { s.done = `HTTP ${status} on page ${s.page}`; return }
      /** ⛔ The page must be the filter AND the order we asked for — a redirect to a generic page
       *  would feed another city's or type's cards into this seed, and an ignored sort would pass
       *  muaban's default order off as "newest". */
      if (f?.city_id?.id !== CITIES[s.city].sourceId || f?.property_type?.id !== s.type || f?.sort?.id !== 1) {
        s.done = `seed mismatch on page ${s.page}`; return
      }
      const ids = items.map((i) => i?.id).join(',')
      if (!items.length) { s.done = `empty page ${s.page}`; return }
      if (ids === s.lastPageIds) { s.done = `page ${s.page} repeats page ${s.page - 1} (source pagination cap)`; return }
      s.lastPageIds = ids
      s.buffer.push(...[...items].sort(compareNewest))
    }
  }

  try {
    /** Round-robin one card at a time across the CITIES, so a small --limit still shows every
     *  city; inside a city, the newest card across its type seeds goes next. */
    while (!(LIMIT && kept >= LIMIT) && cities.some((c) => !c.done)) {
      for (const c of cities) {
        if (c.done || (LIMIT && kept >= LIMIT)) continue
        if (c.kept >= c.cap) { c.done = `cap ${c.cap} reached`; continue }
        const mine = seeds.filter((s) => s.city === c.city)
        for (const s of mine) await fill(s)
        const live = mine.filter((s) => s.buffer.length)
        if (!live.length) { c.done = 'every seed exhausted'; continue }
        const s = live[newestHead(live.map((x) => x.buffer[0]))]
        const raw = s.buffer.shift()
        const item: MuabanListItem = stageItem(raw)
        if (seen.has(item.id)) { bump(drops, 'duplicate'); continue }
        seen.add(item.id)

        const listCheck = mapRecord(item, null, opts)
        let detail: MuabanDetail | null = null
        let detailStatus: number | null = null
        /** Only a card that passes every list-level check costs a detail request. A card that fails
         *  one is still staged (detail null), so the drop histogram and an offline re-map see it. */
        if (listCheck.ok && !LIST_ONLY) {
          /** The source's canonical page, held in memory only: the stored id-only link answers a 301
           *  to it, which would cost a second request per row. */
          const got = await getPage(sourcePageUrl(item.id, raw?.url) ?? listCheck.row.mutable.affiliateUrl)
          detailStatus = got.status
          if (got.status === 404 || got.status === 410) bump(drops, 'gone')
          else if (got.status !== 200) bump(drops, 'detailHttp')
          else if (!got.data?.props?.pageProps?.classified) bump(drops, 'detailParse')
          else detail = stageDetail(got.data.props.pageProps.classified)
          if (!detail) continue
        }
        const rec: StagedRecord = { v: 1, fetchedAt: new Date().toISOString(), seed: { city: s.city, type: s.type }, item, detail, detailStatus }
        records.push(rec)
        onRecord(rec)
        if (mapRecord(item, detail, opts).ok) { kept++; c.kept++ }
      }
    }
  } catch (e) {
    if (!(e instanceof Infeasible)) throw e
    stopped = e.message
  }
  return { records, seeds, cities, pages, stopped }
}

// ─── Photos ──────────────────────────────────────────────────────────────────────────────────

type Measured = ImageMeasure & { verdict: ImageVerdict }
/** Decode + judge with the SHARED rule (src/lib/import-photo-check.ts): a null measure — bytes sharp
 *  cannot decode — is 'undecodable', which fails the row closed. */
async function decodeVerdict(buf: Buffer): Promise<Measured> {
  const m = await measureImage(buf)
  return { ...(m ?? {}), verdict: imageVerdict(m) }
}

/** Fetch + judge one source photo. Never uploads. */
async function judgePhoto(u: string): Promise<{ outcome: PhotoOutcome; body: Buffer | null; m: Measured | null }> {
  const got = await politeGet(u, 'image/*')
  if (got.status === 429) throw new Infeasible(`HTTP 429 at ${u} — rate limited; stopping`)
  if (got.status !== 200 || !got.body.length) return { outcome: 'fetchFailed', body: null, m: null }
  const m = await decodeVerdict(got.body)
  return { outcome: m.verdict, body: got.body, m }
}

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}

/**
 * ⛔ THE JOURNAL DIR IS PROVEN BEFORE ANYTHING ELSE RUNS: durable (not under a temp root the OS
 * clears) and writable with fsync. The first cut created it only after reading the stage and the
 * database, so a typo'd path surfaced after the work it was supposed to record had begun.
 */
function ensureJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.muaban-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok')
  unlinkSync(probe)
  return abs
}

// ─── DB ──────────────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE DRY RUN'S DATABASE SESSION IS READ-ONLY AT THE SERVER. `default_transaction_read_only=on`
 * is sent as a startup option, so even a bug that reached a write below would be refused by
 * Postgres, not merely skipped by an `if`.
 */
function openDb(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
}

const SELLER_SELECT = { id: true, name: true, ownerId: true, trustScore: true, avatarUrl: true, verified: true, verifiedSeller: true, officialPartner: true } as const

// ─── Retire pass ─────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ HIDES, NEVER DELETES, AND ONLY ON A POSITIVE SIGNAL. Every active row of this seller (oldest
 * first; `--limit` checks only the N oldest) has its own muaban page re-fetched. A 404/410, or the
 * page itself saying `is_expired` / `is_outdate` / unpublished, hides that row; anything else leaves
 * it alone. The whole check runs BEFORE any write, so a mass-404 (a site change, not churn) is
 * caught by massRetireRefusal and nothing is hidden.
 * ⚠️ ONE-WAY: `status` is create-only in the importer, so a hidden row is not re-listed by a later
 * run. The journal names every row hidden; the rollback line re-activates exactly those.
 */
async function retire(journalDir: string | null) {
  const db = openDb()
  try {
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: SELLER_SELECT })
    if (APPLY) { const why = sellerRefusal(seller); if (why) throw new Error(why) }
    if (!seller) { console.log(`seller ${SELLER_ID} does not exist — nothing to retire`); return }
    const rows = await db.listing.findMany({
      where: { sellerId: SELLER_ID, status: 'active' },
      select: { id: true, externalId: true, affiliateUrl: true },
      orderBy: { createdAt: 'asc' },
      ...(LIMIT ? { take: LIMIT } : {}),
    })
    const total = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
    console.log(`retire pass       checking ${rows.length} of ${total} active rows (oldest first), ≥${DELAY_MS} ms/host, UA "${UA}"`)

    const verdicts = new Map<Liveness, number>()
    const toHide: { id: string; externalId: string; why: string }[] = []
    let stopped: string | null = null
    try {
      for (const r of rows) {
        const sourceId = Number(String(r.externalId ?? '').replace(`${EXTERNAL_PREFIX}:`, ''))
        const url = Number.isSafeInteger(sourceId) ? affiliateUrlFor(sourceId, r.affiliateUrl) : null
        let v: { verdict: Liveness; why: string }
        if (!url) v = { verdict: 'unknown', why: 'affiliateUrl not pinned to this listing' }
        else {
          const got = await getPage(url)
          v = livenessVerdict(sourceId, got.status, got.data)
        }
        verdicts.set(v.verdict, (verdicts.get(v.verdict) ?? 0) + 1)
        if (v.verdict === 'gone' || v.verdict === 'inactive') toHide.push({ id: r.id, externalId: r.externalId!, why: v.why })
      }
    } catch (e) {
      if (!(e instanceof Infeasible)) throw e
      stopped = e.message
    }
    const answered = (verdicts.get('gone') ?? 0) + (verdicts.get('inactive') ?? 0) + (verdicts.get('alive') ?? 0)
    console.log(`verdicts          ${JSON.stringify(Object.fromEntries(verdicts))}${stopped ? `\n⛔ STOPPED         ${stopped}` : ''}`)
    console.log(`would hide        ${toHide.length}`)
    for (const h of toHide.slice(0, 40)) console.log(`  ${h.externalId.padEnd(18)} ${h.why.padEnd(12)} ${h.id}`)
    const mass = massRetireRefusal(toHide.length, answered)
    if (mass) console.log(`⛔ ${mass}`)

    if (!APPLY) { console.log('\nDRY RUN — nothing hidden. Re-run with --retire --journal <dir> --apply.'); return }
    if (mass && !A.forceMassRetire) throw new Error(mass)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `muaban-retired-rows-${stamp}.jsonl`)
    console.log(`retire journal    ${JOURNAL}`)
    const ROLLBACK = join(journalDir!, `muaban-retired-rows-${stamp}.rollback.sql`)
    const hiddenIds: string[] = []
    for (const h of toHide) {
      /** Journal first (fsync), then the conditional write — a crash in between leaves a journal
       *  line for a row that is still active, which the rollback's `status='hidden'` guard ignores. */
      recordDurably(JOURNAL, JSON.stringify({ ...h, at: new Date().toISOString() }))
      const res = await db.listing.updateMany({ where: { id: h.id, sellerId: SELLER_ID, status: 'active' }, data: { status: 'hidden' } })
      if (res.count) hiddenIds.push(h.id)
    }
    const sql = retireRollbackSql(hiddenIds)
    if (sql) recordDurably(ROLLBACK, sql)
    const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
    console.log(`\nhidden ${hiddenIds.length}   active now ${active}`)
    if (sql) console.log(`ROLLBACK (re-activates exactly the rows this pass hid): psql -v ON_ERROR_STOP=1 -f ${ROLLBACK}`)
  } finally {
    await db.$disconnect()
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const refused = modeRefusal(A)
  if (refused) throw new Error(refused)
  /** ⛔ BEFORE any crawl, stage read or DB connection. */
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null
  if (RETIRE) return retire(journalDir)

  const drops: Drops = {}
  let records: StagedRecord[]
  let crawlInfo: Awaited<ReturnType<typeof crawl>> | null = null
  if (SRC) {
    /** ⛔ Every line re-built through the allowlist; one malformed line refuses the file. */
    records = parseStage(readFileSync(SRC, 'utf8'))
    /** ⛔ A stale stage refuses the write, BEFORE the database or a single photo is touched. */
    if (APPLY) { const why = stageAgeRefusal(records); if (why) throw new Error(why) }
  } else {
    /** Truncated first: one stage file is one crawl, never two runs interleaved. */
    if (STAGE) { mkdirSync(dirname(resolve(STAGE)), { recursive: true }); writeFileSync(STAGE, '') }
    crawlInfo = await crawl(drops, (r) => { if (STAGE) appendFileSync(STAGE, JSON.stringify(r) + '\n') })
    records = crawlInfo.records
  }

  const rows: MappedRow[] = []
  for (const r of records) {
    const m = mapRecord(r.item, r.detail, { cities: CITY_KEYS, types: TYPES })
    if (m.ok) rows.push(m.row); else bump(drops, m.reason)
  }
  const batch = LIMIT ? rows.slice(0, LIMIT) : rows
  const stageAgeH = SRC ? oldestStageAgeHours(records) : 0

  const db = openDb()
  try {
    const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
    if (!category) throw new Error('no `rentals` category — cannot place these rows')
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: SELLER_SELECT })
    /** ⛔ Refused before a single photo is fetched or uploaded. */
    if (APPLY) { const why = sellerRefusal(seller); if (why) throw new Error(why) }
    const already = await db.listing.count({ where: { sellerId: SELLER_ID } })
    const existing = new Map(
      (await db.listing.findMany({
        where: { sellerId: SELLER_ID, externalId: { in: batch.map((r) => r.externalId) } },
        select: {
          externalId: true, status: true, title: true, titleVi: true, description: true, descriptionVi: true, price: true,
          priceUnit: true, currency: true, negotiable: true, listingType: true, subcategorySlug: true, location: true,
          district: true, city: true, lat: true, lng: true, areaM2: true, attributes: true, affiliateUrl: true, searchText: true,
        },
      })).map((r) => [r.externalId!, r]),
    )
    const plan = { create: 0, update: 0, unchanged: 0 }
    for (const r of batch) {
      const ex = existing.get(r.externalId)
      if (!ex) plan.create++
      else if (sameMutable(r.mutable, ex)) plan.unchanged++
      else plan.update++
    }

    const hist = (f: (r: MappedRow) => string) => Object.fromEntries(
      [...batch.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
    )
    const sellerLine = seller
      ? `${seller.name} (${seller.id}) owner=${seller.ownerId ?? 'none'} badges=${[seller.verified && 'verified', seller.verifiedSeller && 'verifiedSeller', seller.officialPartner && 'officialPartner'].filter(Boolean).join(',') || 'none'} avatar=${seller.avatarUrl ? 'set' : 'NONE'}`
      : `(will be created) { id: '${SELLER_ID}', name: '${SELLER_NAME}', verified:false, verifiedSeller:false, officialPartner:false, owner: none }`

    console.log(`source            ${SRC ? `stage ${SRC} (${records.length} records re-read through the allowlist, oldest ${Number.isFinite(stageAgeH) ? `${stageAgeH.toFixed(1)} h` : 'UNKNOWN'}; --apply needs ≤ ${MAX_STAGE_AGE_HOURS} h)` : 'live muaban.net'}`)
    if (crawlInfo) {
      const reqs = [...requestCount].map(([h, n]) => `${h} ${n}`).join(', ')
      console.log(`crawl             ${crawlInfo.pages} list pages (sort=1, newest first), requests: ${reqs}, delay ${DELAY_MS}ms/host, UA "${UA}"`)
      console.log(`robots.txt        checked per host this run: ${[...robotsCache.keys()].join(', ')}`)
      for (const c of crawlInfo.cities) {
        console.log(`  city ${c.city} kept ${c.kept}${Number.isFinite(c.cap) ? ` / cap ${c.cap}` : ''}${c.done ? ` — ${c.done}` : ''}`)
      }
      for (const s of crawlInfo.seeds) {
        console.log(`  seed ${s.city}/${PROPERTY_TYPES[s.type].key.padEnd(9)} pages ${s.page}${s.done ? `, stopped: ${s.done}` : `, ${s.buffer.length} cards unread`}`)
      }
      if (crawlInfo.stopped) console.log(`⛔ CRAWL STOPPED   ${crawlInfo.stopped}`)
    }
    console.log(`examined          ${records.length}`)
    console.log(`dropped           ${JSON.stringify(drops)}`)
    console.log(`TO IMPORT         ${batch.length}${LIMIT ? ` (--limit ${LIMIT} of ${rows.length})` : ''}  (before the photo check — see --probe-images)`)
    console.log(`  by city         ${JSON.stringify(hist((r) => r.mutable.city))}`)
    console.log(`  by district     ${JSON.stringify(hist((r) => `${r.cityKey}:${r.mutable.district}`))}`)
    console.log(`  by subcategory  ${JSON.stringify(hist((r) => r.mutable.subcategorySlug ?? '(null)'))}`)
    console.log(`  bedrooms attr   ${JSON.stringify(hist((r) => r.mutable.attributes ?? '(none)'))}`)
    console.log(`  priceUnit       ${JSON.stringify(hist((r) => r.mutable.priceUnit))}`)
    console.log(`  with coords     ${batch.filter((r) => r.mutable.lat !== null).length}   with area ${batch.filter((r) => r.mutable.areaM2 !== null).length}`)
    {
      /** What the create-only rank starts at: from muaban's own publish_at, never the import time. */
      const now = Date.now()
      const trustNow = seller?.trustScore ?? 100
      const ageH = batch.map((r) => (now - r.postedAt.getTime()) / 3_600_000).sort((a, b) => a - b)
      const ranks = batch.map((r) => createOnlyFields(r, trustNow, now).rankScore).sort((a, b) => a - b)
      const pct = (xs: number[], q: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : NaN
      const asImport = createOnlyFields({ postedAt: new Date(now) }, trustNow, now).rankScore
      console.log(`  postedAt age    ${ageH.length ? `min ${ageH[0].toFixed(1)} h, median ${pct(ageH, 0.5).toFixed(1)} h, max ${ageH[ageH.length - 1].toFixed(1)} h (muaban publish_at, clamped to now)` : 'n/a'}`)
      console.log(`  rankScore       ${ranks.length ? `${ranks[0].toFixed(4)}–${ranks[ranks.length - 1].toFixed(4)}, median ${pct(ranks, 0.5).toFixed(4)} (trust ${trustNow}; stamped "now" it would be ${asImport.toFixed(4)})` : 'n/a'}`)
      const createdAt = new Map(records.map((x) => [x.item.id, x.detail?.created_at]))
      const created = batch.map((r) => createdAt.get(r.sourceId))
        .map((c) => Date.parse(c ?? '')).filter((t) => Number.isFinite(t)).map((t) => (now - t) / 86_400_000).sort((a, b) => a - b)
      if (created.length) console.log(`  created_at age  median ${pct(created, 0.5).toFixed(1)} d, max ${created[created.length - 1].toFixed(1)} d on ${created.length} rows (NOT used: muaban's first-post date; publish_at moves on each re-publish)`)
    }
    console.log(`  photos to judge ${batch.reduce((n, r) => n + r.imageSources.length, 0)} (≤5/row; text cards refused; kept ones re-hosted clean under listings/affiliate/m/, never hotlinked)`)
    console.log(`plan              create ${plan.create}   update ${plan.update}   unchanged ${plan.unchanged} (skipped: no write, updatedAt untouched)`)
    console.log(`category          ${category.name} (${category.id})`)
    console.log(`seller            ${sellerLine}`)
    console.log(`seller refusal    ${sellerRefusal(seller) ?? 'none — writable'}`)
    console.log(`seller logo       ${SELLER_LOGO_URL}  (NOT applied here — set-partner-avatar.ts owns avatars; never --official)`)
    console.log(`rows on seller    ${already}`)
    console.log(`retire pass       separate: --retire (hides 404/410/expired rows only; never deletes)`)
    console.log(`mode              ${APPLY ? 'APPLY — UPLOADS PHOTOS + WRITES TO PRODUCTION' : 'DRY RUN (DB session read-only)'}`)

    /** How often the cheap card-cover → thumb-detail rewrite agrees with the detail page's own list. */
    const withBoth = records.filter((r) => r.detail?.images?.length && r.item.covers?.length)
    if (withBoth.length) {
      const agree = withBoth.filter((r) => r.item.covers!.map(coverToDetail).every((u, i) => r.detail!.images![i]?.url === u)).length
      console.log(`cover→detail swap agrees with the detail page on ${agree}/${withBoth.length} rows (what --list-only would rely on)`)
    }

    if (!APPLY) {
      if (PROBE_IMAGES) {
        /** EVERY photo of each would-be row: fetched, decoded, judged by galleryPlan — the same rule
         *  --apply uses — and never uploaded. Prints what --apply would actually create. */
        const verdicts: Record<string, number> = {}
        const outcome = { create: 0, noRealPhoto: 0, photoFailed: 0, coverReplaced: 0 }
        const lines: string[] = []
        const measures: { entropy: number; flat: number; v: string }[] = []
        try {
          for (const r of batch) {
            const got: { outcome: PhotoOutcome; m: Measured | null }[] = []
            for (const u of r.imageSources) {
              const j = await judgePhoto(u)
              got.push({ outcome: j.outcome, m: j.m })
              verdicts[j.outcome] = (verdicts[j.outcome] ?? 0) + 1
              if (j.m?.entropy !== undefined && j.m.flat !== undefined) measures.push({ entropy: j.m.entropy, flat: j.m.flat, v: j.outcome })
              if (j.outcome === 'fetchFailed' || j.outcome === 'undecodable') break
            }
            const p = galleryPlan(got.map((g) => g.outcome))
            const fate = p.failed ? 'SKIP (photo fetch/decode failed — retried next run)'
              : !p.keep.length ? 'SKIP (no real photo)'
                : p.keep[0] !== 0 ? `create, cover = photo ${p.keep[0] + 1} (earlier refused)` : 'create'
            if (p.failed) outcome.photoFailed++
            else if (!p.keep.length) outcome.noRealPhoto++
            else { outcome.create++; if (p.keep[0] !== 0) outcome.coverReplaced++ }
            lines.push(`  ${r.externalId.padEnd(16)} ${got.map((g) => `${g.outcome}${g.m?.entropy !== undefined ? `(e${g.m.entropy.toFixed(1)} f${g.m.flat?.toFixed(2)})` : ''}`).join(' ')}  → ${fate}`)
          }
        } catch (e) {
          if (!(e instanceof Infeasible)) throw e
          lines.push(`⛔ PROBE STOPPED ${e.message}`)
        }
        console.log(`\n── photo probe (every photo of ${batch.length} rows fetched and judged, 0 uploaded; placeholder = entropy < ${PLACEHOLDER_ENTROPY} or flat ≥ ${PLACEHOLDER_FLAT}) ── ${JSON.stringify(verdicts)}`)
        console.log(lines.join('\n'))
        const ok = measures.filter((x) => x.v === 'ok'), ph = measures.filter((x) => x.v === 'placeholder')
        const range = (xs: number[]) => xs.length ? `${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}` : 'n/a'
        console.log(`measured          ok: entropy ${range(ok.map((x) => x.entropy))}, flat ${range(ok.map((x) => x.flat))}   placeholder: entropy ${range(ph.map((x) => x.entropy))}, flat ${range(ph.map((x) => x.flat))}`)
        console.log(`AFTER PHOTO CHECK would create ${outcome.create} (cover replaced on ${outcome.coverReplaced}), skip ${outcome.noRealPhoto} with no real photo, skip ${outcome.photoFailed} on a failed fetch`)
        console.log(`requests          ${[...requestCount].map(([h, n]) => `${h} ${n}`).join(', ')} (incl. probe)`)
      }
      for (const r of batch.slice(0, 3)) {
        console.log(`\n── sample row, exactly as it would be stored (create) ──`)
        console.log(JSON.stringify({
          externalId: r.externalId, sellerId: SELLER_ID, categoryId: category.id, ...r.mutable,
          status: 'active', verified: true,
          ...(({ postedAt, rankScore }) => ({ postedAt: postedAt.toISOString(), rankScore: +rankScore.toFixed(4) }))(createOnlyFields(r, seller?.trustScore ?? 100)),
          images: `<the ok photos of these, re-hosted:>`, imageSources: r.imageSources,
        }, null, 2))
        console.log(`  ${vnd(r.mutable.price)}/tháng (${r.mutable.priceUnit}) · ${r.mutable.city} · ${r.mutable.district} · ${r.mutable.subcategorySlug ?? '(no subcategory)'} -> ${r.mutable.affiliateUrl}`)
      }
      console.log(`\nDRY RUN — nothing uploaded, nothing written.${STAGE ? ` Stage: ${STAGE} — review it, then --src ${STAGE} --journal <durable dir> --apply (within ${MAX_STAGE_AGE_HOURS} h).` : ''}`)
      return
    }

    // ─── APPLY ─────────────────────────────────────────────────────────────────────────────
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    /** ⚠️ SUPABASE_SECRET_KEY, not SUPABASE_SERVICE_ROLE_KEY (attach-batdongsan-photos.ts:50-57). */
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!SUPABASE_URL || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    if (/supabase\.co$/.test(new URL(SUPABASE_URL).hostname)) throw new Error(`refusing to upload to ${SUPABASE_URL} — retired project`)
    const storage = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } }).storage.from(BUCKET)
    const host = makeImageHost({ storage, storageUrl: SUPABASE_URL, bucket: BUCKET, edge: 1600, quality: 82, mark: 'overlay' })

    if (!seller) {
      await db.seller.create({ data: { id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false } })
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const UPLOADED = join(journalDir!, `muaban-uploaded-objects-${stamp}.txt`)
    const CREATED = join(journalDir!, `muaban-created-rows-${stamp}.jsonl`)
    console.log(`upload manifest   ${UPLOADED}\ncreated journal   ${CREATED}`)

    const trust = seller?.trustScore ?? 100
    const stat = { created: 0, updated: 0, unchanged: 0, noRealPhotos: 0, photoFailed: 0, uploadFailed: 0, errored: 0, coverReplaced: 0, imagesRefused: {} as Record<string, number> }
    let stopped: string | null = null
    for (const r of batch) {
      try {
        const ex = existing.get(r.externalId)
        if (ex && sameMutable(r.mutable, ex)) { stat.unchanged++; continue }
        const where = { sellerId_externalId: { sellerId: SELLER_ID, externalId: r.externalId } }
        const mutable = { ...r.mutable, sellerId: SELLER_ID, categoryId: category.id }
        if (ex) {
          /** ⚠️ images/status/verified/postedAt/rankScore are absent: a refresh never undoes moderation,
           *  photos or the source's date. */
          await db.listing.update({ where, data: mutable })
          stat.updated++
          continue
        }
        /**
         * ⛔ ALL-OR-NOTHING PER LISTING, BY THE SAME galleryPlan THE DRY RUN PRINTS. Every source photo
         * is fetched and judged first; a fetch or decode failure skips the whole row (re-tried next
         * run), a text card or tiny image is left out (so it can never be the cover), and only when
         * every KEPT photo uploaded is the row created.
         */
        const judged: { outcome: PhotoOutcome; body: Buffer | null }[] = []
        for (const u of r.imageSources) {
          const j = await judgePhoto(u)
          judged.push(j)
          if (j.outcome === 'fetchFailed' || j.outcome === 'undecodable') break
        }
        const p = galleryPlan(judged.map((j) => j.outcome))
        for (const [k, n] of Object.entries(p.refused)) stat.imagesRefused[k] = (stat.imagesRefused[k] ?? 0) + (n ?? 0)
        if (p.failed) { stat.photoFailed++; continue }
        if (!p.keep.length) { stat.noRealPhotos++; continue }
        if (p.keep[0] !== 0) stat.coverReplaced++
        const urls: string[] = []
        for (const i of p.keep) {
          const url = await host.fromBuffer(judged[i].body!, r.externalId.replace(/[^a-z0-9]/gi, '-'))
          if (!url) break
          recordDurably(UPLOADED, url)
          /** ⛔ The app draws the eno.vn mark only on this exact URL shape; a miss is a config fault. */
          if (!isOverlayImageUrl(url)) throw new Error(`hosted URL is not an overlay URL: ${url}`)
          urls.push(url)
        }
        if (urls.length !== p.keep.length) { stat.uploadFailed++; continue }
        const res = await db.listing.upsert({
          where,
          /** ⛔ status/verified/images/postedAt/rankScore CREATE-ONLY. `verified` is the PUBLICATION
           *  GATE. postedAt is muaban's own publish_at (never now), and rankScore is computed from it. */
          create: {
            ...mutable, externalId: r.externalId, status: 'active', verified: true, images: JSON.stringify(urls),
            ...createOnlyFields(r, trust),
          },
          update: mutable,
          select: { id: true, createdAt: true, updatedAt: true },
        })
        /** createdAt === updatedAt means this call created it; otherwise a concurrent run did, the
         *  update path ran, and this run's uploads are orphans (they are in the manifest). */
        if (res.createdAt.getTime() !== res.updatedAt.getTime()) { stat.updated++; continue }
        recordDurably(CREATED, JSON.stringify({ id: res.id, externalId: r.externalId }))
        stat.created++
        if (stat.created % 100 === 0) console.log(`  ${stat.created} created`)
      } catch (e) {
        if (e instanceof Infeasible) { stopped = e.message; break }
        if ((e as Error).message.startsWith('hosted URL is not an overlay URL')) throw e
        stat.errored++
        console.warn(`  ! ${r.externalId}: ${(e as Error).message.slice(0, 160)}`)
      }
    }
    const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
    console.log(`\n${JSON.stringify(stat)}   active now ${active}${stopped ? `\n⛔ STOPPED ${stopped} — re-run the same --apply to continue (created rows are skipped as unchanged)` : ''}`)
    console.log(`\nROLLBACK (safe, reversible — hides from every public surface):`)
    console.log(`  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${SELLER_ID}';`)
    console.log(`  -- only this run's rows: the ids in ${CREATED}`)
    console.log(`  -- never DELETE: Order is onDelete:Restrict and six relations Cascade.`)
    console.log(`  -- keep uploaded objects until the edge cache expires. Manifest: ${UPLOADED}`)
    console.log(`  -- priceUnit written: ${RENT_PRICE_UNIT}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
