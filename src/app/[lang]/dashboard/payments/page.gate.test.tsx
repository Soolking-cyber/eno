import { afterEach, describe, expect, it, vi } from 'vitest'

// ── App Store gate `ios-hide-wallet` (plan R6) on the Payments page ───────────────────────────────────
// /dashboard/wallet and /dashboard/payout redirect here, so this one page decides all three. With the
// gate off, nothing changes for anyone; with it on, only the iOS app's user agent is sent away.

let ua: string | null = null
vi.mock('next/headers', () => ({ headers: async () => new Headers(ua ? { 'user-agent': ua } : {}) }))
const redirect = vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))
vi.mock('./payments-client', () => ({ PaymentsClient: () => null }))

import PaymentsPage from './page.forum.svc'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.unstubAllEnvs()
  redirect.mockClear()
  ua = null
})

describe('Payments page — ios-hide-wallet', () => {
  it('renders for the iOS app while the gate is off (the default)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    ua = IOS_APP
    await expect(PaymentsPage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('sends the iOS app to /dashboard when the gate is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-wallet')
    ua = IOS_APP
    await expect(PaymentsPage()).rejects.toThrow('NEXT_REDIRECT /dashboard')
  })

  it.each([['Android app', ANDROID_APP], ['iOS Safari', IOS_SAFARI], ['no user agent', null]])('leaves %s alone with the gate on', async (_, agent) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-wallet')
    ua = agent
    await expect(PaymentsPage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
