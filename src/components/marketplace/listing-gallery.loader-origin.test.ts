// @vitest-environment jsdom
/**
 * isShowing MATCHES WHAT THE LOADER REALLY SENDS (commit review, 2026-11-09): on the box, image-loader.ts swaps a public
 * storage origin for the internal one inside `url=`, so a comparison with the public URL alone never matched in production.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/image-loader', () => ({
  internalize: (src: string) => src.replace('https://sb.eno.vn', 'http://kong.internal:8000'),
}))

const { isShowing } = await import('./listing-gallery')
const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp'
const el = (src: string) => ({ currentSrc: src, src } as unknown as HTMLImageElement)

describe('isShowing behind the loader\'s origin swap', () => {
  it('the optimizer URL carrying the INTERNAL origin is this public photo', () => {
    const internal = 'http://kong.internal:8000/storage/v1/object/public/listings/a.webp'
    expect(isShowing(el(`${location.origin}/_next/image?url=${encodeURIComponent(internal)}&w=64&q=60`), PHOTO)).toBe(true)
  })
  it('another internal photo is not', () => {
    const other = 'http://kong.internal:8000/storage/v1/object/public/listings/b.webp'
    expect(isShowing(el(`${location.origin}/_next/image?url=${encodeURIComponent(other)}&w=64&q=60`), PHOTO)).toBe(false)
  })
})
