import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { matchHas, prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination'

/**
 * ⛔ THE FORUM APEX MOVES ITS PAGES TO `www` (next.config.ts) — and only its pages. Run through Next's OWN matcher,
 * host check and destination compiler (the functions its router calls for a custom redirect), so a pattern Next reads
 * differently from how it looks fails here: the negative lookahead, a path with slashes, the query passed through.
 */
type Redirect = { source: string; destination: string; has?: Parameters<typeof matchHas>[2]; missing?: Parameters<typeof matchHas>[3]; permanent?: boolean }
let redirects: Redirect[] = []

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn') // public: baked into the CSP; next.config refuses without it
  const config = (await import('../../next.config')).default as { redirects: () => Promise<Redirect[]> }
  redirects = await config.redirects()
  vi.unstubAllEnvs()
})

/** Where a request to `host` + `path` (+ query) is redirected, as Next resolves it — or null when nothing matches. */
function resolve(host: string, path: string, query: Record<string, string> = {}): { to: string; query: Record<string, unknown>; permanent?: boolean } | null {
  for (const r of redirects) {
    const params = getPathMatch(r.source, { removeUnnamedParams: true, strict: true })(path)
    if (!params) continue
    const hasParams = matchHas({ headers: { host } } as unknown as IncomingMessage, query, r.has, r.missing)
    if (!hasParams) continue
    const { parsedDestination: d } = prepareDestination({ appendParamsToQuery: false, destination: r.destination, params: { ...params, ...hasParams }, query })
    return { to: `${d.protocol}//${d.hostname}${d.pathname}`, query: d.query, permanent: r.permanent }
  }
  return null
}

describe('next.config redirects — the forum apex moves to www', () => {
  it('⛔ an apex page goes to the same page on www, permanently, with its query', () => {
    expect(resolve('eno.forum', '/', { utm_source: 'x' })).toEqual({ to: 'https://www.eno.forum/', query: { utm_source: 'x' }, permanent: true })
    expect(resolve('eno.forum', '/listings/abc-123')?.to).toBe('https://www.eno.forum/listings/abc-123')
    expect(resolve('eno.forum', '/c/rentals/hcm')?.to).toBe('https://www.eno.forum/c/rentals/hcm')
    expect(resolve('eno.forum', '/auth/google/callback', { code: 'c', state: 's' })).toMatchObject({ to: 'https://www.eno.forum/auth/google/callback', query: { code: 'c', state: 's' } })
  })

  it('⛔ what a redirect would break stays on the apex: the API, the build\'s chunks, .well-known, the service worker, the feeds and images machines fetch', () => {
    for (const p of ['/api', '/api/push/subscribe', '/api/forum/posts', '/_next', '/_next/static/chunks/main.js', '/.well-known', '/.well-known/oauth-authorization-server', '/.well-known/assetlinks.json', '/sw.js', '/feeds/facebook-catalog.csv', '/feeds/google-shopping.xml', '/listing-images/abc.webp']) {
      expect(resolve('eno.forum', p), p).toBeNull()
    }
  })

  it('only the apex host: www itself, and both eno.vn hosts, are untouched (www.eno.vn still goes to its apex)', () => {
    expect(resolve('www.eno.forum', '/listings/abc')).toBeNull()
    expect(resolve('eno.vn', '/listings/abc')).toBeNull()
    expect(resolve('www.eno.vn', '/listings/abc')?.to).toBe('https://eno.vn/listings/abc')
  })

  it('a look-alike of an excluded prefix is still a page, and moves', () => {
    expect(resolve('eno.forum', '/apix')?.to).toBe('https://www.eno.forum/apix')
    expect(resolve('eno.forum', '/apiary/x')?.to).toBe('https://www.eno.forum/apiary/x')
    expect(resolve('eno.forum', '/sw.jsx')?.to).toBe('https://www.eno.forum/sw.jsx')
  })
})
