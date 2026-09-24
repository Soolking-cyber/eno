import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { IMPORT_SELLERS } from './import-sellers'
import { NHATOT_SELLER_ID } from './nhatot-listing'
import { HONEYCOMB_SELLER_ID } from './honeycomb-listing'
import { SELLER_ID as MUABAN_SELLER_ID } from '../../scripts/muaban-net-map'
import { fold } from './fold'
import {
  BATCH, LOCALIZE_SELLERS, TEXT_FIELDS, inScope, journalLine, journalOutcome, missingReport, parseArgs, parseJournal, pickSamples, planRow,
  rollbackCommand, rollbackDecision, rowWhere, scopeWhere, shellQuote, stillAsWritten, type StoredRow,
} from '../../scripts/localize-import-listings'

/**
 * scripts/localize-import-listings.ts — the one-off that applies src/lib/import-i18n.ts to rows the
 * three property importers ALREADY stored. Its pure half is tested here; the places where the I/O
 * half calls it are pinned at the source level (the script opens a database when executed).
 */
const row = (over: Partial<StoredRow> = {}): StoredRow => {
  const title = 'Room · 25 m² for rent — Phường 22, Quận Bình Thạnh'
  const titleVi = 'Cho thuê Nhà trọ, phòng trọ 25m² — Phường 22, Quận Bình Thạnh'
  return {
    id: 'cm-row-1', sellerId: MUABAN_SELLER_ID, externalId: 'muaban:71255923',
    title, titleVi,
    description: 'Listed on Muaban.net. eno links to the original — enquiries and viewings are handled there, not by eno.\n\nType: Nhà trọ, phòng trọ\nArea: 25 m²\nLocation: Phường 22, Quận Bình Thạnh, Hồ Chí Minh\nRent: 2.500.000 đ/month',
    descriptionVi: 'Tin đăng trên Muaban.net. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\nLoại hình: Nhà trọ, phòng trọ\nDiện tích: 25 m²\nKhu vực: Phường 22, Quận Bình Thạnh, Hồ Chí Minh\nGiá thuê: 2.500.000 đ/tháng',
    searchText: fold(`${title} ${titleVi} phuong 22, quan binh thanh, ho chi minh ho chi minh city`),
    ...over,
  }
}

describe('the one-off’s seller scope', () => {
  it('is exactly the three importers import-i18n localizes, each pinned by id and each in IMPORT_SELLERS', () => {
    expect([...LOCALIZE_SELLERS]).toEqual([NHATOT_SELLER_ID, MUABAN_SELLER_ID, HONEYCOMB_SELLER_ID])
    expect([...LOCALIZE_SELLERS]).toEqual(['nhatot-import-seller-0001', 'muaban-net-import-seller-0001', 'honeycomb-import-seller-0001'])
    for (const s of LOCALIZE_SELLERS) expect(IMPORT_SELLERS as readonly string[]).toContain(s)
    expect(scopeWhere()).toEqual({ sellerId: { in: ['nhatot-import-seller-0001', 'muaban-net-import-seller-0001', 'honeycomb-import-seller-0001'] } })
  })

  it('⛔ never plans a write for any other seller — the other imports, or a real person — whatever the text says', () => {
    for (const other of ['bds-vn-import-seller-0001', 'cmub0wead0000zrq418bqq27m', 'mogi-vn-import-seller-0001', 'cmreal0user0shop', '']) {
      expect(inScope(other), other).toBe(false)
      expect(planRow(row({ sellerId: other })), other).toBeNull()
    }
  })

  it('plans the localized text for an in-scope row, and nothing for one already localized', () => {
    const p = planRow(row())!
    expect(p.changed).toEqual(['title', 'description', 'searchText'])
    expect(p.next.title).toBe('Room · 25 m² for rent — Ward 22, Bình Thạnh District')
    expect(p.next.description).toContain('\nType: Boarding room\n')
    expect(p.next.description).toContain('\nRent: 2,500,000 đ/month')
    expect(p.next.titleVi).toBe(p.old.titleVi)
    expect(p.next.descriptionVi).toBe(p.old.descriptionVi)
    // searchText: the folded title head is swapped, the rest kept — what the importer now composes.
    expect(p.next.searchText).toBe(fold(`${p.next.title} ${p.next.titleVi} phuong 22, quan binh thanh, ho chi minh ho chi minh city`))
    // Idempotent: the planned text, stored, plans no change.
    const again = planRow({ ...row(), ...p.next })!
    expect(again.changed).toEqual([])
    expect(again.next).toEqual(p.next)
  })

  it('works for every seller in scope, and keeps a null Vietnamese field null', () => {
    for (const sellerId of LOCALIZE_SELLERS) {
      const p = planRow(row({ sellerId, titleVi: null, descriptionVi: null }))!
      expect(p.sellerId).toBe(sellerId)
      expect(p.next.titleVi).toBeNull()
      expect(p.next.descriptionVi).toBeNull()
    }
  })
})

