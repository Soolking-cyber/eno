// @vitest-environment jsdom
/**
 * App Store gate `app-ai-notice` — the `trip` family (src/lib/ai-consent.ts) on the trip wizard's last step, and on the
 * trip chat's concierge menu:
 *   · "Build my plan" asks before anything is posted; "Not now" posts nothing and frees the button; a second tap while
 *     the question is open asks nothing more (busy is set first). Gate off ⇒ it posts at once, as before.
 *   · With trip AI turned off in the app, the "Eno concierge" item is disabled and says why — armable, it looped:
 *     arm → ask → "off" toast → disarm (opus, review).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { aiConsentKey, forgetAiConsentMemory, registerAiConsentAsker, setAiConsentAccount } from '@/lib/ai-consent'

const ME = '11111111-1111-4111-8111-111111111111'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
  useDualMoney: () => (n: number) => ({ main: String(n), alt: null }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: ME }, loading: false, openSignIn: vi.fn() }) }))

import { TripAssistChips, TripWizardCard } from './trip-cards'
import { ACCOMMODATION_IDS, BUDGET_IDS, CABIN_IDS, CITY_IDS, INTEREST_IDS, PACE_IDS, STOPS_IDS } from '@/lib/itinerary-data'
import { firstIncompleteTripWizardStep } from '@/lib/trips/itinerary-wizard'

/** A COMPLETE draft, so the card's arrival repair has nothing to rewind and "Build my plan" is the only thing that posts. */
const DRAFT = {
  cityIds: [CITY_IDS[0]], days: 5, cityDays: [], startDate: '2026-12-01', travelers: 2,
  budgetId: BUDGET_IDS[0], pace: PACE_IDS[0], accommodation: ACCOMMODATION_IDS[0], interests: [INTEREST_IDS[0]],
  flight: { include: false, cabin: CABIN_IDS[0], maxStops: STOPS_IDS[0], checkedBags: false }, origin: '', notes: '',
}

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'

let fetchMock: ReturnType<typeof vi.fn>
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ step: 1 }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  setAiConsentAccount(ME)
  forgetAiConsentMemory()
  sessionStorage.setItem('trip-wizard:m1', JSON.stringify(DRAFT))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
const generates = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/itineraries/generate')
const mountLastStep = () => render(<TripWizardCard conversationId="c1" messageId="m1" meta={{ step: 5, state: 'active' }} />)
const buildButton = () => screen.findByRole('button', { name: /Build my plan/ })

describe('trip wizard — "Build my plan" and the Google AI question', () => {
  it('the fixture draft is complete (so nothing but the tap posts)', () => {
    expect(firstIncompleteTripWizardStep(DRAFT)).toBeNull()
  })

  it('gate OFF, in the app: builds at once, nobody asked', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    mountLastStep()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(posts()).toHaveLength(0)
    await act(async () => { fireEvent.click(await buildButton()) })
    await waitFor(() => expect(generates()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('gate ON, "Not now": nothing is posted and the button is free again', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'off' as const))
    mountLastStep()
    await act(async () => { fireEvent.click(await buildButton()) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(posts()).toHaveLength(0)
    expect(((await buildButton()) as HTMLButtonElement).disabled).toBe(false)
  })

  it('gate ON: a second tap while the question is open asks nothing more; "Allow" goes on once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    mountLastStep()
    const button = await buildButton()
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })
    expect(asker).toHaveBeenCalledTimes(1)
    expect(posts()).toHaveLength(0)
    await act(async () => { answer(true) })
    await waitFor(() => expect(generates()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(generates()).toHaveLength(1)
  })
})

describe('trip chat — the "Eno concierge" menu item and trip AI turned off', () => {
  const mountChips = () => render(
    <TripAssistChips armed={false} thinking={false} busy={false} humanRequested={false} onToggleConcierge={vi.fn()} onAskHuman={vi.fn()} />,
  )
  const openMenu = async () => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get help with this trip' })) })
    return screen.findByRole('menuitem', { name: /Eno concierge/ })
  }

  it('gate ON, in the app, trip AI "off": the item is disabled and the menu says why', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    store.set(aiConsentKey('trip', ME), 'off')
    mountChips()
    const item = await openMenu()
    expect(item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByText(/Eno concierge uses Google AI, which is turned off in this app/)).toBeTruthy()
  })

  it('not asked yet, or the gate off: the item stays available', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    mountChips()
    const asked = await openMenu()
    expect(asked.getAttribute('aria-disabled')).toBeNull()
    cleanup()
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    store.set(aiConsentKey('trip', ME), 'off')
    mountChips()
    const off = await openMenu()
    expect(off.getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByText(/turned off in this app/)).toBeNull()
  })
})
