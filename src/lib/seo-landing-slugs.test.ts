import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAXONOMY } from './taxonomy'

/**
 * Every SEO landing page's `categorySlug` must resolve to a real top-level category.
 *
 * ⚠️ THE CLASS OF BUG, NOT THE INSTANCE. Two of the five landing pages shipped pointing at
 * `house-rentals` and `motorbike-rentals`, neither of which is a Category slug — the nearest real
 * things are the SUBcategories `house-rental` and `motorbike-rental`, singular. Nothing caught it
 * because a wrong slug does not throw. It fails in two silent ways at once:
 *
 *   1. The CTA renders `/c/<slug>`, which 404s.
 *   2. The page's own listing query filters on `category: { slug }`, matches nothing, and renders
 *      an EMPTY rail — which looks like "we have no inventory yet", not like a bug.
 *
 * Both are invisible to tsc (the field is a `string`), to lint, and to any test that renders the
 * page without asserting on its contents.
 *
 * ⚠️ THIS SCANS THE DIRECTORY RATHER THAN IMPORTING A LIST. A registry of landing pages would have
 * to be updated by whoever adds the sixth one, which is the same kind of step people forget — and
 * the page files cannot simply be imported here anyway: `seo-landing.tsx` pulls in the Prisma
 * client, so importing a page module would drag the database into a unit test. Reading the source
 * text is the cheap way to cover pages that do not exist yet. Same idiom as sync-pairs.test.ts.
 */

const APP_DIR = join(__dirname, '..', 'app')
const TOP_LEVEL = new Set(TAXONOMY.map((c) => c.slug))

/**
 * ⚠️ KEYED ON THE IMPORT PATH, AND RECURSIVE. The first version of this scan looked for the string
 * "SeoLanding" one directory level deep, and agy broke it twice: a page importing the component
 * under an alias would not be recognised at all, and a page inside a route group
 * (`src/app/(marketing)/x/page.tsx`) was invisible. Keying on `categorySlug` alone was worse — it
 * matched two unrelated pages that use that word as an ordinary variable.
 *
 * The module SPECIFIER is the anchor that survives both: a landing page must import from
 * `marketplace/seo-landing`, and an import path is a string literal, so aliasing the identifier
 * (`import { SeoLanding as X }`) does not hide it.
 *
 * The value regex accepts single quotes, double quotes and backticks; anything else (an imported
 * constant, a computed value) is reported as `raw` with a null slug and FAILS loudly rather than
 * being skipped. The failure mode to avoid is a guard that passes because it looked at nothing.
 */
const IMPORTS_LANDING = 'marketplace/seo-landing'
const SLUG_RE = /categorySlug:\s*(['"`])([^'"`]+)\1/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
}

/** Every page under src/app that declares a categorySlug, with the value it declares. */
function landingPages(): { page: string; slug: string | null; raw: string | null }[] {
  const out: { page: string; slug: string | null; raw: string | null }[] = []
  for (const file of walk(APP_DIR)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes(IMPORTS_LANDING)) continue
    const idx = src.indexOf('categorySlug:')
    const m = src.match(SLUG_RE)
    out.push({
      page: file.slice(APP_DIR.length + 1),
      slug: m ? m[2] : null,
      raw: m ? null : src.slice(idx, idx + 60).split('\n')[0],
    })
  }
  return out
}

describe('SEO landing pages point at categories that exist', () => {
  const pages = landingPages()

  it('finds the landing pages at all, so a passing suite is not an empty one', () => {
    // Without this, a refactor that moved or renamed the pages would make every assertion below
    // vacuously true and the guard would report green while covering nothing.
    expect(pages.length).toBeGreaterThanOrEqual(5)
  })

  it.each(landingPages())('$page browses into a real top-level category ($slug)', ({ slug, raw }) => {
    // `raw` is set only when a categorySlug was present but not a plain string literal. Reporting
    // it makes the failure self-explanatory instead of an unexplained null.
    expect(raw, 'categorySlug must be a string literal the scan can read').toBeNull()
    expect(slug).not.toBeNull()
    expect(TOP_LEVEL.has(slug!)).toBe(true)
  })

  it('rejects a SUBcategory slug, which is the near-miss that actually shipped', () => {
    // `house-rental` and `motorbike-rental` are real subcategories, so they read as plausible in a
    // diff — but /c/<sub> is not a route and the Category table has no such row. The guard has to
    // fail on these, not just on obvious nonsense.
    const subs = TAXONOMY.flatMap((c) => (c.subcategories ?? []).map((s) => s.slug))
    expect(subs).toContain('house-rental')
    expect(subs).toContain('motorbike-rental')
    for (const sub of ['house-rental', 'motorbike-rental']) expect(TOP_LEVEL.has(sub)).toBe(false)
  })

  it('rejects the exact strings that shipped', () => {
    for (const dead of ['house-rentals', 'motorbike-rentals']) expect(TOP_LEVEL.has(dead)).toBe(false)
    expect(pages.map((p) => p.slug)).not.toContain('house-rentals')
    expect(pages.map((p) => p.slug)).not.toContain('motorbike-rentals')
  })
})
