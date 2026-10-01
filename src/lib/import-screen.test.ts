import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ImportScreen, screenImportRow, type ScreenDb } from './import-screen'
import { HIDE_SQL, SNAPSHOT_SQL } from './journaled-hide'

// The screen every importer (scripts/import-*.ts) runs before it writes a row. Pinned: the order (a
// banned word wins), that the banned-word half reads TITLES WITH ACCENTS (not folded descriptions —
// the 2026-10-01 review measured 275 live rows refused by folding collisions), that 'ban' and
// 'review' both keep a NEW row out, that an EXISTING row is never silently frozen (banned → hidden,
// journaled; review → refreshed), that every refusal reaches the review file, and that linked rows are
// NOT held to the contact-info screen (they name their source).

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'import-screen-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** A fake database: rows by externalId, and every raw statement recorded. The two raw statements
 *  journaledHide runs (src/lib/journaled-hide.ts) are emulated: the snapshot returns live rows with
 *  their updatedAt stamp, the hide flips a row only while its status AND stamp match the journal. */
function fakeDb(rows: { id: string; status: string; externalId: string; sellerId?: string; updatedAt?: string }[]) {
  const calls: { sql: string; values: unknown[] }[] = []
  const finds: Record<string, unknown>[] = []
  const db: ScreenDb = {
    listing: {
      findMany: async ({ where }) => {
        finds.push(where)
        const sellers = (where.sellerId as { in?: string[] } | undefined)?.in
        return rows
          .filter((r) => r.externalId === where.externalId && (!sellers || sellers.includes(r.sellerId ?? 's1')))
          .map((r) => ({ id: r.id, status: r.status, externalId: r.externalId, sellerId: r.sellerId ?? 's1' }))
      },
    },
    $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => {
      calls.push({ sql, values })
      if (sql === SNAPSHOT_SQL) {
        const ids = values[0] as string[]
        return rows.filter((r) => ids.includes(r.id) && (r.status === 'active' || r.status === 'sold')).map((r) => ({ id: r.id, status: r.status, updatedAt: r.updatedAt ?? 'T0' }))
      }
      if (sql === HIDE_SQL) {
        const [ids, priors, upds] = values as [string[], string[], string[]]
        const done: { id: string }[] = []
        ids.forEach((id, i) => {
          const r = rows.find((x) => x.id === id)
          if (r && r.status === priors[i] && (r.updatedAt ?? 'T0') === upds[i]) { r.status = 'hidden'; done.push({ id }) }
        })
        return done
      }
      throw new Error(`unexpected SQL: ${sql}`)
    }) as ScreenDb['$queryRawUnsafe'],
  }
  return { db, calls, finds, rows }
}

