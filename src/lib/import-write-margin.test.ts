import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Where `needle` is in `hay` — asserted present first, so an ordering check can never pass on a missing anchor (−1). */
const at = (hay: string, needle: string): number => {
  const i = hay.indexOf(needle)
  expect(i, `anchor not found: ${needle}`).toBeGreaterThan(-1)
  return i
}

/**
 * ⛔ A DAY TO LIVE, AT THE WRITE (tooLateToWrite, src/lib/apartment-freshness.ts — review of 2026-10-13): the importers
 * that create rows by the thousand skip a create (before any photo is fetched) and a revival whose row would have under
 * a day of its 7 left at the moment of the write. The rule is unit-tested in apartment-freshness.test.ts and the
 * revival plans in nhatot-fresh.test.ts / muaban-net-fresh.test.ts; WHERE the scripts call it is pinned here at the
 * source level, as their main() opens the network and a database (Nhà Tốt's wiring: nhatot-fresh.test.ts).
 */
describe('scripts/import-muaban-net.ts — the margin at the write', () => {
  const src = readFileSync('scripts/import-muaban-net.ts', 'utf8')
  const apply = src.slice(at(src, '// ─── APPLY'))
  it('a create too late at its write is skipped BEFORE any photo is fetched or uploaded', () => {
    const late = at(apply, 'if (tooLateToWrite(r.postedAt, Date.now())) { stat.tooLateCreate++; continue }')
    expect(late).toBeLessThan(at(apply, 'const j = await judgePhoto(u)'))
    expect(late).toBeLessThan(at(apply, 'await host.fromBuffer('))
    expect(late).toBeLessThan(at(apply, 'await db.listing.create('))
    // …and after the existing-row branch, which never reaches it (a row that exists is refreshed, never re-created)
    expect(late).toBeGreaterThan(at(apply, 'if (ex) {'))
  })
  it('a revival is planned at the WRITE\'s clock, and the dry run reports what this clock would skip', () => {
    expect(apply).toMatch(/const d = ex \? existingRowPlan\(r, ex, Date\.now\(\)\) : null/)
    expect(src).toMatch(/const d = existingRowPlan\(r, ex, planAt\)/)
    expect(src).toMatch(/else if \(!ex\) \{ if \(tooLateToWrite\(r\.postedAt, planAt\)\) plan\.lateCreate\+\+; else plan\.create\+\+ \}/)
  })
})

describe('scripts/import-batdongsan-rentals.ts — the margin at the write', () => {
  const src = readFileSync('scripts/import-batdongsan-rentals.ts', 'utf8')
  it('only on the 7-day rule\'s runs: a dated import at --max-age-days ≤ FRESH_DAYS (a wider backfill keeps its window)', () => {
    expect(src).toMatch(/const writeMargin = MAX_AGE_DAYS !== null && MAX_AGE_DAYS <= FRESH_DAYS/)
  })
  const write = src.slice(at(src, 'let created = 0, updated = 0, skippedRemoved = 0, tooLateCreate = 0'))
  it('a NEW row too late at its write is not upserted (so never given a photo); an existing one is still refreshed', () => {
    const late = at(write, 'if (writeMargin && !before && newDate && tooLateToWrite(newDate, Date.now())) { tooLateCreate++; continue }')
    expect(late).toBeLessThan(at(write, 'await db.listing.upsert('))
    expect(late).toBeGreaterThan(at(write, "if (before?.status === 'removed')"))
  })
  it('a revival too late is planned out at this clock, and judged once more right before the revival pass', () => {
    expect(src).toMatch(/if \(writeMargin && revive && tooLateToWrite\(d, NOW\)\) \{ lateRevive\+\+; continue \}/)
    const recheck = at(write, 'const todo = planned.filter((ch) => !leftAlone.has(ch.externalId) && !lateNow(ch))')
    expect(recheck).toBeGreaterThan(at(write, 'const lateNow = (ch: BdsDatedChange) => writeMargin && ch.action === \'revive\' && tooLateToWrite(ch.newPostedAt, reviveAt)'))
    expect(recheck).toBeLessThan(at(write, 'outcome = await applyBdsDatedChanges(todo,'))
  })
})
