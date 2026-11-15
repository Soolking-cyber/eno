import { describe, expect, it, vi } from 'vitest'

// set_listing_status's `status` is a plain string since 2026-11-15 (src/lib/mcp/tools.ts): the core is the check. It refuses
// anything but the three states, case and spaces included, before it touches the database (db is an empty mock here).
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/server', () => ({ after: () => {} }))
const { setStatusCore } = await import('./listings')

describe('setStatusCore refuses every status but active, sold and hidden', () => {
  for (const bad of ['expired', 'stale', 'removed', 'Active', ' sold', 'out_of_stock', '']) {
    it(`"${bad}" → invalid_status, nothing read or written`, async () => {
      expect(await setStatusCore('L1', bad)).toEqual({ ok: false, code: 400, error: 'invalid_status' })
    })
  }
})
