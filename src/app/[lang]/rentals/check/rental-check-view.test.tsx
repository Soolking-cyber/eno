// @vitest-environment jsdom
/**
 * /rentals/check — the availability-check "checkout". Pinned here, with the network stubbed (no test
 * reaches an API; POST /api/rental-check is answered per test from the shared contract's shapes):
 *   · the live refresh MARKS a rental it cannot find, and never removes it;
 *   · the contact is validated before anything is sent;
 *   · a guest is asked to sign in, with the free note, and nothing is sent yet;
 *   · after sign-in the request goes out ONCE, with the SAME id the press minted, and only once the
 *     account is onboarded;
 *   · each server answer lands where the contract says — 200 clears and opens the thread,
 *     send_in_flight retries the same id three times, listings_unavailable marks rows, 422 sits on
 *     the contact field, a network failure keeps the id for the retry;
 *   · the draft expires after a week, and an intent whose draft no longer validates says so instead
 *     of sending.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { router, toast, auth, language } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  auth: {
    user: null as null | { id: string; email?: string; phone?: string },
    loading: false,
    identityLoaded: false,
    accountType: null as string | null,
    sellerId: null as string | null,
    openSignIn: vi.fn(),
  },
  language: { lang: 'en' },
}))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/rentals/check' }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/ui/icons', () => {
  const icon = (name: string) => (props: React.SVGProps<SVGSVGElement>) => <svg data-icon={name} {...props} />
  return { Check: icon('check'), CheckCircle2: icon('check-circle'), ClipboardCheck: icon('clipboard-check'), Info: icon('info'), X: icon('x') }
})
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: language.lang, tr: (en: string, vi?: string) => (language.lang === 'vi' && vi ? vi : en) }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/listing-content', () => ({ useLocalized: (t: string) => t }))
vi.mock('@/components/marketplace/price', () => ({ Price: ({ price }: { price: number }) => <span data-price>{price}</span> }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn(), hapticError: vi.fn(), hapticConfirm: vi.fn(), hapticSelection: vi.fn() }))

import { RentalCheckView, SEND_RETRIES, SEND_RETRY_MS } from './rental-check-view'
import { rentalFreeLine } from '@/components/marketplace/rental-check-toggle'
import {
  BASKET_KEY,
  DRAFT_KEY,
  DRAFT_TTL_MS,
  __resetRentalCheckStoreForTests,
  addToBasket,
  getBasket,
  readDraft,
  writeDraft,
} from '@/lib/rental-check/store'
import type { RentalCheckRequestBody } from '@/lib/rental-check/shared'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

const FREE = rentalFreeLine((en) => en)
const rental = (n: number) => ({
  id: `r${n}`,
  title: `Flat ${n}`,
  titleVi: null,
  images: [`https://photo.example/${n}.jpg`],
  price: 9_000_000 + n,
  currency: 'VND',
  priceUnit: 'VND/month',
  category: { slug: 'rentals' },
})

type Reply = { status: number; body?: unknown } | 'network'
let replies: Reply[] = []
let posts: RentalCheckRequestBody[] = []
/** What GET /api/listings?ids= answers: by default every asked id is live and a rental. */
let listingsAnswer: (ids: string[]) => { listings: unknown[]; evaluated: string[] } = (ids) => ({
  listings: ids.map((id) => ({ ...rental(Number(id.slice(1))), id })),
  evaluated: ids,
})

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetRentalCheckStoreForTests()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  Object.assign(auth, { user: null, loading: false, identityLoaded: false, accountType: null, sellerId: null })
  auth.openSignIn.mockClear()
  router.replace.mockClear()
  router.push.mockClear()
  toast.mockClear(); toast.success.mockClear(); toast.error.mockClear()
  language.lang = 'en'
  replies = []
  posts = []
  listingsAnswer = (ids) => ({ listings: ids.map((id) => ({ ...rental(Number(id.slice(1))), id })), evaluated: ids })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/listings?ids=')) {
      const ids = decodeURIComponent(url.split('?ids=')[1].split('&')[0]).split(',')
      return { ok: true, status: 200, json: async () => listingsAnswer(ids) }
    }
    if (url === '/api/rental-check') {
      posts.push(JSON.parse(String(init?.body)))
      const r = replies.shift() ?? { status: 500, body: { error: 'internal_error' } }
      if (r === 'network') throw new TypeError('Failed to fetch')
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const signedIn = () => Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
const contactInput = () => document.getElementById('rc-contact') as HTMLInputElement
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Check these for me' }))
const typeContact = (v: string) => fireEvent.change(contactInput(), { target: { value: v } })
const pickChannel = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))

