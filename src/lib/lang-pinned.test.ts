import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { FIXED_LANG, VI_PILOT, viPilotFor, VI_PREFIX_PATHS, VI_RETIRED_PATHS, langAlternates, localizedHref, pinnedPair, pinnedRoute, stripViPrefix, type ViPilot } from './lang-pinned'
import { LANG_VARIANTS } from './lang-variant'
import { EXPAT_GUIDES, MARKETPLACE_GUIDES } from './expat-guides'
import { PHONE_GUIDES } from './phone-guides'

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
})

describe('pinnedPair', () => {
  it('gives the translation of a paired guide, and null otherwise', () => {
    expect(pinnedPair('/thanh-ly-do-gia-dung-cu-tphcm')).toBe('/secondhand-furniture-ho-chi-minh-city')
    expect(pinnedPair('/secondhand-furniture-ho-chi-minh-city')).toBe('/thanh-ly-do-gia-dung-cu-tphcm')
    expect(pinnedPair('/dang-tin-ban-hang-mien-phi')).toBeNull()
    expect(pinnedPair('/c/rentals')).toBeNull()
    expect(pinnedPair('/constructor')).toBeNull()
  })
})

/**
 * ⛔ THE `/vi` PILOT (SEO wave B, V3a/V3b merged switched OFF, V5 switches it on). Every function takes the
 * lists as a parameter, so each is tested off (as merged by V3a), on (V5's list), and retired (V-R).
 */
const OFF: ViPilot = { live: [], retired: [] }
const ON: ViPilot = { live: ['/', '/c/furniture-appliances'], retired: [] }
const RETIRED: ViPilot = { live: [], retired: ['/', '/c/furniture-appliances'] }

describe('the pilot lists', () => {
  it('ship V5\'s list — the pilot is on for `/` and `/c/furniture-appliances`, nothing retired', () => {
    expect(VI_PREFIX_PATHS).toEqual(ON.live)
    expect(VI_RETIRED_PATHS).toEqual([])
    // vitest runs as the SERVICES edition (vitest.config.ts), where the pilot is always off; the
    // marketplace build takes the lists as they are
    expect(VI_PILOT).toEqual(OFF)
    expect(viPilotFor(false, VI_PREFIX_PATHS, VI_RETIRED_PATHS)).toEqual(ON)
  })

  it('⛔ eno.forum never pilots, whatever the lists hold; the marketplace takes them as they are (review)', () => {
    expect(viPilotFor(true, ON.live, ['/x'])).toEqual(OFF)
    expect(viPilotFor(false, ON.live, ['/x'])).toEqual({ live: ON.live, retired: ['/x'] })
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

  it('⛔ never produces a /vi path outside the live list', () => {
    const hrefs = ['/', '/c/furniture-appliances', '/c/rentals', '/c/furniture-appliances/binh-trung', '/listings/x', '/vi', '//evil.example/', 'https://eno.vn/', '#x', '?q=1', '/c/furniture-appliances/']
    for (const lists of [OFF, ON, RETIRED]) {
      for (const h of hrefs) {
        const out = localizedHref(h, 'vi', lists)
        if (out !== h) {
          const path = out.split(/[?#]/)[0]
          expect(lists.live.includes(path === '/vi' ? '/' : path.slice(3)), `${h} -> ${out}`).toBe(true)
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
