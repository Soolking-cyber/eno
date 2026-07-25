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
//   · The tag table is small enough to hold ENTIRELY in memory, refreshed at most
//     every TAG_REFRESH_MS. One tiny query every few seconds per instance, whatever
//     the traffic. Traffic no longer touches Postgres at all on the hot path.
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
// · On Cloud Run (K_SERVICE set) → L1 + Postgres L2, shared across instances.
// · Everywhere else (local dev/build/e2e, Cloud Build) → L1 only, same tombstone
//   semantics: correct for a single instance and free of network RTT.
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

// L1 bounds. The live build's whole working set measured ~3MB (73 entries), so these
// are far above need — they exist to cap a pathological key space, not to ration.
// Container is 1GiB; entries hold Buffers, not the +33% base64 form used in transport.
const L1_MAX_ENTRIES = 1000
const L1_MAX_BYTES = 96 * 1024 * 1024

let buildId = 'unknown'
try { buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { /* dev server */ }

const K = (key) => `eno:isr:${buildId}:${key}`
const T = (tag) => `eno:isrtag:${tag}` // tombstones are build-agnostic on purpose

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

// Rough byte cost of an entry, for the L1 budget. Buffers dominate by orders of
// magnitude; everything else gets a flat allowance rather than a walk of the object.
function sizeOf(value) {
  let n = 2048
  if (!value || typeof value !== 'object') return n
  for (const f of ['html', 'rscData', 'body', 'segmentData']) {
    const v = value[f]
    if (Buffer.isBuffer(v)) n += v.length
    else if (v instanceof Map) { for (const b of v.values()) n += Buffer.isBuffer(b) ? b.length : 64 }
    else if (typeof v === 'string') n += v.length
  }
  return n
}

// ── L1: payloads, in-process, LRU by insertion order ───────────────────────────────
// Module-level so every handler instance in the process shares one cache.
const l1 = new Map() // K(key) → { lastModified, tags, value, bytes }
let l1Bytes = 0

function l1Delete(k) {
  const e = l1.get(k)
  if (e) { l1Bytes -= e.bytes; l1.delete(k) }
}
function l1Set(k, entry) {
  l1Delete(k)
  l1.set(k, entry)
  l1Bytes += entry.bytes
  // Map iterates in insertion order, so the first key is the least recently written.
  while (l1.size > L1_MAX_ENTRIES || l1Bytes > L1_MAX_BYTES) {
    const oldest = l1.keys().next().value
    if (oldest === undefined) break
    l1Delete(oldest)
  }
}
function l1Get(k) {
  const e = l1.get(k)
  if (!e) return null
  l1.delete(k); l1.set(k, e) // touch → most-recently-used
  return e
}

// ── Tag snapshot: the whole tombstone table, in memory ─────────────────────────────
const tagStamps = new Map() // T(tag) → stamp (ms)
let tagsLoadedAt = 0
let tagsInflight = null

/** True when the entry's own tags have been tombstoned since it was stored. */
function tombstoned(entry) {
  for (const tag of entry.tags || []) {
    const s = tagStamps.get(T(tag))
    if (s != null && s >= entry.lastModified) return true
  }
  return false
}

module.exports = class EnoCacheHandler {
  constructor() {
    this.pg = Boolean(process.env.K_SERVICE && process.env.DATABASE_URL)
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
   * Refresh the tag snapshot if it's older than TAG_REFRESH_MS. Concurrent callers
   * share one in-flight query. Returns false when the snapshot is too stale to trust.
   */
  async syncTags() {
    if (!this.pg) return true
    const age = Date.now() - tagsLoadedAt
    if (age < TAG_REFRESH_MS) return true
    if (!tagsInflight) {
      // ⚠️ MERGE, never clear (fixed 2026-07-25, confirmed by codex + Gemini). This SELECT
      // takes its snapshot at queryStart; a revalidateTag() running while it is in flight
      // commits its tombstone AFTER that snapshot and write-throughs to tagStamps. The old
      // tagStamps.clear() then deleted that just-written stamp when the query resolved, so
      // THIS instance served stale L1 for the tag it had just revalidated — breaking the
      // "instant on the calling instance" promise documented at the top of this file, and
      // lasting until a later sync happened to succeed.
      const queryStart = Date.now()
      tagsInflight = EnoCacheHandler.getPool()
        .query('select tag, stamp from next_cache_tag where expires_at > now()')
        .then(({ rows }) => {
          const seen = new Set()
          for (const r of rows) {
            seen.add(r.tag)
            const stamp = Number(r.stamp)
            if (stamp > (tagStamps.get(r.tag) || 0)) tagStamps.set(r.tag, stamp)
          }
          // Still evict tags the DB no longer has (expired tombstones) — that is what the
          // clear() was really for — but keep any stamp written locally after the snapshot,
          // because its row simply wasn't visible yet.
          for (const [tag, stamp] of tagStamps) {
            if (!seen.has(tag) && stamp < queryStart) tagStamps.delete(tag)
          }
          tagsLoadedAt = Date.now()
        })
        .catch(() => { /* keep the previous snapshot; staleness is bounded below */ })
        .finally(() => { tagsInflight = null })
    }
    await tagsInflight
    return Date.now() - tagsLoadedAt < TAG_MAX_STALE_MS
  }

  async get(key) {
    const k = K(key)
    const tagsFresh = await this.syncTags()

    // L1 — the hot path. No network, and tombstone-checked, which is precisely what
    // Next's own L1 cannot do.
    if (tagsFresh) {
      const hit = l1Get(k)
      if (hit) {
        if (!tombstoned(hit)) return { lastModified: hit.lastModified, value: hit.value }
        l1Delete(k) // invalidated — drop it and try L2, which may already hold the new one
      }
    }

    if (!this.pg) return null

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
      const tags = Array.isArray(entry.tags) ? entry.tags : []
      l1Set(k, { lastModified, tags, value, bytes: sizeOf(value) })
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

    // L1 first and unconditionally: the instance that just rendered this should never
    // have to fetch it back over the network.
    l1Set(k, { lastModified, tags, value, bytes: sizeOf(value) })

    if (!this.pg) return

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
