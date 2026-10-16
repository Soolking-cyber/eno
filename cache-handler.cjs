// Shared ISR/data cache backed by Supabase Postgres — the cross-instance correctness
// layer that lets Cloud Run scale eno-vn past ONE instance (audit: revalidatePath
// with Next's default filesystem cache only purges the serving instance; a sold or
// moderated listing page must vanish EVERYWHERE, and its revalidate window is 30d).
// Upstash Redis retired 2026-07-20 (owner directive) — same design, new store:
// UNLOGGED tables next_cache / next_cache_tag (DDL: scripts/rate-limit-pg.mjs),
// swept by the rl-kv-sweep pg_cron job.
//
// ── TWO TIERS, AND WHY (2026-07-22) ───────────────────────────────────────────────
// The first Postgres version consulted the network on EVERY request, because Next's
// own L1 (cacheMaxMemorySize) can't see our tombstones and would serve invalidated
// entries. Measured over its first two days: 14,388 payload reads moving ~1.1GB, to
// discover that 4 entries needed invalidating. Egress scaled with pageviews, at
// prelaunch traffic.
//
// The fix is to notice that this cache is doing two jobs with wildly different data:
//   · PAYLOADS — ~91kB each, 149MB total. Wanted by whoever renders. Not shared state.
//   · INVALIDATIONS — 6 rows, 48kB, changed 16 times ever. THE only thing that must
//     cross instance boundaries.
// So payloads live in an in-process LRU (L1) and the network carries invalidations:
//   · L1 answers reads with ZERO round trips, and — unlike Next's L1 — it checks the
//     tombstones first, which is the whole reason cacheMaxMemorySize had to be 0.
//   · ⛔ ONLY THE TOMBSTONES THAT CAN STILL MATTER ARE READ (speed plan item 4, 2026-10-16). This used
//     to say "the tag table is small enough to hold ENTIRELY in memory" and re-read all of it every
//     TAG_REFRESH_MS. It was 6 rows then and 86,795 rows / 5.4 MB on 2026-10-16 (import jobs tombstone
//     every listing they touch, 40-day TTL): the #1 query in pg_stat_statements (382,872 calls, 11% of
//     all database time) and, worse, an awaited 250–450 ms parse inside get() — measured on the box,
//     origin cache HITs p50 14 ms but p90 268 / p95 308 ms, one request in six stalled. A tombstone
//     can only kill an entry THIS process holds, and only if it is not older than that entry, so a
//     sync now asks for exactly those tags (`tag = any($1)`, `stamp >=` the oldest L1 entry): the rows
//     RETURNED are bounded by L1, not by the table (measured: a few rows; Postgres picks the primary
//     key below ~1,000 tags and a 1,072-buffer seq scan above, 21–25 ms — both off the request path).
//     It runs on its own TAG_REFRESH_MS timer, so a read never waits for it unless the timer has fallen
//     behind by TAG_WAIT_MS. Correct whatever clock a writer stamped with and however long its
//     transaction stayed open, which a "rows newer than X" read would not be.
//   · Postgres keeps the payloads as L2 so a NEW instance (scale-up, new revision)
//     starts warm instead of re-rendering everything. That read now happens about
//     once per key per instance, not once per request.
//
// ⚠️ THE TRADE, STATED PLAINLY. An invalidation is visible to OTHER instances within
// TAG_REFRESH_MS (3s), not instantly. It is instant on the instance that called
// revalidateTag (write-through below). Three seconds of a sold listing staying visible
// on 1-of-3 instances is worth ~99% of the egress and ~5ms off every cached render.
// If a future feature needs true zero-lag global purge, that feature needs a push
// channel (LISTEN/NOTIFY), not a return to per-request payload fetching.
//
// Design (tombstone tags, no key-sets):
// · Entries live under  eno:isr:<buildId>:<key>  → { lastModified, tags, value }
//   with Buffers (html/rsc/body) base64-encoded for JSON transport. buildId in the
//   prefix keeps RSC payloads build-consistent; orphaned old-build keys expire via TTL.
// · revalidateTag(tag) writes a TOMBSTONE timestamp per tag; reads compare the entry's
//   lastModified against its tags' tombstones and treat older entries as misses.
//   revalidatePath flows through this too (Next maps paths to internal _N_T_/<path>).
// · EVERY op is failure-tolerant with a hard timeout: Postgres slow/down ⇒ behave
//   like a cache miss / no-op. Never throw into the render path.
//
// DUAL MODE (the standalone server EMBEDS the build-time config, so runtime env
// can't choose whether a handler exists — the handler itself chooses):
// · Production (ENO_ISR_PG=1, or K_SERVICE on Cloud Run) → L1 + shared tombstones across every
//   process. Postgres L2 PAYLOADS only on Cloud Run or with ENO_ISR_PG_PAYLOADS=1 — see pgPayloads
//   in the constructor for the measured reason they are off on the box.
// · Everywhere else (local dev, `next build`, e2e) → L1 only, same tombstone semantics:
//   correct for a single process and free of network RTT.
//
// ⛔ K_SERVICE ALONE SWITCHED THIS OFF IN PRODUCTION FOR THREE WEEKS. It is a Cloud Run
// variable, and production left Cloud Run for the VN box on 2026-08-21. Measured
// 2026-09-15: `printenv K_SERVICE` UNSET in both app containers, every next_cache row
// expiring by 09-20 (the 30d TTL of the last Cloud Run writes), and nothing since. The
// damage was not the lost warm start — the key is `eno:isr:<edition>:<buildId>:…` (K below), so a
// deploy is cold either way, and the EDITION in it keeps the two apps' payloads apart now that they
// share the table (see the edition note above K). It was that TOMBSTONES STOPPED CROSSING PROCESSES:
//   · the box runs TWO processes, eno-vn-app and eno-forum-app. A listing sold or
//     moderated through one edition was purged only from that process's L1; the other
//     kept serving it for up to its 30-day revalidate — the exact failure this file was
//     written to prevent, now between editions instead of between instances.
//   · every OUT-OF-PROCESS purge was a silent no-op. scripts/purge-isr-listings.mjs was
//     run on 2026-09-14 and wrote its tombstones correctly; no container ever read them.
// So the switch is now an explicit opt-in that apps.compose.yml sets, rather than an
// inference from which cloud happens to be hosting us.
// Build-time prerenders land in the throwaway L1; prod first-hits re-render once and
// converge into Postgres. CJS on purpose: Next requires the handler synchronously.

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const TIMEOUT_MS = 500
const TAG_TTL_S = 60 * 60 * 24 * 35 // outlive the longest page TTL below
const MAX_TTL_S = 60 * 60 * 24 * 30 // our longest revalidate (listing pages) is 30d

