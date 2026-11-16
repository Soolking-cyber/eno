import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { IS_MARKETPLACE } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { HOME_FEED_SEATS } from '@/lib/feed-diversity'
import { diverseFeedHead } from '@/lib/feed-window'
import { IN_APP_ONLY, inAppOnly } from '@/lib/in-app-listing'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { LISTING_CARD_SELECT } from '@/lib/serialize'
import { homeCategoryRails } from '@/lib/core/category-rails'
import { trendingRailListings } from '@/lib/core/trending-rail'
import { topBusinessListings } from '@/lib/core/business-rail'
import { PHOTO_CHECK_EXEMPT } from '@/lib/listing-photo-check'
import { PHOTO_HELD_NOTE } from '@/lib/listing-photo-hold'
import { photoCheckDone, photoRulesLive } from '@/lib/listing-photo-hooks'
import { PENDING_PHOTO_PREFIX } from '@/lib/listing-photo-queue'
import { photoPassById, type PhotoPassResult } from '@/lib/listing-photo-pass'
import { STORE_REVIEW_SEAT_EMAILS } from '@/lib/review-seat-accounts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * THE PHOTO SWEEP (owner, 2026-11-15: no flyers and no contact details in listing photos) — the pass after publish
 * (listing-photo-pass.ts) over photos already on the site. Hourly on the box, POLICY (it bells sellers). Scopes:
 *  · recent — the pending set (rows a pass could not decide, rows a script queued; at most a third of the run, so it
 *    cannot starve the rest), then rows created or updated since the last run;
 *  · backfill — the walk: the home page's own cards, then in-app listings by rank, then the rest; a kv cursor keeps its
 *    place across runs, and it stops at the end;
 *  · full — the walk again from the top once it has ended: the weekly backstop for a raw-SQL photo change nobody queued
 *    (plan A14 — accepted, not closed);
 *  · none (the timer) — recent, then the walk while one is under way or a week after the last one ended.
 * ⛔ WRITES OFF BY DEFAULT (A16): without PHOTO_RULES_WRITE=1 every run is a dry run — it checks and caches, but holds,
 * strips, releases and bells nothing, and answers what it WOULD do, per outcome and per storefront. ?dryRun=1 forces
 * one. A dry run keeps its own cursor and watermark, so the first real run still sees every row.
 * ⛔ THE BREAKER (A12): a storefront the pass's breaker tripped (listing-photo-pass.ts storefrontMayWrite — it stays
 * tripped, by ANY caller: this sweep, a seller's edit, the admin override, a bulk import) or any hold or strip past 100 in
 * one run writes nothing more, its rows queued for the next run. 500 `mass_hold` when the cap is hit or a tripped
 * storefront has not been reported yet (a kv mark, set then); later runs answer 200 and list it under `tripped` (still
 * writing nothing for it), so the cron is red once per trip, not every hour. ?allow=<sellerId>[,…] lifts the storefront's
 * trip, and its mark.
 * Bounded by ?limit images (600; at most 5,000) and 780 s, and stops at a spent sweep lane (`stopped: 'budget'`, the
 * cursor before the rows it could not read); one run per mode at a time. Marketplace only (one database).
 * The answer names listing and seller ids — never a name or a photo.
 *   curl -H "Authorization: Bearer $(docker exec eno-vn-app printenv CRON_SECRET)" -H 'Host: eno.vn' \
 *     'http://127.0.0.1:3001/api/cron/listing-photos?scope=backfill&dryRun=1'
 */

const DEFAULT_LIMIT = 600
const MAX_LIMIT = 5_000
const BUDGET_MS = 780_000
const PAGE = 100
const CONCURRENCY = 4
const WEEK_MS = 7 * 24 * 3600_000
/** A write committed while the last run read is re-read once (its updatedAt can be a little older than its commit). */
const SKEW_MS = 5 * 60_000
const RUN_WRITES = 100
const STATE_TTL_S = 90 * 24 * 3600
const PENDING_PER_RUN = 500
const PENDING_SHARE = 1 / 3

