import { describe, expect, it } from 'vitest'
import { isTikiCdnUrl, parseTikiGallery, tikiProductId } from './tiki-gallery'

describe('tikiProductId', () => {
  it('digs the product id out of an encoded affiliate deep link', () => {
    expect(tikiProductId(
      'https://go.isclix.com/deep_link/7053736680188167797/123?url=https%3A%2F%2Ftiki.vn%2Fsach-ielts-p415822.html%3Fspid%3D118954',
    )).toBe('415822')
  })

  // ⛔ The regression this pins: matching the OUTER url returns the publisher id, which is a
  // valid-looking number that fetches the wrong product.
  it('does not mistake the publisher id in the path for a product id', () => {
    expect(tikiProductId('https://go.isclix.com/deep_link/7053736680188167797/123?url=https%3A%2F%2Ftiki.vn%2F')).toBeNull()
  })

  it('reads a bare Tiki url', () => {
    expect(tikiProductId('https://tiki.vn/mon-hang-p987654.html?spid=1')).toBe('987654')
  })

  it('falls back to scanning a malformed link rather than throwing', () => {
    expect(tikiProductId('not a url at all -p42.html')).toBe('42')
  })

  it('returns null for null and for a link with no id', () => {
    expect(tikiProductId(null)).toBeNull()
    expect(tikiProductId('https://tiki.vn/khuyen-mai')).toBeNull()
  })
})

describe('parseTikiGallery', () => {
  const body = (imgs: unknown) => JSON.stringify({ id: 1, name: 'Sách', images: imgs })

  it('prefers large_url and caps at max', () => {
    const out = parseTikiGallery(body([
      { large_url: 'https://salt.tikicdn.com/1.jpg', base_url: 'https://salt.tikicdn.com/1s.jpg' },
      { base_url: 'https://salt.tikicdn.com/2.jpg' },
      { large_url: 'https://salt.tikicdn.com/3.jpg' }, { large_url: 'https://salt.tikicdn.com/4.jpg' },
      { large_url: 'https://salt.tikicdn.com/5.jpg' }, { large_url: 'https://salt.tikicdn.com/6.jpg' },
    ]), 5)
    expect(out).toEqual(['https://salt.tikicdn.com/1.jpg', 'https://salt.tikicdn.com/2.jpg', 'https://salt.tikicdn.com/3.jpg', 'https://salt.tikicdn.com/4.jpg', 'https://salt.tikicdn.com/5.jpg'])
  })

  it('dedupes a repeated cover rather than shipping the same photo five times', () => {
    expect(parseTikiGallery(body([
      { large_url: 'https://salt.tikicdn.com/1.jpg' }, { large_url: 'https://salt.tikicdn.com/1.jpg' }, { large_url: 'https://salt.tikicdn.com/2.jpg' },
    ]), 5)).toEqual(['https://salt.tikicdn.com/1.jpg', 'https://salt.tikicdn.com/2.jpg'])
  })

  /**
   * ⛔ THE WHOLE REASON THIS TAKES A RAW BODY. The bot challenge answers 200 with HTML, so a
   * caller checking `res.ok` sees success. Returning null here is what lets the backfill count
   * a block instead of recording "this product has no images".
   */
  it('returns null for the HTML bot-challenge page that answers 200', () => {
    expect(parseTikiGallery('<!DOCTYPE html>\n<html lang="en">', 5)).toBeNull()
  })

  it('returns null for truncated JSON rather than throwing', () => {
    expect(parseTikiGallery('{"images":[{"large_url":"htt', 5)).toBeNull()
  })

  /**
   * ⛔ A THROTTLE ENVELOPE IS VALID JSON. Treating it as "this product has no extra photos"
   * reset the caller's backoff and let it keep hammering through a block it had caused.
   */
  it('returns null for an error envelope, not an empty gallery', () => {
    expect(parseTikiGallery('{"error":"rate limited"}', 5)).toBeNull()
    expect(parseTikiGallery('{"message":"forbidden"}', 5)).toBeNull()
  })

  it('refuses a response for a different product', () => {
    // Otherwise another product's photographs get attached to this listing.
    expect(parseTikiGallery(body([{ large_url: 'https://salt.tikicdn.com/1.jpg' }]), 5, '999')).toBeNull()
    expect(parseTikiGallery(body([{ large_url: 'https://salt.tikicdn.com/1.jpg' }]), 5, '1'))
      .toEqual(['https://salt.tikicdn.com/1.jpg'])
  })

  it('never returns more than one image for a nonsense max', () => {
    expect(parseTikiGallery(body([{ large_url: 'https://salt.tikicdn.com/1.jpg' }, { large_url: 'https://salt.tikicdn.com/2.jpg' }]), -1))
      .toEqual(['https://salt.tikicdn.com/1.jpg'])
  })

  it('returns an empty array — not null — for a real product with no images', () => {
    // The distinction matters: [] means "Tiki answered, nothing to add"; null means "blocked".
    expect(parseTikiGallery(body([]), 5)).toEqual([])
    expect(parseTikiGallery(JSON.stringify({ id: 1, name: 'Sách' }), 5)).toEqual([])
  })

  it('drops a non-http entry that is not the cover', () => {
    expect(parseTikiGallery(body([
      { large_url: 'https://salt.tikicdn.com/1.jpg' }, { large_url: 'data:image/png;base64,x' },
    ]), 5)).toEqual(['https://salt.tikicdn.com/1.jpg'])
  })

  it('refuses the gallery when the non-http entry IS the cover', () => {
    expect(parseTikiGallery(body([
      { large_url: 'data:image/png;base64,x' }, { large_url: 'https://salt.tikicdn.com/1.jpg' },
    ]), 5)).toEqual([])
  })
})

