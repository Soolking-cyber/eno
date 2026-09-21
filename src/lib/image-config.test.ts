import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THIS FILE EXISTS BECAUSE I 400'd EVERY OPTIMIZED IMAGE IN PRODUCTION ON 2026-09-20.
 *
 * `src/lib/image-loader.ts` points the optimizer at `supabase-envoy:8000` so it stops fetching its
 * sources from Hong Kong (1345 ms → 17 ms). That host is on the Docker bridge, so it resolves to a
 * PRIVATE address — and Next 16 flipped `images.dangerouslyAllowLocalIP` to default FALSE:
 *
 *     upstream image http://supabase-envoy:8000/... hostname resolved to private IP ["172.18.0.5"]
 *
 * Three settings therefore have to move together or the site loses every listing image:
 *   1. `loaderFile`                      — emits the internal URL
 *   2. `remotePatterns` internal entry   — or the optimizer rejects that URL
 *   3. `dangerouslyAllowLocalIP`         — or the optimizer rejects the private IP
 * All three are derived from ONE env var. This test pins that they stay derived from it.
 *
 * ⚠️ WHY IT READS THE SOURCE rather than importing the config: next.config.ts evaluates the env at
 * module load and pulls in the edition machinery, so importing it twice with different env is
 * fragile in a way that would itself need testing. The failure this guards is someone DELETING or
 * hardcoding one of the three couplings, and that is visible in the text.
 *
 * ⛔ AND THE REAL LESSON IS BELOW, IN `it('...private IP...')`: my pre-deploy build test pointed the
 * internal origin at the PUBLIC host so my laptop could resolve it, which meant it never exercised
 * a private IP and proved nothing. A test that cannot fail the way production failed is not a test.
 */
const cfg = readFileSync('next.config.ts', 'utf8')