async function mount() {
  const utils = render(<RentalCheckView />)
  await screen.findByRole('heading', { name: 'Check availability' })
  return utils
}

describe('the list', () => {
  it('empty: says so, links to rentals, and still says it is free', async () => {
    await mount()
    expect(await screen.findByText('Your list is empty')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse rentals' }).getAttribute('href')).toBe('/c/rentals')
    expect(screen.getByText(FREE)).toBeTruthy()
  })

  it('marks a rental the refresh cannot find — and does NOT remove it', async () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    listingsAnswer = (ids) => ({ listings: [{ ...rental(1) }], evaluated: ids })
    await mount()
    await screen.findByText('No longer available')
    const gone = document.querySelector('[data-rental-row="r2"]')!
    expect(gone.getAttribute('data-unavailable')).toBe('true')
    expect(document.querySelector('[data-rental-row="r1"]')!.getAttribute('data-unavailable')).toBeNull()
    expect(getBasket().map((i) => i.id)).toEqual(['r1', 'r2'])
    // …and sending is blocked until the visitor removes it themselves.
    signedIn()
    typeContact('+447700900123')
    submit()
    expect(await screen.findByText('Remove the rentals that are no longer available, then send.')).toBeTruthy()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(getBasket().map((i) => i.id)).toEqual(['r1'])
  })

  it('ignores an answer that does not say what it evaluated (no verdict, no marks)', async () => {
    addToBasket(rental(1))
    listingsAnswer = () => ({ listings: [] } as unknown as { listings: unknown[]; evaluated: string[] })
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByText('No longer available')).toBeNull()
  })
})

describe('sending', () => {
  it('validates the contact before sending anything', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    pickChannel('Zalo')
    typeContact('+44 7700 900123')
    submit()
    expect(await screen.findByText('Zalo needs a Vietnamese mobile number — or choose WhatsApp or Email.')).toBeTruthy()
    expect(contactInput().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(contactInput())
    expect(posts).toHaveLength(0)
  })

  it('refuses a WhatsApp number that would not survive the server’s re-normalisation', async () => {
    // '+298 123456' (Faroe Islands, 9 digits) normalises to '298123456', which a second pass reads as
    // a VN mobile missing its 0. The server stores a FIXED POINT, so this must be caught here.
    addToBasket(rental(1))
    signedIn()
    await mount()
    pickChannel('WhatsApp')
    typeContact('+298 123456')
    submit()
    expect(await screen.findByText('Check the number and include the country code, e.g. +44 7700 900123.')).toBeTruthy()
    expect(posts).toHaveLength(0)
  })

  it('a guest is asked to sign in (free note), nothing is sent, and the intent is kept', async () => {
    addToBasket(rental(1))
    await mount()
    typeContact('+447700900123')
    submit()
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(auth.openSignIn.mock.calls[0][0].note).toMatch(/Free: no fees, no markup on the rent/)
    expect(posts).toHaveLength(0)
    expect(readDraft()?.pending?.clientRequestId).toBeTruthy()
  })

  it('after sign-in it sends ONCE, with the id the press minted — and waits for onboarding', async () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    const { rerender } = await mount()
    fireEvent.change(screen.getByRole('textbox', { name: /Anything we should ask/ }), { target: { value: '  Pets OK?  ' } })
    typeContact('+447700900123')
    submit()
    const id = readDraft()!.pending!.clientRequestId

    // Signed in but not onboarded yet: auth-context is about to send them to /onboard. Wait.
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: null })
    rerender(<RentalCheckView />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(posts).toHaveLength(0)

    replies.push({ status: 200, body: { conversationId: 'c1', messageId: 'm1', threadCreated: true, listingIds: ['r1', 'r2'] } })
    auth.accountType = 'individual'
    rerender(<RentalCheckView />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/c1'))
    rerender(<RentalCheckView />)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual({
      listingIds: ['r1', 'r2'],
      requirements: 'Pets OK?',
      contact: { channel: 'whatsapp', value: '+447700900123' },
      clientRequestId: id,
      lang: 'en',
    })
  })

  it('resumes at most once per page life — a refreshed session object does not re-send a failed request', async () => {
    addToBasket(rental(1))
    const { rerender } = await mount()
    typeContact('+447700900123')
    submit()
    replies.push('network')
    signedIn()
    rerender(<RentalCheckView />)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(posts).toHaveLength(1)
    // Supabase hands out a NEW user object on every token refresh; the effect re-runs on it.
    auth.user = { id: 'u1' }
    rerender(<RentalCheckView />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(posts).toHaveLength(1)
    // The intent is still there, so the visitor's own next press reuses the id.
    expect(readDraft()?.pending?.clientRequestId).toBe(posts[0].clientRequestId)
  })

  it('200: clears the basket and the draft, says it was free, opens the thread', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    typeContact('+447700900123')
    replies.push({ status: 200, body: { conversationId: 'conv_9', messageId: 'm', threadCreated: false, listingIds: ['r1'] } })
    submit()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/conv_9'))
    expect(getBasket()).toEqual([])
    expect(localStorage.getItem(BASKET_KEY)).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Sent to the eno team', { description: FREE })
    // The success state carries the free line too, while the thread opens.
    expect(screen.getAllByText(FREE).length).toBeGreaterThan(0)
  })

  it('send_in_flight: retries the SAME id every 1.5s, three times, then points at Messages', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    typeContact('+447700900123')
    for (let i = 0; i <= SEND_RETRIES; i++) replies.push({ status: 409, body: { error: 'send_in_flight' } })
    submit()
    await waitFor(() => expect(posts).toHaveLength(1))
    for (let i = 1; i <= SEND_RETRIES; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(SEND_RETRY_MS) })
      await waitFor(() => expect(posts).toHaveLength(i + 1))
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(SEND_RETRY_MS * 3) })
    expect(posts).toHaveLength(SEND_RETRIES + 1)
    expect(new Set(posts.map((p) => p.clientRequestId)).size).toBe(1)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Still sending — check Messages in a moment.', expect.anything()))
    // The id survives: this request may still land, and a later press must not duplicate it.
    expect(readDraft()?.pending?.clientRequestId).toBe(posts[0].clientRequestId)
  })

  it('409 listings_unavailable: marks the rows, drops the id so the next press is a new request', async () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    signedIn()
    await mount()
    typeContact('+447700900123')
    replies.push({ status: 409, body: { error: 'listings_unavailable', unavailable: ['r2'] } })
    submit()
    await screen.findByText('No longer available')
    expect(document.querySelector('[data-rental-row="r2"]')!.getAttribute('data-unavailable')).toBe('true')
    expect(readDraft()?.pending).toBeUndefined()
    expect(getBasket()).toHaveLength(2)
  })

  it('422 invalid_contact: the reason sits on the contact field', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    pickChannel('Email')
    typeContact('someone@example.com')
    replies.push({ status: 422, body: { error: 'invalid_contact', reason: 'email_invalid' } })
    submit()
    expect(await screen.findByText('Check the email address.')).toBeTruthy()
    expect(contactInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('a network failure keeps the id, and the next press reuses it', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    typeContact('+447700900123')
    replies.push('network')
    submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    replies.push({ status: 200, body: { conversationId: 'c2', messageId: 'm', threadCreated: false, listingIds: ['r1'] } })
    submit()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/c2'))
    expect(posts).toHaveLength(2)
    expect(posts[1].clientRequestId).toBe(posts[0].clientRequestId)
  })
})

