// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { TEACHERS_COUNSEL_WORDS } from '@/test/teachers-counsel-words'

/**
 * ⛔ /c/teachers LINKS EVERY LIVE TEACHER PROFILE IN ITS OWN HTML (SEO plan §3(a) item 12, 2026-10-19). Past the grid's
 * first 48 cards the profiles arrived only through "Show more" — a button, and crawlers do not click buttons — so 45 of
 * 93 had no crawlable link. The page now names every profile its grid does not show, as a plain link under it, with no
 * new URL and the route ISR exactly as before (teacher-links.tsx has the three designs compared).
 *
 * The page is RENDERED here, not read as source: `(index)/page.tsx` runs against a mocked database — the window, the
 * category row, the counts and the one new read — and the result goes through renderToString in both languages. The
 * grid is SellerListings, a client component over a live API, so it is stood in for by one `<a>` per card at the card's
 * own target (listing-card.tsx, pinned at the end of this file): exactly the link a crawler reads off a real card.
 */
type Row = { id: string; title: string; sellerId: string; subcategorySlug: string | null; listingType: string; category: { slug: string } }

const h = vi.hoisted(() => ({
  /** Every live row of the category being rendered, in the page's order (rankScore desc, id desc). */
  all: [] as Row[],
  /** What diverseFeedWindow hands the page — the head its grid is cut from. */
  window: [] as Row[],
  /** Every db.listing.findMany call. On this page only the teacher read makes one (the window is mocked out). */
  findMany: [] as { where: unknown; orderBy: unknown; select: unknown; take?: number }[],
  /** What db.listing.findMany answers instead of `all`, when set — a teacher list offered to a page that must not read it. */
  offered: null as Row[] | null,
  /** Every scopedListingWhere call, its arguments as given. */
  scope: [] as unknown[][],
  /** The `where` the page handed its window (diverseFeedWindow) — the grid's own predicate. */
  windowWhere: undefined as unknown,
  /** The edition the page reads: true = eno.forum (what an unset NEXT_PUBLIC_ENO_EDITION falls back to), false = eno.vn. */
  services: true,
}))

const CATS = [
  { id: 'cat-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
  { id: 'cat-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  { id: 'cat-teachers', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' },
]

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') }, useRouter: () => ({ prefetch() {}, push() {} }) }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
// The scope TAGS what it returns with the options it was given, so a `where` that reaches the database says whether it
// went through scopedListingWhere and with `{ teachers: true }` — not only that some call somewhere did.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (...args: unknown[]) => { h.scope.push(args); return { ...(args[0] as object), __opts: args[1] } },
}))
vi.mock('@/lib/db', () => ({
  db: {
    // "Other categories": every category but the page's own, as the page asks.
    category: { findMany: async (args: { where?: { NOT?: { id?: string } } }) => CATS.filter((c) => c.id !== args?.where?.NOT?.id) },
    listing: {
      groupBy: async () => [],
      count: async () => 7,
      findMany: async (args: { where: unknown; orderBy: unknown; select: unknown; take?: number }) => {
        h.findMany.push(args)
        return (h.offered ?? h.all).slice(0, args.take).map((r) => ({ id: r.id, title: r.title }))
      },
    },
  },
}))
vi.mock('./load-category', () => ({
  loadCategory: async (slug: string) => {
    const cat = CATS.find((c) => c.slug === slug)
    return cat ? { cat, live: h.all.length } : null
  },
}))
vi.mock('@/lib/feed-window', () => ({ diverseFeedWindow: async (where: unknown) => { h.windowWhere = where; return h.window } }))
// The edition as a switch the page reads at render time. Every test runs as eno.forum (the env-less fallback, as before)
// unless it says otherwise; the guide-rail order test renders eno.vn, where the rail exists.
vi.mock('@/lib/edition', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/edition')>()
  return {
    ...real,
    get IS_SERVICES() { return h.services },
    get IS_MARKETPLACE() { return !h.services },
    get SITE_NAME() { return h.services ? 'eno.forum' : 'eno.vn' },
  }
})
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: { id: true }, serializeListingCard: (r: object) => ({ ...r }) }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: unknown[]) => rows }))
vi.mock('@/components/marketplace/seller-listings', () => ({
  SellerListings: ({ listings }: { listings: { id: string; title: string }[] }) => (
    <div data-grid="">{listings.map((l) => <a key={l.id} href={`/listings/${l.id}`}>{l.title}</a>)}</div>
  ),
}))
// The real module, with its renderer observed: another category must never reach it.
vi.mock('./teacher-links', async (importOriginal) => {
  const real = await importOriginal<typeof import('./teacher-links')>()
  return { ...real, MoreTeachers: vi.fn(real.MoreTeachers) }
})

