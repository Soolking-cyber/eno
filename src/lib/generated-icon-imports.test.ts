import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHIELD_VERIFIED, TRUST_SHIELD } from '@/generated/ui-art-shields'
import { CATEGORY_GLYPH_SLUGS, UI_ART } from '@/generated/icon-paths'
import { CATEGORY_ART_SLUGS } from '@/lib/category-art'

/**
 * ⛔ THE ICON PATH TABLE STAYS OFF THE FIRST LOAD.
 *
 * `src/generated/icon-paths.ts` held every Solar glyph's geometry in two objects — the category tiles
 * (~71 KB, dead since the tiles went raster) and UI_ART (~118 KB). Two trust badges imported UI_ART
 * to draw two shields, and the category tile imported the other table as a slug registry, so every
 * page with a card shipped a 61 KB-brotli / 186 KB-decoded chunk that was 100% evaluated during
 * hydration. The shields now come from their own module and the tiles from a slug set; this suite is
 * what keeps a new call site from quietly importing the whole table back.
 */
const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'generated' || name === 'node_modules') continue
      sourceFiles(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/**
 * What an app module may take from icon-paths: the slug registry and the TYPES. Anything else — UI_ART
 * by name, a namespace or default import, a re-export — can put the whole path table in a bundle.
 * Matched on any specifier ending in `generated/icon-paths` (alias or relative), not one spelling.
 */
const ALLOWED = new Set(['CATEGORY_GLYPH_SLUGS', 'IconPath', 'IconArt'])
// The clause excludes quotes so one match can never swallow the PREVIOUS import (this repo writes no
// semicolons, so `[^;]*` would run straight through `… from '@/lib/x'\nimport { … }`).
const FROM_ICON_PATHS = /\b(import|export)\s+(type\s+)?([^'";]*?)\s+from\s*['"][^'"]*generated\/icon-paths(?:\.ts)?['"]/g

function iconPathsViolations(source: string): string[] {
  const bad: string[] = []
  for (const m of source.matchAll(FROM_ICON_PATHS)) {
    const [whole, kind, typeOnly, clause] = m
    if (typeOnly) continue // `import type { … }` is erased — it ships nothing
    const braced = clause.trim().match(/^\{([\s\S]*)\}$/)
    if (kind === 'export' || !braced) { bad.push(whole.replace(/\s+/g, ' ')); continue }
    for (const spec of braced[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue
      const name = spec.split(/\s+as\s+/)[0].trim()
      if (!ALLOWED.has(name)) bad.push(name)
    }
  }
  return bad
}

describe('no app module imports the whole UI glyph table', () => {
  it('the matcher catches every way of pulling the table in (so a green run means something)', () => {
    expect(iconPathsViolations(`import { UI_ART } from '@/generated/icon-paths'`)).toEqual(['UI_ART'])
    expect(iconPathsViolations(`import { UI_ART as A, CATEGORY_GLYPH_SLUGS } from '../../generated/icon-paths'`)).toEqual(['UI_ART'])
    expect(iconPathsViolations(`import * as art from '@/generated/icon-paths'`)).toHaveLength(1)
    expect(iconPathsViolations(`export { UI_ART } from '@/generated/icon-paths.ts'`)).toHaveLength(1)
    expect(iconPathsViolations(`import { CATEGORY_GLYPH_SLUGS, type IconArt } from '@/generated/icon-paths'`)).toEqual([])
    expect(iconPathsViolations(`import type { IconArt } from '@/generated/icon-paths'`)).toEqual([])
  })

  it('nothing under src/ takes more than the slug registry from icon-paths (tests and generated output aside)', () => {
    const offenders = sourceFiles(SRC)
      .map((f) => ({ file: relative(process.cwd(), f), bad: iconPathsViolations(readFileSync(f, 'utf8')) }))
      .filter((o) => o.bad.length)
    // Need a glyph's paths? Emit it into its own small module from scripts/gen-icons.mjs (see SHIELDS there).
    expect(offenders).toEqual([])
  })
})

describe('the generated modules agree with the generator', () => {
  it('the committed shields are byte-for-byte the UI_ART rows they were cut from', () => {
    // ui-art-shields.ts is COMMITTED while icon-paths.ts is regenerated on every build — so a Solar
    // bump that redraws a shield shows up here as a failure rather than as two different shields.
    expect(SHIELD_VERIFIED).toEqual(UI_ART['shield-verified'])
    expect(TRUST_SHIELD).toEqual(UI_ART['trust-shield'])
  })

  it('the category registry is a set of slugs, not path data, and matches the tile list', () => {
    expect(CATEGORY_GLYPH_SLUGS).toBeInstanceOf(Set)
    expect([...CATEGORY_GLYPH_SLUGS].sort()).toEqual([...CATEGORY_ART_SLUGS].sort())
  })
})
