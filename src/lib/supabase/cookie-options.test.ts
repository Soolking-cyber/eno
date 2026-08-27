import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { authCookieOptions } from './cookie-options'

/**
 * ⛔ THIS FILE EXISTS TO MAKE A FUTURE "FIX" FAIL LOUDLY. A security audit on 2026-08-27 called the
 * missing cookie flags HIGH and prescribed `{ httpOnly: true, secure: true }`. The `secure` half
 * shipped; `httpOnly` would break authentication across web and native, because no session lives
 * anywhere but these cookies and `createBrowserClient` reads them with `parse(document.cookie)`.
 * The reasoning is written out in cookie-options.ts — this is the part that bites, because the
 * damage from `httpOnly` is SILENT: a test login still succeeds (the server session is set either
 * way) and the failure surfaces later as Realtime chat quietly not delivering.
 */

afterEach(() => { vi.unstubAllEnvs() })

describe('authCookieOptions', () => {
  /**
   * ⛔ THE ASSERTION IS ON THE WHOLE OBJECT, NOT `not.toHaveProperty('httpOnly')`. The negative form
   * also passes when the function returns `undefined` — a reviewer's catch — so it would have gone
   * green on a module that exported nothing at all.
   */
  it('never returns httpOnly, whatever else it returns', () => {
    for (const proto of ['https', 'http', null]) {
      const o = authCookieOptions({ proto })
      // ⚠️ NOT `not.toHaveProperty` ALONE — that also passes when the function returns `undefined`,
      // so the object is asserted to exist first. And NOT `toEqual({secure:true})` either: locking
      // the whole shape would go red the day someone legitimately adds `sameSite` or `path`, and a
      // guard that fails for good reasons is a guard somebody deletes — taking the httpOnly
      // protection with it. Both notes are reviewers' catches, from opposite directions.
      // ⚠️ TRUTHY, NOT JUST `toBeTypeOf('object')` — `typeof null === 'object'`, so the looser
      // assertion admitted the one value this check exists to reject. A reviewer's catch.
      expect(o, String(proto)).toBeTruthy()
      expect(Object.keys(o), String(proto)).not.toContain('httpOnly')
    }
    expect(authCookieOptions({ proto: 'https' }).secure).toBe(true)
  })

  it('follows the request scheme wherever one is known', () => {
    expect(authCookieOptions({ proto: 'https' }).secure).toBe(true)
    expect(authCookieOptions({ proto: 'https:' }).secure).toBe(true)      // location.protocol form
    expect(authCookieOptions({ proto: 'HTTPS' }).secure).toBe(true)
    expect(authCookieOptions({ proto: 'http' }).secure).toBe(false)
    // ⛔ A FORWARDED-HEADER SHAPE IS NOT A SCHEME, and must not resolve to one. This function takes
    // `location.protocol`; a comma-separated chain can only have come from `x-forwarded-proto`,
    // which two rounds of review established must never reach here. It resolves to NOT-secure
    // rather than picking a hop, so a misuse is visible instead of silently downgrading.
    expect(authCookieOptions({ proto: 'https,http' }).secure).toBe(false)
    expect(authCookieOptions({ proto: 'http,https' }).secure).toBe(false)
  })

  /**
   * ⛔ THE CASE THAT MADE THIS ORIGIN-DRIVEN. `preview:vn` is a PRODUCTION build served over
   * http://localhost:3000, and CLAUDE.md makes it the mandatory pre-ship review surface. A bare
   * `NODE_ENV === 'production'` gate marked those cookies Secure, which Safari drops on a plain-HTTP
   * origin — a sign-in loop on the exact artifact the owner reviews before authorising a deploy.
   */
  it('does not mark the local preview Secure', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOCAL_AUTH', '1')
    vi.stubEnv('NEXT_PUBLIC_LOCAL_AUTH', '1')
    expect(authCookieOptions({ proto: 'http:' }).secure).toBe(false)   // the browser knows its scheme
    expect(authCookieOptions({ proto: null }).secure).toBe(false)      // and the server falls back
  })

  /**
   * ⛔ FAILS SECURE WHEN NOTHING KNOWS. A production request that reaches the container with no
   * `x-forwarded-proto` gets the flag anyway — the opposite choice would silently downgrade a real
   * session, and `LOCAL_AUTH` is absent from the box's build env so it cannot mask this.
   */
  it('marks it Secure in production when no scheme is available', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOCAL_AUTH', '')
    vi.stubEnv('NEXT_PUBLIC_LOCAL_AUTH', '')
    expect(authCookieOptions({ proto: null }).secure).toBe(true)
  })

  /**
   * ⛔ NO REQUEST HEADER CAN DOWNGRADE IT. Two drafts took caller input — first `Host`, then
   * `x-forwarded-proto` — and the server now takes none at all: it is called with no argument, so
   * the only inputs are build-time. `proto` remains for the BROWSER, where `location.protocol` is
   * the document's real origin rather than something a request can assert.
   */
  it('takes no caller input on the server path', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOCAL_AUTH', '')
    vi.stubEnv('NEXT_PUBLIC_LOCAL_AUTH', '')
    expect(authCookieOptions().secure).toBe(true)
    // Anything extra a caller might pass is simply not read.
    expect(authCookieOptions({ ...({ host: 'localhost', 'x-forwarded-proto': 'http' } as object) }).secure).toBe(true)
  })

  it('honours NEXT_PUBLIC_LOCAL_AUTH too, since only that name reaches the browser bundle', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOCAL_AUTH', '')
    vi.stubEnv('NEXT_PUBLIC_LOCAL_AUTH', '1')
    expect(authCookieOptions().secure).toBe(false)
  })

  it('never marks it Secure in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(authCookieOptions().secure).toBe(false)
  })
})

