import { describe, expect, it } from 'vitest'
import { brandLogoFit, brandLogoUrl, isFullSvgLogo } from './brand-logo-url'

/**
 * ⛔ THE FAILURE THIS GUARDS IS SILENT AND TOTAL. `BrandLogo` paints the mark as a CSS mask over
 * `bg-current`; if the URL is wrong the mask resolves to nothing and the logo renders as EMPTY
 * SPACE, not as a broken image. Nobody gets a console error and the page still looks plausible.
 */
describe('brandLogoUrl', () => {
  const svg = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

  it('returns null when there is no curated logo, so BrandLogo keeps its old path', () => {
    expect(brandLogoUrl({ slug: 'acme' })).toBeNull()
    expect(brandLogoUrl({ slug: 'acme', logoPath: null })).toBeNull()
    expect(brandLogoUrl({ slug: 'acme', logoPath: '   ' })).toBeNull()
  })

  /** simple-icons path data is a bare `d` attribute — one short string, cheap to inline, and NOT a
   *  document this route could serve. It must keep the existing inline path. */
  it('returns null for simple-icons path data rather than treating it as a document', () => {
    expect(brandLogoUrl({ slug: 'acme', logoPath: 'M12 0C5.37 0 0 5.37 0 12' })).toBeNull()
    expect(isFullSvgLogo('M12 0C5.37 0 0 5.37 0 12')).toBe(false)
  })

  it('serves a full <svg> from the route', () => {
    const url = brandLogoUrl({ slug: 'acme', logoPath: svg })
    expect(url).toMatch(/^\/api\/brand-logo\/acme\?v=[a-z0-9]+$/)
  })

  /** An XML prolog before the <svg> is common in exported files; BrandLogo already tolerates it, so
   *  the URL builder must agree or the two disagree about whether a logo exists at all. */
  it('accepts an <svg> behind an XML prolog, as BrandLogo does', () => {
    expect(brandLogoUrl({ slug: 'acme', logoPath: `<?xml version="1.0"?>\n${svg}` })).not.toBeNull()
  })

  /**
   * ⛔ THE HASH IS WHAT MAKES `immutable` SAFE. The route answers with
   * `Cache-Control: public, max-age=31536000, immutable`, so if an edited logo produced the SAME
   * URL, browsers and Cloudflare would serve the old mark for a YEAR with no way to purge it short
   * of renaming the brand.
   */
  it('changes the URL when the artwork changes', () => {
    const a = brandLogoUrl({ slug: 'acme', logoPath: svg })
    const b = brandLogoUrl({ slug: 'acme', logoPath: svg.replace('M0 0h24v24H0z', 'M1 1h22v22H1z') })
    expect(a).not.toEqual(b)
  })

  it('is stable for identical artwork, so the cache is not busted on every deploy', () => {
    expect(brandLogoUrl({ slug: 'acme', logoPath: svg })).toEqual(brandLogoUrl({ slug: 'acme', logoPath: svg }))
  })

  /** Slugs come from the database and land in a URL path. */
  it('encodes the slug', () => {
    expect(brandLogoUrl({ slug: 'a b/c', logoPath: svg })).toContain('/api/brand-logo/a%20b%2Fc?v=')
  })
})

/**
 * /brands draws every mark at one optical size (2026-11-06 audit): a wordmark inside a 24×24 simple-icons square came out
 * as a 7px sliver beside a 44px glyph.
 */
describe('brandLogoFit', () => {
  it('crops path data to what it draws, and draws a wordmark wide and short', () => {
    // A 24×4 bar: a wordmark's proportions, drawn mid-artboard as simple-icons draws one.
    const fit = brandLogoFit('M0 10h24v4H0z')!
    expect(fit.viewBox).toBe('0 9.75 24 4.5')
    expect(fit.width).toBeGreaterThan(fit.height * 3)
    expect(fit.width).toBeLessThanOrEqual(112)
  })

  it('keeps a round glyph square and inside the 44px slot', () => {
    const fit = brandLogoFit('M12 0a12 12 0 1 0 0 24a12 12 0 1 0 0-24z')!
    expect(fit.viewBox).toBe('0 0 24 24')
    expect(fit.width).toBe(fit.height)
    expect(fit.height).toBeLessThanOrEqual(44)
  })

  it('⛔ never cuts a mark: an arc’s peak lies inside the box, whatever its radius', () => {
    // A radius-100 arc whose top, (12, 12), is inside the artboard (2026-11-06 review): sampled at 24 points it came
    // out with its top at 12.39, a sliver of the mark outside the viewBox.
    const fit = brandLogoFit('M25.0526 12.8555A100 100 0 1 1 23.3203 12.6428z')!
    const [, top] = fit.viewBox!.split(' ').map(Number)
    expect(top).toBeLessThanOrEqual(12)
  })

  it('sizes a curated <svg> from its own viewBox, and gives it no viewBox to crop', () => {
    const fit = brandLogoFit('<svg viewBox="0 0 200 40"><path d="M0 0h200v40H0z"/></svg>')!
    expect(fit.viewBox).toBeUndefined()
    expect(fit.width / fit.height).toBeCloseTo(5, 0)
  })

  it('returns null — the old square — for anything it cannot read', () => {
    expect(brandLogoFit(null)).toBeNull()
    expect(brandLogoFit('not a path')).toBeNull()
    expect(brandLogoFit('M1 1 2')).toBeNull()
    expect(brandLogoFit('<svg><path d="M0 0h1v1z"/></svg>')).toBeNull()
  })
})
