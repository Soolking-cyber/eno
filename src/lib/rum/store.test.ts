import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The page-speed batching (src/lib/rum/store.ts): beacons add to an in-process map; ONE statement per flush writes it.
 * ⛔ What must hold: rows merge by key, a failed write is re-added exactly once (never double-counted), a missing
 * table drops the batch with one log line, the retention delete can never re-add a written batch, rows go out in key
 * order (two processes cannot deadlock), and the in-memory limiter forgets an address after its minute.
 */

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  fail: null as null | Error,
  failPrune: false,
  logged: [] as Array<{ e: unknown; op?: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown, ctx?: { op?: string }) => { h.logged.push({ e, op: ctx?.op }) } }))
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      h.calls.push({ sql, values })
      if (sql.includes('insert') && h.fail) return Promise.reject(h.fail)
      if (sql.includes('delete') && h.failPrune) return Promise.reject(new Error('prune failed'))
      return Promise.resolve(1)
    },
  },
}))

const { __resetRumStore, allowBeacon, flushRum, recordRumOps } = await import('./store')

const op = (family: string, dims: string, bucket: number, delta: 1 | -1 = 1) => ({ family, dims, bucket, delta })
const inserts = () => h.calls.filter((c) => c.sql.includes('insert'))

beforeEach(() => { __resetRumStore(); h.calls = []; h.fail = null; h.failPrune = false; h.logged = [] })
afterEach(() => { __resetRumStore() })

describe('recordRumOps + flushRum', () => {
  it('merges ops by key and writes them in ONE statement, in key order, with zero-sum rows left out', async () => {
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100), op('lcp', 'home|x', 2000), op('inp', 'home|x', 100)])
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100), op('inp', 'home|x', 100, -1), op('edge', 'HKG|HIT', 100)])
    const r = await flushRum(Date.parse('2026-10-16T05:00:00Z'))
    expect(r).toEqual({ rows: 3, dropped: 0 })
    expect(inserts()).toHaveLength(1)
    const [days, editions, families, dims, buckets, ns] = inserts()[0].values as unknown[][]
    expect(families).toEqual(['edge', 'lcp', 'ttfb'])
    expect(ns).toEqual([1, 1, 2])
    expect(dims).toEqual(['HKG|HIT', 'home|x', 'home|x'])
    expect(buckets).toEqual([100, 2000, 100])
    expect(new Set(days)).toEqual(new Set(['2026-10-16']))
    expect(new Set(editions)).toEqual(new Set(['marketplace']))
    // Totals are ADDED on conflict, never overwritten.
    expect(inserts()[0].sql).toMatch(/on conflict \(day, edition, family, dims, bucket\) do update set n = rum_daily\.n \+ excluded\.n/)
    // …and a decrement only lowers an existing row, never below zero (proved on a real database: store.it.test.ts).
    expect(inserts()[0].sql).toMatch(/where n > 0/)
    expect(inserts()[0].sql).toMatch(/greatest\(0, r\.n \+ t\.n\)/)
  })

  it('a failed write is re-added once and lands on the next flush — counted exactly once', async () => {
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    h.fail = new Error('connection reset')
    expect(await flushRum()).toBeNull()
    expect(h.logged.map((l) => l.op)).toEqual(['rum.flush'])
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    h.fail = null
    await flushRum()
    expect(inserts().at(-1)!.values[5]).toEqual([2])
  })

  it('a move\'s op carries its own day: the row is the first beacon\'s day, not today\'s', async () => {
    recordRumOps('2026-10-17', 'marketplace', [{ family: 'inp', dims: 'home|x', bucket: 100, delta: -1, day: '2026-10-16' }, op('ttfb', 'home|x', 100)])
    await flushRum(Date.parse('2026-10-17T05:00:00Z'))
    const [days, , families] = inserts()[0].values as unknown[][]
    expect(Object.fromEntries((families as string[]).map((f, i) => [f, (days as string[])[i]]))).toEqual({ inp: '2026-10-16', ttfb: '2026-10-17' })
  })

  it('⛔ a failed write whose rows no longer fit counts them as dropped — never lost silently', async () => {
    const { MAX_PENDING_ROWS } = await import('./store')
    recordRumOps('2026-10-16', 'marketplace', [op('lcp', 'home|failed', 2000)])
    h.fail = new Error('connection reset')
    // While the write is in flight, new beacons fill the map.
    const writing = flushRum()
    recordRumOps('2026-10-16', 'marketplace', Array.from({ length: MAX_PENDING_ROWS }, (_, i) => op('ttfb', `home|${i}`, 100)))
    await writing
    h.fail = null
    expect(await flushRum()).toEqual({ rows: MAX_PENDING_ROWS, dropped: 1 })
  })

  it('⛔ the overflow count survives a failed write (and is logged once the write succeeds)', async () => {
    const { MAX_PENDING_ROWS } = await import('./store')
    recordRumOps('2026-10-16', 'marketplace', Array.from({ length: MAX_PENDING_ROWS + 3 }, (_, i) => op('ttfb', `home|${i}`, 100)))
    h.fail = new Error('connection reset')
    await flushRum()
    h.fail = null
    expect(await flushRum()).toEqual({ rows: MAX_PENDING_ROWS, dropped: 3 })
  })

  it('no table yet (the DDL runs before the deploy): the batch is dropped, never re-added, and logged every 10 minutes', async () => {
    h.fail = Object.assign(new Error('relation "rum_daily" does not exist'), { code: '42P01' })
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    await flushRum()
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    await flushRum()
    expect(h.logged.map((l) => l.op)).toEqual(['rum.flush.no-table'])
    // …and again ten minutes on, so a deploy that ran before its DDL cannot look healthy for days.
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    await flushRum(Date.now() + 10 * 60_000)
    expect(h.logged.map((l) => l.op)).toEqual(['rum.flush.no-table', 'rum.flush.no-table'])
    h.fail = null
    await flushRum()
    expect(inserts()).toHaveLength(3) // the last flush had nothing to write: no dropped batch came back
  })

  it('⛔ a failing retention delete never re-adds the batch it follows', async () => {
    h.failPrune = true
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|x', 100)])
    await flushRum(Date.parse('2026-10-16T05:00:00Z'))
    expect(h.logged.map((l) => l.op)).toEqual(['rum.prune'])
    await flushRum(Date.parse('2026-10-16T05:00:30Z'))
    expect(inserts()).toHaveLength(1)
  })

  it('retention runs once per Vietnamese day and deletes rows older than 400 days', async () => {
    await flushRum(Date.parse('2026-10-16T05:00:00Z'))
    await flushRum(Date.parse('2026-10-16T06:00:00Z'))
    await flushRum(Date.parse('2026-10-16T17:30:00Z')) // 00:30 on the 17th in Vietnam
    const deletes = h.calls.filter((c) => c.sql.includes('delete'))
    expect(deletes.map((d) => d.values[0])).toEqual(['2025-09-11', '2025-09-12'])
  })

  it('caps the map: past MAX_PENDING_ROWS new rows are dropped (and logged), existing rows keep counting', async () => {
    const { MAX_PENDING_ROWS } = await import('./store')
    const ops = Array.from({ length: MAX_PENDING_ROWS }, (_, i) => op('ttfb', `home|${i}`, 100))
    recordRumOps('2026-10-16', 'marketplace', ops)
    recordRumOps('2026-10-16', 'marketplace', [op('ttfb', 'home|new', 100), op('ttfb', 'home|0', 100)])
    const r = await flushRum()
    expect(r).toEqual({ rows: MAX_PENDING_ROWS, dropped: 1 })
    const [, , , dims, , ns] = inserts()[0].values as unknown[][]
    expect(ns[(dims as string[]).indexOf('home|0')]).toBe(2)
    expect(h.logged.map((l) => l.op)).toEqual(['rum.flush'])
  })
})