describe('image config couplings', () => {
  it('derives the internal origin from exactly one env var', () => {
    expect(cfg).toMatch(/IMAGE_INTERNAL_ORIGIN\s*=\s*\(\(\)\s*=>/)
    expect(cfg).toContain('process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN')
  })

  it('gates dangerouslyAllowLocalIP on that same var, never hardcoding it true', () => {
    expect(cfg).toContain('dangerouslyAllowLocalIP: IMAGE_INTERNAL_ORIGIN !== null')
    expect(cfg, 'a bare `dangerouslyAllowLocalIP: true` would enable private-IP fetches even with the internal route off')
      .not.toMatch(/dangerouslyAllowLocalIP:\s*true/)
  })

  /** The allowlist entry must come FROM the parsed origin, or the two drift and 400 everything. */
  it('derives the internal remotePatterns entry from the parsed origin', () => {
    expect(cfg).toMatch(/hostname:\s*IMAGE_INTERNAL_ORIGIN\.hostname/)
    expect(cfg).toMatch(/port:\s*IMAGE_INTERNAL_ORIGIN\.port/)
    expect(cfg, 'hardcoding the container name beside the env var is what caused the 400s')
      .not.toMatch(/hostname:\s*["']supabase-envoy["']/)
  })

  /**
   * ⛔ THE PRIVATE-IP ALLOWANCE MUST STAY PINNED TO ONE PATH PREFIX. `dangerouslyAllowLocalIP`
   * removes Next's SSRF guard; `remotePatterns` is then the ONLY thing standing between an
   * attacker-controlled `url=` and our internal network. An internal entry without a `pathname`,
   * or with a broader one, is the actual vulnerability — not the flag.
   */
  it('keeps the internal allowlist scoped to the public listings prefix', () => {
    const internal = cfg.slice(cfg.indexOf('IMAGE_INTERNAL_ORIGIN.hostname'))
    expect(internal).toContain('pathname: "/storage/v1/object/public/listings/**"')
  })

  it('still uses the custom loader, and never sets loader:"custom" beside it', () => {
    expect(cfg).toContain('loaderFile: "./src/lib/image-loader.ts"')
    // next-server.js render404s the whole optimizer whenever loader !== "default".
    expect(cfg).not.toMatch(/^\s*loader:\s*["']custom["']/m)
  })

  /**
   * ⛔ THE 1,100 IMPORTED REVER RENTALS CARRY REVER'S OWN IMAGE URLS, so the optimizer 400s every
   * one of them unless this host is allowlisted. Presented 2026-09-21 as "1,100 listings live,
   * every card blank" — the images loaded fine when opened directly, which is what makes it look
   * like a component bug rather than a config one. Same class as the private-IP failure above:
   * `remotePatterns` is the gate, and a host that is not on it is a 400, not a slow image.
   * Delete this entry and the rentals category silently loses all its photography.
   */
  it('allowlists the Rever photo CDN the imported rentals point at', () => {
    expect(cfg, 'imported rever: listings 400 at /_next/image without this host')
      .toMatch(/hostname:\s*["']photo\.rever\.vn["']/)
  })

  /**
   * ⚠️ THE THIRD-PARTY ENTRY MUST STAY PATH-SCOPED AND https. `url=` is attacker-controllable, and
   * a third-party host with no pathname at all turns the optimizer into an open image proxy for
   * that whole domain. The entries are generated from one array, so assert the array and the
   * generator rather than a literal — an earlier version of this test pinned the exact text and
   * broke the moment the list grew, which teaches people to delete the test instead of read it.
   */
  /**
   * ⛔ ASSERT THE EXACT PREFIX SET, NOT "a pathname is present somewhere". The first version
   * matched `/pathname\s*[},]/`, which a reviewer showed passes unchanged if you add `"/**"` to
   * the array — the open image proxy this test exists to prevent, waved through by the test that
   * claims to prevent it. An allowlist guard has to enumerate, because any loosening it tolerates
   * is the whole vulnerability.
   */
  const REVER_PREFIXES = ['/v3/get/**', '/photo/v3/**', '/v2/get/**', '/photo/v2/**']

  it('keeps the Rever entries to an exact, enumerated prefix set on https', () => {
    const m = cfg.match(/\[((?:\s*"\/[^"]*"\s*,?)+)\]\s*as const\)\s*\.map/)
    expect(m, 'the generated Rever prefix array moved — re-point this test at it').not.toBeNull()
    const listed = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    expect([...listed].sort(), 'exact set only — a bare "/**" here is an open image proxy').toEqual([...REVER_PREFIXES].sort())
    for (const p of listed) expect(p, 'every prefix must be path-scoped').toMatch(/^\/[a-z0-9/]+\/\*\*$/)
    const i = cfg.indexOf('hostname: "photo.rever.vn"')
    expect(cfg.slice(i - 400, i + 200)).toMatch(/protocol:\s*["']https["']/)
  })

  /**
   * ⛔ THE PREFIX LIST IS ONE FACT WRITTEN IN TWO FILES and they silently disagree. The optimizer
   * allowlist here decides which urls RENDER; `IMAGE_PREFIXES` in scripts/import-rever-rentals.ts
   * decides which urls get STORED. The first version had only `/v3/get/**` in both — measured
   * against the source data that is 13,748 of 17,601 urls, leaving 755 listings with no usable
   * image, which presents as "the deploy fixed most of them" rather than as a bug.
   * Narrow one side without the other and you either drop images you could show, or store images
   * that 400 on every card.
   */
  it('the optimizer allowlist and the importer agree on Rever path prefixes', () => {
    const script = readFileSync('scripts/import-rever-rentals.ts', 'utf8')
    const fromCfg = [...cfg.matchAll(/["'](\/(?:photo\/)?v[23]\/(?:get\/)?)\*\*["']/g)].map((m) => m[1])
    const fromScript = [...script.matchAll(/["']https:\/\/photo\.rever\.vn(\/(?:photo\/)?v[23]\/(?:get\/)?)["']/g)].map((m) => m[1])
    expect(fromCfg.length, 'no Rever prefixes found in next.config.ts — the regex or the config moved').toBeGreaterThan(0)
    expect([...fromScript].sort(), 'importer stores prefixes the optimizer will refuse (or vice versa)').toEqual([...fromCfg].sort())
  })
})
