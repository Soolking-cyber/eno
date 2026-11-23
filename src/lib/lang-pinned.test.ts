import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FIXED_LANG, VI_PILOT, VI_PILOT_MARKETPLACE, VI_RETIRED_FAMILIES, VI_TWIN_FAMILIES, viPilotFor, VI_PREFIX_PATHS, VI_RETIRED_PATHS, hasViTwin, hrefHere, langAlternates, localizedHref, pinnedPair, pinnedRoute, stripViPrefix, viTwinPath, type ViPilot } from './lang-pinned'
import { LANG_VARIANTS } from './lang-variant'
import { EXPAT_GUIDES, MARKETPLACE_GUIDES } from './expat-guides'
import { PHONE_GUIDES } from './phone-guides'
import { RENT_TOOL_SLUGS } from './rent-tools/registry'

/**
 * ⛔ THE PIN LIST IS A COPY OF THE REGISTRIES, SO IT IS HELD EQUAL TO THEM IN BOTH DIRECTIONS (SEO wave B,
 * V1). A guide added to a registry and not here would negotiate its chrome again — Vietnamese prose in
 * English chrome for Googlebot, silently. One left here after the registry drops it would pin a path
 * that may become something else.
 */
const registry = [...EXPAT_GUIDES, ...MARKETPLACE_GUIDES, ...PHONE_GUIDES].filter((g) => g.lang)

describe('FIXED_LANG', () => {
  it('equals every registry guide that declares a language — slug, language and pair', () => {
    const fromRegistry = Object.fromEntries(
      registry.map((g) => [g.slug, g.pair ? { lang: g.lang, pair: g.pair } : { lang: g.lang }]),
    )
    expect(FIXED_LANG).toEqual(fromRegistry)
  })

  it('pins the counts the registries hold today: 24 Vietnamese and 23 English', () => {
    const langs = Object.values(FIXED_LANG).map((v) => v.lang)
    expect(langs.filter((l) => l === 'vi')).toHaveLength(24)
    expect(langs.filter((l) => l === 'en')).toHaveLength(23)
  })

  it('every pair is reciprocal and crosses languages', () => {
    for (const [slug, { lang, pair }] of Object.entries(FIXED_LANG)) {
      if (!pair) continue
      expect(FIXED_LANG[pair], slug).toBeDefined()
      expect(FIXED_LANG[pair].pair, slug).toBe(slug)
      expect(FIXED_LANG[pair].lang, slug).not.toBe(lang)
    }
  })

  it('every pinned path is a real page route', () => {
    for (const slug of Object.keys(FIXED_LANG)) {
      expect(existsSync(`src/app/[lang]/${slug}/page.tsx`), slug).toBe(true)
    }
  })

  it('leaves a guide with no declared language negotiating', () => {
    for (const g of [...EXPAT_GUIDES, ...MARKETPLACE_GUIDES].filter((x) => !x.lang)) {
      expect(pinnedRoute(`/${g.slug}`), g.slug).toBeNull()
    }
  })
})

describe('pinnedRoute', () => {
  it('pins a Vietnamese guide to vi and an English one to en, on its own path', () => {
    expect(pinnedRoute('/thanh-ly-do-gia-dung-cu-tphcm')).toEqual({ variant: 'vi', internalPath: '/thanh-ly-do-gia-dung-cu-tphcm' })
    expect(pinnedRoute('/secondhand-furniture-ho-chi-minh-city')).toEqual({ variant: 'en', internalPath: '/secondhand-furniture-ho-chi-minh-city' })
  })

  it('matches the exact path only', () => {
    for (const p of ['/', '', 'thanh-ly-do-gia-dung-cu-tphcm', '/thanh-ly-do-gia-dung-cu-tphcm/', '/thanh-ly-do-gia-dung-cu-tphcm/x', '/THANH-LY-DO-GIA-DUNG-CU-TPHCM', '/vi/thanh-ly-do-gia-dung-cu-tphcm', '/c/rentals', '/vietnam-evisa']) {
      expect(pinnedRoute(p), p).toBeNull()
    }
  })

  it('⛔ never reads the prototype', () => {
    for (const p of ['/constructor', '/__proto__', '/toString', '/hasOwnProperty']) expect(pinnedRoute(p), p).toBeNull()
  })

  it('pins a model price page by its address: /gia/<slug> vi, /price/<slug> en', () => {
    expect(pinnedRoute('/gia/apple-iphone-13')).toEqual({ variant: 'vi', internalPath: '/gia/apple-iphone-13' })
    expect(pinnedRoute('/price/apple-iphone-13')).toEqual({ variant: 'en', internalPath: '/price/apple-iphone-13' })
    for (const p of ['/gia', '/gia/', '/gia/X', '/gia/a/b', '/price', '/price/', '/price/a--b', '/price/-a']) expect(pinnedRoute(p), p).toBeNull()
  })
})

