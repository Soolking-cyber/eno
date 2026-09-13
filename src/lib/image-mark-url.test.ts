import { describe, expect, it, vi } from 'vitest'
import { isOverlayImageUrl, overlayImagePath, overlayMarkFromUrl } from './image-mark-url'
import { hashFromUrl } from './image-hash-url'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn/')
const BASE = 'https://sb.eno.vn/storage/v1/object/public/listings/'

describe('overlayMarkFromUrl', () => {
  it('reads both inks and the stored size from a clean import', () => {
    expect(overlayMarkFromUrl(`${BASE}affiliate/m/tiki-123-0-mtv9x9-ab12c-idl-1200x900-h0123456789abcdef.webp`))
      .toEqual({ cover: 'dark', contain: 'light', width: 1200, height: 900 })
    expect(overlayMarkFromUrl(`${BASE}affiliate/m/x-1-a-ild-500x500.webp`)).toEqual({ cover: 'light', contain: 'dark', width: 500, height: 500 })
  })

  // ⛔ The safety property: every pre-existing image has a BURNED mark, and an overlay on top of it
  // would print eno.vn twice.
  it('refuses every image that is not a clean import in our bucket', () => {
    expect(overlayMarkFromUrl(`${BASE}affiliate/electronics-mtv9x9k7-wz7d8.webp`)).toBeNull()
    expect(overlayMarkFromUrl(`${BASE}affiliate/cellphones-g-mtv-abcde-h0123456789abcdef.webp`)).toBeNull()
    expect(overlayMarkFromUrl(`${BASE}1789024987094-gv3f9a-h3c88cdcdda6e6dcd.webp`)).toBeNull()
    // the right path shape in someone else's bucket or host proves nothing
    expect(overlayMarkFromUrl('https://evil.example/affiliate/m/x-1-a-idd-500x500.webp')).toBeNull()
    // the FULL look-alike path on a foreign host, and smuggled into a query string (the first cut
    // matched both)
    expect(overlayMarkFromUrl('https://evil.example/storage/v1/object/public/listings/affiliate/m/x-1-a-idd-500x500.webp')).toBeNull()
    expect(overlayMarkFromUrl('https://cdn.example/p.jpg?u=https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/x-1-a-idd-500x500.webp')).toBeNull()
    expect(overlayMarkFromUrl(`${BASE}affiliate/m/sub/x-1-a-idd-500x500.webp`)).toBeNull()
    expect(overlayMarkFromUrl('https://sb.eno.vn/storage/v1/object/public/avatars/affiliate/m/x-1-a-idd-500x500.webp')).toBeNull()
    // under affiliate/m/ but malformed (no size) — not ours to mark
    expect(overlayMarkFromUrl(`${BASE}affiliate/m/x-1-a-idd.webp`)).toBeNull()
    expect(overlayMarkFromUrl(`${BASE}affiliate/m/x-1-a-idd-0x500.webp`)).toBeNull()
    expect(overlayMarkFromUrl(null)).toBeNull()
  })

  it('accepts only the stored URL form (no query — stored URLs never carry one)', () => {
    expect(isOverlayImageUrl(`${BASE}affiliate/m/x-1-a-ill-640x480.webp`)).toBe(true)
    expect(isOverlayImageUrl(`${BASE}affiliate/m/x-1-a-ill-640x480.webp?w=384`)).toBe(false)
  })
})

describe('overlayImagePath', () => {
  it('round-trips and keeps the dHash readable by image-hash-url', () => {
    const p = overlayImagePath('tiki-123-0', { cover: 'dark', contain: 'light' }, 1200, 900, '0123456789ABCDEF', 'mtv9x9', 'ab12c')
    expect(p).toBe('affiliate/m/tiki-123-0-mtv9x9-ab12c-idl-1200x900-h0123456789abcdef.webp')
    expect(overlayMarkFromUrl(BASE + p)).toEqual({ cover: 'dark', contain: 'light', width: 1200, height: 900 })
    expect(hashFromUrl(BASE + p)).toBe('0123456789abcdef')
  })

  it('drops a malformed hash rather than writing one hashFromUrl would misread', () => {
    expect(overlayImagePath('a', { cover: 'light', contain: 'light' }, 10, 20, 'nothex', 's', 'r')).toBe('affiliate/m/a-s-r-ill-10x20.webp')
  })
})
