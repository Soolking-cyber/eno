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

  /**
   * ⛔ A LOCAL IMAGE FILE IS SERVED AS ITSELF, NEVER THROUGH /_next/image. Next 16.3.x reads a local
   * source over the client's own socket with no timeout; one dropped request wedges that variant
   * until restart and hangs `load` on every page that uses it (13/20 CI e2e failures, 2026-09-27).
   * Checked with the internal origin both set and unset, because CI and dev run with it unset.
   */
  it('serves local image files as themselves, with or without the internal origin', async () => {
    for (const env of [{ pub: PUBLIC, internal: INTERNAL }, { pub: PUBLIC, internal: undefined }, { pub: undefined, internal: undefined }]) {
      const { default: loader } = await load(env)
      for (const src of ['/icons/ui/rest/camera.svg', '/brand/app-icon-120.webp', '/job-covers/tt-123_ab.png', '/_next/static/media/apple-icon.2pzlgirmzi4m6.png', '/listing-images/x.png', '/listing-images-evil/x.JPG'])
        for (const width of [64, 360, 1080])
          expect(loader({ src, width, quality: 60 }), `${src} @${width}`).toBe(src)
    }
  })

  /** The one local path that stays optimized — a route handler, immune to the hang above. */
  it('keeps /listing-images on the optimizer', async () => {
    const { default: loader, OPTIMIZED_LOCAL_PATH } = await load({ pub: PUBLIC, internal: INTERNAL })
    expect(OPTIMIZED_LOCAL_PATH).toBe('/listing-images')
    const src = '/listing-images?key=a%2Fb-c.webp'
    expect(loader({ src, width: 420 })).toBe(`/_next/image?url=${encodeURIComponent(src)}&w=420&q=60`)
  })

  /**
   * ⛔ ONLY A PLAIN IMAGE FILE IS HANDED TO THE BROWSER. A src served as-is is fetched by EVERY
   * viewer's browser, same-origin, with their cookies — so a stored `/auth/confirm?token_hash=…`
   * would sign each viewer into someone else's account, and `/\t/evil.test/x.png` becomes
   * `//evil.test/x.png` once the browser strips the tab. Everything here must instead become a
   * same-origin /_next/image URL carrying the src as data, where the optimizer reads it server-side
   * without cookies — and refuses it, because localPatterns admits only /listing-images.
   * The review that asked for this (2026-09-27) supplied the query, tab/CR/LF, `..` and /api cases.
   */
  it('sends anything that is not a plain image file to the optimizer, never to the browser', async () => {
    const { default: loader, servedAsIs } = await load({ pub: PUBLIC, internal: INTERNAL })
    const hostile = [
      // a query or a fragment — a static file needs neither, a route with side effects may
      '/icon-192.png?v=1', '/icons/categories/electronics.webp?v=5a2a3d43', '/logo-mark.svg#x', '/x.png#', '/x.png?',
      '/auth/confirm?token_hash=abc&type=magiclink', '/en/auth/confirm?token_hash=abc&type=magiclink',
      '/api/conversations/abc?peek=0',
      // another origin: directly, or after the browser strips tab/CR/LF, or via a backslash
      '//evil.test/x.png', '/\\evil.test/x.png', '/\t/evil.test/x.png', '/\n/evil.test/x.png', '/\r\\evil.test/x.png',
      '/\t\\evil.test/x.png', '/icons\\x.png', ' /x.png', '/x.png ', '/x.png\u0000', '/x .png',
      // dot segments and empty segments resolve somewhere other than they read
      '/icons/../api/me.png', '/listing-images/../icon-192.png', '/./icon-192.png', '/icons/./x.png', '/icons//x.png',
      '/.well-known/x.png', '/..png/../api/x.png',
      // percent-encoding hides any of the above from a reader
      '/%2e%2e/api/me.png', '/icons%2F..%2Fapi/x.png', '/%2F%2Fevil.test/x.png', '/icon-192%2Epng', '/%09/evil.test/x.png',
      // API routes, whatever the extension or case
      '/api/x.png', '/API/brand-logo/acme.svg', '/api/brand-logo/acme.svg',
      // not an image file at all
      '/', '', '/auth/confirm', '/sitemap.xml', '/listing-images', '/x.png/', '/icon-192.png.html', '/ảnh.png',
    ]
    for (const src of hostile) {
      expect(servedAsIs(src), JSON.stringify(src)).toBe(false)
      const out = new URL(loader({ src, width: 64 }), 'https://eno.vn/')
      expect(out.origin + out.pathname, JSON.stringify(src)).toBe('https://eno.vn/_next/image')
      expect(out.searchParams.get('url'), JSON.stringify(src)).toBe(src)
    }
    // Remote sources were never "local" and keep their optimizer URL (internalized where ours).
    expect(servedAsIs(PUBLIC + OBJ)).toBe(false)
    expect(servedAsIs('https://photo.rever.vn/v3/get/a.jpg')).toBe(false)
  })

  /**
   * ⚠️ EVERY LOCAL SRC THE APP RENDERS THROUGH `<Image>` MUST PASS, AND MUST BE A VECTOR.
   * Pass — or it silently becomes a 400 and a broken image. Vector — because a local file is now sent
   * as itself at every width, so a raster reaches a phone at its original size (the install hint's
   * 7.9 KB /icon-192.png, 2026-09-27); a raster belongs in a file sized for its box, drawn by
   * `<ArtImage>`/`<picture>`. Covers the CI fixture photo and a src written as `"/…"`, `{'/…'}`,
   * `{"/…"}`, `` {`/…`} `` or `{NAME}` for a `const NAME = '/…'` in the same file (none today). A src
   * built at runtime or read from the database is out of a static test's reach: listing photos are
   * validated where they are written (isListingImageUrl), and none renders a local path today.
   */
  it('still serves every local src the app renders through <Image>, and each is a vector', async () => {
    const { servedAsIs } = await load({ pub: PUBLIC, internal: INTERNAL })
    const { readFileSync, globSync } = await import('node:fs')
    // `(?:[^>]|=>)` so an arrow function in an earlier prop does not end the tag.
    const SRC = /<Image\b(?:[^>]|=>)*?\bsrc=(?:"([^"]*)"|\{\s*(?:(['"`])([^'"`]*)\2|([A-Za-z_$][\w$]*))\s*\})/g
    const CONST = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`]*)\2/g
    const localSrcs = (text: string) => {
      const consts = new Map([...text.matchAll(CONST)].map((m) => [m[1], m[3]] as const))
      return [...text.matchAll(SRC)].map((m) => m[1] ?? m[3] ?? consts.get(m[4]) ?? '').filter((s) => s.startsWith('/') && !s.includes('${'))
    }
    expect(localSrcs(`const LOGO = '/c.png'
      <Image alt="" src="/a/b.png" /> <Image onError={() => x} src={'/d.svg'} /> <Image src={\`/e.webp\`} />
      <Image src={LOGO} /> <Image src={listing.images[0]} /> <Image src="https://x.test/y.png" />`), 'the scan pattern itself')
      .toEqual(['/a/b.png', '/d.svg', '/e.webp', '/c.png'])
    const files = (globSync as unknown as (p: string) => string[])('src/**/*.tsx').filter((f) => !f.includes('.test.'))
    expect(files.length, 'glob matched nothing — this test would pass vacuously').toBeGreaterThan(50)
    const literals = files.flatMap((f) => localSrcs(readFileSync(f, 'utf8')).map((src) => ({ where: f, src })))
    const fixture = /const IMAGE = '([^']+)'/.exec(readFileSync('scripts/ci-fixtures.ts', 'utf8'))?.[1]
    expect(fixture, 'scripts/ci-fixtures.ts IMAGE moved').toBeTruthy()
    for (const { where, src } of [...literals, { where: 'scripts/ci-fixtures.ts', src: fixture! }]) {
      expect(servedAsIs(src), `${where}: ${src}`).toBe(true)
      expect(src, `${where}: ${src} is a raster sent at full size — size a file for it and draw it with <ArtImage>`).toMatch(/\.svg$/i)
    }
  })

  /**
   * The allowlist refuses only SPELLINGS, never a file: every image file in public/ passes, so a
   * refused local src (a query, `%`, `..`, non-ASCII) cannot be naming a real public file. A new file
   * whose name the rule would refuse fails here, not as a broken image.
   */
  it('passes every image file that exists in public/', async () => {
    const { servedAsIs } = await load({ pub: PUBLIC, internal: INTERNAL })
    const { globSync } = await import('node:fs')
    const files = (globSync as unknown as (p: string) => string[])('public/**/*').filter((f) => /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(f))
    expect(files.length, 'glob matched nothing — this test would pass vacuously').toBeGreaterThan(100)
    expect(files.map((f) => f.slice('public'.length).split('\\').join('/')).filter((p) => !servedAsIs(p))).toEqual([])
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
