// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { compile } from 'tailwindcss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createBrowserClient, createChunks, stringToBase64URL } from '@supabase/ssr'
import { authCookieOptions } from '@/lib/supabase/cookie-options'
import { runHeadScript } from '@/test/head-script'

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: true }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: auth.user, loading: auth.loading }) }))
// The rail body is its own chunk; nothing here reads it.
vi.mock('next/dynamic', () => ({ default: () => () => null }))

import { AccountPanelShell } from './account-panel'

/**
 * THE SIGNED-IN DESKTOP RAIL'S GUTTERS FROM THE FIRST FRAME (speed plan R21). The shell's 72px padding used to arrive
 * once auth resolved after hydration and move the whole page. Now:
 *   · the pre-paint head script puts `rail-hint` on <html> only for a session THIS build's browser client returns
 *     without a network call: its exact cookie name (never another project's, never the PKCE verifier), chunks joined
 *     as @supabase/ssr joins them, decodable, with a user, at least 90 s from expiry;
 *   · the closed shell carries `rail-hint:px-[var(--account-w)]`, which compiles to the same 72px from 73rem with a
 *     fine pointer, only under that class;
 *   · the shell drops the class once the rail is open or auth settles with no user — and at no moment in between
 *     is the page left with neither the hint nor the open padding.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */
afterEach(cleanup)

const HINT = 'rail-hint:px-[var(--account-w)]'
const OPEN = 'pc:px-[var(--account-w)]'
const html = document.documentElement
const tokens = (c: string) => c.split(/\s+/).filter(Boolean)

let pc = true
beforeEach(() => {
  auth.user = null
  auth.loading = true
  pc = true
  html.className = ''
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: pc, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  html.className = ''
  vi.unstubAllGlobals()
})

const PAGE = 'page'
const shell = () => (
  <AccountPanelShell>
    <p>{PAGE}</p>
  </AccountPanelShell>
)

/**
 * Every state the wrapper's and <html>'s class lists pass through, rebuilt from MutationObserver records (a record's
 * oldValue is its target's value before it; the value after it is the next record's oldValue on that target, or the
 * live one) — so a commit that drops the hint before the open class lands is seen even if a later one repairs it.
 */
function watch(wrapper: Element) {
  const start = { wrapper: wrapper.className, html: html.className }
  const recs: MutationRecord[] = []
  const mo = new MutationObserver((r) => { recs.push(...r) })
  mo.observe(wrapper, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  mo.observe(html, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  return () => {
    recs.push(...mo.takeRecords())
    mo.disconnect()
    const after = (t: Node, i: number) => recs.slice(i + 1).find((r) => r.target === t)?.oldValue ?? (t === html ? html.className : wrapper.className)
    return [start, ...recs.map((_, i) => ({ wrapper: after(wrapper, i), html: after(html, i) }))]
  }
}
/** Reserved = the open padding, or the hint padding with <html> still carrying the hint. */
const reserved = (s: { wrapper: string; html: string }) =>
  tokens(s.wrapper).includes(OPEN) || (tokens(s.wrapper).includes(HINT) && tokens(s.html).includes('rail-hint'))

describe('the closed shell — what the server renders', () => {
  it('carries the hint class and not the open padding (no user on the server)', () => {
    const out = renderToString(shell())
    const cls = /<div class="([^"]*)"/.exec(out)?.[1] ?? ''
    expect(tokens(cls)).toContain(HINT)
    expect(tokens(cls)).not.toContain(OPEN)
    expect(tokens(cls)).toContain('transition-[padding]')
  })

  it('hydrates that markup without a mismatch', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(shell())
    document.body.appendChild(container)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { render(shell(), { container, hydrate: true }) })
    expect(errors).not.toHaveBeenCalled()
    expect(tokens(container.firstElementChild!.className)).toContain(HINT)
  })
})

