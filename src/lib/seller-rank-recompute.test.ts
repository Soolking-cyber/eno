import { describe, expect, it } from 'vitest'
import { browseRankScore, rankScoreExprSql } from './ranking-formula'
import { IMPORT_SELLERS } from './import-sellers'
import {
  RANK_SET_CLAUSE,
  parseRecomputeArgs,
  platformBaselineSql,
  recomputePreviewSql,
  recomputeUpdateSql,
} from './seller-rank-recompute'

describe('the post-import rank step', () => {
  it('writes the ONE shared formula — the same expression the nightly sweep and recomputeRankScoreForSeller use', () => {
    expect(RANK_SET_CLAUSE).toBe(`"rankScore" = ${rankScoreExprSql()}`)
    expect(recomputeUpdateSql(['nhatot-import-seller-0001']).sql).toContain(rankScoreExprSql())
  })

  it('touches rankScore only — never the publication gate, never updatedAt', () => {
    const { sql } = recomputeUpdateSql(['nhatot-import-seller-0001'])
    const set = sql.slice(sql.indexOf(' SET '), sql.indexOf(' WHERE '))
    expect(set).not.toMatch(/"status"|"verified"|"updatedAt"/)
    expect(sql).toMatch(/^UPDATE "Listing" SET "rankScore" = /)
  })

  it('is scoped to the named sellers’ ACTIVE rows, with the ids bound as parameters', () => {
    const q = recomputeUpdateSql(['nhatot-import-seller-0001', 'honeycomb-import-seller-0001'])
    expect(q.sql).toMatch(/WHERE "sellerId" IN \(\?,\?\) AND "status" = 'active'$/)
    expect(q.values).toEqual(['nhatot-import-seller-0001', 'honeycomb-import-seller-0001'])
  })

  it('refuses an unscoped update', () => {
    expect(() => recomputeUpdateSql([])).toThrow(/unscoped/)
    expect(() => recomputePreviewSql([])).toThrow(/unscoped/)
  })

  it('previews the same rows it would write, and compares them with every OTHER live listing', () => {
    const p = recomputePreviewSql(['muaban-net-import-seller-0001'])
    expect(p.sql).toContain(`WHERE "sellerId" IN (?) AND "status" = 'active'`)
    expect(p.sql).toMatch(/^SELECT /)
    const b = platformBaselineSql(['muaban-net-import-seller-0001'])
    expect(b.sql).toContain(`"verified" = true AND "status" = 'active' AND "sellerId" NOT IN (?)`)
  })

  /**
   * ⚠️ PINS THE LIMIT OF THIS STEP, so nobody reads it as the fix for "imports lead the browse". At
   * age 0 the formula gives an import row at trustScore 100 exactly 0.5786, and recomputing it gives
   * the same number: the lift over older rows is the recency term, which only time (or an honest
   * `postedAt`) moves.
   */
  it('re-derives the create-time score for a fresh import — it levels stale rows, it does not demote new ones', () => {
    const now = Date.now()
    const fresh = browseRankScore({ sellerTrustScore: 100, postedAt: new Date(now) }, now)
    expect(fresh).toBeCloseTo(0.5786, 4)
    const twoDaysOld = browseRankScore({ sellerTrustScore: 100, postedAt: new Date(now - 2 * 86_400_000) }, now)
    expect(twoDaysOld).toBeLessThan(fresh)
  })
})

describe('parseRecomputeArgs', () => {
  it('takes --seller (repeatable, comma lists, =form) and --apply', () => {
    expect(parseRecomputeArgs(['--seller', 'nhatot-import-seller-0001'])).toEqual({ sellers: ['nhatot-import-seller-0001'], apply: false })
    expect(parseRecomputeArgs(['--seller=nhatot-import-seller-0001,honeycomb-import-seller-0001', '--apply'])).toEqual({
      sellers: ['nhatot-import-seller-0001', 'honeycomb-import-seller-0001'],
      apply: true,
    })
    expect(parseRecomputeArgs(['--seller', 'nhatot-import-seller-0001', '--seller', 'nhatot-import-seller-0001']).sellers).toEqual(['nhatot-import-seller-0001'])
  })

  it('--all-imports means every id in src/lib/import-sellers.ts', () => {
    expect(parseRecomputeArgs(['--all-imports']).sellers).toEqual([...IMPORT_SELLERS])
  })

  it('refuses anything that is not a named import seller', () => {
    expect(() => parseRecomputeArgs([])).toThrow(/name the sellers/)
    expect(() => parseRecomputeArgs(['--apply'])).toThrow(/name the sellers/)
    expect(() => parseRecomputeArgs(['--seller'])).toThrow(/needs a seller id/)
    expect(() => parseRecomputeArgs(['--seller', '--apply'])).toThrow(/needs a seller id/)
    expect(() => parseRecomputeArgs(['--seller', 'cmrealshop0000'])).toThrow(/not an import seller/)
    expect(() => parseRecomputeArgs(['--sellers', 'nhatot-import-seller-0001'])).toThrow(/unknown argument/)
  })
})
