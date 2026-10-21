import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fontMetrics, woff2ToSfnt } from '@/lib/sfnt'
import { EDITION_BANNED } from '@/test/edition-words'

/**
 * THE TEACH SHARE CARDS (share-cards.ts, src/app/og/teach-in-vietnam/[...card]/route.tsx): one per registry guide and
 * one for the hub, in four shapes; their words, their fit, their colours and the route that draws them. The pages
 * that name them are pinned in [slug]/page.test.ts and hub-page.test.tsx, the Article JSON-LD in
 * seo-article.image.test.tsx. The registry, the content and the font are the real ones.
 */

// The first import pulls the registry and all 41 guides' content (parsed and digest-checked at load) — slow cold. A render
// is ~50 ms; the route tests draw a handful.
vi.setConfig({ testTimeout: 30_000 })

type Cards = typeof import('./share-cards')
type Route = typeof import('@/app/og/teach-in-vietnam/[...card]/route')
let cards: Cards
let route: Route
let TEACH_GUIDES: typeof import('./registry').TEACH_GUIDES
let TEACH_HUB_H1: string

beforeAll(async () => {
  // The cards exist on the marketplace only: the edition is read once, at import.
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.resetModules()
  cards = await import('./share-cards')
  route = await import('@/app/og/teach-in-vietnam/[...card]/route')
  ;({ TEACH_GUIDES, TEACH_HUB_H1 } = await import('./registry'))
})
afterAll(() => {
  vi.unstubAllEnvs()
})

const metrics = fontMetrics(woff2ToSfnt(readFileSync('src/fonts/open-runde-bold.woff2')))
/** Every card: the hub (null) and each registry guide. */
const keys = () => [null, ...TEACH_GUIDES.map((e) => e.slug)]
const get = (card: string[]) => route.GET(new Request(`https://eno.vn/og/teach-in-vietnam/${card.join('/')}`), { params: Promise.resolve({ card }) })
/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (b: Buffer) => ({ png: b.subarray(1, 4).toString('latin1'), width: b.readUInt32BE(16), height: b.readUInt32BE(20) })
/** A shape by its name. */
const shapeNamed = (name: string) => cards.TEACH_CARD_SHAPES.find((s) => s.name === name)!

describe('a card for every registry guide and the hub, in four shapes', () => {
  it('the build renders exactly these: each guide and the hub, at 1200x630, 1200x675, 1200x900 and 1200x1200', () => {
    const params = route.generateStaticParams().map((p) => p.card.join('/'))
    const want = keys().flatMap((slug) => ['1200x630', '1200x675', '1200x900', '1200x1200'].map((s) => `${slug === null ? '' : `${slug}/`}${s}.png`))
    expect(params.sort()).toEqual(want.sort())
    expect(params).toHaveLength(4 * (TEACH_GUIDES.length + 1))
  })

  it('every shape is at least 1200 px wide (Google Discover); the link preview is 1200x630, the Article set Google’s 16x9, 4x3 and 1x1', () => {
    expect(cards.TEACH_CARD_SHAPES.map((s) => [s.name, s.width, s.height])).toEqual([
      ['1200x630', 1200, 630],
      ['1200x675', 1200, 675],
      ['1200x900', 1200, 900],
      ['1200x1200', 1200, 1200],
    ])
    expect(cards.TEACH_CARD_PREVIEW.name).toBe('1200x630')
    expect(cards.TEACH_CARD_ARTICLE.map((s) => s.name)).toEqual(['1200x675', '1200x900', '1200x1200'])
    expect(cards.TEACH_CARD_ARTICLE.map((s) => s.width / s.height)).toEqual([16 / 9, 4 / 3, 1])
  })

  it('paths: /og/teach-in-vietnam/<slug>/<shape>.png, the hub one level up — and each parses back to its card', () => {
    expect(cards.teachCardPath('english-teacher-salary-in-vietnam')).toBe('/og/teach-in-vietnam/english-teacher-salary-in-vietnam/1200x630.png')
    expect(cards.teachCardPath(null, shapeNamed('1200x1200'))).toBe('/og/teach-in-vietnam/1200x1200.png')
    for (const slug of keys())
      for (const shape of cards.TEACH_CARD_SHAPES) {
        const segments = cards.teachCardPath(slug, shape).split('/').slice(3)
        expect(cards.parseTeachCard(segments), segments.join('/')).toEqual({ slug, shape })
      }
    expect(cards.teachCardPath(null, shapeNamed('1200x675'))).toBe('/og/teach-in-vietnam/1200x675.png')
  })

  it('anything else is no card: an unknown slug or shape, a missing extension, an extra segment', () => {
    for (const segments of [
      ['no-such-guide', '1200x630.png'],
      ['english-teacher-salary-in-vietnam', '1200x700.png'],
      ['english-teacher-salary-in-vietnam', '1200x630'],
      ['english-teacher-salary-in-vietnam', '1200x630.jpg'],
      ['english-teacher-salary-in-vietnam', 'extra', '1200x630.png'],
      ['teach-in-vietnam', '1200x630.png'],
      ['1200x630.png', '1200x630.png'],
      [],
    ])
      expect(cards.parseTeachCard(segments), segments.join('/')).toBeNull()
  })
})

