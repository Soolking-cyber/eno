import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAXONOMY, VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from './taxonomy'

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
const SLUG_RE = /(?<![a-zA-Z])categorySlug:\s*(['"`])([^'"`]+)\1/
const SUB_SLUG_RE = /subcategorySlug:\s*(['"`])([^'"`]+)\1/

/**
 * Identifiers a page may use INSTEAD of a string literal, resolved to the value the page will
 * actually get.
 *
 * ⚠️ THE SCAN USED TO FAIL ON ANY NON-LITERAL, AND THAT WAS RIGHT UNTIL IT WASN'T. A text scan
 * cannot evaluate an expression, so "must be a string literal" was the only honest rule it could
 * enforce — anything else got reported as `raw` and failed loudly, which is still the correct
 * default. But the e-visa pages import `VISA_CATEGORY_SLUG` / `VISA_SUBCATEGORY_SLUG` from
 * taxonomy.ts, and that is STRICTER than a literal, not looser: a page wired to the constant
 * cannot drift when the taxonomy is renamed, while six literals silently could. Forcing those
 * pages back to literals to satisfy the scanner would weaken the code to keep the test simple.
 *
 * So the identifiers are resolved here by IMPORTING THE SAME CONSTANTS the pages import. If
 * taxonomy.ts renames one, this map stops compiling; if it changes a VALUE, the assertions below
 * check the new value against the live taxonomy exactly as they would a literal. An identifier
 * that is not in this map is still `raw` and still fails — the escape hatch is one map, not a
 * blanket exemption.
 */
const RESOLVABLE: Record<string, string> = {
  VISA_CATEGORY_SLUG,
  VISA_SUBCATEGORY_SLUG,
}
const IDENT_RE = /(?<![a-zA-Z])categorySlug:\s*([A-Z][A-Z0-9_]*)/
const SUB_IDENT_RE = /subcategorySlug:\s*([A-Z][A-Z0-9_]*)/

/** Read one `<field>: <value>` declaration, accepting a string literal or a resolvable constant. */
function readSlug(src: string, literal: RegExp, ident: RegExp): { slug: string | null; unresolved: string | null } {
  const lit = src.match(literal)
  // ⚠️ A BACKTICK VALUE IS NOT AUTOMATICALLY A LITERAL. The value pattern has always accepted
  // backticks, and `` `${x}-legal` `` matches it happily — the interpolation contains no quote
  // character to stop at. The scan would then hand the taxonomy the string "${x}-legal", which
  // fails, but for the wrong reason and with a message that describes a slug nobody wrote. An
  // interpolated template is a computed value: report it as unresolved, which is what it is.
  if (lit) return lit[2].includes('${') ? { slug: null, unresolved: lit[0] } : { slug: lit[2], unresolved: null }
  const id = src.match(ident)
  if (!id) return { slug: null, unresolved: null }
  const value = RESOLVABLE[id[1]]
  return value ? { slug: value, unresolved: null } : { slug: null, unresolved: id[1] }
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    // ⚠️ `.svc.tsx` TOO. The edition split renamed services-only pages to page.svc.tsx so a
    // marketplace build cannot compile them, and a walker matching only page.tsx stopped seeing
    // services-for-expats-vietnam — which quietly dropped this guard from 5 pages to 4 and tripped
    // the "not an empty suite" floor below. The guarantee it enforces (a landing page browses into
    // a category that exists) applies to BOTH editions, so both filenames belong here.
    else if (entry.name === 'page.tsx' || entry.name === 'page.svc.tsx' || entry.name === 'page.forum.svc.tsx') out.push(full)
  }
  return out
}

type Read = { slug: string | null; sub: string | null; raw: string | null }

/**
 * Read one page's SOURCE TEXT into the values it declares. Split out from the directory walk so it
 * can be exercised against synthetic sources — the scan's own failure modes cannot be tested
 * against the real pages, because the real pages are (and should stay) correct.
 */
function readPageSource(src: string): Read {
  const cat = readSlug(src, SLUG_RE, IDENT_RE)
  const sub = readSlug(src, SUB_SLUG_RE, SUB_IDENT_RE)
  const idx = src.indexOf('categorySlug:')
  // ⚠️ "DECLARED BUT UNREADABLE" IS NOT THE SAME AS "ABSENT", and conflating them was a real hole
  // agy refuted in the first cut of this scan. `subcategorySlug` is optional, so a null slug
  // normally means the page simply does not narrow — but a page writing
  // `subcategorySlug: someLowercaseVar` also produces null from both regexes, and it then fell
  // straight through the `.filter((p) => p.sub)` below and was validated by NOTHING. Checking for
  // the field's TEXT is what tells the two apart: present in the source, absent from the parse,
  // means the scan could not read it and must say so rather than skip the page.
  const subIdx = src.indexOf('subcategorySlug:')
  const unreadableSub = subIdx !== -1 && sub.slug === null ? src.slice(subIdx, subIdx + 60).split('\n')[0] : null
  return {
    slug: cat.slug,
    sub: sub.slug,
    // `raw` names what could not be read: an unresolvable identifier by name, a declared-but-
    // unparseable subcategory, or — when there is no recognisable categorySlug at all — the
    // source line, so the failure explains itself.
    raw:
      cat.unresolved ??
      sub.unresolved ??
      unreadableSub ??
      (cat.slug ? null : src.slice(idx, idx + 60).split('\n')[0]),
  }
}

/** Every page under src/app that declares a categorySlug, with the values it declares. */
function landingPages(): (Read & { page: string })[] {
  const out: (Read & { page: string })[] = []
  for (const file of walk(APP_DIR)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes(IMPORTS_LANDING)) continue
    out.push({ page: file.slice(APP_DIR.length + 1), ...readPageSource(src) })
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
    // `raw` is set only when a slug was present but neither a plain string literal nor a
    // constant this scan resolves. Reporting it makes the failure self-explanatory.
    expect(raw, 'every declared slug must be a string literal or a constant in RESOLVABLE').toBeNull()
    expect(slug).not.toBeNull()
    expect(TOP_LEVEL.has(slug!)).toBe(true)
  })

  /**
   * ⚠️ A WRONG `subcategorySlug` FAILS EXACTLY AS QUIETLY AS A WRONG `categorySlug` DID — which is
   * the whole reason this file exists. The field narrows the page's listing query, so a slug that
   * matches no subcategory renders an EMPTY rail that reads as "no inventory yet", and it narrows
   * the browse URL the CTA points at, which then shows an unfiltered or empty view. Neither throws,
   * neither is visible to tsc (it is a `string`), and a near-miss is easy to write: `visa` for
   * `visa-legal`, `apartments` for `apartment`.
   *
   * It must belong to the page's OWN category, not merely exist somewhere in the taxonomy —
   * `services` + `apartment` is two real slugs and zero results.
   */
  it.each(landingPages().filter((p) => p.sub))(
    '$page narrows to a subcategory that exists inside $slug ($sub)',
    ({ slug, sub }) => {
      const cat = TAXONOMY.find((c) => c.slug === slug)
      expect(cat, `categorySlug ${slug} must resolve before its subcategory can`).toBeDefined()
      const subs = (cat!.subcategories ?? []).map((s) => s.slug)
      expect(subs, `${sub} is not a subcategory of ${slug}`).toContain(sub)
    },
  )

  it('rejects a subcategory that is real but belongs to a different category', () => {
    // The near-miss the assertion above is built for: both halves check out on their own.
    const services = TAXONOMY.find((c) => c.slug === 'services')!
    const property = TAXONOMY.find((c) => c.slug === 'property')!
    const propertySubs = (property.subcategories ?? []).map((s) => s.slug)
    const serviceSubs = (services.subcategories ?? []).map((s) => s.slug)
    expect(propertySubs).toContain('apartment')
    expect(serviceSubs).not.toContain('apartment')
  })

  it('reads categorySlug even when subcategorySlug is declared first', () => {
    // ⚠️ A LATENT BUG IN THE ORIGINAL REGEX, found when the second field was added. `categorySlug:`
    // is a SUBSTRING of `subcategorySlug:`, so the un-anchored pattern matched whichever line came
    // first in the file — and every current page happens to declare category first, which is
    // exactly the kind of luck that stops holding without anyone noticing. Hence the lookbehind.
    const reversed = "  subcategorySlug: 'visa-legal',\n  categorySlug: 'services',"
    expect(readSlug(reversed, SLUG_RE, IDENT_RE).slug).toBe('services')
    expect(readSlug(reversed, SUB_SLUG_RE, SUB_IDENT_RE).slug).toBe('visa-legal')
    // Same hazard on the identifier path.
    const reversedConsts = '  subcategorySlug: VISA_SUBCATEGORY_SLUG,\n  categorySlug: VISA_CATEGORY_SLUG,'
    expect(readSlug(reversedConsts, SLUG_RE, IDENT_RE).slug).toBe(VISA_CATEGORY_SLUG)
    expect(readSlug(reversedConsts, SUB_SLUG_RE, SUB_IDENT_RE).slug).toBe(VISA_SUBCATEGORY_SLUG)
  })

  it('refuses to skip a subcategorySlug it cannot parse, instead of silently not checking it', () => {
    // ⚠️ THE VACUOUS-PASS HOLE agy FOUND. `subcategorySlug` is optional, so "no slug parsed" read
    // as "this page does not narrow", and the page then dropped out of the per-page subcategory
    // check entirely — an unreadable declaration was validated by NOTHING, which is exactly the
    // shape of failure this whole file exists to prevent. Each of these must be REPORTED (non-null
    // `raw` ⇒ the page fails the assertion above), not quietly excluded.
    const page = (decl: string) =>
      `import { SeoLanding } from '@/components/marketplace/seo-landing'\nconst C = {\n  categorySlug: 'services',\n  ${decl}\n}`
    for (const bad of ['subcategorySlug: someSlug,', 'subcategorySlug: `${x}-legal`,', 'subcategorySlug: pick(),']) {
      const read = readPageSource(page(bad))
      expect(read.sub, bad).toBeNull()
      expect(read.raw, `${bad} must be reported, not skipped`).not.toBeNull()
    }
    // …while a page that genuinely declares no subcategory stays clean. Without this the fix could
    // be "report everything", which would fail the five category-only landing pages.
    const plain = readPageSource(page(''))
    expect(plain.sub).toBeNull()
    expect(plain.raw).toBeNull()
    // …and a readable one still parses.
    expect(readPageSource(page("subcategorySlug: 'visa-legal',")).sub).toBe('visa-legal')
  })

  it('resolves the visa constants the e-visa cluster imports', () => {
    // Guards the RESOLVABLE map itself: if these stopped resolving, every e-visa page would be
    // reported as `raw` — a loud failure, but one whose cause is worth naming here directly.
    expect(TOP_LEVEL.has(VISA_CATEGORY_SLUG)).toBe(true)
    const cat = TAXONOMY.find((c) => c.slug === VISA_CATEGORY_SLUG)!
    expect((cat.subcategories ?? []).map((s) => s.slug)).toContain(VISA_SUBCATEGORY_SLUG)
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
