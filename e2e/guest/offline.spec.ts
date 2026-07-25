import { test, expect } from '../helpers'

// Offline state. Nothing used to watch connectivity: public/sw.js is push-only and the
// Capacitor error page only replaces the WebView when a MAIN-FRAME load fails — so a
// connection dropped MID-SESSION (the common case on VN mobile) showed the user nothing
// while taps silently did nothing. QueryProvider now listens for online/offline and shows
// a dismissible banner, on web as well as in the native shell.
//
// Driven with context.setOffline() rather than route interception: it is what actually
// fires the window 'offline'/'online' events the banner subscribes to.

test.describe('Guest · offline banner', () => {
  test('appears when the connection drops mid-session, and clears when it returns', async ({ page }) => {
    await page.goto('/')
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
