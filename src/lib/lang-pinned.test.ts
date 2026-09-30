import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { FIXED_LANG, pinnedPair, pinnedRoute } from './lang-pinned'
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
