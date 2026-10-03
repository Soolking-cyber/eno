import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIX_INVERSE_DRY_SQL, FIX_INVERSE_SQL, LEGACY_RESTORABLE_SQL, LEGACY_RESTORE_SQL, RETIRE_KEEP_SELLERS, RETIRE_MIXED_SHOPS,
  RETIRE_SELECT_SQL, compareIdSets, conditionFixRestore, createdAtFromFilename, formatIdsFile, idsDigest, journalCreatedAt,
  journalFormat, journalIds, laterJournalExclusions, legacyRestore, parseConditionFixCsv, parseIdPriorCsv, parseIdsFile,
  pgTimestamp, retireJournalRows, retireSelectArgs, retireVerdict, type RetireRow,
} from './new-retail-retire'

const TIKI = 'cmtu2fppp000008q44x4pvrz2'
const CELLPHONES = 'cmt78nvif0000gpq48kvzmxjw'
const BACH_LONG = 'cmtw4s5h000000iqlqtxmk3j0'
const DTV = 'cmtr9qva90000glq44fkjs18b'
const VINWONDERS = 'cmt6v9x4o00004fq4v6qokman'

const row = (over: Partial<RetireRow> = {}): RetireRow => ({
  id: 'l1', status: 'active', updatedAt: '2026-10-02 20:00:00', sellerId: TIKI, seller: 'Tiki', ownerId: null,
  category: 'electronics', listingType: 'sell', condition: 'new', title: 'Tai nghe Bluetooth', titleVi: null,
  affiliateUrl: 'https://go.isclix.com/deep_link/1/2?url=https%3A%2F%2Ftiki.vn%2Fx', externalId: '123',
  ...over,
})

describe('retireVerdict — the rule, row by row', () => {
  it('retires an ownerless import shop\'s new or unknown-condition goods, active or sold', () => {
    expect(retireVerdict(row()).retire).toBe(true)
    expect(retireVerdict(row({ status: 'sold' })).retire).toBe(true)
    expect(retireVerdict(row({ condition: null })).retire).toBe(true)
  })

  it.each<[string, Partial<RetireRow>]>([
    ['an owned storefront', { ownerId: 'u1' }],
    ['a rent listing', { listingType: 'rent' }],
    ['a service (the carrier eSIMs)', { listingType: 'service' }],
    ['a job', { listingType: 'job' }],
    ['a rentals category row', { category: 'rentals' }],
    ['a jobs category row', { category: 'jobs' }],
    ['a teachers category row', { category: 'teachers' }],
    ['VinWonders tickets (sell, no condition)', { category: 'tickets-travel', sellerId: VINWONDERS, condition: null }],
    ['a used row', { condition: 'used' }],
    ['a hidden row', { status: 'hidden' }],
    ['a row that is not an import', { externalId: null, affiliateUrl: null }],
    ['Điện Thoại Vui (kept shop) even with condition new', { sellerId: DTV, condition: 'new' }],
  ])('never: %s', (_label, over) => {
    expect(retireVerdict(row(over)).retire).toBe(false)
  })

  it('in a mixed shop keeps a row whose own words say used, and retires one that does not', () => {
    expect(retireVerdict(row({ sellerId: BACH_LONG, condition: null, title: 'iPhone 13 Pro 128GB Cũ 99%' })).retire).toBe(false)
    expect(retireVerdict(row({ sellerId: BACH_LONG, condition: null, title: 'iPhone 17 Pro 256GB Chính hãng' })).retire).toBe(true)
    // The review's charger combo: "củ sạc" in the URL is not "cũ".
    expect(retireVerdict(row({ sellerId: BACH_LONG, condition: null, title: 'Combo củ sạc , cáp sạc Apple 96W', affiliateUrl: 'https://bachlongstore.vn/combo-cu-sac-cap-sac-apple-96w.html' })).retire).toBe(true)
  })

  it('CellphoneS is a mixed shop: a "new"-labelled row that says cũ is kept', () => {
    expect(RETIRE_MIXED_SHOPS.has(CELLPHONES)).toBe(true)
    expect(retireVerdict(row({ sellerId: CELLPHONES, title: 'Apple iPhone X 64GB old-Silver', titleVi: 'Apple iPhone X 64GB cũ-Silver' })).retire).toBe(false)
    expect(retireVerdict(row({ sellerId: CELLPHONES, title: 'iPad A16 Wifi 128GB', affiliateUrl: 'https://go.isclix.com/x?url=https%3A%2F%2Fcellphones.com.vn%2Fipad-a16-11-inch-cu-doi-bao-hanh.html' })).retire).toBe(false)
  })
})

