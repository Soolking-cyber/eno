import { test, expectNoA11yViolations, dismissOverlays } from '../helpers'

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
    // Resolve a live listing from the home feed (audit Phase 0 — no hardcoded cuid).
    await page.goto('/')
    const card = page.locator('a[data-card-link]').first()
    await card.waitFor({ timeout: 20_000 })
    const href = new URL((await card.getAttribute('href'))!, page.url()).pathname
    await page.goto(href)
    await dismissOverlays(page)
    await expectNoA11yViolations(page, 'listing')
  })
})