describe('screenImportRow', () => {
  it('imports an ordinary row — and does not run the contact screen on a linked row', () => {
    expect(screenImportRow({ title: 'iPhone 15 Pro 256GB', description: 'Xem tại cellphones.com.vn' })).toEqual({ action: 'import' })
    expect(screenImportRow({ title: 'Căn hộ 2PN Thảo Điền', description: 'Listed on Rever.vn.', category: 'rentals' })).toEqual({ action: 'import' })
  })

  it('skips a banned word first, from a title or a short public text', () => {
    expect(screenImportRow({ title: 'Đồng hồ', extraTexts: ['bán súng đạn'] })).toMatchObject({ action: 'skip', reason: 'banned_word' })
    expect(screenImportRow({ title: 'Cần bán vũ khí tự chế' })).toMatchObject({ action: 'skip', reason: 'banned_word', matched: 'vu khi' })
    // Typed without accents: the folded reading is all there is, so it still counts.
    expect(screenImportRow({ title: 'ban sung dan gia re' })).toMatchObject({ action: 'skip', reason: 'banned_word' })
  })

  it('⛔ live false positives from the review measurement: folding collisions are imported', () => {
    // Descriptions are not read by the banned-word half at all…
    expect(screenImportRow({ title: 'Điều hòa Casper Inverter 1HP', description: 'Sản phẩm thuộc phiên bản 2024' })).toEqual({ action: 'import' })
    expect(screenImportRow({ title: 'Ổ khóa số TSA', description: 'Đặt mật mã tùy thích' })).toEqual({ action: 'import' })
    expect(screenImportRow({ title: 'Laptop HP 15s', description: 'Hiệu năng cao hỗ trợ đa nhiệm' })).toEqual({ action: 'import' })
    expect(screenImportRow({ title: 'Kit ESP32 DevKit V1', description: 'Shop xuất hoá đơn VAT đầy đủ' })).toEqual({ action: 'import' })
    // …and a title is read WITH its accents.
    expect(screenImportRow({ title: 'Áo polo xanh cô ban đậm' })).toEqual({ action: 'import' })
  })

  it('⛔ an UNACCENTED banned term inside an accented title is refused (per word, not per text)', () => {
    expect(screenImportRow({ title: 'Cần bán sung dan' })).toMatchObject({ action: 'skip', reason: 'banned_word', matched: 'sung dan' })
    expect(screenImportRow({ title: 'Đồng hồ', extraTexts: ['bán ma tuy'] })).toMatchObject({ action: 'skip', reason: 'banned_word', matched: 'ma tuy' })
    // The accepted price: an honestly unaccented phrase ("vi vu khi") goes to review, never live.
    expect(screenImportRow({ title: 'Balo du lịch vi vu khi đi phượt' })).toMatchObject({ action: 'skip', reason: 'banned_word', matched: 'vu khi' })
  })

  it('skips an ad-banned product, and an ambiguous one as review', () => {
    expect(screenImportRow({ title: 'Rượu HALICO 30°' })).toMatchObject({ action: 'skip', reason: 'ad_banned', rule: 'spirits' })
    expect(screenImportRow({ title: 'Bình sữa Wesser' })).toMatchObject({ action: 'skip', reason: 'ad_banned', rule: 'feeding_bottle' })
    expect(screenImportRow({ title: 'Rượu Bàu Đá Bình Định' })).toMatchObject({ action: 'skip', reason: 'ad_review', rule: 'spirits' })
  })
})

describe('ImportScreen — a new row', () => {
  it('counts every refusal, writes ALL of them (banned words included) to the review file, prints a summary', async () => {
    const dir = tmp()
    const s = new ImportScreen('test', { dir })
    expect(await s.check({ title: 'Ốp lưng iPhone 15' })).toBe(true)
    expect(await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })).toBe(false)
    expect(await s.check({ title: 'Soju Jinro combo tự chọn vị', externalId: 'x2', url: 'https://tiki.vn/x2' })).toBe(false)
    expect(await s.check({ title: 'Bravecto cho chó 10-20kg', externalId: 'x3' })).toBe(false)
    expect(s.counts).toEqual({ banned_word: 1, ad_banned: 1, ad_review: 1 })
    const lines: string[] = []
    const out = await s.finish({ apply: false, log: (l) => lines.push(l) })
    expect(lines[0]).toMatch(/3 refused — 1 banned word, 1 ad-banned, 1 held for review/)
    expect(lines[1]).toMatch(/3 not created · 0 live row\(s\) to hide/)
    const file = JSON.parse(readFileSync(out.review!, 'utf8'))
    expect(file.importer).toBe('test')
    expect(file.rows.map((r: { externalId: string; reason: string; action: string }) => [r.externalId, r.reason, r.action])).toEqual([
      ['x1', 'ad_banned', 'not_created'], ['x2', 'ad_review', 'not_created'], ['x3', 'banned_word', 'not_created'],
    ])
    expect(out.journal).toBeNull()
  })

  it('writes no file when nothing was refused, and an accepted row never queries the database', async () => {
    const { db, finds } = fakeDb([])
    const s = new ImportScreen('test', { dir: tmp(), db })
    expect(await s.check({ title: 'Nồi cơm điện Sharp 1.8L', externalId: 'ok1' })).toBe(true)
    expect(finds).toEqual([])
    expect((await s.finish({ apply: true, log: () => {} })).review).toBeNull()
  })
})