describe('what a card says', () => {
  it('a guide: its registry label, the series line and the wordmark; the hub: its H1', () => {
    for (const e of TEACH_GUIDES) expect(cards.teachCardText(e.slug)).toEqual({ series: 'Teach in Vietnam', title: e.label, mark: 'eno.vn' })
    expect(cards.teachCardText(null)).toEqual({ series: 'Teach in Vietnam', title: TEACH_HUB_H1, mark: 'eno.vn' })
    expect(cards.teachCardText('no-such-guide')).toBeNull()
  })

  it('the preview image entry and the JSON-LD paths, for a guide and the hub', () => {
    const salary = TEACH_GUIDES.find((e) => e.slug === 'english-teacher-salary-in-vietnam')!
    expect(cards.teachCardImage(salary.slug)).toEqual({
      url: '/og/teach-in-vietnam/english-teacher-salary-in-vietnam/1200x630.png',
      width: 1200,
      height: 630,
      alt: `${salary.label} — Teach in Vietnam, eno.vn`,
    })
    // Google's three Article shapes; the 1.91:1 preview is none of them.
    expect(cards.teachCardPaths(null)).toEqual(['/og/teach-in-vietnam/1200x675.png', '/og/teach-in-vietnam/1200x900.png', '/og/teach-in-vietnam/1200x1200.png'])
    expect(() => cards.teachCardPaths('no-such-guide')).toThrow(/no teach guide/)
  })

  it('⛔ no visa / entry / stay / PayPal vocabulary on any card — the regex teach-guides.test.ts holds the library to', () => {
    // The library's own rule, imported, not copied, so the two can never disagree: teach-guides.test.ts uses the same
    // EDITION_BANNED (src/test/edition-words.ts, where D1 moved it from that file).
    const BANNED = EDITION_BANNED
    expect('apply for a visa').toMatch(BANNED)
    for (const slug of keys()) {
      const t = cards.teachCardText(slug)!
      for (const s of [t.series, t.title, t.mark, cards.teachCardAlt(slug)]) expect(s, String(slug)).not.toMatch(BANNED)
    }
  })

  it('every character of every card is in the face — no tofu, and nothing sends the renderer to fetch a fallback font', () => {
    const missing = keys().flatMap((slug) => {
      const t = cards.teachCardText(slug)!
      // The series line prints in capitals (`textTransform: uppercase`).
      return [...`${t.series.toUpperCase()}${t.title}${t.mark}`].filter((ch) => metrics.advance(ch) === undefined)
    })
    expect(missing).toEqual([])
  })
})

describe('the title fits, whole, in every shape', () => {
  it('every name sets at a step of its shape’s ladder, in at most its lines, every word kept in order', () => {
    for (const slug of keys())
      for (const shape of cards.TEACH_CARD_SHAPES) {
        const title = cards.teachCardText(slug)!.title
        const fit = cards.fitTitle(title, shape, metrics)
        expect(fit.fits, `${slug} ${shape.name}`).toBe(true)
        expect(shape.title.sizes).toContain(fit.size)
        expect(fit.lines.length).toBeLessThanOrEqual(shape.title.lines)
        expect(fit.lines.join(' '), `${slug} ${shape.name}`).toBe(title)
      }
  })

  it('never breaks inside a place’s name, a term or an aside, and never ends a line on an article', () => {
    for (const slug of keys())
      for (const shape of cards.TEACH_CARD_SHAPES) {
        const { lines } = cards.fitTitle(cards.teachCardText(slug)!.title, shape, metrics)
        for (let i = 0; i < lines.length - 1; i++) {
          const seam = `${lines[i]}|${lines[i + 1]}`
          expect(seam).not.toMatch(/\b(?:Ho|Chi|Minh)\||\|(?:Chi|Minh|City)\b|work\|permit|English\|teachers?\b|\([^)]*\|/)
          expect(lines[i], `${slug} ${shape.name}`).not.toMatch(/\b(?:a|an|the)$/i)
        }
      }
  })

  it('the settings the layout was tuned on (2026-10-21)', () => {
    const [wide, square] = [cards.TEACH_CARD_PREVIEW, shapeNamed('1200x1200')]
    const set = (title: string, shape = wide) => cards.fitTitle(title, shape, metrics)
    expect(set('Teaching IELTS in Vietnam')).toEqual({ size: 80, lines: ['Teaching IELTS in Vietnam'], fits: true })
    expect(set('Safeguarding and professional conduct for teachers in Vietnam').lines).toEqual(['Safeguarding and', 'professional conduct', 'for teachers in Vietnam'])
    // A dangling "for" is a cost, not a ban: two lines with it beat three that split the term.
    expect(set('Vietnam work permit for English teachers (2026)').lines).toEqual(['Vietnam work permit for', 'English teachers (2026)'])
    expect(set('Is Ho Chi Minh City safe?', square).lines).toEqual(['Is Ho Chi Minh City', 'safe?'])
    // The hub's 77 characters take the second step on the wide card.
    expect(set(TEACH_HUB_H1)).toMatchObject({ size: 72, fits: true })
  })

  it('the 16:9 card sets every name exactly as the link preview does — the same type, the same lines', () => {
    for (const slug of keys()) {
      const title = cards.teachCardText(slug)!.title
      expect(cards.fitTitle(title, shapeNamed('1200x675'), metrics), String(slug)).toEqual(cards.fitTitle(title, cards.TEACH_CARD_PREVIEW, metrics))
    }
  })

  it('a name too long for any step is drawn whole in more lines and reported, never cut', () => {
    const long = Array.from({ length: 12 }, () => 'Pronunciation').join(' ')
    const fit = cards.fitTitle(long, cards.TEACH_CARD_PREVIEW, metrics)
    expect(fit.fits).toBe(false)
    expect(fit.size).toBe(56)
    expect(fit.lines.join(' ')).toBe(long)
  })
})

