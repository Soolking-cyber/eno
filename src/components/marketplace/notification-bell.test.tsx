// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { chatTranslationConsentKey } from '@/lib/chat-translation-consent'
import { notificationTextAsWritten } from '@/lib/notification-text'
import { trCache } from '@/lib/i18n/mt-client'

// ── Privacy: what people wrote to each other never goes through <Tr> → /api/translate from the bell ─────────
// <Tr> machine-translates through /api/translate (Microsoft) into the SHARED Translation cache. An offer's body is
// the offerer's own note and an availability request's names the person asking, so both render as written — title and
// body — with the App Store gate off (the web, today) and on, whatever the person answered about chat translation; so
// does a type the allowlist does not know. The control row (eno's own copy) proves the bell still machine-translates
// what it may, so "nothing private was sent" means something.

const ME = '11111111-1111-4111-8111-111111111111'
const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'

const NAME = 'Sam Lee'
const OFFER_NOTE = 'Is the price still open? I can pick it up tonight near Thao Dien'
const OFFER_WITH_AMOUNT = 'Trả giá · Offered 4.500.000 ₫ — Could you do 4.5M if I collect it myself?'
const AVAILABILITY = `${NAME} · 2 căn / 2 rentals · eno.vn`
const AVAILABILITY_FORUM = `${NAME} · 1 căn / 1 rental · eno.forum`
const UNKNOWN_BODY = 'Meet me at the Thao Dien cafe at six, my number is in the chat'
const SYSTEM_TITLE = 'Listing held for review'
const SYSTEM_BODY = 'Your listing was hidden pending review because its photos match another listing.'
const AVAILABILITY_TITLE = 'Kiểm tra phòng trống · Availability check'

const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const row = (id: string, type: string, title: string, body: string, min: number) =>
  ({ id, type, title, body, read: false, createdAt: at(min), conversationId: 'c1', listingId: null, url: null, actorName: null })
const ITEMS = [
  row('n1', 'offer', NAME, OFFER_NOTE, 1),
  row('n2', 'offer', NAME, OFFER_WITH_AMOUNT, 2),
  row('n3', 'availability_request', AVAILABILITY_TITLE, AVAILABILITY, 3),
  row('n4', 'availability_request_forum', AVAILABILITY_TITLE, AVAILABILITY_FORUM, 4),
  row('n5', 'message', NAME, UNKNOWN_BODY, 5),
  row('n6', 'system', SYSTEM_TITLE, SYSTEM_BODY, 6),
]

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: ME }, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/context/notifications-context', () => ({
  useNotifications: () => ({ items: ITEMS, unread: ITEMS.length, markRead: vi.fn(), markAllRead: vi.fn(), remove: vi.fn(), clearAll: vi.fn() }),
}))

import { NotificationBell } from './notification-bell'

let store: Map<string, string>
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  trCache.clear() // each case must see its own request, not the previous case's cached translation
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const texts = (JSON.parse(String(init?.body ?? '{}')) as { texts?: string[] }).texts ?? []
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ translations: texts.map((t) => `[vi] ${t}`) }) })
  })
  vi.stubGlobal('fetch', fetchMock)
  // A Vietnamese device, so the provider's mount check agrees with the Vietnamese page and never swaps it.
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['vi-VN'])
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Every text the page asked /api/translate to machine-translate. */
const sentForTranslation = (): string[] =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/api/translate'))
    .flatMap(([, init]) => (JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as { texts?: string[] }).texts ?? [])

async function openBellInVietnamese() {
  render(<LanguageProvider initialLang="vi" initialViDict={{}}><NotificationBell /></LanguageProvider>)
  fireEvent.click(screen.getByRole('button', { name: /Thông báo/ }))
  // The control: eno's own copy still goes through <Tr>, so the machine-translation batch has been posted.
  await waitFor(() => expect(sentForTranslation()).toEqual(expect.arrayContaining([SYSTEM_TITLE, SYSTEM_BODY])), { timeout: 10_000 })
}

function expectPrivateTextAsWritten() {
  const sent = sentForTranslation()
  // Nothing that names the person or carries their words left for translation — title or body.
  expect(sent.filter((t) => t.includes(NAME) || t.includes('Thao Dien') || t.includes('4.5M'))).toEqual([])
  for (const privateText of [OFFER_NOTE, OFFER_WITH_AMOUNT, AVAILABILITY, AVAILABILITY_FORUM, UNKNOWN_BODY]) {
    expect(screen.getByText(privateText)).toBeTruthy()
  }
  // The unknown type's title (a name) is shown as stored too.
  expect(screen.getByText(NAME)).toBeTruthy()
}

describe('notification bell — private text is shown as written', () => {
  it('web, no gate: offers, availability requests and unknown types never reach /api/translate; eno copy still does', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    await openBellInVietnamese()
    expectPrivateTextAsWritten()
  })

  it('iOS app with app-ai-notice on and chat translation said OK: still as written', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
    store.set(chatTranslationConsentKey(ME), 'on')
    await openBellInVietnamese()
    expectPrivateTextAsWritten()
  })
})

describe('notificationTextAsWritten — an allowlist that fails closed', () => {
  it('machine-translates only the measured eno-copy / public types', () => {
    for (const t of ['system', 'dispute', 'reminder', 'price_drop', 'milestone', 'saved_search', 'forum_reply', 'visa_result']) {
      expect(notificationTextAsWritten(t)).toBe(false)
    }
  })
  it('shows everything else as written — the private types and any type it does not know', () => {
    for (const t of ['offer', 'availability_request', 'availability_request_forum', 'message', 'some_new_type', '']) {
      expect(notificationTextAsWritten(t)).toBe(true)
    }
  })
})
