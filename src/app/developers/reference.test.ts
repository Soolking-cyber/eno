import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * WHAT /developers PROMISES, PINNED PER EDITION.
 *
 * ⛔ THE REGRESSION THIS EXISTS TO CATCH IS NOT HYPOTHETICAL — IT WAS LIVE. Measured on production
 * 2026-08-23: https://eno.forum/developers served a correct `<title>…| eno.forum</title>` above a
 * body containing 49 occurrences of "eno.vn", including `const BASE = 'https://eno.vn/api/v1'` and
 * every curl example on the page. A forum partner following their own documentation sent every
 * request to the other edition's host. (⚠️ An earlier version of this note said they would hit "a
 * different database" and get a 401 — false, and retracted in reference.ts: one Postgres serves
 * both and `resolveApiKey` matches on `hashedKey` alone, so the request SUCCEEDS against the wrong
 * catalogue. Silent, which is worse.) The edition-aware title is exactly what made it survive: the
 * page looked branded correctly to anyone who glanced at the tab.
 *
 * ⚠️ EACH CASE RE-IMPORTS WITH `vi.resetModules()`. `@/lib/edition` reads
 * NEXT_PUBLIC_ENO_EDITION at import time and `@/lib/api/oauth` folds NEXT_PUBLIC_APP_URL into
 * OAUTH_ISSUER the same way, so a constant bound by an earlier import cannot be re-pointed by
 * mutating the variable afterwards — the same reason src/lib/edition-scope.test.ts reloads.
 *
 * ⚠️ THIS TESTS THE REFERENCE MODULE, NOT THE RENDERED JSX, AND THAT IS THE USEFUL BOUNDARY.
 * Rendering an RSC that mounts Header and Footer needs a Next request scope this suite does not
 * have; every value the assertions below care about is one the page reads straight from here, so a
 * hostname regression cannot reach the JSX without failing a case in this file first.
 */

const ENV = ['NEXT_PUBLIC_ENO_EDITION', 'NEXT_PUBLIC_APP_URL'] as const

async function load(edition: 'marketplace' | 'services', appUrl: string | undefined) {
  vi.resetModules()
  const prev = Object.fromEntries(ENV.map((k) => [k, process.env[k]])) as Record<string, string | undefined>
  process.env.NEXT_PUBLIC_ENO_EDITION = edition
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = appUrl
  try {
    return await import('./reference')
  } finally {
    for (const k of ENV) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k] as string
    }
  }
}

afterEach(() => {
  vi.resetModules()
})

/**
 * The six URLs the page publishes as anchors. Every one was curled against BOTH live deployments
 * before it was written down (200 on each, matching content-type) — see the verification table in
 * ./reference. Pinning the list here means deleting a route without deleting its link fails the
 * suite, which is the only automated defence against a developer page that documents a 404.
 */
const REQUIRED_LINKS = [
  // ⚠️ FIRST, AND DELIBERATELY. /api/v1/status is the only entry an agent can CALL without a
  // credential, so it is the one to reach before anything else — and it is the endpoint the
  // anonymous audit uses to observe a live RateLimit header. Adding it here is what caught the
  // omission: it had been wired into robots.txt, llms.txt and the spec but left out of the
  // developer page's own discovery list.
  '/api/v1/status',
  '/openapi.json',
  '/api/v1/openapi.json',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/llms.txt',
  '/sitemap.xml',
]

describe('/developers reference — marketplace edition (eno.vn)', () => {
  it('names eno.vn in the h1 and the title, and points every request at eno.vn', async () => {
    const m = await load('marketplace', 'https://eno.vn')
    // The <h1> and the head of the <title>. The audit's complaint was a name-based query finding
    // nothing; both of the strongest naming signals on the page must carry the product name.
    expect(m.API_NAME).toBe('eno.vn Partner API')
    expect(m.SITE_ORIGIN).toBe('https://eno.vn')
    expect(m.API_BASE).toBe('https://eno.vn/api/v1')
    expect(m.SUPPORT_EMAIL).toBe('support@eno.vn')
  })

  it('publishes all seven discovery URLs as root-relative hrefs', async () => {
    const m = await load('marketplace', 'https://eno.vn')
    expect(m.DISCOVERY.map((d) => d.href)).toEqual(REQUIRED_LINKS)
    // Root-relative, so a link resolves to THIS deployment's copy and carries no hostname that
    // could be the wrong one. Also keeps a native WebView on the origin it started from.
    for (const d of m.DISCOVERY) expect(d.href.startsWith('/')).toBe(true)
  })
})

