/**
 * GoPlus (goplus.com.vn) → eno: every VACANT room of eno's rental partner, re-hosted, weekly.
 *
 * Owner, 2026-10-19: "remove all apartments and fetch all apartments from https://goplus.com.vn/ once a week for
 * availability they will become our strategic partner for property rental sector" · "create goplus account
 * contact@goplus.com.vn … users should message that account to ask for availability" · "import all available info about
 * apartments and display properly like managment fee electricity rate car access etc" · "also fetch videos" — and on
 * media, asked: "Copy everything" (photos AND videos into eno's own storage).
 *
 *   DRY (reads goplus.com.vn and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ./.env; set +a; npx tsx scripts/import-goplus.ts [--limit N | --ids <roomId,…>] [--no-probe]
 *   WRITE (journal first):
 *     … scripts/import-goplus.ts --journal-dir <durable dir> --identity-gate on|off --apply [--force] [--refresh-media]
 *         [--no-video] [--concurrency 4] [--max-photos 10] [--allow-no-isr]
 *     (--identity-gate is REQUIRED with --apply: production's IDENTITY_GATE_ENFORCED, stated — this machine cannot read it)
 *   UNDO one run's availability expiry (exactly the rows it expired, while nobody has touched them since):
 *     … scripts/import-goplus.ts --rollback <journal-dir>/goplus-expiry-<time>.json [--identity-gate on|off --apply]
 *
 * The mapping is src/lib/goplus-listing.ts (pure, unit-tested); this file is the I/O around it. scripts/apartments-weekly.sh
 * runs it once a week (gate unit `goplus`, 162 h) with --apply.
 *
 * ⛔ 1. A PARTNER'S OWN STOREFRONT, NOT AN IMPORT STOREFRONT. The rows go into the storefront that Handle `goplus` names
 * AND contact@goplus.com.vn owns (scripts/register-partner-seller.mjs goplus) — refused, before a single request is
 * made to storage, when either is missing or different (goplusSellerRefusal). They carry NO affiliateUrl, so a renter's
 * "Message" reaches the GoPlus account (POST /api/conversations refuses any row with one); an official partner shares
 * no phone number (set-official-partner.mjs goplus). GoPlus's own hotline, Zalo and email are in every API answer and
 * are never staged (goplus-listing.ts stageGoplusRoom).
 *
 * ⛔ 1b. THE SELLER IDENTITY GATE — GoPlus is an OWNED storefront, so unlike an ownerless import it is NOT outside the
 * gate (src/lib/compliance/public-state-writes.test.ts audits this file as GATED). Every CREATE and REVIVAL asks the
 * app's own pure rules (goplus-listing.ts goplusPublishGate → seller-publish-decision.ts, wired as publish-held.ts wires
 * them: the owner's Profile.createdAt for the grace window, then their identity_verifications). Refused → the room is
 * written HELD (verified false, identityHold true — never public), counted, and the run says so loudly with the next
 * step; releaseIdentityHolds publishes it the moment the GoPlus account verifies. NOT a failure (exit code unchanged).
 * After the loop the decision is taken again on a fresh read, and if the owner verified WHILE the run held rooms, they
 * are released at once (publish-held's post-park re-check: the app's release ran before those holds existed).
 * ⚠️ WHICH GATE: identityGateEnforced() of THIS process (NEXT_PUBLIC_ENO_EDITION=marketplace AND
 * IDENTITY_GATE_ENFORCED=1), or `--identity-gate on|off`. Production's switch lives in the deployed env, NOT in
 * ~/eno.vn/.env (release-identity-holds.ts and publish-held.ts say why that matters): the day production enforces it,
 * set both for this job too, or pass --identity-gate on — every run prints which it used.
 * ⛔ THE LICENCE AISLES, BY CONSTRUCTION AND BY GUARD: every publishing WHERE pins the GoPlus storefront AND
 * subcategory apartment-rental, and ANDs licenceClearedWhere / licenceClearedSql — no e-Visa or Legal & permits row
 * can be published through this file.
 *
 * ⛔ 2. THE READ IS WHOLE OR NOTHING IS WRITTEN. Every page of /api/public/apartments (200 a page — the server's cap) and
 * the building list are read first; the run refuses unless every page saw the same `total` and exactly that many
 * distinct rooms came back (goplusReadProblem) — read once more, then refused: the expiry below acts on what the read
 * did NOT see, so a short read would expire real rooms. Politeness: robots.txt read first (RFC 9309; a 5xx or an
 * unreachable one = disallow all), one honest User-Agent, at most --concurrency requests in flight and ≥ --gap-ms
 * between their starts, and a 429, a Cloudflare challenge or an HTML answer where JSON or media was expected STOPS the
 * run (exit 2) — never retried into. A timeout or a 5xx is retried twice, spaced.
 *
 * ⛔ 3. MEDIA ARE COPIED, CHECKED, AND STORED ONCE. Photos: each fetched and measured with the shared real-photo test
 * (import-photo-check.ts: text cards, logos, slivers; the same shot twice counts once); a room left with fewer than 3
 * real distinct photos (the rentals publish floor) is not created. Kept ones are stored CLEAN in the app-drawn overlay
 * folder (makeImageHost mark 'overlay', slug goplus-<hash of the source URL>) so the app draws the same eno.vn mark as on
 * every import (owner 2026-10-20 — GoPlus's own logo sits mid-photo, eno's in a corner); the first import's unmarked
 * copies under listings/partner/goplus/ are re-hosted once (goplusPhotoAction). Video: the first of a
 * room's clips that is an MP4/MOV ≤ 50 MB, ≤ 60 s, with a picture track (read from the file's own header — mp4Info),
 * stored in listing-videos under the minted name every listing video has, its tail the source's hash, so next week's run
 * knows it already holds it. Every object uploaded is listed (fsync) in the run's manifest before its row is written; a
 * video whose row was never written is reclaimed by the nightly video GC (unreferenced, 24 h).
 *
 * ⛔ 4. CREATE / REFRESH / REVIVE — NEVER A HUMAN'S DECISION UNDONE. GoPlus's feed owns a room's TEXT, PRICE and FACTS
 *    (an edit made in eno's editor is replaced by next week's feed — GoPlus edits on goplus.com.vn); a person's DECISIONS
 *    stand: a publish state (an Unverify, an identity hold), a hide, a removal, their own photos or video, a move to
 *    another aisle.
 *  · new room → created live (status 'active', verified = the publish gate), postedAt = GoPlus's own last change to the
 *    room, its rank computed from that date the create way (browseRankScore), availabilityConfirmedAt = now;
 *  · existing row → the refreshable fields (text, price, place, size, attributes, amenity tokens, search text) written
 *    ONLY WHEN ONE DIFFERS (a write bumps updatedAt, which orders the sitemap); postedAt moves forward only, with its rank;
 *    photos / video only when GoPlus changed them (goplusPhotoAction / goplusVideoAction) — and NEVER when the stored
 *    ones are not this importer's (GoPlus staff changed them in eno's editor: their edit stands);
 *  · an 'expired' row whose room is vacant again → REVIVED (back to 'active', its cached 404 tombstoned at once). Only
 *    'expired' — the status this importer gives — never a row a person hid, marked let/sold, or a moderator removed
 *    (a 'removed' tombstone is never touched at all: Law 122/2025, listing-removed.ts);
 *  · every row confirmed vacant has availabilityConfirmedAt set to now in RAW SQL (no updatedAt bump): the partner's
 *    feed IS the "still available" confirmation, and it keeps the storefront's trust freshness honest.
 *
 * ⛔ 5. THE AVAILABILITY EXPIRY — every LIVE GoPlus row whose room is not vacant in this read (let, gone, or no longer
 * publishable) → 'expired' (a 404, kept on users' saved lists, revived above when the room is vacant again). Refused —
 * the rows above still written, exit 3, so the job alerts and keeps no success stamp — when the vacant set is under 60%
 * of the live rows (from 100) or would take every live row (planGoplusExpiry); --force overrides, for an operator holding
 * independent evidence. Skipped on a --limit / --ids sample. Journal (each row's prior status and updatedAt, fsync)
 * BEFORE the write; the write is conditional on both and carries the page tombstones in the SAME statement
 * (rental-expiry.ts EXPIRE_WITH_TOMBSTONES_SQL); --rollback restores exactly those rows while nobody has touched them.
 * ⚠️ The daily age sweep (scripts/expire-rentals.ts) and expire-apartment-rentals.ts never touch these rows: they act
 * on ownerless import storefronts only — this expiry is the ONLY thing that takes a GoPlus room down.
 *
 * ⛔ 6. EVERY PAGE THIS RUN CHANGED IS TOMBSTONED (pdp-tombstone.ts, en/vi): revived ones at once, refreshed ones after
 * the loop (a PDP is ISR for 30 days — a renter must not read last week's rent), expired ones in their own statement.
 * --apply refuses before its first write when the database has no next_cache_tag table (--allow-no-isr on a scratch copy
 * only). Category, district and hub pages are not purged here (the first import: see NEXT at the end).
 *
 * EXIT CODES (--apply): 0 · 1 = some row failed on OUR side (an error, an upload, a tombstone) · 2 = a stop (429,
 * challenge, robots) ended it early · 3 = rows written, expiry REFUSED by its guard. The last line is `APPLY COMPLETED`
 * exactly when the row loop reached the end of the batch (row errors included) — never after a crash or a stop — so
 * the weekly job can tell a finished apply with row errors from one that died. A dry run: 0, or 1 when the read is not
 * whole or the storefront would be refused.
 */
