// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { facebookHeldBack, isFacebookLinked } from './facebook-signin'

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

// ⛔ Held back where it cannot finish today (2026-10-17): the teacher form's sign-in and Meta's own built-in browsers.
describe('facebookHeldBack', () => {
  const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  it('at the teacher form, whatever the browser', () => {
    setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')
    expect(facebookHeldBack('teacher')).toBe(true)
  })
  it('inside Facebook, Messenger or Instagram — but not on the /signin page in a real browser, where Meta\'s reviewer tests it', () => {
    setUa('Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]')
    expect(facebookHeldBack('page')).toBe(true)
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0.0 (iPhone14,5; iOS 18_0; vi_VN)')
    expect(facebookHeldBack(undefined)).toBe(true)
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')
    expect(facebookHeldBack('page')).toBe(false)
    expect(facebookHeldBack('nav')).toBe(false)
  })
})
