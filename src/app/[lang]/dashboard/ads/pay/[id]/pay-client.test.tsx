// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * A UCP checkout's continue_url (/dashboard/ads/pay/[id]): signed out → sign in with the listing's shop; signed in → the ad,
 * one Pay button, then the dashboard's own QR + "I've paid" (OrderPay); an expired link says so in words.
 */
type Json = Record<string, unknown>
const h = vi.hoisted(() => ({ get: { status: 200, body: {} as Json }, post: { status: 201, body: {} as Json }, posts: [] as string[], bodies: [] as unknown[] }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/components/marketplace/account-actions', () => ({ SignInPrompt: () => <button type="button" aria-label="Sign in" /> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ORDER = {
  id: 'ad1', reference: 'ENOAD 7K3F9Q', status: 'awaiting_transfer', kind: 'listing', period: 'week', amount_vnd: 99_000,
  created_at: '2026-11-28T03:00:00.000Z', expires_at: '2026-12-05T03:00:00.000Z',
  pay: { bank: 'ACB', account_name: 'CONG TY TNHH ENO', account_number: '0000000000', qr_svg: '<svg data-qr="1" aria-hidden="true"></svg>' },
  payer_paid_at: null,
}
const SUMMARY = { id: 'chk_x', listingId: 'L1', title: 'Studio Thao Dien', period: 'week', amountVnd: 99_000, image: null, canceled: false, order: null, ownOrder: false, claimed: false }

const { UcpPayClient } = await import('./pay-client')

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><UcpPayClient id="chk_x" /></QueryClientProvider>)
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  h.get = { status: 200, body: { checkout: SUMMARY } }
  h.post = { status: 201, body: { order: ORDER } }
  h.posts = []
  h.bodies = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { h.posts.push(url); h.bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(h.post.body), { status: h.post.status }) }
    return new Response(JSON.stringify(h.get.body), { status: h.get.status })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('UCP pay page', () => {
  it('signed out: asks for the listing\'s shop to sign in', async () => {
    h.get = { status: 401, body: {} }
    mount(); await flush()
    expect(screen.getByText('Sign in with the shop that owns this listing.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('an expired link says so', async () => {
    h.get = { status: 404, body: {} }
    mount(); await flush()
    expect(screen.getByText('This payment link has expired.')).toBeTruthy()
  })

  it('the ad and one Pay button; paying shows the QR and "I\'ve paid"', async () => {
    mount(); await flush()
    expect(screen.getByText('Studio Thao Dien')).toBeTruthy()
    expect(screen.getByText(/Started by an AI assistant/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Pay by bank transfer/ }))
    await flush()
    expect(h.posts).toEqual(['/api/ads/ucp/chk_x/order'])
    expect(h.bodies[0]).toEqual({ listingId: 'L1', period: 'week' })
    expect(screen.getByRole('button', { name: "I've paid" })).toBeTruthy()
    expect(screen.getByText('ENOAD 7K3F9Q')).toBeTruthy()
  })

  it('a dropped connection gives the button back with a sentence', async () => {
    mount(); await flush()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    fireEvent.click(screen.getByRole('button', { name: /Pay by bank transfer/ }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.')
    expect((screen.getByRole('button', { name: /Pay by bank transfer/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('another shop\'s listing: the refusal in words, never a code', async () => {
    h.post = { status: 404, body: { error: 'target_refused', reason: 'not_found' } }
    mount(); await flush()
    fireEvent.click(screen.getByRole('button', { name: /Pay by bank transfer/ }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe("That isn't in your shop.")
  })
})
