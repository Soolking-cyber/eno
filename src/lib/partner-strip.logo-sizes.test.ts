// @vitest-environment node
/**
 * The strip's logos at the heights it paints them (PARTNER_LOGO_HEIGHTS, SEO Site Checkup 2026-11-24 "Resize oversized
 * images"). Fails when a roster logo's variant is missing or the wrong height — run scripts/gen-partner-logo-sizes.mjs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PARTNER_LOGO_HEIGHTS, PARTNER_STRIP, partnerLogoSrcSet } from './partner-strip'

const PUBLIC = join(__dirname, '../../public')
// The heights globals.css paints a mark at: `.partner-strip-logo` 1.75rem, `.partner-strip-logo-wide` 1.25rem (the top
// band; the phone lane's wide mark is 1.125rem).
const PAINTED = { square: 28, wide: 20 } as const
const candidates = (srcset: string) => srcset.split(', ').map((c) => { const [url, d] = c.split(' '); return { url, density: Number(d.replace('x', '')) } })

describe('partner logo sizes', () => {
  it('every roster logo offers 1x, 2x and 3x, each at least as tall as the strip paints it at that density', async () => {
    for (const p of PARTNER_STRIP) {
      const list = candidates(partnerLogoSrcSet(p))
      expect(list.map((c) => c.density), p.handle).toEqual([1, 2, 3])
      for (const c of list) {
        const file = join(PUBLIC, c.url)
        expect(existsSync(file), `${c.url} — run node scripts/gen-partner-logo-sizes.mjs`).toBe(true)
        const { width, height } = await sharp(file).metadata()
        const wanted = /-h(\d+)\.webp$/.exec(c.url)
        expect(height, c.url).toBe(wanted ? Number(wanted[1]) : p.logo.height)
        // The original's shape: a copy left from a replaced logo (a different mark) fails here, not on a visitor's screen.
        expect(Math.abs(width! - (p.logo.width * height!) / p.logo.height), `${c.url} — stale? re-run the script`).toBeLessThanOrEqual(1)
        expect(height!, c.url).toBeGreaterThanOrEqual(PAINTED[p.size] * c.density)
      }
    }
  })

  it('PAINTED is what globals.css paints (a taller mark needs taller copies)', () => {
    const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
    const rem = (cls: string) => Number(new RegExp(`^\\.${cls} \\{ display: block; height: ([\\d.]+)rem;`, 'm').exec(css)?.[1]) * 16
    expect({ square: rem('partner-strip-logo'), wide: rem('partner-strip-logo-wide') }).toEqual(PAINTED)
  })

  it('a 1x screen gets a file at most 1.5x the painted height (the checker\'s "oversized")', () => {
    for (const size of ['square', 'wide'] as const) expect(PARTNER_LOGO_HEIGHTS[size][0] / PAINTED[size]).toBeLessThanOrEqual(1.5)
  })

  it('the generator\'s heights are these heights', async () => {
    const src = (await import('node:fs')).readFileSync(join(__dirname, '../../scripts/gen-partner-logo-sizes.mjs'), 'utf8')
    expect(src).toContain(`const HEIGHTS = { wide: [${PARTNER_LOGO_HEIGHTS.wide.join(', ')}], square: [${PARTNER_LOGO_HEIGHTS.square.join(', ')}] }`)
  })
})
