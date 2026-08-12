import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAXONOMY } from '@/lib/taxonomy'
import { NAV_CATEGORIES } from '@/lib/taxonomy-nav'
import {
  CATEGORY_ART_NON_TAXONOMY_SLUGS,
  CATEGORY_ART_SLUGS,
  categoryArtPath,
  hasCategoryArt,
} from '@/lib/category-art'

/**
 * THE CHECK THAT STOPS A CATEGORY SHIPPING WITH NO ARTWORK.
 *
 * `category-art.ts` copies fifteen slugs out of `TAXONOMY` so a client tile does not drag a 70 KB
 * module into its bundle, and `scripts/gen-icons.mjs` writes the SVGs those slugs name.
 * That is three artefacts that have to agree — the taxonomy, the copy, and the files on disk — and
 * nothing about editing one of them makes you edit the others.
 *
 * ⚠️ SO THIS SUITE READS THE REAL FILES. It is not a test of the copy against itself; it stats
 * `public/icons/**` and parses the bytes. A category added to `taxonomy.ts` fails here until the
 * generator is re-run, a slug renamed in the generator fails here until this module follows, and a
 * hand-edit that reintroduces an opacity or a baked hex fails here too. Skipping the
 * generator is the likeliest mistake by a distance — it is a manual step, and its output is a
 * directory nobody opens.
 */
const ICONS = fileURLToPath(new URL('../../public/icons', import.meta.url))
const read = (state: string, slug: string) => readFileSync(join(ICONS, state, `${slug}.svg`), 'utf8')

