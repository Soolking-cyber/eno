import { test, expect } from '../helpers'
import type { Page } from '@playwright/test'

// The "Join eno" prompt (owner, 2026-10-01: ask a guest to sign up after a minute of browsing;
// dismissible, and it returns). It is THE sign-in popup in its join presentation.
//
// ⛔ IT NEVER APPEARS UNDER AUTOMATION — `navigator.webdriver` is true in every Playwright run, which is
// what keeps it out of every other spec here. This spec turns it on deliberately with the test override
// (src/lib/signup-prompt.ts TEST_KEY): a number of ms that replaces BOTH the 60s and the 3-minute delays.
//
// ⛔ NO REAL SIGN-IN, AND NOTHING BUT GETs LEAVE THE BROWSER. Every non-GET request is aborted, and the
// Google hand-off is caught at its first hop and answered 204 (a navigation answered "no content" stays
// on the page), so the test reads WHERE Google sign-in would go without anything reaching Google,
// Supabase or our own auth routes.

const TEST_KEY = 'eno:signup-prompt-test'
const DEVICE_KEY = 'eno:signup-prompt'
const JOIN = 'Join eno — it’s free'

async function forcePrompt(page: Page, ms = 1500) {
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }, [TEST_KEY, String(ms)])
}
async function getOnly(page: Page) {
  await page.route('**/*', (route) => (route.request().method() === 'GET' ? route.fallback() : route.abort()))
}

test.describe('Guest · Join eno prompt', () => {
  test('opens on its own, says what an account is for, and is a bottom sheet on a phone / a centred card on desktop', async ({ page }) => {
    await getOnly(page)
    await forcePrompt(page)
    await page.goto('/')
    const dialog = page.getByRole('dialog', { name: JOIN })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use email instead' })).toBeVisible()
    // ⛔ No "Maybe later" (owner, 2026-10-01): the only way out is the × in the top-right corner.
    await expect(dialog.getByRole('button', { name: /maybe later/i })).toHaveCount(0)
    const x = dialog.getByRole('button', { name: 'Close' })
    await expect(x).toBeVisible()
    await expect(dialog).toContainText('Message sellers directly')
    await expect(dialog).not.toContainText(/continue browsing|blocked/i)
    // Focus moved into it.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)

    // Let the enter transition finish before measuring.
    await page.waitForTimeout(400)
    const vp = page.viewportSize()!
    const box = (await dialog.boundingBox())!
    if (vp.width < 640) {
      expect(Math.abs(box.y + box.height - vp.height)).toBeLessThanOrEqual(2)
      expect(Math.round(box.width)).toBe(vp.width)
    } else {
      expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2)
      expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2)
    }
    // The × sits in the card's top-right corner, and its hit area (ui/dialog's tap-44 pseudo-element) is
    // 44px: a press 10px outside the drawn 24px glyph still lands on it.
    const xb = (await x.boundingBox())!
    expect(xb.x + xb.width).toBeGreaterThan(box.x + box.width - 40)
    expect(xb.y).toBeLessThan(box.y + 40)
    const hit = await page.evaluate(([cx, cy]) => {
      const el = document.elementFromPoint(cx, cy)
      return el?.closest('[data-slot="dialog-close"]') ? true : false
    }, [xb.x - 8, xb.y + xb.height / 2])
    expect(hit).toBe(true)
  })

  test('the × closes it and it comes back — at most twice in a tab', async ({ page }) => {
    await getOnly(page)
    await forcePrompt(page)
    await page.goto('/')
    const dialog = page.getByRole('dialog', { name: JOIN })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(450) // past its 400ms arming window
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').dismissals, DEVICE_KEY)).toBe(1)

    // Returns after the (overridden) re-ask delay; Esc is the same dismissal as the ×.
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').dismissals, DEVICE_KEY)).toBe(2)

    // A third ask in the same tab never comes.
    await page.waitForTimeout(5_000)
    await expect(dialog).toBeHidden()
  })

  test('“Continue with Google” is the sign-in form’s Google round-trip, returning to the page the visitor is on', async ({ page }) => {
    await getOnly(page)
    let target: string | null = null
    // First party (/auth/google/start, when a Google client id is configured) or Supabase's authorize
    // endpoint (when it is not, as on a local preview) — whichever the build uses, caught before it leaves.
    await page.route(/\/auth\/google\/start|\/auth\/v1\/authorize/, (route) => {
      target = route.request().url()
      return route.fulfill({ status: 204 })
    })
    await forcePrompt(page)
    await page.goto('/?q=iphone')
    const dialog = page.getByRole('dialog', { name: JOIN })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(450)
    await dialog.getByRole('button', { name: 'Continue with Google' }).click()
    await expect.poll(() => target, { timeout: 10_000 }).not.toBeNull()
    const url = new URL(target!)
    if (url.pathname.endsWith('/auth/google/start')) {
      expect(url.searchParams.get('next')).toBe('/?q=iphone')
    } else {
      expect(url.searchParams.get('provider')).toBe('google')
      const back = new URL(url.searchParams.get('redirect_to')!)
      expect(back.pathname).toBe('/auth/callback')
      expect(back.searchParams.get('next')).toBe('/?q=iphone')
    }
  })

  test('“Use email instead” opens the email form in the same card — no navigation', async ({ page }) => {
    await getOnly(page)
    await forcePrompt(page)
    await page.goto('/')
    const dialog = page.getByRole('dialog', { name: JOIN })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(450)
    const before = page.url()
    await dialog.getByRole('button', { name: 'Use email instead' }).click()
    const email = dialog.getByRole('textbox', { name: 'Email' })
    await expect(email).toBeVisible()
    await expect(email).toBeFocused()
    expect(page.url()).toBe(before)
  })

  test('⛔ never on the excluded routes, even when forced', async ({ page }) => {
    await getOnly(page)
    await forcePrompt(page, 500)
    await page.goto('/privacy')
    await page.waitForTimeout(4_000)
    await expect(page.getByRole('dialog', { name: JOIN })).toHaveCount(0)
  })

  test('⛔ without the override, automation never sees it — even two minutes in', async ({ page }) => {
    await getOnly(page)
    await page.clock.install()
    await page.goto('/')
    await page.clock.runFor(120_000)
    await expect(page.getByRole('dialog', { name: JOIN })).toHaveCount(0)
  })
})
