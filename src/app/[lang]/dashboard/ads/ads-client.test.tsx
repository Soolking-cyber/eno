// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * /dashboard/ads, the page around the form (owner 2026-11-26: "ads page is empty how can user create there"). Pinned:
 * ⛔ "Create an ad" is reachable on a computer, never only in the phone title bar (<SectionHeader> is lg:hidden, which is
 * how a desktop page came to have no button at all); an empty page pitches the ad and opens the form from its own button;
 * the button is never shown twice on one screen size.
 */
type Json = Record<string, unknown>
const h = vi.hoisted(() => ({ mine: { ads: [], orders: [], updated_at: '2026-11-26T08:00:00.000Z' } as Json }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }), Tr: ({ text }: { text: string }) => text }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The phone title bar as what it is: lg:hidden chrome holding the title and the action.
vi.mock('@/components/marketplace/section-header', () => ({
  SectionHeader: ({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) => <div data-testid="phone-bar" className="lg:hidden"><span>{title}</span>{action}</div>,
}))

const { AdsClient } = await import('./ads-client')

const ORDER = { id: 'ad1', reference: 'ENOAD 7K3F9Q', status: 'awaiting_transfer', kind: 'listing', period: 'week', amount_vnd: 99_000, created_at: '2026-11-26T03:00:00.000Z', expires_at: '2026-12-03T03:00:00.000Z', target: 'Honda Vision' }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><AdsClient /></QueryClientProvider>)
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  h.mine = { ads: [], orders: [], updated_at: '2026-11-26T08:00:00.000Z' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/ads/mine') return new Response(JSON.stringify(h.mine), { status: 200 })
    if (url === '/api/ads/options') return new Response(JSON.stringify({ bank: true, shop: true, creative: false, listings: [{ id: 'l1', title: 'Honda Vision', photo: null }] }), { status: 200 })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const desktopHeader = () => document.querySelector<HTMLElement>('[data-slot="page-header"]')!

describe('/dashboard/ads', () => {
  it('an empty page pitches the ad and opens the form from its own button, once', async () => {
    mount()
    await flush()
    expect(screen.getByRole('heading', { level: 1, name: 'Ads' })).toBeTruthy()
    expect(screen.getByText('Show your listing first')).toBeTruthy()
    // The price never breaks from its đ (a no-break space).
    expect(document.body.textContent).toContain('From 99,000\u00a0đ a week.')
    // One "Create an ad" on the page: the empty state's (neither header repeats it).
    expect(screen.getAllByRole('button', { name: 'Create an ad' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Create an ad' }))
    await flush()
    expect(screen.getByRole('radiogroup', { name: 'How long' })).toBeTruthy()
    expect(screen.queryByText('Show your listing first')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create an ad' })).toBeNull()
    // Cancel closes the form and brings the pitch back.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Show your listing first')).toBeTruthy()
  })

  it('⛔ with something listed, the desktop title row carries "Create an ad" — not only the phone bar', async () => {
    h.mine = { ...h.mine, orders: [ORDER] }
    mount()
    await flush()
    expect(within(desktopHeader()).getByRole('button', { name: 'Create an ad' })).toBeTruthy()
    expect(within(screen.getByTestId('phone-bar')).getByRole('button', { name: 'Create an ad' })).toBeTruthy()
    // The desktop copy is hidden below lg, the phone bar's at lg and up: one per screen size.
    expect(within(desktopHeader()).getByRole('button', { name: 'Create an ad' }).closest('.max-lg\\:hidden')).toBeTruthy()
    fireEvent.click(within(desktopHeader()).getByRole('button', { name: 'Create an ad' }))
    await flush()
    expect(screen.getByRole('radiogroup', { name: 'How long' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create an ad' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Awaiting transfer' })).toBeTruthy()
  })
})