/** The drawing elements in a fragment, with their paint attributes removed — the geometry alone. */
const leaves = (svg: string) =>
  (svg.match(/<(?:path|circle|rect|ellipse|line|polyline|polygon)\b[^>]*\/>/g) ?? [])
    .map((el) => el.replace(/\s(?:fill|stroke)="[^"]*"/g, ''))

describe('category art covers the taxonomy', () => {
  it('carries every top-level category slug, in TAXONOMY order', () => {
    // Order matters only for review: the generator's mapping table reads in this order, so keeping
    // them aligned is what lets a reviewer diff the two by eye.
    expect(CATEGORY_ART_SLUGS.slice(0, TAXONOMY.length)).toEqual(TAXONOMY.map((c) => c.slug))
  })

  it('agrees with the footer projection too', () => {
    // NAV_CATEGORIES is itself a checked copy of TAXONOMY; asserting against both means a future
    // refactor that replaces one source cannot quietly take this file's guarantee with it.
    for (const c of NAV_CATEGORIES) expect(hasCategoryArt(c.slug)).toBe(true)
  })

  it('adds exactly the two tiles that are not categories, and nothing else', () => {
    const taxonomySlugs = new Set(TAXONOMY.map((c) => c.slug))
    const extra = CATEGORY_ART_SLUGS.filter((s) => !taxonomySlugs.has(s))
    // 'free' is the one INTENT_SHORTCUTS entry; 'all' is the browse rail's filter-reset tile.
    // Anything else here is artwork no tile can reach, or a typo for a real slug.
    expect(extra).toEqual([...CATEGORY_ART_NON_TAXONOMY_SLUGS])
  })

  it('has no duplicates', () => {
    expect(new Set(CATEGORY_ART_SLUGS).size).toBe(CATEGORY_ART_SLUGS.length)
  })

  it('returns null for a subcategory key rather than a broken path', () => {
    // The ~81 subcategory glyphs stay on lucide and are addressed by registry KEY, not slug. A
    // caller must be able to tell "no artwork" from "artwork at a 404".
    expect(categoryArtPath('Armchair', 'rest')).toBeNull()
    expect(categoryArtPath('strollers-seats', 'selected')).toBeNull()
    expect(hasCategoryArt('Armchair')).toBe(false)
  })
})

describe('the generated files exist and match the manifest', () => {
  it.each(['rest', 'selected'] as const)('%s: every declared slug has a file', (state) => {
    for (const slug of CATEGORY_ART_SLUGS) {
      const path = categoryArtPath(slug, state)
      expect(path).toBe(`/icons/${state}/${slug}.svg`)
      // Re-run `npm run icons` if this fails.
      expect(existsSync(join(ICONS, state, `${slug}.svg`)), `missing ${state}/${slug}.svg`).toBe(true)
    }
  })

  it.each(['rest', 'selected'] as const)('%s: holds these files and nothing else', (state) => {
    // A slug renamed in the generator's table leaves its old file behind unless the prune runs, and
    // an orphan is artwork that nothing renders and nobody will notice is stale.
    // ⚠️ THE WHOLE DIRECTORY, NOT JUST THE `.svg` IN IT. Filtering to `.svg` made this test blind to
    // the one artefact the generator can actually leave behind — a `<slug>.svg.tmp` from a run
    // killed between the write and the rename, which would otherwise be committed and then SERVED,
    // since everything under public/ is site-root-addressable.
    //
    // ⚠️ EXCEPT DOTFILES, AND THAT CARVE-OUT IS DELIBERATE. Demanding the directory hold EXACTLY
    // seventeen names turns "someone opened public/icons/rest in Finder" into a red suite for the
    // whole team — macOS writes `.DS_Store`, the generator's prune will not remove it, and
    // re-running the generator therefore cannot fix it. A test nobody can fix by doing the obvious
    // thing gets deleted. `.tmp` is NOT carved out: that one is ours and it must never survive.
    const onDisk = readdirSync(join(ICONS, state)).filter((f) => !f.startsWith('.')).sort()
    expect(onDisk).toEqual([...CATEGORY_ART_SLUGS].sort().map((s) => `${s}.svg`))
  })
})

describe('the artwork honours the monotone contract', () => {
  it.each(['rest', 'selected'] as const)('%s: one 24-grid svg root per file', (state) => {
    for (const slug of CATEGORY_ART_SLUGS) {
      const svg = read(state, slug)
      expect(svg.startsWith('<svg '), `${state}/${slug}`).toBe(true)
      expect(svg.match(/<svg\b/g)).toHaveLength(1)
      expect(svg).toContain('viewBox="0 0 24 24"')
    }
  })

  it.each(['rest', 'selected'] as const)('%s: no opacity, so these stay monotone', (state) => {
    // Outline and Bold carry no opacity upstream — unlike Line Duotone, which encodes its second
    // tone entirely as opacity=".5" and which an earlier revision had to strip. Nothing here
    // should ever need stripping again, so any opacity means a wrong style was read.
    // ⚠️ MATCH THE WORD, NOT `opacity=`. A reviewer's catch: `opacity = ".5"` and
    // `style="opacity:.5"` are both valid SVG and both slipped past the narrower pattern, which
    // made this test weaker than the generator check it is supposed to back up. Nothing legitimate
    // in these files contains the string at all.
    for (const slug of CATEGORY_ART_SLUGS) {
      expect(read(state, slug), `${state}/${slug}`).not.toMatch(/opacity/i)
    }
  })

  it.each(['rest', 'selected'] as const)('%s: colour comes from currentColor, never a baked hex', (state) => {
    // A hex here would be wrong in one of the two themes forever: --brand-100 is a pale blue in
    // light mode and a dark slate in dark mode.
    for (const slug of CATEGORY_ART_SLUGS) {
      const svg = read(state, slug)
      expect(svg, `${state}/${slug}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(svg, `${state}/${slug}`).not.toMatch(/\b(?:rgb|hsl|oklch)\(/)
      // Solar paints both weights as FILLED paths — Outline is an outline converted to a fill,
      // not a stroke — so the ink attribute is `fill`, and it is already `currentColor` upstream.
      expect(svg, `${state}/${slug}`).toContain('fill="currentColor"')
    }
  })

  it('carries no trace of the deleted tint layer', () => {
    // ⛔ The selected state used to be built here: the same paths twice, a `cat-art-body` layer
    // under a `cat-art-ink` layer, lit by a CSS rule that was never added because two of the
    // seventeen came out half-filled. Solar's Bold weight replaced all of it. If these class
    // names reappear, someone has rebuilt the mechanism the source already provides.
    for (const state of ['rest', 'selected'] as const) {
      for (const slug of CATEGORY_ART_SLUGS) {
        expect(read(state, slug), `${state}/${slug}`).not.toMatch(/cat-art-(?:body|ink)/)
      }
    }
  })

  it('rest and selected are two different Solar weights, not one file copied', () => {
    // ⚠️ THE FAILURE THIS CATCHES IS A HALF-LANDED MAPPING. If a row's Bold file were missing and
    // the generator fell back to Outline, a selected tile would render identically to its resting
    // twin — which looks like "the tap did nothing", and no other assertion here would notice.
    for (const slug of CATEGORY_ART_SLUGS) {
      expect(read('selected', slug), slug).not.toEqual(read('rest', slug))
    }
  })

  it('is one filled path per glyph, with nothing left to recolour', () => {
    // The whole point of taking the official weights: no stroke to scale, no opacity to strip, no
    // colour to rewrite. `currentColor` means a tile's own text colour drives the ink in both
    // themes, exactly like the lucide glyph it replaces.
    for (const state of ['rest', 'selected'] as const) {
      for (const slug of CATEGORY_ART_SLUGS) {
        const svg = read(state, slug)
        for (const el of leaves(svg)) expect(el, `${state}/${slug}`).toMatch(/^<path\b/)
        expect(svg, `${state}/${slug}`).not.toMatch(/stroke="(?!none)[^"]+"/)
        // Solar's own class names it by style; ours should not carry the vendor's grammar.
        expect(svg, `${state}/${slug}`).not.toMatch(/\sclass=/)
      }
    }
  })

  it('ships its CC BY attribution beside the artwork', () => {
    // ⚠️ THE LICENCE OBLIGATION IS PART OF THE ARTEFACT, so it gets a test rather than a habit.
    // Solar is CC BY 4.0: we may ship it commercially and modify it, in exchange for crediting the
    // creator, linking the licence and saying that we changed it. A NOTICE that loses any of those
    // makes the SVGs beside it unlicensed.
    const notice = readFileSync(join(ICONS, 'NOTICE.md'), 'utf8')
    expect(notice).toContain('480 Design')
    expect(notice).toContain('https://creativecommons.org/licenses/by/4.0/')
    expect(notice).toMatch(/CC BY 4\.0/)
    // The provenance block the generator rewrites — a digest of the exact source bytes, which is
    // the only thing tying these files to the set they claim to come from.
    expect(notice).toMatch(/sha256\s+[0-9a-f]{64}/)
    expect(notice).toContain('<!-- provenance:begin -->')
  })

  it('carries nothing that executes or fetches once inlined', () => {
    // These files are meant to be inlined into the page, which makes them markup rather than an
    // image: a script, an event handler, a <use href> or a url() would run with the page's
    // authority. The generator allow-lists elements and attributes; this checks the output that
    // actually ships, so widening that list without thinking fails here.
    for (const state of ['rest', 'selected'] as const) {
      for (const slug of CATEGORY_ART_SLUGS) {
        const svg = read(state, slug)
        expect(svg, `${state}/${slug}`).not.toMatch(/<(?:script|foreignObject|image|use|animate|set|style)\b/i)
        expect(svg, `${state}/${slug}`).not.toMatch(/\son[a-z]+\s*=/i)
        expect(svg, `${state}/${slug}`).not.toMatch(/\s(?:style|href|xlink:href|src)\s*=/i)
        expect(svg, `${state}/${slug}`).not.toMatch(/url\s*\(/i)
      }
    }
  })
})
