import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_ART_FULL_WIDTH, CATEGORY_ART_WIDTHS, categoryArtSrcSet } from './category-art'

/**
 * The smaller copies of the category artwork (owner 2026-11-27, SEO Site Checkup "Responsive Image Test"): the home
 * rail asks for them by `sizes`, so a slug without its copies would show a broken image at that width.
 */
describe('category art size copies', () => {
  const DIR = 'public/icons/categories'
  const slugs = readdirSync(DIR).filter((f) => /^[a-z-]+\.webp$/.test(f)).map((f) => f.replace(/\.webp$/, ''))

  it('every slug has every width in WebP and AVIF (re-run scripts/gen-category-art-sizes.mjs)', () => {
    expect(slugs.length).toBeGreaterThan(10)
    const missing = slugs.flatMap((s) => CATEGORY_ART_WIDTHS.flatMap((w) => ['webp', 'avif'].map((x) => `${s}-${w}.${x}`))).filter((f) => !existsSync(`${DIR}/${f}`))
    expect(missing).toEqual([])
  })

  it('the copies were made from the CURRENT originals (redrawn pack → re-run the generator)', () => {
    const source = JSON.parse(readFileSync(`${DIR}/sizes-source.json`, 'utf8')) as Record<string, string>
    const stale = slugs.filter((s) => source[s] !== createHash('sha256').update(readFileSync(`${DIR}/${s}.webp`)).digest('hex').slice(0, 16))
    expect(stale, 'run node scripts/gen-category-art-sizes.mjs').toEqual([])
  })

  it('the generator and the code use the same widths', () => {
    const script = readFileSync('scripts/gen-category-art-sizes.mjs', 'utf8')
    expect(/const WIDTHS = \[([\d, ]+)\]/.exec(script)?.[1].split(',').map(Number)).toEqual([...CATEGORY_ART_WIDTHS])
  })

  it('srcset keeps the cache stamp on every candidate and ends with the full-size file', () => {
    const set = categoryArtSrcSet('/icons/categories/rentals.avif?v=abc12345')
    const parts = set.split(', ')
    expect(parts).toHaveLength(CATEGORY_ART_WIDTHS.length + 1)
    for (const p of parts) expect(p).toMatch(/^\/icons\/categories\/rentals(-\d+)?\.avif\?v=abc12345 \d+w$/)
    expect(parts.at(-1)).toBe(`/icons/categories/rentals.avif?v=abc12345 ${CATEGORY_ART_FULL_WIDTH}w`)
  })
})
