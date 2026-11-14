import { test, expect, expectNoA11yViolations, dismissOverlays } from '../helpers'
import type { Page } from '@playwright/test'

// Resolve a live listing from the home feed (audit Phase 0 — no hardcoded cuid).
async function openAListing(page: Page) {
  await page.goto('/')
  const card = page.locator('.feed-grid a[data-card-link]').first()
  await card.waitFor({ timeout: 20_000 })
  const href = new URL((await card.getAttribute('href'))!, page.url()).pathname
  await page.goto(href)
}

// Accessibility scan (axe, WCAG 2 A/AA) on the highest-traffic guest pages. Fails on any
// serious/critical violation. Consent is pre-seeded by the helper `test`, so axe scans the
// real page, not the consent modal.
test.describe('Guest · accessibility', () => {
  test('homepage has no serious/critical violations', async ({ page }) => {
    await page.goto('/')
    await dismissOverlays(page)
    await expectNoA11yViolations(page, 'home')
  })

  test('category page has no serious/critical violations', async ({ page }) => {
    await page.goto('/c/electronics')
    await dismissOverlays(page)
    await expectNoA11yViolations(page, 'category')
  })

  test('listing page has no serious/critical violations', async ({ page }) => {
    await openAListing(page)
    await dismissOverlays(page)
    await expectNoA11yViolations(page, 'listing')
  })
})

// The same pages in DARK (the 2026-11-14 token change). "System" is the default theme, so an OS-dark phone gets
// `.dark` from the pre-paint script with nothing stored — this is what most of those visitors see, and colour
// contrast in dark was never scanned before. A pre-existing dark failure is fixed or recorded in e2e/known-failures.md.
test.describe('Guest · accessibility · dark', () => {
  test.use({ colorScheme: 'dark' })

  test('homepage (dark) has no serious/critical violations', async ({ page }) => {
    await page.goto('/')
    await dismissOverlays(page)
    // The scan must see DARK: a stored light choice would win over the OS preference (gate review, 2026-11-14).
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expectNoA11yViolations(page, 'home-dark')
  })

  test('category page (dark) has no serious/critical violations', async ({ page }) => {
    await page.goto('/c/electronics')
    await dismissOverlays(page)
    // The scan must see DARK: a stored light choice would win over the OS preference (gate review, 2026-11-14).
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expectNoA11yViolations(page, 'category-dark')
  })

  test('listing page (dark) has no serious/critical violations', async ({ page }) => {
    await openAListing(page)
    await dismissOverlays(page)
    // The scan must see DARK: a stored light choice would win over the OS preference (gate review, 2026-11-14).
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expectNoA11yViolations(page, 'listing-dark')
  })
})
