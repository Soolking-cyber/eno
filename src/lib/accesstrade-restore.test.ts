import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PENDING_UNDO_SQL, RESTORE_PRICED_SQL, UNDO_COUNT_SQL, UNDO_SQL, isUndoJournal, keepUsedRows, pickRestores, usedForShelf, type FeedItem, type HeldRow, type RestoreJournalRow } from './accesstrade-restore'
import { mkdirDurably, writeFileDurably } from './durable-file'
import { RESTORE_SQL } from './journaled-hide'
import { licenceClearedSql } from './licence-stamp'

const CPS = 'cmt78nvif0000gpq48kvzmxjw'
const DTV = 'cmtr9qva90000glq44fkjs18b'
const T = '2026-10-13 04:50:00.123456'
const link = 'https://go.isclix.com/deep_link/7053736680188167797/4842412845025484719?url=https%3A%2F%2Fcellphones.com.vn%2Fx'

const j = (id: string, over: Partial<RestoreJournalRow> = {}): RestoreJournalRow => ({ id, sellerId: CPS, priorStatus: 'active', updatedAt: T, ...over })
const h = (id: string, over: Partial<HeldRow> = {}): HeldRow => ({ id, sellerId: CPS, externalId: `sku-${id}`, status: 'hidden', updatedAt: T, condition: 'used', ...over })
const f = (over: Partial<FeedItem> = {}): FeedItem => ({ price: 13_590_000, affiliateUrl: link, name: 'iPhone 12 Pro Max 512GB - Cũ đẹp', url: 'https://cellphones.com.vn/iphone-12-pro-max-512gb-cu.html', ...over })

describe('pickRestores — which hidden AccessTrade used rows come back (owner 2026-11-14)', () => {
  it('picks a row still as the hide left it, in today\'s feed, still called used — at TODAY\'s price and link', () => {
    const { picks, skipped } = pickRestores([j('a')], new Map([['a', h('a')]]), new Map([[CPS, new Map([['sku-a', f()]])]]))
    expect(picks).toEqual([{ id: 'a', sellerId: CPS, prior: 'active', upd: T, price: 13_590_000, affiliateUrl: link }])
    expect(Object.values(skipped).every((n) => n === 0)).toBe(true)
  })
  it('a journaled sold row goes back to sold (the screened nightly restock flips it), not straight to active', () => {
    const { picks } = pickRestores([j('a', { priorStatus: 'sold' })], new Map([['a', h('a')]]), new Map([[CPS, new Map([['sku-a', f()]])]]))
    expect(picks[0].prior).toBe('sold')
  })
  it('leaves hidden every row it cannot vouch for, and says why', () => {
    const journal = [
      j('gone'), j('other', { sellerId: 'someone-else' }), j('unstamped', { updatedAt: undefined }),
      j('touched'), j('relabelled'), j('noext'), j('sold-out'), j('new-now'), j('nolink'), j('dtv'), j('stored-new'),
    ]
    const held = new Map<string, HeldRow>([
      ['other', h('other', { sellerId: 'someone-else' })], ['unstamped', h('unstamped')],
      ['touched', h('touched', { updatedAt: '2026-11-01 00:00:00' })], ['relabelled', h('relabelled', { status: 'active' })],
      ['noext', h('noext', { externalId: null })], ['sold-out', h('sold-out')], ['new-now', h('new-now')], ['nolink', h('nolink')],
      ['dtv', h('dtv', { sellerId: DTV })], ['stored-new', h('stored-new', { condition: 'new' })],
    ])
    const feeds = new Map([[CPS, new Map([
      ['sku-new-now', f({ name: 'iPhone 17 Pro Max 512GB VN/A - Đã kích hoạt', url: 'https://cellphones.com.vn/iphone-17-pro-max.html' })],
      ['sku-nolink', f({ affiliateUrl: null })],
      ['sku-unstamped', f()], ['sku-touched', f()], ['sku-relabelled', f()], ['sku-stored-new', f()],
    ])]])
    const { picks, skipped } = pickRestores(journal, held, feeds)
    expect(picks).toEqual([])
    expect(skipped).toEqual({ not_found: 1, not_this_shop: 2, unstamped: 1, changed_since_hide: 2, not_used_in_db: 1, no_external_id: 1, not_in_feed: 1, not_used: 1, no_link: 1 })
  })
  it('reads the feed name DECODED, as the importer does ("C&#361;" is "Cũ")', () => {
    const { picks } = pickRestores([j('a')], new Map([['a', h('a')]]),
      new Map([[CPS, new Map([['sku-a', f({ name: 'iPhone 12 128GB - C&#361; đẹp', url: 'https://cellphones.com.vn/iphone-12-128gb.html' })]])]]))
    expect(picks.map((p) => p.id)).toEqual(['a'])
  })
  it('"Củ sạc" (a charger) is not "cũ": a new accessory is never restored as used', () => {
    const { picks, skipped } = pickRestores([j('a')], new Map([['a', h('a')]]),
      new Map([[CPS, new Map([['sku-a', f({ name: 'Củ sạc nhanh Apple 20W', url: 'https://cellphones.com.vn/cu-sac-apple-20w.html' })]])]]))
    expect(picks).toEqual([])
    expect(skipped.not_used).toBe(1)
  })
})

