import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_ICON_NAMES, hasUiIcon, uiIconPath } from '@/lib/ui-icons'

/**
 * THE CHECK THAT KEEPS THE UI GLYPHS USABLE.
 *
 * `scripts/gen-icons.mjs` writes eighty files from the official Solar set and `ui-icons.ts` keeps
 * a copy of their names so a call site does not import the generator. Two artefacts that have to
 * agree, and nothing about editing one makes you edit the other — so this suite stats
 * `public/icons/ui/**` and parses the bytes rather than testing the copy against itself.
 *
 * ⚠️ IT EXISTS BECAUSE THE CATEGORY SUITE DOES NOT COVER THESE. `category-art.test.ts` checks the
 * seventeen tiles only; the forty UI glyphs shipped with no equivalent guard, and the gap was
 * immediately observable — `attach` was mapped to Solar's `paperclip`, whose Outline and Bold are
 * the SAME DRAWING, so its selected state rendered identically to its resting one. That is a
 * control that looks broken when tapped, and no existing test could see it.
 */
const DIR = fileURLToPath(new URL('../../public/icons/ui', import.meta.url))
const read = (state: string, name: string) => readFileSync(join(DIR, state, `${name}.svg`), 'utf8')
const STATES = ['rest', 'selected'] as const

describe('the UI glyph set is complete', () => {
  it('has no duplicates', () => {
    expect(new Set(UI_ICON_NAMES).size).toBe(UI_ICON_NAMES.length)
  })

  it('returns null for an unknown name rather than a path that 404s', () => {
    expect(uiIconPath('definitely-not-a-glyph', 'rest')).toBeNull()
    expect(hasUiIcon('definitely-not-a-glyph')).toBe(false)
    expect(uiIconPath('search', 'selected')).toBe('/icons/ui/selected/search.svg')
  })

  it.each(STATES)('%s: every declared name has a file', (state) => {
    for (const name of UI_ICON_NAMES) {
      expect(uiIconPath(name, state)).toBe(`/icons/ui/${state}/${name}.svg`)
      // Re-run `npm run icons` if this fails.
      expect(existsSync(join(DIR, state, `${name}.svg`)), `missing ui/${state}/${name}.svg`).toBe(true)
    }
  })

  it.each(STATES)('%s: holds these files and nothing else', (state) => {
    // A name renamed in the generator's table leaves its old file behind, and an orphan is
    // artwork that nothing renders and nobody will notice is stale. Dotfiles are carved out for
    // the same reason as the category suite: `.DS_Store` must not turn the build red for everyone.
    const onDisk = readdirSync(join(DIR, state))
      .filter((f) => !f.startsWith('.'))
      .sort()
    expect(onDisk).toEqual([...UI_ICON_NAMES].sort().map((n) => `${n}.svg`))
  })
})

describe('the UI glyphs honour the two-weight contract', () => {
  it('rest and selected are different drawings, for every name', () => {
    // ⚠️ THE ONE THAT ALREADY CAUGHT A REAL BUG. 55 of Solar's 1,246 glyphs — every `link*`,
    // `list*`, `undo*`, `paperclip` — are drawn IDENTICALLY in Outline and Bold, because a
    // line-only mark has no interior for Bold to fill. Solar's own files differ by a `class`
    // attribute the generator strips, so upstream the collision is invisible and downstream it is
    // total: the control's active state looks exactly like its resting state.
    for (const name of UI_ICON_NAMES) {
      expect(read('selected', name), `${name} renders the same at rest and selected`).not.toEqual(
        read('rest', name)
      )
    }
  })

  it.each(STATES)('%s: one 24-grid svg root per file', (state) => {
    for (const name of UI_ICON_NAMES) {
      const svg = read(state, name)
      expect(svg.startsWith('<svg '), `${state}/${name}`).toBe(true)
      expect(svg.match(/<svg\b/g)).toHaveLength(1)
      expect(svg, `${state}/${name}`).toContain('viewBox="0 0 24 24"')
    }
  })

  it.each(STATES)('%s: colour comes from currentColor, never a baked value', (state) => {
    for (const name of UI_ICON_NAMES) {
      const svg = read(state, name)
      expect(svg, `${state}/${name}`).toContain('fill="currentColor"')
      expect(svg, `${state}/${name}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(svg, `${state}/${name}`).not.toMatch(/\b(?:rgb|hsl|oklch)\(/)
      expect(svg, `${state}/${name}`).not.toMatch(/opacity/i)
      // Solar names its own files by style; ours should not carry the vendor's grammar.
      expect(svg, `${state}/${name}`).not.toMatch(/\sclass=/)
    }
  })

  it.each(STATES)('%s: carries nothing that executes or fetches once inlined', (state) => {
    // These are meant to be inlined, which makes them markup rather than an image: a script, an
    // event handler, a <use href> or a url() would run with the PAGE's authority. The generator
    // allow-lists elements and attributes; this checks the bytes that actually ship, so widening
    // that list without thinking fails here.
    for (const name of UI_ICON_NAMES) {
      const svg = read(state, name)
      expect(svg, `${state}/${name}`).not.toMatch(/<(?:script|foreignObject|image|use|animate|set|style)\b/i)
      expect(svg, `${state}/${name}`).not.toMatch(/\son[a-z]+\s*=/i)
      expect(svg, `${state}/${name}`).not.toMatch(/\s(?:style|href|xlink:href|src)\s*=/i)
      expect(svg, `${state}/${name}`).not.toMatch(/url\s*\(/i)
    }
  })
})