type Mode = 'dry' | 'write'
const walkKey = (m: Mode) => `listing-photo:walk:${m}`
const recentKey = (m: Mode) => `listing-photo:recent:${m}`
const runKey = (m: Mode) => `listing-photo:run:${m}`
const reportedKey = (sellerId: string) => `listing-photo:tripped-reported:${sellerId}`

/**
 * An official partner's storefront — listing-photo-check.ts partnerPhotoExempt in Prisma: the flag, unless the owner is a
 * store-review seat (case-insensitive and NULL-safe, as review-seat-accounts.ts NOT_A_REVIEW_SEATS_LISTING: an ownerless
 * partner, or one whose owner has no email, is a partner).
 */
const PARTNER_STOREFRONT: Prisma.SellerWhereInput = {
  officialPartner: true,
  NOT: { owner: { email: { in: [...STORE_REVIEW_SEAT_EMAILS], mode: 'insensitive', not: null } } },
}
/**
 * What the pass may act on: live or identity-parked, or photo-held — never a teacher (the teacher check owns them), and
 * never an official partner's storefront (owner 2026-11-16, "partners skipped": 99% of the photos in scope) unless it
 * still carries the photo mark, which the pass releases. A revoked partner's rows are queued by
 * scripts/set-official-partner.mjs --off (the walk has passed them by).
 */
const CHECKED: Prisma.ListingWhereInput = {
  category: { slug: { notIn: [...PHOTO_CHECK_EXEMPT.categories] } },
  AND: [
    { OR: [{ status: 'active', OR: [{ verified: true }, { identityHold: true }] }, { verificationNotes: PHOTO_HELD_NOTE, status: { not: LISTING_REMOVED } }] },
    { OR: [{ verificationNotes: PHOTO_HELD_NOTE }, { NOT: { seller: PARTNER_STOREFRONT } }] },
  ],
}
const ROW = { id: true, sellerId: true, images: true, rankScore: true, updatedAt: true, createdAt: true } satisfies Prisma.ListingSelect
type Row = Prisma.ListingGetPayload<{ select: typeof ROW }>

type Walk = { phase: 'home' | 'ranked' | 'rest' | 'done'; home: string[]; after: { id: string; rank: number } | null; startedAt: string; doneAt?: string }
type Mark = { at: string; id: string }
/** The recent scope's two cursors: `at`/`id` on updatedAt, `created` on createdAt (a raw insert can carry an old updatedAt). */
type Marks = Mark & { created?: Mark }

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const q = new URL(req.url).searchParams
  const scope = q.get('scope')
  if (scope !== null && !['recent', 'backfill', 'full'].includes(scope)) throw new ApiError('bad_request', 400)
  const limit = q.has('limit') ? Number(q.get('limit')) : DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiError('bad_request', 400)
  const allow = new Set((q.get('allow') ?? '').split(',').filter(Boolean))
  if ([...allow].some((s) => !/^[\w-]{1,64}$/.test(s))) throw new ApiError('bad_request', 400)
  const dryRun = q.get('dryRun') === '1' || !photoRulesLive()
  const mode: Mode = dryRun ? 'dry' : 'write'

  if ((await kv.set(runKey(mode), 1, { nx: true, ex: 900 })) === null) return { ok: true, skipped: 'busy', dryRun }
  try {
    const start = Date.now()
    const run = makeRun({ dryRun, limit, deadline: start + BUDGET_MS, allow })
    const recent = scope === null || scope === 'recent' ? await sweepRecent(run, mode, start, limit) : undefined
    const walk = scope === 'recent' ? undefined : await sweepWalk(run, mode, scope === null ? 'due' : scope === 'full' ? 'restart' : 'continue')
    if (!dryRun) await Promise.all([...allow].map((s) => kv.del(reportedKey(s)).catch((e) => logError(e, { op: 'listing-photos.reported' }))))
    // A dry run never spends the one-time alert: its marks are the write runs' (gate review).
    const unreported = dryRun ? [] : await reportTrips(run.tripped)
    const massHold = unreported.length > 0 || run.runCapped()
    const body = {
      ok: !run.counts.failed && !massHold,
      ...(massHold ? { refused: 'mass_hold', sellers: unreported, runCapped: run.runCapped() } : {}),
      ...(run.tripped.size ? { tripped: [...run.tripped] } : {}),
      dryRun, scope: scope ?? 'timer', limit, listings: run.seen.size, images: run.images(), stopped: run.stopped(),
      outcomes: run.counts, storefronts: run.storefronts(), ...(recent ? { recent } : {}), ...(walk ? { walk } : {}),
    }
    return massHold ? NextResponse.json(body, { status: 500 }) : body
  } finally {
    await kv.del(runKey(mode)).catch((e) => logError(e, { op: 'listing-photos.release' }))
  }
})

