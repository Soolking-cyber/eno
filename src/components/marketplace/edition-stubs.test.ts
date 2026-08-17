import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The marketplace-edition stubs must export everything the chat page imports.
 *
 * ⚠️ THIS TEST IS THE ONLY THING STANDING BETWEEN THE STUBS AND A RUNTIME CRASH, and that is not an
 * overstatement. `next.config.ts` aliases visa-cards / trip-cards to their stubs on a marketplace
 * build, but an alias is a BUNDLER resolution — `tsc` type-checks the chat page against the REAL
 * modules and never sees the stubs at all. So adding an export to visa-cards.tsx, importing it in
 * the chat page, and shipping is a green typecheck, a green build, and a white screen on eno.vn's
 * most-used surface the moment that import is evaluated.
 *
 * Checked by TEXT rather than by importing the modules: visa-cards.tsx is a 'use client' component
 * with a large dependency graph, and importing it in a node test environment is a slow, brittle way
 * to ask a question about names.
 */

const read = (p: string) => readFileSync(p, 'utf8')

/** Every identifier the chat page pulls out of a module. */
function importedNames(source: string, module: string): string[] {
  // Both the braced multi-line form and the single-line form appear in this file.
  // ⚠️ `[^{}]*`, NOT `[\s\S]*?`. The lazy any-character form anchored on the file's FIRST `import {`
  // and ran all the way to this module's `from`, swallowing every import in between — so the test
  // demanded the stub export React's `Fragment` and `useEffect`. Disallowing braces confines the
  // match to one brace group that is immediately followed by the right specifier.
  const re = new RegExp(String.raw`import\s*\{([^{}]*?)\}\s*from\s*'${module}'`)
  const m = source.match(re)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, ''))       // `type Foo` → Foo
    .map((s) => s.split(/\s+as\s+/)[0].trim())   // `Foo as Bar` → Foo
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/** Every name a module exports (const / function / type / class). */
function exportedNames(source: string): Set<string> {
  const out = new Set<string>()
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1])
  }
  return out
}

const PAGE = read('src/app/messages/[id]/page.tsx')

describe.each([
  ['visa-cards', '@/components/marketplace/visa-cards', 'src/components/marketplace/visa-cards.stub.tsx'],
  ['trip-cards', '@/components/marketplace/trip-cards', 'src/components/marketplace/trip-cards.stub.tsx'],
])('%s stub', (_label, moduleSpecifier, stubPath) => {
  const needed = importedNames(PAGE, moduleSpecifier)
  const provided = exportedNames(read(stubPath))

  it('the chat page actually imports from this module (so the test is not vacuous)', () => {
    // Without this, renaming the import path would make every assertion below trivially pass while
    // covering nothing — the same failure mode the SEO landing guard protects against.
    expect(needed.length).toBeGreaterThan(0)
  })

  it.each([[undefined]])('stub exports every symbol the chat page imports', () => {
    const missing = needed.filter((n) => !provided.has(n))
    expect(missing, `add these to ${stubPath} — a marketplace build would crash on them`).toEqual([])
  })
})

/**
 * The LIB stubs are pinned by EXPORT-SURFACE PARITY rather than by what one page imports.
 *
 * The card stubs above can be checked against the chat page because that page is their only
 * consumer. These two are imported from many places — the footer, the taxonomy, and (for
 * visa-provider) the shared legal pages that render on BOTH editions — so "what does the caller
 * need" is the wrong question. "Does the stub export everything the real module does" is the one
 * that stays true as call sites are added, and it is exactly what tsc cannot ask: the alias is a
 * bundler resolution, so a shared page adding `import { X } from '@/lib/visa-provider'` typechecks
 * green and throws on eno.vn.
 */