/**
 * ⛔⛔ SSRF BOUNDARY. These URLs come from a third-party API response and are fetched
 * SERVER-SIDE from the production VN box, which shares a Docker network with Postgres, the
 * Supabase gateway and both app containers. A `startsWith('http')` check accepted loopback,
 * link-local metadata, and any attacker-controlled host.
 */
describe('isTikiCdnUrl', () => {
  it('accepts the real CDN over TLS', () => {
    expect(isTikiCdnUrl('https://salt.tikicdn.com/ts/p/1.jpg')).toBe(true)
    expect(isTikiCdnUrl('https://vcdn.tikicdn.com/x.png')).toBe(true)
  })

  it('refuses plaintext http even on the right host', () => {
    expect(isTikiCdnUrl('http://salt.tikicdn.com/a.jpg')).toBe(false)
  })

  it('refuses loopback and cloud metadata', () => {
    expect(isTikiCdnUrl('http://127.0.0.1:8000/x')).toBe(false)
    expect(isTikiCdnUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isTikiCdnUrl('http://db:5432/')).toBe(false)
  })

  it('refuses the tricks a bare string match would fall for', () => {
    expect(isTikiCdnUrl('https://salt.tikicdn.com@evil.com/a.jpg')).toBe(false)
    expect(isTikiCdnUrl('https://evil.com/#https://salt.tikicdn.com/')).toBe(false)
    expect(isTikiCdnUrl('https://tikicdn.com.evil.com/a.jpg')).toBe(false)
  })

  it('refuses junk without throwing', () => {
    expect(isTikiCdnUrl('not a url')).toBe(false)
    expect(isTikiCdnUrl('')).toBe(false)
  })

  it('filters a non-CDN url out of a parsed gallery', () => {
    const body = JSON.stringify({
      id: 1, name: 'Sách',
      images: [{ large_url: 'https://salt.tikicdn.com/ok.jpg' }, { large_url: 'http://169.254.169.254/x' }],
    })
    expect(parseTikiGallery(body, 5)).toEqual(['https://salt.tikicdn.com/ok.jpg'])
  })
})

describe('parseTikiGallery — the cover is not optional', () => {
  /**
   * ⛔ Filtering a rejected cover out SILENTLY PROMOTES a detail shot to index 0, and every
   * downstream guard then replaces a good existing cover with a close-up, permanently.
   */
  it('refuses the whole gallery when the cover url is not usable', () => {
    const body = JSON.stringify({
      id: 1, name: 'Sách',
      images: [{ large_url: 'http://169.254.169.254/x' }, { large_url: 'https://salt.tikicdn.com/2.jpg' }],
    })
    expect(parseTikiGallery(body, 5)).toEqual([])
  })

  it('still drops a bad NON-cover image', () => {
    const body = JSON.stringify({
      id: 1, name: 'Sách',
      images: [{ large_url: 'https://salt.tikicdn.com/1.jpg' }, { large_url: 'http://127.0.0.1/x' }],
    })
    expect(parseTikiGallery(body, 5)).toEqual(['https://salt.tikicdn.com/1.jpg'])
  })

  it('parses a BOM-prefixed body instead of calling it blocked', () => {
    const body = '﻿' + JSON.stringify({ id: 1, name: 'Sách', images: [{ large_url: 'https://salt.tikicdn.com/1.jpg' }] })
    expect(parseTikiGallery(body, 5)).toEqual(['https://salt.tikicdn.com/1.jpg'])
  })

  it('does not throw on a non-array images field', () => {
    expect(parseTikiGallery(JSON.stringify({ id: 1, name: 'S', images: {} }), 5)).toEqual([])
    expect(parseTikiGallery(JSON.stringify({ id: 1, name: 'S', images: [null] }), 5)).toEqual([])
  })
})
