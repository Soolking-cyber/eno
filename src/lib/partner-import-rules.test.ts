import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockedAsDeclaredNew, blockedCreate, declaresBrandNew, isLiveForRefresh, liveRowsOnly } from './partner-import-rules'
import { PARTNER_STORES } from './partner-stores'

describe('isLiveForRefresh', () => {
  it('refreshes active and sold rows only', () => {
    expect(isLiveForRefresh('active')).toBe(true)
    expect(isLiveForRefresh('sold')).toBe(true)
    for (const s of ['hidden', 'stale', 'expired', 'removed', 'draft', '', null, undefined]) expect(isLiveForRefresh(s)).toBe(false)
  })
})

describe('liveRowsOnly', () => {
  it('selects exactly the statuses isLiveForRefresh accepts, as a fresh object each call', () => {
    const w = liveRowsOnly()
    expect(w).toEqual({ status: { in: ['active', 'sold'] } })
    for (const s of w.status.in) expect(isLiveForRefresh(s)).toBe(true)
    expect(liveRowsOnly()).not.toBe(w)
  })

  /**
   * ⛔ THE FIVE MAINTENANCE SCRIPTS SELECT LIVE ROWS ONLY (verify review, 2026-10-04). Each rewrites what it
   * selects through Prisma, which bumps `updatedAt`; a hidden row touched that way is one the 2026-10-03
   * hides' rollback refuses (its guard is `updatedAt` unchanged / before the hide). Read from source: the
   * scripts open the database at module scope.
   */
  it.each(['enrich-electronics', 'extract-specs', 'repair-bad-specs', 'backfill-brands', 'ai-describe-listings'])('scripts/%s.ts selects AND writes with liveRowsOnly()', (name) => {
    const src = readFileSync(new URL(`../../scripts/${name}.ts`, import.meta.url), 'utf8')
    const at = src.indexOf('db.listing.findMany({')
    expect(at, 'one listing selection').toBeGreaterThan(-1)
    expect(src.indexOf('db.listing.findMany({', at + 1), 'exactly one listing selection').toBe(-1)
    const where = src.slice(at, src.indexOf('select:', at))
    expect(where).toContain('...liveRowsOnly()')
    // …and every write re-checks it (commit-gate review: a row hidden between the selection and its write would
    // otherwise still be bumped). An id-only `update` cannot carry the condition, so none is left.
    expect(src).not.toMatch(/db\.listing\.update\(/)
    const writes = [...src.matchAll(/db\.listing\.updateMany\(\{\s*where: \{([^}]*)\}/g)].map((m) => m[1])
    expect(writes.length, 'at least one write').toBeGreaterThan(0)
    for (const w of writes) expect(w).toContain('...liveRowsOnly()')
  })
})

describe('blockedCreate', () => {
  it('a refresh-only shop gets no new listing; its existing rows, and every other shop, are untouched by it', () => {
    expect(blockedCreate({ refreshOnly: 'mixed stock' }, null)).toBe(true)
    expect(blockedCreate({ refreshOnly: 'mixed stock' }, { id: 'x' })).toBe(false)
    expect(blockedCreate({}, null)).toBe(false)
  })
})

describe('declaresBrandNew / blockedAsDeclaredNew — a "used" shop never creates stock its title calls brand-new', () => {
  it('matches the leading tag the 31 rows hidden on 2026-10-05 carried, in every spelling of it', () => {
    for (const t of [
      '[New 100%] Dell Latitude 5450 (Core Ultra 7 165U, 32GB, 512GB, 14 FHD, Win 11 Pro)',
      '[New100%] Dell Latitude 7450 (Core Ultra 7 165U, 16GB, 256GB, 14 inch FHD+)',
      '  [NEW 100 %] Dell XPS 13 9350',
      '(New 100%) Dell XPS 14 9440',
      '[Mới 100%] Laptop Dell XPS 13',
      '[Mới 100%] Laptop Dell XPS 13'.normalize('NFD'),
      '[New 100% Fullbox] Dell Latitude 7450',
      '[New 100% - Nguyên seal] Dell XPS 13 9350',
      'New 100% Dell Latitude 5450',
      '[Brand New] Dell XPS 14 9440',
      '[Nguyên Seal] Dell XPS 13 9345',
    ]) expect(declaresBrandNew(t), t).toBe(true)
  })
  it('passes the used grades and part-new wordings a bare "new 100%" would have swallowed (gate, 2026-10-05)', () => {
    for (const t of [
      '[Like New 99%] Dell Latitude 7440 (Core i7-1365U, 16GB, 512GB)',
      '[Like New 100%] Dell Latitude 7440',
      'Dell XPS 13 9310 New 99% fullbox',
      'Laptop Dell 7420 thay pin mới 100%',
      'Dell Latitude đẹp như mới 100%',
      'Laptop newest gen 2024, pin 100%',
      'Dell Latitude 5450 New 100% ngoại hình',
      'Laptop Dell còn nguyên seal hộp phụ kiện',
      '[Like New 99%] Dell XPS 13 nguyên seal pin',
    ]) expect(declaresBrandNew(t), t).toBe(false)
  })
  it('withholds only a CREATE, and only in a shop that claims used', () => {
    const t = '[New 100%] Dell Latitude 5450'
    expect(blockedAsDeclaredNew({ condition: 'used' }, null, t)).toBe(true)
    expect(blockedAsDeclaredNew({ condition: 'used' }, { id: 'x' }, t)).toBe(false)
    expect(blockedAsDeclaredNew({ condition: null }, null, t)).toBe(false)
    expect(blockedAsDeclaredNew({ condition: 'new' }, null, t)).toBe(false)
    expect(blockedAsDeclaredNew({ condition: 'used' }, null, '[Like New 99%] Dell Latitude 7440')).toBe(false)
  })
})

describe('the partner shop list — second-hand focus (2026-10-03)', () => {
  const by = new Map(PARTNER_STORES.map((s) => [s.domain, s]))
  it('retires the new-goods retailers and only them', () => {
    expect(PARTNER_STORES.filter((s) => s.retired).map((s) => s.domain).sort()).toEqual(
      ['daitailoc.com', 'dienmaycholon.com', 'fptshop.com.vn', 'hoanghamobile.com', 'hshop.vn', 'thegioididong.com'])
  })
  it('marks the two shops with new AND used stock refresh-only', () => {
    expect(PARTNER_STORES.filter((s) => s.refreshOnly).map((s) => s.domain).sort()).toEqual(['bachlongstore.vn', 'dienthoaigiakho.vn'])
    expect(by.get('bachlongstore.vn')!.retired).toBeUndefined()
  })
  it('no shop whose stock is all used is retired', () => {
    for (const s of PARTNER_STORES) if (s.condition === 'used') expect(s.retired, s.domain).toBeUndefined()
  })
})

/**
 * ⚠️ A SOURCE SCAN, because scripts/import-partners.ts imports the database at module scope. It pins the
 * three things the 2026-10-03 review found missing: a refresh that is conditional on a live status, a
 * condition that is not in the refresh set, and the refusal of a retired shop.
 */
describe('scripts/import-partners.ts — the refresh cannot undo the second-hand focus', () => {
  const src = readFileSync('scripts/import-partners.ts', 'utf8')
  it('refreshes an existing row with ONE status-conditional updateMany (fields + stock move), never an upsert', () => {
    expect(src).toMatch(/updateMany\(\{\s*where: \{ sellerId: seller!\.id, externalId, status: \{ in: \['active', 'sold'\] \} \},\s*data: \{ \.\.\.update, status: inStock \? 'active' : 'sold' \},/)
    // No second, unconditional-on-the-first stock write (commit-gate review: a failure between two writes
    // left fresh prices on stale availability).
    expect(src).not.toMatch(/status: \{ in: \['active', 'sold'\], not: want \}/)
  })
  it('creates with a plain create; a lost race falls back to the same conditional refresh, never an upsert', () => {
    expect(src).not.toMatch(/db\.listing\.upsert\(/)
    expect(src).toMatch(/db\.listing\.create\(\{ data: \{ \.\.\.fields, sellerId: seller!\.id, externalId \} \}\)/)
    expect(src).toMatch(/code !== 'P2002'/)
  })
  it('keeps `condition` out of the refresh set', () => {
    expect(src).toMatch(/condition: _c, \.\.\.refreshable \} = fields/)
  })
  it('refuses a retired shop and creates nothing for a refresh-only one', () => {
    expect(src).toMatch(/if \(store\.retired\)/)
    expect(src).toMatch(/if \(blockedCreate\(storeByDomain\.get\(r\.domain\)!, existing\)\) \{/)
    expect(src).not.toMatch(/createUsedOnly/)
  })
})