describe.each([
  ['edition-services-copy', 'src/lib/edition-services-copy.ts', 'src/lib/edition-services-copy.stub.ts'],
  ['visa-provider', 'src/lib/visa-provider.ts', 'src/lib/visa-provider.stub.ts'],
  ['privacy-services-copy', 'src/lib/privacy-services-copy.ts', 'src/lib/privacy-services-copy.stub.ts'],
  ['terms-services-copy', 'src/lib/terms-services-copy.ts', 'src/lib/terms-services-copy.stub.ts'],
  ['prohibited-services-copy', 'src/lib/prohibited-services-copy.ts', 'src/lib/prohibited-services-copy.stub.ts'],
  ['cross-site-links', 'src/lib/cross-site-links.ts', 'src/lib/cross-site-links.stub.ts'],
  // eno.forum's home banner (2026-08-17). It is imported at module top level by promo-banner.tsx,
  // which renders ABOVE THE FOLD on the home page of BOTH editions — so a drifted export is not a
  // subtle regression, it is eno.vn's landing page failing to render.
  ['promo-slides-services', 'src/lib/promo-slides-services.ts', 'src/lib/promo-slides-services.stub.ts'],
  // A COMPONENT in a list of libs, deliberately. The card stubs above are pinned against the chat
  // page because it is their only consumer; this one is imported by two `.svc.` landing pages and
  // will be imported by more, so "does the stub export what the real module exports" is the check
  // that keeps holding as placements change.
  [
    'cross-site-promo',
    'src/components/marketplace/cross-site-promo.tsx',
    'src/components/marketplace/cross-site-promo.stub.tsx',
  ],
  // ⚠️ THE ONE THIS GUARD ACTUALLY CAUGHT. visa-start is imported at module top level by
  // src/app/listings/[id]/page.tsx — the product detail page — so a missing or drifted export is a
  // white screen on every eno.vn listing. It was aliased only after a clean build measured eight
  // e-Visa sentences shipping in a 61KB chunk the PDP downloads; this row is what stops the stub
  // rotting away from the real module afterwards. The guard below refused the new alias until it
  // was here, which is the whole point of it.
  [
    'visa-start',
    'src/components/marketplace/visa-start.tsx',
    'src/components/marketplace/visa-start.stub.tsx',
  ],
  // The lazily-loaded services translation catalogue. Generated, so nobody edits it by hand — but
  // it is aliased like the rest, and an alias with no parity check is the gap this list closes.
  // The API error vocabulary's services half. Not copy — a RUNTIME array of code strings that
  // `apiErrorCode()` reads, in a module `src/lib/api/client.ts` imports, i.e. on a path into client
  // chunks. Its eight entries name visa and itinerary surfaces eno.vn may not mention.
  // ⚠️ THE PARITY HERE IS ABOUT THE EXPORT NAME, NOT THE CONTENTS — the stub's array is
  // deliberately EMPTY, which is the whole point of the alias. What must not drift is
  // `SERVICES_ALL` existing at all: a rename in the real module with no rename here is a green
  // typecheck and `undefined.includes(...)` on eno.vn the first time apiErrorCode() runs.
  ['api/errors-services', 'src/lib/api/errors-services.ts', 'src/lib/api/errors-services.stub.ts'],
  ['ui-strings.services', 'src/generated/ui-strings.services.ts', 'src/generated/ui-strings.services.stub.ts'],
])('%s stub', (_label, realPath, stubPath) => {
  it('exports every name the real module exports', () => {
    const real = exportedNames(read(realPath))
    const stub = exportedNames(read(stubPath))
    expect(real.size, `${realPath} exports nothing — the check would be vacuous`).toBeGreaterThan(0)
    const missing = [...real].filter((n) => !stub.has(n))
    expect(missing, `add these to ${stubPath} — a marketplace build would crash on them`).toEqual([])
  })
})

/**
 * EVERY ALIAS IN next.config.ts IS COVERED BY ONE OF THE TWO BLOCKS ABOVE.
 *
 * ⚠️ THIS GUARDS THE GUARD, and it exists because both lists above are hand-maintained. Adding a
 * `turbopack.resolveAlias` entry is how a services module gets kept out of eno.vn's artifact — and
 * nothing until now made the author also add a parity row. A stub that drifts from its real module
 * is invisible to `tsc` (the alias is a bundler resolution, so the typechecker only ever sees the
 * real module) and invisible to every test that does not know the pair exists. It surfaces as a
 * white screen on the licensed marketplace.
 *
 * So the alias map is PARSED, never retyped: a new entry fails here until it is covered, and the
 * failure names the file to add.
 */
describe('alias coverage', () => {
  const config = read('next.config.ts')
  const aliasBlock = config.slice(config.indexOf('resolveAlias: {'))

  /** `"@/lib/foo": "./src/lib/foo.stub.ts"` → [specifier, stubPath]. */
  const aliasPairs = [...aliasBlock.matchAll(/"(@\/[^"]+)":\s*"\.\/([^"]+)"/g)].map((m) => [m[1], m[2]] as const)

  /** Every real-module path the two describe blocks above check. */
  const covered = new Set([
    'src/components/marketplace/visa-cards.tsx',
    'src/components/marketplace/trip-cards.tsx',
    'src/lib/edition-services-copy.ts',
    'src/lib/visa-provider.ts',
    'src/lib/privacy-services-copy.ts',
    'src/lib/terms-services-copy.ts',
    'src/lib/prohibited-services-copy.ts',
    'src/lib/cross-site-links.ts',
    'src/lib/promo-slides-services.ts',
    'src/components/marketplace/cross-site-promo.tsx',
    'src/components/marketplace/visa-start.tsx',
    'src/generated/ui-strings.services.ts',
    'src/lib/api/errors-services.ts',
  ])

  it('finds the alias map (so the checks below are not vacuous)', () => {
    expect(aliasPairs.length).toBeGreaterThan(0)
  })

  it.each(aliasPairs)('%s — its stub file exists', (_spec, stubPath) => {
    expect(() => read(stubPath), `next.config.ts aliases to ${stubPath}, which is not on disk`).not.toThrow()
  })

  it.each(aliasPairs)('%s — is covered by a parity check above', (spec) => {
    const base = spec.replace('@/', 'src/')
    const real = [`${base}.ts`, `${base}.tsx`].find((p) => covered.has(p))
    expect(
      real,
      `${spec} is aliased away on a marketplace build but no parity check covers it. Add its ` +
        `real/stub pair to one of the describe.each lists above and to the 'covered' set here — ` +
        `an uncovered stub drifts silently and crashes eno.vn at runtime.`,
    ).toBeDefined()
  })
})

