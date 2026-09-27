import { describe, expect, it } from 'vitest'
import { SOCIALS, formatFollowers } from './socials'

describe('formatFollowers', () => {
  it('formats each magnitude the way the footer badge reads', () => {
    expect(formatFollowers(0)).toBe('0')
    expect(formatFollowers(999)).toBe('999')
    expect(formatFollowers(1_000)).toBe('1K')
    expect(formatFollowers(1_200)).toBe('1.2K')
    expect(formatFollowers(12_300)).toBe('12K')
    expect(formatFollowers(1_240_000)).toBe('1.2M')
  })

  // ⚠️ THE BOUNDARIES ARE THE ROUNDED VALUE. Both of these printed the wrong unit before a reviewer
  // pointed at 999_600 → "1000K"; 9_950 is the same bug one magnitude down (9.95K → "10.0K").
  it('crosses each unit on the value it rounds to, not the raw number', () => {
    expect(formatFollowers(9_949)).toBe('9.9K')
    expect(formatFollowers(9_950)).toBe('10K')
    expect(formatFollowers(999_499)).toBe('999K')
    expect(formatFollowers(999_600)).toBe('1M')
    expect(formatFollowers(1_000_000)).toBe('1M')
  })
})

describe('SOCIALS', () => {
  it('links only https profiles, with no duplicate channel', () => {
    for (const s of SOCIALS) expect(s.href).toMatch(/^https:\/\//)
    expect(new Set(SOCIALS.map((s) => s.key)).size).toBe(SOCIALS.length)
  })

  // rel="me" is an identity claim: the community group is a place our members post, not eno itself.
  it('claims identity for profiles and not for the group', () => {
    expect(SOCIALS.find((s) => s.key === 'facebook-group')?.me).toBeUndefined()
    expect(SOCIALS.filter((s) => s.me).length).toBe(SOCIALS.length - 1)
  })

  // Owner pasted it with `?viewAsMember=true` (the admin's view toggle). A query string on an identity
  // URL would make sameAs consumers see a different address from the page's own canonical.
  it('links the LinkedIn company page by its canonical URL, as an owned profile', () => {
    const li = SOCIALS.find((s) => s.key === 'linkedin')
    expect(li?.href).toBe('https://www.linkedin.com/company/eno-vn/')
    expect(li?.me).toBe(true)
    for (const s of SOCIALS) expect(s.href).not.toContain('?viewAsMember')
  })
})
