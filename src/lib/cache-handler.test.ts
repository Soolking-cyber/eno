import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * cache-handler.cjs — the ISR handler's tombstone sync (speed plan item 4, 2026-10-16).
 *
 * Measured before the change: get() awaited a re-read of the WHOLE next_cache_tag table (86,795 rows,
 * 5.4 MB) every 3 s, so one origin cache HIT in six stalled 250–450 ms (p90 268 ms, p95 308 ms, p50 14 ms).
 * These pin the replacement: a read never waits for a sync while the snapshot is younger than 30 s, the
 * sync asks only for the tags of entries L1 holds (not older than the oldest one), and invalidation still
 * works — across processes, during an in-flight sync, and fails safe when Postgres is down.
 */
const require = createRequire(import.meta.url)
const PATH = require.resolve('../../cache-handler.cjs')

type Row = { tag: string; stamp: number }
type Call = { sql: string; params: unknown[] }
type Handler = {
  get(key: string): Promise<{ lastModified: number; value: unknown } | null>
  set(key: string, value: unknown, ctx?: { tags?: string[] }): Promise<void>
  revalidateTag(tags: string | string[]): Promise<void>
}

let calls: Call[]
let answer: (call: Call) => Promise<{ rows: Row[] }>

function load(): Handler {
  delete require.cache[PATH] // module-level L1 and tag map: a fresh copy per test
  const Cls = require(PATH)
  Cls.pool = {
    query: (sql: string, params: unknown[] = []) => {
      const call = { sql, params }
      calls.push(call)
      return answer(call)
    },
  }
  return new Cls() as Handler
}

