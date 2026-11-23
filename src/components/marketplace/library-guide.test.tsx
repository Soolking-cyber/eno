import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const para = 'Thuê xe ở đây khá đơn giản, và những bước kiểm tra dưới đây quan trọng hơn việc chọn cửa hàng nào.'
const HERO = 'c'.repeat(64)
const guide = (slug: string) => slug === 'pictured' ? { ...base(slug), images: { hero: { id: HERO, w: 1600, h: 900, alt: 'A rental counter at dusk, drawn flat.' } } } : (slug === 'linking' ? { ...base(slug), sections: [{ id: 'links', title: 'Links', blocks: [{ type: 'p', text: '[One](/guides/rent-a-bike) [Two](/huong-dan/thue-xe) [A later one](/guides/not-yet) [Wrong](/guides/thue-xe)' }] }, ...base(slug).sections], related: ['rent-a-bike', 'not-yet', 'nothing'] } : base(slug))
const base = (slug: string) => ({
  slug, title: 'Thuê xe điện VinFast ở TP.HCM: giá và cọc', description: 'd'.repeat(120), h1: 'Thuê xe điện VinFast', eyebrow: 'Đi lại', intro: 'i'.repeat(90),
  keyPoints: ['Một', 'Hai {{vnd:150000}}', 'Ba'], sections: [1, 2, 3].map((i) => ({ id: `phan-${i}`, title: `Phần ${i}`, blocks: [{ type: 'p', text: para }] })),
  faqs: [{ q: 'Có cần bằng lái không?', a: 'Có, bạn cần bằng lái phù hợp với loại xe.' }], sources: [{ title: 'VinFast', publisher: 'VinFast', url: 'https://vinfastauto.com/vn_vi' }], related: [], lastChecked: '2026-11-04',
})
const entries = [
  { slug: 'thue-xe', lang: 'vi', label: 'Thuê xe', blurb: 'b', published: '2026-11-01', reviewed: '2026-11-01', reviewedDigest: 'x', pair: 'rent-a-bike' },
  { slug: 'rent-a-bike', lang: 'en', label: 'Rent', blurb: 'b', published: '2026-11-01', reviewed: '2026-11-01', reviewedDigest: 'x', pair: 'thue-xe' },
  { slug: 'not-yet', lang: 'en', label: 'Later', blurb: 'b', published: '2099-01-01', reviewed: '2026-11-01', reviewedDigest: 'x' },
  { slug: 'unreviewed', lang: 'en', label: 'Unread', blurb: 'b', published: '2026-11-01' },
  { slug: 'linking', lang: 'en', label: 'Links', blurb: 'b', published: '2026-11-01', reviewed: '2026-11-01', reviewedDigest: 'x' },
  { slug: 'pictured', lang: 'en', label: 'Pictured', blurb: 'b', published: '2026-11-01', reviewed: '2026-11-01', reviewedDigest: 'x' },
  { slug: 'stale', lang: 'en', label: 'Stale', blurb: 'b', published: '2026-11-01', updated: '2026-11-03', reviewed: '2026-11-02', reviewedDigest: 'x' },
]

// The edition, switchable per test (read on every access, as library-guide.tsx reads it per call); marketplace unless a test says.
const edition = vi.hoisted(() => ({ services: false }))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<object>()), get IS_SERVICES() { return edition.services } }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/lib/guides/content', () => ({ guideContent: (slug: string) => guide(slug) }))
vi.mock('./seo-article', async (orig) => {
  const real = await orig<typeof import('./seo-article')>()
  return { ...real, Ul: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>, P: ({ children }: { children: React.ReactNode }) => <p>{children}</p>, HereLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>, SeoArticle: ({ content }: { content: { h1: string; lang: string; canonical: string; alternate?: { href: string }; ledeRow: React.ReactNode; sections: { title: string; body: React.ReactNode }[]; faqs: unknown[]; related?: { href: string }[]; approved?: { on: string; how: string }; citations?: { name: string; url: string }[] } }) => (
    <main data-lang={content.lang} data-canonical={content.canonical} data-alternate={content.alternate?.href} data-related={content.related?.map((r) => r.href).join(' ')} data-approved={content.approved ? `${content.approved.on} ${content.approved.how}` : undefined} data-citations={content.citations?.map((c) => `${c.name}|${c.url}`).join(' ')}><h1>{content.h1}</h1>{content.ledeRow}{content.sections.map((s) => <section key={s.title}><h2>{s.title}</h2>{s.body}</section>)}</main>
  ) }
})
vi.mock('@/lib/guides/registry', async (orig) => {
  const real = await orig<typeof import('@/lib/guides/registry')>()
  const content = Object.fromEntries(entries.map((e) => [e.slug, {}]))
  const isGuideLive = (e: never, now?: Date) => real.isGuideLive(e, now, content)
  return { ...real, GUIDES: entries, guideEntry: (s: string) => real.guideEntry(s, entries as never), isGuideLive, liveGuides: (now?: Date) => entries.filter((e) => isGuideLive(e as never, now)), guideLabel: (e: { label?: string }) => e.label, guideBlurb: (e: { blurb?: string }) => e.blurb }
})

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.test')
const { LibraryGuide, LibraryHub, libraryGuideMetadata, libraryHubMetadata, rentToolsHubSection } = await import('./library-guide')

