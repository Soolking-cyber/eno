// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ── A teacher's "Message" button never sends by itself (owner, 2026-10-21: "dont send the message directly make sure it
//    opens message and they can select from available quick send chips"): /messages/pending shows the opener chips and
//    posts only what the writer taps or types. Every other door (a body, an offer, the planner) still posts at once. ──

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
}))
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ ...nav, prefetch: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, accountType: 'business', identityLoaded: true }) }))
const cacheThread = vi.hoisted(() => vi.fn())
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ cacheThread }) }))
vi.mock('@/lib/analytics', () => ({ trackContactSeller: vi.fn(), currencyCode: () => 'VND' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/refusal-toast', () => ({ refusalToast: vi.fn() }))

import PendingComposePage from './page'
import { COMPOSE_KEY } from '@/lib/quick-contact'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
const SCHOOL_HIRE = 'Hello, we are hiring a teacher and your profile looks like a good fit — are you open to talking?'
const stash = (o: Record<string, unknown>) => sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({ listingId: 't1', body: '', offerAmount: null, listingTitle: 'Ms Lan', listingImage: null, trackPrice: null, currency: '₫', plan: false, ...o }))
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'c1', created: true, message: { id: 'm1', body: 'x', createdAt: '2026-10-21T09:00:00Z', kind: 'text' } }) }))
const posted = () => (fetchMock.mock.calls as unknown as [string, { body: string }][]).map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear(); nav.replace.mockClear(); nav.back.mockClear(); cacheThread.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('/messages/pending — a teacher\'s first message is chosen, never sent for the writer', () => {
  it('shows the teacher and the opener chips — and posts nothing; the stash is read once, as by every door', async () => {
    stash({ pick: { voice: 'school', cover: false } })
    render(<PendingComposePage />)
    await settle()
    expect(screen.getByText('Ms Lan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'We are hiring' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask: start date and schedule' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    // nothing left for Forward, a reload, a header link's way out or a duplicated tab to bring back (gates 13a–13b)
    expect(sessionStorage.getItem(COMPOSE_KEY)).toBeNull()
  })

  it('Back goes to the teacher\'s page — nothing sent, and never through the browser\'s history (it may not be eno\'s)', async () => {
    stash({ pick: { voice: 'school', cover: false } })
    render(<PendingComposePage />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(nav.replace).toHaveBeenCalledWith('/listings/t1')
    expect(nav.back).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a refusal keeps the writer on the chooser with their words — nothing lost, nothing bounced (codex + opus, gate 13a)', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({ error: 'blocked' }) }) as never)
    stash({ pick: { voice: 'person', cover: false } })
    render(<PendingComposePage />)
    await settle()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: 'Hi Lan, a long note about our classes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await settle()
    expect(nav.replace).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('Hi Lan, a long note about our classes')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)
    expect(sessionStorage.getItem(COMPOSE_KEY)).toBeNull() // nothing re-stashed for a page that would not give it back
  })

  it('…and so does a dropped connection', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    stash({ pick: { voice: 'school', cover: false } })
    render(<PendingComposePage />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'We are hiring' }))
    await settle()
    expect(nav.replace).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'We are hiring' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a message the server took is never offered again — an unreadable answer after a 200 goes to the inbox (opus, gate 13b)', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } }) as never)
    stash({ pick: { voice: 'school', cover: false } })
    render(<PendingComposePage />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'We are hiring' }))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith('/messages')
    expect(sessionStorage.getItem(COMPOSE_KEY)).toBeNull()
  })

  it('a chip posts its message — once — and the thread opens', async () => {
    stash({ pick: { voice: 'school', cover: false } })
    render(<PendingComposePage />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'We are hiring' }))
    await settle()
    expect(posted()).toEqual([{ listingId: 't1', message: SCHOOL_HIRE }])
    expect(nav.replace).toHaveBeenCalledWith('/messages/c1')
    expect(sessionStorage.getItem(COMPOSE_KEY)).toBeNull()
  })

  it('or the writer types their own', async () => {
    stash({ pick: { voice: 'person', cover: false } })
    render(<PendingComposePage />)
    await settle()
    expect(screen.queryByRole('button', { name: 'We are hiring' })).toBeNull() // a person never says "we are hiring"
    expect(screen.getByRole('button', { name: 'Looking for a teacher' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: '  Hi Lan, are you free on weekends?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await settle()
    expect(posted()).toEqual([{ listingId: 't1', message: 'Hi Lan, are you free on weekends?' }])
  })

  it('a school that asked about a cover lesson gets that opener first', async () => {
    stash({ pick: { voice: 'school', cover: true } })
    render(<PendingComposePage />)
    await settle()
    const chips = screen.getByTestId('teacher-opener-chips').querySelectorAll('button')
    expect(chips[0].textContent).toBe('Ask about a cover lesson')
  })

  it('every other door still posts at once (a body)', async () => {
    stash({ body: 'Hi! Is this still available?' })
    render(<PendingComposePage />)
    await settle()
    expect(posted()).toEqual([{ listingId: 't1', message: 'Hi! Is this still available?' }])
  })
})
