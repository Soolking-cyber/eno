import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

// ── [eno-runtime]: the server half of field measurement (speed plan item 5, 2026-10-16) ─────────────────────
//
// One JSON line to stdout (docker logs) every 10 minutes, then the counters reset — the same shape and cadence as
// cache-handler.cjs's `[eno-isr-cache]` line (item 4), so the two read side by side:
//   lagP50/lagP99/lagMax  how late a 20 ms timer fired, in ms (the event loop was busy that long): a long render or a
//                         sync JSON parse blocks EVERY request this process is serving, and this is where it shows
//   elu                   event-loop utilisation over the window (0–1)
//   rssMB/heapMB          process memory (item 12's budget)
//   pool                  the Prisma pool (src/lib/db.ts puts it on globalThis): total/idle now, the most connections
//                         in use, and — sampled every 250 ms — the longest queue and the share of samples where any
//                         query waited for a connection. waitingPct > 0 means requests queue for the database.
// Started from src/instrumentation.ts register(), Node runtime only, never during `next build`. Every timer is
// unref'd and every tick guarded: a stats line must never keep the process alive or take it down.

const EVERY_MS = 10 * 60_000
const POOL_SAMPLE_MS = 250
const RESOLUTION_MS = 20

type PoolLike = { totalCount: number; idleCount: number; waitingCount: number }

const G = globalThis as unknown as { __enoRuntimeStats?: boolean; enoPgPool?: PoolLike }

/** Delay in ms beyond the timer's own interval (Node's histogram records the whole interval: ~20 ms when idle). */
export const lagMs = (ns: number): number => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 10) / 10)

export function startRuntimeStats(): void {
  if (G.__enoRuntimeStats) return
  G.__enoRuntimeStats = true
  const h = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
  h.enable()
  let elu = performance.eventLoopUtilization()
  let samples = 0
  let waiting = 0
  let waitingMax = 0
  let busyMax = 0

  setInterval(() => {
    try {
      const pool = G.enoPgPool
      if (!pool) return
      samples += 1
      if (pool.waitingCount > 0) waiting += 1
      if (pool.waitingCount > waitingMax) waitingMax = pool.waitingCount
      const busy = pool.totalCount - pool.idleCount
      if (busy > busyMax) busyMax = busy
    } catch { /* never take the process down */ }
  }, POOL_SAMPLE_MS).unref()

  setInterval(() => {
    try {
      const now = performance.eventLoopUtilization()
      const window = performance.eventLoopUtilization(now, elu)
      elu = now
      const mem = process.memoryUsage()
      const pool = G.enoPgPool
      console.log('[eno-runtime] ' + JSON.stringify({
        lagP50: lagMs(h.percentile(50)),
        lagP99: lagMs(h.percentile(99)),
        lagMax: lagMs(h.max),
        elu: Math.round(window.utilization * 1000) / 1000,
        rssMB: Math.round(mem.rss / 1048576),
        heapMB: Math.round(mem.heapUsed / 1048576),
        pool: pool
          ? { total: pool.totalCount, idle: pool.idleCount, busyMax, waitingMax, waitingPct: samples ? Math.round((1000 * waiting) / samples) / 10 : 0 }
          : null,
      }))
      h.reset()
      samples = 0
      waiting = 0
      waitingMax = 0
      busyMax = 0
    } catch { /* a stats line must never take the process down */ }
  }, EVERY_MS).unref()
}
