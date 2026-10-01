import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SiteFacts } from '@/lib/site-facts'

/**
 * /about is the page assistants fetch to learn what the site is (ChatGPT-User was measured reading
 * it at answer time), so these tests render it and read what it SAYS: the title, the "At a glance"
 * facts per shelf, the AboutPage JSON-LD, and that eno.forum gets none of the marketplace's claims.
 *
 * The page's chrome (header, footer, the translation provider) is replaced by thin stand-ins — the
 * real ones pull in the whole client app — so this renders the page's own markup and nothing else.
 * <Tr> renders its English source, which is the text the harvester collects.
 */
const h = vi.hoisted(() => ({ facts: null as SiteFacts | null, calls: 0 }))

vi.mock('@/context/language-context', () => ({ Tr: ({ text }: { text?: string | null }) => text ?? null }))
vi.mock('@/components/marketplace/bilingual', () => ({ Bilingual: ({ en }: { en: string }) => en }))
vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))
vi.mock('@/components/marketplace/content-page', () => ({
  ContentPage: ({ title, intro, sections, children }: { title: string; intro?: ReactNode; sections?: { id: string; label: string }[]; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      <p>{intro}</p>
      <nav>{sections?.map((s) => <a key={s.id} data-rail={s.id} href={`#${s.id}`}>{s.label}</a>)}</nav>
      {children}
    </main>
  ),
  ContentSection: ({ id, title, children }: { id?: string; title?: string; children: ReactNode }) => (
    <section id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))
vi.mock('@/lib/site-facts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site-facts')>()),
  loadSiteFacts: async () => {
    h.calls++
    return h.facts
  },
}))

/**
 * Shaped like the 2026-09-27 public API (`facets.category` sums to the 103,966 total): about 99% of
 * listings and every rental in Ho Chi Minh City, about 97% linked from other sites.
 */
const MEASURED: SiteFacts = {
  live: 103_966,
  linked: 101_000,
  motorbikes: 0,
  byCategory: {
    electronics: 63_932, rentals: 25_502, 'furniture-appliances': 6_308, sports: 5_591, 'fashion-beauty': 1_184,
    services: 447, 'books-stationery': 422, 'baby-kids': 380, vehicles: 100, jobs: 39, 'hobbies-sports': 26,
    'tickets-travel': 17, 'food-drink': 17, pets: 1,
  },
  byCity: {
    hcmc: { electronics: 63_900, rentals: 25_502, 'furniture-appliances': 6_308, sports: 5_591, 'fashion-beauty': 1_184, services: 447, jobs: 29 },
    hanoi: { electronics: 263, jobs: 6 },
    daNang: { jobs: 4 },
  },
}

// The first import pulls the page's real module graph (site-legal, the registries, Prisma's client
// behind the mocked loader) and takes a few seconds cold.
vi.setConfig({ testTimeout: 30_000 })

async function loadPage(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', edition === 'marketplace' ? 'https://eno.vn' : 'https://www.eno.forum')
  vi.resetModules()
  return import('./page')
}

/** The page's metadata for one `[lang]` variant — it is `generateMetadata` since the <title> follows it. */
async function metadataFor(edition: 'marketplace' | 'services', lang: 'en' | 'vi' = 'en') {
  const mod = await loadPage(edition)
  return mod.generateMetadata({ params: Promise.resolve({ lang }) })
}

async function render(edition: 'marketplace' | 'services') {
  const mod = await loadPage(edition)
  return renderToStaticMarkup(await mod.default())
}

const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))

beforeEach(() => {
  h.facts = MEASURED
  h.calls = 0
})
afterEach(() => { vi.unstubAllEnvs() })

describe('/about metadata', () => {
  it('describes what the site is, for whom and where — and previews as itself, image included', async () => {
    const metadata = await metadataFor('marketplace')
    expect(metadata.title).toBe('About eno.vn — free classifieds for expats and locals in Vietnam')
    expect(String(metadata.description)).toContain('free classifieds marketplace for expats, internationals and locals in Vietnam')
    // Both 0 live listings on 2026-09-27 — a description is a claim about the shelf.
    expect(String(metadata.description)).not.toMatch(/motorbike|moving sale/i)
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, url: '/about', siteName: 'eno.vn', type: 'website' })
    expect((metadata.openGraph as { images: { url: string }[] }).images[0].url).toBe('/og/share-card.jpg')
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: metadata.title })
  })

  it('keeps eno.forum’s own truth', async () => {
    const metadata = await metadataFor('services')
    expect(metadata.title).toBe('About eno.forum — services for travellers and newcomers to Vietnam')
    expect(String(metadata.title)).not.toContain('free')
  })

  it('gives the Vietnamese variant a Vietnamese <title> on the marketplace only, and keeps the share card English', async () => {
    const vi = await metadataFor('marketplace', 'vi')
    expect(vi.title).toBe('Về eno.vn — rao vặt miễn phí cho người nước ngoài và người Việt tại Việt Nam')
    // A share scraper sends no language: the card must not depend on which variant it hit.
    expect(vi.openGraph).toMatchObject({ title: 'About eno.vn — free classifieds for expats and locals in Vietnam' })
    // eno.forum's title is untouched in either language (the file's rule 1).
    expect((await metadataFor('services', 'vi')).title).toBe('About eno.forum — services for travellers and newcomers to Vietnam')
  })
})

