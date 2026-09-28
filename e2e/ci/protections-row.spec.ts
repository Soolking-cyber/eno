import type { Locator, Page } from '@playwright/test'
// `test` from helpers seeds the privacy-preserving cookie-consent choice before navigation, so the
// first-visit consent dialog neither covers the row nor answers to getByRole('dialog').
import { test, expect } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// THE LISTING PAGE'S REPORTS-AND-DISPUTES ROW (SEO wave B, P0 / copy sheet CS-0, and P0t).
//
// The row used to read "ENO protects you — disputes handled in 72h · listings screened", and the
// dialog behind it promised screening before publication. None of it was true: 72 hours is only the
// evidence window, nothing bounds the decision, and listings publish the moment the automatic
// checks pass. This spec holds the replacement to what a copy edit or a refactor could quietly undo:
//  1. the row is still there on an ordinary eno listing — exactly once, found by its attribute, so
//     the partner-listing check in e2e/guest/listing.spec.ts (count 0) is not vacuous;
//  2. neither the row nor the dialog it opens makes a protection, guarantee or screening claim, or
//     names a deadline, in either language;
//  3. (P0t) the FIRST tap always does something. The row is in the server HTML, so it is on screen
//     before React attaches a handler. As a <button> it swallowed that tap and people tapped twice
//     (this spec used to click until the dialog opened). It is now a link to /safety#protection
//     until hydration and a dialog trigger after it, so: a tap before hydration lands on that
//     section, and after hydration ONE click opens the dialog, with no retry. The keyboard gets the
//     same, and focus comes back to the row when the dialog closes. And hydration leaves the row
//     where the reader scrolled it: ScrollToTop used to throw the page back to the top when it
//     finished, so a tap on its way to the row opened the photo gallery instead (scroll-to-top.tsx).
//
// ⛔ Fixture-backed like the rest of e2e/ci: `ci-l-1` is a plain electronics listing with no
// `affiliateUrl` (scripts/ci-fixtures.ts). Never point E2E_CI_BASE at production.
// ─────────────────────────────────────────────────────────────────────────────

/** Claims the row may not make. The same list src/components/marketplace/protections-row.test.ts
 *  applies to the component's source strings; this one applies it to what actually rendered. */
const FORBIDDEN = /protect|guarantee|screened|reviewed before|bảo vệ|đảm bảo|kiểm duyệt/i
/** No deadline until the owner reconciles the Regulations with the code (plan decision P0-a). The same
 *  pattern as protections-row.test.ts: a bare `\b72\b` misses "72h", the very string this replaced. */
const DEADLINE = /\b72\s*h?\b|working days?|ngày làm việc/i
const LISTING = '/listings/ci-l-1'
const ROW = '[data-protections-row]'

/**
 * Hold every script response until `release()`. The page gets its server HTML and CSS but cannot
 * hydrate, which is a slow phone's first seconds made to last. `load` waits for those scripts, so a
 * page opened this way is awaited to `domcontentloaded`.
 */
