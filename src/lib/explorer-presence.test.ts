// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { categoryFromPath, explorerFallbackUrl, explorerMounted, useRegisterExplorer } from './explorer-presence'

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

  it('categoryFromPath: only /c/ paths, decoded, and a malformed escape is null rather than a throw', () => {
    expect(categoryFromPath('/c/fashion-beauty')).toBe('fashion-beauty')
    expect(categoryFromPath('/c/fashion-beauty/district-1')).toBe('fashion-beauty')
    expect(categoryFromPath('/category/x')).toBeNull()
    expect(categoryFromPath('/c/%E0%A4%A')).toBeNull()
    expect(categoryFromPath(undefined)).toBeNull()
  })
})
