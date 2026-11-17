// @vitest-environment jsdom
/**
 * The /saved header's price-drop alerts switch (owner, 2026-11-17 — "explicit opt-in"). Pinned: nothing for a guest, before the
 * server answered, or with no saves while OFF — but an ON with no saves stays, so it can be switched off; an ON carries THIS
 * bundle's notice version, an OFF nothing else; never optimistic (the switch draws the answer, disabled meanwhile); a 409 or a
 * 429 says so and changes nothing; any other failure says "couldn't save" and re-reads the server.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRICE_ALERT_NOTICE_VERSION } from '@/lib/price-drop-rules'

const { auth, toastError } = vi.hoisted(() => ({ auth: { user: null as null | { id: string } }, toastError: vi.fn() }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The popover's own behaviour is ui/popover's; here its content is drawn inline so the switch can be reached.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { render: React.ReactElement }) => render,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { PriceAlertsButton } from './price-alerts-button'

const LABEL = 'Tell me when a saved listing drops in price'
type Answer = { status: number; body: unknown } | 'network'
let answers: Answer[] = []
const requests: Array<{ method: string; body: unknown }> = []
let hold: { release: () => void } | null = null
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url !== '/api/saved-listings/price-alerts') throw new Error(`unexpected request: ${url}`)
  const method = init?.method ?? 'GET'
  requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
  if (method === 'POST' && hold) await new Promise<void>((r) => { hold!.release = r })
  const a = answers.shift()
  if (!a || a === 'network') throw new TypeError('Failed to fetch')
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body }
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const sw = () => screen.getByRole('switch', { name: LABEL })

beforeEach(() => {
  auth.user = { id: 'p1' }
  answers = []
  requests.length = 0
  hold = null
  fetchMock.mockClear()
  toastError.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PriceAlertsButton', () => {
  it('a guest: nothing, and no request', async () => {
    auth.user = null
    const { container } = render(<PriceAlertsButton hasSaves />)
    await settle()
    expect(container.innerHTML).toBe('')
    expect(requests).toEqual([])
  })

  it('nothing before the server answers, nor when the read fails', async () => {
    hold = null
    answers = ['network']
    const { container } = render(<PriceAlertsButton hasSaves />)
    expect(container.innerHTML).toBe('')
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('no saves and OFF: nothing; no saves and ON: shown, so it can be switched off', async () => {
    answers = [{ status: 200, body: { on: false } }]
    const off = render(<PriceAlertsButton hasSaves={false} />)
    await settle()
    expect(off.container.innerHTML).toBe('')
    off.unmount()
    answers = [{ status: 200, body: { on: true } }]
    render(<PriceAlertsButton hasSaves={false} />)
    await settle()
    expect(screen.getByRole('button', { name: 'Price-drop alerts' })).toBeTruthy()
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('the notice and the policy link sit with the switch', async () => {
    answers = [{ status: 200, body: { on: false } }]
    render(<PriceAlertsButton hasSaves />)
    await settle()
    expect(screen.getByText(/We use the listings you save to tell you when one drops in price/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('⛔ an ON sends the notice THIS page shows, and the switch moves only on the answer — disabled meanwhile', async () => {
    answers = [{ status: 200, body: { on: false } }, { status: 200, body: { on: true } }]
    render(<PriceAlertsButton hasSaves />)
    await settle()
    hold = { release: () => {} }
    fireEvent.click(sw())
    await settle()
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(sw().hasAttribute('data-disabled')).toBe(true)
    await act(async () => { hold!.release() })
    await settle()
    expect(requests.filter((r) => r.method === 'POST')).toEqual([{ method: 'POST', body: { on: true, notice: PRICE_ALERT_NOTICE_VERSION } }])
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('an OFF sends nothing but the switch', async () => {
    answers = [{ status: 200, body: { on: true } }, { status: 200, body: { on: false } }]
    render(<PriceAlertsButton hasSaves />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(requests[1]).toEqual({ method: 'POST', body: { on: false } })
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  it.each([
    [409, 'This page is out of date: the notice changed while it was open. Reload the page to read it, then switch this on.'],
    [429, 'Too many changes in a short time — try again in a little while.'],
  ])('a %s says so and changes nothing — no re-read', async (status, line) => {
    answers = [{ status: 200, body: { on: false } }, { status, body: { error: 'x' } }]
    render(<PriceAlertsButton hasSaves />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(toastError).toHaveBeenCalledWith(line)
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST'])
  })

  it('any other failure says "couldn’t save" and draws what a re-read of the server says', async () => {
    // The save timed out on the wire but committed: the re-read shows it ON.
    answers = [{ status: 200, body: { on: false } }, 'network', { status: 200, body: { on: true } }]
    render(<PriceAlertsButton hasSaves />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(toastError).toHaveBeenCalledWith("Couldn't save that — try again")
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'GET'])
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })
})
