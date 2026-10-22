import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VI_PREFIX_PATHS } from '@/lib/lang-pinned'

/**
 * ⛔ next.config.ts keeps Next's optimistic routing OFF while the `/vi` pilot exists (the comment there has the
 * measurement). With it on, a Vietnamese page's `/vi` links teach the client router "one segment = the home page", and
 * every later `/post`, `/saved`, guide or shop-handle prefetch asks the origin for the home page's segment under the
 * wrong URL — a 404 each — while the tap itself loses its prefetch. Reads the source, as image-config.test.ts does,
 * because importing next.config.ts pulls in the edition machinery.
 */
const cfg = readFileSync('next.config.ts', 'utf8')

describe('optimistic routing', () => {
  it('is off in next.config.ts, inside `experimental`', () => {
    // Next reads it only as `experimental.optimisticRouting` (config-schema.js; define-env.js inlines it into the
    // client as process.env.__NEXT_OPTIMISTIC_ROUTING). Anywhere else it is ignored and the default (on) returns.
    const experimental = cfg.indexOf('experimental: {')
    const flag = cfg.search(/\boptimisticRouting:\s*false\b/)
    expect(experimental, 'no `experimental: {` block').toBeGreaterThan(-1)
    expect(flag, 'optimisticRouting: false is missing').toBeGreaterThan(experimental)
    expect(cfg).not.toMatch(/\boptimisticRouting:\s*true\b/)
  })

  it('the reason still holds: the home page has a /vi twin, so /vi is a live one-segment URL', () => {
    // When the pilot ends (no `/` in VI_PREFIX_PATHS), this flag may be revisited — not before.
    expect(VI_PREFIX_PATHS).toContain('/')
  })
})
