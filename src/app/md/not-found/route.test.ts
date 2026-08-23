import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Pins the agent-facing 404 contract: the markdown body, and the rewrite wiring that is the only
 * thing deciding whether that body can ever reach a browser.
 *
 * ── WHY THE REWRITE HALF IS TESTED HERE AND NOT JUST THE HANDLER ────────────────────────────────
 * The handler is trivial and the wiring is where every dangerous mistake lives. Three of them are
 * silent — no build error, no log line, nothing a click-through would show:
 *   1. the wildcard drifting out of `fallback` into `beforeFiles`/`afterFiles`, which turns real
 *      pages into 404s for markdown-accepting clients;
 *   2. the `has` clause being dropped or re-typed, which serves markdown to browsers;
 *   3. the three existing negotiated paths (`/`, `/privacy`, `/terms`) being displaced.
 * All three are assertions about `next.config.ts`, so that is what this file reads.
 *
 * ⚠️ NEXT.CONFIG.TS THROWS ON IMPORT UNDER VITEST UNLESS `NEXT_PUBLIC_APP_URL` IS SET, and that is
 * the config working as designed, not a test-harness wart. vitest.config.ts pins
 * `NEXT_PUBLIC_ENO_EDITION: 'services'` and deliberately does NOT pin `NEXT_PUBLIC_APP_URL`
 * (service-jsonld.test.ts asserts the absent-host case), while next.config.ts refuses to build once
 * an edition is declared without a matching host. So the env is stubbed here, in the file that
 * needs it, rather than in the shared config — the pattern vitest.config.ts's own comment
 * prescribes.
 */
type RewriteEntry = {
  source: string
  destination: string
  has?: { type: string; key: string; value: string }[]
}
type Rewrites = { beforeFiles: RewriteEntry[]; afterFiles: RewriteEntry[]; fallback: RewriteEntry[] }

let rewrites: Rewrites

beforeAll(async () => {
  // `www.eno.forum` is the host next.config.ts demands for the 'services' edition vitest pins.
  // Nothing below asserts on a host, so this value only has to satisfy the guard.
  process.env.NEXT_PUBLIC_APP_URL = 'https://www.eno.forum'
  // ⚠️ AND THE SUPABASE ORIGIN, FOR THE SAME REASON AND NO OTHER. next.config.ts now THROWS when
  // NEXT_PUBLIC_SUPABASE_URL is absent, because that value is baked into the CSP and
  // images.remotePatterns at build time and a build without it ships a page whose sign-in, chat,
  // uploads and photos are all blocked by the browser — it used to fall back to the retired
  // Supabase Cloud project, which failed silently. This file is the only test that imports the
  // build config, so it is the only one that has to satisfy that guard.
  // ⛔ DO NOT "FIX" A FUTURE FAILURE HERE BY SOFTENING THE THROW IN next.config.ts. The guard is
  // the point; satisfying it in the one test that inspects the config is the cheap side.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.eno.vn'
  const mod = (await import('../../../../next.config')) as { default: { rewrites: () => Promise<Rewrites> } }
  rewrites = await mod.default.rewrites()
})

/**
 * ⚠️ COMPILED EXACTLY AS NEXT COMPILES IT — anchored, case-SENSITIVE, no flags. Read from the
 * installed runtime (node_modules/next/dist/shared/lib/router/utils/prepare-destination.js,
 * `matchHas`): `const matcher = new RegExp(`^${hasItem.value}$`)`. Testing the pattern with `i`, or
 * unanchored, would pass while production behaved differently — which is the whole failure mode
 * this file exists to prevent.
 */
const compileAccept = (value: string) => new RegExp(`^${value}$`)

const markdownHas = (entry: RewriteEntry | undefined) => {
  expect(entry).toBeDefined()
  expect(entry!.has).toHaveLength(1)
  expect(entry!.has![0]).toMatchObject({ type: 'header', key: 'accept' })
  return entry!.has![0].value
}

