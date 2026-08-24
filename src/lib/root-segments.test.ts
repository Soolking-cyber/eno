import { describe, it, expect } from 'vitest'
import { appRootSegments, markdown404Source } from './root-segments'

const MARKETPLACE = ['ts', 'tsx', 'js', 'jsx']
const SERVICES = [...MARKETPLACE, 'svc.ts', 'svc.tsx', 'svc.js', 'svc.jsx',
  'forum.svc.ts', 'forum.svc.tsx', 'forum.svc.js', 'forum.svc.jsx']

const matcher = (segments: string[]) => {
  const src = markdown404Source(segments)
  const re = new RegExp(`^${src.replace('/:seg(', '/(')}$`)
  return (path: string) => re.test(path)
}

/**
 * ⛔ THE FAILURE THIS GUARDS IS INVISIBLE TO EVERY OTHER TEST. The markdown-404 rewrite fires only
 * on `Accept: text/markdown`, which no browser sends — so if it starts shadowing a real page the
 * site looks perfect in a browser, in Playwright and in a smoke test, while agents (the only
 * audience the rewrite has) are told the page does not exist.
 */
describe('markdown-404 rewrite scope', () => {
  it('derives a plausible number of real segments for both editions', () => {
    // Guard the guard: an empty or tiny list would make the pattern claim everything.
    expect(appRootSegments(MARKETPLACE).length).toBeGreaterThan(20)
    expect(appRootSegments(SERVICES).length).toBeGreaterThan(appRootSegments(MARKETPLACE).length)
  })

  it.each([['marketplace', MARKETPLACE], ['services', SERVICES]] as const)(
    'never claims a real page on the %s edition', (_name, exts) => {
      const caught = matcher(appRootSegments(exts))
      for (const seg of appRootSegments(exts)) {
        expect(caught(`/${seg}`), `/${seg} is a real route but the rewrite would claim it`).toBe(false)
      }
    })

  /**
   * ⛔ THE LICENSING ASSERTION. `src/app/itinerary` holds only `page.forum.svc.tsx`, so it is a
   * route on eno.forum and NOT ONE on eno.vn. A directory-name-only derivation wrote `itinerary`
   * into the MARKETPLACE artifact's config — an edition leak that passes tsc, lint and every other
   * test. Mutation-checked: dropping the pageExtensions filter turns this red.
   */
  it('keeps forum-only route names out of the marketplace segment list', () => {
    expect(appRootSegments(MARKETPLACE)).not.toContain('itinerary')
    expect(appRootSegments(SERVICES)).toContain('itinerary')
    // Same shape, the other direction: a forum-only SEO page eno.vn genuinely 404s.
    expect(appRootSegments(MARKETPLACE)).not.toContain('moving-to-vietnam')
    // ⛔ THE REGRESSION THAT ACTUALLY SHIPPED IN A DRAFT. `src/app/vietnam-evisa` holds
    // `page.forum.svc.tsx` AND child route directories. A "…but it has subdirectories" fallback
    // put it in the marketplace list even though eno.vn 404s it (measured). Nested children must
    // never promote a parent that has no page for this edition.
    expect(appRootSegments(MARKETPLACE)).not.toContain('vietnam-evisa')
    expect(appRootSegments(SERVICES)).toContain('vietnam-evisa')
  })

  it('excludes the marketplace SEO pages that ARE live on eno.vn', () => {
    const m = appRootSegments(MARKETPLACE)
    for (const seg of ['moving-sales-vietnam', 'housing-vietnam-expats',
      'motorbikes-for-sale-vietnam', 'jobs-vietnam-expats', 'llms.txt', 'openapi.json']) {
      expect(m, seg).toContain(seg)
    }
  })

  /**
   * ⛔ FOUND BY REVIEW, NOT BY ME. Root METADATA FILES are routes with no directory for the walk to
   * find, and every one of them contains a dot — so they are not handle-shaped and the rewrite
   * would claim them. An earlier map listed only `favicon.ico`; `icon.svg` and `apple-icon.png`
   * both exist here and would have answered a false markdown 404.
   */
  it('never claims a root metadata file route', () => {
    const m = appRootSegments(MARKETPLACE)
    const caught = matcher(m)
    for (const f of ['favicon.ico', 'icon.svg', 'apple-icon.png', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml']) {
      expect(m, f).toContain(f)
      expect(caught(`/${f}`), f).toBe(false)
    }
  })

  it('never claims a handle-shaped path (a storefront may exist; only the DB knows)', () => {
    const caught = matcher(appRootSegments(SERVICES))
    for (const h of ['vietkite', 'eno_visa', 'alex_doe', 'shop99', 'abc']) {
      expect(caught(`/${h}`), h).toBe(false)
    }
  })

  it('claims paths that can be neither a page nor a handle', () => {
    const caught = matcher(appRootSegments(SERVICES))
    // The audit's own verification command is the first of these.
    for (const junk of ['some-path-that-does-not-exist', 'nope-xyz', 'v1', 'THISISUPPER', 'ab']) {
      expect(caught(`/${junk}`), junk).toBe(true)
    }
  })

  it('never claims a nested path (single segment only)', () => {
    expect(matcher(appRootSegments(SERVICES))('/nope/xyz/abc')).toBe(false)
  })

  it('FAILS SAFE: an unreadable app dir disables the rewrite instead of claiming everything', () => {
    expect(appRootSegments(MARKETPLACE, '/definitely/not/a/dir')).toEqual([])
    const caught = matcher([])
    for (const p of ['/anything', '/some-path-that-does-not-exist', '/vietkite']) {
      expect(caught(p), p).toBe(false)
    }
  })
})
