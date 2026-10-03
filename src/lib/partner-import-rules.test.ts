import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockedCreate, isLiveForRefresh } from './partner-import-rules'
import { PARTNER_STORES } from './partner-stores'

describe('isLiveForRefresh', () => {
  it('refreshes active and sold rows only', () => {
    expect(isLiveForRefresh('active')).toBe(true)
    expect(isLiveForRefresh('sold')).toBe(true)
    for (const s of ['hidden', 'stale', 'expired', 'removed', 'draft', '', null, undefined]) expect(isLiveForRefresh(s)).toBe(false)
  })
})

describe('blockedCreate', () => {
  it('a refresh-only shop gets no new listing; its existing rows, and every other shop, are untouched by it', () => {
    expect(blockedCreate({ refreshOnly: 'mixed stock' }, null)).toBe(true)
    expect(blockedCreate({ refreshOnly: 'mixed stock' }, { id: 'x' })).toBe(false)
    expect(blockedCreate({}, null)).toBe(false)
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