describe('the restore and undo SQL', () => {
  it('restores under exactly the journaled-restore condition, and writes price + link in the same statement', () => {
    const cond = RESTORE_SQL.slice(RESTORE_SQL.indexOf('WHERE ') + 6, RESTORE_SQL.indexOf(' RETURNING'))
    // …AND the licence check's guard, as every publish of an existing row (commit gate, opus 2026-11-14).
    expect(RESTORE_PRICED_SQL).toContain(`WHERE ${cond} AND ${licenceClearedSql('l.')} RETURNING`)
    expect(RESTORE_PRICED_SQL).toContain('price = j.price, "affiliateUrl" = j.url')
    expect(RESTORE_PRICED_SQL).toContain('$4::timestamp')
    expect(RESTORE_PRICED_SQL).not.toMatch(/previousPrice|priceDropAt/)
    expect(RESTORE_PRICED_SQL).toContain(`"updatedAt" = (now() AT TIME ZONE 'UTC')`)
    expect(RESTORE_PRICED_SQL).toContain(`"verificationNotes" = NULLIF(l."verificationNotes", 'licence:held')`)
  })
  it('undo hides only a row still exactly as the run left it, in an ownerless storefront, and keeps updatedAt', () => {
    expect(UNDO_SQL).toContain(`l.status = j.st AND l."updatedAt"::text = j.upd`)
    expect(UNDO_SQL).toContain('"ownerId" IS NULL')
    expect(UNDO_SQL).not.toContain('"updatedAt" =')
    // A takedown that files no report drops the licence hold's mark (CLAUDE.md), the undo's and --hide's alike.
    expect(UNDO_SQL).toContain(`"verificationNotes" = NULLIF(l."verificationNotes", 'licence:held')`)
    expect(PENDING_UNDO_SQL).toContain(`"verificationNotes" = NULLIF(l."verificationNotes", 'licence:held')`)
    // The dry run's count is the write's own condition — it cannot promise more than --apply hides.
    expect(UNDO_COUNT_SQL.slice(UNDO_COUNT_SQL.indexOf('WHERE'))).toBe(UNDO_SQL.slice(UNDO_SQL.indexOf('WHERE'), UNDO_SQL.indexOf(' RETURNING')))
  })
  it('--hide (named unstamped rows) hides only a live row (never a tombstone), in an ownerless storefront, and keeps updatedAt', () => {
    expect(PENDING_UNDO_SQL).toContain(`l.status IN ('active', 'sold')`)
    expect(PENDING_UNDO_SQL).toContain('"ownerId" IS NULL')
    expect(PENDING_UNDO_SQL).not.toContain('"updatedAt"')
  })
  it('undo reads only this restore\'s journal or the used-only import\'s, each row fully stamped', () => {
    const rows = [{ id: 'a', status: 'active', updatedAt: T }]
    expect(isUndoJournal({ kind: 'restore-accesstrade-used', createdAt: 'x', rows })).toBe(true)
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows })).toBe(true)
    expect(isUndoJournal({ kind: 'hide-accesstrade', createdAt: 'x', rows })).toBe(false)
    expect(isUndoJournal({ kind: 'restore-accesstrade-used', createdAt: 'x', rows: [{ id: 'a', status: 'active', updatedAt: '' }] })).toBe(false)
    expect(isUndoJournal({ kind: 'restore-accesstrade-used', createdAt: 'x', rows, pending: ['b'] })).toBe(true)
    expect(isUndoJournal({ kind: 'restore-accesstrade-used', createdAt: 'x', rows, pending: [3] })).toBe(false)
    // The importer's SKUs-in-flight need the storefront they belong to, or --undo could not resolve them.
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows, sellerId: CPS, pendingExternalIds: ['sku-1'] })).toBe(true)
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows, pendingExternalIds: ['sku-1'] })).toBe(false)
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows, sellerId: null, pendingExternalIds: [] })).toBe(true)
    expect(isUndoJournal(null)).toBe(false)
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows, savedAt: '2026-11-14T08:00:00Z' })).toBe(true)
    expect(isUndoJournal({ kind: 'import-accesstrade-created', createdAt: 'x', rows, savedAt: 3 })).toBe(false)
  })
})

