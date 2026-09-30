// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { LanguageProvider } from '@/context/language-context'
import { NotFoundBody } from './not-found-body'

/**
 * ⛔ THE 404's HEADING AND LEDE COME FROM ONE PATH TEST (review, 2026-09-29). The lede learned the path
 * while the h1 stayed "This page has moved on." — so /nope-xyz, a URL that never existed, read "moved
 * on" over "The link may be mistyped".
 */
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

function renderAt(path: string, lang: 'en' | 'vi' = 'en') {
  pathname = path
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <NotFoundBody />
    </LanguageProvider>,
  )
}

describe('NotFoundBody', () => {
  it.each(['/nope-xyz', '/help/nope-topic', '/vi/nope/xyz'])('⛔ a path that is not a listing does not claim the page "moved on": %s', (path) => {
    const { container } = renderAt(path)
    expect(container.querySelector('h1')?.textContent).toBe("We can't find that page.")
    expect(container.querySelector('p')?.textContent).toBe('The link may be mistyped or out of date.')
    expect(container.textContent).not.toContain('moved on')
  })

  it.each(['/listings/abc123', '/en/listings/abc123'])('a missing listing keeps the "moved on" heading and the sold/taken-down lede: %s', (path) => {
    const { container } = renderAt(path)
    expect(container.querySelector('h1')?.textContent).toBe('This page has moved on.')
    expect(container.querySelector('p')?.textContent).toContain('The listing may have sold')
  })

  it('reads in Vietnamese on the Vietnamese variant', () => {
    expect(renderAt('/nope-xyz', 'vi').container.querySelector('h1')?.textContent).toBe('Không tìm thấy trang này.')
    cleanup()
    expect(renderAt('/listings/abc123', 'vi').container.querySelector('h1')?.textContent).toBe('Trang này không còn tồn tại.')
  })

  it('renders exactly one h1 — the page shell no longer carries its own', () => {
    expect(renderAt('/nope-xyz').container.querySelectorAll('h1')).toHaveLength(1)
  })
})
