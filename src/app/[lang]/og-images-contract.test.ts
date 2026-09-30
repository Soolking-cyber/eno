import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SITE_NAME } from '@/lib/edition'
import { SHARE_CARD, SHARE_CARD_ALT, ogLocaleFor, pageOpenGraph, pageShare, pageTwitter, withShare } from '@/lib/site-identity'

/**
 * ⛔ EVERY PAGE THAT SETS ITS OWN LINK PREVIEW SETS A WHOLE ONE.
 *
 * Next REPLACES the layout's `openGraph` (and `twitter`) with a page's, it does not merge. So a page
 * that wrote `openGraph: { title, description }` shipped no og:image, no og:site_name and no og:type —
 * /c/rentals, /c/rentals/d1, /hcmc-rent-index and the guides that named themselves unfurled with no
 * picture (curl as facebookexternalhit on prod, 2026-09-29) — and still carried the LAYOUT's
 * twitter:title, "eno.vn - Trusted Expat Marketplace in Vietnam", which X reads before og:title.
 * pageShare() / withShare() (src/lib/site-identity.ts) build both cards with the image, the site
 * name, the type and the locale.
 */
const ROOT = join(process.cwd(), 'src', 'app', '[lang]')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}
const FILES = sources(ROOT).map((p) => ({ path: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))

/** The two that write the object out in full, image included — each is pinned below. */
const FULL_LITERALS = ['layout.tsx', 'listings/[id]/(pdp)/page.tsx']
const OG_LITERAL = /openGraph:\s*\{/

/** The `{ … }` that follows `openGraph:` — brace-matched, so a nested `{ ...SHARE_CARD }` stays inside. */
function ogBlock(text: string): string {
  const start = text.search(OG_LITERAL)
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return ''
}

describe('page previews are built whole', () => {
  it('scans real files (a wrong root would pass vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(150)
    for (const f of FULL_LITERALS) expect(FILES.some((x) => x.path === f), f).toBe(true)
    expect(FILES.some((f) => f.path === 'c/[category]/(index)/page.tsx' && f.text.includes('pageShare('))).toBe(true)
  })

  it('no page writes an `openGraph` literal — use pageShare() / withShare()', () => {
    const hits = FILES.filter((f) => !FULL_LITERALS.includes(f.path) && OG_LITERAL.test(f.text)).map((f) => f.path)
    expect(hits, 'use pageShare() — Next replaces the parent openGraph and drops og:image').toEqual([])
  })

  it.each(FULL_LITERALS)('%s keeps an image in its own openGraph', (path) => {
    const block = ogBlock(FILES.find((f) => f.path === path)!.text)
    expect(block, path).toMatch(/\bimages:/)
  })

  it('every guide and landing previews as itself, not as the home page', () => {
    // 36 phone guides had no preview of their own: shared, each read "eno.vn - Trusted Expat
    // Marketplace in Vietnam" (2026-09-29). modelMeta (iphone-18-vietnam/model-landing.tsx) is pageShare inside.
    const guides = FILES.filter((f) => /<Seo(Article|Landing)\b/.test(f.text) && /export (const metadata|async function generateMetadata)/.test(f.text))
    expect(guides.length).toBeGreaterThan(50)
    expect(guides.filter((f) => !/\b(pageShare|withShare|modelMeta)\(/.test(f.text)).map((f) => f.path)).toEqual([])
  })

  it('a page that sets openGraph any other way sets twitter too, or the layout’s title rides along', () => {
    const hits = FILES.filter((f) => /\bopenGraph:/.test(f.text) && !/\btwitter:/.test(f.text)).map((f) => f.path)
    expect(hits).toEqual([])
  })
})

describe('pageOpenGraph / pageTwitter', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const og = { title: 'Apartments for Rent in Ho Chi Minh City | eno.vn', description: 'Places for rent, each linked to its original.', url: '/c/rentals' }

  it('defaults to the share card, the site name, website, and the locale of the words', () => {
    expect(pageOpenGraph(og)).toEqual({
      ...og,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'en_US',
      images: [{ ...SHARE_CARD, alt: SHARE_CARD_ALT }],
    })
    expect(pageTwitter(og)).toEqual({ card: 'summary_large_image', title: og.title, description: og.description, images: [SHARE_CARD.url] })
  })

  it('a page’s own image wins on both cards, and an article says so', () => {
    const images = [{ url: 'https://cdn.example/cover.jpg', width: 1200, height: 630 }]
    const { openGraph, twitter } = pageShare({ ...og, type: 'article', images })
    expect(openGraph).toMatchObject({ type: 'article', images })
    expect(twitter).toMatchObject({ images: ['https://cdn.example/cover.jpg'] })
  })

  it('eno.forum’s previews carry eno.forum’s own name', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    const forum = await import('@/lib/site-identity')
    const card = forum.pageOpenGraph(og) as { siteName: string; images: { alt: string }[] }
    expect(card.siteName).toBe('eno.forum')
    expect(card.images[0].alt).toBe('eno.forum — buy, sell, rent and connect in Vietnam')
  })

  it('withShare carries the page’s own title, description and canonical into both cards', () => {
    const m = withShare({ title: `How trust works — ${SITE_NAME}`, description: 'One Trust Score, in color.', alternates: { canonical: '/trust' } })
    expect(m.title).toBe(`How trust works — ${SITE_NAME}`)
    expect(m.openGraph).toMatchObject({ title: m.title, description: m.description, url: '/trust', siteName: SITE_NAME })
    expect(m.twitter).toMatchObject({ title: m.title, description: m.description })
  })
})

describe('ogLocaleFor — the language the preview is written in', () => {
  it.each([
    ['Bán đồ cũ ở đâu được giá | eno.vn', 'Trung vị giá rao 2.480.000 đ, và khoảng giá theo từng loại món.', 'vi_VN'],
    ['Cho thuê nhà / biệt thự 5PN — P. Thảo Điền, Quận 2', '', 'vi_VN'],
    // Each half on its own: glued, "Minh | eno.vn" + "tin cho" is a four-word unmarked run.
    ['Cho thuê tại Quận 1, TP. Hồ Chí Minh | eno.vn', '1.627 tin cho thuê tại Quận 1, TP. Hồ Chí Minh.', 'vi_VN'],
    ['Expat Housing in Vietnam: Renting in Ho Chi Minh City | eno.vn', 'Apartments, houses and rooms for rent.', 'en_US'],
    // The detector's false positive — one ạ — is English, and says so.
    ['Office / shopfront · 65 m² for rent — Tây Thạnh Ward, Tân Phú District', '', 'en_US'],
    // A bilingual title is settled by the English sentence under it.
    ['Prohibited items & services | Hàng hóa & dịch vụ cấm | eno.vn', 'Goods and services that must not be listed on eno.vn, per Vietnamese law.', 'en_US'],
    // …and a NAME in the title does not outvote the sentence: the Vietnamese storefront said en_US.
    ['Honeycomb House | eno.vn', 'Honeycomb House trên eno.vn: 229 tin đăng về Cho thuê tại TP. Hồ Chí Minh.', 'vi_VN'],
    // A French/Spanish accent is not Vietnamese.
    ['Café for rent in District 1 | eno.vn', '', 'en_US'],
    ['한국 화장품 세트', '', undefined],
  ])('%s → %s', (title, description, locale) => {
    expect(ogLocaleFor(title, description)).toBe(locale)
  })
})