describe('RETIRE_SELECT_SQL — every exclusion is in the SQL too', () => {
  it('pins live, ownerless, imported, sell, not used, and takes the protected categories and kept shops as parameters', () => {
    for (const clause of [
      `l.status IN ('active','sold')`, `s."ownerId" IS NULL`, `(l."externalId" IS NOT NULL OR l."affiliateUrl" IS NOT NULL)`,
      `l."listingType" = 'sell'`, `c.slug <> ALL($1::text[])`, `l.condition IS DISTINCT FROM 'used'`, `l."sellerId" <> ALL($2::text[])`,
    ]) expect(RETIRE_SELECT_SQL).toContain(clause)
    const [cats, keep] = retireSelectArgs()
    expect(cats).toEqual(['rentals', 'jobs', 'teachers', 'tickets-travel'])
    expect(keep).toEqual([...RETIRE_KEEP_SELLERS.keys()])
    expect(keep).toContain(VINWONDERS)
  })
})

describe('the reviewed id list — --apply hides exactly it', () => {
  it('formats sorted and de-duplicated, round-trips, and digests the same set the same way', () => {
    const text = formatIdsFile(['b', 'a', 'b'])
    expect(text).toBe('a\nb\n')
    expect(parseIdsFile(`# reviewed\n${text}\n`)).toEqual(['a', 'b'])
    expect(idsDigest(['b', 'a'])).toBe(idsDigest(['a', 'b']))
    expect(formatIdsFile([])).toBe('')
  })
  it('any difference is reported — no tolerance', () => {
    expect(compareIdSets(['a', 'b'], ['a', 'b'])).toEqual({ missing: [], extra: [] })
    expect(compareIdSets(['a', 'b'], ['a', 'c'])).toEqual({ missing: ['b'], extra: ['c'] })
    expect(compareIdSets([], ['x'])).toEqual({ missing: [], extra: ['x'] })
  })
})

describe('the psql journals', () => {
  it('reads the journal time from either file-name shape, in UTC', () => {
    expect(createdAtFromFilename('/x/new-goods-hide-20261003T040816Z.csv')!.toISOString()).toBe('2026-10-03T04:08:16.000Z')
    expect(createdAtFromFilename('hide-ad-banned-2026-10-01T10-26-35-364Z.json')!.toISOString()).toBe('2026-10-01T10:26:35.364Z')
    expect(createdAtFromFilename('journal.csv')).toBeNull()
    expect(pgTimestamp(new Date('2026-10-03T04:08:16.000Z'))).toBe('2026-10-03 04:08:16.000')
  })

  it('parses id,prior and refuses the whole file on a prior that is not active|sold', () => {
    expect(parseIdPriorCsv('a,active\nb,sold\n\n')).toEqual([{ id: 'a', prior: 'active' }, { id: 'b', prior: 'sold' }])
    expect(() => parseIdPriorCsv('a,active\nb,hidden\n')).toThrow(/not active\|sold/)
    expect(() => parseIdPriorCsv('a,active,x\n')).toThrow(/expected "id,prior"/)
  })

  it('parses the condition-fix CSV, including psql\'s quoted empty string', () => {
    const rows = parseConditionFixCsv('c1,hidden,new,active,restore_used\nd1,sold,"",,label_used\nh1,active,new,,hide_new\n')
    expect(rows).toEqual([
      { id: 'c1', status: 'hidden', cond: 'new', prior: 'active', action: 'restore_used' },
      { id: 'd1', status: 'sold', cond: '', prior: '', action: 'label_used' },
      { id: 'h1', status: 'active', cond: 'new', prior: '', action: 'hide_new' },
    ])
    expect(() => parseConditionFixCsv('x,active,new,,delete_all\n')).toThrow(/unknown action/)
    expect(() => parseConditionFixCsv('x,active,new,,restore_used\n')).toThrow(/restore_used row must be hidden/)
  })

  it('tells the formats apart by content', () => {
    expect(journalFormat('a,active\n')).toBe('id-prior-csv')
    expect(journalFormat('a,hidden,new,active,restore_used\n')).toBe('condition-fix-csv')
    expect(journalFormat(JSON.stringify({ kind: 'retire-new-retail', createdAt: '2026-10-04T00:00:00Z', rows: [] }))).toBe('retire-json')
    expect(journalFormat(JSON.stringify({ kind: 'hide-ad-banned', rows: [{ id: 'x' }] }))).toBe('other-json')
    expect(journalIds(JSON.stringify({ kind: 'hide-ad-banned', rows: [{ id: 'x' }] }))).toEqual(['x'])
    expect(journalIds('a,active\nb,sold\n')).toEqual(['a', 'b'])
  })
})

