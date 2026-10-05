import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  JOURNAL_HEADER,
  MATERIAL_SHELVES,
  RESTORE_SQL,
  SELECT_SQL,
  UPDATE_SQL,
  applyChanges,
  journalCsv,
  journalThenApply,
  parseJournal,
  planChanges,
  restoreArg,
  restoreJournal,
  sampleChanges,
  selectRows,
  writeJournal,
  type Change,
  type Queryable,
  type Row,
} from '../../scripts/backfill-furniture-material'

/**
 * scripts/backfill-furniture-material.ts — fills `material` on the live imported furniture rows that have
 * none, from the merchant's own title (src/lib/furniture-material.ts). Unit level, the database mocked:
 * the selection, the journal (written before any write, read back exactly) and the restore.
 */

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1', subcategorySlug: 'beds-mattresses', status: 'active', title: 'Used Wooden Bed', titleVi: 'Giường Gỗ Cũ', attributes: null, ...over,
})

/** A mock pg client: records every query, answers SELECTs from `rows`, UPDATEs with `rowCount`. */
function mockClient(opts: { select?: unknown[]; rowCount?: (sql: string, values: unknown[]) => number; failOn?: number; onQuery?: (sql: string, values: unknown[]) => void } = {}) {
  const calls: { sql: string; values: unknown[] }[] = []
  const c: Queryable = {
    async query(sql, values = []) {
      calls.push({ sql, values })
      opts.onQuery?.(sql, values)
      if (opts.failOn !== undefined && calls.length === opts.failOn) throw new Error('connection dropped')
      if (/^\s*SELECT/i.test(sql)) return { rows: opts.select ?? [], rowCount: (opts.select ?? []).length }
      if (/^\s*UPDATE/i.test(sql)) return { rows: [], rowCount: opts.rowCount ? opts.rowCount(sql, values) : 1 }
      return { rows: [], rowCount: null }
    },
  }
  return { c, calls }
}

describe('what it selects', () => {
  it('the shelves are FALLBACK_FACET’s material shelves', () => {
    expect([...MATERIAL_SHELVES].sort()).toEqual(['beds-mattresses', 'sofa-seating', 'storage', 'tables-desks'])
  })
  it('verified, active|sold, ownerless, furniture shelves, no material yet', async () => {
    for (const rule of [`c.slug = $1`, `l."subcategorySlug" = ANY($2::text[])`, `l.verified = true`, `l.status IN ('active', 'sold')`, `s."ownerId" IS NULL`, `l.attributes NOT LIKE '%"material"%'`]) {
      expect(SELECT_SQL).toContain(rule)
    }
    const { c, calls } = mockClient({ select: [row()] })
    expect(await selectRows(c)).toEqual([row()])
    expect(calls[0].values).toEqual(['furniture-appliances', [...MATERIAL_SHELVES]])
  })
  it('every write is a compare-and-set that re-checks the selection', () => {
    for (const rule of ['l.attributes IS NOT DISTINCT FROM $3', 'l."subcategorySlug" = $4', 'c.slug = $5', 'l.verified = true', `l.status IN ('active', 'sold')`, `s."ownerId" IS NULL`]) expect(UPDATE_SQL).toContain(rule)
    expect(RESTORE_SQL).toContain('attributes IS NOT DISTINCT FROM $3')
  })
})

describe('planChanges — the importer’s own decision, on the merchant’s own words', () => {
  it('writes the title’s material beside the attributes already there', () => {
    const { changes, skipped } = planChanges([
      row({ id: 'a' }),
      row({ id: 'b', subcategorySlug: 'storage', titleVi: 'Tủ Locker Sắt 12 Ngăn', attributes: '{"color":"grey"}' }),
    ])
    expect(skipped).toEqual({})
    expect(changes.map((c) => [c.id, c.material, c.old, c.next])).toEqual([
      ['a', 'wood', null, '{"material":"wood"}'],
      ['b', 'metal', '{"color":"grey"}', '{"color":"grey","material":"metal"}'],
    ])
  })
  it('never a row that has a material; never one whose title names none, two, an outside one or a part’s', () => {
    const { changes, skipped } = planChanges([
      row({ id: 'has', attributes: '{"material":"metal"}' }),
      row({ id: 'none', titleVi: 'Giường Ngủ Cũ 1M6' }),
      row({ id: 'two', titleVi: 'Giường Gỗ Khung Sắt' }),
      row({ id: 'out', titleVi: 'Nệm Cao Su Non' }),
      row({ id: 'part', subcategorySlug: 'tables-desks', titleVi: 'Bàn Làm Việc Chân Sắt' }),
      row({ id: 'junk', attributes: '{oops' }),
    ])
    expect(changes).toEqual([])
    expect(skipped).toEqual({ 'has-material': 1, 'none-named': 1, 'two-materials': 1, 'outside-taxonomy': 1, 'only-a-part': 1, 'unreadable-attributes': 1 })
  })
  it('reads titleVi, never the English translation (the MT says "Rattan" for a cloud-veined table)', () => {
    const { changes } = planChanges([row({ subcategorySlug: 'tables-desks', titleVi: 'Bàn Phòng Ăn Vân Mây Sang Trọng', title: 'Luxury Rattan Dining Table' })])
    expect(changes).toEqual([])
    expect(planChanges([row({ titleVi: null, title: 'Used Wooden Bed' })]).changes[0].material).toBe('wood')
  })
  it('samples spread over every shelf × material group', () => {
    const many: Change[] = Array.from({ length: 100 }, (_, k) => ({
      id: `id${String(k).padStart(3, '0')}`, subcategorySlug: k < 50 ? 'storage' : 'tables-desks', status: 'active', material: k % 2 ? 'wood' : 'metal', old: null, next: '{}', title: 't',
    }))
    const s = sampleChanges(many)
    expect(s).toHaveLength(20)
    expect(new Set(s.map((c) => `${c.subcategorySlug}/${c.material}`)).size).toBe(4)
    expect(sampleChanges(many.slice(0, 3))).toHaveLength(3)
  })
})

