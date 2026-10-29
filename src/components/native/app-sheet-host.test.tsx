// @vitest-environment jsdom
/**
 * The app's page sheet (src/lib/app-sheet.ts). In the app, a NEW-WINDOW link to an eno page opens here, over the
 * screen — it used to leave for Safari or the in-app browser, which showed the whole site again and iOS's "Open in the
 * eno app" banner (owner, 2026-10-29). Everything else keeps its old way: another site, a download, a modified click,
 * a same-window link, and every link on the web.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/signin' }))
const openExternal = vi.fn(async (_url: string) => {})
vi.mock('@/lib/native-browser', () => ({
  isNativeShell: () => !!(window as unknown as { Capacitor?: unknown }).Capacitor,
  openExternal: (url: string) => openExternal(url),
}))

import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills } from '@/test/drawer-env'
import { APP_SHEET_EXTERNAL_EVENT } from '@/lib/app-sheet'
import { AppSheetHost } from './app-sheet-host'

const DONE = 'Done'
const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const realUA = navigator.userAgent

beforeAll(() => installDrawerPolyfills())
afterAll(() => vi.resetConfig())
vi.setConfig({ testTimeout: 20_000 })
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
  openExternal.mockClear()
  vi.unstubAllEnvs()
})

const asApp = () => {
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
  Object.defineProperty(navigator, 'userAgent', { value: APP_UA, configurable: true })
  ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
}

/** A link on the page (outside the host), clicked like a finger would. */
const click = (attrs: Record<string, string>, init: MouseEventInit = {}) => {
  const a = document.createElement('a')
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  a.textContent = 'link'
  document.body.appendChild(a)
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  act(() => { a.dispatchEvent(e) })
  return e
}

const frame = () => document.querySelector('iframe[data-app-sheet]') as HTMLIFrameElement | null

