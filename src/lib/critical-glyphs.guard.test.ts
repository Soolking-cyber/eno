import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRITICAL_GLYPHS } from '../../scripts/critical-icons.mjs'

/**
 * ⛔ THE 404 PAGE MAY ONLY DRAW GLYPHS THAT ARE IN THE CORE SPRITE, AND THIS IS THE GUARD.
 *
 * Next ships a route's `not-found` UI inside the RSC payload of EVERY page under that layout, so one
 * deferred glyph in its decorative motif makes `glyphs-rest.svg` (~188 KB over the wire, 680 KB raw)
 * a dependency of the home, search and saved documents — measured, and the reason the motif was
 * changed on 2026-09-18 to core glyphs instead of promoting six more symbols.
 *
 * ⚠️ THREE REVIEWERS ASKED FOR THIS TEST BY NAME, and they were right to: the fix was a claim in a
 * comment, checked once by hand. Read from the FILES rather than restated here, so adding a glyph to
 * the motif fails this test instead of silently re-binding the deferred sprite.
 */
const NOT_FOUND = join(process.cwd(), 'src/app/[lang]/not-found.tsx')

function motifGlyphs(): string[] {
  const src = readFileSync(NOT_FOUND, 'utf8')
  // ⚠️ FROM THE `[`, NOT FROM `const MOTIF`: the declaration's TYPE is `{ Icon: typeof MapPin; … }`,
  // so a looser match reads "typeof" as a glyph name — it did, on this test's first run.
  const block = src.match(/const MOTIF[^=]*=\s*(\[[\s\S]*?\n\])/)?.[1]
  if (!block) throw new Error('MOTIF list not found in not-found.tsx — update this guard')
  return [...new Set([...block.matchAll(/\{\s*Icon:\s*([A-Za-z0-9]+)/g)].map((m) => m[1]))]
}

/**
 * EVERY glyph the page imports, not only the motif's — a reviewer pointed out that the MOTIF regex
 * guards the decoration and nothing else, while any `<Compass />` elsewhere in the file costs exactly
 * the same deferred sprite.
 */
function importedGlyphs(): string[] {
  const src = readFileSync(NOT_FOUND, 'utf8')
  const line = src.match(/import\s*\{([^}]+)\}\s*from\s*'@\/components\/ui\/icons'/)?.[1]
  if (!line) throw new Error('no icons import in not-found.tsx — update this guard')
  return line.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)
}

describe('the 404 page stays inside the core sprite', () => {
  it('finds the motif it is guarding', () => {
    expect(motifGlyphs().length).toBeGreaterThanOrEqual(8)
  })

  it('draws no glyph that lives in the deferred sprite', () => {
    const critical = new Set(CRITICAL_GLYPHS)
    expect(motifGlyphs().filter((g) => !critical.has(g))).toEqual([])
    expect(importedGlyphs().filter((g) => !critical.has(g))).toEqual([])
  })

  it('guards at least as many glyphs as the motif draws', () => {
    expect(importedGlyphs().length).toBeGreaterThanOrEqual(motifGlyphs().length)
  })

  it('carries the header control that pulled the deferred sprite in by itself', () => {
    // `Download` is the "Get the app" button, painted on arrival on every route of both editions.
    expect(CRITICAL_GLYPHS).toContain('Download')
  })
})

/**
 * ⛔ GLYPHS PAINTED ON ARRIVAL STAY IN THE CORE SPRITE (F-SPRITE, 2026-09-29).
 *
 * The partition above is a one-time DOM measurement, and it drifts the moment a new control ships on
 * a card or in the chrome: measured on production the day this was written, the rental basket's
 * `ClipboardCheck` (every rental card) and the partner CTA's `ArrowUpRight` each bound the whole
 * ~193 KB deferred sprite to the home page, /c/rentals and a partner PDP — for one glyph apiece.
 * So the files whose glyphs paint on ARRIVAL — cards, the tab bar, the header and its search panel —
 * are read here, import by import, and every glyph they import must be critical. Adding a deferred
 * glyph to one of them now fails this test instead of a profile three weeks later.
 * ⚠️ READ FROM THE FILES, and each one must be FOUND to import something, so a moved or renamed
 * import cannot make the block pass vacuously.
 */
const ON_ARRIVAL = [
  'src/components/marketplace/listing-card.tsx',
  'src/components/marketplace/rental-check-toggle.tsx',
  'src/components/marketplace/affiliate-booking.tsx',
  'src/components/marketplace/mobile-nav.tsx',
  'src/components/marketplace/header.tsx',
  // The header's search panel: every glyph added to it rides the core file (W2-SEARCHPANEL-ICONS).
  'src/components/marketplace/search-suggest.tsx',
  'src/components/marketplace/trending-searches.tsx',
]

function iconImports(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), 'utf8')
  const names = [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/components\/ui\/icons["']/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    .filter(Boolean)
  return [...new Set(names)]
}

describe('glyphs painted on arrival stay in the core sprite', () => {
  it.each(ON_ARRIVAL)('%s imports its glyphs from the generated icon set (the guard is not vacuous)', (file) => {
    expect(iconImports(file).length).toBeGreaterThan(0)
  })

  it.each(ON_ARRIVAL)('%s draws no glyph that lives in the deferred sprite', (file) => {
    const critical = new Set(CRITICAL_GLYPHS)
    expect(iconImports(file).filter((g) => !critical.has(g))).toEqual([])
  })

  it('carries the three glyphs that pulled the deferred sprite onto /, /c/rentals and the partner PDP', () => {
    expect(CRITICAL_GLYPHS).toEqual(expect.arrayContaining(['ClipboardCheck', 'Check', 'ArrowUpRight']))
  })
})