describe('404 markdown negotiation — rewrite wiring', () => {
  it('routes unmatched paths to /md/not-found from the fallback group only', () => {
    expect(rewrites.fallback).toHaveLength(1)
    expect(rewrites.fallback[0]).toMatchObject({ source: '/:path*', destination: '/md/not-found' })
  })

  /**
   * ⛔ THE LOAD-BEARING ASSERTION. `fallback` is the last route group Next evaluates — after the
   * filesystem AND after dynamic routes — so a `/:path*` source there cannot shadow a real page.
   * The same source in either earlier group would 404 every real page for markdown-accepting
   * clients (`beforeFiles`) or shadow every dynamic segment including `src/app/[handle]`
   * (`afterFiles`). Nothing in the type system stops someone moving the entry, so this does.
   */
  it('never puts a wildcard source in beforeFiles or afterFiles', () => {
    for (const entry of [...rewrites.beforeFiles, ...rewrites.afterFiles]) {
      expect(entry.source).not.toBe('/:path*')
      expect(entry.source).not.toMatch(/^\/:[A-Za-z]+\*$/)
    }
  })

  /**
   * The three per-path negotiations that shipped first. They must stay in `beforeFiles` — they are
   * real pages, so an `afterFiles`/`fallback` entry for them would never once fire (see the comment
   * at the head of `rewrites()`), silently.
   */
  it('leaves the /, /privacy and /terms negotiation intact and in beforeFiles', () => {
    const pairs = rewrites.beforeFiles.map((r) => [r.source, r.destination])
    expect(pairs).toEqual(
      expect.arrayContaining([
        ['/', '/md/home'],
        ['/privacy', '/md/privacy'],
        ['/terms', '/md/terms'],
      ]),
    )
  })

  /**
   * ⚠️ ONE MATCHER, NOT FOUR. The Accept pattern carries two codex-caught parser bugs' worth of
   * history (a bare `.*` that matched `application/nottext/markdown`; a missing token boundary that
   * matched `text/markdown-preview`) plus a q=0 refusal case. A second hand-rolled copy is a second
   * place for those to come back, so identity is asserted rather than behaviour-per-entry.
   */
  it('reuses the identical Accept matcher on all four negotiated entries', () => {
    const values = [
      ...rewrites.beforeFiles.filter((r) => r.destination.startsWith('/md/')),
      ...rewrites.fallback,
    ].map(markdownHas)
    expect(values).toHaveLength(4)
    expect(new Set(values).size).toBe(1)
  })
})

describe('404 markdown negotiation — Accept matcher', () => {
  /**
   * The cases the matcher's own comment in next.config.ts claims to satisfy, made executable.
   * They were verified by hand when the pattern was written and had no test behind them; a regex
   * this dense with lookaheads is exactly the kind that a "small tidy-up" breaks invisibly.
   *
   * ⚠️ EVERY REFUSAL CASE MATTERS AS MUCH AS EVERY ACCEPT CASE. A false positive here does not
   * degrade gracefully — it serves markdown to a real browser, which is the catastrophic direction
   * this whole feature is fenced against.
   */
  const ACCEPTS = [
    'text/markdown',
    'text/markdown, text/html;q=0.9',
    'TEXT/MARKDOWN',
    'text/markdown; charset=utf-8',
    'text/x-markdown',
    'application/markdown',
    'text/html;q=0.8, text/markdown;q=0.9',
    // q=0.9 is not a refusal — the `(?![0-9.])` tail exists because `0` once matched the leading
    // zero of `0.9` and refused a client that had ASKED for markdown.
    'text/markdown;q=0.9',
    'text/markdown;q=0.000001',
    // A later range's q=0 refuses THAT range, not markdown.
    'text/markdown, text/html;q=0',
  ]

  const REFUSES = [
    // Chrome's real Accept string, and Safari's.
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '*/*',
    'text/html',
    'application/json',
    // Explicit refusals of markdown itself, including one hiding behind another parameter.
    'text/markdown;q=0',
    'text/markdown;q=0.0',
    'text/markdown; charset=utf-8; q=0, text/html',
    // Not a request for any media type we serve — the token must end at ; , whitespace or EOL...
    'text/markdown-preview',
    'text/markdownextra',
    // ...and must begin at the start of the header or just after a comma.
    'application/nottext/markdown',
  ]

  it.each(ACCEPTS)('serves markdown for %j', (header) => {
    const value = markdownHas(rewrites.fallback[0])
    expect(compileAccept(value).test(header)).toBe(true)
  })

  it.each(REFUSES)('does NOT serve markdown for %j', (header) => {
    const value = markdownHas(rewrites.fallback[0])
    expect(compileAccept(value).test(header)).toBe(false)
  })
})