describe('the journal and the rollback', () => {
  it('a journal line carries the OLD and the new text of all five columns, and parses back', () => {
    const p = planRow(row())!
    const line = journalLine(p)
    expect(Object.keys(line.old).sort()).toEqual([...TEXT_FIELDS].sort())
    expect(line.old.title).toBe(row().title)
    const other = journalLine(planRow(row({ id: 'cm-row-2' }))!)
    expect(parseJournal(`${JSON.stringify(line)}\n\n${JSON.stringify(other)}\n`).lines).toEqual([line, other])
  })

  it('⛔ refuses a whole journal that names another seller, or a line it did not write', () => {
    const p = planRow(row())!
    const bad = { ...journalLine(p), sellerId: 'bds-vn-import-seller-0001' }
    expect(() => parseJournal(`${JSON.stringify(journalLine(p))}\n${JSON.stringify(bad)}`)).toThrow(/line 2 names seller bds-vn-import-seller-0001/)
    expect(() => parseJournal(JSON.stringify({ v: 1, id: 'x', sellerId: MUABAN_SELLER_ID }))).toThrow(/not a localize-import-listings line/)
  })

  it('⛔ refuses a journal that repeats a row, or whose externalId is not a string or null', () => {
    const line = journalLine(planRow(row())!)
    expect(() => parseJournal(`${JSON.stringify(line)}\n${JSON.stringify(line)}`)).toThrow(/line 2 repeats row cm-row-1/)
    expect(() => parseJournal(JSON.stringify({ ...line, externalId: 7 }))).toThrow(/not a localize-import-listings line/)
    expect(parseJournal(JSON.stringify({ ...line, externalId: null })).lines).toHaveLength(1)
  })

  it('the rollback command quotes the journal path — a space or a $ stays one argument', () => {
    expect(shellQuote("/Volumes/eno journals/a'b$x.jsonl")).toBe(`'/Volumes/eno journals/a'\\''b$x.jsonl'`)
    expect(rollbackCommand('/j/x y.jsonl')).toContain(`--rollback '/j/x y.jsonl' --apply`)
  })

  it('⛔ restores only rows the run’s OUTCOME says it wrote — never one an importer later set to the same text', () => {
    const a = journalLine(planRow(row({ id: 'a' }))!), b = journalLine(planRow(row({ id: 'b' }))!), c = journalLine(planRow(row({ id: 'c' }))!)
    // Batch 1 (a, b): a written, b lost its race. Batch 2 (c): the run stopped before its outcome line.
    const j = parseJournal([a, b, journalOutcome(['a'], ['b']), c].map((x) => JSON.stringify(x)).join('\n'))
    expect([...j.applied]).toEqual(['a'])
    expect([...j.raced]).toEqual(['b'])
    const now = (l: typeof a, text = l.new) => ({ ...text, sellerId: l.sellerId, externalId: l.externalId })
    expect(rollbackDecision(a, now(a), j)).toBe('restore')
    // b holds EXACTLY the new text — an importer on the new code wrote it — and is still left alone.
    expect(rollbackDecision(b, now(b), j)).toBe('raced')
    expect(rollbackDecision(c, now(c), j)).toBe('unconfirmed')
    expect(rollbackDecision(a, now(a, { ...a.new, title: 'refreshed' }), j)).toBe('changedSince')
    expect(rollbackDecision(a, undefined, j)).toBe('gone')
    // A row that moved to another in-scope seller, or changed externalId, is not the journalled row.
    expect(rollbackDecision(a, { ...now(a), sellerId: NHATOT_SELLER_ID }, j)).toBe('gone')
    expect(rollbackDecision(a, { ...now(a), externalId: 'muaban:1' }, j)).toBe('gone')
  })

  it('drops a TORN last line (a crash mid-append) instead of refusing the whole journal — and only the last', () => {
    const a = journalLine(planRow(row({ id: 'a' }))!), b = journalLine(planRow(row({ id: 'b' }))!)
    const good = `${JSON.stringify(a)}\n${JSON.stringify(journalOutcome(['a'], []))}\n`
    const torn = parseJournal(`${good}${JSON.stringify(b).slice(0, 40)}`)
    expect(torn.torn).toBe(true)
    expect(torn.lines.map((l) => l.id)).toEqual(['a'])
    expect([...torn.applied]).toEqual(['a'])
    expect(parseJournal(good).torn).toBeUndefined()
    // A complete last line with no newline is kept; a torn line in the MIDDLE is corruption.
    expect(parseJournal(`${good}${JSON.stringify(b)}`).lines.map((l) => l.id)).toEqual(['a', 'b'])
    expect(() => parseJournal(`${JSON.stringify(a).slice(0, 40)}\n${JSON.stringify(b)}\n`)).toThrow()
  })

  it('⛔ refuses an outcome that names a row no earlier line journalled, or names one twice', () => {
    const a = journalLine(planRow(row({ id: 'a' }))!)
    expect(() => parseJournal([journalOutcome(['a'], []), a].map((x) => JSON.stringify(x)).join('\n'))).toThrow(/line 1 reports row a/)
    expect(() => parseJournal([a, journalOutcome(['a'], ['a'])].map((x) => JSON.stringify(x)).join('\n'))).toThrow(/line 2 reports row a/)
    expect(() => parseJournal([a, { v: 1, outcome: { applied: 'a' } }].map((x) => JSON.stringify(x)).join('\n'))).toThrow(/not a localize-import-listings outcome/)
  })

  it('every write is pinned to the row, its seller and its externalId as read — and the seller still in scope', () => {
    expect(rowWhere({ id: 'x', sellerId: MUABAN_SELLER_ID, externalId: 'muaban:1' })).toEqual({
      id: 'x', externalId: 'muaban:1', sellerId: { equals: MUABAN_SELLER_ID, in: [...LOCALIZE_SELLERS] },
    })
  })

  it('restores a row only while it still holds exactly what this run wrote', () => {
    const line = journalLine(planRow(row())!)
    expect(stillAsWritten(line.new, line)).toBe(true)
    expect(stillAsWritten({ ...line.new, searchText: `${line.new.searchText} x` }, line)).toBe(false)
    expect(stillAsWritten(line.old, line)).toBe(false)
    expect(rollbackCommand('/j/x.jsonl')).toMatch(/--rollback '\/j\/x\.jsonl' +# dry run first\n.*--rollback '\/j\/x\.jsonl' --apply$/)
  })
})

describe('parseArgs — a typo never becomes a different run', () => {
  it('dry run by default; --apply needs a journal dir', () => {
    expect(parseArgs([])).toEqual({ apply: false, journalDir: null, rollback: null, limit: null, missingOut: null, samples: 10 })
    expect(() => parseArgs(['--apply'])).toThrow(/--apply needs --journal-dir/)
    expect(parseArgs(['--apply', '--journal-dir', '/Users/x/j', '--limit', '50'])).toMatchObject({ apply: true, journalDir: '/Users/x/j', limit: 50 })
  })
  it('refuses unknown flags, missing values and bad numbers', () => {
    expect(() => parseArgs(['--aply'])).toThrow(/unknown argument "--aply"/)
    expect(() => parseArgs(['--journal-dir'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--journal-dir', '--apply'])).toThrow(/needs a value/)
    for (const n of ['0', '-1', '1.5', 'ten', '']) expect(() => parseArgs(['--limit', n]), n).toThrow()
  })
  it('--rollback replays a journal, with or without --apply, and takes neither --journal-dir nor --limit', () => {
    expect(parseArgs(['--rollback', '/j/x.jsonl'])).toMatchObject({ rollback: '/j/x.jsonl', apply: false })
    expect(parseArgs(['--rollback', '/j/x.jsonl', '--apply'])).toMatchObject({ rollback: '/j/x.jsonl', apply: true })
    expect(() => parseArgs(['--rollback', '/j/x.jsonl', '--journal-dir', '/j'])).toThrow()
    expect(() => parseArgs(['--rollback', '/j/x.jsonl', '--limit', '5'])).toThrow()
  })
})

describe('the report', () => {
  it('samples round-robin across the sellers, only rows that change', () => {
    const plans = [
      ...[1, 2, 3, 4].map((i) => planRow(row({ id: `m${i}` }))!),
      ...[1, 2].map((i) => planRow(row({ id: `n${i}`, sellerId: NHATOT_SELLER_ID }))!),
      planRow(row({ id: 'h1', sellerId: HONEYCOMB_SELLER_ID }))!,
      { ...planRow(row({ id: 'h-same', sellerId: HONEYCOMB_SELLER_ID }))!, changed: [] },
    ]
    expect(pickSamples(plans, 5).map((p) => p.id)).toEqual(['n1', 'm1', 'h1', 'n2', 'm2'])
    expect(pickSamples(plans, 100).map((p) => p.id)).not.toContain('h-same')
  })

  it('counts each untranslated segment across rows, most frequent first', () => {
    const unknown = (id: string) => planRow(row({ id, description: 'Street: Đường Chưa Dịch\nFacing: Hướng Lạ' }))!
    const r = missingReport([unknown('a'), unknown('b'), planRow(row({ id: 'c', description: 'Facing: Hướng Lạ' }))!])
    expect(r).toEqual([
      { target: 'en', kind: 'desc:Facing', src: 'Hướng Lạ', n: 3 },
      { target: 'en', kind: 'desc:Street', src: 'Đường Chưa Dịch', n: 2 },
    ])
  })
})

describe('scripts/localize-import-listings.ts wiring', () => {
  const src = readFileSync('scripts/localize-import-listings.ts', 'utf8')

  it('⛔ every read and every write is scoped to the three sellers', () => {
    expect(src).toMatch(/where: \{ \.\.\.scopeWhere\(\), \.\.\.\(after \? \{ id: \{ gt: after \} \} : \{\}\) \}/)
    expect(src).toMatch(/where: \{ \.\.\.rowWhere\(p\), \.\.\.p\.old \},\n\s+data: p\.next,/)
    expect(src).toMatch(/where: \{ \.\.\.rowWhere\(l\), \.\.\.l\.new \}, data: l\.old/)
    expect(src).toMatch(/where: \{ id: \{ in: chunk\.map\(\(l\) => l\.id\) \}, \.\.\.scopeWhere\(\) \}/)
    expect(src.match(/db\.listing\.(?:findMany|updateMany|update|upsert|create|delete)\w*\(/g)).toHaveLength(4)
  })

  it('⛔ journals each batch durably BEFORE the batch is written, in batches of 200', () => {
    expect(BATCH).toBe(200)
    const loop = src.slice(src.indexOf('for (let i = 0; i < todo.length; i += BATCH) {'), src.indexOf('APPLIED'))
    expect(loop.indexOf('appendDurably(journal,')).toBeGreaterThan(0)
    expect(loop.indexOf('appendDurably(journal,')).toBeLessThan(loop.indexOf('db.$transaction('))
    // …and the OUTCOME of the batch is journalled after it commits, before the next batch.
    expect(loop.indexOf('appendDurably(journal, [JSON.stringify(journalOutcome(applied, raced))])')).toBeGreaterThan(loop.indexOf('db.$transaction('))
    // Every byte is written (writeSync may write less than asked), then fsynced.
    expect(src).toMatch(/for \(let off = 0; off < buf\.length;\) off \+= writeSync\(fd, buf, off, buf\.length - off\)\n\s+fsyncSync\(fd\)/)
    // ⛔ The directory entry is synced per FILE — a process-wide flag was set by the probe and the
    // real journal's entry was never synced.
    expect(src).toMatch(/const dirSynced = new Set<string>\(\)/)
    expect(src).toMatch(/if \(!dirSynced\.has\(file\)\) \{/)
    expect(src).not.toMatch(/let dirSynced/)
    // Nothing to change → no journal and no rollback command pointing at a file that does not exist.
    const apply = src.slice(src.indexOf('const todo = args.limit'))
    expect(apply.indexOf('if (!todo.length)')).toBeGreaterThan(0)
    expect(apply.indexOf('if (!todo.length)')).toBeLessThan(apply.indexOf('rollbackCommand(journal)'))
  })

  it('⛔ proves the journal dir before opening the database, and the dry run is read-only at the server', () => {
    const main = src.slice(src.indexOf('async function localize('))
    expect(main.indexOf('durableJournalDir(args.journalDir!)')).toBeGreaterThan(0)
    expect(main.indexOf('durableJournalDir(args.journalDir!)')).toBeLessThan(main.indexOf('await openDb('))
    expect(src).toMatch(/new PrismaPg\(write \? \{ connectionString \} : \{ connectionString, options: '-c default_transaction_read_only=on' \}\)/)
    expect(src).toMatch(/SHOW default_transaction_read_only/)
    expect(src).toMatch(/const db = await openDb\(args\.apply\)/)
  })
})