describe('keepUsedRows — the nightly walk of a used-only shelf keeps only what is still used (commit gate, codex 2026-11-14)', () => {
  it('takes a SKU the shop now sells as new out of the prices and hands its SKU back', () => {
    const prices = new Map<string, FeedItem>([
      ['used', f()],
      ['decoded', f({ name: 'iPhone 12 128GB - C&#361; đẹp', url: 'https://cellphones.com.vn/iphone-12-128gb.html' })],
      ['new', f({ name: 'iPhone 17 Pro Max 256GB VN/A', url: 'https://cellphones.com.vn/iphone-17-pro-max.html' })],
      ['charger', f({ name: 'Củ sạc nhanh Apple 20W', url: 'https://cellphones.com.vn/cu-sac-apple-20w.html' })],
      ['noname', f({ name: '  ', url: '' })],
    ])
    const unpriced = new Map([
      ['unpriced-new', { name: 'iPhone 17 Pro Max 256GB VN/A', url: 'https://cellphones.com.vn/iphone-17-pro-max.html' }],
      ['unpriced-used', { name: 'iPhone 12 128GB - Cũ đẹp', url: 'https://cellphones.com.vn/iphone-12-cu.html' }],
      ['unpriced-noname', { name: '', url: '' }],
    ])
    // A row the walk dropped for its price is judged by its name too (codex, gate round 4).
    expect([...keepUsedRows(prices, unpriced)]).toEqual(['new', 'charger', 'unpriced-new'])
    // A row with no name is no evidence either way: out of the prices (no reprice, no restock) and NOT handed back
    // (no retire) — its listing is left exactly as it is.
    expect([...prices.keys()]).toEqual(['used', 'decoded'])
  })
})

describe('writeFileDurably — the journals survive a crash (commit gate, codex 2026-11-14)', () => {
  it('mkdirDurably makes the whole chain, and is a no-op when it exists', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'durable-')), 'a', 'b', 'c')
    mkdirDurably(dir); mkdirDurably(dir)
    expect(readdirSync(dir)).toEqual([])
  })
  it('writes the file whole, replaces it in place, and leaves no temp file', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'durable-')), 'nested')
    writeFileDurably(dir, 'j.json', '{"a":1}')
    writeFileDurably(dir, 'j.json', '{"a":2}')
    expect(readFileSync(join(dir, 'j.json'), 'utf8')).toBe('{"a":2}')
    expect(readdirSync(dir)).toEqual(['j.json'])
  })
})

describe('usedForShelf — the two shelves\' one rule: the shop says used, and no trade-in wording (gate rounds 7–16)', () => {
  it('a NEW phone with a trade-in offer is not used, however the offer is punctuated', () => {
    for (const name of ['iPhone 17 Pro Max 256GB - Thu cũ đổi mới', 'iPhone 17 Pro Max — Thu cũ, đổi mới', 'iPhone 17 Pro Max - Thu cũ trợ giá 2 triệu', 'Galaxy Z Fold7 | Đổi cũ lấy mới', 'Galaxy S25 (thu-cũ lên đời)'])
      expect(usedForShelf(name, 'https://cellphones.com.vn/x.html')).toBe(false)
  })
  it('a used unit is used; a charger ("Củ sạc") is not; the feed\'s entities are decoded', () => {
    expect(usedForShelf('iPhone 13 128GB - Cũ đẹp', 'https://cellphones.com.vn/iphone-13-128gb-cu-dep.html')).toBe(true)
    expect(usedForShelf('iPhone 12 128GB - C&#361; đẹp', 'https://cellphones.com.vn/x.html')).toBe(true)
    expect(usedForShelf('Củ sạc nhanh Apple 20W', 'https://cellphones.com.vn/cu-sac-apple-20w.html')).toBe(false)
  })
  it('errs only toward leaving a row OUT: a used unit that also advertises a trade-in is left out', () => {
    expect(usedForShelf('iPhone 13 128GB - Cũ đẹp | Thu cũ đổi mới', 'https://cellphones.com.vn/iphone-13-cu-dep.html')).toBe(false)
  })
})
