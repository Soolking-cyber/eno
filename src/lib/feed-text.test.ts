import { describe, expect, it } from 'vitest'
import { cutText, decodeEntities, entityRepairs, feedDescription } from './feed-text'

/** Live strings from the translation audit (2026-10-02, F9). */
describe('decodeEntities', () => {
  it('decodes what the AccessTrade feeds carry', () => {
    expect(decodeEntities('Sách Fun for Movers SB w Home Fun &amp; Online Activities')).toBe('Sách Fun for Movers SB w Home Fun & Online Activities')
    expect(decodeEntities('Máy Vắt Cam Lock&amp;Lock EJJ231 40W')).toBe('Máy Vắt Cam Lock&Lock EJJ231 40W')
    expect(decodeEntities('Độ sạch &gt; 98 Độ ẩm &lt; 10')).toBe('Độ sạch > 98 Độ ẩm < 10')
    expect(decodeEntities('Olympus E-500 body New 95% nobox (BH 6 Th&aacute;ng)')).toBe('Olympus E-500 body New 95% nobox (BH 6 Tháng)')
    expect(decodeEntities('Loại bàn phím: &bull; Dell KB216')).toBe('Loại bàn phím: • Dell KB216')
    expect(decodeEntities('&#8220;Hay&#8221; &#x2014; ok')).toBe('“Hay” — ok')
  })

  it('decodes to a fixed point, so a second run changes nothing, and leaves what it does not know', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('<b>')
    expect(decodeEntities('&amp;amp;amp;amp;amp;lt;')).toBe('<')
    expect(decodeEntities('Th&abreve;ng')).toBe('Thăng')
    // Any accented letter HTML names as letter + mark (a CV read by a model, 2026-10-16), and the few it names otherwise.
    expect(decodeEntities('Institut fran&ccedil;ais, Universit&eacute; Lumi&egrave;re Lyon 2')).toBe('Institut français, Université Lumière Lyon 2')
    expect(decodeEntities('M&uuml;ller, Pe&ntilde;a, &Aring;sa, Dvo&rcaron;&aacute;k, &Lstrok;ukasz, &Ouml;zg&uuml;r &Scedil;ahin, &Idot;zmir')).toBe('Müller, Peña, Åsa, Dvořák, Łukasz, Özgür Şahin, İzmir')
    expect(decodeEntities('Bj&oslash;rn, Stra&szlig;e, &AElig;sir')).toBe('Bjørn, Straße, Æsir')
    // Case decides the letter. A real name for ANOTHER character is never made a letter (gate review, 2026-10-16), and
    // a name HTML does not have stays as it is — even one Unicode could compose.
    expect(decodeEntities('&Eacute;cole &eacute;cole')).toBe('École école')
    expect(decodeEntities('a &sdot; b, &odot;, &tdot;, &eDot;, &EDot;')).toBe('a &sdot; b, &odot;, &tdot;, &eDot;, &EDot;')
    expect(decodeEntities('&wacute; &qacute; &xcedil; &Gacute; &idot;')).toBe('&wacute; &qacute; &xcedil; &Gacute; &idot;')
    expect(decodeEntities('&Cdot;&cdot; &Edot;&edot; &Zdot;&zdot; &gacute; &Gcedil;')).toBe('Ċċ Ėė Żż ǵ Ģ')
    // An all-capitals name is not HTML's either; it keeps the old lower-case fallback for the named letters only.
    expect(decodeEntities('&EACUTE;')).toBe('é')
    for (const t of ['&amp;amp;amp;', 'Fun &amp; Online', '&amp;lt;b&amp;gt;']) expect(decodeEntities(decodeEntities(t)), t).toBe(decodeEntities(t))
    expect(decodeEntities('R&D, Q&A & AT&T')).toBe('R&D, Q&A & AT&T')
    expect(decodeEntities('&unknownname; &#0; &#xD800;')).toBe('&unknownname; &#0; &#xD800;')
  })
})

describe('feedDescription', () => {
  it('strips tags BEFORE decoding, so a decoded "<" never reads as a tag', () => {
    expect(feedDescription('<p>Độ ẩm &lt; 10 Tỉ lệ nảy mầm &gt; 85</p>')).toBe('Độ ẩm < 10 Tỉ lệ nảy mầm > 85')
    expect(feedDescription('a&nbsp;&nbsp;b\n\nc')).toBe('a b c')
  })
})

describe('entityRepairs', () => {
  it('names only the columns that still carry an entity, with their decoded form', () => {
    expect(entityRepairs({ title: 'Lock&Lock juicer', titleVi: 'Máy Vắt Cam Lock&amp;Lock', description: 'x &gt; y', descriptionVi: null })).toEqual({
      titleVi: { from: 'Máy Vắt Cam Lock&amp;Lock', to: 'Máy Vắt Cam Lock&Lock' },
      description: { from: 'x &gt; y', to: 'x > y' },
    })
    expect(entityRepairs({ title: 'Clean', titleVi: 'Sạch', description: 'R&D', descriptionVi: '' })).toEqual({})
  })
})

describe('cutText', () => {
  it('never ends on half of a surrogate pair', () => {
    expect(cutText('ab😀', 3)).toBe('ab')
    expect(cutText('ab😀', 4)).toBe('ab😀')
    expect(feedDescription('x&#x1F600;', 2)).toBe('x')
  })
})

/**
 * cutText's CONTRACT, now that it guards every server-side free-text cut (break-ui, 2026-10-05: titles,
 * descriptions, names, bios, messages, previews). It is `.slice(0, max)` and nothing else — no ellipsis, no
 * word-boundary search, newlines kept — except that it never ends on half of a surrogate pair.
 */
describe('cutText — the write-path contract', () => {
  it('is exactly .slice(0, max) for ordinary text: no ellipsis, no word boundary', () => {
    const s = 'Cho thuê căn hộ 3PN Vinhomes Central Park'
    expect(cutText(s, 12)).toBe(s.slice(0, 12))
    expect(cutText(s, 12).endsWith('…')).toBe(false)
  })
  it('returns the whole string at or under the limit', () => {
    expect(cutText('abc', 3)).toBe('abc')
    expect(cutText('abc', 10)).toBe('abc')
    expect(cutText('', 5)).toBe('')
  })
  it('keeps an unbroken string to the full limit (a pasted URL is never emptied)', () => {
    const url = 'https://example.com/' + 'x'.repeat(3000)
    expect(cutText(url, 2000)).toHaveLength(2000)
  })
  it('keeps newlines inside the limit', () => {
    expect(cutText('Địa chỉ:\n123 Nguyễn Văn Linh', 12)).toBe('Địa chỉ:\n123')
  })
  it('drops only the half surrogate at the cut, never more', () => {
    expect(cutText('a'.repeat(139) + '😀', 140)).toBe('a'.repeat(139))
    expect(cutText('a'.repeat(138) + '😀', 140)).toBe('a'.repeat(138) + '😀')
  })
})
