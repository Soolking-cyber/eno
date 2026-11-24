// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
let signedIn = false
vi.mock('@/context/auth-context', () => ({ useAuthMaybe: () => (signedIn ? { user: { id: 'u1' } } : null) }))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; put the marketplace's lists in front.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

import { LanguageProvider } from '@/context/language-context'
import { MachineIndexLead, NotFoundBody, NotFoundHomeLink } from './not-found-body'

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

  it('⛔ a Vietnamese 404 searches and links the /vi home twin, never the English-pinned / (A1-LANG)', () => {
    const at = (lang: 'en' | 'vi') => {
      cleanup()
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
      return render(
        <LanguageProvider initialLang={lang} initialViDict={{}}>
          <NotFoundBody />
          <NotFoundHomeLink />
          <MachineIndexLead />
        </LanguageProvider>,
      ).container
    }
    pathname = '/nope-xyz'
    const vi = at('vi')
    expect(vi.querySelector('form')?.getAttribute('action')).toBe('/vi')
    expect(vi.querySelector('a')?.getAttribute('href')).toBe('/vi')
    expect(vi.textContent).toContain('Cần chỉ mục cho máy đọc?')
    const en = at('en')
    expect(en.querySelector('form')?.getAttribute('action')).toBe('/')
    expect(en.querySelector('a')?.getAttribute('href')).toBe('/')
    expect(en.textContent).toContain('Looking for a machine-readable index?')
  })
})

/**
 * ⛔ THE OWNER'S VIEW (owner, 2026-11-24, iOS app): a seller opening their OWN pending / held / hidden listing — from My
 * listings or right after posting — got "This page has moved on." For a signed-in reader, the 404 asks the owner-only
 * status route and, for the owner, says why it is not public with Edit / My listings; anyone else keeps the plain 404.
 */
describe('NotFoundBody — the owner of a listing that is not public', () => {
  afterEach(() => { signedIn = false; vi.unstubAllGlobals() })

  it('shows the owner why their pending listing is not public, with Edit and My listings', async () => {
    signedIn = true
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: 'pending' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderAt('/listings/cmwuluwde000001n0r2q022zr')
    await waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Your listing is not public yet.'))
    expect(fetchMock).toHaveBeenCalledWith('/api/listings/cmwuluwde000001n0r2q022zr/status', expect.objectContaining({ credentials: 'same-origin' }))
    expect(container.textContent).toContain('not approved yet')
    const hrefs = [...container.querySelectorAll('a')].map((x) => x.getAttribute('href'))
    expect(hrefs).toEqual(['/listings/cmwuluwde000001n0r2q022zr/edit', '/dashboard/listings'])
  })

  it('a hidden listing says so; the /en spelling of the path finds the same id', async () => {
    signedIn = true
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'hidden' }), { status: 200 })))
    const { container } = renderAt('/en/listings/abc123/')
    await waitFor(() => expect(container.textContent).toContain('You hid it'))
  })

  it('anyone the route refuses (not the owner, no shop) keeps the ordinary 404', async () => {
    signedIn = true
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderAt('/listings/someone-elses')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20)) // let the response chain settle before asserting it changed nothing
    expect(container.querySelector('h1')?.textContent).toBe('This page has moved on.')
  })

  it('signed out, not a listing path, or a listing\'s sub-page (edit): no request at all', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/listings/abc')
    signedIn = true
    cleanup()
    renderAt('/help/nope-topic')
    cleanup()
    renderAt('/listings/abc/edit')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
