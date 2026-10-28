// @vitest-environment jsdom
/**
 * "Urgent cover? Show Zalo" (owner, 2026-10-28 — src/lib/teachers/zalo.ts): drawn only for a business account the teacher
 * offers it to right now (the standing says so — never the number); a tap reveals the number and an "Open Zalo" BUTTON
 * (⛔ never a link: its URL would reach Google Analytics); a refusal says why, with the step that lifts it.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, ios } = vi.hoisted(() => ({
  ios: { hideKyc: false },
  auth: { user: { id: 'school-1' } as null | { id: string }, accountType: 'business' as string | null, identityLoaded: true },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.hideKyc }))

import { CoverZaloReveal } from './cover-zalo-reveal'

const standing = (o: Record<string, unknown> = {}) => ({ available: true, revealed: false, tier: 'school', limit: 1, used: 0, remaining: 1, reason: null, next: 'verify_identity', ...o })
let get: Record<string, unknown> | null = null
let post: { status: number; body: Record<string, unknown> } | null = null
const calls: string[] = []
const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
  calls.push(`${init?.method ?? 'GET'} ${url}`)
  if (init?.method === 'POST') return { ok: post!.status === 200, status: post!.status, json: async () => post!.body }
  return get ? { ok: true, status: 200, json: async () => get } : { ok: false, status: 500, json: async () => ({}) }
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const open = vi.fn()

beforeEach(() => {
  Object.assign(auth, { user: { id: 'school-1' }, accountType: 'business', identityLoaded: true })
  ios.hideKyc = false
  get = null; post = null; calls.length = 0
  fetchMock.mockClear(); open.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('open', open)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CoverZaloReveal', () => {
  it('draws nothing — and asks nothing — for a guest or a personal account; nothing while the teacher does not offer it', async () => {
    auth.user = null
    render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(calls).toEqual([])
    cleanup()
    Object.assign(auth, { user: { id: 'p1' }, accountType: 'individual' })
    render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(calls).toEqual([])
    cleanup()
    Object.assign(auth, { user: { id: 'school-1' }, accountType: 'business' })
    get = standing({ available: false })
    const { container } = render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(calls).toEqual(['GET /api/teachers/zalo?listingId=l1'])
    expect(container.textContent).toBe('')
  })

  it('a tap shows the number and an "Open Zalo" BUTTON — never a zalo.me link in the page', async () => {
    get = standing()
    post = { status: 200, body: { zalo: '0901234567', href: 'https://zalo.me/0901234567', standing: standing({ revealed: true, used: 1, remaining: 0 }) } }
    const { container } = render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(screen.getByText(/One new number a day until your business is verified/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Urgent cover? Show Zalo' })) })
    expect(calls.at(-1)).toBe('POST /api/teachers/zalo')
    expect(screen.getByText('0901 234 567')).toBeTruthy()
    expect(container.querySelector('a[href*="zalo.me"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Zalo' }))
    expect(open).toHaveBeenCalledWith('https://zalo.me/0901234567', '_blank', 'noopener,noreferrer')
  })

  it('at the cap: says why, the button is off, and the step that lifts it is offered (as plain text in the iOS app)', async () => {
    get = standing({ used: 1, remaining: 0, reason: 'limit', next: 'verify_business' })
    render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(screen.getByText(/Verify your business to see up to 20 a day/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Urgent cover? Show Zalo' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Verify your business' }).getAttribute('href')).toBe('/dashboard/verification')
    cleanup()
    ios.hideKyc = true
    render(<CoverZaloReveal listingId="l1" />)
    await settle()
    expect(screen.queryByRole('link', { name: 'Verify your business' })).toBeNull()
  })

  it('a refusal at tap time (the pool) replaces the standing; a 404 hides the block', async () => {
    get = standing()
    post = { status: 403, body: { error: 'pool', standing: standing({ reason: 'pool', next: 'verify_identity' }) } }
    const { container } = render(<CoverZaloReveal listingId="l1" />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Urgent cover? Show Zalo' })) })
    expect(screen.getByText(/free Zalo views on this connection are used/)).toBeTruthy()
    cleanup()
    post = { status: 404, body: { error: 'not_available' } }
    const r = render(<CoverZaloReveal listingId="l1" />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Urgent cover? Show Zalo' })) })
    expect(r.container.textContent).toBe('')
    expect(container.textContent).toBe('')
  })
})
