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
   * ⛔ QUALITY DEFAULTS TO 70, NOT NEXT'S 75. `images.qualities` is `[60, 70]` and Next 16
   * REJECTS an out-of-list quality rather than clamping, so a 75 default would 400 every image
   * that does not pass `quality` explicitly — i.e. most of them.
   */
  it('emits the optimizer URL, defaulting quality to an ALLOWED value', async () => {
    const { default: loader } = await load({ pub: PUBLIC, internal: INTERNAL })
    const url = loader({ src: PUBLIC + OBJ, width: 640 })
    expect(url).toContain('q=70')
    expect(url).toContain('w=640')
    expect(url.startsWith('/_next/image?url=')).toBe(true)
    expect(url).toContain(encodeURIComponent(INTERNAL + OBJ))
  })

  it('honours an explicit quality', async () => {
    const { default: loader } = await load({ pub: PUBLIC, internal: INTERNAL })
    expect(loader({ src: PUBLIC + OBJ, width: 420, quality: 60 })).toContain('q=60')
  })
})
