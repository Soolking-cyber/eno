// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { categoryFromPath, explorerFallbackUrl, explorerMounted, useRegisterExplorer } from './explorer-presence'

/**
 * vitest runs as the SERVICES edition (vitest.config.ts), where the `/vi` pilot is off and `localizedHref` is
 * the identity — so the marketplace's lists (lang-pinned.ts VI_PREFIX_PATHS) are put in front of it here.
 */
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  const ON = { live: m.VI_PREFIX_PATHS, retired: [] }
  return {
    ...m,
    localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, ON),
    stripViPrefix: (p: string | null | undefined) => m.stripViPrefix(p, ON),
  }
})


describe('explorer presence — asked, never guessed from the path', () => {
  it('is absent until an explorer mounts, present while it is, absent after', () => {
    expect(explorerMounted()).toBe(false)
    const a = renderHook(() => useRegisterExplorer())
    expect(explorerMounted()).toBe(true)
    a.unmount()
    expect(explorerMounted()).toBe(false)
  })

  it('counts instances: one unmounting does not hide another still mounted', () => {
    const a = renderHook(() => useRegisterExplorer())
    const b = renderHook(() => useRegisterExplorer())
    a.unmount()
    expect(explorerMounted()).toBe(true)
    b.unmount()
    expect(explorerMounted()).toBe(false)
  })
})

describe('explorerFallbackUrl — where an explorer action goes when none is mounted', () => {
  it('⛔ a /c/<category> landing page keeps its category (the bug: search there did nothing at all)', () => {
    expect(explorerFallbackUrl('/c/rentals', { q: 'iphone' })).toBe('/?category=rentals&q=iphone')
    expect(explorerFallbackUrl('/c/vehicles', { view: 'map' })).toBe('/?category=vehicles&view=map')
  })

  it('a district landing page keeps the category, not the district slug', () => {
    expect(explorerFallbackUrl('/c/electronics/thao-dien', { q: 'tv' })).toBe('/?category=electronics&q=tv')
  })

  it('anywhere else goes to the plain home explorer', () => {
    expect(explorerFallbackUrl('/listings/abc', { q: 'bike' })).toBe('/?q=bike')
    expect(explorerFallbackUrl('/dashboard')).toBe('/')
    expect(explorerFallbackUrl(null, { q: '' })).toBe('/')
  })

  it('an explicit category (a photo search\'s detected one) wins over the page\'s', () => {
    expect(explorerFallbackUrl('/c/rentals', { q: 'lamp', match: 'any', category: 'furniture-appliances' }))
      .toBe('/?category=furniture-appliances&q=lamp&match=any')
  })

  it('⛔ a Vietnamese page goes to the /vi twin, never the English-pinned / (A1-LANG, field-01)', () => {
    expect(explorerFallbackUrl('/c/rentals', { q: 'nhà' }, 'vi')).toBe('/vi?category=rentals&q=nh%C3%A0')
    expect(explorerFallbackUrl('/listings/abc', { view: 'map' }, 'vi')).toBe('/vi?view=map')
    expect(explorerFallbackUrl('/dashboard', {}, 'vi')).toBe('/vi')
    // The /vi twin of a piloted category page keeps its category.
    expect(explorerFallbackUrl('/vi/c/furniture-appliances', { q: 'sofa' }, 'vi')).toBe('/vi?category=furniture-appliances&q=sofa')
    // English (and the default) is unchanged.
    expect(explorerFallbackUrl('/c/rentals', { q: 'x' }, 'en')).toBe('/?category=rentals&q=x')
  })

  it('categoryFromPath: only /c/ paths, decoded, and a malformed escape is null rather than a throw', () => {
    expect(categoryFromPath('/c/fashion-beauty')).toBe('fashion-beauty')
    expect(categoryFromPath('/c/fashion-beauty/district-1')).toBe('fashion-beauty')
    expect(categoryFromPath('/category/x')).toBeNull()
    expect(categoryFromPath('/c/%E0%A4%A')).toBeNull()
    expect(categoryFromPath(undefined)).toBeNull()
  })
})
