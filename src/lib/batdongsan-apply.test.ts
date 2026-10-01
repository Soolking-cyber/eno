import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BDS_REPOST_MIN_MS, applyBdsDatedChanges, bdsRollbackSql, bdsTombstoneSql, isBdsRepost, owedTombstonesOf, type BdsDatedChange, type BdsDatedIo } from './batdongsan-apply'

const SELLER = 'bds-vn-import-seller-0001'
const change = (id: string, action: BdsDatedChange['action'], over: Partial<BdsDatedChange> = {}): BdsDatedChange => ({
  id, externalId: `bds:pr4600${id.slice(-4)}`, sellerId: SELLER, action,
  oldStatus: action === 'revive' ? 'expired' : 'active', oldPostedAt: new Date('2026-09-21T08:00:00.000Z'), oldRankScore: 0.4125,
  newPostedAt: new Date('2026-09-30T05:00:00.000Z'), newRankScore: 0.8,
  ...over,
})

/** A recording fake of the script's database side: every call lands in `calls`, in order. */
function harness(opts: { moved?: (c: BdsDatedChange) => boolean; tombstone?: (ids: readonly string[]) => void; rollback?: (line: string) => void; write?: (c: BdsDatedChange) => void } = {}) {
  const calls: string[] = []
  const io: BdsDatedIo = {
    revive: async (c) => { calls.push(`revive ${c.id}`); opts.write?.(c); return opts.moved ? opts.moved(c) : true },
    repost: async (c) => { calls.push(`repost ${c.id}`); opts.write?.(c); return opts.moved ? opts.moved(c) : true },
    tombstone: async (ids) => { calls.push(`tombstone ${ids.join(',')}`); opts.tombstone?.(ids) },
    journal: (line) => { const j = JSON.parse(line); calls.push(`journal ${j.phase} ${j.id}`) },
    rollback: (line) => { calls.push(`rollback ${/id='([^']+)'/.exec(line)?.[1]}`); opts.rollback?.(line) },
    log: (line) => { calls.push(`log ${line}`) },
  }
  return { io, calls }
}

describe('bdsRollbackSql — undoes ONE dated write, only while the row is as that write left it', () => {
  it('a revival: back to its old status/postedAt/rank only while still active at the new postedAt — then its own ISR tombstone', () => {
    const [update, insert] = bdsRollbackSql(change('cl0000000001', 'revive')).split('\n')
    expect(update).toBe(`UPDATE "Listing" SET status='expired', "postedAt"='2026-09-21T08:00:00.000Z', "rankScore"='0.4125'::double precision WHERE id='cl0000000001' AND "sellerId"='${SELLER}' AND "postedAt"='2026-09-30T05:00:00.000Z' AND status='active';`)
    expect(insert).toBe(bdsTombstoneSql(['cl0000000001']))
  })
  it("a re-post: back to the old postedAt/rank only while it still holds the new one — and never on a 'removed' row", () => {
    const sql = bdsRollbackSql(change('cl0000000002', 'repost'))
    expect(sql).toMatch(/^UPDATE "Listing" SET "postedAt"='2026-09-21T08:00:00.000Z', "rankScore"='0.4125'::double precision WHERE id='cl0000000002' AND "sellerId"='bds-vn-import-seller-0001' AND "postedAt"='2026-09-30T05:00:00.000Z' AND status<>'removed';\nINSERT INTO next_cache_tag/)
    expect(sql).not.toMatch(/SET status/)
  })
  it('refuses anything that could not have come from the database rather than writing it into SQL', () => {
    expect(() => bdsRollbackSql(change("x'; DROP TABLE \"Listing\"; --", 'revive'))).toThrow(/refusing/)
    expect(() => bdsRollbackSql(change('cl0000000003', 'revive', { oldStatus: 'hidden' }))).toThrow(/status "hidden"/)
    expect(() => bdsRollbackSql(change('cl0000000003', 'revive', { oldPostedAt: new Date(NaN) }))).toThrow(/date/)
    expect(() => bdsRollbackSql(change('cl0000000003', 'repost', { sellerId: "a'b" }))).toThrow(/seller/)
  })
  it('a rank that JavaScript prints oddly still reaches float8 intact', () => {
    expect(bdsRollbackSql(change('cl0000000004', 'repost', { oldRankScore: 1e-7 }))).toMatch(/"rankScore"='1e-7'::double precision/)
  })
})

describe('bdsTombstoneSql — the same tags and upsert as src/lib/pdp-tombstone.ts', () => {
  it('both languages, newest stamp and expiry win', () => {
    expect(bdsTombstoneSql(['cl1'])).toBe(`INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY['eno:isrtag:_N_T_/en/listings/cl1','eno:isrtag:_N_T_/vi/listings/cl1']) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`)
    expect(bdsTombstoneSql([])).toBe('')
  })
})

