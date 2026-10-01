import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HIDE_SQL, RESTORABLE_SQL, RESTORE_SQL, SNAPSHOT_SQL, journaledHide, journaledRestore, rollbackPathArg, type HideDb } from './journaled-hide'

/**
 * THE JOURNALED HIDE (src/lib/journaled-hide.ts) — shared by scripts/hide-ad-banned.ts and the
 * importers' content screen. Pinned: only an ownerless storefront's imported row is ever written (in
 * the SQL, not only in the callers), the journal is on disk before the hide, the hide and the restore
 * are both conditional on the journaled state, and `--rollback --apply` without a path is an error.
 * (The SQL itself was also run against a throwaway Postgres 14 cluster on 2026-10-01 — see the report.)
 */

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'journaled-hide-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('the SQL carries every guard', () => {
  it('snapshot + hide: ownerless storefront, imported/linked row, live; the hide re-checks status AND updatedAt per row', () => {
    for (const sql of [SNAPSHOT_SQL, HIDE_SQL]) {
      expect(sql).toContain(`s."ownerId" IS NULL`)
      expect(sql).toContain(`(l."externalId" IS NOT NULL OR l."affiliateUrl" IS NOT NULL)`)
    }
    expect(SNAPSHOT_SQL).toContain(`l.status IN ('active','sold')`)
    expect(HIDE_SQL).toContain('l.status = j.prior')
    expect(HIDE_SQL).toContain('l."updatedAt"::text = j.upd')
    expect(HIDE_SQL).not.toMatch(/"updatedAt"\s*=\s*(now|CURRENT)/i) // a raw hide never stamps updatedAt
  })

  it('restore: still hidden, untouched since (updatedAt), and no compliance decision since the journal', () => {
    for (const sql of [RESTORABLE_SQL, RESTORE_SQL]) {
      expect(sql).toContain(`l.status = 'hidden'`)
      expect(sql).toContain('l."updatedAt"::text = j.upd')
      expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a."occurredAt" >= $4::timestamp)`)
    }
    expect(RESTORE_SQL).toContain('SET status = j.prior')
    expect(RESTORABLE_SQL.startsWith('SELECT')).toBe(true)
  })
})

describe('journaledHide', () => {
  it('journals the snapshot (status + updatedAt) BEFORE the hide, and skips a row that is no longer live', async () => {
    const dir = tmp()
    const path = join(dir, 'sub', 'j.json')
    const order: string[] = []
    const db: HideDb = {
      $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => {
        if (sql === SNAPSHOT_SQL) { order.push('snapshot'); return [{ id: 'A', status: 'sold', updatedAt: '2026-09-30 10:00:00.123' }] }
        if (sql === HIDE_SQL) {
          order.push(existsSync(path) ? 'hide-after-journal' : 'hide-BEFORE-journal')
          expect(values).toEqual([['A'], ['sold'], ['2026-09-30 10:00:00.123']])
          return [{ id: 'A' }]
        }
        throw new Error(sql)
      }) as HideDb['$queryRawUnsafe'],
    }
    // B is not returned by the snapshot (no longer live, or not an ownerless import) — never journaled.
    const out = await journaledHide(db, [
      { id: 'A', rule: 'spirits', matched: 'ruou', title: 'Rượu' },
      { id: 'B', rule: 'spirits', matched: 'ruou', title: 'Rượu 2' },
    ], { path, kind: 'hide-ad-banned' })
    expect(order).toEqual(['snapshot', 'hide-after-journal'])
    expect(out).toEqual({ journal: path, journaled: 1, hidden: ['A'] })
    const j = JSON.parse(readFileSync(path, 'utf8'))
    expect(j).toMatchObject({ kind: 'hide-ad-banned', rows: [{ id: 'A', priorStatus: 'sold', updatedAt: '2026-09-30 10:00:00.123', rule: 'spirits' }] })
  })

  it('nothing live → no journal, no write', async () => {
    const path = join(tmp(), 'j.json')
    const sqls: string[] = []
    const db: HideDb = { $queryRawUnsafe: (async (sql: string) => { sqls.push(sql); return [] }) as HideDb['$queryRawUnsafe'] }
    expect(await journaledHide(db, [{ id: 'A', rule: 'r', matched: null, title: 't' }], { path, kind: 'import-screen-hide', importer: 'x' })).toEqual({ journal: null, journaled: 0, hidden: [] })
    expect(sqls).toEqual([SNAPSHOT_SQL])
    expect(existsSync(path)).toBe(false)
  })
})

describe('journaledRestore', () => {
  const journal = {
    createdAt: '2026-10-01T08:00:00.000Z',
    rows: [
      { id: 'A', priorStatus: 'active', updatedAt: 'U-A', rule: 'r', matched: null, title: 't' },
      { id: 'B', priorStatus: 'sold', updatedAt: 'U-B', rule: 'r', matched: null, title: 't' },
      { id: 'C', priorStatus: 'active', rule: 'r', matched: null, title: 'no stamp' }, // never restored
    ],
  }
  const fake = () => {
    const calls: { sql: string; values: unknown[] }[] = []
    const db: HideDb = {
      $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => {
        calls.push({ sql, values })
        return [{ id: 'A' }] // B was touched since (moderator), so the database matches only A
      }) as HideDb['$queryRawUnsafe'],
    }
    return { db, calls }
  }

  it('a dry run only SELECTs, with the journaled state and the journal time; an unstamped row is never sent', async () => {
    const { db, calls } = fake()
    const r = await journaledRestore(db, journal, { apply: false })
    expect(calls.map((c) => c.sql)).toEqual([RESTORABLE_SQL])
    expect(calls[0].values).toEqual([['A', 'B'], ['active', 'sold'], ['U-A', 'U-B'], '2026-10-01T08:00:00.000Z'])
    expect(r).toEqual({ total: 3, unstamped: 1, restorable: ['A'], restored: [] })
  })

  it('--apply runs the guarded restore and reports only what it changed', async () => {
    const { db, calls } = fake()
    const r = await journaledRestore(db, journal, { apply: true })
    expect(calls.map((c) => c.sql)).toEqual([RESTORABLE_SQL, RESTORE_SQL])
    expect(r.restored).toEqual(['A'])
  })
})

describe('rollbackPathArg', () => {
  it('--rollback --apply with no path is an error, never a file named "--apply"', () => {
    expect(rollbackPathArg(['node', 's.ts', '--rollback', '--apply']).error).toMatch(/needs a journal path/)
    expect(rollbackPathArg(['node', 's.ts', '--apply', '--rollback']).error).toMatch(/needs a journal path/)
    expect(rollbackPathArg(['node', 's.ts', '--rollback', 'j.json', '--apply'])).toEqual({ path: 'j.json', error: null })
    expect(rollbackPathArg(['node', 's.ts', '--apply'])).toEqual({ path: null, error: null })
  })
})