describe('a page in the general guide library', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-11-04T05:00:00Z')))

  it('a Vietnamese guide is Vietnamese all round: its chrome, its address, and a link to its other language', () => {
    const html = renderToStaticMarkup(<LibraryGuide slug="thue-xe" lang="vi" />)
    expect(html).toContain('data-lang="vi"')
    expect(html).toContain('data-canonical="/huong-dan/thue-xe"')
    expect(html).toContain('data-alternate="/guides/rent-a-bike"')
    expect(html).toContain('Điểm chính')
    expect(html).toContain('Nguồn')
    expect(html).toContain('kiểm tra lần cuối')
    expect(html).not.toContain('Key points')
    expect(html).not.toContain('Sources')
  })

  it('an English one keeps English chrome', () => {
    const html = renderToStaticMarkup(<LibraryGuide slug="rent-a-bike" lang="en" />)
    expect(html).toContain('Key points')
    expect(html).toContain('Sources')
    expect(html).not.toContain('Điểm chính')
  })

  it('is a 404 at the other language\'s address, before its day, without a review, or when it does not exist', () => {
    for (const [slug, lang] of [['thue-xe', 'en'], ['rent-a-bike', 'vi'], ['not-yet', 'en'], ['unreviewed', 'en'], ['nothing', 'en']] as const) {
      expect(() => renderToStaticMarkup(<LibraryGuide slug={slug} lang={lang} />), slug).toThrow('NOT_FOUND')
      expect(libraryGuideMetadata(slug, lang).robots, slug).toEqual({ index: false })
    }
  })

  it('a guide with a hero shares it: the link preview card is the picture, at its stored size', async () => {
    const og = libraryGuideMetadata('pictured', 'en').openGraph as { images?: { url: string; width?: number; height?: number }[] }
    expect(og.images?.[0]).toMatchObject({ url: `https://sb.eno.test/storage/v1/object/public/listings/guides/${HERO}.webp`, width: 1600, height: 900 })
    const { storedSize } = await import('@/lib/guides/guide-images')
    expect(storedSize({ w: 1792, h: 1024 }), 'a wider drawing is stored 1600 wide, and the card says so').toEqual({ w: 1600, h: 914 })
    const plain = libraryGuideMetadata('rent-a-bike', 'en').openGraph as { images?: { url: string }[] }
    expect(plain.images?.[0]?.url ?? '').not.toContain('/guides/')
  })

  it('money follows the article: a Vietnamese guide prints 150.000 đ, an English one 150,000 đ', () => {
    expect(renderToStaticMarkup(<LibraryGuide slug="thue-xe" lang="vi" />)).toContain('150.000')
    expect(renderToStaticMarkup(<LibraryGuide slug="rent-a-bike" lang="en" />)).toContain('150,000')
  })

  it('links and Keep reading reach the other guides, and only live ones', () => {
    const html = renderToStaticMarkup(<LibraryGuide slug="linking" lang="en" />)
    expect(html).toContain('href="/guides/rent-a-bike"')
    expect(html).toContain('href="/huong-dan/thue-xe"')
    expect(html, 'not live yet: its words, no link').not.toContain('href="/guides/not-yet"')
    expect(html).toContain('A later one')
    expect(html, 'the wrong language address is not a page').not.toContain('href="/guides/thue-xe"')
    expect(html).toContain('data-related="/guides/rent-a-bike"')
  })

  it('each language has its own list of its own guides, and they point at each other', () => {
    const vi = renderToStaticMarkup(<LibraryHub lang="vi" />)
    expect(vi).toContain('data-lang="vi"')
    expect(vi).toContain('data-canonical="/huong-dan"')
    expect(vi).toContain('href="/huong-dan/thue-xe"')
    expect(vi).not.toContain('href="/guides/rent-a-bike"')
    expect(vi).toContain('href="/guides"')
    const en = renderToStaticMarkup(<LibraryHub lang="en" />)
    expect(en).toContain('href="/guides/rent-a-bike"')
    expect(en, 'not its day yet').not.toContain('/guides/not-yet')
    expect(en, 'nobody read it').not.toContain('/guides/unreviewed')
    expect(en).toContain('href="/huong-dan"')
    expect(libraryHubMetadata('vi').alternates).toEqual({ canonical: '/huong-dan' })
  })

  it('each hub lists the four rent tools under Tools, in its own language and at its own language’s address', () => {
    const en = renderToStaticMarkup(<LibraryHub lang="en" />)
    expect(en).toContain('<h2>Tools</h2>')
    for (const href of ['/rent-affordability-calculator', '/move-in-cost-calculator', '/rental-cost-comparison', '/vietnamese-price-converter']) expect(en).toContain(`href="${href}"`)
    expect(en).toContain('Rent affordability calculator')
    const vi = renderToStaticMarkup(<LibraryHub lang="vi" />)
    expect(vi).toContain('<h2>Công cụ</h2>')
    for (const href of ['/vi/rent-affordability-calculator', '/vi/move-in-cost-calculator', '/vi/rental-cost-comparison', '/vi/vietnamese-price-converter']) expect(vi).toContain(`href="${href}"`)
    expect(vi).toContain('So sánh chi phí thuê nhà')
    expect(vi).not.toContain('Rental cost comparison')
    // …and, last, every tool on one page (the ones eno Reach writes included).
    expect(en).toContain('href="/tools"')
    expect(en).toContain('All tools')
    expect(vi).toContain('href="/vi/tools"')
    expect(vi).toContain('Tất cả công cụ')
    // Between the guides and "How these are made".
    expect(en.indexOf('<h2>Tools</h2>')).toBeGreaterThan(en.indexOf('<h2>All guides</h2>'))
    expect(en.indexOf('<h2>Tools</h2>')).toBeLessThan(en.indexOf('<h2>How these are made</h2>'))
  })

  it('the services build gets no Tools section: the tool pages 404 there', () => {
    expect(rentToolsHubSection('en')).toHaveLength(1)
    edition.services = true
    try {
      expect(rentToolsHubSection('en')).toEqual([])
      expect(rentToolsHubSection('vi')).toEqual([])
      // …and the hub itself is a 404 there, so no render carries one either.
      expect(() => renderToStaticMarkup(<LibraryHub lang="en" />)).toThrow('NOT_FOUND')
    } finally {
      edition.services = false
    }
  })

  it('metadata names its own address and its pair', () => {
    const m = libraryGuideMetadata('thue-xe', 'vi')
    expect(m.alternates).toEqual({ canonical: '/huong-dan/thue-xe', languages: { en: '/guides/rent-a-bike', vi: '/huong-dan/thue-xe' } })
  })

  it('hands the article its approval on record and its sources: the day it was approved, linked to the hub\'s "How these are made"', () => {
    const vi = renderToStaticMarkup(<LibraryGuide slug="thue-xe" lang="vi" />)
    expect(vi).toContain('data-approved="2026-11-01 /huong-dan#how"')
    expect(vi).toContain('data-citations="VinFast|https://vinfastauto.com/vn_vi"')
    expect(renderToStaticMarkup(<LibraryGuide slug="rent-a-bike" lang="en" />)).toContain('data-approved="2026-11-01 /guides#how"')
    expect(renderToStaticMarkup(<LibraryGuide slug="stale" lang="en" />), 'updated after its approval: no approval shown').not.toContain('data-approved')
  })

  it('says which approved text it is showing, which is how eno Reach knows a rewrite has gone live', () => {
    expect(libraryGuideMetadata('thue-xe', 'vi').other).toEqual({ 'eno-guide-digest': 'x' })
    expect(libraryGuideMetadata('nothing', 'en').other).toBeUndefined()
  })
})
