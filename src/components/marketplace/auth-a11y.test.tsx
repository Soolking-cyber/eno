// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * A9-AUTH-A11Y (2026-10-04): the sign-in card's title and its clearance from the dialog's close button,
 * the /signin main landmark, and the gallery thumbs' names. The form itself is tested elsewhere
 * (src/lib/email-typo.test.ts for its email checks), so it is stubbed here.
 */
vi.mock('@/components/marketplace/sign-in-form', () => ({ SignInForm: () => null }))
vi.mock('next/image', () => ({ default: () => null }))

import { SignInCard } from './sign-in-card'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

function renderIn(lang: 'en' | 'vi', node: React.ReactNode) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
}

describe('SignInCard', () => {
  it('the generic title says "Log in or sign up" — one form does both (auth-04)', () => {
    expect(renderIn('en', <SignInCard titleAs="h1" />).container.querySelector('h1')!.textContent).toBe('Log in or sign up')
    cleanup()
    expect(renderIn('vi', <SignInCard titleAs="h1" />).container.querySelector('h1')!.textContent).toBe('Đăng nhập hoặc đăng ký')
  })

  it('keeps clear of the dialog’s top-right close button: pr-8 on the listing row, px-8 on the generic title (auth-05)', () => {
    // jsdom has no layout, so the clearance is pinned on the classes that make it: the close button is
    // the dialog's absolute top-right control (ui/dialog), 32px wide at most.
    const listing = renderIn('en', <SignInCard titleAs="h2" listingTitle="Honda Vision 2022, low mileage, one owner, papers ready" sellerName="An" />)
    const row = listing.container.querySelector('h2')!.closest('.flex') as HTMLElement
    expect(row.className).toMatch(/(^| )pr-8( |$)/)
    cleanup()
    const generic = renderIn('en', <SignInCard titleAs="h2" />)
    expect(generic.container.querySelector('h2')!.className).toMatch(/(^| )px-8( |$)/)
  })
})

describe('source contracts', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

  it('/signin has a <main id="main" tabIndex={-1}> for the skip link (quality-12)', () => {
    const s = src('src/app/[lang]/signin/page.tsx')
    expect(s).toMatch(/<main id="main" tabIndex=\{-1\}/)
    expect(s).toContain('</main>')
  })

  it('gallery thumbs are named "Photo n of total" in the reader’s language, not the English title (quality-12)', () => {
    const s = src('src/components/marketplace/listing-gallery.tsx')
    const label = "aria-label={tr('Photo {n} of {total}', 'Ảnh {n}/{total}').replace('{n}', String(i + 1)).replace('{total}', String(images.length))}"
    expect(s.split(label)).toHaveLength(3) // the inline thumb rail and the lightbox strip
    // (The photos' ALT text keeps the title — the gallery is a landmine file and only the thumbs changed.)
    expect(s).not.toContain('aria-label={`${title} — photo')
  })
})