import 'dotenv/config'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'
import { countDistinctAngles } from '../src/lib/image-hash-url'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { ImportScreen } from '../src/lib/import-screen'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { nhatotRobotsAllows } from '../src/lib/nhatot-listing'
import { nhatotSqlLit, nhatotTombstoneSql } from '../src/lib/nhatot-fresh'
import { browseRankScore } from '../src/lib/ranking-formula'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { EXPIRE_WITH_TOMBSTONES_SQL, expireStatementParams } from '../src/lib/rental-expiry'
import { EXPIRED_STATUS } from '../src/lib/apartment-freshness'
import { formatMoneyFull } from '../src/lib/vnd'
import { identityGateEnforced } from '../src/lib/compliance/account-state'
import type { VerificationRow } from '../src/lib/compliance/derive-verification'
import type { SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { licenceClearedSql, licenceClearedWhere } from '../src/lib/licence-stamp'
import {
  GOPLUS_CATEGORY_SLUG, GOPLUS_EMAIL, GOPLUS_HANDLE, GOPLUS_MAX_PHOTOS_DEFAULT, GOPLUS_SUBCAT, GOPLUS_MIN_PHOTOS, GOPLUS_PAGE_MAX, GOPLUS_PHOTO_FLOOR,
  GOPLUS_VACANT_STATUS, goplusExternalId, goplusPartialTokens, goplusOverlaySlug,
  GOPLUS_PROJECTS_API, GOPLUS_ROOMS_API, GOPLUS_UA, GOPLUS_UA_TOKEN, GOPLUS_VIDEO_MAX_BYTES,
  goplusApplyExitCode, goplusPhotoAction, goplusPhotoPlan, goplusPublishGate, goplusReadProblem, goplusSellerRefusal, goplusSourceKey,
  goplusVideoAction, goplusVideoObjectName, goplusVideoVerdict, mapGoplusRoom, mp4Info, planGoplusExpiry,
  stageGoplusProject, stageGoplusRoom,
  type GoplusMapped, type GoplusPhotoOutcome, type GoplusProject, type GoplusRoom, type GoplusSeller,
} from '../src/lib/goplus-listing'

// ─── arguments ──────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
/** ⛔ AN UNKNOWN FLAG IS AN ERROR — `--limt 30` silently meaning "no limit" is how a sample becomes a full write. */
const FLAGS = new Set(['--apply', '--force', '--refresh-media', '--no-video', '--allow-no-isr', '--no-probe'])
const VALUED = new Set(['--journal-dir', '--limit', '--ids', '--max-photos', '--concurrency', '--gap-ms', '--rollback', '--identity-gate'])
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) continue
  if (VALUED.has(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); i++; continue }
  throw new Error(`unknown argument "${a}"`)
}
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null }
const int = (k: string, d: number, lo: number, hi: number) => {
  const raw = str(k)
  if (raw === null) return d
  const v = Number(raw)
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${k} must be a whole number in ${lo}–${hi}, not "${raw}"`)
  return v
}
const APPLY = argv.includes('--apply')
const FORCE = argv.includes('--force')
const REFRESH_MEDIA = argv.includes('--refresh-media')
const NO_VIDEO = argv.includes('--no-video')
const ALLOW_NO_ISR = argv.includes('--allow-no-isr')
const NO_PROBE = argv.includes('--no-probe')
const JOURNAL_DIR_ARG = str('--journal-dir')
const ROLLBACK = str('--rollback')
const LIMIT = int('--limit', 0, 0, 100_000)
const IDS = (str('--ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
if (IDS.some((x) => !/^[a-f0-9]{24}$/.test(x))) throw new Error('--ids takes GoPlus room ids (24 hex), comma-separated')
if (LIMIT && IDS.length) throw new Error('--limit and --ids are two different samples — pass one')
const SAMPLE = LIMIT > 0 || IDS.length > 0
const MAX_PHOTOS = int('--max-photos', GOPLUS_MAX_PHOTOS_DEFAULT, GOPLUS_MIN_PHOTOS, 30)
/** Rows in flight — each fetches its photos one by one, so this is also the cap on requests in flight to GoPlus. */
const CONCURRENCY = int('--concurrency', 4, 1, 8)
/** ⛔ A floor, never "no delay": a request START is at least this far after the previous one, whatever the concurrency. */
const GAP_MS = int('--gap-ms', 150, 100, 10_000)
// A --rollback reads its own journal and writes no new one, so it is exempt (a reviewer's catch: the printed rollback
// command failed this check).
if (APPLY && !JOURNAL_DIR_ARG && !ROLLBACK) throw new Error('--apply needs --journal-dir <durable dir> (upload manifest, created/revived rows, the expiry journal)')
if (ALLOW_NO_ISR && !APPLY) throw new Error('--allow-no-isr only means something with --apply (on a scratch copy)')
if (FORCE && !APPLY) throw new Error('--force overrides the expiry guard of an --apply run; a dry run prints the refusal instead')
const GATE_ARG = str('--identity-gate')
if (GATE_ARG !== null && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error(`--identity-gate must be on or off, not "${GATE_ARG}"`)
/** The seller identity gate this run applies (header ⛔ 1b): the explicit flag, else THIS process's own switch. */
/**
 * ⛔ AN --apply MUST SAY WHICH WAY PRODUCTION'S IDENTITY GATE IS SET (a reviewer's catch, 2026-10-19). Production's switch
 * (IDENTITY_GATE_ENFORCED) lives in the BOX's env, not in the Mac's ~/eno.vn/.env this job reads — inferring it here
 * would read "off" the day production turns it on and publish every room of an unverified account. So a write states
 * it (`--identity-gate on|off`; the weekly job passes GOPLUS_IDENTITY_GATE), and a dry run may infer it.
 */
if (APPLY && GATE_ARG === null) throw new Error('--apply needs --identity-gate on|off — production\'s IDENTITY_GATE_ENFORCED, stated (this machine cannot read it)')
const GATE_ENFORCED = GATE_ARG !== null ? GATE_ARG === 'on' : identityGateEnforced()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

// ─── journal ────────────────────────────────────────────────────────────────────────────────────
function fsyncDir(dir: string) { const fd = openSync(dir, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }
/** Append + fsync, and the directory too the first time a file appears — a kill cannot lose the record. */
function recordDurably(file: string, line: string) {
  const isNew = !existsSync(file)
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  if (isNew) fsyncDir(dirname(resolve(file)))
}
/** ⛔ CALLED FIRST on --apply: before the network, the DB or storage. A durable dir (not /tmp), created and write-tested. */
function prepareJournalDir(): string {
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()].flatMap((p) => { try { return [p, realpathSync(p)] } catch { return [p] } })
  const abs = resolve(JOURNAL_DIR_ARG!)
  const early = journalDirProblem(abs, roots)
  if (early) throw new Error(early)
  mkdirSync(abs, { recursive: true })
  const real = realpathSync(abs)
  const late = journalDirProblem(real, roots)   // a symlink into /tmp is still /tmp
  if (late) throw new Error(late)
  if (!statSync(real).isDirectory()) throw new Error(`--journal-dir ${real} is not a directory`)
  const probe = join(real, `.goplus-write-test-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return real
}

// ─── politeness: robots.txt, spacing, stops ─────────────────────────────────────────────────────
class StopRead extends Error {}
let halted: string | null = null
let requests = 0
let nextStart = 0
let inFlight = 0
const waiters: (() => void)[] = []
async function acquire() {
  // ⚠️ A woken waiter is HANDED the releasing caller's slot (release() does not free it), so no other caller can take
  // it in between and push the requests in flight past --concurrency (a reviewer's catch).
  if (inFlight >= CONCURRENCY) await new Promise<void>((r) => waiters.push(r))
  else inFlight++
  const now = Date.now(), at = Math.max(now, nextStart)
  nextStart = at + GAP_MS
  if (at > now) await sleep(at - now)
}
function release() { const next = waiters.shift(); if (next) next(); else inFlight-- }