describe('the request id follows the content', () => {
  it('a press with DIFFERENT content after a lost response gets a NEW id (the old one may have written the old card)', async () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    signedIn()
    await mount()
    typeContact('+447700900123')
    replies.push('network')
    submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from list' })[1])
    replies.push({ status: 200, body: { conversationId: 'c3', messageId: 'm', threadCreated: false, listingIds: ['r1'] } })
    submit()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/c3'))
    expect(posts.map((b) => b.listingIds)).toEqual([['r1', 'r2'], ['r1']])
    expect(posts[1].clientRequestId).not.toBe(posts[0].clientRequestId)
  })

  it('the same content typed differently is the same request (the contact is compared normalised)', async () => {
    addToBasket(rental(1))
    signedIn()
    await mount()
    typeContact('+447700900123')
    replies.push('network')
    submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    typeContact('+44 7700 900123')
    replies.push({ status: 200, body: { conversationId: 'c4', messageId: 'm', threadCreated: false, listingIds: ['r1'] } })
    submit()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/c4'))
    expect(posts[1].clientRequestId).toBe(posts[0].clientRequestId)
  })

  it('does not resume a press whose list changed while signing in — it asks for a new press', async () => {
    addToBasket(rental(1))
    addToBasket(rental(2))
    const { rerender } = await mount()
    typeContact('+447700900123')
    submit()
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    // Another tab takes a rental out while the visitor is in the sign-in flow.
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: 'Remove from list' })[1]) })
    signedIn()
    rerender(<RentalCheckView />)
    expect(await screen.findByText('You’re signed in — tap Check these for me.')).toBeTruthy()
    expect(posts).toHaveLength(0)
  })
})