const { default: CategoryPage } = await import('./(index)/page')
const { MoreTeachers, TEACHER_LINKS_MAX, teachersPastGrid } = await import('./teacher-links')
const { loadTeacherLinks } = await import('./category-data')

/** The grid's size on /c/teachers ((index)/page.tsx PAGE_SIZE). */
const GRID = 48

/** `n` live teacher profiles in rank order — one seller each, as a teacher row is. Three names the card prints as stored. */
const NAMES: Record<number, string> = { 50: 'nn***', 51: 'Nguyễn Thị Hoa', 52: `O'Brien & <Smith>` }
const teachers = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `cmteacher${String(i + 1).padStart(3, '0')}`,
  title: NAMES[i] ?? `Teacher ${i + 1}`,
  sellerId: `seller-t${i + 1}`, subcategorySlug: 'ielts-exam', listingType: 'teacher', category: { slug: 'teachers' },
}))
/** `n` live phones from five shops — another category, whose window the page deals round-robin by seller. */
const phones = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `cmphone${String(i + 1).padStart(3, '0')}`, title: `Phone ${i + 1}`,
  sellerId: `seller-p${(i % 5) + 1}`, subcategorySlug: 'phones', listingType: 'sell', category: { slug: 'electronics' },
}))

/** The page for `category`, rendered as the server sends it, over `rows` with this window (default: the top 60). */
async function render(category: 'teachers' | 'electronics', lang: 'en' | 'vi', rows: Row[], window = rows.slice(0, 60)) {
  h.all = rows
  h.window = window
  const tree = await CategoryPage({ params: Promise.resolve({ lang, category }) })
  const html = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{tree}</LanguageProvider>)
  const el = document.createElement('div')
  el.innerHTML = html
  return { html, el }
}
const links = (scope: Element | null) => [...(scope?.querySelectorAll('a') ?? [])].map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))
const listOf = (el: Element) => links(el.querySelector('[data-teacher-links]'))
const gridOf = (el: Element) => links(el.querySelector('[data-grid]'))
const profileHrefs = (el: Element) => [...el.querySelectorAll('a[href^="/listings/"]')].map((a) => a.getAttribute('href'))
const asLinks = (rows: Row[]) => rows.map((r) => ({ href: `/listings/${r.id}`, text: r.title }))

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
  h.findMany = []
  h.scope = []
  h.offered = null
  h.windowWhere = undefined
  h.services = true
  vi.mocked(MoreTeachers).mockClear()
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'languages')
})
/** console.warn, observed and silenced for one test — restored by the test itself (never restoreAllMocks: it would
 *  strip MoreTeachers' wrapper, above). */
const watchWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('teachersPastGrid — the profiles the grid does not show', () => {
  const row = (id: string, title = id) => ({ id, title })

  it('every row not on the grid, in the order given, each once', () => {
    const rows = [row('a'), row('b'), row('c'), row('d'), row('c'), row('e')]
    expect(teachersPastGrid(rows, [{ id: 'b' }, { id: 'd' }])).toEqual([row('a'), row('c'), row('e')])
  })

  it('the grid is what was RENDERED, not a position — a row the window pulled up is skipped, one it pushed down is kept', () => {
    // The window deals sellers round-robin (feed-window.ts), so the grid need not be the first N by rank.
    const rows = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => row(id))
    expect(teachersPastGrid(rows, [{ id: 'r1' }, { id: 'r5' }])).toEqual([row('r2'), row('r3'), row('r4')])
  })

  it('at most `max` — TEACHER_LINKS_MAX unless told otherwise', () => {
    const rows = Array.from({ length: TEACHER_LINKS_MAX + 30 }, (_, i) => row(`t${i}`))
    expect(teachersPastGrid(rows, [], 3).map((r) => r.id)).toEqual(['t0', 't1', 't2'])
    expect(teachersPastGrid(rows, [])).toHaveLength(TEACHER_LINKS_MAX)
    expect(TEACHER_LINKS_MAX).toBe(240)
  })

  it('hands back the id and the name, nothing else a row carries', () => {
    const rich = { id: 'x', title: 'Name', sellerId: 's', images: ['p.jpg'] }
    expect(teachersPastGrid([rich], [])).toEqual([{ id: 'x', title: 'Name' }])
  })
})