let robotsTxt: string | null | undefined
/** RFC 9309, read once: a 4xx is no rules; a 5xx, an unreachable host, a challenge or an HTML answer = disallow all. */
async function robotsAllow(path: string): Promise<void> {
  if (robotsTxt === undefined) {
    let res: Response
    try {
      res = await fetch(`https://goplus.com.vn/robots.txt`, { headers: { 'user-agent': GOPLUS_UA, accept: 'text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    } catch (e) { throw new StopRead(`robots.txt unreachable (${(e as Error).message}) — RFC 9309: assume disallow-all`) }
    requests++
    // A redirect may move the scheme or path, never the host: another host's rules are not GoPlus's (a reviewer's catch).
    if (new URL(res.url).host !== 'goplus.com.vn') throw new StopRead(`robots.txt redirected to ${new URL(res.url).host} — RFC 9309: assume disallow-all`)
    const type = res.headers.get('content-type') ?? ''
    if (res.status === 429 || res.headers.get('cf-mitigated')) throw new StopRead(`robots.txt answered ${res.status}${res.headers.get('cf-mitigated') ? ' behind a challenge' : ''} — not crawling`)
    if (res.status >= 500) throw new StopRead(`robots.txt HTTP ${res.status} — RFC 9309: assume disallow-all`)
    if (res.status >= 400) { await res.arrayBuffer().catch(() => null); robotsTxt = null }
    else if (/text\/html/i.test(type)) throw new StopRead(`robots.txt answered HTML (${type}) — cannot read the rules, not crawling`)
    else robotsTxt = await res.text()
  }
  if (robotsTxt !== null && !nhatotRobotsAllows(robotsTxt, GOPLUS_UA_TOKEN, path)) throw new StopRead(`goplus.com.vn/robots.txt disallows ${path} for ${GOPLUS_UA_TOKEN} — honouring it`)
}

type Got = { kind: 'ok'; status: number; type: string; body: Buffer } | { kind: 'gone'; status: number } | { kind: 'tooBig'; bytes: number } | { kind: 'failed'; why: string }
/**
 * One GET to goplus.com.vn, body read whole (at most `maxBytes`). A 429, a challenge, or HTML where `want` (json /
 * image / video) was expected HALTS the host for the rest of the run (StopRead). 404/410 = gone. A timeout, a network
 * failure or a 5xx is retried twice (2 s, then 6 s later).
 */
async function goplusGet(url: string, want: 'json' | 'image' | 'video', maxBytes: number): Promise<Got> {
  const u = new URL(url)
  if (u.hostname !== 'goplus.com.vn' || u.protocol !== 'https:') return { kind: 'failed', why: `not goplus.com.vn: ${u.host}` }
  await robotsAllow(u.pathname + u.search)
  let why = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (halted) throw new StopRead(`goplus.com.vn answered ${halted} earlier this run — not requesting it again`)
    if (attempt) await sleep(attempt === 1 ? 2000 : 6000)
    await acquire()
    try {
      // …and again once a slot is ours: a request queued behind the one that met the 429 must not go out after it.
      if (halted) throw new StopRead(`goplus.com.vn answered ${halted} earlier this run — not requesting it again`)
      requests++
      const res = await fetch(url, {
        headers: { 'user-agent': GOPLUS_UA, accept: want === 'json' ? 'application/json' : `${want}/*` },
        redirect: 'error', signal: AbortSignal.timeout(want === 'video' ? 120_000 : 30_000),
      })
      const type = res.headers.get('content-type') ?? ''
      if (res.status === 429) { halted = 'HTTP 429'; await res.arrayBuffer().catch(() => null); throw new StopRead('goplus.com.vn: HTTP 429 — rate limited; stopping, not retrying') }
      const cf = res.headers.get('cf-mitigated')
      if (cf) { halted = `a challenge (cf-mitigated=${cf})`; await res.arrayBuffer().catch(() => null); throw new StopRead(`goplus.com.vn: HTTP ${res.status} cf-mitigated=${cf} — a challenge; not worked around, stopping`) }
      if (res.status === 404 || res.status === 410) { await res.arrayBuffer().catch(() => null); return { kind: 'gone', status: res.status } }
      if (res.status >= 500) { why = `HTTP ${res.status}`; await res.arrayBuffer().catch(() => null); continue }
      if (!res.ok) { await res.arrayBuffer().catch(() => null); return { kind: 'failed', why: `HTTP ${res.status}` } }
      // An HTML page where the API's JSON was expected is a changed site or a block: stop. Where a PHOTO or VIDEO was
      // expected it is that one file missing (a site's app shell answers 200 for a dead link) — it counts against that
      // file alone; stopping the run on it would stop every week on one dead link (a reviewer's catch, 2026-10-19).
      if (/text\/html/i.test(type)) {
        await res.arrayBuffer().catch(() => null)
        if (want !== 'json') return { kind: 'gone', status: res.status }
        halted = 'an HTML page'
        throw new StopRead(`goplus.com.vn answered an HTML page for ${u.pathname} (expected ${want}) — stopping`)
      }
      const declared = Number(res.headers.get('content-length') ?? NaN)
      if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel().catch(() => null); return { kind: 'tooBig', bytes: declared } }
      // ⚠️ STREAMED, AND CUT AT maxBytes (a reviewer's catch): a body with no (or a lying) Content-Length must not be
      // buffered whole before the cap is checked — the weekly job would die on memory.
      const chunks: Buffer[] = []
      let got = 0
      const reader = res.body?.getReader()
      if (!reader) return { kind: 'failed', why: 'no body' }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        got += value.byteLength
        if (got > maxBytes) { await reader.cancel().catch(() => null); return { kind: 'tooBig', bytes: got } }
        chunks.push(Buffer.from(value))
      }
      const body = Buffer.concat(chunks)
      return { kind: 'ok', status: res.status, type, body }
    } catch (e) {
      if (e instanceof StopRead) throw e
      why = (e as Error).name === 'TimeoutError' ? 'timeout' : `network (${(e as Error).message.slice(0, 80)})`
    } finally {
      release()
    }
  }
  return { kind: 'failed', why }
}
/** A ranged GET of one byte: the object's size from Content-Range, for the dry run's storage estimate. */
async function probeSize(url: string): Promise<number | null> {
  // goplus.com.vn only, never a redirect (`redirect: 'error'` below): a feed URL can never point this machine elsewhere.
  if (new URL(url).host !== 'goplus.com.vn') return null
  await robotsAllow(new URL(url).pathname)
  await acquire()
  try {
    requests++
    const res = await fetch(url, { headers: { 'user-agent': GOPLUS_UA, range: 'bytes=0-0' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    await res.arrayBuffer().catch(() => null)
    if (res.status === 429 || res.headers.get('cf-mitigated')) { halted = `HTTP ${res.status}`; throw new StopRead(`goplus.com.vn: HTTP ${res.status} on a size probe — stopping`) }
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]
    if (total) return Number(total)
    const len = Number(res.headers.get('content-length') ?? NaN)
    return res.status === 200 && Number.isFinite(len) ? len : null
  } catch (e) {
    if (e instanceof StopRead) throw e
    return null
  } finally { release() }
}

// ─── the read ───────────────────────────────────────────────────────────────────────────────────
type Read = { rooms: GoplusRoom[]; projects: Map<string, GoplusProject>; total: number; pages: number; fetchedAt: string; problem: string | null; unstageable: number }
async function json(url: string): Promise<Record<string, unknown>> {
  const got = await goplusGet(url, 'json', 50 * 1024 * 1024)
  if (got.kind !== 'ok') throw new StopRead(`${url}: ${got.kind === 'failed' ? got.why : got.kind === 'gone' ? `HTTP ${got.status}` : 'too big'} — the catalogue could not be read`)
  let body: unknown
  try { body = JSON.parse(got.body.toString('utf8')) } catch { throw new StopRead(`${url}: not JSON — the API changed shape; stopping`) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new StopRead(`${url}: not a JSON object — the API changed shape; stopping`)
  return body as Record<string, unknown>
}
async function readOnce(): Promise<Read> {
  const fetchedAt = new Date().toISOString()
  const projBody = await json(GOPLUS_PROJECTS_API)
  if (!Array.isArray(projBody.data)) throw new StopRead('/api/public/projects: no `data` array — the API changed shape; stopping')
  const projects = new Map<string, GoplusProject>()
  for (const p of projBody.data) { const s = stageGoplusProject(p); if (s) projects.set(s.projectId, s) }
  const rooms = new Map<string, GoplusRoom>()
  /**
   * ⚠️ THE COMPLETENESS CHECK COUNTS WHAT THE SERVER SENT, NOT WHAT STAGING KEPT (a reviewer's catch, 2026-10-19): one room
   * GoPlus publishes in a shape staging refuses would otherwise make every read "short" and refuse every week — and the
   * rooms GoPlus has let would stay live on eno meanwhile. Refused rows are counted apart (`unstageable`) and reported.
   */
  const rawIds = new Set<string>()
  const totals: number[] = []
  let pages = 0, lastPageSize = 0
  for (let page = 1; ; page++) {
    const body = await json(`${GOPLUS_ROOMS_API}?page=${page}&limit=${GOPLUS_PAGE_MAX}`)
    if (!Array.isArray(body.data) || typeof body.total !== 'number') throw new StopRead(`/api/public/apartments page ${page}: no \`data\` array or \`total\` — the API changed shape; stopping`)
    pages++
    totals.push(body.total)
    lastPageSize = body.data.length
    for (const raw of body.data) {
      const id = raw && typeof raw === 'object' ? (raw as { id?: unknown; _id?: unknown }).id ?? (raw as { _id?: unknown })._id : null
      if (typeof id === 'string' && id) rawIds.add(id)
      const r = stageGoplusRoom(raw)
      if (r) rooms.set(r.id, r)
    }
    /** The end: a short page, or every room the server counts — bounded, so a server that never ends cannot loop us. */
    if (lastPageSize < GOPLUS_PAGE_MAX || rawIds.size >= body.total || page >= Math.ceil(body.total / GOPLUS_PAGE_MAX) + 2) break
  }
  /**
   * The building list must cover the rooms too (a reviewer's catch): it is one unpaged answer, and a truncated one would
   * drop its rooms as 'noProject' — and the expiry would then take them down. More than 1% (and 10) of the rooms naming a
   * building the list lacks is a read that is not whole.
   */
  const orphans = [...rooms.values()].filter((r) => r.projectId && !projects.has(r.projectId)).length
  const problem = goplusReadProblem({ totals, collected: rawIds.size, pages, lastPageSize })
    ?? (orphans > Math.max(10, 0.01 * rooms.size) ? `${orphans} rooms name a building the building list lacks — the list came back short` : null)
  return { rooms: [...rooms.values()], projects, total: totals[0] ?? 0, pages, fetchedAt, problem, unstageable: rawIds.size - rooms.size }
}
/**
 * THE BUILDINGS' FULL AMENITY LISTS (field QA, 2026-10-20): the list endpoint carries a 4-key preview (`feats`); the full
 * `amenityKeys` — GoPlus's "Tiện ích chung của toà", shown on every room's page — is only in /api/public/projects/<id>.
 * Read for every building with a VACANT room in `scope`, through the same robots-checked, spaced, capped requests
 * (~800 a week). A 429 or a challenge STOPS the run like any read; a building whose detail fails otherwise keeps the
 * list's preview, marked partial (amenitiesComplete false) — its existing rows then keep their stored amenities.
 */
async function readBuildingDetails(projects: Map<string, GoplusProject>, scope: readonly GoplusRoom[]): Promise<{ read: number; failed: number }> {
  const ids = [...new Set(scope.filter((r) => r.statusId === GOPLUS_VACANT_STATUS && r.projectId && projects.has(r.projectId)).map((r) => r.projectId!))]
  let read = 0, failed = 0
  await Promise.all(ids.map(async (id) => {
    const got = await goplusGet(`${GOPLUS_PROJECTS_API}/${encodeURIComponent(id)}`, 'json', 5 * 1024 * 1024)
    let staged: GoplusProject | null = null
    if (got.kind === 'ok') {
      try {
        const body = JSON.parse(got.body.toString('utf8')) as Record<string, unknown>
        staged = stageGoplusProject(body && typeof body === 'object' && 'data' in body ? body.data : body)
      } catch { staged = null }
    }
    const listed = projects.get(id)!
    if (!staged || staged.projectId !== id || !staged.amenitiesComplete) { failed++; return }
    read++
    // Place facts stay the list's when the detail lacks one; the amenity list and room count are the detail's.
    projects.set(id, { ...listed, district: staged.district ?? listed.district, ward: staged.ward ?? listed.ward, street: staged.street ?? listed.street, geo: staged.geo ?? listed.geo, amenityKeys: staged.amenityKeys, amenitiesComplete: true, roomCount: staged.roomCount ?? listed.roomCount })
  }))
  return { read, failed }
}

/** ⛔ Read once more when pages shifted (a room let or added mid-read), then refuse — never write from a short read. */
async function readCatalogue(): Promise<Read> {
  const first = await readOnce()
  if (!first.problem) return first
  console.log(`⚠️ read not whole (${first.problem}) — reading once more`)
  await sleep(10_000)
  return readOnce()
}

// ─── the database ───────────────────────────────────────────────────────────────────────────────
function openDb(write: boolean) {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ./.env; set +a` first')
  /** ⛔ A DRY RUN IS READ-ONLY AT THE DATABASE: every transaction it opens is read-only, so a bug that reaches a write fails. */
  return new PrismaClient({ adapter: new PrismaPg(write ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
}
type Db = ReturnType<typeof openDb>
async function resolveSeller(db: Db): Promise<GoplusSeller | null> {
  const h = await db.handle.findUnique({ where: { handle: GOPLUS_HANDLE }, select: { sellerId: true } })
  if (!h?.sellerId) return null
  const s = await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, name: true, ownerId: true, officialPartner: true, trustScore: true, owner: { select: { email: true } } } })
  return s ? { id: s.id, name: s.name, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
}
/**
 * The identity gate's verdict for the GoPlus storefront, NOW (header ⛔ 1b): the owner's account age, then — only while
 * the gate is on — their identity_verifications rows, through the pure rules. Read again after the loop on a fresh clock.
 */
async function gateDecision(db: Db, seller: GoplusSeller): Promise<SellerPublishDecision> {
  if (!seller.ownerId) return goplusPublishGate({ enforced: GATE_ENFORCED, ownerId: null, accountCreatedAt: null, now: new Date() }, () => [])
  const profile = await db.profile.findUnique({ where: { id: seller.ownerId }, select: { createdAt: true } })
  const rows = GATE_ENFORCED
    ? await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
        FROM identity_verifications WHERE "profileId" = ${seller.ownerId}::uuid ORDER BY "submittedAt" DESC`
    : []
  return goplusPublishGate({ enforced: GATE_ENFORCED, ownerId: seller.ownerId, accountCreatedAt: profile?.createdAt ?? null, now: new Date() }, () => rows)
}
const gateLine = (d: SellerPublishDecision) => `${GATE_ENFORCED ? 'ON' : 'off'} (${GATE_ARG !== null ? `--identity-gate ${GATE_ARG}` : 'this process\'s identityGateEnforced()'}) → ${d.ok ? 'creates and revivals PUBLISH' : `REFUSED (${d.code}) — creates and revivals are written HELD (identityHold), never public`}`

const EXISTING_SELECT = {
  id: true, externalId: true, status: true, postedAt: true, rankScore: true, images: true, video: true,
  title: true, titleVi: true, description: true, descriptionVi: true, price: true, priceUnit: true, currency: true,
  negotiable: true, listingType: true, categoryId: true, subcategorySlug: true, location: true, district: true, city: true,
  lat: true, lng: true, areaM2: true, attributes: true, facetTokens: true, searchText: true, verified: true, identityHold: true,
  updatedAt: true,
} as const
type Existing = { id: string; externalId: string | null; status: string; postedAt: Date; rankScore: number; images: string; video: string | null; verified: boolean; identityHold: boolean; updatedAt: Date } & Record<(typeof MUTABLE_KEYS)[number], unknown>
/** The refreshable fields, compared before a write — an unchanged row is never written (updatedAt orders the sitemap). */
const MUTABLE_KEYS = [
  'title', 'titleVi', 'description', 'descriptionVi', 'price', 'priceUnit', 'currency', 'negotiable', 'listingType',
  'categoryId', 'subcategorySlug', 'location', 'district', 'city', 'lat', 'lng', 'areaM2', 'attributes', 'facetTokens', 'searchText',
] as const
const isrTagTablePresent = async (db: Db) => !!(await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`)[0].t
async function tombstoneNow(db: Db, ids: readonly string[]): Promise<boolean> {
  try { for (let i = 0; i < ids.length; i += 500) await tombstonePdps(db, ids.slice(i, i + 500)); return true } catch (e) {
    console.warn(`  ! ISR tombstone for ${ids.length} page(s) failed: ${(e as Error).message.slice(0, 160)}`)
    return false
  }
}
const parseImages = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] } }

// ─── the expiry journal and its rollback (scripts/expire-rentals.ts's exact-rollback pattern) ──────
type ExpiryJournal = { kind: 'goplus-expiry'; sellerId: string; createdAt: string; stamp: string; rows: { id: string; externalId: string | null; priorStatus: string; updatedAt: string }[] }
async function rollback(path: string) {
  const j = JSON.parse(readFileSync(path, 'utf8')) as ExpiryJournal
  if (j.kind !== 'goplus-expiry' || !Array.isArray(j.rows) || !j.stamp) throw new Error(`${path} is not a GoPlus expiry journal`)
  const bad = j.rows.find((r) => !/^c[a-z0-9]{20,30}$/.test(r.id) || r.priorStatus !== 'active' || !r.updatedAt)
  if (bad || new Set(j.rows.map((r) => r.id)).size !== j.rows.length) throw new Error(`${path}: a malformed or duplicate journal row — refusing`)
  const db = openDb(APPLY)
  try {
    /**
     * ⛔ A ROLLBACK REPUBLISHES, SO IT ASKS THE IDENTITY GATE FIRST (a reviewer's catch, 2026-10-19): if GoPlus's verification
     * lapsed since the expiry, putting its rooms back live would publish what the gate now refuses — refused instead.
     */
    const seller = await resolveSeller(db)
    if (!seller || seller.id !== j.sellerId) throw new Error(`the journal's storefront ${j.sellerId} is not the "${GOPLUS_HANDLE}" storefront now — refusing`)
    const decision = await gateDecision(db, seller)
    if (!decision.ok) throw new Error(`the identity gate refuses GoPlus's account now (${decision.code}) — a rollback would republish what it refuses; refusing`)
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — rollback of ${j.rows.length} GoPlus rows expired at ${j.stamp}`)
    let restorable = 0
    const restored: string[] = []
    for (let i = 0; i < j.rows.length; i += 500) {
      const part = j.rows.slice(i, i + 500)
      const args = [part.map((x) => x.id), part.map((x) => x.priorStatus), part.map((x) => x.updatedAt), EXPIRED_STATUS, j.stamp, j.sellerId] as const
      // ⛔ The GoPlus storefront and its apartment aisle, pinned — and the licence guard — so a row someone moved into
      // another aisle since cannot come back through this undo.
      const where = `l.id = j.id AND l.status = $4 AND l."updatedAt" = $5::timestamp AND l."sellerId" = $6 AND l."subcategorySlug" = '${GOPLUS_SUBCAT}' AND ${licenceClearedSql('l.')}`
      restorable += (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "Listing" l, unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) WHERE ${where}`, ...args))[0].n
      if (APPLY) {
        const back = (await db.$queryRawUnsafe<{ id: string }[]>(`UPDATE "Listing" l SET status = j.prior, "updatedAt" = j.upd::timestamp, "verificationNotes" = CASE WHEN l.verified THEN NULL ELSE l."verificationNotes" END FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) WHERE ${where} RETURNING l.id`, ...args)).map((x) => x.id)
        restored.push(...back)
        if (back.length && !(await tombstoneNow(db, back))) process.exitCode = 1
      }
    }
    console.log(`  ${restorable} still exactly as the expiry left them → restorable · ${j.rows.length - restorable} changed since → LEFT ALONE`)
    if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); return }
    console.log(`RESTORED ${restored.length} (their pages tombstoned).`)
  } finally { await db.$disconnect() }
}

