import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * rum_daily on a REAL Postgres — the flush's one statement (positive rows upsert-add; negative ones only lower an
 * existing row, never below zero, never create one) and the retention delete. Unit tests fake Prisma; this SQL only
 * proves itself on a database.
 *
 *   createdb eno_rum_it && DIRECT_URL=postgresql://…/eno_rum_it node scripts/rum-ddl.mjs   # NOLOGIN anon/authenticated/service_role first
 *   RUM_IT_DATABASE_URL=postgresql://…/eno_rum_it npx vitest run src/lib/rum/store.it.test.ts
 *
 * ⛔ GUARDED BY THE DATABASE NAME, NEVER BY "localhost": production is reached through an SSH tunnel on localhost too.
 * Skipped unless the URL names a `*_it` database, and `current_database()` is checked again before the first write.
 */

const URL_IT = process.env.RUM_IT_DATABASE_URL || ''
const enabled = /\/[a-z0-9_]+_it(\?|$)/.test(URL_IT)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { throw e instanceof Error ? e : new Error(String(e)) } }))

describe.skipIf(!enabled)('rum_daily — the real statement on a scratch *_it database', () => {
  let db: typeof import('@/lib/db').db
  let store: typeof import('./store')
  const at = Date.parse('2026-10-16T05:00:00Z')
  const op = (dims: string, bucket: number, delta: 1 | -1 = 1) => ({ family: 'inp', dims, bucket, delta })
  const n = async (dims: string, bucket: number) => {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`select n from rum_daily where day = '2026-10-16' and edition = 'it' and family = 'inp' and dims = ${dims} and bucket = ${bucket}`
    return rows.length ? Number(rows[0].n) : null
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_IT
    ;({ db } = await import('@/lib/db'))
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`select current_database() as name`
    if (!name.endsWith('_it')) throw new Error(`refusing to write to ${name}`)
    await db.$executeRaw`delete from rum_daily where edition = 'it'`
    store = await import('./store')
  }, 60_000)
  afterAll(async () => {
    if (db) await db.$executeRaw`delete from rum_daily where edition = 'it'`
    store?.__resetRumStore()
  })

  it('positive rows insert, then ADD on the next flush', async () => {
    store.recordRumOps('2026-10-16', 'it', [op('home|x', 100), op('home|x', 100), op('home|x', 300)])
    expect(await store.flushRum(at)).toEqual({ rows: 2, dropped: 0 })
    store.recordRumOps('2026-10-16', 'it', [op('home|x', 100)])
    await store.flushRum(at)
    expect(await n('home|x', 100)).toBe(3)
    expect(await n('home|x', 300)).toBe(1)
  })

  it('a move lowers the old bucket and raises the new one — in the same statement', async () => {
    store.recordRumOps('2026-10-16', 'it', [op('home|x', 100, -1), op('home|x', 500)])
    await store.flushRum(at)
    expect(await n('home|x', 100)).toBe(2)
    expect(await n('home|x', 500)).toBe(1)
  })

  it('⛔ a decrement never goes below zero, and never creates a row', async () => {
    store.recordRumOps('2026-10-16', 'it', Array.from({ length: 5 }, () => op('home|x', 300, -1)))
    store.recordRumOps('2026-10-16', 'it', [op('home|forged', 100, -1)])
    await store.flushRum(at)
    expect(await n('home|x', 300)).toBe(0)
    expect(await n('home|forged', 100)).toBeNull()
  })

  it('retention deletes rows older than 400 days, once per Vietnamese day', async () => {
    await db.$executeRaw`insert into rum_daily (day, edition, family, dims, bucket, n) values ('2025-09-10', 'it', 'inp', 'old|x', 0, 7), ('2025-09-11', 'it', 'inp', 'edge|x', 0, 1)`
    store.__resetRumStore()
    await store.flushRum(at)
    const left = await db.$queryRaw<Array<{ day: Date }>>`select day from rum_daily where edition = 'it' and dims in ('old|x', 'edge|x')`
    expect(left.map((r) => r.day.toISOString().slice(0, 10))).toEqual(['2025-09-11'])
  })
})