describe('ImportScreen — an EXISTING row is never silently frozen', () => {
  it('banned + live → not refreshed, and HIDDEN by finish() — snapshot, journal first, guarded raw SQL', async () => {
    const dir = tmp()
    const { db, calls, rows } = fakeDb([
      { id: 'L1', status: 'active', externalId: 'x1' },
      { id: 'L2', status: 'sold', externalId: 'x2' },
    ])
    const s = new ImportScreen('test', { dir, db, sellerIds: ['s1'] })
    expect(await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })).toBe(false)
    expect(await s.check({ title: 'Bán vũ khí', externalId: 'x2' })).toBe(false)
    const out = await s.finish({ apply: true, log: () => {} })
    expect(out.hidden).toBe(2)
    expect(rows.map((r) => r.status)).toEqual(['hidden', 'hidden'])
    expect(calls.map((c) => c.sql)).toEqual([SNAPSHOT_SQL, HIDE_SQL])
    // The hide carries the journaled status AND updatedAt per row — the state --rollback checks against.
    expect(calls[1].values).toEqual([['L1', 'L2'], ['active', 'sold'], ['T0', 'T0']])
    const journal = JSON.parse(readFileSync(out.journal!, 'utf8'))
    // The format scripts/hide-ad-banned.ts --rollback reads.
    expect(journal).toMatchObject({ kind: 'import-screen-hide', importer: 'test', rows: [{ id: 'L1', priorStatus: 'active', updatedAt: 'T0', rule: 'spirits' }, { id: 'L2', priorStatus: 'sold', updatedAt: 'T0', rule: 'banned_word' }] })
    const review = JSON.parse(readFileSync(out.review!, 'utf8'))
    expect(review.rows.map((r: { listingId: string; action: string }) => [r.listingId, r.action])).toEqual([['L1', 'hide'], ['L2', 'hide']])
  })

  it('a dry run hides nothing and says how many it would', async () => {
    const { db, calls, rows } = fakeDb([{ id: 'L1', status: 'active', externalId: 'x1' }])
    const s = new ImportScreen('test', { dir: tmp(), db })
    await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })
    const lines: string[] = []
    const out = await s.finish({ apply: false, log: (l) => lines.push(l) })
    expect(calls).toEqual([])
    expect(rows[0].status).toBe('active')
    expect(out.journal).toBeNull()
    expect(lines.join('\n')).toMatch(/1 live row\(s\) to hide — hidden on --apply/)
  })

  it('review + existing → REFRESHED (check returns true) and listed for a human; nothing hidden', async () => {
    const { db, calls } = fakeDb([{ id: 'L1', status: 'active', externalId: 'x1' }])
    const s = new ImportScreen('test', { dir: tmp(), db })
    expect(await s.check({ title: 'Rượu Bàu Đá Bình Định', externalId: 'x1' })).toBe(true)
    const out = await s.finish({ apply: true, log: () => {} })
    expect(calls).toEqual([])
    expect(JSON.parse(readFileSync(out.review!, 'utf8')).rows[0]).toMatchObject({ listingId: 'L1', reason: 'ad_review', action: 'refreshed_for_review' })
  })

  it('a row a human hid, or a tombstone, is left exactly as it is', async () => {
    const s = new ImportScreen('test', { dir: tmp() })
    expect(await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' }, { id: 'L1', status: 'hidden' })).toBe(false)
    expect(await s.check({ title: 'Rượu Bàu Đá Bình Định', externalId: 'x2' }, { id: 'L2', status: 'removed' })).toBe(false)
    expect(s.toHide).toEqual([])
    expect(s.reviews.map((r) => r.action)).toEqual(['left_as_is', 'left_as_is'])
  })

  // ⛔ 2026-10-01 review: 'review' on a HELD row used to return true — the importer then refreshed the
  // text, price and photos a human had taken down. Only a live (active|sold) row is refreshed.
  it.each(['hidden', 'draft'])('review + %s (a human hold) → NOT refreshed (check returns false), nothing hidden', async (status) => {
    const { db, calls } = fakeDb([{ id: 'L1', status, externalId: 'x1' }])
    const s = new ImportScreen('test', { dir: tmp(), db })
    expect(await s.check({ title: 'Rượu Bàu Đá Bình Định', externalId: 'x1' })).toBe(false)
    expect(await s.check({ title: 'Rượu Bàu Đá Bình Định', externalId: 'x2' }, { id: 'L2', status })).toBe(false)
    expect(s.toHide).toEqual([])
    expect(s.reviews.map((r) => [r.listingId, r.reason, r.action])).toEqual([['L1', 'ad_review', 'left_as_is'], ['L2', 'ad_review', 'left_as_is']])
    await s.finish({ apply: true, log: () => {} })
    expect(calls).toEqual([])
  })

  it('review + sold → refreshed (a sold row is live: the sold page renders it)', async () => {
    const s = new ImportScreen('test', { dir: tmp() })
    expect(await s.check({ title: 'Rượu Bàu Đá Bình Định', externalId: 'x1' }, { id: 'L1', status: 'sold' })).toBe(true)
    expect(s.reviews[0].action).toBe('refreshed_for_review')
  })

  it('a row that changed between the snapshot and the hide is skipped; the journal still holds the stamp --rollback checks', async () => {
    const { db, rows } = fakeDb([{ id: 'L1', status: 'active', externalId: 'x1', updatedAt: 'T0' }])
    const s = new ImportScreen('test', { dir: tmp(), db })
    await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })
    // A moderator edits the row after the snapshot: its updatedAt moves, so the guarded hide matches nothing.
    const orig = db.$queryRawUnsafe
    db.$queryRawUnsafe = (async (sql: string, ...values: unknown[]) => {
      const r = await orig(sql, ...values)
      if (sql === SNAPSHOT_SQL) rows[0].updatedAt = 'T1'
      return r
    }) as ScreenDb['$queryRawUnsafe']
    const out = await s.applyHides(() => {})
    expect(out.hidden).toBe(0)
    expect(rows[0].status).toBe('active')
  })

  it('applyHides({ sellerIds }) hides only rows in the vetted storefronts', async () => {
    const { db, rows } = fakeDb([
      { id: 'L1', status: 'active', externalId: 'x1', sellerId: 'ok' },
      { id: 'L2', status: 'active', externalId: 'x2', sellerId: 'refused' },
    ])
    const s = new ImportScreen('test', { dir: tmp(), db })
    await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })
    await s.check({ title: 'Rượu HALICO 30°', externalId: 'x2' })
    const lines: string[] = []
    const out = await s.applyHides((l) => lines.push(l), { sellerIds: ['ok'] })
    expect(out.hidden).toBe(1)
    expect(rows.map((r) => r.status)).toEqual(['hidden', 'active'])
    expect(lines.join('\n')).toMatch(/1 live row\(s\) to hide are in a storefront this run refused or never vetted — NOT hidden/)
  })

  it('an importer that already read the row passes it, and no lookup runs', async () => {
    const { db, finds } = fakeDb([{ id: 'L9', status: 'active', externalId: 'x1' }])
    const s = new ImportScreen('test', { dir: tmp(), db })
    expect(await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' }, null)).toBe(false)
    expect(finds).toEqual([])
    expect(s.reviews[0].action).toBe('not_created')
  })

  it('the lookup is scoped to the importer\'s storefronts, and never to an owned one', async () => {
    const { db, finds } = fakeDb([{ id: 'L1', status: 'active', externalId: 'x1', sellerId: 'other' }])
    const s = new ImportScreen('test', { dir: tmp(), db, sellerIds: ['s1'] })
    await s.check({ title: 'Rượu HALICO 30°', externalId: 'x1' })
    expect(finds[0]).toEqual({ externalId: 'x1', seller: { ownerId: null }, sellerId: { in: ['s1'] } })
    expect(s.toHide).toEqual([]) // another shop's row with the same key is not this importer's to hide
  })
})

