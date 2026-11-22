/**
 * Guide pictures, reading time and the question outline (owner 2026-11-22: "i liked they have images and nice looking content
 * with outline questions"): the schema's `images` field, the helpers, and what the REAL SeoArticle renders from a library guide's
 * sections — and that the Teach in Vietnam pages, which share the section builder, render exactly what they did.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => null }))
vi.mock('./seo-article-related', () => ({ keepReading: (related?: unknown[]) => related ?? [] }))
vi.mock('./seo-listing-rail', () => ({ SeoListingRail: () => null }))
vi.mock('./here-link', () => ({ HereLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))

const HERO = 'a'.repeat(64)
const FIG = 'b'.repeat(64)
const para = 'Renting here is simple enough, and the checks below matter more than which shop you pick for the week.'
const guide = (extra: Record<string, unknown> = {}) => ({
  slug: 'rent-a-bike', title: 'Renting a motorbike in Ho Chi Minh City', description: 'd'.repeat(120), h1: 'Renting a motorbike', eyebrow: 'Getting around',
  intro: 'i'.repeat(90), keyPoints: ['One', 'Two', 'Three'],
  sections: [1, 2, 3, 4].map((i) => ({
    id: `part-${i}`, title: `Part ${i}`,
    blocks: [{ type: 'p', text: para }, { type: 'h3', text: `Do I need a licence for part ${i}?` }, { type: 'p', text: para }, { type: 'h3', text: 'A plain sub-heading' }],
  })),
  faqs: [], sources: [{ title: 'Law', publisher: 'Gov', url: 'https://thuvienphapluat.vn/x' }], related: [], lastChecked: '2026-11-01', ...extra,
})
const images = {
  hero: { id: HERO, w: 1600, h: 900, alt: '', caption: 'A rental shop counter at dusk' },
  figures: [{ id: FIG, w: 1600, h: 1200, alt: 'A checklist of what to inspect on a rented motorbike before riding off', after: 'part-2' }],
}

let schema: typeof import('@/lib/teach-guides/schema')
let helpers: typeof import('@/lib/guides/guide-images')
let body: typeof import('./teach-guide-body')
let SeoArticle: typeof import('./seo-article').SeoArticle

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  schema = await import('@/lib/teach-guides/schema')
  helpers = await import('@/lib/guides/guide-images')
  body = await import('./teach-guide-body')
  ;({ SeoArticle } = await import('./seo-article'))
})

const issues = (g: unknown) => {
  const r = schema.teachGuideSchema.safeParse(g)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('the images field', () => {
  it('is optional, and a hero with figures parses', () => {
    expect(issues(guide())).toEqual([])
    expect(issues(guide({ images }))).toEqual([])
  })
  it('names a picture only by a SHA-256 id — never a URL or another host', () => {
    expect(issues(guide({ images: { hero: { ...images.hero, id: 'https://evil.test/x.webp' } } })).join()).toMatch(/SHA-256/)
    expect(issues(guide({ images: { hero: { ...images.hero, src: 'https://evil.test/x.webp' } } })).length).toBeGreaterThan(0)
  })
  it('a figure must follow a real section, once, and say what it shows', () => {
    expect(issues(guide({ images: { figures: [{ ...images.figures[0], after: 'nowhere' }] } })).join()).toMatch(/does not exist/)
    expect(issues(guide({ images: { figures: [images.figures[0], { ...images.figures[0], id: HERO }] } })).join()).toMatch(/two figures/)
    expect(issues(guide({ images: { figures: [{ ...images.figures[0], alt: '' }] } })).join()).toMatch(/alt text/)
  })
  it('a section may not take an id a question anchor uses', () => {
    const g = guide()
    g.sections[1].id = 'part-1-q1'
    expect(issues(g).join()).toMatch(/question anchor/)
  })
  it('alt and caption are plain text', () => {
    expect(issues(guide({ images: { hero: { ...images.hero, caption: 'See [this](https://x.test)' } } })).join()).toMatch(/markup/)
  })
})

describe('the helpers', () => {
  it('a picture address is our storage, by id', () => {
    expect(helpers.guideImageSrc(HERO)).toBe(`https://sb.eno.vn/storage/v1/object/public/listings/guides/${HERO}.webp`)
    expect(helpers.guideImageSrc('../x')).toBeNull()
  })
  it('question sub-headings get stable anchors per section; plain ones do not', () => {
    const q = helpers.questionAnchors(schema.teachGuideSchema.parse(guide()))
    expect(q[0]).toEqual([{ id: 'part-1-q1', title: 'Do I need a licence for part 1?', block: 1 }])
    expect(q.flat()).toHaveLength(4)
  })
  it('reading time rounds up and is never 0', () => {
    expect(helpers.readingMinutes(schema.teachGuideSchema.parse(guide()), 'en')).toBeGreaterThanOrEqual(1)
  })
})

async function page(g: ReturnType<typeof guide>, opts?: { outline?: boolean; figures?: boolean }) {
  const parsed = schema.teachGuideSchema.parse(g)
  const sections = body.teachGuideSections(parsed, () => true, 'en', opts)
  return renderToStaticMarkup(
    await SeoArticle({
      content: {
        eyebrow: 'Guide', h1: parsed.h1, intro: parsed.intro, canonical: '/guides/rent-a-bike', lang: 'en', published: '2026-11-01',
        ledeRow: parsed.images?.hero ? <body.GuideFigure pic={parsed.images.hero} lang="en" priority /> : undefined,
        sections, faqs: [], readingMinutes: helpers.readingMinutes(parsed, 'en'),
        ...(parsed.images?.hero ? { image: [helpers.guideImageSrc(parsed.images.hero.id)!] } : {}),
      },
    }),
  )
}

describe('a library guide page', () => {
  it('shows the hero and the figure after its section, each labelled an AI illustration', async () => {
    const html = await page(guide({ images }), { outline: true, figures: true })
    expect(html.match(/AI illustration/g)).toHaveLength(2)
    expect(html).toContain('A rental shop counter at dusk')
    expect(html).toContain('alt="A checklist of what to inspect')
    expect(html.indexOf(FIG)).toBeGreaterThan(html.indexOf('id="part-2"'))
    expect(html.indexOf(FIG)).toBeLessThan(html.indexOf('id="part-3"'))
  })
  it('lists the question sub-headings under their section in "On this page", and they are anchors', async () => {
    const html = await page(guide(), { outline: true })
    expect(html).toContain('id="part-3-q1"')
    expect(html).toContain('href="#part-3-q1"')
    expect(html, 'a plain sub-heading is not in the outline').not.toMatch(/href="#[^"]*">A plain sub-heading/)
  })
  it('says how long it takes to read, and gives Google the hero as an absolute image', async () => {
    const html = await page(guide({ images }), { outline: true, figures: true })
    expect(html).toMatch(/\d+ min read/)
    expect(html).toContain(`"image":["https://sb.eno.vn/storage/v1/object/public/listings/guides/${HERO}.webp"]`)
  })
  it('the Teach in Vietnam builder (no options) renders what it did: no anchors, no outline entries, no figures', async () => {
    const html = await page(guide({ images }))
    expect(html).not.toContain('id="part-3-q1"')
    expect(html).not.toContain('href="#part-3-q1"')
    expect(html).not.toContain(FIG)
  })
})
