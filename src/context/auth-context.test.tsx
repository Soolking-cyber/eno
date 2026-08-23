// @vitest-environment jsdom
/**
 * ⛔ THE ANONYMOUS-VISITOR GATE, PINNED IN BOTH DIRECTIONS.
 *
 * The change under test stops `AuthProvider` from importing `@/lib/supabase/browser` on the idle
 * timer for a visitor who has no session. Measured on production 2026-08-23 (headless chromium,
 * mobile emulation, 4x CPU throttle): that import cost **66,265 B transferred, 54,766 B (83%)
 * counted as unused** by PSI's "Reduce unused JavaScript" audit — 51% of the whole 105 KiB audit —
 * and it happened on every visit at t=0.85–1.12s.
 *
 * ⚠️ THE FAILURE MODE OF THAT SAVING IS SIGNING A REAL USER OUT, so the tests below are weighted
 * almost entirely toward the *positive* direction: one anonymous shape must skip the import, and
 * every shape a genuinely-signed-in or mid-sign-in browser can present must still take it. The
 * cookie shapes are not invented — they are the keys @supabase/ssr 0.12.4 and @supabase/auth-js
 * actually write through `document.cookie`:
 *   · `sb-<ref>-auth-token`                          the session (supabase-js `defaultStorageKey`)
 *   · `sb-<ref>-auth-token.0` / `.1` / …             chunker.js, once the session exceeds 3180 B
 *   · `sb-<ref>-auth-token-code-verifier`            auth-js helpers.js:340, legacy single slot
 *   · `sb-<ref>-auth-token-flows-code-verifier`      helpers.js:305, the pending-flow index
 *   · `sb-<ref>-auth-token-flow-<id>-code-verifier`  helpers.js:303, one per in-flight PKCE flow
 * The last three are the PKCE-mid-flight case: a browser that is *becoming* signed in holds them
 * and NO session cookie, which is exactly what a regex anchored on `-auth-token=` would miss.
 */
import React from 'react'
import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, shouldBootAuth, useAuth, type AuthBootProbe } from './auth-context'

/** The live project ref, so the shapes below are byte-identical to production cookie names. */
const KEY = 'sb-xihiryllwmjoouipkyhw-auth-token'

const createSupabaseBrowser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('@/lib/analytics', () => ({ trackSignUp: vi.fn() }))

function fakeClient() {
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }
}

/** jsdom keeps cookies for the whole file, so each test starts from a clean jar. */
function resetCookies(): void {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
}

function Probe() {
  const { user, loading, openSignIn } = useAuth()
  return (
    <button type="button" onClick={() => openSignIn()}>
      {loading ? 'loading' : user ? 'in' : 'out'}
    </button>
  )
}

/** Render the provider and run past the 1500ms fallback trigger (jsdom has no requestIdleCallback,
 *  so the provider takes the setTimeout branch — the same branch Safari takes). */
async function mountAndIdle(): Promise<void> {
  render(<AuthProvider><Probe /></AuthProvider>)
  await act(async () => { vi.advanceTimersByTime(5000) })
}

beforeEach(() => {
  vi.useFakeTimers()
  createSupabaseBrowser.mockReset()
  createSupabaseBrowser.mockImplementation(fakeClient)
  resetCookies()
})

afterEach(() => {
  // ⚠️ EXPLICIT — this suite runs without vitest `globals`, so Testing Library's automatic
  // cleanup never registers and every render would stack in the same document.body.
  cleanup()
  vi.useRealTimers()
})

describe('AuthProvider — anonymous visitors never boot supabase-js', () => {
  it('does NOT import the client for a jar holding only the app\'s own guest cookies', async () => {
    // What an anonymous production load actually leaves behind: the language cookie
    // (language-context.tsx:42), the consent level (lib/consent.ts:47) and, for an ad click, the
    // first-touch attribution cookie (lib/attribution.ts:114). None of them start with `sb-`.
    document.cookie = 'lang=en; path=/'
    document.cookie = 'eno-consent=all; path=/'
    document.cookie = 'eno_attr=meta.cpc; path=/'
    await mountAndIdle()
    expect(createSupabaseBrowser).not.toHaveBeenCalled()
    // ⚠️ AND IT RESOLVES, rather than sitting on `loading` forever. A gate that skipped the boot
    // without settling the state would hang every `loading`-gated consumer in the app.
    expect(screen.getByRole('button').textContent).toBe('out')
  })

  it('still boots on the first interaction — the backstop that makes the gate safe', async () => {
    document.cookie = 'lang=en; path=/'
    await mountAndIdle()
    expect(createSupabaseBrowser).not.toHaveBeenCalled()
    await act(async () => { window.dispatchEvent(new Event('pointerdown')) })
    expect(createSupabaseBrowser).toHaveBeenCalledTimes(1)
  })

  it('boots when the sign-in dialog is opened, so onAuthStateChange exists before the OTP lands', async () => {
    document.cookie = 'lang=en; path=/'
    await mountAndIdle()
    expect(createSupabaseBrowser).not.toHaveBeenCalled()
    // openSignIn() — the same call every gated action in the app makes.
    await act(async () => { screen.getByRole('button').click() })
    expect(createSupabaseBrowser).toHaveBeenCalledTimes(1)
  })

  it('boots when a feature dispatches eno:require-signin (visual-search fires it off a 401)', async () => {
    document.cookie = 'lang=en; path=/'
    await mountAndIdle()
    expect(createSupabaseBrowser).not.toHaveBeenCalled()
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:require-signin')) })
    expect(createSupabaseBrowser).toHaveBeenCalledTimes(1)
  })
})

