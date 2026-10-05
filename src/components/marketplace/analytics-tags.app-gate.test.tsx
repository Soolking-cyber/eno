// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// ── App Store gate `app-no-gtm` (plan R11) ────────────────────────────────────────────────────────────
// eno.forum loads its Google Tag Manager container for every visitor with no consent gate, which today
// includes both native apps. With the gate on, the apps skip it; the web is unchanged. Off by default.

vi.mock('next/script', () => ({
  default: ({ id, src }: { id?: string; src?: string }) => <script data-testid={id ?? src} />,
}))

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const WEB = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function containerLoads(ua: string, gates: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
  vi.stubEnv('NEXT_PUBLIC_GTM_ID', 'GTM-TEST')
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', gates)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  const { AnalyticsTags } = await import('./analytics-tags')
  const { container } = render(<AnalyticsTags />)
  return !!container.querySelector('[data-testid="gtm-init"]')
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GTM container and the native apps', () => {
  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['web', WEB]])('%s: loads while the gate is off (today)', async (_, ua) => {
    expect(await containerLoads(ua, '')).toBe(true)
  })

  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP]])('%s: skipped with app-no-gtm on', async (_, ua) => {
    expect(await containerLoads(ua, 'app-no-gtm')).toBe(false)
  })

  it('web: still loads with app-no-gtm on', async () => {
    expect(await containerLoads(WEB, 'app-no-gtm')).toBe(true)
  })

  // The app's in-app browser sheet runs with the BROWSER's UA (a Custom Tab looks like Chrome), so the
  // page the app opened there is marked with ?app_sheet=1 (app-review-gates.ts IN_APP_SHEET_PARAM).
  it('the in-app sheet (browser UA + ?app_sheet=1): skipped with app-no-gtm on, loads with it off', async () => {
    window.history.replaceState(null, '', '/terms?app_sheet=1')
    try {
      // `app-signin-tidy` is what opens the sheet; without it the marker is dormant.
      expect(await containerLoads(WEB, 'app-signin-tidy,app-no-gtm')).toBe(false)
      sessionStorage.clear()
      expect(await containerLoads(WEB, 'app-signin-tidy')).toBe(true)
      sessionStorage.clear()
      expect(await containerLoads(WEB, 'app-no-gtm')).toBe(true)
    } finally {
      window.history.replaceState(null, '', '/')
      sessionStorage.clear()
    }
  })
})
