import { describe, expect, it } from 'vitest'
import { langMetadata } from './lang-metadata'
import { withShare } from './site-identity'

describe('langMetadata — the <title> follows the [lang] variant', () => {
  const en = { title: 'Post a listing | eno.vn', robots: { index: false, follow: false }, openGraph: { title: 'Post a listing | eno.vn' } }
  it('a Vietnamese render takes the Vietnamese fields and keeps everything else as the English metadata decided it', async () => {
    expect(await langMetadata(Promise.resolve({ lang: 'vi' }), en, { title: 'Đăng tin | eno.vn' })).toEqual({
      ...en, title: 'Đăng tin | eno.vn', openGraph: { title: 'Đăng tin | eno.vn' },
    })
  })
  it('a share card derived from the page (withShare) follows the Vietnamese title and description; one of its own does not', async () => {
    const shared = { ...withShare({ title: 'Brands | eno.vn', description: 'Browse by brand.', alternates: { canonical: '/brands' } }) }
    const vi = await langMetadata(Promise.resolve({ lang: 'vi' }), shared, { title: 'Thương hiệu | eno.vn', description: 'Xem theo thương hiệu.' })
    expect(vi.openGraph).toMatchObject({ title: 'Thương hiệu | eno.vn', description: 'Xem theo thương hiệu.', url: '/brands' })
    expect(vi.twitter).toMatchObject({ title: 'Thương hiệu | eno.vn', description: 'Xem theo thương hiệu.' })
    const own = { title: 'A | eno.vn', openGraph: { title: 'A campaign card' } }
    expect((await langMetadata(Promise.resolve({ lang: 'vi' }), own, { title: 'B | eno.vn' })).openGraph).toEqual({ title: 'A campaign card' })
    // A Vietnamese card named outright is kept as given.
    expect((await langMetadata(Promise.resolve({ lang: 'vi' }), shared, { title: 'Thương hiệu | eno.vn', openGraph: { title: 'Thẻ riêng' } })).openGraph).toEqual({ title: 'Thẻ riêng' })
  })
  it('every other render is the English metadata, unchanged', async () => {
    expect(await langMetadata(Promise.resolve({ lang: 'en' }), en, { title: 'Đăng tin | eno.vn' })).toBe(en)
  })
})