describe('a BOOK that names a weapon, a drug or a crime is a book (live Tiki rows, 2026-10-01)', () => {
  it.each([
    'Sách Lịch Sử Quân Sự - Bách Khoa Thư Các Loại Vũ Khí Định Hình Thế Giới',
    'Sách Các Ty Độc Quyền Thuốc Phiện Và Muối Ở Đông Dương',
    'Thành phố xương Phần 1 series Vũ khí bóng đêm - Tái Bản',
    'Thành phố xương Phần 1 series Vũ khí bóng đêm',
    'Sách Sống Như Bông Pháo Hoa Hành Trình Khám Phá Điều Quý Giá Nhất Cuộc Đời',
  ])('%s → imported', (titleVi) => expect(screenImportRow({ title: 'Book', titleVi })).toEqual({ action: 'import' }))

  it('by category too — and a vet drug, which is no book, is still refused', () => {
    expect(screenImportRow({ title: 'Vũ Khí Bóng Đêm - Phần 2 Thành Phố Tro Tàn', category: 'books-stationery' })).toEqual({ action: 'import' })
    expect(screenImportRow({ title: 'Viên nhai Nexgard trị ve rận, bọ chét cho chó 1 viên - 2-4 kgs' })).toMatchObject({ action: 'skip', matched: 'nexgard' })
    // A gift book does not make the product a book.
    expect(screenImportRow({ title: 'Bán vũ khí tự vệ tặng sách hướng dẫn' })).toMatchObject({ action: 'skip', reason: 'banned_word' })
  })
})