/** The tripped storefronts no run has reported yet, marked reported now. A kv error reports it (again): red, never silent. */
async function reportTrips(tripped: ReadonlySet<string>): Promise<string[]> {
  const out: string[] = []
  for (const s of tripped) {
    const seen = await kv.get(reportedKey(s)).catch(() => null)
    if (seen) continue
    out.push(s)
    await kv.set(reportedKey(s), { at: new Date().toISOString() }).catch((e) => logError(e, { op: 'listing-photos.reported' }))
  }
  return out
}

/** What one pass did (or, dry, would do) — a listing can be stripped AND released, or stripped and still pending. */
function outcomesOf(r: PhotoPassResult): string[] {
  if ('skip' in r) return [r.skip]
  if (r.breaker) return ['breaker']
  const p = r.plan
  const acts: string[] = r.dryRun ? [...(p.hold ? ['held'] : []), ...(p.strip ? ['stripped'] : []), ...(p.release ? ['released'] : [])] : r.wrote
  const out = [...acts, ...(p.pending ? ['pending'] : [])]
  if (!r.dryRun && !r.wrote.length && (p.hold || p.strip || p.release)) out.push('not_written')
  return out.length ? out : ['clean']
}

/** Outcomes a storefront is reported for (a clean storefront is only counted). */
const NOTABLE = new Set(['held', 'stripped', 'released', 'pending', 'breaker', 'exempt', 'not_written', 'failed'])

function makeRun(o: { dryRun: boolean; limit: number; deadline: number; allow: ReadonlySet<string> }) {
  const counts: Record<string, number> = {}
  const stores = new Map<string, Record<string, number>>()
  const samples = new Map<string, string[]>()
  const seen = new Set<string>()
  const tripped = new Set<string>()
  let writes = 0
  let capped = false
  let images = 0
  let stopped: 'limit' | 'time' | 'budget' | null = null
  // A12's per-run cap on holds and strips (the storefront part is the pass's own). No await: four passes ask at once.
  const mayWrite = async (): Promise<boolean> => {
    if (writes >= RUN_WRITES) { capped = true; return false }
    writes++
    return true
  }
  const left = () => {
    if (!stopped && images >= o.limit) stopped = 'limit'
    if (!stopped && Date.now() >= o.deadline) stopped = 'time'
    return !stopped
  }
  const tally = (row: Row, r: PhotoPassResult) => {
    const s = stores.get(row.sellerId) ?? {}
    stores.set(row.sellerId, s)
    s.listings = (s.listings ?? 0) + 1
    if ('breaker' in r && r.breaker === 'storefront') tripped.add(row.sellerId)
    for (const k of outcomesOf(r)) {
      counts[k] = (counts[k] ?? 0) + 1
      s[k] = (s[k] ?? 0) + 1
      if (k === 'held' || k === 'stripped') {
        const a = samples.get(row.sellerId) ?? []
        if (a.length < 5) samples.set(row.sellerId, [...a, row.id])
      }
    }
  }
  /** Passes `rows` (4 at a time) while the budget lasts, `cap` images at most; how many of them it got through, in order. */
  const check = async (rows: Row[], cap = Infinity): Promise<number> => {
    let done = 0
    const from = images
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (!left() || images - from >= cap) break
      const batch = rows.slice(i, i + CONCURRENCY).filter((r) => !seen.has(r.id))
      for (const r of batch) seen.add(r.id)
      const res = await Promise.all(batch.map((r) => photoPassById(r.id, 'sweep', { dryRun: o.dryRun, allow: o.allow, mayWrite: o.dryRun ? undefined : mayWrite })))
      batch.forEach((r, j) => { tally(r, res[j]); images += imageCount(r.images) })
      // A row the pass will never act on leaves the queue (a queued one stays until it decides: listing-photo-pass.ts).
      if (!o.dryRun) await Promise.all(batch.filter((_, j) => { const x = res[j]; return 'skip' in x && x.skip !== 'failed' }).map((r) => photoCheckDone(r.id)))
      // A spent lane: stop asking; the cursor stays before this batch.
      if (res.some((x) => 'budget' in x && x.budget)) { stopped = 'budget'; break }
      done = Math.min(rows.length, i + CONCURRENCY)
    }
    return done
  }
  const storefronts = () => Object.fromEntries([...stores].filter(([, s]) => Object.keys(s).some((k) => NOTABLE.has(k)))
    .map(([id, s]) => [id, { ...s, ...(samples.has(id) ? { sample: samples.get(id) } : {}) }]))
  return { check, left, counts, seen, storefronts, tripped, runCapped: () => capped, images: () => images, stopped: () => stopped }
}
type Run = ReturnType<typeof makeRun>

