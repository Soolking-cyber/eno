import { describe, expect, it } from 'vitest'
import { percentile } from '../../../scripts/rum-report.mjs'

/** scripts/rum-report.mjs: percentiles from bucket counts, interpolated inside the bucket that holds them. */
describe('rum-report percentile', () => {
  it('interpolates linearly between a bucket\'s lower edge and the next edge', () => {
    // ms scale: …, 1000, 1200, … — 4 views in [1000,1200): p50 is half-way through that bucket.
    expect(percentile('ms', new Map([[1000, 4]]), 0.5)).toEqual({ open: false, v: 1100 })
    // 2 views at [0,100) and 2 at [100,200): p75 = 100 + (3-2)/2 × 100.
    expect(percentile('ms', new Map([[0, 2], [100, 2]]), 0.75)).toEqual({ open: false, v: 150 })
  })
  it('the last bucket is open-ended, and an empty histogram has no percentile', () => {
    expect(percentile('ms', new Map([[30000, 3]]), 0.9)).toEqual({ open: true, v: 30000 })
    expect(percentile('ms', new Map(), 0.5)).toBeNull()
  })
})