const tagQueries = () => calls.filter((c) => /from next_cache_tag/.test(c.sql) && /select tag, stamp/.test(c.sql))
const page = (html = 'x') => ({ kind: 'APP_PAGE', html: Buffer.from(html) })

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.stubEnv('ENO_ISR_PG', '1')
  vi.stubEnv('DATABASE_URL', 'postgres://test/none')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  calls = []
  answer = async () => ({ rows: [] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('cache-handler — the tombstone sync is bounded by L1 and runs behind the request', () => {
  it('a read never waits for the sync while the snapshot is younger than TAG_WAIT_MS (5 s)', async () => {
    const h = load()
    await h.get('warm') // first read: the snapshot is empty, L1 is empty — nothing to wait for
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/a'] })
    vi.setSystemTime(1_000_000 + 4_000) // past TAG_REFRESH_MS (3 s), not TAG_WAIT_MS (5 s)
    let release!: () => void
    answer = () => new Promise((r) => { release = () => r({ rows: [] }) }) // the sync hangs…
    const hit = await h.get('/p') // …and the read does not wait for it
    expect(hit?.value).toBeTruthy()
    expect(tagQueries()).toHaveLength(1) // but it was started
    release()
  })

  it('after a quiet spell (snapshot older than 5 s) the first read WAITS for the sync — cross-process lag stays ≤ ~5 s', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] }) // lastModified 1,000,000
    // Another process tombstoned it; this process has been idle for 8 s. The database answers after a REAL
    // 2 ms (setTimeout is not faked): an instant mock would resolve inside get()'s own await and hide a read
    // that did not wait (semantics review, 2026-10-16).
    answer = () => new Promise((r) => setTimeout(() => r({ rows: [{ tag: 'eno:isrtag:_N_T_/en/listings/p', stamp: 1_002_000 }] }), 2))
    vi.setSystemTime(1_000_000 + 8_000)
    expect(await h.get('/p')).toBeNull() // waited for the sync, saw the tombstone, did not serve the stale page
  })

  it('a timer syncs every 3 s with NO traffic — another process\'s purge is honoured without any read waiting', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] }) // lastModified 1,000,000
    answer = async () => ({ rows: [{ tag: 'eno:isrtag:_N_T_/en/listings/p', stamp: 1_001_000 }] })
    vi.advanceTimersByTime(3_000) // the timer fires on its own (Date advances with it)
    await vi.waitFor(() => expect(tagQueries().length).toBeGreaterThanOrEqual(1))
    await Promise.resolve(); await Promise.resolve()
    expect(await h.get('/p')).toBeNull()
  })

  it('a malformed lastModified never turns the sync into a failing query (oldest falls back to 0)', async () => {
    const h = load()
    await h.get('warm')
    vi.setSystemTime(Number.NaN) // set() stamps NaN — every entry in L1 malformed
    await h.set('/bad', page(), { tags: ['t2'] })
    vi.setSystemTime(1_000_000 + 4_000)
    await h.get('/bad')
    expect(tagQueries().at(-1)!.params[1]).toBe(0)
  })

  it('an L2 payload with no usable lastModified is a miss, never served (it could never be tombstoned)', async () => {
    vi.stubEnv('ENO_ISR_PG_PAYLOADS', '1')
    const h = load()
    answer = async (call) => /from next_cache c/.test(call.sql)
      ? { rows: [{ entry: { lastModified: 'garbage', tags: ['t'], value: { kind: 'APP_PAGE', html: 'x' } } }] } as never
      : { rows: [] }
    expect(await h.get('/from-l2')).toBeNull()
  })

  it('the sync asks only for the tags of entries held in L1, not older than the oldest entry', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/a', page(), { tags: ['_N_T_/layout', '_N_T_/en/listings/a'] })
    vi.setSystemTime(1_000_000 + 1_000)
    await h.set('/b', page(), { tags: ['_N_T_/layout', '_N_T_/en/listings/b'] })
    vi.setSystemTime(1_000_000 + 10_000)
    await h.get('/a')
    const q = tagQueries().at(-1)!
    expect(q.sql).toMatch(/where tag = any\(\$1::text\[\]\) and stamp >= \$2/)
    expect(new Set(q.params[0] as string[])).toEqual(new Set([
      'eno:isrtag:_N_T_/layout', 'eno:isrtag:_N_T_/en/listings/a', 'eno:isrtag:_N_T_/en/listings/b',
    ]))
    expect(q.params[1]).toBe(1_000_000) // the oldest entry's lastModified
    // ⛔ never the old full-table read
    expect(calls.some((c) => /select tag, stamp from next_cache_tag where expires_at > now\(\)$/.test(c.sql))).toBe(false)
  })

  it('an empty L1 sends no query at all', async () => {
    const h = load()
    await h.get('a'); vi.setSystemTime(1_000_000 + 10_000); await h.get('b')
    expect(tagQueries()).toHaveLength(0)
  })

  it('a tombstone written by ANOTHER process kills the entry after the next sync', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] }) // lastModified 1,000,000
    answer = async () => ({ rows: [{ tag: 'eno:isrtag:_N_T_/en/listings/p', stamp: 1_002_000 }] })
    vi.setSystemTime(1_000_000 + 4_000)
    await h.get('/p') // starts the background sync; this read may still be served from the old snapshot
    await vi.waitFor(() => expect(tagQueries()).toHaveLength(1))
    await Promise.resolve(); await Promise.resolve()
    expect(await h.get('/p')).toBeNull() // the next read sees the tombstone
  })

  it('a revalidateTag() during an in-flight sync is not lost when the sync lands without it (MERGE, never clear)', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] })
    vi.setSystemTime(1_000_000 + 4_000)
    let release!: () => void
    answer = (call) => /select tag, stamp/.test(call.sql)
      ? new Promise((r) => { release = () => r({ rows: [] }) }) // its snapshot predates the purge below
      : Promise.resolve({ rows: [] })
    await h.get('/p') // sync in flight, queryStart = 1,004,000
    vi.setSystemTime(1_000_000 + 4_500)
    await h.revalidateTag('_N_T_/en/listings/p') // write-through stamp 1,004,500
    // An entry older than that stamp arriving after the sweep — what an L2 load (old lastModified) looks like.
    // (Not the slow-render race: set() stamps Date.now(), so a render finishing after a purge is newer than
    // it; that pre-existing race is Next's contract, recorded in the eno-redis-to-postgres memory.)
    vi.setSystemTime(1_000_000 + 4_200)
    await h.set('/p2', page(), { tags: ['_N_T_/en/listings/p'] })
    release()
    await vi.waitFor(() => expect(tagQueries()).toHaveLength(1))
    await Promise.resolve(); await Promise.resolve()
    expect(await h.get('/p2')).toBeNull() // the local stamp survived a sync that did not contain it
  })

  it('a read that must wait never waits longer than ~1 s, even if the sync never settles (codex, gate round 2)', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['t'] })
    answer = () => new Promise(() => {}) // a query that never settles (the pool's own timeouts aside)
    vi.setSystemTime(1_000_000 + 8_000) // past TAG_WAIT_MS: this read has to wait…
    const t0 = performance.now()
    const got = await h.get('/p') // …but only up to TAG_WAIT_CAP_MS (real timers: setTimeout is not faked)
    expect(performance.now() - t0).toBeLessThan(1_900)
    expect(got).toBeTruthy() // 8 s old is inside TAG_MAX_STALE_MS: L1 is still trusted
  })

  it('a query that never settles stops syncs, never piles them up, and after 30 s L1 is not trusted (slow, not stale)', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] })
    answer = () => new Promise(() => {}) // a driver-level hang (the pool's own timeouts aside)
    vi.advanceTimersByTime(3_000)
    vi.advanceTimersByTime(30_000) // ten more ticks
    expect(tagQueries()).toHaveLength(1) // one stuck query — nothing piled onto the pool
    expect(await h.get('/p')).toBeNull() // 33 s without a good sync: re-render rather than risk a stale page
  })

  it('a synchronous throw inside the sync never escapes the timer (it would kill the process)', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['t'] })
    const Cls = require(PATH)
    Cls.pool = { query: () => { throw new Error('pool exploded') } }
    expect(() => vi.advanceTimersByTime(3_000)).not.toThrow()
  })

  it('a local revalidateTag() stamped just BEFORE a sync, whose INSERT commits after its snapshot, is not dropped (gate round 6)', async () => {
    vi.stubEnv('ENO_ISR_PG_PAYLOADS', '1') // the mode where an older entry can still arrive afterwards (an L2 load)
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] }) // lastModified 1,000,000
    vi.setSystemTime(1_000_000 + 3_999)
    await h.revalidateTag('_N_T_/en/listings/p') // local stamp 1,003,999 — its INSERT has not committed yet
    let release!: () => void
    answer = (call) => /select tag, stamp/.test(call.sql)
      ? new Promise((r) => { release = () => r({ rows: [] }) }) // the sync's snapshot does not contain it
      : /from next_cache c/.test(call.sql)
        ? Promise.resolve({ rows: [{ entry: { lastModified: 1_003_000, tags: ['_N_T_/en/listings/p'], value: { kind: 'APP_PAGE', html: 'old' } } }] } as never)
        : Promise.resolve({ rows: [] })
    vi.setSystemTime(1_000_000 + 4_000)
    await h.set('/q', page(), { tags: ['_N_T_/en/listings/q'] }) // keep L1 non-empty so the sync runs
    vi.advanceTimersByTime(3_000) // timer → sync at 1,007,000 (> the local stamp)
    release()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    // An L2 payload older than the local purge (its SQL ran before the INSERT committed) arrives…
    expect(await h.get('/p')).toBeNull() // …loads into L1 — and the next read must see it as purged:
    expect(await h.get('/p')).toBeNull()
  })

  it('the tag map stays bounded by L1: a stamp for an evicted entry is dropped at the next sync (opus, gate round 7)', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/a', page(), { tags: ['tag-a'] })
    answer = async () => ({ rows: [{ tag: 'eno:isrtag:tag-a', stamp: 1_000_500 }] })
    vi.advanceTimersByTime(3_000) // learns tag-a (it kills /a)
    await Promise.resolve(); await Promise.resolve()
    expect(await h.get('/a')).toBeNull() // /a purged and evicted; tag-a is no longer carried by anything
    await h.set('/b', page(), { tags: ['tag-b'] })
    answer = async () => ({ rows: [] })
    vi.advanceTimersByTime(3_000)
    await Promise.resolve(); await Promise.resolve()
    vi.advanceTimersByTime(10 * 60_000) // the stats line reports the map's size
    const line = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[eno-isr-cache] ')).at(-1)!
    expect(JSON.parse(line.slice('[eno-isr-cache] '.length)).tags).toBe(0)
  })

  it('Postgres down for longer than 30 s → L1 is not trusted (re-render), and a read waits only for the in-flight query', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['_N_T_/en/listings/p'] })
    answer = async () => { throw new Error('connection refused') }
    vi.setSystemTime(1_000_000 + 4_000)
    expect(await h.get('/p')).toBeTruthy() // 4 s old: still served from L1
    vi.setSystemTime(1_000_000 + 40_000)
    expect(await h.get('/p')).toBeNull() // 40 s without a good sync: fail safe, render instead
  })

  it('counts hits, misses and syncs, and logs one line every 10 minutes', async () => {
    const h = load()
    await h.get('warm')
    await h.set('/p', page(), { tags: ['t'] })
    await h.get('/p'); await h.get('/q')
    vi.advanceTimersByTime(10 * 60_000)
    const line = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[eno-isr-cache] '))
    expect(line).toBeTruthy()
    const s = JSON.parse(line!.slice('[eno-isr-cache] '.length))
    expect(s).toMatchObject({ hit: 1, set: 1, l1: 1 })
    expect(s.miss).toBeGreaterThanOrEqual(2)
  })
})
