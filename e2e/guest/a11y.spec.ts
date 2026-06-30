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
    await page.goto('/listings/cmqumj6t7000104kzyqt17n3c')
    await dismissOverlays(page)
    await expectNoA11yViolations(page, 'listing')
  })
})
