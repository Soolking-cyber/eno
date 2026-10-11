import { describe, expect, it } from 'vitest'
import { authFailurePath, nextPathname, withoutAuthError } from './auth-landing'

describe('authFailurePath — a failed sign-in lands back on a page that keeps its place (owner, 2026-10-11)', () => {
  it('the teacher form gets its failure back, its query kept', () => {
    expect(authFailurePath('/teachers/join', 'oauth')).toBe('/teachers/join?auth_error=oauth')
    expect(authFailurePath('/teachers/join?goal=cover', 'exchange')).toBe('/teachers/join?goal=cover&auth_error=exchange')
  })
  it('every other page still lands on home with the code (the global toast reads it there)', () => {
    expect(authFailurePath('/', 'oauth')).toBe('/?auth_error=oauth')
    expect(authFailurePath('/listings/x', '1')).toBe('/?auth_error=1')
    expect(authFailurePath('/teachers/edit', 'signup_disabled')).toBe('/?auth_error=signup_disabled')
  })
  it('nextPathname drops the query and the hash', () => {
    expect(nextPathname('/teachers/join?goal=cover#d=x')).toBe('/teachers/join')
  })
  it('a failure keeps the hash; a retry\'s failure replaces the old code instead of stacking it', () => {
    expect(authFailurePath('/teachers/join?goal=cover#d=x', 'oauth')).toBe('/teachers/join?goal=cover&auth_error=oauth#d=x')
    expect(authFailurePath('/teachers/join?auth_error=oauth', 'exchange')).toBe('/teachers/join?auth_error=exchange')
  })
})

describe('the path is handed back as written, never re-resolved (commit gate, 2026-10-11)', () => {
  it('a dot-segment path never becomes protocol-relative', () => {
    // as written it is a path on THIS origin (a browser resolves it to eno.vn//evil.com); never the bare "//evil.com"
    expect(withoutAuthError('/a/..//evil.com?auth_error=1')).toBe('/a/..//evil.com')
    expect(new URL(withoutAuthError('/a/..//evil.com?auth_error=1'), 'https://eno.vn').origin).toBe('https://eno.vn')
    expect(withoutAuthError('//evil.com?auth_error=1')).toBe('/')
    expect(withoutAuthError('/x/../teachers/join?auth_error=1')).toBe('/x/../teachers/join')
    expect(authFailurePath('/x/../teachers/join', 'oauth')).toBe('/x/../teachers/join?auth_error=oauth')
  })
})

describe('withoutAuthError — a successful landing never toasts an earlier failure', () => {
  it('drops only auth_error, keeping the rest of next', () => {
    expect(withoutAuthError('/teachers/join?goal=cover&auth_error=oauth#d=x')).toBe('/teachers/join?goal=cover#d=x')
    expect(withoutAuthError('/teachers/join?auth_error=1')).toBe('/teachers/join')
    expect(withoutAuthError('/listings/x?ref=home')).toBe('/listings/x?ref=home')
  })
})
