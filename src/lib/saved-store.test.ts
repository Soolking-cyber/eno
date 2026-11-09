// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_KEY, GUEST_KEY, readCopy, readGuest, sessionUidFromCookie, updateGuest, withSavedLock, writeCopy } from './saved-store'

// ── src/lib/saved-store.ts — the device's two saved lists and their one lock (saves across devices, 2026-11-09) ─────────

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`
const NOW = 1_800_000_000_000
const U = '11111111-1111-4111-8111-111111111111'
const session = (sub = U, exp = NOW / 1000 + 3600) => JSON.stringify({ access_token: jwt({ sub, exp }), refresh_token: 'r', user: { id: sub, user_metadata: { name: 'Ngân 🌸' } } })
const cookieOf = (value: string, name = 'sb-sb-auth-token') => `${name}=${encodeURIComponent(value)}`

describe('sessionUidFromCookie', () => {
  it('reads the sub of the access token in the @supabase/ssr cookie (base64-, base64url, UTF-8)', () => {
    expect(sessionUidFromCookie(`lang=vi; ${cookieOf('base64-' + b64url(session()))}; theme=dark`, NOW)).toBe(U)
  })
  it('joins a chunked cookie in order (.0, .1, … past 3,180 characters)', () => {
    const v = 'base64-' + b64url(session())
    const [a, b] = [v.slice(0, 40), v.slice(40)]
    expect(sessionUidFromCookie(`${cookieOf(b, 'sb-sb-auth-token.1')}; ${cookieOf(a, 'sb-sb-auth-token.0')}`, NOW)).toBe(U)
  })
  it('reads the older plain-JSON forms too', () => {
    expect(sessionUidFromCookie(cookieOf(session()), NOW)).toBe(U)
    expect(sessionUidFromCookie(cookieOf(JSON.stringify([jwt({ sub: U, exp: NOW / 1000 + 3600 }), 'r'])), NOW)).toBe(U)
  })
  it('⛔ null on any doubt: no cookie, a code-verifier only, two sessions, half-rewritten chunks, garbage', () => {
    expect(sessionUidFromCookie('', NOW)).toBeNull()
    expect(sessionUidFromCookie('sb-sb-auth-token-code-verifier=abc', NOW)).toBeNull()
    expect(sessionUidFromCookie(`${cookieOf('base64-' + b64url(session()))}; ${cookieOf('base64-' + b64url(session('2')), 'sb-other-auth-token')}`, NOW)).toBeNull()
    const v = 'base64-' + b64url(session())
    expect(sessionUidFromCookie(`${cookieOf(v)}; ${cookieOf(v.slice(0, 10), 'sb-sb-auth-token.0')}`, NOW)).toBeNull()
    expect(sessionUidFromCookie(cookieOf('base64-!!!'), NOW)).toBeNull()
    expect(sessionUidFromCookie(cookieOf(JSON.stringify({ access_token: 'not.a.jwt' })), NOW)).toBeNull()
  })
  it('⛔ a token expiring within a minute names no one for the first paint — unless any expiry is asked for', () => {
    const soon = cookieOf('base64-' + b64url(session(U, NOW / 1000 + 30)))
    expect(sessionUidFromCookie(soon, NOW)).toBeNull()
    expect(sessionUidFromCookie(soon, NOW, { anyExpiry: true })).toBe(U)
  })
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size }, key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null), setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) }, clear: () => { map.clear() },
  } as Storage
}

describe('the two lists', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('the guest list keeps today\'s key; read-modify-write reads storage, not a copy in memory', () => {
    expect(GUEST_KEY).toBe('eno:favorites')
    localStorage.setItem(GUEST_KEY, JSON.stringify(['a', 'b', 'a', 7, '']))
    expect(readGuest()).toEqual(['a', 'b'])
    localStorage.setItem(GUEST_KEY, JSON.stringify(['a', 'b', 'c'])) // another tab wrote meanwhile
    expect(updateGuest((g) => g.filter((x) => x !== 'a'))).toEqual(['b', 'c'])
    expect(JSON.parse(localStorage.getItem(GUEST_KEY)!)).toEqual(['b', 'c'])
  })
  it('the account copy is one account\'s cache, and null removes it', () => {
    expect(ACCOUNT_KEY).toBe('eno:favorites:acct')
    writeCopy({ u: 'U', ids: ['x', 'y'] })
    expect(readCopy()).toEqual({ u: 'U', ids: ['x', 'y'] })
    writeCopy(null)
    expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull()
    localStorage.setItem(ACCOUNT_KEY, '{"ids":["x"]}')
    expect(readCopy()).toBeNull()
  })
})

describe('withSavedLock', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('without Web Locks: one at a time, in order, and a failure does not stall the next', async () => {
    vi.stubGlobal('navigator', {})
    const log: string[] = []
    const slow = withSavedLock(async () => { log.push('a1'); await new Promise((r) => setTimeout(r, 20)); log.push('a2'); return 'a' })
    const bad = withSavedLock(async () => { log.push('b'); throw new Error('x') })
    const next = withSavedLock(() => { log.push('c'); return 'c' })
    expect(await slow).toBe('a')
    await expect(bad).rejects.toThrow('x')
    expect(await next).toBe('c')
    expect(log).toEqual(['a1', 'a2', 'b', 'c'])
  })
  it('with Web Locks: the browser-wide lock, by name', async () => {
    const request = vi.fn(async (_name: string, cb: () => unknown) => cb())
    vi.stubGlobal('navigator', { locks: { request } })
    expect(await withSavedLock(() => 5)).toBe(5)
    expect(request).toHaveBeenCalledWith('eno-saved-sync', expect.any(Function))
  })
})
