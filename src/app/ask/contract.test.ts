import { describe, expect, it, vi } from 'vitest'

/**
 * The REAL search tool's contract, as /ask uses it (commit gate, opus: the route tests mock the tool, so they cannot see a
 * change to its name, input bounds or row fields). Only the database and the feed are stubbed; the tool definition is real.
 */
vi.mock('@/lib/db', () => ({ db: {} }))

describe('/ask ↔ search_listings contract', () => {
  it('the tool exists, accepts exactly the arguments /ask sends, and returns rows with every field toItem reads', async () => {
    const { SEARCH_TOOLS_BY_NAME } = await import('@/app/api/mcp/search/tools')
    const tool = SEARCH_TOOLS_BY_NAME.get('search_listings')
    expect(tool).toBeDefined()
    for (const lang of ['en', 'vi'] as const) {
      expect(tool!.input.safeParse({ q: 'a'.repeat(120), lang, limit: 10 }).success).toBe(true)
    }
    // The listing_type vocabulary toItem branches on (commit gate, opus): 'wanted', 'job' and 'rent' are the tool's own words.
    for (const type of ['sell', 'rent', 'job', 'wanted']) expect(tool!.input.safeParse({ type }).success, type).toBe(true)
    expect(tool!.input.safeParse({ type: 'buy' }).success).toBe(false)
    const json = JSON.stringify((await import('zod')).z.toJSONSchema(tool!.output))
    for (const field of ['title', 'price', 'price_unit', 'listing_type', 'condition', 'location', 'district', 'city', 'category', 'image', 'posted_at', 'sponsored', 'url']) {
      // A typed property, or named in the row's own description (the schema is loose: tools.ts LISTING_ROW lists every field).
      expect(json, field).toMatch(new RegExp(`"${field}"|[ ,:]${field}[,"]`))
    }
  }, 30_000)
})