describe('loadTeacherLinks — the where it is handed (the grid’s), two fields, the page’s order', () => {
  it('reads exactly the `where` it is given — no predicate or scope of its own — id and title only, at most `take`', async () => {
    h.all = teachers(5)
    const where = { categoryId: 'cat-teachers', verified: true, status: 'active', __opts: { teachers: true } }
    expect(await loadTeacherLinks(where, 288)).toEqual(teachers(5).map((r) => ({ id: r.id, title: r.title })))
    expect(h.findMany).toHaveLength(1)
    // The very object it was handed (the page-level test below proves that object is the grid's own).
    expect(h.findMany[0].where).toBe(where)
    expect(h.findMany[0]).toEqual({ where, orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], select: { id: true, title: true }, take: 288 })
    expect(h.scope, 'the loader scoped again — the page’s where already is').toEqual([])
  })
})

describe('<MoreTeachers> — a heading, then one plain followed link per profile', () => {
  const list = [{ id: 'cm1', title: 'nn***' }, { id: 'cm2', title: 'Nguyễn Thị Hoa' }, { id: 'cm3', title: `O'Brien & <Smith>` }]
  const html = (lang: 'en' | 'vi', node: React.ReactNode) =>
    renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  const dom = (lang: 'en' | 'vi', node: React.ReactNode) => {
    const el = document.createElement('div')
    el.innerHTML = html(lang, node)
    return el
  }

  it('renders nothing with nothing to list', () => {
    expect(html('en', <MoreTeachers teachers={[]} />)).toBe('')
  })

  it('names each profile at the card’s own target, as stored — masked, Vietnamese or full of markup — in both languages', () => {
    for (const lang of ['en', 'vi'] as const) {
      const el = dom(lang, <MoreTeachers teachers={list} />)
      expect(el.querySelector('h2')?.textContent).toBe(lang === 'en' ? 'More teachers' : 'Các giáo viên khác')
      // Never translated, never localized: a person's name, and the card's link (/listings/<id>) in either language.
      expect(links(el)).toEqual([
        { href: '/listings/cm1', text: 'nn***' },
        { href: '/listings/cm2', text: 'Nguyễn Thị Hoa' },
        { href: '/listings/cm3', text: `O'Brien & <Smith>` },
      ])
      for (const a of el.querySelectorAll('a')) {
        // A followed link: the whole point. No rel, no target, nothing a crawler would read as "don't".
        expect(a.getAttributeNames().sort()).toEqual(['href'])
      }
      expect(el.querySelectorAll('ul > li > a')).toHaveLength(3)
    }
  })

  it('escapes a name — markup in it stays text', () => {
    expect(html('en', <MoreTeachers teachers={list} />)).toContain('O&#x27;Brien &amp; &lt;Smith&gt;')
  })

  it('the heading makes no claim — nothing counsel holds back, no "verified", no "native"', () => {
    for (const lang of ['en', 'vi'] as const) {
      const heading = dom(lang, <MoreTeachers teachers={list} />).querySelector('h2')?.textContent?.normalize('NFC') ?? ''
      expect(heading).not.toMatch(TEACHERS_COUNSEL_WORDS)
      expect(heading).not.toMatch(/verified|native|xác minh|bản ngữ/i)
    }
  })
})