function imageCount(json: string): number {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.length : 0 } catch { return 0 }
}

/** The pending set, oldest-queued first — a row queued again goes to the back, so one that never decides cannot starve it. */
async function pendingIds(): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ key: string }>>`
    SELECT key FROM kv_store WHERE key LIKE ${`${PENDING_PHOTO_PREFIX}%`} AND (expires_at IS NULL OR expires_at > now())
     ORDER BY expires_at ASC NULLS FIRST LIMIT ${PENDING_PER_RUN}`
  return rows.map((r) => r.key.slice(PENDING_PHOTO_PREFIX.length))
}

async function sweepRecent(run: Run, mode: Mode, start: number, limit: number) {
  const pending = await pendingIds()
  // edition-lint-allow: rows the photo pass re-checks (a write path); nothing is rendered.
  const found = pending.length ? await db.listing.findMany({ where: { AND: [CHECKED, { id: { in: pending } }] }, select: ROW }) : []
  // `id IN` answers in the database's order: put the queue's oldest-first order back before the cap, or the same rows
  // would take the third every run.
  const byId = new Map(found.map((r) => [r.id, r]))
  const queued = pending.flatMap((id) => byId.get(id) ?? [])
  // A queued row the pass may no longer act on (removed, unpublished, a teacher) leaves the queue; a dry run writes nothing.
  if (mode === 'write') for (const id of pending) if (!byId.has(id)) await photoCheckDone(id)
  await run.check(queued, Math.ceil(limit * PENDING_SHARE))

  const saved = await kv.get<Marks>(recentKey(mode))
  const first: Mark = { at: new Date(start - 24 * 3600_000).toISOString(), id: '' }
  const updated = await sinceMark(run, 'updatedAt', saved ? { at: saved.at, id: saved.id } : first, start)
  const created = await sinceMark(run, 'createdAt', saved?.created ?? (saved ? { at: saved.at, id: saved.id } : first), start)
  await kv.set(recentKey(mode), { ...updated.mark, created: created.mark } satisfies Marks, { ex: STATE_TTL_S })
  return { queued: pending.length, caughtUp: updated.caughtUp && created.caughtUp, mark: updated.mark.at }
}

/**
 * Rows whose `key` is past the mark, read and paged by that same key (then id), so every page that is checked moves the
 * mark and a run always progresses. Caught up: from this run's start, less the skew.
 */
async function sinceMark(run: Run, key: 'updatedAt' | 'createdAt', mark: Mark, start: number): Promise<{ mark: Mark; caughtUp: boolean }> {
  while (run.left()) {
    const at = new Date(mark.at)
    const past: Prisma.ListingWhereInput[] = key === 'updatedAt'
      ? [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: mark.id } }]
      : [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: mark.id } }]
    // edition-lint-allow: rows the photo pass re-checks (a write path); nothing is rendered.
    const rows = await db.listing.findMany({
      where: { AND: [CHECKED, { OR: past }] },
      orderBy: [key === 'updatedAt' ? { updatedAt: 'asc' } : { createdAt: 'asc' }, { id: 'asc' }], take: PAGE, select: ROW,
    })
    const n = await run.check(rows)
    if (n) mark = { at: rows[n - 1][key].toISOString(), id: rows[n - 1].id }
    if (n === rows.length && rows.length < PAGE) return { mark: { at: new Date(start - SKEW_MS).toISOString(), id: '' }, caughtUp: true }
    if (n < rows.length) break
  }
  return { mark, caughtUp: false }
}

