import { describe, expect, it } from 'vitest'
import { isFacebookLinked } from './facebook-signin'

// An account carries a Facebook identity — its email is then Platform Data that never reaches another ad network.
describe('isFacebookLinked', () => {
  it('the first provider or any linked one, in any case', () => {
    expect(isFacebookLinked({ provider: 'facebook', providers: ['facebook'] })).toBe(true)
    expect(isFacebookLinked({ provider: 'email', providers: ['email', 'Facebook'] })).toBe(true)
    expect(isFacebookLinked({ provider: ' FACEBOOK ' })).toBe(true)
  })
  it('anything else is not', () => {
    expect(isFacebookLinked({ provider: 'google', providers: ['google', 'apple'] })).toBe(false)
    expect(isFacebookLinked({ provider: 'facebook_page' })).toBe(false)
    for (const v of [null, undefined, 'facebook', 42, {}, { providers: 'facebook' }]) expect(isFacebookLinked(v)).toBe(false)
  })
})