// How long a tag snapshot may be reused before we re-read it. This is the
// cross-instance invalidation lag — see THE TRADE above.
const TAG_REFRESH_MS = 3000
// If the tag table has been unreadable for THIS long, stop trusting L1 and fall
// through to L2/render. Without this, a Postgres outage would silently freeze every
// instance's view of what's been invalidated for as long as the outage lasts —
// serving purged pages is a worse failure than re-rendering them.
const TAG_MAX_STALE_MS = 30_000
// …and a read WAITS for a sync once the snapshot is this old (2026-10-16 gate review, codex + opus). A timer
// refreshes it every TAG_REFRESH_MS whatever the traffic (constructor), so cross-process lag stays ~3 s and
// no read waits; this is the fallback for a timer that has fallen behind (a blocked event loop), when a read
// waits for one bounded query rather than trusting a snapshot up to TAG_MAX_STALE_MS old. The wait itself is
// capped at TAG_WAIT_CAP_MS (the pool already times queries and connections out at TIMEOUT_MS).
const TAG_WAIT_MS = 5000
const TAG_WAIT_CAP_MS = 2 * TIMEOUT_MS

// L1 bounds. ⚠️ RAISED 2026-10-16 (speed plan item 4): at 1,000 entries / 96 MB only ~400 product pages
// fit (234 kB each) against ~37k public listing pages in en+vi, and 14/14 sampled long-tail product pages
// were a MISS at the origin (render 89–399 ms). The byte cap binds first (~1,000 product pages, ~3% of
// them — this helps repeat views and crawlers, not one-off first views). Entries hold the html as a V8
// string and the RSC as Buffers. Memory, MEASURED 2026-10-16 (the old "Container is 1GiB" was Cloud Run):
// both app containers have NO memory limit (docker inspect HostConfig.Memory = 0), the V8 heap limit is
// 4,288 MB, the apps used 1.1–1.4 GB RSS, and the box had 7.4 GB available. The [eno-isr-cache] stats line
// (every 10 min) says whether this is still too small — read its `evict` before raising it again.
const L1_MAX_ENTRIES = 3000
const L1_MAX_BYTES = 256 * 1024 * 1024