describe('the stubs stay inert', () => {
  it('contain no visa or payment vocabulary — the whole reason they exist', () => {
    // The point of aliasing is that these strings never reach a marketplace client chunk. A stub
    // that helpfully explained "e-Visa unavailable" would put the word back in the bundle.
    for (const p of ['src/components/marketplace/visa-cards.stub.tsx', 'src/components/marketplace/trip-cards.stub.tsx']) {
      const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(body, `${p} leaks vocabulary outside its comments`).not.toMatch(/PayPal|hộ chiếu|passport/i)
    }
  })

  it('the provider stub names no partner and describes no service', () => {
    // The identifiers (VISA_PROVIDER, VisaProvider) MUST match the real module or the alias breaks,
    // so they are not what this checks. What must never reach eno.vn's artifact is the human-facing
    // payload: the partner's name and the words describing what it is licensed to do.
    const p = 'src/lib/visa-provider.stub.ts'
    const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, `${p} leaks the provider vocabulary outside its comments`).not.toMatch(
      /VietKite|thị thực|lữ hành|giấy phép|travel-service|provider of record/i,
    )
  })

  it('the privacy stub carries no applicant-document copy', () => {
    // /privacy is served on BOTH editions, so this stub is the only thing standing between eno.vn
    // and a policy that describes a service the licensed company may not offer. The export NAMES
    // must match the real module or the alias breaks — what is checked is the prose.
    const p = 'src/lib/privacy-services-copy.stub.ts'
    const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, `${p} leaks applicant-document vocabulary outside its comments`).not.toMatch(
      /VietKite|visa|thị thực|passport|hộ chiếu|portrait|immigration/i,
    )
  })

  it('the terms stub carries no provider-of-record copy', () => {
    // Same shape as the privacy stub and for the same reason: /terms renders on BOTH editions, so
    // this file is what keeps eno.vn's Terms from describing — and its bundle from carrying — a
    // service the licensed company may not offer. `commission` is in the pattern because the
    // arrangement itself ("we take a commission from the provider") is a services-only fact even
    // when the partner is not named.
    const p = 'src/lib/terms-services-copy.stub.ts'
    const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, `${p} leaks provider-of-record vocabulary outside its comments`).not.toMatch(
      /VietKite|visa|thị thực|passport|hộ chiếu|immigration|provider of record|commission/i,
    )
  })

  it('the prohibited stub carries no visa listing rules', () => {
    // /prohibited is served on BOTH editions — the licensed marketplace publishes the same
    // banned-goods policy — so this stub is what keeps eno.vn's copy of it from carrying rules
    // about a service it may not offer. `guaranteed` and `licence` are in the pattern because the
    // three rules the real module exists for are recognisable from those words alone, even with
    // the word "visa" removed by a well-meaning edit.
    const p = 'src/lib/prohibited-services-copy.stub.ts'
    const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, `${p} leaks visa listing-rule vocabulary outside its comments`).not.toMatch(
      /VietKite|visa|thị thực|hộ chiếu|immigration|lữ hành|guaranteed|licen[cs]e|government fee/i,
    )
  })

  it('the cross-site stubs carry no eno.vn promo copy or hrefs', () => {
    // ⚠️ THE INVERSION IS THE WHOLE POINT, so state it: everywhere else on this page the banned
    // vocabulary is visa/partner words that must not reach the LICENSED marketplace. Here it is
    // eno.vn's OWN name and URLs, and the site they must not reach is eno.vn — a page promoting
    // eno.vn to a reader already on eno.vn, with every href a self-link. Easy to read as harmless
    // and delete; it is the same class of artifact leak, pointing the other way.
    for (const p of ['src/lib/cross-site-links.stub.ts', 'src/components/marketplace/cross-site-promo.stub.tsx']) {
      const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(body, `${p} leaks a marketplace URL outside its comments`).not.toMatch(/https?:\/\//i)
      // ⚠️ "marketplace" IS NOT IN THE PATTERN, and leaving it out was forced rather than chosen:
      // the exported identifiers (MARKETPLACE_HOME, MARKETPLACE_LINKS) must match the real module
      // byte for byte or the alias resolves to a module missing the names its callers import. Same
      // rule as the provider stub above — what is checked is the human-facing payload, never the
      // identifiers the bundler needs.
      expect(body, `${p} leaks promo copy outside its comments`).not.toMatch(
        /Already in Vietnam|housing|motorbike|moving sale|jobs in vietnam|nhà ở|xe máy|việc làm/i,
      )
    }
  })
})
