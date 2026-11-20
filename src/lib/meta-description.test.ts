import { describe, expect, it } from 'vitest'
import { clip, fillDescription, titleWithSite } from './meta-description'

describe('fillDescription (Bing 2026-11-20: descriptions too short)', () => {
  it('adds the facts in order, only until the text is long enough', () => {
    const d = fillDescription('iPhone 17 Pro Max 512GB - Used, with scratches and dents.', [
      '35,000,000 đ, Electronics, District 7.',
      'Free classifieds for expats and locals in Vietnam on eno.vn.',
      'never reached',
    ])
    expect(d).toBe('iPhone 17 Pro Max 512GB - Used, with scratches and dents. 35,000,000 đ, Electronics, District 7. Free classifieds for expats and locals in Vietnam on eno.vn.')
    expect(d.length).toBeLessThanOrEqual(160)
  })
  it('leaves a long enough lead alone and skips empty extras', () => {
    const lead = 'x'.repeat(130)
    expect(fillDescription(lead, ['more'])).toBe(lead)
    expect(fillDescription('Short', ['', null, undefined, false, 'Fact'])).toBe('Short. Fact')
  })
  it('skips an extra that would pass 160 whole, and tries the next', () => {
    expect(fillDescription('A lead', ['word '.repeat(60).trim(), 'Short fact.'])).toBe('A lead. Short fact.')
  })
  it('cuts only a lead that is itself too long, at a word', () => {
    const d = fillDescription('word '.repeat(60).trim(), ['never'])
    expect(d.length).toBeLessThanOrEqual(160)
    expect(d.endsWith('word…')).toBe(true)
  })
})

describe('clip', () => {
  it('keeps short text as it is and closes a cut with an ellipsis, no dangling separator', () => {
    expect(clip('short')).toBe('short')
    expect(clip(`${'a'.repeat(100)} · ${'b'.repeat(80)}`, 110)).toBe(`${'a'.repeat(100)}…`)
  })
})

describe('titleWithSite (Bing 2026-11-20: title too long)', () => {
  it('keeps the site name while the whole fits in 70 characters', () => {
    expect(titleWithSite('eSIM in Vietnam', 'eno.vn')).toBe('eSIM in Vietnam | eno.vn')
  })
  it('drops it when it would not fit, and cuts a title that is itself too long', () => {
    const t = 'Cheap 5G phones in Vietnam — coverage, bands and the specs that matter'
    expect(titleWithSite(t, 'eno.vn')).toBe(t)
    expect(titleWithSite('word '.repeat(20).trim(), 'eno.vn').length).toBeLessThanOrEqual(70)
  })
})
