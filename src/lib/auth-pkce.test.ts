// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearStalePkceCookies } from './auth-pkce'

/**
 * ⚠️ jsdom's document.cookie DOES honour an elapsed expiry, so a deletion is genuinely observable
 * here rather than merely "the string we wrote looks right". What jsdom does NOT model is the
 * PATH: it stores cookies for the whole document regardless, so the `path=/` half of the deletion —
 * the half that actually decides whether a real browser removes the cookie or silently creates a
 * second one beside it — is asserted on the written string instead. Both halves matter and they
 * need different assertions; that is why this file checks the write AND the effect.
 */
afterEach(() => {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
  vi.restoreAllMocks()
})

const REF = 'sb-xihiryllwmjoouipkyhw-auth-token'

function seedRealWorldCookies() {
  // Exactly the shape measured in a real browser after three abandoned Google sign-ins.
  document.cookie = `${REF}-flow-3b8ee57b9a6000f16d22d8288df0140f-code-verifier=base64-aaa; path=/`
  document.cookie = `${REF}-flow-cde94e035580e50df42d6d16fc8bc011-code-verifier=base64-bbb; path=/`
  document.cookie = `${REF}-flows-code-verifier=base64-ccc; path=/`
  document.cookie = `${REF}-code-verifier=base64-ddd; path=/`
  document.cookie = 'lang=en; path=/'
  document.cookie = `${REF}=session-value; path=/`
}

describe('clearStalePkceCookies', () => {
  it('removes every verifier cookie — per-flow, the index, and the legacy single key', () => {
    seedRealWorldCookies()
    expect(clearStalePkceCookies()).toBe(4)
    expect(document.cookie).not.toContain('code-verifier')
  })

  it('leaves the session cookie and unrelated cookies alone', () => {
    seedRealWorldCookies()
    clearStalePkceCookies()
    // ⚠️ THE IMPORTANT NEGATIVE. The session cookie's name is a PREFIX of every verifier cookie's
    // name, so a `startsWith`-shaped matcher would sign the visitor out as a side effect of
    // starting a sign-in. The regex anchors on the `-code-verifier` suffix for exactly this reason.
    expect(document.cookie).toContain('sb-xihiryllwmjoouipkyhw-auth-token=session-value')
    expect(document.cookie).toContain('lang=en')
  })

  it('writes the deletion on path=/ , which is where @supabase/ssr set them', () => {
    seedRealWorldCookies()
    const writes: string[] = []
    const proto = Object.getPrototypeOf(document) as object
    const original = Object.getOwnPropertyDescriptor(proto, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => original.get!.call(document),
      set: (v: string) => { writes.push(v); original.set!.call(document, v) },
    })
    clearStalePkceCookies()
    Reflect.deleteProperty(document, 'cookie')
    expect(writes.length).toBe(4)
    for (const w of writes) {
      expect(w).toContain('path=/')
      expect(w).toContain('max-age=0')
    }
  })

  it('is a no-op when there is nothing to clear', () => {
    document.cookie = 'lang=en; path=/'
    expect(clearStalePkceCookies()).toBe(0)
  })
})