describe('⛔ a rollback never undoes a later decision', () => {
  it('collects every id of a LATER journal in the same directory, and of any named explicitly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retire-journals-'))
    const self = join(dir, 'new-goods-hide-20261003T040816Z.csv')
    writeFileSync(self, 'a,active\nb,sold\nc,active\n')
    writeFileSync(join(dir, 'used-condition-fix-20261003T042132Z.csv'), 'a,hidden,new,active,restore_used\n')
    writeFileSync(join(dir, 'hide-ad-banned-2026-10-05T00-00-00-000Z.json'), JSON.stringify({ kind: 'hide-ad-banned', createdAt: '2026-10-05T00:00:00.000Z', rows: [{ id: 'b' }] }))
    writeFileSync(join(dir, 'hide-ad-banned-2026-10-01T10-26-35-364Z.json'), JSON.stringify({ kind: 'hide-ad-banned', createdAt: '2026-10-01T10:26:35.438Z', rows: [{ id: 'old' }] }))
    writeFileSync(join(dir, 'notes.txt'), 'c')
    const other = join(mkdtempSync(join(tmpdir(), 'retire-extra-')), 'mod.json')
    writeFileSync(other, JSON.stringify({ kind: 'import-screen-hide', createdAt: '2026-09-01T00:00:00.000Z', rows: [{ id: 'c' }] }))
    const ex = laterJournalExclusions(self, createdAtFromFilename(self)!, [other])
    expect([...ex.ids].sort()).toEqual(['a', 'b', 'c'])
    expect(ex.ids.has('old')).toBe(false) // earlier than the journal: not a later decision
    expect(journalCreatedAt(join(dir, 'x.json'), JSON.stringify({ createdAt: '2026-10-05T00:00:00.000Z' }))!.toISOString()).toBe('2026-10-05T00:00:00.000Z')
  })

  it('also looks in the other journaled hides\' directory (scripts/journals), not only beside the journal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retire-journals-'))
    const self = join(dir, 'new-goods-hide-20261003T040816Z.csv')
    writeFileSync(self, 'a,active\nb,sold\n')
    const elsewhere = mkdtempSync(join(tmpdir(), 'retire-default-'))
    writeFileSync(join(elsewhere, 'warranty-products-hide-20261003T075048Z.csv'), 'b,active\n')
    expect([...laterJournalExclusions(self, createdAtFromFilename(self)!).ids]).toEqual([])
    const ex = laterJournalExclusions(self, createdAtFromFilename(self)!, [], [elsewhere, join(elsewhere, 'missing')])
    expect([...ex.ids]).toEqual(['b'])
    expect(ex.dirs).toContain(elsewhere)
  })

  it('a retire journal is scoped by seller and minus later decisions', () => {
    const rows = [
      { id: 'a', priorStatus: 'active', updatedAt: 'x', rule: 'r', matched: null, title: 't', sellerId: 's1' },
      { id: 'b', priorStatus: 'active', updatedAt: 'x', rule: 'r', matched: null, title: 't', sellerId: 's2' },
      { id: 'c', priorStatus: 'sold', updatedAt: 'x', rule: 'r', matched: null, title: 't', sellerId: 's1' },
    ]
    expect(retireJournalRows({ rows }, { sellerId: 's1', exclude: new Set(['c']) }).map((r) => r.id)).toEqual(['a'])
    expect(retireJournalRows({ rows }, { sellerId: null, exclude: new Set() }).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the rollback SQL carries every guard', () => {
  it('legacy CSV: hidden, live prior, not written since, not labelled used, no audit since, ownerless, optional seller', () => {
    for (const sql of [LEGACY_RESTORABLE_SQL, LEGACY_RESTORE_SQL]) {
      for (const clause of [
        `l.status = 'hidden'`, `j.prior IN ('active','sold')`, `l."updatedAt" < $3::timestamp`, `l.condition IS DISTINCT FROM 'used'`,
        `compliance_audit`, `a."occurredAt" >= $3::timestamp`, `s."ownerId" IS NULL`, `($4::text IS NULL OR l."sellerId" = $4::text)`,
      ]) expect(sql).toContain(clause)
    }
    expect(LEGACY_RESTORE_SQL).toMatch(/^UPDATE "Listing" l SET status = j\.prior /)
  })

  it('condition fix: every inverse — hide_new included — is guarded by updatedAt, audit and ownership, and the dry run is the same predicate', () => {
    for (const action of ['restore_used', 'label_used', 'hide_new'] as const) {
      for (const sql of [FIX_INVERSE_SQL[action], FIX_INVERSE_DRY_SQL[action]]) {
        expect(sql).toContain(`l."updatedAt" < $4::timestamp`)
        expect(sql).toContain('compliance_audit')
        expect(sql).toContain(`s."ownerId" IS NULL`)
        expect(sql).toContain(`($5::text IS NULL OR l."sellerId" = $5::text)`)
      }
      expect(FIX_INVERSE_DRY_SQL[action]).toMatch(/^SELECT l\.id FROM "Listing" l JOIN unnest/)
      expect(FIX_INVERSE_DRY_SQL[action]).not.toMatch(/UPDATE|SET /)
    }
    expect(FIX_INVERSE_SQL.hide_new).toContain(`l.status = 'hidden'`)
    expect(FIX_INVERSE_SQL.restore_used).toContain(`l.condition = 'used' AND l.status = j.st`)
  })
})

describe('legacyRestore / conditionFixRestore against a fake database', () => {
  type Call = { sql: string; args: unknown[] }
  const fake = (answer: (sql: string, args: unknown[]) => unknown[]) => {
    const calls: Call[] = []
    return { calls, db: { $queryRawUnsafe: async <T>(sql: string, ...args: unknown[]) => { calls.push({ sql, args }); return answer(sql, args) as T } } }
  }

  it('drops excluded ids before asking, passes the UTC time and seller, and writes only with apply', async () => {
    const { calls, db } = fake((sql, args) => sql.startsWith('SELECT') ? (args[0] as string[]).map((id) => ({ id, prior: 'active', sellerId: 's' })) : (args[0] as string[]).map((id) => ({ id })))
    const rows = parseIdPriorCsv('a,active\nb,sold\nc,active\n')
    const dry = await legacyRestore(db, rows, { createdAt: new Date('2026-10-03T04:08:16Z'), sellerId: 's', exclude: new Set(['b']), apply: false })
    expect(dry).toMatchObject({ total: 3, excluded: 1, restored: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual([['a', 'c'], ['active', 'active'], '2026-10-03 04:08:16.000', 's'])
    const wet = await legacyRestore(db, rows, { createdAt: new Date('2026-10-03T04:08:16Z'), sellerId: null, exclude: new Set(), apply: true })
    expect(wet.restored).toEqual(['a', 'b', 'c'])
    expect(calls.at(-1)!.sql).toBe(LEGACY_RESTORE_SQL)
  })

  it('inverts each action with its own statement; restore_used matches on the journaled prior status', async () => {
    const { calls, db } = fake(() => [])
    const rows = parseConditionFixCsv('c1,hidden,new,sold,restore_used\nd1,active,"",,label_used\nh1,active,new,,hide_new\n')
    await conditionFixRestore(db, rows, { createdAt: new Date('2026-10-03T04:21:32Z'), sellerId: null, exclude: new Set(), apply: true })
    const byAction = (a: keyof typeof FIX_INVERSE_SQL) => calls.find((c) => c.sql === FIX_INVERSE_SQL[a])!
    expect(byAction('restore_used').args.slice(0, 3)).toEqual([['c1'], ['new'], ['sold']])
    expect(byAction('label_used').args.slice(0, 3)).toEqual([['d1'], [''], ['active']])
    expect(byAction('hide_new').args.slice(0, 3)).toEqual([['h1'], ['new'], ['active']])
  })
})