describe('a guest press while the session is still resolving', () => {
  it('is held (busy), then opens sign-in once it resolves signed out', async () => {
    addToBasket(rental(1))
    auth.loading = true
    const { rerender } = await mount()
    typeContact('+447700900123')
    submit()
    expect(auth.openSignIn).not.toHaveBeenCalled()
    const busy = screen.getByRole('button', { name: /Sending/ })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    auth.loading = false
    rerender(<RentalCheckView />)
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    expect(auth.openSignIn.mock.calls[0][0].note).toMatch(/no markup on the rent/)
    expect(screen.getByRole('button', { name: 'Check these for me' })).toBeTruthy()
    expect(posts).toHaveLength(0)
  })

  it('…or sends once it resolves signed in and onboarded', async () => {
    addToBasket(rental(1))
    auth.loading = true
    const { rerender } = await mount()
    typeContact('+447700900123')
    submit()
    replies.push({ status: 200, body: { conversationId: 'c5', messageId: 'm', threadCreated: true, listingIds: ['r1'] } })
    Object.assign(auth, { loading: false, user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    rerender(<RentalCheckView />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/messages/c5'))
    expect(auth.openSignIn).not.toHaveBeenCalled()
    expect(posts).toHaveLength(1)
  })
})

describe('draft', () => {
  it('restores a recent draft and forgets one older than a week', async () => {
    addToBasket(rental(1))
    writeDraft({ requirements: 'Parking?', channel: 'email', value: 'a@b.co' }, Date.now() - 60_000)
    const first = await mount()
    expect((screen.getByRole('textbox', { name: /Anything we should ask/ }) as HTMLTextAreaElement).value).toBe('Parking?')
    expect(contactInput().value).toBe('a@b.co')
    first.unmount()

    writeDraft({ requirements: 'Old', channel: 'email', value: 'old@b.co' }, Date.now() - DRAFT_TTL_MS - 1)
    await mount()
    expect((screen.getByRole('textbox', { name: /Anything we should ask/ }) as HTMLTextAreaElement).value).toBe('')
  })

  it('a resumed intent whose draft no longer validates does not send — it says so', async () => {
    addToBasket(rental(1))
    writeDraft({ requirements: '', channel: 'zalo', value: '12', pending: { clientRequestId: 'req_12345678', at: Date.now() } })
    signedIn()
    await mount()
    expect(await screen.findByText('You’re signed in — tap Check these for me.')).toBeTruthy()
    expect(posts).toHaveLength(0)
    expect(readDraft()?.pending).toBeUndefined()
  })

  it('never writes the ACCOUNT’s contact to the device — only what the visitor typed', async () => {
    addToBasket(rental(1))
    Object.assign(auth, { user: { id: 'u1', phone: '84912345678' } })
    await mount()
    await waitFor(() => expect(contactInput().value).toBe('+84912345678'))
    fireEvent.change(screen.getByRole('textbox', { name: /Anything we should ask/ }), { target: { value: 'Pets?' } })
    await waitFor(() => expect(readDraft()?.requirements).toBe('Pets?'))
    expect(readDraft()).toMatchObject({ value: '', owner: 'u1' })
    typeContact('0987654321')
    await waitFor(() => expect(readDraft()?.value).toBe('0987654321'))
  })

  it('a draft written under one account is not restored for anyone else — and is discarded', async () => {
    addToBasket(rental(1))
    writeDraft({ requirements: 'A’s note', channel: 'zalo', value: '0911111111', owner: 'uA' })
    auth.loading = true
    const { rerender } = await mount()
    // While the session is unresolved the form stays empty — A's number is never on screen.
    expect(contactInput().value).toBe('')
    auth.loading = false // resolves signed OUT
    rerender(<RentalCheckView />)
    await waitFor(() => expect(readDraft()).toBeNull())
    expect(contactInput().value).toBe('')
    expect((screen.getByRole('textbox', { name: /Anything we should ask/ }) as HTMLTextAreaElement).value).toBe('')
  })

  it('…and IS restored for the account that wrote it', async () => {
    addToBasket(rental(1))
    writeDraft({ requirements: 'Mine', channel: 'email', value: 'a@b.co', owner: 'uA' })
    Object.assign(auth, { user: { id: 'uA' } })
    await mount()
    await waitFor(() => expect(contactInput().value).toBe('a@b.co'))
  })

  it('prefills the account phone — never over what the visitor typed', async () => {
    addToBasket(rental(1))
    Object.assign(auth, { user: { id: 'u1', phone: '84912345678', email: 'me@x.co' } })
    await mount()
    await waitFor(() => expect(contactInput().value).toBe('+84912345678'))
    pickChannel('Email')
    expect(contactInput().value).toBe('me@x.co')
  })
})
