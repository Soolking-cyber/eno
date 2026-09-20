import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE GOOGLE FEED MUST NOT CARRY AFFILIATE ROWS, AND META'S MUST.
 *
 * Owner, 2026-09-20, on the Merchant Center banner "Fix Affiliates issue that prevents your products
 * from showing on Google". Merchant Center requires the purchase to COMPLETE on the claimed domain;
 * an affiliate listing's page hands the visitor to CellphoneS / Tiki / Thế Giới Di Động via
 * `go.isclix.com`, so Google withholds the account's free listings over it. Measured 2026-09-18:
 * 82,084 of 82,130 live sale listings carry an `affiliateUrl` — so the filter this pins is nearly
 * the whole feed, not a trim.
 *
 * ⚠️ IT READS THE ROUTE'S SOURCE RATHER THAN RUNNING IT, which is unusual and deliberate. The
 * handler builds its `where` through `scopedListingWhere()` and streams XML for ~78k rows; standing
 * that up in a unit test would assert against a mock of the very thing under test. What can actually
 * regress here is someone deleting one line while "making the two feeds consistent", and the source
 * is where that is visible.
 * ⛔ THE ASYMMETRY IS THE POINT. Meta's catalogue policy admits redirect destinations, that feed is
 * live and clean, and it is the one earning traffic. A future tidy-up that unifies the two selectors
 * either re-breaks Merchant Center or needlessly guts Meta.
 */
const read = (p: string) => readFileSync(p, 'utf8')

/**
 * ⛔ COMMENTS ARE STRIPPED BEFORE ASSERTING, AND THAT IS THE WHOLE TEST. The first version matched
 * the raw source, so `// affiliateUrl: null,` — exactly what someone debugging "why is the Google
 * feed only 46 products" would type — left the suite green while the feed re-submitted 82k affiliate
 * rows and earned the account strike this file exists to prevent. A reviewer caught it. A guard that
 * a one-character edit satisfies is worse than no guard, because it reports safety.
 */
/* ⚠️ TRAILING COMMENTS COUNT TOO, AND THE FIRST FIX MISSED THEM. `^[ \t]*\/\/` only strips a comment
   that BEGINS a line, so `status: 'active', // affiliateUrl: null,` still read as present — the same
   false pass one keystroke over, caught by the same reviewer on the next round. The `[^:]` guard is
   what keeps this from eating `https://`, which appears elsewhere in these route files. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The `where` object the route hands to Prisma, comments removed. */
const feedSelector = (path: string) => {
  const src = stripComments(read(path))
  const at = src.indexOf('await scopedListingWhere({')
  expect(at, `${path}: scopedListingWhere call`).toBeGreaterThanOrEqual(0)
  /* ⛔ THE END OF THE WINDOW IS ASSERTED, NOT ASSUMED. `indexOf` returns -1 on a miss and
     `slice(at, -1)` is "the rest of the file minus one character", not an empty string — so a
     routine refactor (hoisting the object to `const where = …`) would silently turn this from a
     selector check into a whole-file grep that passes on the clause appearing ANYWHERE, including in
     the Meta route or a comment block. A reviewer found it; failing loudly is the point of a guard
     whose whole job is catching a one-line removal. */
  const end = src.indexOf('}),', at)
  expect(end, `${path}: end of the scopedListingWhere object — has it been refactored?`).toBeGreaterThan(at)
  return src.slice(at, end)
}

describe('the Google Shopping feed', () => {
  it('excludes affiliate listings from its query', () => {
    const where = feedSelector('src/app/api/feeds/google-shopping/route.ts')
    expect(where, 'affiliateUrl: null must be LIVE in the feed selector, not commented out')
      .toContain('affiliateUrl: null')
  })

  it('still restricts itself to verified, active, sale-type product rows', () => {
    const where = feedSelector('src/app/api/feeds/google-shopping/route.ts')
    // The affiliate filter is an ADDITION; losing any of these would widen the feed, and one of them
    // is the licensing guard that keeps the e-Visa desk out of a licensed company's catalogue.
    for (const clause of ['verified: true', "status: 'active'", 'listingType:', 'category:']) {
      expect(where, `${clause} must remain`).toContain(clause)
    }
  })

  /** ⚠️ The counterpart: Meta keeps the affiliate rows, so the two feeds must NOT be unified. */
  it('does not impose the same filter on the Meta catalogue', () => {
    const meta = feedSelector('src/app/api/feeds/facebook-catalog/route.ts')
    expect(meta, 'the Meta feed must keep affiliate rows').not.toContain('affiliateUrl: null')
  })
})