let buildId = 'unknown'
try { buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { /* dev server */ }

/**
 * ⚠️ THE EDITION IS IN THE KEY, AND IT IS A LEAK CONTROL, NOT A TIDINESS ONE.
 *
 * eno.vn (the licensed marketplace) and eno.forum (visa + itinerary + PayPal) are two deployments of
 * this one codebase and they SHARE ONE DATABASE — so they share this table. Without the edition in
 * the key, a page rendered by the services edition and a page rendered by the marketplace edition
 * collide on the same row: `/` cached by eno.forum, complete with its e-Visa rail and its
 * eno.forum canonical, would be served verbatim to a eno.vn visitor. That is the licensing breach
 * arriving through the cache, underneath every gate in the app, because a cache hit never reaches
 * the code that would have filtered it.
 *
 * ⚠️ DO NOT ARGUE THAT TWO BUILD IDS ALREADY SEPARATE THEM. They usually do, and "usually" is the
 * whole problem: BUILD_ID is content-derived, so two builds of the SAME commit with only the
 * edition env differing can produce the same id — which is precisely the pair that must never share
 * a row. Relying on that is relying on an accident to enforce a legal boundary. Read the edition
 * from the environment, the same variable the app itself branches on.
 *
 * Tombstones at `T` stay build- AND edition-agnostic on purpose: a sold or moderated listing must
 * vanish from BOTH domains at once. That is a purge crossing the boundary in the safe direction —
 * it can only ever remove content, never serve one edition's page on the other.
 */
const edition = process.env.NEXT_PUBLIC_ENO_EDITION === 'marketplace' ? 'marketplace' : 'services'

const K = (key) => `eno:isr:${edition}:${buildId}:${key}`
const T = (tag) => `eno:isrtag:${tag}` // tombstones are build- and edition-agnostic on purpose

const B64 = 'base64:'
function encodeValue(value) {
  if (!value || typeof value !== 'object') return value
  const out = { ...value }
  for (const f of ['html', 'rscData', 'body', 'segmentData']) {
    if (Buffer.isBuffer(out[f])) out[f] = B64 + out[f].toString('base64')
    else if (out[f] instanceof Map) out[f] = { __map: [...out[f].entries()].map(([k, v]) => [k, Buffer.isBuffer(v) ? B64 + v.toString('base64') : v]) }
  }
  return out
}
function decodeField(v) {
  return typeof v === 'string' && v.startsWith(B64) ? Buffer.from(v.slice(B64.length), 'base64') : v
}
function decodeValue(value) {
  if (!value || typeof value !== 'object') return value
  const out = { ...value }
  for (const f of ['html', 'rscData', 'body', 'segmentData']) {
    if (out[f] && typeof out[f] === 'object' && Array.isArray(out[f].__map)) out[f] = new Map(out[f].__map.map(([k, v]) => [k, decodeField(v)]))
    else out[f] = decodeField(out[f])
  }
  return out
}

// Rough byte cost of an entry, for the L1 budget. Payloads dominate by orders of magnitude; everything
// else gets a flat allowance rather than a walk of the object.
// ⚠️ (2026-10-16 review, measured on real prerenders): Next hands set() the html as a JS STRING, and a
// Vietnamese page is a two-byte string on the V8 heap — counting 1 byte per char under-counted the vi home
// by 27%. Strings count 2 bytes per char now. segmentData's `/_full` is the SAME buffer as rscData
// (collect-segment-data) — counted once.
function sizeOf(value) {
  let n = 2048
  if (!value || typeof value !== 'object') return n
  const rsc = Buffer.isBuffer(value.rscData) ? value.rscData : null
  for (const f of ['html', 'rscData', 'body', 'segmentData']) {
    const v = value[f]
    if (Buffer.isBuffer(v)) n += v.length
    else if (v instanceof Map) {
      for (const b of v.values()) {
        if (!Buffer.isBuffer(b)) n += 64
        else if (!(rsc && b.buffer === rsc.buffer && b.byteOffset === rsc.byteOffset && b.length <= rsc.length)) n += b.length
      }
    }
    else if (typeof v === 'string') n += v.length * 2
  }
  return n
}

// ── L1: payloads, in-process, LRU by insertion order ───────────────────────────────
// Module-level so every handler instance in the process shares one cache.
const l1 = new Map() // K(key) → { lastModified, tags, ttags, value, bytes }
let l1Bytes = 0
// T(tag) → how many L1 entries carry it. Kept incrementally so a sync never walks L1 to find out which
// tags matter (walking 3,000 entries and prefixing every tag measured 13 ms of event loop per sync).
const tagRefs = new Map()

function l1Delete(k) {
  const e = l1.get(k)
  if (!e) return
  l1Bytes -= e.bytes
  l1.delete(k)
  for (const t of e.ttags) {
    const n = (tagRefs.get(t) || 0) - 1
    if (n > 0) tagRefs.set(t, n); else tagRefs.delete(t)
  }
}
function l1Set(k, entry) {
  l1Delete(k)
  entry.ttags = [...new Set((entry.tags || []).map(T))]
  for (const t of entry.ttags) tagRefs.set(t, (tagRefs.get(t) || 0) + 1)
  l1.set(k, entry)
  l1Bytes += entry.bytes
  // Map iterates in insertion order, so the first key is the least recently written.
  while (l1.size > L1_MAX_ENTRIES || l1Bytes > L1_MAX_BYTES) {
    const oldest = l1.keys().next().value
    if (oldest === undefined) break
    l1Delete(oldest)
    stats.evict++
  }
}
function l1Get(k) {
  const e = l1.get(k)
  if (!e) return null
  l1.delete(k); l1.set(k, e) // touch → most-recently-used
  return e
}

// ── Tag snapshot: the tombstones that can still kill an L1 entry ──────────────────────
const tagStamps = new Map() // T(tag) → stamp (ms)
// T(tag) → when THIS process wrote it through (revalidateTag). A sync never deletes a local write younger than
// LOCAL_GRACE_MS, whatever its stamp: the tombstone INSERT can commit after a sync's snapshot even when its stamp
// predates the sync (gate round 6) — only a later sync that can see the row may judge it.
const localTouched = new Map()
const LOCAL_GRACE_MS = 2 * TAG_REFRESH_MS
let tagsLoadedAt = 0
let tagsInflight = null

// ── Counters: one JSON line every STATS_EVERY_MS to stdout (docker logs), then reset ─────
const STATS_EVERY_MS = 10 * 60_000
let syncTimer = null
const stats = { hit: 0, miss: 0, tombstoned: 0, set: 0, evict: 0, syncs: 0, syncFail: 0, syncTags: 0, syncRows: 0, syncMsMax: 0, waited: 0 }
let statsTimer = null
function startStats() {
  if (statsTimer) return
  statsTimer = setInterval(() => { try {
    const reads = stats.hit + stats.miss
    console.log('[eno-isr-cache] ' + JSON.stringify({
      edition, l1: l1.size, l1MB: Math.round(l1Bytes / 1048576), tags: tagStamps.size,
      hitRate: reads ? Math.round((stats.hit / reads) * 1000) / 1000 : null, ...stats,
    }))
    for (const key of Object.keys(stats)) stats[key] = 0
  } catch { /* a stats line must never take the process down */ } }, STATS_EVERY_MS)
  statsTimer.unref?.() // never keeps a process (or `next build`) alive
}

/** True when the entry's own tags have been tombstoned since it was stored. */
function tombstoned(entry) {
  for (const t of entry.ttags || (entry.tags || []).map(T)) {
    const s = tagStamps.get(t)
    if (s != null && s >= entry.lastModified) return true
  }
  return false
}

module.exports = class EnoCacheHandler {
  constructor() {
    // See DUAL MODE above: ENO_ISR_PG is the box's explicit opt-in; K_SERVICE is kept so a
    // Cloud Run fallback revision still behaves as it always did.
    this.pg = Boolean((process.env.ENO_ISR_PG === '1' || process.env.K_SERVICE) && process.env.DATABASE_URL)
    /**
     * ⛔ PAYLOADS IN POSTGRES ARE A SEPARATE, NARROWER SWITCH THAN TOMBSTONES — AND OFF ON THE BOX.
     * Measured 2026-09-15, the first hour of ENO_ISR_PG on the VN box: ~235 entries / ~53 MB written every
     * 15 minutes, 98% product pages at 234 kB each — ~5 GB a day, toward ~18 GB per build (76k PDPs, 30d
     * TTL), and every deploy strands the previous build's rows until they expire, against 24 GB free.
     * What L2 payloads buy is a WARM START for a new instance. That is worth it on Cloud Run, which scales
     * out; on the box there is ONE process per edition, BUILD_ID is in the key so every deploy is cold
     * regardless, and a warm restart is all that remains. Tombstones are the part that must cross
     * processes (this file's own header: "INVALIDATIONS … THE only thing that must cross instance
     * boundaries") and they stay on.
     * So payloads go to Postgres only on Cloud Run (K_SERVICE) or when explicitly asked for.
     */
    this.pgPayloads = this.pg && Boolean(process.env.K_SERVICE || process.env.ENO_ISR_PG_PAYLOADS === '1')
    if (this.pg) {
      startStats()
      // ⛔ THE SYNC RUNS ON A TIMER, NOT ON TRAFFIC (2026-10-16 review: a sync started only by reads let a quiet
      // process answer from a snapshot up to 30 s old). Every TAG_REFRESH_MS, whatever the traffic, so another
      // process's purge is seen within ~3 s and no read pays for the query. One timer per process, however many
      // handler instances Next constructs; unref'd so it never keeps a process alive.
      if (!syncTimer) {
        // try/catch: a synchronous throw in a timer is an uncaughtException that kills the process (opus,
        // gate round 3) — a failed sync must only ever cost freshness.
        syncTimer = setInterval(() => { try { this.maybeStartTagSync() } catch { stats.syncFail++ } }, TAG_REFRESH_MS)
        syncTimer.unref?.()
      }
    }
  }

  // One small pool per process, lazily created — Supavisor (pooled DATABASE_URL,
  // transaction mode) multiplexes server-side, so a few client slots suffice.
  // statement_timeout/query_timeout do the timing out, NOT a Promise.race: a race
  // abandons the promise but the QUERY keeps running and keeps its pool slot, so
  // under load the pool starves itself (review 2026-07-20, fixed here).
  static pool = null
  static getPool() {
    if (EnoCacheHandler.pool) return EnoCacheHandler.pool
    const { Pool } = require('pg')
    EnoCacheHandler.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: TIMEOUT_MS,
      query_timeout: TIMEOUT_MS,
      statement_timeout: TIMEOUT_MS,
    })
    EnoCacheHandler.pool.on('error', () => { /* an idle client dying must never crash the server */ })
    return EnoCacheHandler.pool
  }

  /**
   * Is the tombstone snapshot fresh enough to trust L1? Starts a background refresh once it is older
   * than TAG_REFRESH_MS and returns at once; a read WAITS for that refresh only when the snapshot is
   * older than TAG_WAIT_MS (the first read after a quiet spell or after start), and then for at most the
   * pool/statement timeouts. If the database has failed for TAG_MAX_STALE_MS, L1 is not trusted at all.
   * Returns a boolean or a promise of one.
   */
  syncTags() {
    if (!this.pg) return true
    const age = Date.now() - tagsLoadedAt
    if (age >= TAG_REFRESH_MS) { try { this.maybeStartTagSync() } catch { stats.syncFail++ } }
    if (age < TAG_WAIT_MS) return true
    stats.waited++
    // Race the WAIT, never the query: the query keeps its pool slot and lands in tagStamps whenever it ends.
    let cap
    const capped = new Promise((r) => { cap = setTimeout(r, TAG_WAIT_CAP_MS); cap.unref?.() })
    return Promise.race([tagsInflight || Promise.resolve(), capped])
      .then(() => { clearTimeout(cap); return Date.now() - tagsLoadedAt < TAG_MAX_STALE_MS })
  }

  /**
   * Start a sync unless one is running. ⚠️ ONE AT A TIME, NEVER ABANDONED (gate rounds 3–5: abandoning a stuck
   * query and starting another leaked pool slots and let a late answer undo a newer one). The pool settles
   * every query within TIMEOUT_MS (query_timeout / statement_timeout / connectionTimeoutMillis). If one ever
   * did not settle, syncs stop, and after TAG_MAX_STALE_MS L1 is simply not trusted — every read re-renders:
   * slower, never stale — until the process restarts; `syncs` stops growing in the stats line.
   */
  maybeStartTagSync() {
    if (tagsInflight) return
    this.startTagSync()
  }

  /**
   * Read the current stamp of every tag an L1 entry carries, but only stamps not older than the oldest
   * entry — nothing older can kill anything held here (tombstoned(): stamp >= lastModified). Concurrent
   * callers share one in-flight query.
   */
  startTagSync() {
    const queryStart = Date.now()
    const wanted = new Set(tagRefs.keys())
    let oldest = Infinity
    for (const e of l1.values()) if (e.lastModified < oldest) oldest = e.lastModified
    // A malformed lastModified (NaN from a bad L2 row) must not turn every sync into a failed query.
    if (!Number.isFinite(oldest)) oldest = 0
    for (const [tag, at] of localTouched) if (at < queryStart - LOCAL_GRACE_MS) localTouched.delete(tag)
    if (!wanted.size) {
      // Nothing cached, nothing to invalidate. Keep only write-throughs too new to have reached the table.
      for (const [tag, stamp] of tagStamps) if (stamp < queryStart - TAG_REFRESH_MS && !localTouched.has(tag)) tagStamps.delete(tag)
      tagsLoadedAt = queryStart
      return
    }
    stats.syncs++
    stats.syncTags += wanted.size
    const inflight = EnoCacheHandler.getPool()
      .query('select tag, stamp from next_cache_tag where tag = any($1::text[]) and stamp >= $2 and expires_at > now()',
        [[...wanted], Math.floor(oldest)])
      .then(({ rows }) => {
        stats.syncRows += rows.length
        const seen = new Set()
        for (const r of rows) {
          seen.add(r.tag)
          const stamp = Number(r.stamp)
          if (stamp > (tagStamps.get(r.tag) || 0)) tagStamps.set(r.tag, stamp)
        }
        // ⚠️ MERGE, never clear (2026-07-25, codex + Gemini): a revalidateTag() that ran while this query
        // was in flight write-through'd a stamp its snapshot cannot contain — keep anything written locally
        // after queryStart, and any local write younger than LOCAL_GRACE_MS (its INSERT may not have committed
        // before this snapshot). Otherwise keep only what this query vouched for: a tag it asked about, found,
        // and not older than every L1 entry.
        // And a tag no L1 entry carries any more is dropped too (opus, gate round 7): an entry set() later is newer
        // than any stamp held now, and an L2 load checks committed tombstones in its own SQL — keeping such stamps
        // only let the map grow back toward the table it was meant to stop mirroring.
        for (const [tag, stamp] of tagStamps) {
          if (stamp >= queryStart || localTouched.has(tag)) continue
          if (!wanted.has(tag) || !seen.has(tag) || stamp < oldest) tagStamps.delete(tag)
        }
        // The snapshot is the table as of queryStart, not as of when the answer landed (opus, gate round 4) —
        // so TAG_WAIT_MS / TAG_MAX_STALE_MS bound the real age, query time included.
        tagsLoadedAt = queryStart
        stats.syncMsMax = Math.max(stats.syncMsMax, Date.now() - queryStart)
      })
      .catch(() => { stats.syncFail++ /* keep the previous snapshot; staleness is bounded by TAG_MAX_STALE_MS */ })
      .finally(() => { tagsInflight = null })
    tagsInflight = inflight
  }

  async get(key) {
    const k = K(key)
    const tagsFresh = await this.syncTags()

    // L1 — the hot path. No network, and tombstone-checked, which is precisely what
    // Next's own L1 cannot do.
    if (tagsFresh) {
      const hit = l1Get(k)
      if (hit) {
        if (!tombstoned(hit)) { stats.hit++; return { lastModified: hit.lastModified, value: hit.value } }
        stats.tombstoned++
        l1Delete(k) // invalidated — drop it and try L2, which may already hold the new one
      }
    }
    stats.miss++

    // L2 read only where payloads are stored at all (see pgPayloads). It checks the table's tombstones in
    // its own SQL (`not exists … stamp >= lastModified`), because the in-memory snapshot covers only the
    // tags of entries already in L1 — an L2 payload is valid at the moment it is read, and later
    // invalidations reach it through the next sync like any other L1 entry.
    if (!this.pgPayloads) return null

    try {
      // ONE round trip, and it transfers the payload ONLY if the entry is still live.
      // The old version fetched 91kB and then ran a second query to decide whether to
      // throw it away — paying full egress for entries it was about to discard.
      const { rows } = await EnoCacheHandler.getPool().query(
        `select c.entry from next_cache c
          where c.key = $1
            and c.expires_at > now()
            and not exists (
              select 1 from next_cache_tag t
               where t.tag = any (select $2::text || x
                                    from jsonb_array_elements_text(coalesce(c.entry->'tags', '[]'::jsonb)) x)
                 and t.stamp >= (c.entry->>'lastModified')::bigint)`,
        [k, 'eno:isrtag:'])
      const entry = rows[0]?.entry
      if (!entry) return null
      const value = decodeValue(entry.value)
      const lastModified = Number(entry.lastModified)
      // A row without a usable lastModified could never be tombstoned (`stamp >= NaN` is false) — a miss.
      if (!Number.isFinite(lastModified)) return null
      const tags = Array.isArray(entry.tags) ? entry.tags : []
      const loaded = { lastModified, tags, value, bytes: sizeOf(value) }
      l1Set(k, loaded)
      // ⚠️ AND THIS PROCESS'S OWN UNCOMMITTED PURGES (gate round 6): the SQL above sees only COMMITTED tombstones, so a
      // revalidateTag() here whose INSERT has not landed yet would otherwise be served straight past.
      if (tombstoned(loaded)) { l1Delete(k); stats.tombstoned++; return null }
      return { lastModified, value }
    } catch { return null }
  }

  async set(key, value, ctx = {}) {
    const k = K(key)
    const tags = [...new Set([
      ...(Array.isArray(ctx.tags) ? ctx.tags : []),
      ...(typeof value?.headers?.['x-next-cache-tags'] === 'string' ? value.headers['x-next-cache-tags'].split(',') : []),
    ])].filter(Boolean)
    const lastModified = Date.now()
    stats.set++

    // L1 first and unconditionally: the instance that just rendered this should never
    // have to fetch it back over the network.
    l1Set(k, { lastModified, tags, value, bytes: sizeOf(value) })

    if (!this.pgPayloads) return

    try {
      // Next 16 carries the revalidate hint in different places per entry kind:
      // route/page entries → ctx.cacheControl.revalidate, fetch entries → the
      // value itself; plain ctx.revalidate is legacy. Check all three or every
      // entry silently retains for the 30d maximum (review 2026-07-20).
      const revalidate = [ctx.revalidate, ctx.cacheControl && ctx.cacheControl.revalidate, value && value.revalidate]
        .find((r) => typeof r === 'number' && r > 0) ?? null
      const ttl = Math.min(MAX_TTL_S, revalidate ? revalidate + 6 * 3600 : MAX_TTL_S)
      const entry = { lastModified, tags, value: encodeValue(value) }
      await EnoCacheHandler.getPool().query(
        `insert into next_cache (key, entry, expires_at)
         values ($1, $2::jsonb, now() + make_interval(secs => $3))
         on conflict (key) do update set entry = excluded.entry, expires_at = excluded.expires_at`,
        [k, JSON.stringify(entry), ttl])
    } catch { /* cache write is best-effort */ }
  }

  async revalidateTag(tags) {
    const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean)
    if (!list.length) return
    const stamp = Date.now()

    // Write THROUGH the local snapshot so this instance is correct immediately — the
    // TAG_REFRESH_MS lag applies only to the OTHER instances.
    for (const tag of list) {
      const t = T(tag)
      tagStamps.set(t, Math.max(tagStamps.get(t) || 0, stamp))
      localTouched.set(t, stamp)
    }
    // Drop anything the new tombstones just killed, so a purged page can't be served
    // from L1 during the window before its own tombstone check would catch it.
    for (const [k, e] of l1) if (tombstoned(e)) l1Delete(k)

    if (!this.pg) return

    try {
      // greatest(): a delayed invalidation must never move a tombstone BACKWARD —
      // that would revive entries a newer invalidation already killed (review
      // 2026-07-20).
      await EnoCacheHandler.getPool().query(
        `insert into next_cache_tag (tag, stamp, expires_at)
         select t, $2, now() + make_interval(secs => $3) from unnest($1::text[]) as t
         on conflict (tag) do update set
           stamp = greatest(next_cache_tag.stamp, excluded.stamp),
           expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
        [list.map(T), stamp, TAG_TTL_S])
    } catch { /* a failed purge self-heals via entry TTL */ }
  }

  // Per-request dedupe memory — nothing to reset in this implementation.
  resetRequestCache() {}
}
