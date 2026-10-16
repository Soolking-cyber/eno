import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { vnDay } from '@/lib/signup-prompt'
import type { RumOp } from './ops'

// ── Page-speed totals: the server's batching half (speed plan item 5, 2026-10-16) ───────────────────────────
//
// Each beacon adds to an in-process map; every 30 s ONE statement adds the whole map into `rum_daily`
// (scripts/rum-ddl.mjs — a LOGGED table, outside Prisma like apple_siwa_token). A beacon therefore never touches the
// database: neither the totals nor the rate limit (in-process too — see allowBeacon).
// ⚠️ What a restart loses: the map's last ≤30 s. Next has no hook this can safely flush from on SIGTERM (adding a
// SIGTERM listener changes how the process exits), and a counter is not worth that risk.
// ⚠️ Totals are only ever ADDED (+1, and −1/+1 for a CLS/INP that grew after its first beacon — ops.ts), so two
// processes flushing the same row merge correctly. Inserts go in key order; the decrement UPDATE locks in join order,
// so two processes of ONE edition could still deadlock on a shared row — the loser's statement fails, its batch is
// re-added and lands on the next flush. (Today each edition runs one process, and the editions never share a row.)

export type RumKey = { day: string; edition: string } & Pick<RumOp, 'family' | 'dims' | 'bucket'>

/** Distinct rows the map holds before new ones are dropped until the next flush (existing rows keep counting). */
export const MAX_PENDING_ROWS = 20_000
export const FLUSH_EVERY_MS = 30_000
/** ~13 months, as /privacy says — the signup counters' 400 days. */
export const RETENTION_DAYS = 400

type Pending = Map<string, { key: RumKey; n: number }>

type Store = {
  pending: Pending
  dropped: number
  timer: ReturnType<typeof setInterval> | null
  flushing: boolean
  lastPruneDay: string
  missingTableLoggedAt: number
  limiter: Map<string, { n: number; until: number }>
}

// One store per process, also across the bundles Next splits server code into.
const G = globalThis as unknown as { __enoRumStore?: Store }
function store(): Store {
  return (G.__enoRumStore ??= {
    pending: new Map(), dropped: 0, timer: null, flushing: false, lastPruneDay: '', missingTableLoggedAt: -Infinity, limiter: new Map(),
  })
}

const idOf = (k: RumKey) => `${k.day}\u0001${k.edition}\u0001${k.family}\u0001${k.dims}\u0001${k.bucket}`

/**
 * The abuse limit, in memory: at most `perMinute` beacons per IP per minute. A page view sends one beacon plus one
 * per later hide, so a real visitor stays far under it. The IP lives here until its minute is over and the next flush
 * (≤30 s later) forgets it, and it is never written anywhere; past 50,000 addresses the whole map is dropped (a fresh
 * minute for everyone beats unbounded memory).
 */
export function allowBeacon(ip: string, perMinute: number, now: number = Date.now()): boolean {
  const s = store()
  const hit = s.limiter.get(ip)
  if (!hit || hit.until <= now) {
    if (s.limiter.size >= 50_000) s.limiter.clear()
    s.limiter.set(ip, { n: 1, until: now + 60_000 })
    return true
  }
  hit.n += 1
  return hit.n <= perMinute
}

/**
 * The limiter's key: an IPv4 address as is, an IPv6 one by its /64 — one subscriber's whole allocation, which a sender
 * can rotate through freely, so per-address keys would not limit it at all (commit-gate review, opus). An IPv4-mapped
 * IPv6 address (::ffff:1.2.3.4) is its IPv4 address.
 */
export function limiterKey(ip: string): string {
  const a = ip.trim().toLowerCase()
  if (!a.includes(':')) return a
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a)
  if (mapped) return mapped[1]
  const [head, tail = ''] = a.split('::')
  const h = head ? head.split(':') : []
  const t = a.includes('::') ? (tail ? tail.split(':') : []) : []
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  if (groups.length < 4) return a
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/** Adds one beacon's ops to the map and makes sure the flush timer runs. */
export function recordRumOps(day: string, edition: string, ops: RumOp[]): void {
  const s = store()
  for (const op of ops) {
    // A CLS/INP move belongs to the day its FIRST beacon was counted on (ops.ts `day`), not to the day it arrives.
    const key: RumKey = { day: op.day ?? day, edition, family: op.family, dims: op.dims, bucket: op.bucket }
    const id = idOf(key)
    const row = s.pending.get(id)
    if (row) { row.n += op.delta; continue }
    if (s.pending.size >= MAX_PENDING_ROWS) { s.dropped += 1; continue }
    s.pending.set(id, { key, n: op.delta })
  }
  if (!s.timer) {
    s.timer = setInterval(() => { void flushRum() }, FLUSH_EVERY_MS)
    // Never keep the process alive for a counter.
    s.timer.unref?.()
  }
}

