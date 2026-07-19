// Shared ISR/data cache backed by Supabase Postgres — the cross-instance correctness
// layer that lets Cloud Run scale eno-vn past ONE instance (audit: revalidatePath
// with Next's default filesystem cache only purges the serving instance; a sold or
// moderated listing page must vanish EVERYWHERE, and its revalidate window is 30d).
// Upstash Redis retired 2026-07-20 (owner directive) — same design, new store:
// UNLOGGED tables next_cache / next_cache_tag (DDL: scripts/rate-limit-pg.mjs),
// swept by the rl-kv-sweep pg_cron job.
//
// Design (tombstone tags, no key-sets):
// · Entries live under  eno:isr:<buildId>:<key>  → { lastModified, tags, value }
//   with Buffers (html/rsc/body) base64-encoded for JSON transport. buildId in the
//   prefix keeps RSC payloads build-consistent; orphaned old-build keys expire via TTL.
// · revalidateTag(tag) writes a TOMBSTONE timestamp per tag; get() compares the
//   entry's lastModified against its tags' tombstones (one indexed ANY() probe) and
//   treats older entries as misses. revalidatePath flows through this too (Next maps
//   paths to internal _N_T_/<path> tags).
// · EVERY op is failure-tolerant with a hard timeout: Postgres slow/down ⇒ behave
//   like a cache miss / no-op. Never throw into the render path.
// · next.config sets cacheMaxMemorySize: 0 when this handler is active — the default
//   in-memory L1 would serve stale entries WITHOUT consulting the tombstones.
//
// DUAL MODE (the standalone server EMBEDS the build-time config, so runtime env
// can't choose whether a handler exists — the handler itself chooses):
// · On Cloud Run (K_SERVICE set) → Postgres, the shared cross-instance cache.
// · Everywhere else (local dev/build/e2e, Cloud Build) → an in-process Map with the
//   SAME tombstone semantics: correct for a single instance and free of network RTT.
// Build-time prerenders land in the throwaway Map; prod first-hits re-render once
// and converge into Postgres. CJS on purpose: Next requires the handler synchronously.

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const TIMEOUT_MS = 500
const TAG_TTL_S = 60 * 60 * 24 * 35 // outlive the longest page TTL below
const MAX_TTL_S = 60 * 60 * 24 * 30 // our longest revalidate (listing pages) is 30d

let buildId = 'unknown'
try { buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { /* dev server */ }

const K = (key) => `eno:isr:${buildId}:${key}`
const T = (tag) => `eno:isrtag:${tag}` // tombstones are build-agnostic on purpose

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('cache_timeout')), TIMEOUT_MS))])

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

const memEntries = new Map() // module-level: shared across handler instances in-process
const memTags = new Map()
const MEM_MAX = 500

// One small pool per process, lazily created — Supavisor (pooled DATABASE_URL,
// transaction mode) multiplexes server-side, so a few client slots suffice.
let pool = null
function getPool() {
  if (pool) return pool
  const { Pool } = require('pg')
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: TIMEOUT_MS,
  })
  pool.on('error', () => { /* an idle client dying must never crash the server */ })
  return pool
}

module.exports = class EnoCacheHandler {
  constructor() {
    this.pg = Boolean(process.env.K_SERVICE && process.env.DATABASE_URL)
  }

  async get(key) {
    if (!this.pg) {
      const entry = memEntries.get(K(key))
      if (!entry) return null
      for (const tag of entry.tags) {
        const s = memTags.get(T(tag))
        if (s != null && s >= entry.lastModified) return null
      }
      return { lastModified: entry.lastModified, value: entry.value }
    }
    try {
      const { rows } = await withTimeout(getPool().query(
        'select entry from next_cache where key = $1 and expires_at > now()', [K(key)]))
      const entry = rows[0]?.entry
      if (!entry) return null
      const tags = Array.isArray(entry.tags) ? entry.tags : []
      if (tags.length) {
        const { rows: dead } = await withTimeout(getPool().query(
          'select 1 from next_cache_tag where tag = any($1) and stamp >= $2 limit 1',
          [tags.map(T), Number(entry.lastModified)]))
        if (dead.length) return null // tombstoned since stored
      }
      return { lastModified: entry.lastModified, value: decodeValue(entry.value) }
    } catch { return null }
  }

  async set(key, value, ctx = {}) {
    if (!this.pg) {
      const tags = [...new Set(Array.isArray(ctx.tags) ? ctx.tags : [])].filter(Boolean)
      if (memEntries.size >= MEM_MAX) memEntries.delete(memEntries.keys().next().value)
      memEntries.set(K(key), { lastModified: Date.now(), tags, value })
      return
    }
    try {
      const tags = [
        ...(Array.isArray(ctx.tags) ? ctx.tags : []),
        ...(Array.isArray(value?.headers?.['x-next-cache-tags']?.split?.(',')) ? value.headers['x-next-cache-tags'].split(',') : []),
      ]
      // Next 16 carries the revalidate hint in different places per entry kind:
      // route/page entries → ctx.cacheControl.revalidate, fetch entries → the
      // value itself; plain ctx.revalidate is legacy. Check all three or every
      // entry silently retains for the 30d maximum (review 2026-07-20).
      const revalidate = [ctx.revalidate, ctx.cacheControl && ctx.cacheControl.revalidate, value && value.revalidate]
        .find((r) => typeof r === 'number' && r > 0) ?? null
      const ttl = Math.min(MAX_TTL_S, revalidate ? revalidate + 6 * 3600 : MAX_TTL_S)
      const entry = { lastModified: Date.now(), tags: [...new Set(tags)].filter(Boolean), value: encodeValue(value) }
      await withTimeout(getPool().query(
        `insert into next_cache (key, entry, expires_at)
         values ($1, $2::jsonb, now() + make_interval(secs => $3))
         on conflict (key) do update set entry = excluded.entry, expires_at = excluded.expires_at`,
        [K(key), JSON.stringify(entry), ttl]))
    } catch { /* cache write is best-effort */ }
  }

  async revalidateTag(tags) {
    const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean)
    if (!this.pg) {
      for (const tag of list) memTags.set(T(tag), Math.max(memTags.get(T(tag)) || 0, Date.now()))
      return
    }
    try {
      // greatest(): a delayed invalidation must never move a tombstone BACKWARD —
      // that would revive entries a newer invalidation already killed (review
      // 2026-07-20).
      await withTimeout(getPool().query(
        `insert into next_cache_tag (tag, stamp, expires_at)
         select t, $2, now() + make_interval(secs => $3) from unnest($1::text[]) as t
         on conflict (tag) do update set
           stamp = greatest(next_cache_tag.stamp, excluded.stamp),
           expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
        [list.map(T), Date.now(), TAG_TTL_S]))
    } catch { /* a failed purge self-heals via entry TTL */ }
  }

  // Per-request dedupe memory — nothing to reset in this implementation.
  resetRequestCache() {}
}