describe('pinnedPair', () => {
  it('gives the translation of a paired guide, and null otherwise', () => {
    expect(pinnedPair('/thanh-ly-do-gia-dung-cu-tphcm')).toBe('/secondhand-furniture-ho-chi-minh-city')
    expect(pinnedPair('/secondhand-furniture-ho-chi-minh-city')).toBe('/thanh-ly-do-gia-dung-cu-tphcm')
    expect(pinnedPair('/dang-tin-ban-hang-mien-phi')).toBeNull()
    expect(pinnedPair('/c/rentals')).toBeNull()
    expect(pinnedPair('/constructor')).toBeNull()
  })

  it('pairs a model price page with the same slug at the other address', () => {
    expect(pinnedPair('/gia/apple-iphone-13')).toBe('/price/apple-iphone-13')
    expect(pinnedPair('/price/apple-iphone-13')).toBe('/gia/apple-iphone-13')
    expect(pinnedPair('/gia/X')).toBeNull()
    expect(pinnedPair('/gia')).toBeNull()
  })

  it('localizedHref leaves a model price page as it is', () => {
    for (const v of ['vi', 'en']) {
      expect(localizedHref('/gia/apple-iphone-13', v, ON)).toBe('/gia/apple-iphone-13')
      expect(localizedHref('/price/apple-iphone-13', v, ON)).toBe('/price/apple-iphone-13')
    }
  })
})

/**
 * ⛔ THE `/vi` PILOT (SEO wave B, V3a/V3b merged switched OFF, V5 switches it on). Every function takes the
 * lists as a parameter, so each is tested off (as merged by V3a), on (V5's list), and retired (V-R).
 */
const OFF: ViPilot = { live: [], retired: [] }
const ON: ViPilot = { live: ['/', '/c/furniture-appliances'], retired: [] }
const RETIRED: ViPilot = { live: [], retired: ['/', '/c/furniture-appliances'] }
/** What eno.vn ships: the pilot (V-a) and the phase-1 families (2026-11-19). */
const MARKET: ViPilot = VI_PILOT_MARKETPLACE

describe('the pilot lists', () => {
  it('ship V5\'s list — the pilot is on for `/` and `/c/furniture-appliances`, nothing retired', () => {
    expect(VI_PREFIX_PATHS).toEqual(ON.live)
    expect(VI_RETIRED_PATHS).toEqual([])
    // vitest runs as the SERVICES edition (vitest.config.ts), where the pilot is always off; the
    // marketplace build takes the lists as they are
    expect(VI_PILOT).toEqual({ ...OFF, families: [], retiredFamilies: [] })
    expect(viPilotFor(false, VI_PREFIX_PATHS, VI_RETIRED_PATHS)).toEqual({ ...ON, families: [], retiredFamilies: [] })
  })

  it('⛔ eno.forum never pilots, whatever the lists hold; the marketplace takes them as they are (review)', () => {
    expect(viPilotFor(true, ON.live, ['/x'], VI_TWIN_FAMILIES, [/^\/x$/])).toEqual({ ...OFF, families: [], retiredFamilies: [] })
    expect(viPilotFor(false, ON.live, ['/x'])).toEqual({ live: ON.live, retired: ['/x'], families: [], retiredFamilies: [] })
  })

  it('no path is in both lists, and every live or retired path is a real page route', () => {
    for (const l of [VI_PILOT, ON, RETIRED]) {
      expect(l.live.filter((p) => l.retired.includes(p))).toEqual([])
      for (const p of [...l.live, ...l.retired]) {
        const page = p === '/' ? 'src/app/[lang]/(home)/page.tsx' : p === '/c/furniture-appliances' ? 'src/app/[lang]/c/[category]/(index)/page.tsx' : `src/app/[lang]${p}/page.tsx`
        expect(existsSync(page), p).toBe(true)
      }
    }
  })

  it('a piloted path is never also a fixed-language guide', () => {
    for (const p of [...VI_PREFIX_PATHS, ...ON.live]) expect(Object.hasOwn(FIXED_LANG, p.slice(1)), p).toBe(false)
  })
})