/**
 * ⛔ THE WIRING INVARIANT, ASSERTED AGAINST THE WHOLE REPO RATHER THAN TWO FILES. The first version
 * grepped server.ts and browser.ts for `cookieOptions:` — which a reviewer pointed out proves
 * nothing: it matches a commented-out line, and it stays green while some OTHER module constructs
 * its own Supabase client and writes cookies without the flag. What actually has to be true is that
 * these two factories are the only places a client is built.
 */
describe('client construction is centralised', () => {
  // ⚠️ TESTS ARE EXCLUDED, THIS FILE INCLUDED — it imports the module under test, so leaving them in
  // made the import assertion fail on itself.
  // ⛔ `--untracked`, BECAUSE A BRAND-NEW FILE IS EXACTLY THE RISK. Plain `git grep` sees only what
  // is staged or committed, so a just-written module calling `createBrowserClient(` would sail past
  // the centralisation gate until someone thought to `git add` it — the moment the check is least
  // likely to be re-run. A reviewer's catch.
  // ⛔ AND IT THROWS RATHER THAN RETURNING []. The first version swallowed every execFileSync
  // failure into an empty array, which turns each negative assertion below into a test that is
  // green on nothing: no git binary, no .git directory (a tarball CI checkout), a renamed path —
  // all would have "passed". Only exit code 1, git's documented "no match", is a legitimate empty.
  const grep = (pattern: string): string[] => {
    try {
      return execFileSync('git', ['grep', '-l', '--untracked', '-E', pattern, '--', 'src'], { encoding: 'utf8' })
        .split('\n').filter(Boolean).filter((f) => !/\.test\.tsx?$/.test(f))
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 1) return []
      throw new Error(`git grep failed (status ${status}) — this gate cannot be trusted: ${String(e)}`)
    }
  }

  // ⚠️ A POSITIVE CONTROL FOR THE HELPER ITSELF. Every assertion below is "this set is exactly X",
  // and a helper that quietly found nothing would satisfy the negative half of that. This proves
  // the search actually reaches the tree before anything is concluded from its silence.
  it('the grep helper actually finds things', () => {
    expect(grep(String.raw`authCookieOptions`).length).toBeGreaterThan(0)
    expect(grep(String.raw`zzz_no_such_symbol_zzz`)).toEqual([])
  })

  // ⚠️ SCOPED TO `src`, WHICH IS THE DEPLOYED TREE FOR BOTH EDITIONS. `apps/forum/**` is dormant
  // source kept in git and built by nothing (CLAUDE.md), so it is deliberately out of scope here —
  // a reviewer noted the grep cannot see it, and that is correct and intended.
  it('builds a Supabase client in exactly the two patched factories', () => {
    expect(grep(String.raw`\b(createServerClient|createBrowserClient)\(`).sort()).toEqual(['src/lib/supabase/browser.ts', 'src/lib/supabase/server.ts'])
  })

  it('passes cookieOptions from both of them', () => {
    expect(grep(String.raw`cookieOptions:\s*authCookieOptions\(`).sort())
      .toEqual(['src/lib/supabase/browser.ts', 'src/lib/supabase/server.ts'])
  })

  /**
   * ⛔ THE REAL SHAPE OF THE RISK: `httpOnly` ARRIVING AT A CALL SITE, NOT IN THIS FUNCTION. Pinning
   * only the return value leaves the most natural response to re-receiving the 2026-08-27 audit
   * wide open — `{ cookieOptions: { ...authCookieOptions(), httpOnly: true } }` in server.ts, or an
   * `httpOnly` slipped into `setAll`'s per-cookie options — both of which would sail through green
   * while silently killing Realtime chat. A reviewer's catch, and the sharpest one of the review.
   * ⛔ SCOPED TO THE SUPABASE WIRING, NOT THE WHOLE TREE — the first version of this test banned
   * `httpOnly` across `src` and went red immediately, which was the test being wrong rather than
   * the code. Measured: the OAuth start/callback and the cross-edition handoff routes
   * (api/auth/handoff/*, auth/google/start, lib/auth/handoff.ts) set httpOnly on THEIR OWN nonce,
   * state and verifier cookies, where it is exactly right — those are never read from JS. The
   * invariant is only ever about the SUPABASE SESSION cookie, so it is asserted where that cookie
   * is configured and nowhere else.
   */
  it('neither Supabase client passes httpOnly', () => {
    const offenders = grep(String.raw`httpOnly\s*:`)
      .filter((f) => f === 'src/lib/supabase/server.ts' || f === 'src/lib/supabase/browser.ts')
    expect(offenders).toEqual([])
  })

  /**
   * ⛔ THE PREVIEW HATCH IS A COUPLING, SO IT IS PINNED. The browser bundle can only see
   * `NEXT_PUBLIC_LOCAL_AUTH` — Next inlines nothing else — so if scripts/preview.mjs ever set only
   * the bare `LOCAL_AUTH`, a client-side fallback would resolve to `secure: true` on
   * http://localhost and reintroduce the Safari sign-in loop this design exists to prevent. It sets
   * both today; a reviewer was right that nothing was holding it there. Now something is.
   */
  it('preview.mjs sets BOTH local-auth flags, including the one the browser can see', () => {
    const src = readFileSync(new URL('../../../scripts/preview.mjs', import.meta.url), 'utf8')
    expect(src).toMatch(/NEXT_PUBLIC_LOCAL_AUTH:\s*'1'/)
    expect(src).toMatch(/(?<!NEXT_PUBLIC_)LOCAL_AUTH:\s*'1'/)
  })

  /**
   * ⚠️ THE BROWSER MUST PASS A REAL SCHEME, not fall through to the env branch. `location.protocol`
   * is always defined in a document; this pins the call site so a refactor cannot quietly drop the
   * argument and land every browser-written cookie on the fallback instead.
   */
  it('the browser client passes its own protocol', () => {
    const src = readFileSync(new URL('browser.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/authCookieOptions\(\{\s*proto:\s*globalThis\.location\?\.protocol\s*\}\)/)
  })

  /**
   * ⚠️ `next/headers` IS SERVER-ONLY. This constant lives in its own module precisely so the browser
   * client can import it without dragging that in and failing the build — a failure tsc does not
   * catch. If someone folds it back into server.ts, this catches it before `next build` does.
   */
  it('keeps the shared module free of server-only imports', () => {
    expect(grep(String.raw`from '\./cookie-options'`).sort())
      .toEqual(['src/lib/supabase/browser.ts', 'src/lib/supabase/server.ts'])
    // ⚠️ AN IMPORT SPECIFIER, NOT THE WORDS. A bare `next/headers` search also matched the prose in
    // cookie-options.ts explaining why it must not import it — the test failed on its own comment.
    // ⛔ ASSERTED POSITIVELY FIRST, because this is the one check whose failure mode is silence: a
    // pattern that matched nothing would satisfy the `not.toContain` below no matter what the tree
    // holds. server.ts genuinely does import `next/headers`, so finding it proves the pattern
    // compiles and reaches the files before its absence is read as evidence. A reviewer's catch.
    const headerImporters = grep(String.raw`from ['"]next/headers['"]`)
    expect(headerImporters).toContain('src/lib/supabase/server.ts')
    expect(headerImporters).not.toContain('src/lib/supabase/cookie-options.ts')
  })
})