describe('the hint is dropped only once it has done its job', () => {
  it('signed in on a desktop: the open padding replaces the hint in one commit, then <html> loses the class', async () => {
    html.classList.add('rail-hint')
    const { container, rerender } = render(shell())
    const wrapper = container.firstElementChild!
    expect(tokens(wrapper.className)).toContain(HINT)
    expect(html.classList.contains('rail-hint')).toBe(true)

    const done = watch(wrapper)
    auth.user = { id: 'u1' }
    auth.loading = false
    await act(async () => { rerender(shell()) })
    const states = done()

    expect(tokens(wrapper.className)).toContain(OPEN)
    expect(tokens(wrapper.className)).not.toContain(HINT)
    expect(html.classList.contains('rail-hint')).toBe(false)
    expect(states.length).toBeGreaterThan(2)
    expect(states.filter((s) => !reserved(s))).toEqual([])
  })

  it('auth settles with no user (a cookie for a session that no longer refreshes): <html> loses the class', async () => {
    html.classList.add('rail-hint')
    const { container, rerender } = render(shell())
    auth.loading = false
    await act(async () => { rerender(shell()) })
    expect(html.classList.contains('rail-hint')).toBe(false)
    expect(tokens(container.firstElementChild!.className)).not.toContain(OPEN)
  })

  it('kept while auth is still loading, whatever the delay', async () => {
    html.classList.add('rail-hint')
    const { rerender } = render(shell())
    await act(async () => { rerender(shell()) })
    expect(html.classList.contains('rail-hint')).toBe(true)
  })

  it('signed in but not a `pc` device: no rail, the class stays (its CSS needs a fine pointer, like `pc`) until sign-out', async () => {
    pc = false
    html.classList.add('rail-hint')
    const { container, rerender } = render(shell())
    auth.user = { id: 'u1' }
    auth.loading = false
    await act(async () => { rerender(shell()) })
    expect(tokens(container.firstElementChild!.className)).not.toContain(OPEN)
    expect(html.classList.contains('rail-hint')).toBe(true)
    auth.user = null
    await act(async () => { rerender(shell()) })
    expect(html.classList.contains('rail-hint')).toBe(false)
  })

  it('a guest: the shell never adds the class', async () => {
    const { rerender } = render(shell())
    auth.loading = false
    await act(async () => { rerender(shell()) })
    expect(html.classList.contains('rail-hint')).toBe(false)
  })
})

describe('the CSS — the 72px gutters from 73rem with a fine pointer, only under html.rail-hint', () => {
  it('compiles from globals.css\'s own variants to that one rule, and to nothing outside it', async () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const variants = css.split('\n').filter((l) => /^@custom-variant (pc|rail-hint) /.test(l))
    expect(variants).toEqual([
      '@custom-variant pc (@media (min-width: 64rem) and (pointer: fine));',
      '@custom-variant rail-hint { @media (min-width: 73rem) and (pointer: fine) { &:is(.rail-hint *) { @slot; } } }',
    ])
    const out = (await compile(['@tailwind utilities;', ...variants].join('\n'))).build([HINT, OPEN])
    const sel = '.rail-hint\\:px-\\[var\\(--account-w\\)\\]'
    expect(out).toContain(`@media (min-width: 73rem) and (pointer: fine) {\n  ${sel}:is(.rail-hint *) {\n    padding-inline: var(--account-w);\n  }\n}`)
    expect(out.split(sel).length - 1).toBe(1)
    // The open state's own rule is the same declaration (inside `pc`), so the swap moves nothing.
    expect(out).toContain('.pc\\:px-\\[var\\(--account-w\\)\\] {\n    padding-inline: var(--account-w);')
  })
})

/**
 * THE HEAD SCRIPT SETS rail-hint ONLY FOR A SESSION THIS BUILD'S CLIENT RETURNS WITHOUT A NETWORK CALL — a hint that
 * auth then takes back moves the page (review round 4: +0.04-0.08 CLS for a revoked, unreadable or stale cookie). The
 * cookies here are written by @supabase/ssr's own createChunks + stringToBase64URL (what its setItem writes with the
 * default 'base64url' encoding browser.ts keeps), and every case that gets the class is checked against the REAL browser
 * client (createBrowserClient as browser.ts builds it, fetch stubbed and counted): it must return that user from
 * getSession() with no request at all.
 */
