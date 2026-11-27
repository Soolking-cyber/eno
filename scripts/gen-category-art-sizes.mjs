#!/usr/bin/env node
/**
 * Smaller copies of the category artwork for `srcset` (SEO Site Checkup "Responsive Image Test", owner 2026-11-27: the
 * home rail drew each 184px render at 26–52px, so every visitor downloaded 3–7× the pixels shown).
 *
 * Derived from the 184px files already in public/icons/categories (scripts/gen-category-art.mjs makes those from the
 * owner's icon pack, which is not in the repo) — so re-run THIS after that one: `node scripts/gen-category-art-sizes.mjs`.
 * src/lib/category-art-sizes.test.ts fails while any slug lacks a size.
 * Writes <slug>-<w>.webp and <slug>-<w>.avif for every width in CATEGORY_ART_WIDTHS; never touches the 184px originals.
 * Records each original's hash in sizes-source.json: the copies share CATEGORY_ART_STAMP, so a redrawn original with stale
 * copies would serve the OLD drawing under the NEW stamp for a year — the test compares the hashes (commit gate, opus).
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const DIR = join(process.cwd(), 'public/icons/categories')
// Keep in sync with CATEGORY_ART_WIDTHS in src/lib/category-art.ts (the test checks both ways).
const WIDTHS = [48, 64, 96, 128]

const bases = readdirSync(DIR).filter((f) => /^[a-z-]+\.webp$/.test(f)).map((f) => f.replace(/\.webp$/, ''))
let n = 0
const source = {}
for (const slug of bases) {
  const src = join(DIR, `${slug}.webp`)
  source[slug] = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 16)
  for (const w of WIDTHS) {
    const img = () => sharp(src).resize(w, w, { fit: 'contain', kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    await img().webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(join(DIR, `${slug}-${w}.webp`))
    await img().avif({ quality: 50, effort: 6 }).toFile(join(DIR, `${slug}-${w}.avif`))
    n += 2
  }
}
writeFileSync(join(DIR, 'sizes-source.json'), JSON.stringify(source, null, 1) + '\n')
console.log(`category art sizes: ${bases.length} slugs × ${WIDTHS.length} widths × 2 formats = ${n} files`)
