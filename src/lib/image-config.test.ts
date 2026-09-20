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
})
