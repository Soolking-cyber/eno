import { describe, expect, it } from 'vitest'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'

/**
 * Every SEO landing page's `categorySlug` must name a category that actually exists.
 *
 * ⚠️ WHY THIS FILE EXISTS. `categorySlug` is a bare string on `SeoContent`, and `SeoLanding` uses
 * it for two things: the destination of both call-to-action buttons (`/c/${categorySlug}`) and the
 * `where` clause of the listing strip. A slug that names nothing therefore fails SILENTLY and
 * twice — the buttons land on the not-found boundary, and the strip queries a category matching no
 * row so the page renders permanently empty, which looks like "no inventory yet" rather than a bug.
 *
 * Found on 2026-07-27: `housing-vietnam-expats` pointed at `house-rentals` and
 * `motorbikes-for-sale-vietnam` at `motorbike-rentals`. Neither slug has ever existed on this
 * taxonomy — a rename orphaned them and nothing complained, because a string cannot be
 * type-checked against a runtime table.
 *
 * ⚠️ IT SCANS THE SOURCE rather than importing each page's `CONTENT`. That is deliberate: the
 * consts are not exported, and more importantly a scan covers landing pages that DO NOT EXIST YET.
 * An import-based test would have to be edited to cover a new page, which is exactly the moment
 * this check is worth having.
 */
describe('SEO landing pages', () => {
  it('every categorySlug resolves to a real category', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const appDir = join(process.cwd(), 'src/app')
    const pages = readdirSync(appDir)
      .map((entry) => join(appDir, entry, 'page.tsx'))
      .filter((file) => {
        try {
          return statSync(file).isFile()
        } catch {
          return false
        }
      })

    const found: Array<{ file: string; slug: string }> = []
    for (const file of pages) {
      const src = readFileSync(file, 'utf8')
      // Only pages built on the shared primitive; an unrelated `categorySlug` elsewhere is not ours.
      if (!src.includes('SeoLanding')) continue
      for (const match of src.matchAll(/categorySlug:\s*'([^']+)'/g)) {
        found.push({ file: file.replace(process.cwd() + '/', ''), slug: match[1] })
      }
    }

    // A scan that silently matches nothing would pass forever while proving nothing.
    expect(found.length, 'expected to find SEO landing pages with a categorySlug').toBeGreaterThan(0)

    const broken = found.filter((f) => !CATEGORY_BY_SLUG[f.slug])
    expect(
      broken.map((b) => `${b.file} → /c/${b.slug}`),
      'these landing pages point at a category slug that does not exist',
    ).toEqual([])
  })
})
