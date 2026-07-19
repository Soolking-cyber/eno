// Shared ISR/data cache backed by Upstash Redis — the cross-instance correctness
// layer that lets Cloud Run scale eno-vn past ONE instance (audit: revalidatePath
// with Next's default filesystem cache only purges the serving instance; a sold or
// moderated listing page must vanish EVERYWHERE, and its revalidate window is 30d).
//
// Design (tombstone tags, no key-sets):
// · Entries live under  eno:isr:<buildId>:<key>  → { lastModified, tags, value }
//   with Buffers (html/rsc/body) base64-encoded for JSON transport. buildId in the
//   prefix keeps RSC payloads build-consistent; orphaned old-build keys expire via TTL.
// · revalidateTag(tag) writes a TOMBSTONE timestamp under eno:isrtag:<tag>; get()
//   compares the entry's lastModified against its tags' tombstones (one MGET) and
//   treats older entries as misses. revalidatePath flows through this too (Next maps
//   paths to internal _N_T_/<path> tags).
// · EVERY op is failure-tolerant with a hard timeout: Redis down ⇒ behave like a
//   cache miss / no-op. Never throw into the render path.
// · next.config sets cacheMaxMemorySize: 0 when this handler is active — the default
//   in-memory L1 would serve stale entries WITHOUT consulting the tombstones.
//
// DUAL MODE (the standalone server EMBEDS the build-time config, so runtime env
// can't choose whether a handler exists — the handler itself chooses):
// · On Cloud Run (K_SERVICE set) → Redis, the shared cross-instance cache.
// · Everywhere else (local dev/build/e2e, Cloud Build) → an in-process Map with the
//   SAME tombstone semantics: correct for a single instance, no cross-ocean RTT
//   (locally every cached render was paying Mac↔Singapore latency — e2e died).
// Build-time prerenders land in the throwaway Map; prod first-hits re-render once
// and converge into Redis. CJS on purpose: Next requires the handler synchronously.

const { Redis } = require('@upstash/redis')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const TIMEOUT_MS = 500
const TAG_TTL_S = 60 * 60 * 24 * 35 // outlive the longest page TTL below
const MAX_TTL_S = 60 * 60 * 24 * 30 // our longest revalidate (listing pages) is 30d

let buildId = 'unknown'
try { buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { /* dev server */ }

const K = (key) => `eno:isr:${buildId}:${key}`
const T = (tag) => `eno:isrtag:${tag}` // tombstones are build-agnostic on purpose

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('redis_timeout')), TIMEOUT_MS))])

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

module.exports = class EnoCacheHandler {
  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    this.redis = process.env.K_SERVICE && url && token ? new Redis({ url, token }) : null
  }

  async get(key) {
    if (!this.redis) {
      const entry = memEntries.get(K(key))
      if (!entry) return null
      for (const tag of entry.tags) {
        const s = memTags.get(T(tag))
        if (s != null && s >= entry.lastModified) return null
      }
      return { lastModified: entry.lastModified, value: entry.value }
    }
    try {
      const raw = await withTimeout(this.redis.get(K(key)))
      if (!raw) return null
      const entry = typeof raw === 'string' ? JSON.parse(raw) : raw
      const tags = Array.isArray(entry.tags) ? entry.tags : []
      if (tags.length) {
        const stamps = await withTimeout(this.redis.mget(...tags.map(T)))
        for (const s of stamps) {
          if (s != null && Number(s) >= Number(entry.lastModified)) return null // tombstoned since stored
        }
      }
      return { lastModified: entry.lastModified, value: decodeValue(entry.value) }
    } catch { return null }
  }

  async set(key, value, ctx = {}) {
    if (!this.redis) {
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
      const revalidate = typeof ctx.revalidate === 'number' && ctx.revalidate > 0 ? ctx.revalidate : null
      const ttl = Math.min(MAX_TTL_S, revalidate ? revalidate + 6 * 3600 : MAX_TTL_S)
      const entry = { lastModified: Date.now(), tags: [...new Set(tags)].filter(Boolean), value: encodeValue(value) }
      await withTimeout(this.redis.set(K(key), JSON.stringify(entry), { ex: ttl }))
    } catch { /* cache write is best-effort */ }
  }

  async revalidateTag(tags) {
    const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean)
    if (!this.redis) {
      for (const tag of list) memTags.set(T(tag), Date.now())
      return
    }
    try {
      await withTimeout(Promise.all(list.map((tag) => this.redis.set(T(tag), Date.now(), { ex: TAG_TTL_S }))))
    } catch { /* a failed purge self-heals via entry TTL */ }
  }

  // Per-request dedupe memory — nothing to reset in this implementation.
  resetRequestCache() {}
}