describe('404 markdown body', () => {
  const load = async () => {
    const { GET } = await import('./route')
    const res = await GET()
    return { res, body: await res.text() }
  }

  /**
   * ⛔ 404, NOT 200. A `fallback` rewrite is served IN PLACE, so this handler's status is the status
   * of the unknown URL. A 200 would turn every unmatched path into a soft-404 — the one thing the
   * 2026-08-23 agent audit confirmed the site was already getting right.
   */
  it('answers 404', async () => {
    const { res } = await load()
    expect(res.status).toBe(404)
  })

  /**
   * ⛔ `no-store` IS THE SAFETY MECHANISM. These bytes are served from the SAME URL as an HTML
   * page, so any shared cache that stored them under that key would go on to serve markdown to
   * browsers. `Vary: Accept` is the honest statement of what varies and is measured by the
   * acceptmarkdown scanner. See the comment in ../markdown-response.ts.
   */
  it('carries the markdown-response header contract verbatim', async () => {
    const { res } = await load()
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('vary')).toBe('Accept')
    // ⛔ Deliberately absent: the same handler shape serves negotiated responses from real page
    // URLs, so `x-robots-tag: noindex` here would be a noindex on those pages. `Disallow: /md/` in
    // src/app/robots.txt/route.ts is what handles the directly-fetchable duplicate.
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })

  /**
   * What the audit actually asked for: "a short markdown body (site map links, where to look next)
   * so agents can recover". Asserted as PATH SUFFIXES, never as absolute URLs — vitest deliberately
   * leaves NEXT_PUBLIC_APP_URL unpinned, so the origin differs between a clean run and a shell that
   * has exported the repo .env, and a host assertion here would be a gate that disagrees with CI.
   */
  it('offers the recovery entry points and the three machine-readable indexes', async () => {
    const { body } = await load()
    expect(body.startsWith('# ')).toBe(true)
    for (const path of ['/sitemap.xml', '/llms.txt', '/openapi.json', '/brands', '/help', '/contact']) {
      expect(body).toContain(`${path})`)
    }
  })

  it('stays short enough to be worth an agent reading in full', async () => {
    const { body } = await load()
    expect(body.length).toBeLessThan(2000)
  })

  /**
   * ⛔ THE LICENSING BOUNDARY. This file compiles into BOTH editions, and eno.vn is a licensed
   * Vietnamese marketplace that may not show, link to or describe visa, itinerary or PayPal
   * surfaces. A "where to look next" list is the most tempting place to widen — and the response
   * that exists to say a path is absent is the worst possible place to reveal that those paths
   * exist somewhere. Per-deployment discovery is what sitemap.xml and llms.txt are for.
   *
   * ⚠️ vitest pins the SERVICES edition, so this test runs against the build that is ALLOWED to
   * name those surfaces — which is exactly why it is worth having: it fails on copy that a
   * marketplace-only assertion would let through.
   */
  it('names no services surface on either edition', async () => {
    const { body } = await load()
    expect(body).not.toMatch(/visa|itinerar|paypal/i)
  })
})