// ─── media ──────────────────────────────────────────────────────────────────────────────────────
type Stat = Record<string, number> & { errored: number; uploadFailed: number }
const stat: Stat = {
  created: 0, createdHeld: 0, refreshed: 0, unchanged: 0, revived: 0, revivedHeld: 0, released: 0, reposted: 0, raced: 0, errored: 0, uploadFailed: 0, removedLeftAlone: 0,
  photoFailed: 0, tooFewRealPhotos: 0, photosUploaded: 0, photosRehosted: 0, photosKeptOld: 0, photosHuman: 0, duplicatePhotos: 0,
  videosUploaded: 0, videosCleared: 0, videosHuman: 0, videoFailed: 0, bytesPhotos: 0, bytesVideos: 0,
}
const bump = (k: string, n = 1) => { stat[k] = (stat[k] ?? 0) + n }

type Hosted = { decision: 'create'; urls: string[] } | { decision: 'photoFailed' | 'tooFewRealPhotos' | 'uploadFailed' }
type Ctx = {
  host: ReturnType<typeof makeImageHost>
  videos: { upload(path: string, body: Buffer, o: { contentType: string; upsert: boolean; cacheControl: string }): Promise<{ error: unknown }> }
  storageUrl: string
  manifest: string
}
/**
 * Judge the candidate photos IN GoPLUS'S ORDER, then store the kept ones — goplusPhotoPlan is the rule. The candidates
 * are up to twice --max-photos (mapGoplusRoom); judging stops once MAX_PHOTOS + 2 real ones are in hand (two spare for
 * near-duplicates), and the plan keeps the first MAX_PHOTOS — a few placeholders up front no longer cost a room.
 */
