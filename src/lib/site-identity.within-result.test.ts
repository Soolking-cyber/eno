import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), SITE_NAME: 'eno.vn' }))
const { withinResult, withShare } = await import('./site-identity')

/** Seobility 2026-11-24: guide and tool titles over ~580 px and descriptions over ~1000 px, through withShare. */
describe('withinResult', () => {
  it('keeps " | <site>" while the title fits, drops it past that, then falls back to the title\'s head — never a word cut', () => {
    expect(withinResult('eSIM in Vietnam | eno.vn', 'd').title).toBe('eSIM in Vietnam | eno.vn')
    expect(withinResult('Buying a used iPhone in Vietnam — the ten-minute inspection | eno.vn', 'd').title).toBe('Buying a used iPhone in Vietnam — the ten-minute inspection')
    // Too wide even bare (570 px, serp-width.ts): the words before " — ", with the site while that fits.
    const long = 'Cheap 5G phones in Vietnam — coverage, bands and the specs that matter'
    expect(withinResult(long, 'd').title).toBe('Cheap 5G phones in Vietnam | eno.vn')
    // A head too short to say anything (under 200 px) is not offered: the bare title stands.
    const shortHead = 'Visa: everything a foreigner needs to know about entering, staying and leaving Vietnam'
    expect(withinResult(shortHead, 'd').title).toBe(shortHead)
  })
  it('names the domain once, at the end: "eno.vn" mid-title becomes the brand', () => {
    expect(withinResult(`How to post a listing on eno.vn, step by step | eno.vn`, 'd').title).toBe(`How to post a listing on eno, step by step | eno.vn`)
    expect(withinResult(`Does it cost anything to buy or sell on eno.vn?`, 'd').title).toBe('Does it cost anything to buy or sell on eno? | eno.vn')
  })
  it('keepDomain: a title that names the domain on purpose keeps it (the MCP page, 07 2026-11-24)', () => {
    const mcp = 'eno Agentic Commerce | The eno.vn MCP server for AI agents'
    expect(withinResult(mcp, 'd', { keepDomain: true }).title).toBe(mcp)
    expect(withinResult(mcp, 'd').title).toBe('eno Agentic Commerce | The eno MCP server for AI agents')
  })
  it('cuts a description past 155 at a word, and leaves a shorter one alone', () => {
    const d = 'word '.repeat(50).trim()
    const out = withinResult('t', d).description
    expect(out.length).toBeLessThanOrEqual(155)
    expect(out.endsWith('…')).toBe(true)
    expect(withinResult('t', 'A short description.').description).toBe('A short description.')
  })
  it('withShare carries the fitted pair into the page and its share card', () => {
    const m = withShare({ title: 'Buying a used iPhone in Vietnam — the ten-minute inspection | eno.vn', description: 'x '.repeat(100).trim() })
    expect(m.title).toBe('Buying a used iPhone in Vietnam — the ten-minute inspection')
    expect((m.description as string).length).toBeLessThanOrEqual(155)
    expect((m.openGraph as { title?: string }).title).toBe(m.title)
  })
})

describe('fitMeta (Seobility crawl 4, 2026-11-25: hand-written guide descriptions past 1,000 px)', () => {
  it('fits the page\'s description and leaves the rest, the share cards included, alone', async () => {
    const { fitMeta } = await import('./site-identity')
    const description = 'What a rental deposit in Vietnam covers, where the money sits while you live there, and what a landlord may keep from it at the end. How to get every đồng back when you leave.'
    const og = { title: 'Deposits', description }
    const m = fitMeta({ title: 'Rental deposits | eno.vn', description, openGraph: og })
    expect(m.description).toBe('What a rental deposit in Vietnam covers, where the money sits while you live there, and what a landlord may keep from it at the end.')
    expect(m.openGraph).toBe(og)
    expect(m.title).toBe('Rental deposits | eno.vn')
    expect(fitMeta({ title: 'x' })).toEqual({ title: 'x' })
  })
})

