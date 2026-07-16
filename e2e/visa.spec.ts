import { expectNoA11yViolations, test, expect } from './helpers'

test.describe('eno.forum visa assistance', () => {
  test('explains the safe guest flow and exposes the shared quick links', async ({ page }) => {
    await page.goto('/visa')
    await expect(page).toHaveTitle(/Vietnam e-Visa assistance/i)
    await expect(page.getByRole('heading', { level: 1, name: /One guided application/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Official e-Visa website/i })).toHaveAttribute('href', 'https://evisa.gov.vn/')
    await expect(page.locator('header img[src="/logo.svg"]')).toBeVisible()
    const footer = page.locator('footer')
    await expect(footer.getByRole('link', { name: 'Forum', exact: true })).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Itinerary', exact: true })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Vietnam e-Visa/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Marketplace/i })).toBeVisible()
    await expectNoA11yViolations(page, 'visa assistance guest page')
  })
})