describe('/about on the marketplace', () => {
  it('renders the facts the shelf supports, computed, never typed', async () => {
    const html = await render('marketplace')
    expect(html).toContain('<section id="glance"><h2>At a glance</h2>')
    expect(html).toContain('Browsing, posting and contacting sellers are currently free.')
    expect(html).toContain('Almost everything listed is in Ho Chi Minh City.')
    expect(html).toContain('Every rental listed right now is in Ho Chi Minh City.')
    expect(html).toContain('href="/c/rentals"')
    expect(html).toContain('Almost every listing is linked from another site')
    expect(html).toContain('There is no checkout, no escrow and no buyer protection.')
    // "Partner" means a signed agreement since 2026-10-01; no linked source is called one (review P2).
    expect(html).not.toMatch(/partner sites?\b/i)
    // The eleven interface languages, by native name, each tagged with its own language.
    expect(html).toContain('<span lang="km">, ភាសាខ្មែរ</span>')
    expect((html.match(/<span lang="/g) ?? []).length).toBe(11)
  })

  it('names the operator only from the registry, and only once registered', async () => {
    const { COMPANY, OPERATOR_REGISTERED } = await import('@/lib/site-legal')
    const html = await render('marketplace')
    if (OPERATOR_REGISTERED) expect(html).toContain(COMPANY.erc)
    else expect(html).not.toContain(COMPANY.erc)
  })

  it('follows the shelf: a rental outside HCMC turns "every" into "most"', async () => {
    h.facts = { ...MEASURED, byCity: { ...MEASURED.byCity, hanoi: { ...MEASURED.byCity.hanoi, rentals: 10 } }, byCategory: { ...MEASURED.byCategory, rentals: 25_512 } }
    const html = await render('marketplace')
    expect(html).not.toContain('Every rental listed right now')
    expect(html).toContain('Most rental listings are in Ho Chi Minh City.')
  })

  it('⚠️ without facts it says less, never something false', async () => {
    h.facts = null
    const html = await render('marketplace')
    expect(html).not.toContain('Ho Chi Minh City')
    expect(html).not.toMatch(/Almost every|Most listings|Every listing/)
    expect(html).toContain('A listing linked from another site says where it is listed and links to the original posting')
    expect(html).toContain('currently free')
  })

  it('emits AboutPage JSON-LD whose subject is the layout’s Organization @id', async () => {
    const ld = jsonLd(await render('marketplace'))
    expect(ld).toHaveLength(1)
    expect(ld[0]).toMatchObject({
      '@type': 'AboutPage',
      url: 'https://eno.vn/about',
      mainEntity: { '@id': 'https://eno.vn/#organization' },
      about: { '@id': 'https://eno.vn/#organization' },
      isPartOf: { '@id': 'https://eno.vn/#website' },
    })
  })

  it('scopes "message the seller in the app" to listings posted here', async () => {
    const html = await render('marketplace')
    expect(html).toContain('For a listing posted here, you message the seller in the app')
  })

  // ⛔ The owner removed "enquiries and viewings are handled there, not by eno" on 2026-09-25: the eno
  // team checks availability on any rental, linked or not. So the page says where a linked listing
  // POINTS, never who handles it — and never that it "opens on" the source (it has a page here).
  it('never says a linked listing is handled at its source', async () => {
    for (const facts of [MEASURED, null]) {
      h.facts = facts
      const html = await render('marketplace')
      expect(html).not.toMatch(/contact the advertiser|deal with the advertiser|enquiries go there|opens? on the site (it|they) came from/)
    }
  })

  it('names no empty category and does not frame dealer stock as moving sales', async () => {
    const html = await render('marketplace')
    expect(html).not.toMatch(/motorbike|moving sale|change hands every time somebody moves/i)
  })
})

describe('/about on eno.forum', () => {
  it('⛔ makes none of the marketplace’s claims and reads no marketplace counts', async () => {
    const html = await render('services')
    expect(h.calls).toBe(0)
    expect(html).not.toContain('At a glance')
    expect(html).not.toContain('currently free')
    expect(html).not.toContain('no buyer protection')
    expect(jsonLd(html)).toHaveLength(0)
  })

  it('sends newcomers only to shelves that have stock, and never calls dealer stock a moving sale', async () => {
    const metadata = await metadataFor('services')
    expect(String(metadata.description)).not.toMatch(/motorbike/i)
    const html = await render('services')
    expect(html).not.toContain('/motorbikes-for-sale-vietnam')
    expect(html).not.toMatch(/something to ride|departing expat is selling/i)
    expect(html).toContain('/furnishing-a-home-in-vietnam')
  })
})

describe('the rail', () => {
  it.each(['marketplace', 'services'] as const)('every %s rail entry scrolls to a section that edition renders', async (edition) => {
    const html = await render(edition)
    const rail = [...html.matchAll(/data-rail="([^"]+)"/g)].map((m) => m[1])
    expect(rail.length).toBeGreaterThan(0)
    for (const id of rail) expect(html, `rail "${id}"`).toContain(`<section id="${id}">`)
  })
})

/**
 * ⛔ RULE 1 OF THE PAGE HEADER, CHECKED. Literal `<Tr text="…">` copy is harvested into the catalogue
 * eno.vn ships to every browser, so no literal in this file may carry services vocabulary.
 */
describe('harvestable copy', () => {
  it('carries no services vocabulary in any <Tr text="…"> literal', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[lang]/about/page.tsx'), 'utf8')
    const literals = [...src.matchAll(/<Tr\s+text=\{?\s*["']((?:[^"'\\]|\\.)*)["']/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThan(10)
    for (const l of literals) {
      expect(l).not.toMatch(/visa|passport|VietKite|PayPal|itinerar|thị thực|hộ chiếu|lịch trình|xuất nhập cảnh/i)
    }
  })
})