async function holdScripts(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route((url) => url.pathname.endsWith('.js'), async (route) => {
    await gate
    // The page may have navigated away by then, and its request with it.
    await route.continue().catch(() => {})
  })
  return async () => {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

/** The listing with its scripts held (see holdScripts): server HTML only, so exactly one row. */
async function openBeforeHydration(page: Page) {
  await page.goto(LISTING, { waitUntil: 'domcontentloaded' })
  const row = page.locator(ROW)
  await expect(row).toHaveCount(1)
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

/**
 * The row after hydration, found by the role="button" that the render AFTER hydration gives it
 * (protections-row.tsx). Hydration attached the click handler first, so once the role is there one
 * click must work. This is a readiness check, not a retry: it never clicks.
 * ⚠️ BY THAT ROLE, NOT BY `[data-protections-row]` ALONE, and only then counted. Until SEO wave B,
 * H1a the page body was streamed into a hidden container that an inline script revealed, and
 * unthrottled, a client-rendered row appeared ~0.4s in while the server's copy was still hidden, so
 * for ~50ms the bare attribute matched two rows and any strict locator threw (3 runs, no console
 * error). H1a deleted the listing's `loading.tsx`: the server's row is now the only one, in place from
 * the first byte, and it hydrates where it is. On a slow phone it is on screen well before it
 * hydrates; that gap is the window this change is about.
 */
async function hydratedRow(page: Page): Promise<Locator> {
  await page.goto(LISTING)
  await expect(page.locator(`${ROW}[role="button"]`)).toBeVisible({ timeout: 30_000 })
  const row = page.locator(ROW)
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  return row
}

for (const [locale, label, title, safetyHeading] of [
  ['en-US', 'Reports & disputes', 'How reports and disputes work', 'What we do — and what we don’t'],
  ['vi-VN', 'Báo cáo & khiếu nại', 'Cách xử lý báo cáo và khiếu nại', 'Những gì chúng tôi làm — và không làm'],
] as const) {
  test.describe(`reports-and-disputes row (${locale})`, () => {
    test.use({ locale })

    test('renders once on an ordinary listing and makes no protection claim', async ({ page }) => {
      const row = await hydratedRow(page)
      const text = (await row.innerText()).trim()
      expect(text).toContain(label)
      expect(text).not.toMatch(FORBIDDEN)
      expect(text).not.toMatch(DEADLINE)
    })

    test('before hydration it is a link, and a tap lands on the /safety section that covers the same ground', async ({ page }) => {
      const release = await holdScripts(page)
      try {
        const row = await openBeforeHydration(page)
        // Nothing can open a dialog yet, so nothing may announce one.
        await expect(row).toHaveAttribute('href', '/safety#protection')
        for (const attr of ['role', 'aria-haspopup', 'aria-expanded']) {
          expect(await row.getAttribute(attr), attr).toBeNull()
        }
        await row.click()
        await page.waitForURL((url) => url.pathname === '/safety' && url.hash === '#protection', { waitUntil: 'domcontentloaded' })
        // The browser scrolled to the section: its heading, not just some part of it, is on screen.
        const heading = page.locator('#protection').getByRole('heading', { level: 2 })
        await expect(heading).toHaveText(safetyHeading)
        await expect(heading).toBeInViewport({ ratio: 1 })
      } finally {
        await release()
      }
    })

    test('a reader who scrolled down to it before hydration keeps their place, and one tap then opens the dialog', async ({ page }) => {
      // A phone-sized window, so the row starts below the fold and reaching it takes a scroll (at
      // this project's 1280x720 it is on the first screen, and the check below would prove nothing).
      await page.setViewportSize({ width: 390, height: 664 })
      const release = await holdScripts(page)
      const row = page.locator(ROW)
      try {
        await openBeforeHydration(page)
        await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      } finally {
        await release()
      }
      await expect(page.locator(`${ROW}[role="button"]`)).toBeVisible({ timeout: 30_000 })
      // The old reset ran in an effect just after hydration. Give an effect that long, and more, to
      // run, then require the page to be where the reader left it (the browser's scroll anchoring may
      // adjust scrollY for content that changes above the row, but the row stays on screen).
      await page.waitForTimeout(1_000)
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      await expect(row).toBeInViewport({ ratio: 1 })
      await row.click()
      await expect(page.getByRole('dialog', { name: title })).toBeVisible()
      expect(new URL(page.url()).pathname).toBe(LISTING)
    })

    test('after hydration ONE click opens the dialog, which makes no protection claim and names no deadline', async ({ page }) => {
      const row = await hydratedRow(page)
      // Found by its NAME, because the page can hold other dialogs.
      const dialog = page.getByRole('dialog', { name: title })
      await row.click()
      await expect(dialog).toBeVisible()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      // The click opened the dialog INSTEAD of following the link.
      expect(new URL(page.url()).pathname).toBe(LISTING)
      const text = await dialog.innerText()
      expect(text).not.toMatch(FORBIDDEN)
      expect(text).not.toMatch(DEADLINE)
      // Both of its links go somewhere real: the safety guide and the Regulations' complaints article.
      await expect(dialog.locator('a[href="/safety"]')).toHaveCount(1)
      await expect(dialog.locator('a[href="/regulations#complaints"]')).toHaveCount(1)
    })

    test('after hydration Enter and Space open it, the page does not scroll, and focus comes back on close', async ({ page }) => {
      const row = await hydratedRow(page)
      const dialog = page.getByRole('dialog', { name: title })
      await row.focus()
      const scrollBefore = await page.evaluate(() => window.scrollY)

      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(row).toBeFocused()

      await page.keyboard.press(' ')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(row).toBeFocused()

      // A focused <a href> scrolls the page on Space unless its keydown is cancelled.
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
      expect(new URL(page.url()).pathname).toBe(LISTING)
    })
  })
}