describe('limiterKey — what one sender is', () => {
  it('an IPv4 address as is; an IPv6 address by its /64 (rotating inside it buys nothing); a mapped IPv4 as IPv4', async () => {
    const { limiterKey } = await import('./store')
    expect(limiterKey('203.0.113.7')).toBe('203.0.113.7')
    for (const a of ['2001:db8:1:2:3:4:5:6', '2001:DB8:1:2::9', '2001:0db8:0001:0002:aaaa::1', '2001:db8:1:2::']) expect(limiterKey(a), a).toBe('2001:db8:1:2::/64')
    expect(limiterKey('2001:db8:1:3::9')).toBe('2001:db8:1:3::/64')
    expect(limiterKey('::ffff:198.51.100.1')).toBe('198.51.100.1')
    expect(limiterKey('::1')).toBe('0:0:0:0::/64')
  })
})

describe('allowBeacon — the in-memory limit', () => {
  it('admits perMinute beacons per address per minute, then refuses until the minute is over', () => {
    const t = 1_000_000
    for (let i = 0; i < 3; i++) expect(allowBeacon('203.0.113.7', 3, t + i)).toBe(true)
    expect(allowBeacon('203.0.113.7', 3, t + 10)).toBe(false)
    expect(allowBeacon('198.51.100.1', 3, t + 10)).toBe(true)
    expect(allowBeacon('203.0.113.7', 3, t + 60_001)).toBe(true)
  })

  it('a flush forgets every address whose minute is over', async () => {
    const t = Date.now()
    allowBeacon('203.0.113.7', 3, t - 120_000)
    allowBeacon('203.0.113.7', 3, t - 119_000)
    allowBeacon('203.0.113.7', 3, t - 118_000)
    expect(allowBeacon('203.0.113.7', 3, t - 117_000)).toBe(false)
    await flushRum(t)
    // Forgotten: a fresh window, even at a time the old window would still have covered.
    expect(allowBeacon('203.0.113.7', 3, t - 116_000)).toBe(true)
  })
})