async function hostPhotos(ctx: Ctx, r: GoplusMapped): Promise<Hosted> {
  const judged: { outcome: GoplusPhotoOutcome; hash: string | null; body: Buffer | null; src: string }[] = []
  for (const src of r.images) {
    if (judged.filter((j) => j.outcome === 'ok').length >= MAX_PHOTOS + 2) break
    const got = await goplusGet(src, 'image', 25 * 1024 * 1024)
    if (got.kind === 'gone') { judged.push({ outcome: 'gone', hash: null, body: null, src }); continue }
    if (got.kind === 'failed') { judged.push({ outcome: 'fetchFailed', hash: null, body: null, src }); break }
    if (got.kind === 'tooBig' || !/^image\//.test(got.type)) { judged.push({ outcome: 'undecodable', hash: null, body: null, src }); continue }
    const m = await measureImage(got.body)
    judged.push({ outcome: imageVerdict(m, GOPLUS_PHOTO_FLOOR), hash: m?.hash ?? null, body: got.body, src })
  }
  const plan = goplusPhotoPlan(judged, GOPLUS_MIN_PHOTOS, MAX_PHOTOS)
  bump('duplicatePhotos', plan.duplicates)
  for (const [k, n] of Object.entries(plan.refused)) bump(`photoRefused_${k}`, n ?? 0)
  if (plan.decision !== 'create') return { decision: plan.decision }
  const urls: string[] = []
  for (const i of plan.keep) {
    let url: string | null = null
    for (let attempt = 0; attempt < 3 && !url; attempt++) {
      if (attempt) await sleep(2000 * attempt)
      url = await ctx.host.fromBuffer(judged[i].body!, goplusOverlaySlug(goplusSourceKey(judged[i].src)))
    }
    if (!url) return { decision: 'uploadFailed' }
    /** Listed BEFORE its row is written, so an object a later failure orphans is on the cleanup list. */
    recordDurably(ctx.manifest, url)
    urls.push(url)
    bump('bytesPhotos', judged[i].body!.length)
  }
  /** The publish gate's own count, on the dHash each stored URL carries — the last word. */
  if (countDistinctAngles(urls) < GOPLUS_MIN_PHOTOS) return { decision: 'tooFewRealPhotos' }
  return { decision: 'create', urls }
}
/** The first of the room's clips that passes the listing-video rules, stored; null when none does (or there is none). */
async function hostVideo(ctx: Ctx, r: GoplusMapped): Promise<{ url: string | null; failed: boolean }> {
  for (const src of r.videos) {
    const got = await goplusGet(src, 'video', GOPLUS_VIDEO_MAX_BYTES)
    if (got.kind === 'gone') { bump('videoRefused_gone'); continue }
    if (got.kind === 'tooBig') { bump('videoRefused_tooBig'); continue }
    if (got.kind === 'failed') { bump('videoFailed'); return { url: null, failed: true } }
    const verdict = goplusVideoVerdict(got.body.length, mp4Info(got.body))
    if (verdict !== 'ok') { bump(`videoRefused_${verdict}`); continue }
    const name = goplusVideoObjectName(src, Date.now())
    const contentType = name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt) await sleep(3000 * attempt)
      const { error } = await ctx.videos.upload(name, got.body, { contentType, upsert: false, cacheControl: '31536000' })
      ok = !error
    }
    if (!ok) { stat.uploadFailed++; return { url: null, failed: true } }
    const url = `${ctx.storageUrl}/storage/v1/object/public/listing-videos/${name}`
    recordDurably(ctx.manifest, url)
    bump('videosUploaded'); bump('bytesVideos', got.body.length)
    return { url, failed: false }
  }
  return { url: null, failed: false }
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (ROLLBACK) return rollback(ROLLBACK)
  /** ⛔ FIRST, before the network, the DB or storage. */
  const journal = APPLY ? prepareJournalDir() : null
  const started = Date.now()

  const read = await readCatalogue()
  console.log(`source            ${GOPLUS_ROOMS_API} — ${read.total} rooms in ${read.pages} pages, ${read.projects.size} buildings; read ${read.fetchedAt}; UA "${GOPLUS_UA}"`)
  if (read.unstageable) console.log(`  ⚠️ ${read.unstageable} room(s) in a shape staging refuses — not imported (a live one expires like any room not vacant-and-publishable)`)
  console.log(`robots.txt        ${robotsTxt === null ? 'none (4xx) — no rules' : `read, ${robotsTxt?.length ?? 0} bytes — /api/public and /images allowed for ${GOPLUS_UA_TOKEN}`}`)
  if (read.problem) {
    console.error(`⛔ READ NOT WHOLE: ${read.problem} — nothing is written from a short read`)
    process.exitCode = 1
    return
  }

  const db = openDb(APPLY)
  try {
    const seller = await resolveSeller(db)
    const refusal = goplusSellerRefusal(seller)
    /** The identity gate's verdict (header ⛔ 1b) — on the storefront as read; none to ask before it is registered. */
    let gate: SellerPublishDecision = seller ? await gateDecision(db, seller) : { ok: true }
    /**
     * ⚠️ RE-ASKED DURING THE RUN (a reviewer's catch, 2026-10-19): an apply can take hours, and a verification that lapses
     * or is revoked meanwhile must stop the PUBLISHING at once — every 250 rows or 10 minutes, whichever comes first.
     */
    let gateAskedAt = Date.now(), rowsSinceGate = 0
    const regate = async () => {
      if (!seller || (++rowsSinceGate < 250 && Date.now() - gateAskedAt < 10 * 60_000)) return
      rowsSinceGate = 0; gateAskedAt = Date.now()
      const next = await gateDecision(db, seller)
      if (next.ok !== gate.ok) console.log(`identity gate     CHANGED mid-run → ${gateLine(next)}`)
      gate = next
    }
    const category = await db.category.findFirst({ where: { slug: GOPLUS_CATEGORY_SLUG }, select: { id: true, name: true } })
    if (!category) throw new Error('no `rentals` category — cannot place these rows')
    const storageUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')

    // ── map + screen ──
    const now = Date.now()
    const drop: Record<string, number> = {}
    const screen = new ImportScreen('goplus', { db })
    const unknownAmenities = new Map<string, number>()
    let scope = read.rooms
    if (IDS.length) scope = scope.filter((r) => IDS.includes(r.id))
    const details = await readBuildingDetails(read.projects, LIMIT ? scope.slice(0, LIMIT * 3) : scope)
    console.log(`buildings         ${details.read} full amenity lists read${details.failed ? ` · ${details.failed} FAILED (their rooms keep their stored amenities this run)` : ''}`)
    /** ⛔ MANY FAILED = THE ENDPOINT CHANGED, NOT A BLIP (a reviewer's catch): over 20% (and 10) of the buildings unread fails
     *  the run (exit 1 — the job alerts, no success stamp) after it is written, rather than living on 4-key previews. */
    const detailsBroken = details.failed >= Math.max(10, 0.2 * (details.read + details.failed))
    if (detailsBroken) console.error(`⛔ ${details.failed} of ${details.read + details.failed} building detail reads failed — /api/public/projects/<id> may have changed shape`)
    const mapped: GoplusMapped[] = []
    /** VACANT rooms this read REFUSED (mapping or the content screen) — a verdict the second read's rescue must not undo. */
    const refusedVacant = new Set<string>()
    /** Rooms whose building is missing from the building list — kept as they are (never expired) this run. */
    const unknownBuilding = new Set<string>()
    for (const room of scope) {
      const m = mapGoplusRoom(room, room.projectId ? read.projects.get(room.projectId) ?? null : null, { now, maxPhotos: MAX_PHOTOS })
      if (!m.ok) {
        drop[m.reason] = (drop[m.reason] ?? 0) + 1
        // A room whose BUILDING the list lacks is an incomplete read, not a verdict on the room (a reviewer's catch): it is
        // kept as it is this week — never expired for the building list coming back a little short.
        if (m.reason === 'noProject') unknownBuilding.add(goplusExternalId(room.id))
        else if (m.reason !== 'notVacant') refusedVacant.add(goplusExternalId(room.id))
        continue
      }
      const t = m.row.mutable
      // ⛔ The content screen every importer runs (banned words + advertising-banned goods). `existing: null` — the
      // screen's own hide path is for ownerless import rows; a refused GoPlus row simply is not vacant-and-publishable,
      // so the expiry below takes a live one down (reversibly) like any room that left the catalogue.
      if (!(await screen.check({ title: t.title, titleVi: t.titleVi, description: t.description, descriptionVi: t.descriptionVi, category: GOPLUS_CATEGORY_SLUG, subcategory: t.subcategorySlug, merchant: 'GoPlus', extraTexts: [t.location, t.district], externalId: m.row.externalId, url: null }, null))) {
        drop.contentScreen = (drop.contentScreen ?? 0) + 1; refusedVacant.add(m.row.externalId); continue
      }
      for (const k of m.row.unknownAmenities) unknownAmenities.set(k, (unknownAmenities.get(k) ?? 0) + 1)
      mapped.push(m.row)
    }
    const batch = LIMIT ? mapped.slice(0, LIMIT) : mapped
    /** The rooms that are vacant AND publishable this week — what the expiry keeps (only meaningful on a whole run). */
    const available = new Set(mapped.map((r) => r.externalId))

    // ── what exists ──
    const existing = new Map<string, Existing>()
    if (seller) {
      for (const r of (await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: 'goplus:' } }, select: EXISTING_SELECT })) as unknown as Existing[]) {
        if (r.externalId) existing.set(r.externalId, r)
      }
    }
    const byStatus = (st: string) => [...existing.values()].filter((r) => r.status === st).length
    const creates = batch.filter((r) => !existing.has(r.externalId))
    const revivals = batch.filter((r) => existing.get(r.externalId)?.status === EXPIRED_STATUS)
    const liveNow = [...existing.values()].filter((r) => r.status === 'active')
    const expiryPlan = planGoplusExpiry({ live: liveNow.map((r) => ({ id: r.id, externalId: r.externalId })), available, force: FORCE })

    const hist = (f: (r: GoplusMapped) => string) => Object.entries(batch.reduce<Record<string, number>>((a, r) => { const k = f(r); a[k] = (a[k] ?? 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
    const attr = (r: GoplusMapped) => JSON.parse(r.mutable.attributes) as Record<string, string>
    const photosNew = creates.reduce((a, r) => a + Math.min(r.images.length, MAX_PHOTOS), 0)
    const videosNew = creates.filter((r) => r.videos.length).length
    console.log(`dropped           ${JSON.stringify(drop)}`)
    screen.report()
    if (unknownAmenities.size) console.log(`⚠️ amenity keys this importer does not know (not published): ${JSON.stringify(Object.fromEntries(unknownAmenities))}`)
    console.log(`vacant + publishable ${mapped.length}${SAMPLE ? ` (this run: ${batch.length} — a SAMPLE, the expiry is skipped)` : ''}`)
    console.log(`  by district     ${hist((r) => r.mutable.district ?? `(${r.mutable.location})`)}`)
    console.log(`  by type         ${hist((r) => attr(r).aptType ?? 'room')}`)
    console.log(`  with video ${batch.filter((r) => r.videos.length).length} · with a map point ${batch.filter((r) => r.mutable.lat !== null).length} · with size ${batch.filter((r) => r.mutable.areaM2 !== null).length} · electricity ${batch.filter((r) => attr(r).electricityPrice).length} (an estimate: ${batch.filter((r) => attr(r).electricityEstimated).length}) · service fee ${batch.filter((r) => attr(r).serviceFee).length} · parking ${batch.filter((r) => attr(r).parkingFee).length} · deposit ${batch.filter((r) => attr(r).deposit).length} · amenities ${batch.filter((r) => r.mutable.facetTokens).length}`)
    console.log(`storefront        ${seller ? `${seller.name} (${seller.id}) owner ${seller.ownerEmail ?? seller.ownerId ?? 'none'} · officialPartner ${seller.officialPartner} · trust ${seller.trustScore}` : '(not registered yet)'}`)
    if (refusal) console.log(`  ⛔ --apply would REFUSE: ${refusal}`)
    console.log(`identity gate     ${seller ? gateLine(gate) : `${GATE_ENFORCED ? 'ON' : 'off'} — decided once the storefront exists`}`)
    if (GATE_ARG === null) console.log(`  ⚠️ read from THIS shell's env, not production's: when production enforces IDENTITY_GATE_ENFORCED, set it (and NEXT_PUBLIC_ENO_EDITION=marketplace) for this job too, or pass --identity-gate on`)
    console.log(`existing rows     ${existing.size} (active ${byStatus('active')} · expired ${byStatus(EXPIRED_STATUS)} · hidden ${byStatus('hidden')} · sold ${byStatus('sold')} · removed ${byStatus('removed')})`)
    console.log(`PLAN              create ${creates.length} · refresh-or-keep ${batch.length - creates.length} (revive ${revivals.length})`)
    console.log(`  expiry          ${SAMPLE ? 'skipped (a sample run)' : `${expiryPlan.expire.length} of ${liveNow.length} live rows no longer vacant/publishable → '${EXPIRED_STATUS}'${expiryPlan.refusal ? `  ⛔ WOULD REFUSE: ${expiryPlan.refusal}` : ''}`}`)
    console.log(`  media (creates) ${photosNew} candidate photos (≥${GOPLUS_MIN_PHOTOS} real + distinct kept or the room is not created) · ${NO_VIDEO ? 'videos OFF (--no-video)' : `${videosNew} rooms with a video (the first clip ≤ 60 s / 50 MB)`}`)

    if (!APPLY) {
      if (!NO_PROBE && creates.length) {
        // The storage the first --apply would add, from a sample of sizes (a one-byte ranged GET each).
        const pick = <T,>(xs: T[], k: number) => xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / k)) === 0).slice(0, k)
        const photoUrls = pick(creates.flatMap((r) => r.images), 30)
        const videoUrls = pick(creates.flatMap((r) => r.videos.slice(0, 1)), 15)
        const sizes = async (us: string[]) => (await Promise.all(us.map(probeSize))).filter((x): x is number => x !== null)
        const [ps, vs] = [await sizes(photoUrls), NO_VIDEO ? [] : await sizes(videoUrls)]
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
        const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`
        console.log(`  size probe      photos mean ${(mean(ps) / 1e3).toFixed(0)} KB over ${ps.length} → ≈${gb(mean(ps) * photosNew)} of source photos (re-encoded WebP ≤ ${HOST_EDGE} px lands near that)` +
          (NO_VIDEO ? '' : ` · videos mean ${(mean(vs) / 1e6).toFixed(1)} MB over ${vs.length} → ≈${gb(mean(vs) * videosNew)} stored as they are`))
      }
      const s = batch[0]
      if (s) {
        const asStored = {
          ...s.mutable, externalId: s.externalId, categoryId: category.id, sellerId: seller?.id ?? '(the goplus storefront)',
          ...(gate.ok ? { status: 'active', verified: true } : { status: 'active', verified: false, identityHold: true }),
          postedAt: s.sourceAt.toISOString(), images: `<${s.images.length} photos re-hosted at --apply from ${s.images[0]} …>`,
          video: s.videos[0] ? `<re-hosted at --apply from ${s.videos[0]}>` : null,
        }
        console.log(`\n── sample row (as create would store it) ──\n${JSON.stringify(asStored, null, 2)}`)
        console.log('\n── texts (EN / VI) ──')
        for (const r of batch.slice(0, 2)) console.log(`  ${r.externalId}\n    ${r.mutable.title}\n    ${r.mutable.description.replace(/\n+/g, ' ⏎ ')}\n    ${r.mutable.titleVi}\n    ${r.mutable.descriptionVi.replace(/\n+/g, ' ⏎ ')}`)
        console.log('\n── more rows ──')
        for (const r of batch.slice(1, 8)) console.log(`  ${r.externalId}  ${formatMoneyFull(r.mutable.price, '₫', 'vi').padStart(13)}/tháng · ${r.mutable.titleVi}`)
      }
      console.log(`\nrequests          ${requests} to goplus.com.vn (≤${CONCURRENCY} in flight, ≥${GAP_MS} ms apart)`)
      console.log('DRY RUN — nothing written, nothing uploaded. Re-run with --journal-dir <durable dir> --apply.')
      if (refusal) process.exitCode = 1
      return
    }

    // ─── APPLY ────────────────────────────────────────────────────────────────────────────────
    /** ⛔ Before storage is even opened: no upload for a storefront we will not write to. */
    if (refusal) throw new Error(refusal)
    const isrTable = await isrTagTablePresent(db)
    if (!isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table on this database — a revived or refreshed page would keep its cached state for 30 days; pass --allow-no-isr only on a scratch copy')
    const SECRET = process.env.SUPABASE_SECRET_KEY
    /** ⚠️ SUPABASE_SECRET_KEY, not SERVICE_ROLE — a guessed name turns one missing credential into 2,600 row failures. */
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    if (/supabase\.co$/.test(new URL(storageUrl).hostname)) throw new Error(`refusing to upload to ${storageUrl} — retired project`)
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const t = stamp()
    const ctx: Ctx = {
      // ⛔ The app-drawn eno.vn mark, like every import (goplus-listing.ts goplusOverlaySlug): stored clean in the overlay folder.
      host: makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' }),
      videos: sb.storage.from('listing-videos'),
      storageUrl,
      manifest: join(journal!, `goplus-uploaded-objects-${t}.txt`),
    }
    const CREATED = join(journal!, `goplus-created-rows-${t}.jsonl`)
    const REVIVED = join(journal!, `goplus-revived-rows-${t}.jsonl`)
    const ROLLBACK_SQL = join(journal!, `goplus-revive-rollback-${t}.sql`)
    console.log(`journal           ${journal}  (manifest, created, revived, expiry — all goplus-*-${t}.*)`)
    const sellerId = seller!.id
    const rankAt = (postedAt: Date) => browseRankScore({ sellerTrustScore: seller!.trustScore, postedAt, featured: false }, Date.now())
    const changedIds: string[] = []
    const confirmedIds: string[] = []
    let tombstoneFailed = false
    let stopped: string | null = null

    const processRow = async (r: GoplusMapped) => {
      await regate()
      const cur = existing.get(r.externalId)
      // ⛔ A TOMBSTONE IS LEFT AS IT IS (listing-removed.ts): a moderator's or admin's removal is the record (Law 122/2025).
      if (cur?.status === 'removed') { stat.removedLeftAlone++; return }
      // A building whose full amenity list was not read this run: an existing row keeps the BUILDING-WIDE amenities it
      // holds and takes the room's own as read now (goplusPartialTokens — no flip-flop on a flaky request, no frozen
      // room); a new row is created with what is known.
      const data = { ...r.mutable, categoryId: category.id, ...(r.amenitiesPartial && cur ? { facetTokens: goplusPartialTokens(r.mutable.facetTokens, cur.facetTokens as string | null) } : {}) }
      // ⛔ Written only in the aisle every write, release, rollback and the expiry are pinned to (reviewers' catches): a row
      // created — or refreshed, or revived — into another one could never be refreshed, expired or rolled back again.
      if (r.mutable.subcategorySlug !== GOPLUS_SUBCAT) { stat.errored++; console.warn(`  ! ${r.externalId}: mapped into "${r.mutable.subcategorySlug}", not ${GOPLUS_SUBCAT} — skipped`); return }
      if (!cur) {
        const photos = await hostPhotos(ctx, r)
        if (photos.decision !== 'create') { bump(photos.decision === 'uploadFailed' ? 'uploadFailed' : photos.decision); return }
        bump('photosUploaded', photos.urls.length)
        const video = NO_VIDEO ? { url: null, failed: false } : await hostVideo(ctx, r)
        /** The INTENT, fsynced BEFORE the write (a reviewer's catch): a kill between the two leaves the externalId on the
         *  undo list — (sellerId, externalId) is unique, so the row it may have made is found by it. */
        recordDurably(CREATED, JSON.stringify({ planned: r.externalId, at: new Date().toISOString() }))
        const made = await db.listing.create({
          data: {
            ...data, sellerId, externalId: r.externalId,
            /** ⛔ `verified` is the PUBLICATION GATE (feed-query pins it), not a trust badge (that is Seller.verified) — and
             *  the seller identity gate decides it (header ⛔ 1b): refused → HELD, published by releaseIdentityHolds later. */
            ...(gate.ok ? { status: 'active', verified: true } : { status: 'active', verified: false, identityHold: true }),
            images: JSON.stringify(photos.urls), video: video.url,
            postedAt: r.sourceAt, rankScore: rankAt(r.sourceAt), sellerTrustScore: seller!.trustScore,
            availabilityConfirmedAt: new Date(),
          },
          select: { id: true },
        })
        recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: r.externalId, held: !gate.ok, at: new Date().toISOString() }))
        if (gate.ok) stat.created++
        else stat.createdHeld++
        return
      }
      // ── an existing row: media first (a failed fetch keeps the old media), then one guarded write ──
      const media: { images?: string; video?: string | null } = {}
      const storedImages = parseImages(cur.images)
      const pa = goplusPhotoAction(storedImages, r.images, storageUrl, REFRESH_MEDIA)
      if (pa === 'human') bump('photosHuman')
      if (pa === 'rehost') {
        const photos = await hostPhotos(ctx, r)
        if (photos.decision === 'create') {
          if (JSON.stringify(photos.urls) !== JSON.stringify(storedImages)) { media.images = JSON.stringify(photos.urls); bump('photosRehosted') }
        } else { bump('photosKeptOld'); if (photos.decision === 'uploadFailed') stat.uploadFailed++ }
      }
      if (!NO_VIDEO) {
        const va = goplusVideoAction(cur.video, r.videos, storageUrl)
        if (va === 'human') bump('videosHuman')
        if (va === 'clear') { media.video = null; bump('videosCleared') }
        if (va === 'fetch') {
          const v = await hostVideo(ctx, r)
          if (!v.failed && v.url !== cur.video) media.video = v.url
        }
      }
      const was = cur as unknown as Record<string, unknown>, next = data as unknown as Record<string, unknown>
      const fieldsChanged = MUTABLE_KEYS.some((k) => was[k] !== next[k])
      const revive = cur.status === EXPIRED_STATUS
      /** postedAt moves FORWARD only (GoPlus changed the room since), with its rank — never back. */
      const repost = r.sourceAt.getTime() > cur.postedAt.getTime()
      if (!fieldsChanged && !revive && !repost && !Object.keys(media).length) { stat.unchanged++; confirmedIds.push(cur.id); return }
      const dates = repost ? { postedAt: r.sourceAt, rankScore: rankAt(r.sourceAt) } : {}
      if (revive) {
        /** The PLAN, fsynced BEFORE the write; the rollback line only AFTER it moved the row. */
        recordDurably(REVIVED, JSON.stringify({ id: cur.id, externalId: r.externalId, oldStatus: cur.status, oldPostedAt: cur.postedAt.toISOString(), oldRankScore: cur.rankScore, planned: new Date().toISOString() }))
        /**
         * ⛔ THE ROW'S OWN PUBLISH STATE DECIDES, NOT ONLY THE GATE (reviewers' catches, 2026-10-19). Expiry changed only
         * `status`, so what `verified` / `identityHold` hold now is what the row was:
         *  · public (verified) → back public when the gate allows, HELD when it refuses;
         *  · identity-held (identityHold) → PUBLISHED when the gate now allows (the hold's reason is gone), else held still;
         *  · unpublished by a person (verified false, no hold — an admin's Unverify, a moderator) → back to 'active' but
         *    still unpublished: never a hold that a later release would turn public.
         * Re-checked IN the write (verified + identityHold in the WHERE), so a row changed since the read is left alone.
         */
        const publishState = cur.verified
          ? (gate.ok ? { verificationNotes: null } : { verified: false, identityHold: true })
          : cur.identityHold
            ? (gate.ok ? { verified: true, identityHold: false, verificationNotes: null } : {})
            : {}
        const back = await db.listing.updateMany({
          // ⛔ Pinned to the GoPlus storefront's apartment aisle AND the licence guard (header ⛔ 1b).
          where: { id: cur.id, sellerId, subcategorySlug: GOPLUS_SUBCAT, status: EXPIRED_STATUS, verified: cur.verified, identityHold: cur.identityHold, updatedAt: cur.updatedAt, AND: [licenceClearedWhere([])] },
          data: { ...data, ...dates, ...media, availabilityConfirmedAt: new Date(), status: 'active', ...publishState },
        })
        if (back.count !== 1) { stat.raced++; return }
        if (cur.verified ? gate.ok : cur.identityHold && gate.ok) stat.revived++
        else if (cur.verified || cur.identityHold) stat.revivedHeld++
        else bump('revivedUnpublished')
        /** Guarded on the state the revival made (still active, still the postedAt it set), and carrying its own tombstone. */
        const newPostedAt = repost ? r.sourceAt : cur.postedAt
        recordDurably(ROLLBACK_SQL, `UPDATE "Listing" SET status = ${nhatotSqlLit(EXPIRED_STATUS)}, "postedAt" = ${nhatotSqlLit(cur.postedAt.toISOString())}, "rankScore" = ${Number(cur.rankScore)} WHERE id = ${nhatotSqlLit(cur.id)} AND "sellerId" = ${nhatotSqlLit(sellerId)} AND status = 'active' AND "postedAt" = ${nhatotSqlLit(newPostedAt.toISOString())};\n${nhatotTombstoneSql(cur.id)}`)
        /** Its cached 404 goes NOW, not after the rest of the batch. */
        if (!(await tombstoneNow(db, [cur.id]))) tombstoneFailed = true
        return
      }
      /** ⛔ Never a removed row (re-checked IN the write); a moved date lands only on the date this run read. */
      const w = await db.listing.updateMany({
        // Pinned to the apartment aisle too (a reviewer's catch): a room a person moved elsewhere is theirs, left alone.
        // …and on the updatedAt this run read (a reviewer's catch): a person's edit made while the media downloaded wins.
        where: { id: cur.id, sellerId, subcategorySlug: GOPLUS_SUBCAT, status: { not: 'removed' }, updatedAt: cur.updatedAt, ...(repost ? { postedAt: cur.postedAt } : {}) },
        data: { ...data, ...dates, ...media },
      })
      if (w.count !== 1) { stat.raced++; return }
      stat.refreshed++
      if (repost) stat.reposted++
      changedIds.push(cur.id)
      if (cur.status === 'active') confirmedIds.push(cur.id)
    }

    // ── the row loop: CONCURRENCY workers over one queue; a StopRead ends it, a row error does not ──
    let cursor = 0, done = 0
    const worker = async () => {
      while (!stopped && cursor < batch.length) {
        const r = batch[cursor++]
        try { await processRow(r) } catch (e) {
          if (e instanceof StopRead) { stopped = e.message; return }
          if ((e as { code?: string }).code === 'P2002') stat.raced++
          else { stat.errored++; console.warn(`  ! ${r.externalId}: ${(e as Error).message.slice(0, 200)}`) }
        }
        if (++done % 100 === 0) console.log(`  ${done}/${batch.length}  ${JSON.stringify(stat)}  (${((Date.now() - started) / 60_000).toFixed(1)} min)`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    // ── after the loop: pages that changed, the availability stamp, the expiry ──
    if (changedIds.length && !(await tombstoneNow(db, changedIds))) tombstoneFailed = true
    /** ⛔ RAW SQL, so updatedAt does not move: the confirmation is not an edit (the sitemap orders by updatedAt). */
    for (let i = 0; i < confirmedIds.length; i += 1000) {
      await db.$executeRaw`UPDATE "Listing" SET "availabilityConfirmedAt" = now() WHERE id = ANY(${confirmedIds.slice(i, i + 1000)}::text[]) AND "sellerId" = ${sellerId} AND status = 'active'`
    }
    // ── the identity gate, once more (header ⛔ 1b): rooms held this run, released at once if the owner verified mid-run ──
    const heldThisRun = stat.createdHeld + stat.revivedHeld
    if (heldThisRun) {
      const again = await gateDecision(db, seller!)
      if (again.ok) {
        // ⛔ The publish of a held row clears its hold and the licence mark in the same write, pinned to the GoPlus
        // storefront's apartment aisle, and ANDs the licence guard — releaseIdentityHolds' shape, for this storefront.
        const releasedRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE "Listing" SET verified = true, "identityHold" = false, "verificationNotes" = NULL
            WHERE "sellerId" = $1 AND status = 'active' AND "identityHold" AND "subcategorySlug" = '${GOPLUS_SUBCAT}' AND "externalId" LIKE 'goplus:%' AND ${licenceClearedSql()}
            RETURNING id`,
          sellerId,
        )
        stat.released = releasedRows.length
        // Their pages were cached as 404s while held — tombstoned now, like every other publish here (a reviewer's catch).
        if (releasedRows.length && !(await tombstoneNow(db, releasedRows.map((x) => x.id)))) tombstoneFailed = true
        console.log(`identity gate     the owner verified while this run held ${heldThisRun} room(s) — RELEASED ${stat.released} now`)
      } else {
        console.log(`\n⚠️⚠️ ${heldThisRun} ROOM(S) WRITTEN HELD — NOT PUBLIC (${stat.createdHeld} new, ${stat.revivedHeld} revived): the seller identity gate refused GoPlus's account (${again.code}).`)
        console.log(`   NEXT: ${GOPLUS_EMAIL} completes identity verification in its eno account — releaseIdentityHolds then publishes every held room by itself.`)
        console.log(`   If production's gate is in fact OFF: re-run with --identity-gate off, and release these with  npx tsx scripts/release-identity-holds.ts --apply --gate-is-off  (read its header first).`)
      }
    }

    let expiryRefused = false
    /**
     * ⛔ A SECOND READ, AND A ROOM IS EXPIRED ONLY WHEN BOTH READS LACK IT (a reviewer's catch, 2026-10-19). The pages are
     * offset-paged: a room let and another added while the first read paged can shift a still-vacant room past a page
     * boundary with the totals unchanged, so one read alone could expire it. Hours later, the same miss twice is not paging.
     * Only a room the first read never saw, and the second found vacant, is kept that way.
     */
    let vacantAgain: Set<string> | null = null
    if (!stopped && !SAMPLE) {
      try {
        const again = await readOnce()
        // ⚠️ A ROOM THE FIRST READ REFUSED (the content screen, too few photos, a bad mapping) IS NOT RESCUED (reviewers'
        // catches): that is a verdict, not a paging miss, and the expiry takes it down. A room the first read missed, or
        // saw let and the second sees vacant again, is kept — never expire a room GoPlus shows vacant right now.
        if (again.problem) console.error(`⛔ second read not whole (${again.problem}) — nothing expired this run`)
        else vacantAgain = new Set(again.rooms.filter((x) => x.statusId === GOPLUS_VACANT_STATUS).map((x) => goplusExternalId(x.id)).filter((id) => !refusedVacant.has(id)))
      } catch (e) {
        // ⚠️ Every row WAS processed, so this is "finished, expiry skipped" (exit 3, alerts) — never "stopped early" (exit 2,
        // "the rest of the batch was not attempted"), which would misreport a complete run (a reviewer's catch).
        console.error(`⛔ second read ${e instanceof StopRead ? 'stopped' : 'failed'} (${(e as Error).message}) — nothing expired this run`)
      }
    }
    if (stopped) console.log(`⛔ STOPPED EARLY: ${stopped} — the rest of the batch was not attempted, and nothing is expired on a run that stopped.`)
    else if (SAMPLE) console.log('expiry            skipped — a --limit / --ids sample is not the catalogue')
    else if (!vacantAgain) expiryRefused = true
    else {
      /** Re-read NOW: the live rows after this run's creates and revivals, with the exact updatedAt the write is guarded on. */
      const live = await db.$queryRaw<{ id: string; externalId: string | null; status: string; updatedAt: string }[]>`
        SELECT id, "externalId", status, "updatedAt"::text AS "updatedAt" FROM "Listing"
        WHERE "sellerId" = ${sellerId} AND status = 'active' AND "externalId" LIKE 'goplus:%' AND "subcategorySlug" = ${GOPLUS_SUBCAT} ORDER BY id`
      const plan = planGoplusExpiry({ live, available: new Set([...available, ...vacantAgain, ...unknownBuilding]), force: FORCE })
      console.log(`expiry            ${plan.expire.length} of ${live.length} live rows no longer vacant/publishable → '${EXPIRED_STATUS}'`)
      if (plan.refusal) { expiryRefused = true; console.error(`⛔ EXPIRY REFUSED: ${plan.refusal}`) }
      else if (plan.expire.length) {
        const go = new Set(plan.expire)
        const [{ now: dbNow }] = await db.$queryRawUnsafe<{ now: string }[]>(`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')::text AS now`)
        const j: ExpiryJournal = { kind: 'goplus-expiry', sellerId, createdAt: new Date().toISOString(), stamp: dbNow, rows: live.filter((r) => go.has(r.id)).map((r) => ({ id: r.id, externalId: r.externalId, priorStatus: r.status, updatedAt: r.updatedAt })) }
        const path = join(journal!, `goplus-expiry-${t}.json`)
        // ⛔ ON DISK, fsynced, BEFORE A SINGLE ROW CHANGES.
        const fd = openSync(path, 'wx'); try { writeSync(fd, JSON.stringify(j, null, 1)); fsyncSync(fd) } finally { closeSync(fd) }
        fsyncDir(journal!)
        let expired = 0
        for (let i = 0; i < j.rows.length; i += 500) {
          const part = j.rows.slice(i, i + 500)
          // ⛔ ONE STATEMENT: each row's expiry AND its pages' tombstones, for exactly the rows the conditional UPDATE moved.
          const moved = await db.$queryRawUnsafe<{ id: string }[]>(EXPIRE_WITH_TOMBSTONES_SQL, ...expireStatementParams(part, EXPIRED_STATUS, dbNow))
          expired += moved.length
          if (moved.length && !(await tombstoneNow(db, moved.map((x) => x.id)))) tombstoneFailed = true
        }
        console.log(`  EXPIRED ${expired} of ${j.rows.length} (a row changed since the read is left as it is) · journal ${path}`)
        console.log(`  ROLLBACK: npx tsx scripts/import-goplus.ts --rollback ${path} --identity-gate ${GATE_ENFORCED ? 'on' : 'off'} --apply`)
      }
    }

    const active = await db.listing.count({ where: { sellerId, status: 'active' } })
    console.log(`\n${JSON.stringify(stat)}   active now ${active}   ${((Date.now() - started) / 60_000).toFixed(1)} min, ${requests} requests`)
    console.log(`uploaded objects: ${ctx.manifest}  (an object of a row that was never written is listed there too)`)
    if (stat.created || stat.revived) console.log(`NEXT (a first import, or a big week): node scripts/purge-isr-listings.mjs; Cloudflare tag purge {"tags":["eno-html","eno-public"]} on BOTH zones, then WARM the heavy pages (home, /c/rentals, both languages) — a hand purge does not warm.`)
    console.log(`\nUNDO this run's creates (reversible): UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '<the storefront>' AND "externalId" IN (<every "planned" externalId in ${CREATED} — a killed run may have its row without its id line>), then  node scripts/purge-isr-listings.mjs  (their cached pages);  revivals: ${ROLLBACK_SQL}`)
    /**
     * ⚠️ PHOTO FETCHES THAT FAILED ARE THE SOURCE'S, BUT MANY OF THEM IS A RUN TO RETRY (a reviewer's catch): a room whose
     * photos could not be fetched is not created this week. Past 5% of the batch (and at least 5 rooms) the run counts as
     * failed on our side (exit 1), so the job keeps no success stamp and tries again tomorrow rather than in a week.
     */
    const photoFailed = stat.photoFailed ?? 0
    const fetchFailedMany = photoFailed >= 5 && photoFailed > 0.05 * batch.length
    if (fetchFailedMany) console.error(`⛔ ${photoFailed} room(s) skipped on photo fetches that failed — retried on the next run`)
    process.exitCode = Math.max(goplusApplyExitCode({ errored: stat.errored, uploadFailed: stat.uploadFailed, tombstoneFailed }, stopped, expiryRefused), (fetchFailedMany || detailsBroken) && !stopped && !expiryRefused ? 1 : 0)
    /** ⛔ THE LAST LINE, printed only when the row loop reached the END of the batch — never after a crash or a stop. */
    if (stopped === null) console.log('APPLY COMPLETED')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e instanceof StopRead ? `⛔ STOPPED: ${e.message}` : e)
  process.exitCode = e instanceof StopRead ? 2 : 1
})
