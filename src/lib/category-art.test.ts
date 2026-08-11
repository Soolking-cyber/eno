import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAXONOMY } from '@/lib/taxonomy'
import { NAV_CATEGORIES } from '@/lib/taxonomy-nav'
import {
  CATEGORY_ART_BODY_CLASS,
  CATEGORY_ART_INK_CLASS,
  CATEGORY_ART_NON_TAXONOMY_SLUGS,
  CATEGORY_ART_SLUGS,
  categoryArtPath,
  hasCategoryArt,
} from '@/lib/category-art'

/**
 * THE CHECK THAT STOPS A CATEGORY SHIPPING WITH NO ARTWORK.
 *
 * `category-art.ts` copies fifteen slugs out of `TAXONOMY` so a client tile does not drag a 70 KB
 * module into its bundle, and `scripts/gen-category-icons.mjs` writes the SVGs those slugs name.
 * That is three artefacts that have to agree — the taxonomy, the copy, and the files on disk — and
 * nothing about editing one of them makes you edit the others.
 *
 * ⚠️ SO THIS SUITE READS THE REAL FILES. It is not a test of the copy against itself; it stats
 * `public/icons/**` and parses the bytes. A category added to `taxonomy.ts` fails here until the
 * generator is re-run, a slug renamed in the generator fails here until this module follows, and a
 * hand-edit that reintroduces a duotone opacity or a baked hex fails here too. Skipping the
 * generator is the likeliest mistake by a distance — it is a manual step, and its output is a
 * directory nobody opens.
 */
const ICONS = fileURLToPath(new URL('../../public/icons', import.meta.url))
const read = (state: string, slug: string) => readFileSync(join(ICONS, state, `${slug}.svg`), 'utf8')

/** The drawing elements in a fragment, with their paint attributes removed — the geometry alone, so
 *  the tint layer and the ink layer can be compared element for element. */
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
      // Re-run `node scripts/gen-category-icons.mjs` if this fails.
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

  it.each(['rest', 'selected'] as const)('%s: no opacity survives — that IS the duotone', (state) => {
    // Solar's Line Duotone encodes its second tone entirely as opacity=".5". Stripping it is what
    // makes these monotone, so a surviving opacity attribute means the strip regressed.
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
      expect(svg, `${state}/${slug}`).toContain('stroke="currentColor"')
    }
  })

  it('rest is a single unpainted ink line', () => {
    for (const slug of CATEGORY_ART_SLUGS) {
      const svg = read('rest', slug)
      expect(svg, slug).not.toContain(CATEGORY_ART_BODY_CLASS)
      expect(svg, slug).not.toContain(CATEGORY_ART_INK_CLASS)
    }
  })

  it('selected is the same glyph twice: a tintable body under the ink', () => {
    for (const slug of CATEGORY_ART_SLUGS) {
      const svg = read('selected', slug)
      expect(svg, slug).toContain(`class="${CATEGORY_ART_BODY_CLASS}"`)
      expect(svg, slug).toContain(`class="${CATEGORY_ART_INK_CLASS}"`)
      // Order is load-bearing: SVG paints in document order, so the ink must come SECOND or the
      // tint covers the line and every glyph turns into a solid blob.
      expect(svg.indexOf(CATEGORY_ART_BODY_CLASS), slug).toBeLessThan(svg.indexOf(CATEGORY_ART_INK_CLASS))
      // The body ships invisible; the class is the only hook. Without this a missing CSS rule
      // would render a solid silhouette instead of degrading to the resting outline.
      expect(svg, slug).toContain(`class="${CATEGORY_ART_BODY_CLASS}" fill="none" stroke="none"`)
    }
  })

  it('selected traces rest — the tint follows the ink, path for path', () => {
    // ⚠️ THE TINT STROKE MUST MATCH THE INK STROKE EXACTLY, or the body paints OUTSIDE the line and
    // every glyph wears a pale halo — the regression documented at length in category-icons.tsx
    // ("make sure icons dont have outline, fill only inside"). Both layers come from one source so
    // it holds by construction; this asserts the construction by stripping the ink layer's own
    // paint attributes and demanding the body be exactly those elements, in order.
    for (const slug of CATEGORY_ART_SLUGS) {
      const selected = read('selected', slug)
      const [head, tail] = selected.split(`<g class="${CATEGORY_ART_INK_CLASS}">`)
      const inkLeaves = leaves(tail)
      const bodyLeaves = leaves(head)
      expect(inkLeaves.length, slug).toBeGreaterThan(0)
      // A subsequence, not equality: a path may be held OUT of the tint (see the next test), but
      // one may never be added, reshaped or re-stroked.
      expect(inkLeaves.filter((el) => bodyLeaves.includes(el)), slug).toEqual(bodyLeaves)
      // …and the ink layer is the resting glyph, unaltered.
      expect(leaves(read('rest', slug)), slug).toEqual(inkLeaves)
    }
  })

  it('holds the measured decoration paths out of the tint — by identity, not by count', () => {
    // ⚠️ PINNED BECAUSE THE ARTEFACT IS INVISIBLE IN CODE AND OBVIOUS ON SCREEN. Filling an OPEN
    // path implicitly closes it: the scooter's steering column becomes a solid wedge across the
    // rider's space, and the community glyph's flanking arcs become crescents beside the centre
    // figure. Both were found by rendering at tile size, and a regression would be found the same
    // way — i.e. not at all, unless something asserts it. Same exclusion, same reason, as
    // FILL_EXCLUDE in category-icons.tsx.
    //
    // ⚠️ ASSERT WHICH PATH, NOT HOW MANY. An earlier version compared child COUNTS, and a reviewer
    // pointed out that this is exactly the check a reordered upstream glyph passes: 4 < 5 still
    // holds while the wheel goes untinted and the steering column fills. The `d` prefixes below
    // are the same pins the generator checks; here they guard the bytes that actually ship.
    const excluded: Record<string, string[]> = {
      vehicles: ['M12 5h.528'], // the steering column
      'community-events': ['M18 9c1.657', 'M20 19c1.754'], // the two flanking figures
    }
    for (const slug of CATEGORY_ART_SLUGS) {
      const [head, tail] = read('selected', slug).split(`<g class="${CATEGORY_ART_INK_CLASS}">`)
      const missing = leaves(tail).filter((el) => !leaves(head).includes(el))
      const pins = excluded[slug] ?? []
      expect(missing, slug).toHaveLength(pins.length)
      for (const pin of pins) expect(missing.some((el) => el.includes(`d="${pin}`)), `${slug} must hold ${pin} out of the tint`).toBe(true)
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
