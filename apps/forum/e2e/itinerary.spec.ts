import { expectNoA11yViolations, test, expect } from './helpers'

test.describe('eno.forum itinerary builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/itinerary')
  })

  test('builds a responsive itinerary preview from Base UI controls', async ({ page }) => {
    await expect(page).toHaveTitle(/Vietnam itinerary builder/i)
    await expect(page.getByRole('heading', { level: 1, name: /Your Vietnam trip, planned in minutes/i })).toBeVisible()

    await page.getByRole('combobox', { name: /Where do you want to explore/i }).click()
    await page.getByRole('option', { name: /Ho Chi Minh City & the South/i }).click()
    await page.getByRole('radio', { name: /Premium/i }).click()
    await page.getByRole('slider', { name: /Trip length in days/i }).press('Home')
    await page.getByRole('slider', { name: /Trip length in days/i }).press('ArrowRight')

    await page.getByTestId('build-itinerary').click()

    await expect(page.getByRole('heading', { name: /Southern Vietnam/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Suggested stays/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Day by day/i })).toBeVisible()
    await expect(page.getByText(/District 3 design hotel/i)).toBeVisible()
    await expect(page.getByTestId('itinerary-day')).toHaveCount(4)
    await expectNoA11yViolations(page, 'forum itinerary preview')
  })
})