describe('the journal', () => {
  const changes = [
    { id: 'a', old: null, next: '{"material":"wood"}' },
    { id: 'b', old: '', next: '{"material":"metal"}' },
    { id: 'c', old: '{"note":"say \\"hi\\", then\\nleave"}', next: '{"note":"say \\"hi\\", then\\nleave","material":"glass"}' },
    { id: 'd', old: '{\n"color":"x"}', next: '{"color":"x","material":"fabric"}' },
  ]
  it('round-trips exactly — NULL and "" stay distinct, quotes, commas and newlines survive', () => {
    const text = journalCsv(changes)
    expect(text.split('\n')[0]).toBe(JOURNAL_HEADER)
    expect(text.split('\n')[1]).toBe('"a",\\N,"{""material"":""wood""}"')
    expect(parseJournal(text)).toEqual(changes)
    expect(parseJournal(text.replace(/\n/g, '\r\n'))).toEqual(changes.map((c) => ({ ...c, old: c.old?.replace(/\n/g, '\r\n') ?? null })))
  })
  it('is refused WHOLE when it is not what this script writes', () => {
    expect(() => parseJournal('id,prior\n"a","active"\n')).toThrow(/header/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",\\N\n`)).toThrow(/3 cells/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"",\\N,"{""material"":""wood""}"\n`)).toThrow(/empty id/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",NULL,"{""material"":""wood""}"\n`)).toThrow(/neither quoted nor/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",\\N,"{""color"":""red""}"\n`)).toThrow(/no material/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",\\N,"{oops"\n`)).toThrow(/not JSON/)
    // A damaged or hand-edited journal (gate, 2026-10-05): one id twice, or old attributes that are not an object.
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",\\N,"{""material"":""wood""}"\n"a",\\N,"{""material"":""metal""}"\n`)).toThrow(/duplicate id a/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a","oops","{""material"":""wood""}"\n`)).toThrow(/old attributes are not JSON/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a","[1]","{""material"":""wood""}"\n`)).toThrow(/not a JSON object/)
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a",\\N,"{""material"":""wood""}\n`)).toThrow(/truncated/)
  })
  it('a quoted "\\N" is a string — refused, since attributes are never that — and an unquoted one is NULL', () => {
    expect(() => parseJournal(`${JOURNAL_HEADER}\n"a","\\N","{""material"":""wood""}"\n`)).toThrow(/old attributes are not JSON/)
    expect(parseJournal(`${JOURNAL_HEADER}\n"a",\\N,"{""material"":""wood""}"\n`)[0].old).toBeNull()
  })
})

describe('--apply: the journal first, then compare-and-set writes', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })
  const changes: Change[] = [
    { id: 'a', subcategorySlug: 'storage', status: 'active', material: 'wood', old: null, next: '{"material":"wood"}', title: 'Tủ Gỗ' },
    { id: 'b', subcategorySlug: 'storage', status: 'sold', material: 'metal', old: '{"x":"1"}', next: '{"x":"1","material":"metal"}', title: 'Kệ Sắt' },
  ]

  it('writes every row in a transaction, (id, new, old, shelf, category), counting only the rows that changed', async () => {
    const { c, calls } = mockClient({ rowCount: (_sql, v) => (v[0] === 'b' ? 0 : 1) }) // b changed under us
    expect(await applyChanges(c, changes)).toBe(1)
    expect(calls.map((q) => q.sql.trim().split(/\s+/)[0])).toEqual(['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT'])
    expect(calls[1]).toEqual({ sql: UPDATE_SQL, values: ['a', '{"material":"wood"}', null, 'storage', 'furniture-appliances'] })
    expect(calls[2].values).toEqual(['b', '{"x":"1","material":"metal"}', '{"x":"1"}', 'storage', 'furniture-appliances'])
  })
  it('batches, and rolls a failed batch back', async () => {
    const ok = mockClient()
    await applyChanges(ok.c, changes, 1)
    expect(ok.calls.map((q) => q.sql.trim().split(/\s+/)[0])).toEqual(['BEGIN', 'UPDATE', 'COMMIT', 'BEGIN', 'UPDATE', 'COMMIT'])
    const bad = mockClient({ failOn: 2 })
    await expect(applyChanges(bad.c, changes)).rejects.toThrow('connection dropped')
    expect(bad.calls.at(-1)!.sql).toBe('ROLLBACK')
  })
  it('the journal is on disk, complete, BEFORE the first UPDATE', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fm-journal-'))
    const path = join(dir, 'journals', 'backfill-furniture-material-test.csv')
    let seenAtFirstUpdate: string | null = null
    const { c } = mockClient({ onQuery: (sql) => { if (/^\s*UPDATE/.test(sql) && seenAtFirstUpdate === null) seenAtFirstUpdate = existsSync(path) ? readFileSync(path, 'utf8') : '' } })
    let announced: string | null = null
    const out = await journalThenApply(c, changes, path, (p) => { announced = existsSync(p) ? p : null })
    expect(out).toEqual({ journal: path, written: 2 })
    expect(announced).toBe(path) // told where the restore file is before any write could fail
    expect(seenAtFirstUpdate).toBe(journalCsv(changes))
    expect(parseJournal(readFileSync(path, 'utf8'))).toEqual(changes.map(({ id, old, next }) => ({ id, old, next })))
  })
  it('never overwrites an existing journal', () => {
    dir = mkdtempSync(join(tmpdir(), 'fm-journal-'))
    const path = join(dir, 'j.csv')
    writeJournal(path, changes)
    expect(() => writeJournal(path, [])).toThrow(/EEXIST/)
    expect(parseJournal(readFileSync(path, 'utf8'))).toHaveLength(2)
  })
})

describe('--restore', () => {
  const journal = [
    { id: 'a', old: null, next: '{"material":"wood"}' }, // untouched since → restorable
    { id: 'b', old: '{"x":"1"}', next: '{"x":"1","material":"metal"}' }, // untouched since → restorable
    { id: 'c', old: null, next: '{"material":"glass"}' }, // the seller changed it since → left alone
    { id: 'd', old: null, next: '{"material":"fabric"}' }, // gone → left alone
  ]
  const current = [
    { id: 'a', attributes: '{"material":"wood"}' },
    { id: 'b', attributes: '{"x":"1","material":"metal"}' },
    { id: 'c', attributes: '{"material":"metal"}' },
  ]
  it('a dry run only counts the rows that still hold exactly what the backfill wrote', async () => {
    const { c, calls } = mockClient({ select: current })
    expect(await restoreJournal(c, journal, { apply: false })).toEqual({ total: 4, restorable: 2, restored: 0 })
    expect(calls.every((q) => /^\s*SELECT/.test(q.sql))).toBe(true)
  })
  it('--apply puts the old attributes back on those rows only, (id, old, new), each re-checked', async () => {
    const { c, calls } = mockClient({ select: current })
    expect(await restoreJournal(c, journal, { apply: true })).toEqual({ total: 4, restorable: 2, restored: 2 })
    const updates = calls.filter((q) => q.sql === RESTORE_SQL)
    expect(updates.map((q) => q.values)).toEqual([
      ['a', null, '{"material":"wood"}'],
      ['b', '{"x":"1"}', '{"x":"1","material":"metal"}'],
    ])
  })
  it('parses --restore=<path> and --restore <path>, and refuses a bare --restore', () => {
    expect(restoreArg(['node', 's', '--restore=scripts/journals/j.csv'])).toEqual({ path: 'scripts/journals/j.csv', error: null })
    expect(restoreArg(['node', 's', '--restore', 'j.csv', '--apply'])).toEqual({ path: 'j.csv', error: null })
    expect(restoreArg(['node', 's', '--restore', '--apply']).error).toMatch(/needs the journal/)
    expect(restoreArg(['node', 's', '--restore=']).error).toMatch(/needs the journal/)
    expect(restoreArg(['node', 's'])).toEqual({ path: null, error: null })
  })
})