describe('the colours are the design tokens', () => {
  it('each equals its light-theme token in src/app/globals.css', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1].toLowerCase()
    expect({
      brand: token('brand'),
      brandDark: token('brand-dark'),
      brand100: token('brand-100'),
      ink: token('primary-foreground'),
    }).toEqual(cards.TEACH_CARD_COLORS)
  })
})

describe('the route', () => {
  it('draws a PNG of the shape it was asked for, with the unstamped public-asset cache lane and no robots header', async () => {
    for (const [card, width, height] of [
      [['vietnam-work-permit-for-english-teachers', '1200x630.png'], 1200, 630],
      [['is-ho-chi-minh-city-safe', '1200x675.png'], 1200, 675],
      [['english-teacher-salary-in-vietnam', '1200x900.png'], 1200, 900],
      [['1200x1200.png'], 1200, 1200],
    ] as const) {
      const res = await get([...card])
      expect(res.status, card.join('/')).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400')
      expect(res.headers.get('x-robots-tag')).toBeNull()
      expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ png: 'PNG', width, height })
    }
  })

  it('404s an unknown guide, an unknown shape and an extra segment', async () => {
    for (const card of [['no-such-guide', '1200x630.png'], ['english-teacher-salary-in-vietnam', '1200x700.png'], ['a', 'b', '1200x630.png']])
      expect((await get(card)).status, card.join('/')).toBe(404)
  })

  it('is a static route: rendered at build, any other path a 404 without running', () => {
    expect(route.dynamic).toBe('force-static')
    expect(route.dynamicParams).toBe(false)
  })

  it('a failed font read or decode is not kept: the next request reads the face again (review, codex)', async () => {
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const reads: string[] = []
    vi.doMock('node:fs/promises', () => ({
      ...real,
      // The first read hands back bytes that are no font, so the DECODE fails — inside the read's success path.
      readFile: async (path: string) => {
        reads.push(path)
        return reads.length === 1 ? Buffer.from('not a font') : real.readFile(path)
      },
    }))
    vi.resetModules()
    try {
      const fresh = await import('@/app/og/teach-in-vietnam/[...card]/route')
      const call = () => fresh.GET(new Request('https://eno.vn/og/teach-in-vietnam/1200x630.png'), { params: Promise.resolve({ card: ['1200x630.png'] }) })
      await expect(call()).rejects.toThrow(/not a WOFF2 file/)
      expect((await call()).status).toBe(200)
      expect(reads).toHaveLength(2)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })

  it('its face ships in the image: read by a literal path the build traces, and named for the route in next.config.ts', () => {
    // A container draws a card again on its first request (the cache handler keeps no build-time prerender), so the
    // font must be in the standalone bundle, not only in the build's checkout.
    const font = 'src/fonts/open-runde-bold.woff2'
    expect(readFileSync('src/app/og/teach-in-vietnam/[...card]/route.tsx', 'utf8')).toContain(`join(process.cwd(), ${font.split('/').map((p) => `'${p}'`).join(', ')})`)
    expect(readFileSync('next.config.ts', 'utf8')).toContain(`"/og/teach-in-vietnam/**": ["./${font}"]`)
  })

  it('⛔ eno.forum renders none and answers 404, a real guide’s card included', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    try {
      const forum = await import('@/app/og/teach-in-vietnam/[...card]/route')
      expect(forum.generateStaticParams()).toEqual([])
      const res = await forum.GET(new Request('https://www.eno.forum/og/teach-in-vietnam/1200x630.png'), {
        params: Promise.resolve({ card: ['english-teacher-salary-in-vietnam', '1200x630.png'] }),
      })
      expect(res.status).toBe(404)
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
      vi.resetModules()
    }
  })
})
