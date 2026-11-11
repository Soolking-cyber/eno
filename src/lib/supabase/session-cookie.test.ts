import { createBrowserClient } from '@supabase/ssr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authCookieOptions } from './cookie-options'
import { sessionCookieName } from './session-cookie'

/**
 * THE HEAD SCRIPT'S rail-hint NAMES ONE COOKIE: the one this build's browser client reads its session from. Checked here
 * against the real library, built with the options browser.ts passes (@supabase/ssr createBrowserClient with
 * authCookieOptions), so a name added to authCookieOptions, or a change of supabase-js's own rule, fails this file; an
 * override written into browser.ts itself is caught by the source check at the end, which pins that call's options.
 * (`cookies` is a stub only because this runs in Node, where there is no document.cookie; it plays no part in the name.)
 */
const KEY = 'sb_publishable_session_cookie_test_key'
const clientKey = (url: string) => {
  const client = createBrowserClient(url, KEY, {
    isSingleton: false,
    cookieOptions: authCookieOptions({ proto: 'https:' }),
    cookies: { getAll: () => [], setAll: () => {} },
  })
  return (client as unknown as { storageKey: string }).storageKey
}

describe('sessionCookieName — supabase-js storage key for NEXT_PUBLIC_SUPABASE_URL', () => {
  it.each([
    'https://sb.eno.vn',
    'https://sb.eno.vn/',
    '  https://sb.eno.vn  ',
    'HTTPS://SB.ENO.VN',
    'http://127.0.0.1:54321',
    'https://xihiryllwmjoouipkyhw.supabase.co',
    'https://abc-def.example.com/some/path',
  ])('%j → the same name the browser client uses', (url) => {
    expect(sessionCookieName(url)).toBe(clientKey(url))
  })

  it('production and the local fixture build', () => {
    expect(sessionCookieName('https://sb.eno.vn')).toBe('sb-sb-auth-token')
    expect(sessionCookieName('http://127.0.0.1:54321')).toBe('sb-127-auth-token')
  })

  it('unset or invalid → null (no hint at all)', () => {
    for (const url of [undefined, null, '', '   ', 'sb.eno.vn', 'ftp://sb.eno.vn', 'https://', 'https://[::1]:54321']) {
      expect(sessionCookieName(url)).toBeNull()
    }
  })

  it('browser.ts still passes no storage key and no cookie name (else session-cookie.ts must follow it)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/supabase/browser.ts'), 'utf8')
    expect(src).toContain('{ cookieOptions: authCookieOptions({ proto: globalThis.location?.protocol }) },')
    expect(src).not.toMatch(/storageKey|\bname\s*:/)
  })
})
