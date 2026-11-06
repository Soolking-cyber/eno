import type { Page } from '@playwright/test'
import { test, expect } from '../helpers'

// Offline state. Nothing used to watch connectivity: public/sw.js is push-only and the
// Capacitor error page only replaces the WebView when a MAIN-FRAME load fails — so a
// connection dropped MID-SESSION (the common case on VN mobile) showed the user nothing
// while taps silently did nothing. QueryProvider now listens for online/offline and shows
// a dismissible banner, on web as well as in the native shell.
//
// Driven with context.setOffline() rather than route interception: it is what actually
// fires the window 'offline'/'online' events the banner subscribes to.

/**
 * ⚠️ HYDRATED FIRST (2026-11-07). The banner is a client effect, and these tests went offline the instant goto resolved: on a
 * remote server that raced hydration — a chunk still on its way failed offline, React never hydrated and the banner never
 * mounted ("element(s) not found" on the prod re-run). The suite's hydration marker is the header's search form carrying a
 * React fiber (e2e/ci/marketplace.spec.ts); the banner sits above the header in the tree (QueryProvider, providers.tsx), so it
 * has hydrated by then, and two frames let its mount effect run — it reads navigator.onLine itself, so a drop from then on
 * is seen either way.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('form[role="search"]')
    return !!form && Object.keys(form).some((k) => k.startsWith('__reactFiber'))
  })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test.describe('Guest · offline banner', () => {
  test('appears when the connection drops mid-session, and clears when it returns', async ({ page }) => {
    await page.goto('/')
    await hydrated(page)
    const banner = page.getByTestId('offline-banner')

    // Nothing to announce while the connection is fine — otherwise this spec would pass
    // vacuously against a banner that is simply always on screen.
    await expect(banner).toBeHidden()

    await page.context().setOffline(true)
    await expect(banner).toBeVisible()

    await page.context().setOffline(false)
    await expect(banner).toBeHidden()
  })

  test('can be dismissed, and comes back on the NEXT drop', async ({ page }) => {
    await page.goto('/')
    await hydrated(page)
    const banner = page.getByTestId('offline-banner')

    await page.context().setOffline(true)
    await expect(banner).toBeVisible()

    await banner.getByRole('button').click()
    await expect(banner).toBeHidden()

    // A banner dismissed once must not stay suppressed for the rest of the session, or the
    // next outage is silent again — the dismissal is per-drop, not permanent.
    await page.context().setOffline(false)
    await page.context().setOffline(true)
    await expect(banner).toBeVisible()

    await page.context().setOffline(false)
  })
})