describe('/c/teachers — a crawlable link to every live profile, in both languages', () => {
  for (const lang of ['en', 'vi'] as const) {
    it(`${lang}: the grid's 48 cards and the list's 45 names link all 93 profiles, each exactly once`, async () => {
      const rows = teachers(93)
      const { el } = await render('teachers', lang, rows)
      expect(gridOf(el)).toEqual(asLinks(rows.slice(0, GRID)))
      // Every profile beyond the first page, in the page's order, at the card's target, under the name the card prints.
      expect(listOf(el)).toEqual(asLinks(rows.slice(GRID)))
      const hrefs = profileHrefs(el)
      expect(new Set(hrefs).size, 'a profile linked twice').toBe(hrefs.length)
      expect(hrefs.sort()).toEqual(rows.map((r) => `/listings/${r.id}`).sort())
      expect(el.querySelector('[data-teacher-links] h2')?.textContent).toBe(lang === 'en' ? 'More teachers' : 'Các giáo viên khác')
    })
  }

  it('the list follows what the grid RENDERED: a profile the window pulled up is not listed twice, one it left out is listed', async () => {
    const rows = teachers(93)
    // The window holds rank 70 among its first 48 and drops rank 48 below the cut.
    const window = [...rows.slice(0, 47), rows[69], ...rows.slice(47, 59)]
    const { el } = await render('teachers', 'en', rows, window)
    expect(gridOf(el)).toEqual(asLinks([...rows.slice(0, 47), rows[69]]))
    expect(listOf(el)).toEqual(asLinks(rows.slice(47).filter((r) => r.id !== rows[69].id)))
    const hrefs = profileHrefs(el)
    expect(new Set(hrefs).size).toBe(93)
    expect(hrefs).toHaveLength(93)
  })

  it('one read per render, beside the window: the GRID’s own where — the very object the window got — id and title, the grid and the list’s worth', async () => {
    await render('teachers', 'en', teachers(93))
    expect(h.findMany).toHaveLength(1)
    // One source of truth: the list reads the `where` the page built once and handed its window (scopedWhere), so
    // whatever narrows the grid's set narrows the list with it…
    expect(h.windowWhere).toBeDefined()
    expect(h.findMany[0].where).toBe(h.windowWhere)
    // …and that `where` is the page's predicate through scopedListingWhere WITH `{ teachers: true }` — the tag says so.
    expect(h.findMany).toEqual([{
      where: { categoryId: 'cat-teachers', verified: true, status: 'active', __opts: { teachers: true } },
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true },
      take: GRID + TEACHER_LINKS_MAX,
    }])
  })

  it('eno.vn: the list sits AFTER the guide rail and right before "Other categories" — the guides are met first', async () => {
    h.services = false // the guide rail is marketplace-only ((index)/page.tsx `guides`)
    for (const lang of ['en', 'vi'] as const) {
      const { el } = await render('teachers', lang, teachers(93))
      const list = el.querySelector('[data-teacher-links]')
      const guides = [...el.querySelectorAll('section > h2')].find((h2) => h2.textContent === (lang === 'en' ? 'Guides' : 'Cẩm nang'))?.closest('section')
      const others = el.querySelector('a[href="/c/jobs"]')?.closest('section')
      expect(list, lang).not.toBeNull()
      expect(guides, `${lang}: the guide rail renders on /c/teachers`).toBeTruthy()
      expect(guides!.querySelectorAll('a[href^="/teach-in-vietnam/"]').length, lang).toBeGreaterThan(0)
      expect(others, lang).toBeTruthy()
      // Neighbours, in that order: Guides → More teachers → Other categories.
      expect(guides!.nextElementSibling, lang).toBe(list)
      expect(list!.nextElementSibling, lang).toBe(others)
    }
  })

  it('eno.forum (no guide rail): the list follows the grid’s "Refine in full search" and sits right before "Other categories"', async () => {
    const { el } = await render('teachers', 'en', teachers(93))
    const list = el.querySelector('[data-teacher-links]')
    expect(el.textContent).not.toMatch(/Guides/)
    expect(list?.previousElementSibling?.querySelector('a[href="/?category=teachers"]')).toBeTruthy()
    expect(list?.nextElementSibling).toBe(el.querySelector('a[href="/c/jobs"]')?.closest('section'))
  })

  it('past the cap: TEACHER_LINKS_MAX names, and the page says in the logs how many profiles are left unlinked', async () => {
    const warn = watchWarn()
    try {
      const rows = teachers(300)
      const { el } = await render('teachers', 'en', rows)
      expect(listOf(el)).toEqual(asLinks(rows.slice(GRID, GRID + TEACHER_LINKS_MAX)))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain(`${300 - GRID - TEACHER_LINKS_MAX} live teacher profile(s) have no link on /c/teachers`)
    } finally {
      warn.mockRestore()
    }
  })

  it('exactly at the cap every profile is linked and nothing is said; a grid that holds every profile lists nothing more', async () => {
    const warn = watchWarn()
    try {
      const full = await render('teachers', 'en', teachers(GRID + TEACHER_LINKS_MAX))
      expect(profileHrefs(full.el)).toHaveLength(GRID + TEACHER_LINKS_MAX)
      const { el, html } = await render('teachers', 'en', teachers(30))
      expect(warn).not.toHaveBeenCalled()
      expect(el.querySelector('[data-teacher-links]')).toBeNull()
      expect(html).not.toContain('More teachers')
      expect(profileHrefs(el)).toHaveLength(30)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('every other category — unchanged', () => {
  for (const lang of ['en', 'vi'] as const) {
    it(`${lang}: /c/electronics makes no teacher read, renders no list, and its links are its own`, async () => {
      const rows = phones(93)
      const { el, html } = await render('electronics', lang, rows)
      expect(h.findMany, 'a teacher read on another category').toEqual([])
      expect(vi.mocked(MoreTeachers)).not.toHaveBeenCalled()
      expect(el.querySelector('[data-teacher-links]')).toBeNull()
      expect(html).not.toMatch(/More teachers|Các giáo viên khác|cmteacher/)
      // Every link is one the page already drew: the grid's cards, "Refine in full search", the "Other categories" chips.
      const grid = gridOf(el)
      expect(grid).toHaveLength(GRID)
      // ⛔ The teachers chip is eno.vn's page on eno.forum (the forum 308s its own — src/lib/teachers/surface.ts).
      expect(links(el).filter((l) => !grid.some((g) => g.href === l.href)).map((l) => l.href)).toEqual(['/?category=electronics', '/c/jobs', 'https://eno.vn/c/teachers'])
    })

    it(`${lang}: on eno.vn the same chip links its own /c/teachers, as it always did — and nothing links eno.vn absolutely`, async () => {
      h.services = false
      const { el } = await render('electronics', lang, phones(93))
      const hrefs = links(el).map((l) => l.href ?? '')
      expect(hrefs).toContain('/c/teachers')
      expect(hrefs.filter((href) => href.startsWith('https://eno.vn'))).toEqual([])
    })
  }

  it('its HTML does not depend on the teacher read at all — the read that puts the offered teachers into /c/teachers never runs here', async () => {
    for (const lang of ['en', 'vi'] as const) {
      // The offer is LIVE, not a value nothing consults: on /c/teachers the same mocked read hands the page these 93
      // rows, and the list names every one its 48-card grid does not show.
      h.offered = teachers(93)
      const control = await render('teachers', lang, teachers(GRID))
      expect(listOf(control.el), `${lang}: the offer reaches the HTML through the read`).toEqual(asLinks(teachers(93).slice(GRID)))
      // So had /c/electronics read it, those names would be in its HTML. It does not: byte for byte what it is with
      // nothing on offer, and not one read.
      h.findMany = []
      const offered = (await render('electronics', lang, phones(93))).html
      h.offered = null
      const plain = (await render('electronics', lang, phones(93))).html
      expect(offered).toBe(plain)
      expect(offered).not.toMatch(/cmteacher|More teachers|Các giáo viên khác/)
      expect(h.findMany, `${lang}: a teacher read on /c/electronics`).toEqual([])
    }
  })
})

describe('the page wiring — /c/teachers only, and the route ISR exactly as before', () => {
  // Comments stripped: the files explain the APIs they must not call.
  const code = (file: string) =>
    readFileSync(join(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const page = code('src/app/[lang]/c/[category]/(index)/page.tsx')

  it('reads the list only for the teachers category and renders it only there', () => {
    expect(page).toMatch(/cat\.slug === TEACHERS_CATEGORY_SLUG \? loadTeacherLinks\(scopedWhere, PAGE_SIZE \+ TEACHER_LINKS_MAX\) : Promise\.resolve\(\[\]\)/)
    expect(page).toMatch(/\{isTeachers && <MoreTeachers teachers=\{moreTeachers\} \/>\}/)
    expect(page.match(/<MoreTeachers\b/g)).toHaveLength(1)
    expect(page.match(/\bloadTeacherLinks\(/g)).toHaveLength(1)
  })

  it('stays ISR: the same revalidate, and no headers(), cookies(), searchParams, no-store fetch, fetchCache or other dynamic API on the render path', () => {
    expect(page).toMatch(/^export const revalidate = 21600\b/m)
    for (const file of ['src/app/[lang]/c/[category]/(index)/page.tsx', 'src/app/[lang]/c/[category]/teacher-links.tsx', 'src/app/[lang]/c/[category]/category-data.ts']) {
      const src = code(file)
      // `no-store` and `fetchCache` too (review round 2): a `{ cache: 'no-store' }` fetch on the read path turns every
      // /c/<category> page (one route file) dynamic, and a `fetchCache` segment config overrides how its fetches cache —
      // both passed every other test.
      expect(src, file).not.toMatch(/\bsearchParams\b|\bheaders\(|\bcookies\(|\bdraftMode\(|\bconnection\(|unstable_noStore|no-store|\bfetchCache\b|export const dynamic\b/)
    }
  })

  it('the list links the card’s own target — if the card’s link moves, this list must move with it', () => {
    const card = readFileSync(join(process.cwd(), 'src/components/marketplace/listing-card.tsx'), 'utf8')
    expect(card).toMatch(/<a\s+href=\{`\/listings\/\$\{listing\.id\}`\}/)
    expect(code('src/app/[lang]/c/[category]/teacher-links.tsx')).toMatch(/<a href=\{`\/listings\/\$\{t\.id\}`\}>\{t\.title\}<\/a>/)
  })
})
