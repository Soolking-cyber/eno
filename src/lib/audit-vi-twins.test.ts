import { describe, expect, it } from 'vitest'
import { langUrlEntries, urlsetXml } from '@/lib/sitemap'
import { VI_PILOT_MARKETPLACE, VI_PREFIX_PATHS } from '@/lib/lang-pinned'
// The deploy-time audit of the `/vi` twins (phase 1, 2026-11-19): its parsers, run on what this repo writes.
import { PILOT_PATHS, familyOf, mainText, pairsFromSitemap, readHead, readSitemap, spread, vietnameseShare } from '../../scripts/audit-vi-twins.mjs'

const HOST = 'https://eno.vn'

describe('scripts/audit-vi-twins.mjs', () => {
  it('knows the pilot paths (rule V-a: their plain URL is English whatever the cookie) — the same list as lang-pinned.ts', () => {
    expect(PILOT_PATHS).toEqual([...VI_PREFIX_PATHS])
  })

  it('reads the pairs the sitemap writes (langUrlEntries), each once, with a clean sitemap verdict', () => {
    const xml = urlsetXml([
      `  <url><loc>${HOST}</loc></url>\n`,
      ...langUrlEntries(HOST, '/c/rentals', '<lastmod>2026-11-19</lastmod>', VI_PILOT_MARKETPLACE),
      ...langUrlEntries(HOST, '/help', '', VI_PILOT_MARKETPLACE),
      ...langUrlEntries(HOST, '/about', '', VI_PILOT_MARKETPLACE),
    ], 'test')
    const pairs = pairsFromSitemap(readSitemap(xml))
    expect(pairs).toEqual([
      { plain: `${HOST}/c/rentals`, vi: `${HOST}/vi/c/rentals`, sitemap: [] },
      { plain: `${HOST}/help`, vi: `${HOST}/vi/help`, sitemap: [] },
    ])
  })

  it('flags a half pair and a plain entry whose links differ from its twin', () => {
    const links = (en: string, vi: string) => `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="vi-VN" href="${vi}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`
    const half = readSitemap(`<url><loc>${HOST}/c/a</loc>${links(`${HOST}/c/a`, `${HOST}/vi/c/a`)}</url>`)
    expect(pairsFromSitemap(half)).toEqual([{ plain: `${HOST}/c/a`, vi: `${HOST}/vi/c/a`, sitemap: ['/vi entry missing'] }])
    const lonely = readSitemap(`<url><loc>${HOST}/vi/c/b</loc>${links(`${HOST}/c/b`, `${HOST}/vi/c/b`)}</url>`)
    expect(pairsFromSitemap(lonely)[0].sitemap).toEqual(['plain entry missing'])
    const differ = readSitemap(
      `<url><loc>${HOST}/c/d</loc>${links(`${HOST}/c/d`, `${HOST}/vi/c/x`)}</url><url><loc>${HOST}/vi/c/d</loc>${links(`${HOST}/c/d`, `${HOST}/vi/c/d`)}</url>`,
    )
    expect(pairsFromSitemap(differ).find((p) => p.vi === `${HOST}/vi/c/d`)!.sitemap).toEqual(['plain and /vi links differ'])
  })

  it('reads lang, canonical and hreflang as Next writes them (hrefLang, entities)', () => {
    const html = '<!DOCTYPE html><html lang="vi" class="x"><head><link rel="canonical" href="https://eno.vn/vi/c/rentals"/>'
      + '<link rel="alternate" hrefLang="en" href="https://eno.vn/c/rentals"/><link rel="alternate" hrefLang="vi-VN" href="https://eno.vn/vi/c/rentals"/>'
      + '<link rel="alternate" hrefLang="x-default" href="https://eno.vn/c/rentals?a=1&amp;b=2"/><link rel="alternate" type="application/rss+xml" href="/feed.xml"/></head></html>'
    expect(readHead(html)).toEqual({
      lang: 'vi',
      canonicals: ['https://eno.vn/vi/c/rentals'],
      alternates: { en: 'https://eno.vn/c/rentals', 'vi-VN': 'https://eno.vn/vi/c/rentals', 'x-default': 'https://eno.vn/c/rentals?a=1&b=2' },
    })
  })

  it('measures <main> only, without scripts or styles, and tells Vietnamese prose from English prose', () => {
    const vi = '<header>Sign in with your account</header><main><h1>Căn hộ cho thuê ở Quận 7</h1><p>Tìm nhà phù hợp với giá tốt nhất, liên hệ chủ nhà trực tiếp.</p>'
      + '<script>self.__next_f.push("the and for with of your")</script><style>.a{}</style></main><footer>About us and the team</footer>'
    const t = mainText(vi)
    expect(t.source).toBe('main')
    expect(t.text).not.toContain('Sign in')
    expect(t.text).not.toContain('__next_f')
    expect(vietnameseShare(t.text).share).toBe(1)
    const en = vietnameseShare('Spacious apartment in Quận 7 with a view of the river, near the mall and all of your daily needs')
    expect(en.share).toBeLessThan(0.3)
    // Brands, numbers and diacritic-free syllables count neither way; "An" and "to" are not read as English.
    expect(vietnameseShare('iPhone 15 Pro Max 256GB Bình An xe to')).toEqual({ vi: 1, en: 0, share: 1 })
    expect(mainText('<html><body><p>Xin chào</p></body></html>').source).toBe('body')
  })

  it('groups by family and samples evenly, the hub first', () => {
    expect(['/c/rentals', '/c/rentals/d7', '/help', '/help/abc', '/schools', '/schools/vus', '/schools/awards/2026', '/about'].map(familyOf))
      .toEqual(['category', 'category×district', 'help', 'help', 'schools', 'schools', 'awards', 'other'])
    const list = Array.from({ length: 11 }, (_, i) => i)
    expect(spread(list, 5)).toEqual([0, 3, 5, 8, 10])
    expect(spread([1, 2], 5)).toEqual([1, 2])
    expect(spread(list, 1)).toEqual([0])
  })
})
