import { describe, expect, it, vi } from 'vitest'

/**
 * /rentals/check names itself in the language the HTML is rendered in (rentals-15): a Vietnamese reader's
 * tab read "Check availability". It stays noindex in both. The page's chrome and its client view are
 * stubbed — the real ones pull in the whole client app, and only the metadata is under test here.
 */
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('./rental-check-view', () => ({ RentalCheckView: () => null }))

const { generateMetadata } = await import('./page')
const meta = (lang: string) => generateMetadata({ params: Promise.resolve({ lang }) })

describe('/rentals/check metadata', () => {
  it('is titled in the page language and stays out of the index', async () => {
    const vi_ = await meta('vi')
    expect(String(vi_.title)).toMatch(/^Kiểm tra phòng trống \| /)
    expect(vi_.robots).toEqual({ index: false, follow: false })
    const en = await meta('en')
    expect(String(en.title)).toMatch(/^Check availability \| /)
    expect(en.robots).toEqual({ index: false, follow: false })
  })
})
