import { describe, expect, it } from 'vitest'
import { adEmailWithheld } from '@/lib/ad-email'

describe('adEmailWithheld — D14 widened to LinkedIn (2026-10-15)', () => {
  it.each([
    [{ provider: 'apple', providers: ['apple'] }, true],
    [{ provider: 'linkedin_oidc', providers: ['linkedin_oidc'] }, true],
    [{ provider: 'google', providers: ['google', 'LinkedIn_OIDC'] }, true],
    [{ provider: 'Apple' }, true],
    [{ provider: 'google', providers: ['google'] }, false],
    [{ provider: 'email', providers: ['email'] }, false],
    [null, false],
  ])('%j → %s', (meta, withheld) => {
    expect(adEmailWithheld(meta)).toBe(withheld)
  })
})
