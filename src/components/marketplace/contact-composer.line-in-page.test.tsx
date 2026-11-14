// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE GOODS SHEET'S PINNED TIER IS THE BUTTON ALONE (owner-approved 2026-11-15 (build 7), cook r07 "item"; ContactComposer
 * `lineInPage`): below md the line under Chat now is not drawn (`max-md:hidden`) and the column's 4px goes with it — the page
 * says the line once, as the seller band's last line, in the same words (src/lib/contact-line.ts). From md it is as it was. The
 * rental sheet's tier (no `lineInPage`) keeps its line.
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
import { contactLine } from '@/lib/contact-line'

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const LINE = 'Partners answer in eno chat. No phone number is shared.'
const box = (props: Partial<React.ComponentProps<typeof ContactComposer>> = {}) =>
  render(<ContactComposer listingId="l1" listingTitle="Honda SH" sellerName="Blvck Motorbike" currency="₫" price={300_000} negotiable={false} sellerIsPartner pinned {...props} />)

describe('ContactComposer lineInPage — the goods tier, the button alone', () => {
  it('the line is display:none below md only, and the column closes to 0 there', () => {
    box({ lineInPage: true })
    const line = screen.getByText(LINE)
    expect(line.className.split(' ')).toContain('max-md:hidden')
    expect(line.className).not.toMatch(/(^|\s)(hidden|md:hidden|sr-only)(\s|$)/)
    const col = screen.getByRole('button', { name: /Chat now/ }).parentElement!
    expect(col.className.split(' ')).toEqual(expect.arrayContaining(['space-y-2', 'max-md:space-y-0']))
    expect(col.className).not.toContain('max-md:space-y-1')
  })
  it('without it (the r06 tier, and the rental sheet\'s) the line shows under the button with the 4px column', () => {
    box()
    expect(screen.getByText(LINE).className).not.toContain('max-md:hidden')
    expect(screen.getByRole('button', { name: /Chat now/ }).parentElement!.className).toContain('max-md:space-y-1')
  })
  it('ignored without `pinned`', () => {
    box({ pinned: false, lineInPage: true })
    expect(screen.getByText(LINE).className).not.toContain('max-md:hidden')
  })
  it('the words are contact-line.ts\'s, the ones the page prints in the band', () => {
    const tr = (en: string) => en
    expect(contactLine('partner', tr)).toBe(LINE)
    box({ sellerIsPartner: false })
    expect(screen.getByText(contactLine('person', tr))).toBeTruthy()
  })
})
