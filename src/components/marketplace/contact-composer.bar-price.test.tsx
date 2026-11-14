// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE RENTAL SHEET'S PINNED TIER (owner-approved 2026-11-15 (build 7), cook r07 "rental"; src/lib/rental-sheet.ts
 * pinsRentalAction): with `pinned` and `barPrice`, the price and Chat now share one row below md — the price first (a copy of the
 * head's, aria-hidden, display:none from md), the button at its natural width — and the line under both stays whole and visible.
 * Without `barPrice` the pinned box is the goods sheet's (the button alone over its line); without `pinned` it is ignored.
 */
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (t: string) => t }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, identityLoaded: true, accountType: null, openSignIn: vi.fn() }) }))

import { ContactComposer } from './contact-composer'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const PRICE_TEXT = '3,800,000 đ / month'
const price = <span data-testid="bar-price">{PRICE_TEXT}</span>
const tier = (props: Partial<React.ComponentProps<typeof ContactComposer>> = {}) =>
  render(<ContactComposer listingId="l1" listingTitle="Studio" sellerName="GoPlus" currency="₫" price={3_800_000} negotiable={false} sellerIsPartner pinned barPrice={price} {...props} />)

describe('ContactComposer barPrice — the rental tier', () => {
  it('one row below md: the aria-hidden price (md:hidden) BEFORE Chat now, which keeps its natural width', () => {
    tier()
    const chat = screen.getByRole('button', { name: /Chat now/ })
    const row = chat.parentElement!
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['max-md:flex', 'max-md:items-center', 'max-md:gap-4']))
    const box = row.firstElementChild!
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'md:hidden']))
    expect(box.contains(screen.getByTestId('bar-price'))).toBe(true)
    expect(box.nextElementSibling).toBe(chat)
    expect(chat.className.split(' ')).toEqual(expect.arrayContaining(['max-md:w-auto', 'max-md:min-w-38', 'max-md:shrink-0', 'max-md:px-5.5', 'max-md:min-h-12', 'max-md:rounded-xl', 'w-full']))
  })

  it('the partner line stays under both, whole and visible', () => {
    tier()
    const line = screen.getByText('Partners answer in eno chat. No phone number is shared.')
    expect(line.className).not.toMatch(/(^|\s)(hidden|sr-only|max-md:hidden)(\s|$)/)
    const chat = screen.getByRole('button', { name: /Chat now/ })
    expect(chat.parentElement!.nextElementSibling).toBe(line)
  })

  it('without `pinned` the price is ignored: the block is what it was', () => {
    tier({ pinned: false })
    expect(screen.queryByTestId('bar-price')).toBeNull()
    const chat = screen.getByRole('button', { name: /Chat now/ })
    expect(chat.className).not.toMatch(/max-md:w-auto|max-md:min-w-38/)
  })

  it('the goods sheet\'s tier (pinned, no price) is unchanged: the button alone over its line', () => {
    tier({ barPrice: undefined })
    const chat = screen.getByRole('button', { name: /Chat now/ })
    expect(chat.className).not.toMatch(/max-md:w-auto/)
    expect(chat.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['space-y-2', 'max-md:space-y-1']))
  })
})
