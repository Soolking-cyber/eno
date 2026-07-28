import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A NATIVE MODULE MAY NOT BE IMPORTED AT MODULE SCOPE ON THE BROWSE PATH.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE AN IMAGE LIBRARY TOOK DOWN SEARCH FOR NINE HOURS. On 2026-07-27
 * `sharp@0.35.3` shipped a container whose native backend would not load on linux-x64. Nothing about
 * browsing needs sharp — but `/api/listings` imports `lib/core/listings`, which imported all three of
 * `lib/ai-moderation`, `lib/image-provenance` → `lib/image-hash`, and `lib/core/media`, and every one
 * of them did `import sharp from 'sharp'` at module scope for code paths that only run on
 * create/upload. A module-scope native import that fails takes down every route that transitively
 * imports it, GET included: 320 × HTTP 500 on `/api/listings` in twenty-four hours.
 *
 * Measured after the fix, with sharp made genuinely unloadable in an isolated standalone bundle
 * (isolated because Node walks UP the tree for `node_modules` — the first attempt at this test
 * resolved sharp from the repo root and produced a meaningless pass):
 *   /api/listings          → 200
 *   /                      → 200
 *   /api/brands/[slug]/logo → 500   ← correctly scoped to the feature that needs sharp
 *
 * The rule below is that outcome as an invariant. It is a SOURCE check rather than a runtime one on
 * purpose: the failure it guards against happens at import time, before any test could call anything.
 */

const ROOT = join(__dirname, '..')

/** Modules reachable from `/api/listings` that also do image work. */
const BROWSE_PATH_MODULES = [
  'lib/ai-moderation.ts',
  'lib/image-hash.ts',
  'lib/core/media.ts',
] as const

/**
 * Route files are ALLOWED to import sharp at module scope — a failure there is scoped to the one
 * endpoint that needs it, which is the whole point. Listed so the distinction is deliberate rather
 * than an oversight.
 */
const ROUTES_ALLOWED_TO_IMPORT_SHARP = [
  'app/api/brands/[slug]/logo/route.ts',
  'app/api/admin/ai-review/route.ts',
  'app/api/ai/classify/route.ts',
  'app/api/ai/visual-search/route.ts',
] as const

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('sharp never loads just because someone browsed', () => {
  it.each(BROWSE_PATH_MODULES)('%s has no module-scope sharp import', (rel) => {
    const src = read(rel)
    expect(src).not.toMatch(/^import sharp from 'sharp'/m)
    expect(src).not.toMatch(/^import sharp, /m)
    expect(src).not.toMatch(/^const sharp = require\('sharp'\)/m)
  })

  it.each(BROWSE_PATH_MODULES)('%s goes through the lazy loader instead', (rel) => {
    expect(read(rel)).toContain("from '@/lib/sharp-lazy'")
  })

  it('the loader defers the import — it does not just re-export a top-level one', () => {
    const src = read('lib/sharp-lazy.ts')
    expect(src).toContain("import('sharp')")
    expect(src).not.toMatch(/^import sharp from 'sharp'/m)
  })

  it('the loader tolerates BOTH interop shapes, because 0.34 and 0.35 differ', () => {
    // 0.34 is CommonJS (`export = sharp`) — its TYPE is the callable and has no `.default`, while a
    // dynamic import hands back `{ default: fn }` at runtime. 0.35 is a real ES module — the type is
    // the NAMESPACE and the callable is its `default`. Both mistakes were made here hours apart:
    // the 0.34 form under 0.35 gives "This expression is not callable" at seven call sites, the
    // 0.35 form under 0.34 gives "Property 'default' does not exist".
    //
    // Matched loosely (`.default ??`) rather than on the exact expression: the trailing cast is
    // whatever tsc needs for the sharp version in the lockfile, and pinning that verbatim made this
    // test fail for a reason that had nothing to do with the invariant.
    expect(read('lib/sharp-lazy.ts')).toMatch(/\.default \?\?/)
  })

  it('a route MAY import sharp directly — the blast radius is then just that route', () => {
    // Not a lax exception: this is the property the fix buys. Kept as a list so that adding a
    // fifth such route is a deliberate act rather than a silent one.
    for (const rel of ROUTES_ALLOWED_TO_IMPORT_SHARP) {
      expect(read(rel)).toMatch(/^import sharp(,| from) /m)
    }
  })
})
