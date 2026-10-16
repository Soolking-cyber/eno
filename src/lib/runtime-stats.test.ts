import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * [eno-runtime] (src/lib/runtime-stats.ts, speed plan item 5): one JSON line per 10 minutes — event-loop delay
 * beyond the 20 ms timer, memory, and the Prisma pool's queue as sampled every 250 ms.
 */

const G = globalThis as unknown as { __enoRuntimeStats?: boolean; enoPgPool?: { totalCount: number; idleCount: number; waitingCount: number } }

beforeEach(() => { vi.useFakeTimers(); delete G.__enoRuntimeStats; delete G.enoPgPool })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete G.__enoRuntimeStats; delete G.enoPgPool })

describe('lagMs', () => {
  it('subtracts the timer\'s own 20 ms interval (Node records the whole interval) and never goes negative', async () => {
    const { lagMs } = await import('./runtime-stats')
    expect(lagMs(20_611_071)).toBe(0.6)
    expect(lagMs(161_087_487)).toBe(141.1)
    expect(lagMs(19_000_000)).toBe(0)
  })
})

describe('startRuntimeStats', () => {
  it('logs one line per window with the pool\'s queue, then resets — and starts only once per process', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { startRuntimeStats } = await import('./runtime-stats')
    G.enoPgPool = { totalCount: 4, idleCount: 1, waitingCount: 0 }
    startRuntimeStats()
    startRuntimeStats()
    await vi.advanceTimersByTimeAsync(60_000)
    G.enoPgPool.waitingCount = 3
    G.enoPgPool.idleCount = 0
    await vi.advanceTimersByTimeAsync(1_000) // 4 samples with a queue
    G.enoPgPool.waitingCount = 0
    G.enoPgPool.idleCount = 1
    await vi.advanceTimersByTimeAsync(9 * 60_000 - 1_000 + 1)
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[eno-runtime] '))
    expect(lines).toHaveLength(1)
    const s = JSON.parse(lines[0].slice('[eno-runtime] '.length))
    expect(s.pool).toMatchObject({ total: 4, idle: 1, busyMax: 4, waitingMax: 3 })
    expect(s.pool.waitingPct).toBeGreaterThan(0)
    expect(s.pool.waitingPct).toBeLessThan(1)
    for (const k of ['lagP50', 'lagP99', 'lagMax', 'elu', 'rssMB', 'heapMB']) expect(typeof s[k], k).toBe('number')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const next = JSON.parse(log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[eno-runtime] '))[1].slice(14))
    expect(next.pool).toMatchObject({ waitingMax: 0, waitingPct: 0 })
  })

  it('no pool on globalThis (the config-form fallback in db.ts): the line still comes, with pool null', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { startRuntimeStats } = await import('./runtime-stats')
    startRuntimeStats()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[eno-runtime] '))!
    expect(JSON.parse(line.slice(14)).pool).toBeNull()
  })
})