describe('AuthProvider — every signed-in / mid-sign-in cookie shape still boots', () => {
  const shapes: Array<[string, string]> = [
    ['the session cookie', `${KEY}=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0`],
    ['a chunked session (chunker.js writes `${key}.${i}`)', `${KEY}.0=base64-aaa; ${KEY}.1=bbb`],
    ['a session under a DIFFERENT project ref', 'sb-someotherprojectref-auth-token=base64-aaa'],
    ['PKCE mid-flight: legacy verifier only, no session', `${KEY}-code-verifier=base64-ddd`],
    ['PKCE mid-flight: a per-flow verifier slot', `${KEY}-flow-3b8ee57b9a6000f16d22d8288df0140f-code-verifier=base64-aaa`],
    ['PKCE mid-flight: the pending-flow index', `${KEY}-flows-code-verifier=base64-ccc`],
    ['a legacy auth-helpers pair', 'sb-access-token=aaa; sb-refresh-token=bbb'],
    ['the session cookie behind other cookies', `lang=en; eno-consent=all; ${KEY}=base64-aaa`],
  ]

  for (const [name, jar] of shapes) {
    it(`boots for ${name}`, async () => {
      for (const c of jar.split(';')) document.cookie = `${c.trim()}; path=/`
      await mountAndIdle()
      expect(createSupabaseBrowser).toHaveBeenCalledTimes(1)
    })
  }
})

/**
 * The predicate on its own, where the signals that are not cookies (URL, route, native) can be
 * driven directly — jsdom cannot be navigated to `/auth/escape` or handed a Capacitor bridge.
 */
describe('shouldBootAuth', () => {
  const anon: AuthBootProbe = {
    cookie: 'lang=en; eno-consent=all',
    hash: '',
    search: '',
    pathname: '/',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15',
    capacitorNative: false,
  }
  const probe = (over: Partial<AuthBootProbe>): AuthBootProbe => ({ ...anon, ...over })

  it('is false for a plain anonymous visitor on a plain page', () => {
    expect(shouldBootAuth(anon)).toBe(false)
  })

  it('is false when the jar is completely empty', () => {
    expect(shouldBootAuth(probe({ cookie: '' }))).toBe(false)
  })

  it.each([
    ['session', `${KEY}=base64-aaa`],
    ['chunk 0', `${KEY}.0=base64-aaa`],
    ['chunk 10 (two digits)', `${KEY}.10=base64-aaa`],
    ['legacy code verifier', `${KEY}-code-verifier=base64-ddd`],
    ['flow verifier slot', `${KEY}-flow-cde94e035580e50df42d6d16fc8bc011-code-verifier=base64-bbb`],
    ['flows index', `${KEY}-flows-code-verifier=base64-ccc`],
    ['other project ref', 'sb-otherref-auth-token=base64-aaa'],
    ['legacy sb-access-token', 'sb-access-token=aaa'],
    ['not first in the jar', `lang=en; ${KEY}=base64-aaa`],
    ['first in the jar', `${KEY}=base64-aaa; lang=en`],
  ])('is true for a %s cookie', (_label, cookie) => {
    expect(shouldBootAuth(probe({ cookie }))).toBe(true)
  })

  /**
   * ⚠️ THE ANCHOR IS LOAD-BEARING. Without `(?:^|;\s*)` any cookie whose VALUE happened to contain
   * `sb-` would boot the client for every anonymous visitor and silently undo the whole saving —
   * a failure nothing would ever alert on, because the app would still work perfectly.
   */
  it.each([
    ['a value containing sb-', 'ref=partner-sb-auth-token'],
    ['a name merely ending in sb-something', 'websb-auth-token=1'],
    ['a name containing sb- mid-string', 'x_sb-auth-token=1'],
  ])('is false for %s', (_label, cookie) => {
    expect(shouldBootAuth(probe({ cookie }))).toBe(false)
  })

  it.each([
    ['implicit-flow fragment', { hash: '#access_token=abc&refresh_token=def&expires_in=3600' }],
    ['a refresh token alone in the fragment', { hash: '#refresh_token=def' }],
    ['a provider error in the fragment', { hash: '#error=access_denied&error_description=nope' }],
    ['a PKCE code in the query', { search: '?code=8bd0d3b7-1c9e' }],
    ['a magic-link token_hash', { search: '?token_hash=pkce_abc&type=magiclink' }],
    ['the /signin page', { pathname: '/signin' }],
    ['the browser-escape handoff page', { pathname: '/auth/escape' }],
    ['the OAuth callback', { pathname: '/auth/callback' }],
    ['the Capacitor WebView', { capacitorNative: true }],
    ['the iOS embedded tabs WebView', { userAgent: 'Mozilla/5.0 (iPhone) EnoNativeTabs' }],
    ['the Capacitor UA marker', { userAgent: 'Mozilla/5.0 (iPhone) EnoNativeApp/1' }],
  ])('is true on %s even with an empty cookie jar', (_label, over) => {
    expect(shouldBootAuth(probe({ cookie: '', ...over }))).toBe(true)
  })

  /** ⚠️ Route matching must not widen to look-alikes; those pages mount no auth surface. */
  it.each(['/signin-help', '/authors', '/authors/jane', '/saved', '/messages/abc'])(
    'is false on the look-alike route %s',
    (pathname) => {
      expect(shouldBootAuth(probe({ cookie: '', pathname }))).toBe(false)
    },
  )

  it('is true for /auth and /signin with no trailing segment', () => {
    expect(shouldBootAuth(probe({ cookie: '', pathname: '/auth' }))).toBe(true)
    expect(shouldBootAuth(probe({ cookie: '', pathname: '/signin' }))).toBe(true)
  })

  /** A listing id that merely contains the word is not an auth signal. */
  it('is false for an unrelated query param that only mentions a token', () => {
    expect(shouldBootAuth(probe({ cookie: '', search: '?q=access_token' }))).toBe(false)
  })
})