/** The home page's own cards — the category shelves, Trending, Outstanding businesses and the feed's first twelve. */
async function homeIds(): Promise<string[]> {
  const ids = (p: Promise<Array<{ id: string }>>) => p.then((ls) => ls.map((l) => l.id), (e) => { logError(e, { op: 'listing-photos.home' }); return [] as string[] })
  const lists = await Promise.all([
    ids(homeCategoryRails('vi').then((rails) => rails.flatMap((r) => r.listings))),
    ids(trendingRailListings()),
    ids(topBusinessListings()),
    ids(scopedListingWhere({ verified: true, status: 'active' }).then((s) => diverseFeedHead(inAppOnly(s), [{ rankScore: 'desc' }, { id: 'desc' }], LISTING_CARD_SELECT, HOME_FEED_SEATS)).then((h) => h.slice(0, 12))),
  ])
  return [...new Set(lists.flat())].sort()
}

function phaseQuery(w: Walk): { where: Prisma.ListingWhereInput; orderBy: Prisma.ListingOrderByWithRelationInput[] } {
  const a = w.after
  if (w.phase === 'ranked') {
    return {
      where: { AND: [CHECKED, IN_APP_ONLY, { id: { notIn: w.home } }, ...(a ? [{ OR: [{ rankScore: { lt: a.rank } }, { rankScore: a.rank, id: { gt: a.id } }] }] : [])] },
      orderBy: [{ rankScore: 'desc' }, { id: 'asc' }],
    }
  }
  const part = w.phase === 'home' ? { id: { in: w.home } } : { AND: [{ NOT: IN_APP_ONLY }, { id: { notIn: w.home } }] }
  return { where: { AND: [CHECKED, part, ...(a ? [{ id: { gt: a.id } }] : [])] }, orderBy: [{ id: 'asc' }] }
}
const NEXT_PHASE = { home: 'ranked', ranked: 'rest', rest: 'done' } as const

/**
 * The walk. ⚠️ A row whose rank moves past the cursor between runs can be skipped (or seen twice): the next walk, the
 * recent scope and the publish paths' own passes cover it.
 */
async function sweepWalk(run: Run, mode: Mode, how: 'continue' | 'restart' | 'due') {
  let w = await kv.get<Walk>(walkKey(mode))
  if (w?.phase === 'done') {
    const weekOld = Date.now() - Date.parse(w.doneAt ?? w.startedAt) >= WEEK_MS
    if (how === 'continue' || (how === 'due' && !weekOld)) return { phase: 'done' as const, doneAt: w.doneAt }
    w = null
  }
  if (!w) w = { phase: 'home', home: await homeIds(), after: null, startedAt: new Date().toISOString() }
  const save = (x: Walk) => kv.set(walkKey(mode), x, { ex: STATE_TTL_S })
  while (w.phase !== 'done' && run.left()) {
    const q = phaseQuery(w)
    // edition-lint-allow: rows the photo pass re-checks (a write path); nothing is rendered.
    const rows = await db.listing.findMany({ ...q, take: PAGE, select: ROW })
    if (!rows.length) {
      const phase: Walk['phase'] = NEXT_PHASE[w.phase]
      w = { ...w, phase, after: null, ...(phase === 'done' ? { doneAt: new Date().toISOString() } : {}) }
      await save(w)
      continue
    }
    const n = await run.check(rows)
    if (n) w = { ...w, after: { id: rows[n - 1].id, rank: rows[n - 1].rankScore } }
    await save(w)
    if (n < rows.length) break
  }
  return { phase: w.phase, startedAt: w.startedAt, ...(w.doneAt ? { doneAt: w.doneAt } : {}), home: w.home.length }
}