describe('pinnedRoute with the pilot', () => {
  it('off: every /vi… is unpinned (the proxy 404s it) and `/` negotiates', () => {
    for (const p of ['/vi', '/vi/c/furniture-appliances', '/', '/c/furniture-appliances']) expect(pinnedRoute(p, OFF), p).toBeNull()
    // …and the guides are unaffected
    expect(pinnedRoute('/thanh-ly-do-gia-dung-cu-tphcm', OFF)).toEqual({ variant: 'vi', internalPath: '/thanh-ly-do-gia-dung-cu-tphcm' })
  })

  it('on: plain piloted = en, /vi twin = vi at the plain internal path', () => {
    expect(pinnedRoute('/', ON)).toEqual({ variant: 'en', internalPath: '/' })
    expect(pinnedRoute('/c/furniture-appliances', ON)).toEqual({ variant: 'en', internalPath: '/c/furniture-appliances' })
    expect(pinnedRoute('/vi', ON)).toEqual({ variant: 'vi', internalPath: '/' })
    expect(pinnedRoute('/vi/c/furniture-appliances', ON)).toEqual({ variant: 'vi', internalPath: '/c/furniture-appliances' })
  })

  it('on: every other /vi… stays unpinned — /vi/c/rentals, a district, /vi/vi, /vi/en, a slash, /vietnam-evisa', () => {
    for (const p of ['/vi/c/rentals', '/vi/c/furniture-appliances/binh-trung', '/vi/vi', '/vi/en', '/vi/vi/c/furniture-appliances', '/vi/', '/vi/c/furniture-appliances/', '/en', '/en/c/furniture-appliances', '/vietnam-evisa', '/vi/thanh-ly-do-gia-dung-cu-tphcm']) {
      expect(pinnedRoute(p, ON), p).toBeNull()
    }
  })

  it('retired: /vi… 308s to the plain path, and the plain path negotiates again', () => {
    expect(pinnedRoute('/vi', RETIRED)).toEqual({ redirect: '/' })
    expect(pinnedRoute('/vi/c/furniture-appliances', RETIRED)).toEqual({ redirect: '/c/furniture-appliances' })
    expect(pinnedRoute('/', RETIRED)).toBeNull()
    expect(pinnedRoute('/vi/c/rentals', RETIRED)).toBeNull()
  })

  it('maps /vi to the internal path revalidatePublicPath purges for the plain path (one ISR entry)', () => {
    for (const plain of ON.live) {
      const r = pinnedRoute(plain === '/' ? '/vi' : `/vi${plain}`, ON)
      expect(r && 'variant' in r ? `/${r.variant}${r.internalPath === '/' ? '' : r.internalPath}` : null).toBe(
        // revalidatePublicPath(plain) purges `/${lang}${plain}` for each of LANG_VARIANTS
        LANG_VARIANTS.map((l) => `/${l}${plain === '/' ? '' : plain}`).find((x) => x.startsWith('/vi')),
      )
    }
  })
})

describe('pinnedPair, stripViPrefix with the pilot', () => {
  it('pairs a piloted path with its twin, both ways, only while on', () => {
    expect(pinnedPair('/', ON)).toBe('/vi')
    expect(pinnedPair('/vi', ON)).toBe('/')
    expect(pinnedPair('/vi/c/furniture-appliances', ON)).toBe('/c/furniture-appliances')
    expect(pinnedPair('/c/furniture-appliances', ON)).toBe('/vi/c/furniture-appliances')
    for (const p of ['/', '/vi', '/c/rentals', '/vi/c/rentals']) expect(pinnedPair(p, OFF), p).toBeNull()
    expect(pinnedPair('/thanh-ly-do-gia-dung-cu-tphcm', ON)).toBe('/secondhand-furniture-ho-chi-minh-city')
  })

  it('strips the prefix of a live path only', () => {
    expect(stripViPrefix('/vi', ON)).toBe('/')
    expect(stripViPrefix('/vi/c/furniture-appliances', ON)).toBe('/c/furniture-appliances')
    expect(stripViPrefix('/vi/c/rentals', ON)).toBe('/vi/c/rentals')
    expect(stripViPrefix('/vi', OFF)).toBe('/vi')
    expect(stripViPrefix(null, ON)).toBeNull()
  })
})

