import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * ⛔ THIS LOADER IS WHAT KEEPS THE OPTIMIZER OFF A HONG KONG ROUND TRIP, and both of its failure
 * modes are silent:
 *   · it stops rewriting → every cold image quietly costs ~1.3 s again, and nothing errors;
 *   · it rewrites too much → an unrelated origin gets pointed at our internal gateway.
 * The env vars are read at MODULE LOAD, so each case re-imports with `vi.resetModules()`.
 */
const PUBLIC = 'https://sb.eno.vn'
const INTERNAL = 'http://supabase-envoy:8000'
const OBJ = '/storage/v1/object/public/listings/a/b-c.webp'

async function load(env: Record<string, string | undefined>) {
  vi.resetModules()
  const prevPub = process.env.NEXT_PUBLIC_SUPABASE_URL
  const prevInt = process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN
  if (env.pub === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = env.pub
  if (env.internal === undefined) delete process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN
  else process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN = env.internal
  const mod = await import('./image-loader')
  process.env.NEXT_PUBLIC_SUPABASE_URL = prevPub
  process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN = prevInt
  return mod
}

describe('image loader', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.resetModules())

  it('rewrites our storage origin to the internal gateway', async () => {
    const { internalize } = await load({ pub: PUBLIC, internal: INTERNAL })
    expect(internalize(PUBLIC + OBJ)).toBe(INTERNAL + OBJ)
  })

  /** Unset in dev, CI and the native shell — it must behave exactly like the stock loader. */
  it('is a NO-OP when the internal origin is unset', async () => {
    const { internalize } = await load({ pub: PUBLIC, internal: undefined })
    expect(internalize(PUBLIC + OBJ)).toBe(PUBLIC + OBJ)
  })

  /**
   * ⛔ THE ANCHOR IS THE PARSED ORIGIN, NOT A SUBSTRING. A `startsWith` check would rewrite
   * `https://sb.eno.vn.evil.test/...` and point our optimizer wherever an attacker liked.
   */
  it('does not rewrite a look-alike origin', async () => {
    const { internalize } = await load({ pub: PUBLIC, internal: INTERNAL })
    for (const hostile of [
      'https://sb.eno.vn.evil.test' + OBJ,
      'https://evil.test/?x=https://sb.eno.vn' + OBJ,
      'https://sb-eno.vn' + OBJ,
      'http://sb.eno.vn' + OBJ, // different scheme => different origin
    ]) {
      expect(internalize(hostile), hostile).toBe(hostile)
    }
  })

  it('leaves relative sources alone — Next serves those itself', async () => {
    const { internalize } = await load({ pub: PUBLIC, internal: INTERNAL })
    for (const rel of ['/icons/categories/electronics.webp?v=5a2a3d43', '/logo-mark.svg', 'data:image/png;base64,iVBOR'])
      expect(internalize(rel)).toBe(rel)
  })

  it('survives a malformed src instead of throwing mid-render', async () => {
    const { internalize } = await load({ pub: PUBLIC, internal: INTERNAL })
    expect(internalize('https://')).toBe('https://')
  })

  /**
   * ⛔ QUALITY DEFAULTS TO 60 — THE APP'S ONE TIER — NOT NEXT'S 75 AND NOT 70.
   * `images.qualities` is `[60, 70]` and Next 16 REJECTS an out-of-list quality rather than
   * clamping, so a 75 default would 400 every image without an explicit `quality`. Next's own
   * loader snaps 75 to the nearest allowed value, which is 70 — the EXPENSIVE tier, by accident.
   * 60 is what every deliberate call site asks for; defaulting to it keeps the app single-tier,
   * which is what stops the same (master, width) being encoded twice.
   */
  it('emits the optimizer URL, defaulting to the single quality tier', async () => {
    const { default: loader } = await load({ pub: PUBLIC, internal: INTERNAL })
    const url = loader({ src: PUBLIC + OBJ, width: 640 })
    expect(url).toContain('q=60')
    expect(url).toContain('w=640')
    expect(url.startsWith('/_next/image?url=')).toBe(true)
    expect(url).toContain(encodeURIComponent(INTERNAL + OBJ))
  })

  it('honours an explicit quality', async () => {
    const { default: loader } = await load({ pub: PUBLIC, internal: INTERNAL })
    expect(loader({ src: PUBLIC + OBJ, width: 420, quality: 60 })).toContain('q=60')
  })

  /**
   * ⛔ ONE TIER, APP-WIDE — this is the guard, not the default above.
   * Two tiers mean the SAME master at the SAME width is encoded twice: measured 2026-09-20 on the
   * origin's 8h log, 1,149 of 7,501 (master, width) pairs were being optimized at both 60 and 70,
   * 15% of all the work, for a difference AVIF does not show. A single `quality={70}` reintroduced
   * anywhere brings that straight back, silently — nothing errors, images just get slower.
   * ⚠️ 70 must REMAIN in `images.qualities` (Cloudflare and Meta hold cached `q=70` URLs and Next
   * rejects an unlisted quality), so the allowlist cannot be the thing that enforces this.
   */
  it('no component emits the second quality tier', async () => {
    const { readFileSync } = await import('node:fs')
    const { globSync } = await import('node:fs')
    const files: string[] = (globSync as unknown as (p: string) => string[])('src/**/*.tsx')
      .filter((f: string) => !f.includes('.test.'))
    /**
     * ⛔ THE GLOB IS ASSERTED BEFORE IT IS USED, AND THAT LINE IS THE GUARD'S OWN GUARD.
     * `globSync` resolves against `process.cwd()`. Run vitest from a different root — a workspace
     * invocation, `--dir`, a future `test.root` — and `files` is `[]`, `offenders` is `[]`, and
     * this passes forever while enforcing NOTHING, with a comment above it claiming otherwise.
     * A reviewer caught exactly that. Verified by negative control: injecting `quality={70}` into
     * listing-card.tsx makes this fail and names the file.
     * (`fs.globSync` needs Node 22+; package.json requires >=24 and the image is node:24.)
     */
    expect(files.length, 'glob matched nothing — this test would pass vacuously').toBeGreaterThan(50)
    const offenders = files.filter((f) => /quality=\{70\}/.test(readFileSync(f, 'utf8')))
    expect(offenders, 'these would re-split the tier and double their encodes').toEqual([])
  })
})