/** The VN day `RETENTION_DAYS` ago: rows older than this go. */
const retentionCutoff = (todayVn: string) => new Date(Date.parse(`${todayVn}T00:00:00Z`) - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10)

/**
 * Writes the map in ONE statement and empties it. Overlapping calls are refused (the interval keeps ticking while
 * a slow write runs). A failed write puts its rows back once — the statement is one transaction, so a failure wrote
 * nothing and re-adding cannot double-count — except when the table does not exist yet (the DDL runs before the
 * deploy; until it has, totals are dropped and that is logged every 10 minutes).
 */
export async function flushRum(now: number = Date.now()): Promise<{ rows: number; dropped: number } | null> {
  const s = store()
  // The limiter forgets an address once its minute is over (so an IP is held ~1–1.5 min, never longer).
  for (const [ip, hit] of s.limiter) if (hit.until <= now) s.limiter.delete(ip)
  if (s.flushing) return null
  s.flushing = true
  const batch = s.pending
  const dropped = s.dropped
  s.pending = new Map()
  s.dropped = 0
  let written = 0
  try {
    const rows = [...batch.values()].filter((r) => r.n !== 0).sort((a, b) => (idOf(a.key) < idOf(b.key) ? -1 : 1))
    if (rows.length) {
      try {
        // ⛔ ONE statement (so a failure wrote nothing): positive rows upsert-ADD; negative ones (a CLS/INP "move" —
        // or a forged one, since anyone can POST: commit-gate review) only lower an EXISTING row, never below zero,
        // and never create one.
        await db.$executeRaw`
          with t as (
            select * from unnest(
              ${rows.map((r) => r.key.day)}::date[], ${rows.map((r) => r.key.edition)}::text[],
              ${rows.map((r) => r.key.family)}::text[], ${rows.map((r) => r.key.dims)}::text[],
              ${rows.map((r) => r.key.bucket)}::int[], ${rows.map((r) => r.n)}::bigint[]
            ) as t(day, edition, family, dims, bucket, n)
          ), up as (
            insert into rum_daily (day, edition, family, dims, bucket, n)
            select day, edition, family, dims, bucket, n from t where n > 0
            on conflict (day, edition, family, dims, bucket) do update set n = rum_daily.n + excluded.n
          )
          update rum_daily r set n = greatest(0, r.n + t.n)
            from t
           where t.n < 0 and r.day = t.day and r.edition = t.edition and r.family = t.family and r.dims = t.dims and r.bucket = t.bucket`
        written = rows.length
      } catch (e) {
        s.dropped += dropped // the overflow count survives a failed write too (commit-gate review, both seats)
        if (isMissingTable(e)) {
          // Every 10 minutes, not once: a deploy that ran before its DDL must not look healthy for days (codex).
          if (now - s.missingTableLoggedAt >= 10 * 60_000) { s.missingTableLoggedAt = now; logError(e, { op: 'rum.flush.no-table' }) }
        } else {
          for (const [id, row] of batch) {
            const cur = s.pending.get(id)
            if (cur) cur.n += row.n
            else if (s.pending.size < MAX_PENDING_ROWS) s.pending.set(id, row)
            else s.dropped += 1 // logged by the next flush, like any other overflow (commit-gate review, codex)
          }
          logError(e, { op: 'rum.flush' })
        }
        return null
      }
    }
    if (dropped) logError(new Error(`page-speed: ${dropped} ops dropped — the pending map was full (${MAX_PENDING_ROWS} rows)`), { op: 'rum.flush' })
    // Retention, once per VN day per process — its own statement, so a failure here can never re-add a written batch.
    const today = vnDay(now)
    if (s.lastPruneDay !== today) {
      s.lastPruneDay = today
      await db.$executeRaw`delete from rum_daily where day < ${retentionCutoff(today)}::date`.catch((e: unknown) => {
        if (!isMissingTable(e)) logError(e, { op: 'rum.prune' })
      })
    }
    return { rows: written, dropped }
  } finally {
    s.flushing = false
  }
}

function isMissingTable(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string } | null
  if (err?.meta?.code === '42P01' || err?.code === '42P01') return true
  const msg = String(err?.message ?? '')
  return msg.includes('rum_daily') && msg.includes('does not exist')
}

/** Tests only: a fresh store. */
export function __resetRumStore(): void {
  const s = G.__enoRumStore
  if (s?.timer) clearInterval(s.timer)
  G.__enoRumStore = undefined
}
