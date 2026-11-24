import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), SITE_NAME: 'eno.vn' }))
const { withinResult, withShare } = await import('./site-identity')

/** Seobility 2026-11-24: guide and tool titles over ~580 px and descriptions over ~1000 px, through withShare. */
describe('withinResult', () => {
  it('keeps " | <site>" while the title fits 60, drops it past that, never cuts the writer\'s words', () => {
    expect(withinResult('eSIM in Vietnam | eno.vn', 'd').title).toBe('eSIM in Vietnam | eno.vn')
    expect(withinResult('Buying a used iPhone in Vietnam — the ten-minute inspection | eno.vn', 'd').title).toBe('Buying a used iPhone in Vietnam — the ten-minute inspection')
    const long = 'Cheap 5G phones in Vietnam — coverage, bands and the specs that matter'
    expect(withinResult(long, 'd').title).toBe(long)
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
