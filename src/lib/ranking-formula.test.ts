import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { browseRankScore, RANK, rankScoreExprSql } from './ranking-formula'

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