describe('AppSheetHost — in the app', () => {
  it('a new-window link to an eno page opens the sheet over the screen, marked, on this origin', async () => {
    asApp()
    render(<AppSheetHost />)
    const e = click({ href: '/terms', target: '_blank', rel: 'noreferrer' })
    expect(e.defaultPrevented).toBe(true)
    await waitFor(() => expect(frame()).toBeTruthy())
    expect(frame()!.getAttribute('src')).toBe(`${window.location.origin}/terms?app_sheet=1`)
    expect(screen.getByRole('button', { name: DONE })).toBeTruthy()
  })

  it('an explicit eno.vn link from another origin keeps its old way out (no folding across origins — app-sheet.test.ts)', () => {
    asApp() // jsdom is not on eno.vn; the fold onto eno.vn itself is covered in app-sheet.test.ts
    render(<AppSheetHost />)
    expect(click({ href: 'https://www.eno.vn/privacy', target: '_blank' }).defaultPrevented).toBe(false)
    expect(frame()).toBeNull()
  })

  it('"Done" closes it and the screen underneath is untouched', async () => {
    asApp()
    render(<AppSheetHost />)
    click({ href: '/regulations', target: '_blank' })
    await waitFor(() => expect(frame()).toBeTruthy())
    act(() => { screen.getByRole('button', { name: DONE }).click() })
    await waitFor(() => expect(frame()).toBeNull())
  })

  it('leaves alone: another site, the sister site, a same-window link, a download, a file, a modified click', () => {
    asApp()
    render(<AppSheetHost />)
    expect(click({ href: 'https://zalo.me/123', target: '_blank' }).defaultPrevented).toBe(false)
    expect(click({ href: 'https://eno.forum/visa', target: '_blank' }).defaultPrevented).toBe(false)
    expect(click({ href: '/terms' }).defaultPrevented).toBe(false)
    expect(click({ href: '/terms', target: '_self' }).defaultPrevented).toBe(false)
    expect(click({ href: '/terms', target: '_blank', download: '' }).defaultPrevented).toBe(false)
    expect(click({ href: '/docs/a.pdf', target: '_blank' }).defaultPrevented).toBe(false)
    expect(click({ href: '/terms', target: '_blank' }, { metaKey: true }).defaultPrevented).toBe(false)
    expect(frame()).toBeNull()
  })

  it('a link a handler already took is not opened twice', () => {
    asApp()
    render(<AppSheetHost />)
    const a = document.createElement('a')
    a.href = '/terms'
    a.target = '_blank'
    document.body.appendChild(a)
    window.addEventListener('click', (ev) => ev.preventDefault(), { capture: true, once: true }) // before the host's document listener
    const e = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { a.dispatchEvent(e) })
    expect(frame()).toBeNull()
  })

  it('a link whose own handler takes the click (like a React onClick) keeps it — no sheet on top', async () => {
    asApp()
    render(<AppSheetHost />)
    const a = document.createElement('a')
    a.href = '/terms'
    a.target = '_blank'
    a.addEventListener('click', (ev) => ev.preventDefault()) // bubble phase on the link: after the host's capture listener
    document.body.appendChild(a)
    act(() => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    await new Promise((r) => setTimeout(r, 20))
    expect(frame()).toBeNull()
  })

  it('a handler that checks defaultPrevented FIRST still gets its click — the sheet decides last (review, codex)', async () => {
    asApp()
    render(<AppSheetHost />)
    const own = vi.fn()
    const a = document.createElement('a')
    a.href = '/terms'
    a.target = '_blank'
    a.addEventListener('click', (ev) => { if (ev.defaultPrevented) return; ev.preventDefault(); own() })
    document.body.appendChild(a)
    act(() => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    await new Promise((r) => setTimeout(r, 20))
    expect(own).toHaveBeenCalledTimes(1)
    expect(frame()).toBeNull()
  })

  it('a handler that stops propagation keeps the click entirely — the link takes its old way out', async () => {
    asApp()
    render(<AppSheetHost />)
    const a = document.createElement('a')
    a.href = '/listings/abc'
    a.target = '_blank'
    a.addEventListener('click', (ev) => ev.stopPropagation())
    document.body.appendChild(a)
    const e = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { a.dispatchEvent(e) })
    expect(e.defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(frame()).toBeNull()
  })

  it('stopping propagation and THEN preventing the default keeps the click for that handler', async () => {
    asApp()
    render(<AppSheetHost />)
    const a = document.createElement('a')
    a.href = '/listings/abc'
    a.target = '_blank'
    a.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault() })
    document.body.appendChild(a)
    act(() => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    await new Promise((r) => setTimeout(r, 20))
    expect(frame()).toBeNull()
  })

  it('a link the sheet\'s page hands up goes where the app sends other sites', async () => {
    asApp()
    render(<AppSheetHost />)
    act(() => { window.dispatchEvent(new CustomEvent(APP_SHEET_EXTERNAL_EVENT, { detail: 'https://zalo.me/1' })) })
    expect(openExternal).toHaveBeenCalledWith('https://zalo.me/1')
  })
})

describe('AppSheetHost — what the sheet\'s page hands up', () => {
  it('a phone scheme becomes a main-frame navigation; a script URL is dropped', () => {
    asApp()
    render(<AppSheetHost />)
    const before = window.location.href
    act(() => { window.dispatchEvent(new CustomEvent(APP_SHEET_EXTERNAL_EVENT, { detail: 'javascript:alert(1)' })) })
    expect(window.location.href).toBe(before)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('AppSheetHost — the switch', () => {
  it('with app-signin-tidy off, the app\'s links take their old way out again', () => {
    asApp()
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    render(<AppSheetHost />)
    expect(click({ href: '/terms', target: '_blank' }).defaultPrevented).toBe(false)
    expect(frame()).toBeNull()
  })
})

describe('AppSheetHost — on the web', () => {
  it('never touches a link: the browser opens its new tab as always', () => {
    render(<AppSheetHost />)
    expect(click({ href: '/terms', target: '_blank' }).defaultPrevented).toBe(false)
    expect(frame()).toBeNull()
  })
})
