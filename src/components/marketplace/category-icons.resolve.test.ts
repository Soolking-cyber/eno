import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TAXONOMY, LISTING_TYPES, INTENT_SHORTCUTS } from '@/lib/taxonomy'

/**
 * EVERY ICON NAME IN THE APP MUST RESOLVE TO A DRAWING.
 *
 * ⛔ THIS IS THE GUARD THAT DID NOT EXIST, AND ITS ABSENCE IS WHY RENAMING ICONS WAS DANGEROUS.
 * An icon name is a plain string used as a runtime key into the `ICONS` record in
 * category-icons.tsx. A typo is not a build error and not a crash — `CategoryIcon` falls back, so
 * the only symptom is a glyph that is quietly the wrong one, or missing, on one tile or one
 * subcategory nobody opened this week. tsc cannot see it, eslint cannot see it, and the design
 * lint does not read these files. Nothing did, until this.
 *
 * ⚠️ IT READS THE REGISTRY AS TEXT rather than importing it. category-icons.tsx is a client module
 * that pulls in the whole Solar shim and React; parsing the key list out of the source keeps this
 * test a pure-node unit test with no jsdom and no component boot — the same idiom edition-stubs
 * uses on next.config.ts, and for the same reason.
 *
 * ⚠️ WHEN THIS FAILS, THE FIX IS ALMOST NEVER TO EDIT THIS FILE. Either add the drawing to
 * category-icons.tsx, or correct the name at the call site. Adding an exemption here re-opens
 * exactly the hole it was written to close.
 */

const registrySource = readFileSync(
  join(process.cwd(), 'src/components/marketplace/category-icons.tsx'),
  'utf8',
)

/** The keys of `const ICONS: Record<string, CategoryGlyph> = { … }`. */
function registeredNames(): Set<string> {
  const start = registrySource.indexOf('const ICONS: Record<string, CategoryGlyph> = {')
  expect(start, 'the ICONS record moved or was renamed — update this parser, do not delete it').toBeGreaterThan(-1)
  const body = registrySource.slice(start, registrySource.indexOf('\n}', start))
  // `  Name,` (shorthand) and `  Name: Something,` both register the key `Name`.
  return new Set([...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*[,:]/gm)].map((m) => m[1]))
}

/** Every (source, name) pair the app can ask CategoryIcon to draw. */
function usedNames(): { where: string; name: string }[] {
  const out: { where: string; name: string }[] = []
  for (const c of TAXONOMY) {
    out.push({ where: `category ${c.slug}`, name: c.icon })
    for (const s of c.subcategories) out.push({ where: `${c.slug}/${s.slug}`, name: s.icon })
  }
  for (const t of LISTING_TYPES) out.push({ where: `listingType ${t.value}`, name: t.icon })
  for (const i of INTENT_SHORTCUTS) out.push({ where: `intent ${i.type}`, name: i.icon })
  return out
}

describe('every icon name resolves to a registered drawing', () => {
  const registered = registeredNames()

  it('the registry parsed — a zero-key read would make every assertion below vacuous', () => {
    expect(registered.size).toBeGreaterThan(50)
  })

  it('the taxonomy, listing types and intent tiles only name glyphs that exist', () => {
    const missing = usedNames().filter((u) => !registered.has(u.name))
    expect(
      missing.map((m) => `${m.where} → "${m.name}"`),
      'these names have no drawing in category-icons.tsx, so they render the fallback glyph',
    ).toEqual([])
  })

  it('catches a typo — proving the assertion is not vacuous', () => {
    // The failure mode this file exists for: a name that looks plausible and resolves to nothing.
    expect(registered.has('PackageSearchh')).toBe(false)
    expect(registered.has('NotAnIconName')).toBe(false)
  })
})
