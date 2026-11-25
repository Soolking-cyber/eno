// @vitest-environment jsdom
/**
 * THE CREATIVE AD CARD (owner 2026-11-25): the whole card is one link to the advertiser's own https page in a new tab,
 * marked paid (`rel="sponsored"`, no opener, no referrer), labelled "Quảng cáo · Ad" in every language, counted by
 * <AdBeacons> through `data-ad-id`; the headline in the viewer's language through the listing titles' own path.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, sizes: _s, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
const h = vi.hoisted(() => ({ lang: 'en' }))
// The listing titles' own localisation: the embedded translation for the viewer's language, else the text as written.
vi.mock('./listing-content', () => ({ useLocalized: (text: string, _vi: unknown, i18n: Record<string, string> | null) => i18n?.[h.lang] ?? text }))

import { AdCreativeCard } from './ad-creative-card'
import { isAdCreativeCardData } from '@/lib/ads/creative-card'

const AD = {
  adId: 'cmad0000001', advertiserName: 'Saigon Bean', headline: 'Cà phê rang xay mỗi sáng', body: 'Giao tận nơi',
  headlineI18n: { en: 'Fresh roasted coffee every morning' }, imageUrl: 'https://sb.example/storage/v1/object/public/listings/ads/1.webp', clickUrl: 'https://saigonbean.vn/',
}
afterEach(cleanup)

describe('AdCreativeCard', () => {
  it('one link to the advertiser\'s page: new tab, rel sponsored noopener noreferrer, data-ad-id for the beacons', () => {
    const { container } = render(<AdCreativeCard ad={AD} />)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    const a = links[0]!
    expect(a.getAttribute('href')).toBe('https://saigonbean.vn/')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('sponsored noopener noreferrer')
    expect(a.getAttribute('data-ad-id')).toBe('cmad0000001')
    // Nothing interactive inside the link.
    expect(a.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('labelled "Quảng cáo · Ad", with the advertiser\'s name as written, in the accessible name too', () => {
    const { container, getByText } = render(<AdCreativeCard ad={AD} />)
    expect(container.querySelector('[data-ad-marker]')!.textContent).toBe('Quảng cáo · Ad')
    expect(getByText('Saigon Bean')).toBeTruthy()
    expect(container.querySelector('a')!.getAttribute('aria-label')).toBe('Quảng cáo · Ad: Fresh roasted coffee every morning — Saigon Bean')
  })

  it('the headline in the viewer\'s language when the store has it, else as the advertiser wrote it; the picture untouched', () => {
    h.lang = 'en'
    const en = render(<AdCreativeCard ad={AD} />)
    expect(en.getByText('Fresh roasted coffee every morning')).toBeTruthy()
    expect(en.container.querySelector('img')!.getAttribute('src')).toBe(AD.imageUrl)
    cleanup()
    h.lang = 'ko'
    expect(render(<AdCreativeCard ad={AD} />).getByText('Cà phê rang xay mỗi sáng')).toBeTruthy()
    h.lang = 'en'
  })

  it('the same square, edge-grid photo as the listing cards (their own classes)', () => {
    const { container } = render(<AdCreativeCard ad={AD} />)
    expect(container.querySelector('a')!.className).toContain('card-root')
    expect(container.querySelector('.card-media')!.className).toContain('aspect-square')
    expect(container.querySelector('img')!.className).toContain('card-img')
  })
})

describe('isAdCreativeCardData (the feed field, checked before anything draws it)', () => {
  it('https picture and link, short words — anything else is no card', () => {
    expect(isAdCreativeCardData(AD)).toBe(true)
    expect(isAdCreativeCardData({ ...AD, clickUrl: 'javascript:alert(1)' })).toBe(false)
    expect(isAdCreativeCardData({ ...AD, clickUrl: 'http://saigonbean.vn/' })).toBe(false)
    expect(isAdCreativeCardData({ ...AD, imageUrl: 'data:image/png;base64,AAA' })).toBe(false)
    expect(isAdCreativeCardData({ ...AD, headline: '' })).toBe(false)
    expect(isAdCreativeCardData({ ...AD, headlineI18n: { en: 5 } })).toBe(false)
    expect(isAdCreativeCardData(null)).toBe(false)
  })
})