describe('applyBdsDatedChanges — planned → write → rollback → tombstone, as each row lands', () => {
  it('journals the plan BEFORE the write, the rollback only AFTER a write that moved the row, and tombstones each revival straight away', async () => {
    const { io, calls } = harness()
    const out = await applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000002', 'repost'), change('cl0000000003', 'revive')], io)
    expect(calls).toEqual([
      'journal planned cl0000000001', 'revive cl0000000001', 'rollback cl0000000001', 'journal done cl0000000001', 'tombstone cl0000000001',
      'journal planned cl0000000002', 'repost cl0000000002', 'rollback cl0000000002', 'journal done cl0000000002',
      'journal planned cl0000000003', 'revive cl0000000003', 'rollback cl0000000003', 'journal done cl0000000003', 'tombstone cl0000000003',
    ])
    expect(out).toEqual({ revived: ['cl0000000001', 'cl0000000003'], reposted: ['cl0000000002'], notMoved: 0, tombstoned: 2, owed: [] })
  })
  it('a write that moved nothing (the row left the planned state since the read) gets no rollback line and no tombstone', async () => {
    const { io, calls } = harness({ moved: (c) => c.id !== 'cl0000000001' })
    const out = await applyBdsDatedChanges([change('cl0000000001', 'revive')], io)
    expect(calls).toEqual(['journal planned cl0000000001', 'revive cl0000000001', 'journal not-moved cl0000000001'])
    expect(out).toMatchObject({ revived: [], notMoved: 1, owed: [] })
  })
  it('⛔ a throw part-way still tombstones every page already revived — including the one whose rollback line failed', async () => {
    const { io, calls } = harness({
      rollback: (line) => { if (line.includes("id='cl0000000002'")) throw new Error('ENOSPC') },
    })
    await expect(applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000002', 'revive'), change('cl0000000003', 'revive')], io)).rejects.toThrow(/ENOSPC/)
    expect(calls).toContain('tombstone cl0000000001')
    expect(calls.at(-1)).toBe('tombstone cl0000000002') // the last attempt before the rethrow
    expect(calls).not.toContain('revive cl0000000003')
  })
  it('⛔ a throw whose last tombstone attempt ALSO fails carries the owed ids on the SAME error — the caller has no outcome to read', async () => {
    const timeout = new Error('timeout')
    const { io, calls } = harness({
      write: (c) => { if (c.id === 'cl0000000003') throw timeout },
      tombstone: (ids) => { if (ids.includes('cl0000000002')) throw new Error('pool exhausted') },
    })
    const e = await applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000004', 'repost'), change('cl0000000002', 'revive'), change('cl0000000003', 'revive')], io).catch((x: unknown) => x)
    expect(e).toBe(timeout) // not wrapped: the stack and message the operator reads are the real ones
    // 3 is owed from BEFORE its write: the write threw, and it may have committed with its reply lost.
    expect(owedTombstonesOf(e)).toEqual(['cl0000000002', 'cl0000000003'])
    // 1 paid as it landed; the re-post owes nothing; 2 failed as it landed, and again (with 3) before the rethrow.
    expect(calls.filter((c) => c.startsWith('tombstone'))).toEqual(['tombstone cl0000000001', 'tombstone cl0000000002', 'tombstone cl0000000002,cl0000000003'])
  })
  it('a throw with nothing owed propagates untouched; a thrown non-object is wrapped (cause kept) so it can still carry them', async () => {
    const clean = harness({ write: () => { throw new Error('timeout') } })
    const e1 = await applyBdsDatedChanges([change('cl0000000001', 'revive')], clean.io).catch((x: unknown) => x)
    expect(e1).toBeInstanceOf(Error)
    expect(Object.keys(e1 as object)).toEqual([])
    expect(owedTombstonesOf(e1)).toEqual([])
    const odd = harness({ tombstone: () => { throw new Error('down') }, rollback: () => { throw 'EIO' } })
    const e2 = await applyBdsDatedChanges([change('cl0000000001', 'revive')], odd.io).catch((x: unknown) => x)
    expect(e2).toBeInstanceOf(Error)
    expect((e2 as Error).message).toMatch(/^EIO \(1 revived page/)
    expect((e2 as Error).cause).toBe('EIO')
    expect(owedTombstonesOf(e2)).toEqual(['cl0000000001'])
    expect(owedTombstonesOf(null)).toEqual([])
    expect(owedTombstonesOf({ bdsOwedTombstones: [1] })).toEqual([])
  })
  it('⛔ one change per id: a duplicate is skipped, so it can never clear a tombstone the first one still owes', async () => {
    const { io, calls } = harness({ tombstone: (ids) => { if (ids.includes('cl0000000001')) throw new Error('pool exhausted') } })
    const out = await applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000001', 'revive')], io)
    expect(calls.filter((c) => c.startsWith('revive'))).toHaveLength(1)
    expect(out.owed).toEqual(['cl0000000001'])
  })
  it('a database error on a later write: the earlier revivals were tombstoned as they landed, and the one that threw is tombstoned too (it may have committed)', async () => {
    const { io, calls } = harness({ write: (c) => { if (c.id === 'cl0000000003') throw new Error('timeout') } })
    await expect(applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000002', 'revive'), change('cl0000000003', 'revive')], io)).rejects.toThrow(/timeout/)
    expect(calls.filter((c) => c.startsWith('tombstone'))).toEqual(['tombstone cl0000000001', 'tombstone cl0000000002', 'tombstone cl0000000003'])
  })
  it('a failed tombstone stays owed and is tried again with the next one, then in the finally; what still fails comes back owed', async () => {
    let fail = 2
    const { io, calls } = harness({ tombstone: () => { if (fail-- > 0) throw new Error('pool exhausted') } })
    const out = await applyBdsDatedChanges([change('cl0000000001', 'revive'), change('cl0000000002', 'revive')], io)
    // 1st: fails (owed 1) · 2nd: fails (owed 1,2) · finally: both, succeeds.
    expect(calls.filter((c) => c.startsWith('tombstone'))).toEqual(['tombstone cl0000000001', 'tombstone cl0000000001,cl0000000002', 'tombstone cl0000000001,cl0000000002'])
    expect(calls.filter((c) => c.startsWith('log'))).toHaveLength(1)
    expect(out).toMatchObject({ tombstoned: 2, owed: [] })
    const never = harness({ tombstone: () => { throw new Error('down') } })
    expect((await applyBdsDatedChanges([change('cl0000000001', 'revive')], never.io)).owed).toEqual(['cl0000000001'])
  })
})

describe('isBdsRepost — a re-post is a source date at least a day newer than the stored postedAt', () => {
  const stored = new Date('2026-09-30T05:00:00.000Z')
  const at = (ms: number) => new Date(stored.getTime() + ms)
  it('a same-week re-run whose worst-case date moved by hours re-dates nothing', () => {
    expect(BDS_REPOST_MIN_MS).toBe(86_400_000)
    expect(isBdsRepost(at(0), stored)).toBe(false)
    expect(isBdsRepost(at(7 * 3_600_000), stored)).toBe(false)
    expect(isBdsRepost(at(BDS_REPOST_MIN_MS - 1), stored)).toBe(false)
  })
  it('a day or more newer is a re-post; older never is; an invalid date never is', () => {
    expect(isBdsRepost(at(BDS_REPOST_MIN_MS), stored)).toBe(true)
    expect(isBdsRepost(at(3 * BDS_REPOST_MIN_MS), stored)).toBe(true)
    expect(isBdsRepost(at(-BDS_REPOST_MIN_MS), stored)).toBe(false)
    expect(isBdsRepost(new Date(NaN), stored)).toBe(false)
  })
})

describe('scripts/import-batdongsan-rentals.ts — the writes are guarded where the audit counts them', () => {
  const src = readFileSync('scripts/import-batdongsan-rentals.ts', 'utf8')
  it("⛔ no write can land on a 'removed' row: the upsert, the revival and the re-post are each status-guarded", () => {
    expect(src).toMatch(/where: \{ sellerId_externalId: \{ sellerId: SELLER_ID, externalId \}, status: \{ not: 'removed' \} \},/)
    expect(src).toMatch(/where: \{ id: ch\.id, sellerId: SELLER_ID, status: \{ in: \[\.\.\.REVIVABLE_STATUSES\] \} \},\n\s+data: \{ status: 'active', postedAt: ch\.newPostedAt, rankScore: ch\.newRankScore \},/)
    // A re-post lands on a LIVE row only (never hidden, sold or removed).
    expect(src).toMatch(/where: \{ id: ch\.id, sellerId: SELLER_ID, status: 'active', postedAt: \{ lt: ch\.newPostedAt \} \},/)
  })
  it('refuses before any write when a revival is planned and there is no next_cache_tag table', () => {
    const at = src.indexOf("select to_regclass('public.next_cache_tag')")
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(src.indexOf('await screen.applyHides()'))
    expect(at).toBeLessThan(src.indexOf('await db.listing.upsert('))
  })
  it('writes the fresh set only after an import that ran to its end, and exits by bdsImportExitCode', () => {
    expect(src.indexOf('writeFileAtomic(o.freshOut!')).toBeGreaterThan(src.indexOf('await db.$disconnect()'))
    expect(src).toMatch(/if \(freshSet && !threwOwing\) \{\n\s+writeFileAtomic\(o\.freshOut!/)
    expect(src).toMatch(/const code = bdsImportExitCode\(\{ owed: owedTombstones\.length, setAsked: !!o\.freshOut, setWritten \}\)/)
    expect(src).toMatch(/process\.exitCode = code\n/)
  })
  it('⛔ a throw from the dated pass writes the owed ids it carries to the repair file BEFORE it goes on', () => {
    expect(src).toMatch(/\} catch \(e\) \{\n(\s+\/\/.*\n)*\s+const owed = owedTombstonesOf\(e\)\n\s+if \(owed\.length\) reportOwed\(owed\)\n\s+throw e\n/)
    expect(src).toMatch(/if \(!owedTombstones\.length\) throw e\n\s+console\.error\(e\)\n\s+threwOwing = true/)
  })
  it('only a LIVE row is re-dated, and only when isBdsRepost says so (≥ a day newer), never on a bare "newer"', () => {
    expect(src).toMatch(/if \(!revive && \(b\.status !== 'active' \|\| !isBdsRepost\(d, b\.postedAt\)\)\) continue/)
  })
})