describe('localizedHref', () => {
  it('is the identity while the pilot is off, and on any English page', () => {
    for (const h of ['/', '/c/furniture-appliances', '/c/rentals', '/?q=x']) {
      expect(localizedHref(h, 'vi', OFF), h).toBe(h)
      expect(localizedHref(h, 'en', ON), h).toBe(h)
    }
    expect(localizedHref('/', 'vi')).toBe('/') // the merged lists
  })

  it('points a Vietnamese page at the /vi twin of a live path, query and hash kept', () => {
    expect(localizedHref('/', 'vi', ON)).toBe('/vi')
    expect(localizedHref('/c/furniture-appliances', 'vi', ON)).toBe('/vi/c/furniture-appliances')
    expect(localizedHref('/c/furniture-appliances?sort=newest#top', 'vi', ON)).toBe('/vi/c/furniture-appliances?sort=newest#top')
    expect(localizedHref('/?q=sofa', 'vi', ON)).toBe('/vi?q=sofa')
  })

  it('⛔ never produces a /vi path that does not render (a twin of the lists in force)', () => {
    const hrefs = ['/', '/c/furniture-appliances', '/c/rentals', '/c/furniture-appliances/binh-trung', '/listings/x', '/listings/x/edit', '/sellers/x', '/schools/suggest', '/schools/x/review', '/help/x/y', '/dashboard', '/vi', '/vi/c/rentals', '//evil.example/', 'https://eno.vn/', '#x', '?q=1', '/c/furniture-appliances/', '/c/rentals?sort=newest#top']
    for (const lists of [OFF, ON, RETIRED, MARKET]) {
      for (const h of hrefs) {
        const out = localizedHref(h, 'vi', lists)
        if (out !== h) {
          const path = out.split(/[?#]/)[0]
          const plain = path === '/vi' ? '/' : path.slice(3)
          expect(hasViTwin(plain, lists), `${h} -> ${out}`).toBe(true)
          const r = pinnedRoute(path, lists)
          expect(r && 'variant' in r ? r.variant : null, `${h} -> ${out}`).toBe('vi')
        }
      }
    }
  })
})

describe('langAlternates (V3b head, decision V-g)', () => {
  it('null off or outside the list — the page emits what it did before', () => {
    expect(langAlternates('/', 'en', 'https://eno.vn', OFF)).toBeNull()
    expect(langAlternates('/c/rentals', 'vi', 'https://eno.vn', ON)).toBeNull()
    expect(langAlternates('/', 'vi', 'https://eno.vn')).toBeNull() // the merged lists
  })

  it('on: self-canonical per variant, reciprocal en / vi-VN / x-default', () => {
    expect(langAlternates('/', 'en', 'https://eno.vn', ON)).toEqual({
      canonical: 'https://eno.vn',
      languages: { en: 'https://eno.vn', 'vi-VN': 'https://eno.vn/vi', 'x-default': 'https://eno.vn' },
    })
    expect(langAlternates('/c/furniture-appliances', 'vi', 'https://eno.vn', ON)).toEqual({
      canonical: 'https://eno.vn/vi/c/furniture-appliances',
      languages: { en: 'https://eno.vn/c/furniture-appliances', 'vi-VN': 'https://eno.vn/vi/c/furniture-appliances', 'x-default': 'https://eno.vn/c/furniture-appliances' },
    })
  })
})

/**
 * ⛔ THE PHASE-1 FAMILIES (owner, 2026-11-19): `/vi` + a category, a category×district, help or school path renders
 * Vietnamese for everyone; the PLAIN path keeps negotiating; the two pilot paths keep V-a. App and form pages never
 * match — checked against the real route tree, not a list of guesses (critic #6).
 */
const TWINNED = ['/c/rentals', '/c/furniture-appliances', '/c/rentals/binh-thanh', '/c/jobs/ha-noi', '/help', '/help/clx9a0b1c2d3e4f5g6h7i8j9k', '/help/help-renting-basics', '/schools', '/schools/jane-doe-123', '/schools/awards', '/schools/awards/2026']
const NOT_TWINNED = [
  '/c', '/c/', '/c/rentals/', '/c/Rentals', '/c/rentals.md', '/c/rentals/binh-thanh/x', '/c/-rentals', '/c/rentals--x',
  '/help/', '/help/x/y', '/help/X1', '/schools/', '/schools/suggest', '/schools/jane-doe-123/review', '/schools/awards/26', '/schools/awards/2026/x',
  '/listings/abc', '/listings/abc/edit', '/sellers/x', '/dashboard', '/dashboard/help', '/admin/schools', '/post', '/account', '/messages/x', '/saved',
  '/about', '/privacy', '/guides', '/huong-dan', '/thanh-ly-do-gia-dung-cu-tphcm', '/gia/apple-iphone-13', '/vi', '/vi/c/rentals', '/c/rentals?x=1', '',
]

describe('the phase-1 families', () => {
  it('ship on the marketplace with nothing retired; the services edition (vitest) has none', () => {
    expect(VI_RETIRED_FAMILIES).toEqual([])
    expect(MARKET).toEqual({ live: VI_PREFIX_PATHS, retired: VI_RETIRED_PATHS, families: VI_TWIN_FAMILIES, retiredFamilies: [] })
    for (const p of TWINNED) expect(hasViTwin(p), p).toBe(false) // VI_PILOT here is the services edition's
  })

  it('hasViTwin: a pilot path or an exact family path — never an app or form page, a listing or a seller', () => {
    for (const p of ['/', ...TWINNED]) expect(hasViTwin(p, MARKET), p).toBe(true)
    for (const p of NOT_TWINNED) expect(hasViTwin(p, MARKET), p).toBe(false)
    for (const p of TWINNED) expect(hasViTwin(p, OFF), p).toBe(false)
    expect(hasViTwin('/c/rentals', ON)).toBe(false) // a {live, retired} value is the pilot alone
  })

  it('viTwinPath: `/` → `/vi`, anything else is prefixed', () => {
    expect(viTwinPath('/')).toBe('/vi')
    expect(viTwinPath('/c/rentals')).toBe('/vi/c/rentals')
    expect(viTwinPath('/schools/awards/2026')).toBe('/vi/schools/awards/2026')
  })

  /** Every page route under src/app/[lang], as a sample public path: `[x]` → a slug (`[year]` → 2026), `(group)` dropped. */
  const routes = (() => {
    const out: { route: string; sample: string }[] = []
    const walk = (dir: string, segs: string[]) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) { walk(full, [...segs, name]); continue }
        if (!/^page(\.[a-z]+)*\.tsx$/.test(name)) continue
        const sample = '/' + segs.filter((s) => !/^\(.*\)$/.test(s)).map((s) => s === '[year]' ? '2026' : s.startsWith('[...') ? 'a/b' : s.startsWith('[') ? 'sample-slug' : s).join('/')
        out.push({ route: segs.join('/'), sample: sample === '/' ? '/' : sample.replace(/\/$/, '') })
      }
    }
    walk('src/app/[lang]', [])
    return out
  })()
  const FAMILY_ROUTES = ['(home)', 'c/[category]/(index)', 'c/[category]/[district]', 'help', 'help/[id]', 'schools', 'schools/[slug]', 'schools/awards', 'schools/awards/[year]', 'hcmc-rent-index',
    'rent-affordability-calculator', 'move-in-cost-calculator', 'rental-cost-comparison', 'vietnamese-price-converter', 'tools', 'tools/[slug]']

  it('⛔ against the real route tree: exactly the family routes (and the home pilot) have a twin', () => {
    expect(routes.length).toBeGreaterThan(50)
    const twinned = [...new Set(routes.filter((r) => hasViTwin(r.sample, MARKET)).map((r) => r.route))].sort()
    expect(twinned).toEqual([...FAMILY_ROUTES].sort())
    // …and every family pattern names at least one real route (no dead pattern)
    for (const re of VI_TWIN_FAMILIES) expect(routes.some((r) => re.test(r.sample)), String(re)).toBe(true)
  })

  it('the rent tools pattern names exactly the registry\'s slugs (a literal for the proxy bundle)', () => {
    const twinned = (slug: string) => hasViTwin(`/${slug}`, MARKET)
    expect(RENT_TOOL_SLUGS.filter(twinned)).toEqual([...RENT_TOOL_SLUGS])
    const re = VI_TWIN_FAMILIES.find((r) => r.test('/rental-cost-comparison'))!
    const listed = /\(\?:([^)]*)\)/.exec(re.source)![1].split('|')
    expect([...listed].sort()).toEqual([...RENT_TOOL_SLUGS].sort())
    for (const p of ['/rental-cost-comparison/x', '/vi/rental-cost-comparison', '/rent-affordability']) expect(re.test(p), p).toBe(false)
  })

  it('pinnedRoute: `/vi` + a family path renders vi at the plain internal path; the plain path negotiates; the pilot keeps V-a', () => {
    for (const p of TWINNED) {
      expect(pinnedRoute(viTwinPath(p), MARKET), p).toEqual({ variant: 'vi', internalPath: p })
      // one ISR entry: the internal path revalidatePublicPath purges for the plain path's vi variant
      const r = pinnedRoute(viTwinPath(p), MARKET)
      expect(r && 'variant' in r ? `/${r.variant}${r.internalPath}` : null).toBe(LANG_VARIANTS.map((l) => `/${l}${p}`).find((x) => x.startsWith('/vi')))
    }
    for (const p of TWINNED.filter((x) => x !== '/c/furniture-appliances')) expect(pinnedRoute(p, MARKET), p).toBeNull()
    expect(pinnedRoute('/', MARKET)).toEqual({ variant: 'en', internalPath: '/' })
    expect(pinnedRoute('/c/furniture-appliances', MARKET)).toEqual({ variant: 'en', internalPath: '/c/furniture-appliances' })
    expect(pinnedRoute('/vi', MARKET)).toEqual({ variant: 'vi', internalPath: '/' })
    for (const p of NOT_TWINNED.filter((x) => x.startsWith('/') && x !== '/vi' && !x.includes('?'))) expect(pinnedRoute(`/vi${p}`, MARKET), `/vi${p}`).toBeNull()
    expect(pinnedRoute('/thanh-ly-do-gia-dung-cu-tphcm', MARKET)).toEqual({ variant: 'vi', internalPath: '/thanh-ly-do-gia-dung-cu-tphcm' })
  })

  it('retired families (rollback V-R): `/vi…` 308s to the plain path, never a 404; the plain path still negotiates', () => {
    const r: ViPilot = { live: [], retired: [], retiredFamilies: VI_TWIN_FAMILIES }
    expect(pinnedRoute('/vi/c/rentals', r)).toEqual({ redirect: '/c/rentals' })
    expect(pinnedRoute('/vi/schools/awards/2026', r)).toEqual({ redirect: '/schools/awards/2026' })
    expect(pinnedRoute('/c/rentals', r)).toBeNull()
    expect(pinnedRoute('/vi/schools/suggest', r)).toBeNull()
    expect(localizedHref('/c/rentals', 'vi', r)).toBe('/c/rentals')
  })

  it('pinnedPair, stripViPrefix, localizedHref, hrefHere follow the families', () => {
    expect(pinnedPair('/vi/c/rentals', MARKET)).toBe('/c/rentals')
    expect(pinnedPair('/vi/help/x', MARKET)).toBe('/help/x')
    expect(pinnedPair('/c/rentals', MARKET)).toBeNull() // not pinned: it negotiates (setLang goes to viTwinPath itself)
    expect(stripViPrefix('/vi/c/rentals/binh-thanh', MARKET)).toBe('/c/rentals/binh-thanh')
    expect(stripViPrefix('/vi/dashboard', MARKET)).toBe('/vi/dashboard')
    expect(localizedHref('/c/rentals?sort=newest#top', 'vi', MARKET)).toBe('/vi/c/rentals?sort=newest#top')
    expect(localizedHref('/schools/awards/2026', 'vi', MARKET)).toBe('/vi/schools/awards/2026')
    expect(localizedHref('/schools/suggest', 'vi', MARKET)).toBe('/schools/suggest')
    expect(localizedHref('/listings/x', 'vi', MARKET)).toBe('/listings/x')
    expect(localizedHref('/c/rentals', 'en', MARKET)).toBe('/c/rentals')
    expect(hrefHere('/vi/c/rentals?q=1', MARKET)).toBe('/vi/c/rentals?q=1')
    expect(hrefHere('/vi/c/rentals?q=1', OFF)).toBe('/c/rentals?q=1')
  })

  it('langAlternates stays the pilot\'s: a family\'s head is the metadata\'s (robots-aware), not this helper\'s', () => {
    expect(langAlternates('/c/rentals', 'vi', 'https://eno.vn', MARKET)).toBeNull()
    expect(langAlternates('/c/furniture-appliances', 'en', 'https://eno.vn', MARKET)?.canonical).toBe('https://eno.vn/c/furniture-appliances')
  })
})