describe('/developers reference — services edition (eno.forum)', () => {
  it('⛔ NEVER names eno.vn — the exact leak measured on production 2026-08-23', async () => {
    const m = await load('services', 'https://www.eno.forum')
    expect(m.API_NAME).toBe('eno.forum Partner API')
    expect(m.SITE_ORIGIN).toBe('https://www.eno.forum')
    expect(m.API_BASE).toBe('https://www.eno.forum/api/v1')
    expect(m.SUPPORT_EMAIL).toBe('support@eno.forum')

    // The blanket assertion, because the failure was never one field: the page had a correct title
    // above a body full of the other host. Anything this module hands the page must be free of it.
    const everything = [m.API_NAME, m.SITE_ORIGIN, m.API_BASE, m.SUPPORT_EMAIL, ...m.DISCOVERY.map((d) => `${d.href} ${d.label} ${d.note}`)].join(' ')
    expect(everything).not.toContain('eno.vn')
  })

  it('publishes the same seven discovery URLs — both deployments serve them identically', async () => {
    const m = await load('services', 'https://www.eno.forum')
    expect(m.DISCOVERY.map((d) => d.href)).toEqual(REQUIRED_LINKS)
  })
})

describe('/developers reference — invariants that hold on both editions', () => {
  it('documents exactly the four scopes the token endpoint enforces', async () => {
    // Not a retyped list: this is OAUTH_SCOPES, the same constant both .well-known documents
    // advertise and the token endpoint validates `scope=` against. Production confirms it —
    // /.well-known/oauth-authorization-server returns this array verbatim on both hosts.
    for (const edition of ['marketplace', 'services'] as const) {
      const m = await load(edition, undefined)
      expect([...m.SCOPES]).toEqual(['listings:read', 'listings:write', 'analytics:read', 'media:write'])
    }
  })

  it('falls back to its OWN domain when NEXT_PUBLIC_APP_URL is unset, never to eno.vn', async () => {
    // The fallback is the branch a misconfigured deployment actually takes, and it is where a
    // hardcoded default does its damage silently. `https://${SITE_NAME}` keeps it edition-correct.
    const svc = await load('services', undefined)
    expect(svc.SITE_ORIGIN).toBe('https://eno.forum')
    expect(svc.API_BASE).toBe('https://eno.forum/api/v1')

    const mkt = await load('marketplace', undefined)
    expect(mkt.SITE_ORIGIN).toBe('https://eno.vn')
  })

  it('describes no sandbox and no free tier, because neither exists', async () => {
    // A developer page is read by machines that cannot ask a follow-up question. Naming a sandbox
    // a partner then cannot find is worse than the omission, so the vocabulary stays out entirely.
    for (const edition of ['marketplace', 'services'] as const) {
      const m = await load(edition, undefined)
      const prose = m.DISCOVERY.map((d) => d.note).join(' ').toLowerCase()
      expect(prose).not.toContain('sandbox')
      expect(prose).not.toContain('free tier')
      expect(prose).not.toContain('eno_test_')
    }
  })

  it('⛔ names no visa, itinerary or PayPal surface — this page ships in the LICENSED build', async () => {
    // src/lib/edition.ts: anywhere the marketplace edition shows, links to or DESCRIBES one of
    // those, the licensed company is advertising a service it is not licensed for. Nothing on
    // /developers needs that vocabulary, so the safest gate is not needing a gate.
    const m = await load('marketplace', 'https://eno.vn')
    const everything = [m.API_NAME, m.API_BASE, ...m.DISCOVERY.map((d) => `${d.href} ${d.label} ${d.note}`)].join(' ').toLowerCase()
    for (const banned of ['visa', 'itinerary', 'paypal']) expect(everything).not.toContain(banned)
  })
})
