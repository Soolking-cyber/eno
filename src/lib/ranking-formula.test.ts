import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { browseRankScore, RANK, rankScoreExprSql, searchScore } from './ranking-formula'
import { TRUST } from './trust-math'

describe('rankScore single source', () => {
  // 30s timeout: the recursive grep scans the whole tree and can exceed the 5s
  // default under concurrent-build disk load (observed 11.5s while a docker build ran).
  it('the SQL trust clamp appears NOWHERE outside ranking-formula.ts (drift guard)', { timeout: 30_000 }, () => {
    // The formula's structural fingerprint. Any new hand-mirrored SQL copy fails this.
    const hits = execSync(
      `grep -rl 'LEAST(GREATEST(("sellerTrustScore"' src apps prisma scripts --include='*.ts' --include='*.tsx' --include='*.mjs' || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).filter((f) => !f.endsWith('.test.ts'))
    expect(hits).toEqual(['src/lib/ranking-formula.ts'])
  })

  it('every RANK constant is embedded in the SQL expression', () => {
    const sql = rankScoreExprSql()
    for (const key of ['BROWSE_TRUST_W', 'BROWSE_RELEVANCE_W', 'BROWSE_RECENCY_W', 'TRUST_FLOOR', 'TRUST_SPAN', 'DEMAND_CONTACT_W', 'DEMAND_REF', 'DECAY_DAYS', 'FEATURED_BOOST'] as const) {
      expect(sql, `SQL must embed RANK.${key}`).toContain(String(RANK[key]))
    }
  })

  it('JS browseRankScore at age 0 matches the SQL structure boundary values', () => {
    // age 0, no demand, not featured → trust-weight × trustComponent + recency-weight × 1.
    const now = Date.now()
    const v = browseRankScore({ sellerTrustScore: RANK.TRUST_FLOOR + RANK.TRUST_SPAN, postedAt: new Date(now), featured: false }, now)
    expect(v).toBeCloseTo(RANK.BROWSE_TRUST_W + RANK.BROWSE_RECENCY_W, 10)
  })
})

/**
 * ⚖️ WHAT A LIVE VERIFIED IDENTITY IS WORTH IN THE ORDER (owner, 2026-10-15): +V_KYC trust points, a flat step — the same
 * ~0.086 of browse rank and ~0.057 of search score wherever the seller sits in the trust span. No sort, pin, filter or
 * tie-break reads the identity itself: it reaches the order only through sellerTrustScore, like every other trust input.
 */
describe('a live verified identity in the rank (+V_KYC trust points)', () => {
  it.each([50, 60, 85, 110])('from trust %i: +0.0857 browse, +0.0571 search', (t) => {
    const now = Date.now()
    const at = (score: number) => ({ sellerTrustScore: score, postedAt: new Date(now) })
    expect(browseRankScore(at(t + TRUST.V_KYC), now) - browseRankScore(at(t), now)).toBeCloseTo(RANK.BROWSE_TRUST_W * TRUST.V_KYC / RANK.TRUST_SPAN, 10)
    expect(browseRankScore(at(t + TRUST.V_KYC), now) - browseRankScore(at(t), now)).toBeCloseTo(0.0857, 4)
    expect(searchScore({ ...at(t + TRUST.V_KYC), relevance: 0.5 }, now) - searchScore({ ...at(t), relevance: 0.5 }, now)).toBeCloseTo(0.0571, 4)
  })
})