describe('the head script — html.rail-hint only for a session this build\'s client returns without a network call', () => {
  const set = (...cookies: string[]) => { for (const c of cookies) document.cookie = `${c}; path=/` }
  const clear = () => {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim()
      if (name) document.cookie = `${name}=; path=/; max-age=0`
    }
  }
  // A whole second, so expires_at (seconds) lands exactly on the 90 s boundary below.
  const NOW = Date.UTC(2026, 10, 11, 3, 0, 0)
  const nowS = NOW / 1000
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { clear(); vi.useRealTimers() })
  const PROD = 'https://sb.eno.vn'
  const N = 'sb-sb-auth-token'
  const UID = '7e5f0a1c-8a3b-4c2d-9e10-000000000001'
  const run = (supabaseUrl: string | null = PROD) => { html.className = ''; runHeadScript({ appleIos: false, supabaseUrl }); return [...html.classList] }

  /** A session as auth-js stores it; `meta` pads user_metadata (a Google sign-in carries ~1-2 KB of it). */
  const session = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
    access_token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', token_type: 'bearer', expires_in: 3600, expires_at: nowS + 3600,
    refresh_token: 'r3fr35h', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@example.test', app_metadata: { provider: 'google' }, user_metadata: meta },
    ...over,
  })
  const pad = (bytes: number) => ({ avatar_url: `https://lh3.googleusercontent.com/a/${'x'.repeat(bytes)}`, full_name: 'Test Person' })
  /** The cookie(s) @supabase/ssr writes for `s`, split at its own MAX_CHUNK_SIZE. */
  const write = (name: string, s: unknown) => createChunks(name, `base64-${stringToBase64URL(JSON.stringify(s))}`)
  const put = (chunks: { name: string; value: string }[]) => set(...chunks.map((c) => `${c.name}=${c.value}`))

  /** What the real browser client makes of the jar (it reads the same document.cookie). */
  async function client(answer?: () => Response) {
    const calls: string[] = []
    const fetch = async (input: RequestInfo | URL) => {
      calls.push(String(input))
      if (answer) return answer()
      throw new TypeError('offline (test)')
    }
    const c = createBrowserClient(PROD, 'sb_publishable_rail_hint_test', {
      isSingleton: false,
      cookieOptions: authCookieOptions({ proto: globalThis.location?.protocol }),
      global: { fetch },
    })
    const { data } = await c.auth.getSession()
    await c.auth.stopAutoRefresh()
    return { userId: data.session?.user?.id ?? null, calls }
  }
  const revoked = () => new Response(JSON.stringify({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }), { status: 400, headers: { 'content-type': 'application/json' } })

  it('a valid session, whole cookie → rail-hint (and no no-session); the client returns it with no request', async () => {
    const jar = write(N, session())
    expect(jar.map((c) => c.name)).toEqual([N])
    put(jar)
    expect(run()).toContain('rail-hint')
    expect(run()).not.toContain('no-session')
    expect(await client()).toEqual({ userId: UID, calls: [] })
  })

  it('a valid .0 + .1 pair (a ~4 KB session, split by @supabase/ssr) → rail-hint; the client returns it with no request', async () => {
    const jar = write(N, session({}, pad(2200)))
    expect(jar.map((c) => c.name)).toEqual([`${N}.0`, `${N}.1`])
    put([{ name: 'lang', value: 'vi' }, ...jar])
    expect(run()).toContain('rail-hint')
    expect(await client()).toEqual({ userId: UID, calls: [] })
  })

  it('a valid 3-chunk set → rail-hint; the client returns it with no request', async () => {
    const jar = write(N, session({}, pad(5000)))
    expect(jar.map((c) => c.name)).toEqual([`${N}.0`, `${N}.1`, `${N}.2`])
    put(jar)
    expect(run()).toContain('rail-hint')
    expect(await client()).toEqual({ userId: UID, calls: [] })
  })

  it('non-ASCII user metadata (a Vietnamese name, an emoji) → rail-hint: atob\'s bytes are decoded as UTF-8, as @supabase/ssr does', async () => {
    const meta = { ...pad(1800), full_name: 'Nguyễn Thị Ánh', name: 'Ánh 🌸' }
    const jar = write(N, session({}, meta))
    // The payload really carries UTF-8 bytes above 0x7F (atob returns them as a binary string).
    const b64 = jar.map((c) => c.value).join('').slice(7).split('-').join('+').split('_').join('/')
    expect([...atob(b64)].some((ch) => ch.charCodeAt(0) > 0x7f)).toBe(true)
    put(jar)
    expect(run()).toContain('rail-hint')
    clear()
    put(write(N, session({}, { full_name: 'Đặng Văn Lâm', name: '🌸' })))
    expect(run()).toContain('rail-hint')
    expect(await client()).toEqual({ userId: UID, calls: [] })
    // Even a non-ASCII id is read as the client reads it.
    clear()
    put(write(N, session({ user: { id: 'ví-dụ-🌸', aud: 'authenticated' } })))
    expect(run()).toContain('rail-hint')
    expect(await client()).toEqual({ userId: 'ví-dụ-🌸', calls: [] })
  })

  it('bytes that are not valid UTF-8 → no rail-hint: @supabase/ssr refuses them too, so the client has no session', async () => {
    // {"…","user_metadata":{"name":"<0xE9>"}} — Latin-1 é, a lone byte. JSON.parse(atob(…)) alone would accept it.
    const json = JSON.stringify(session({}, { name: 'Ž' }))
    const bytes = Buffer.from(json, 'utf8')
    const at = bytes.indexOf(Buffer.from('Ž', 'utf8'))
    const bad = Buffer.concat([bytes.subarray(0, at), Buffer.from([0xe9]), bytes.subarray(at + 2)])
    set(`${N}=base64-${bad.toString('base64url')}`)
    expect(run()).not.toContain('rail-hint')
    expect(await client()).toEqual({ userId: null, calls: [] })
  })

  it('expires_at exactly 90 s ahead (auth-js EXPIRY_MARGIN_MS) → rail-hint; the client still needs no request', async () => {
    put(write(N, session({ expires_at: nowS + 90 })))
    expect(run()).toContain('rail-hint')
    expect(await client()).toEqual({ userId: UID, calls: [] })
  })

  it('expires_at in the past → no rail-hint (the client must refresh first; a 400 signs it out)', async () => {
    put(write(N, session({ expires_at: nowS - 3600, expires_in: 0 })))
    expect(run()).not.toContain('rail-hint')
    const c = await client(revoked)
    expect(c.userId).toBeNull()
    expect(c.calls.length).toBeGreaterThan(0)
  })

  it('expires_at within 90 s → no rail-hint (the client refreshes before it answers)', async () => {
    put(write(N, session({ expires_at: nowS + 89 })))
    expect(run()).not.toContain('rail-hint')
    expect((await client(revoked)).calls.length).toBeGreaterThan(0)
  })

  it('a lone truncated .0 (its .1 never arrived) → no rail-hint; the client cannot read it either', async () => {
    const jar = write(N, session({}, pad(2200)))
    expect(jar).toHaveLength(2)
    put([jar[0]])
    expect(run()).not.toContain('rail-hint')
    expect(await client()).toEqual({ userId: null, calls: [] })
  })

  it('a missing middle chunk (.0 + .2) → no rail-hint', async () => {
    const jar = write(N, session({}, pad(5000)))
    expect(jar).toHaveLength(3)
    put([jar[0], jar[2]])
    expect(run()).not.toContain('rail-hint')
    expect(await client()).toEqual({ userId: null, calls: [] })
  })

  it('a session with no user, no user id, no access token or no refresh token → no rail-hint', () => {
    for (const s of [session({ user: undefined }), session({ user: null }), session({ user: { aud: 'authenticated' } }), session({ access_token: undefined }), session({ refresh_token: '' })]) {
      clear()
      put(write(N, s))
      expect(run()).not.toContain('rail-hint')
    }
  })

  it('an unparseable value → no rail-hint, and nothing thrown out of the script', () => {
    const values = [
      `base64-${stringToBase64URL('{"access_token":"a","refresh_token":"b","expires_at":9999999999,"user":{"id":"u"}')}`,
      `base64-${stringToBase64URL('null')}`, `base64-${stringToBase64URL('[1]')}`, `base64-${stringToBase64URL('"x"')}`,
      'base64-', 'base64-x', 'base64-!!!!', 'base64-%7B%7D', 'base64-eyJhIjoxfQ',
    ]
    for (const v of values) {
      clear()
      set(`${N}=${v}`)
      expect(run).not.toThrow()
      expect(run()).not.toContain('rail-hint')
    }
  })

  it('a payload in the standard base64 alphabet (+ or /) → no rail-hint: atob takes it, @supabase/ssr does not', async () => {
    // {"access_token":"~~~",…} encodes to "…IjoiJ+fn4i…": a `+` that only a hand-made cookie carries.
    const std = Buffer.from(JSON.stringify(session({ access_token: '~~~' })), 'utf8').toString('base64').replace(/=+$/, '')
    expect(std).toMatch(/[+/]/)
    set(`${N}=base64-${std}`)
    expect(run()).not.toContain('rail-hint')
    expect(await client()).toEqual({ userId: null, calls: [] })
  })

  it('a stored user carrying auth-js\'s __isUserNotAvailableProxy marker → no rail-hint: the client fetches that user first', async () => {
    put(write(N, session({ user: { id: UID, __isUserNotAvailableProxy: true } })))
    expect(run()).not.toContain('rail-hint')
    expect((await client(revoked)).calls.length).toBeGreaterThan(0)
  })

  it('a value without the "base64-" prefix (the pre-base64url raw JSON) → no rail-hint', () => {
    set(`${N}=${encodeURIComponent(JSON.stringify(session()))}`)
    expect(run()).not.toContain('rail-hint')
  })

  it('ANOTHER project\'s valid session, whole or chunked → no rail-hint (this client never reads it)', () => {
    // The retired Supabase Cloud project eno.vn used until 2026-08-22: sign-out never clears it.
    put(write('sb-xihiryllwmjoouipkyhw-auth-token', session()))
    expect(run()).not.toContain('rail-hint')
    clear()
    put(write('sb-xihiryllwmjoouipkyhw-auth-token', session({}, pad(2200))))
    expect(run()).not.toContain('rail-hint')
    clear()
    // Production's name on the local fixture build (http://127.0.0.1:54321 → sb-127-auth-token), and back.
    put(write(N, session()))
    expect(run('http://127.0.0.1:54321')).not.toContain('rail-hint')
    clear()
    put(write('sb-127-auth-token', session()))
    expect(run('http://127.0.0.1:54321')).toContain('rail-hint')
  })

  it('an unset or invalid project URL → no rail-hint, whatever the jar holds', () => {
    put([...write(N, session()), { name: 'sb-null-auth-token', value: write('x', session())[0].value }])
    for (const url of [null, '', 'sb.eno.vn', 'https://']) expect(run(url)).not.toContain('rail-hint')
  })

  it('no cookie, other cookies, a look-alike, an orphan second chunk, or only the PKCE verifier → no rail-hint', () => {
    expect(run()).not.toContain('rail-hint')
    expect(run()).toContain('no-session')
    const v = write(N, session())[0].value
    set('lang=vi', `eno_attr=${N}`, `x${N}=${v}`, `${N}s=${v}`, `${N}.1=${v}`, `${N}-code-verifier=${v}`, `${N}-user=${v}`)
    expect(run()).not.toContain('rail-hint')
  })

  it('the block stays small and template-safe: no regex, no backslash, under 700 bytes once filled', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
    const block = /try\{var rn=\$\{SESSION_COOKIE_NAME_JS\}[^]*?catch\(e\)\{\}/.exec(src)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).not.toContain('\\')
    expect(block).not.toMatch(/\.test\(|\.match\(|\.replace\(|RegExp/)
    expect(new TextEncoder().encode(block.replace('${SESSION_COOKIE_NAME_JS}', JSON.stringify(N))).length).toBeLessThan(700)
  })
})
