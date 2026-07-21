import { test, expect, expectNoA11yViolations } from '../helpers'

// Guest coverage for the Help Center. Before this, NO spec touched /help in either app —
// so the FAQ could silently stop rendering (an empty answers query, a broken seed, a
// serializer change) and every gate would still be green.
//
// These assertions are deliberately about the CONTRACT, not about specific copy: the
// answers are DB rows and are meant to be edited, so a spec that pins exact wording would
// fail every time the owner improves an answer.

test.describe('Guest · help center', () => {
  test('renders the help center with seeded answers', async ({ page }) => {
    await page.goto('/help')
    await expect(page.getByRole('heading', { name: /How can we help/i, level: 1 })).toBeVisible()

    // The seeded answers must actually arrive from the database. An empty Help Center
    // still renders its chrome, so assert on the answer list, not the page shell.
    const answers = page.locator('[data-slot="accordion-trigger"]')
    expect(await answers.count()).toBeGreaterThan(5)
  })

  test('an answer expands to reveal its body', async ({ page }) => {
    await page.goto('/help')
    const first = page.locator('[data-slot="accordion-trigger"]').first()
    const question = (await first.textContent())?.trim() ?? ''
    expect(question.length).toBeGreaterThan(0)

    await first.click()
    // Base UI marks the open trigger; the panel is the sibling that carries the answer.
    await expect(first).toHaveAttribute('data-panel-open', '')
    await expect(page.locator('[data-slot="accordion-panel"]').first()).toBeVisible()
  })

  test('search narrows the answer list', async ({ page }) => {
    await page.goto('/help')
    const answers = page.locator('[data-slot="accordion-trigger"]')
    const before = await answers.count()

    await page.getByRole('searchbox', { name: /search the help center/i }).fill('zzzznomatch')
    // A query with no hits must reach the recovery state, not an empty page.
    await expect(page.getByRole('button', { name: /reset search/i })).toBeVisible()
    expect(await answers.count()).toBeLessThan(before)
  })

  test('a topic chip filters to that topic', async ({ page }) => {
    await page.goto('/help')
    const answers = page.locator('[data-slot="accordion-trigger"]')
    const before = await answers.count()

    await page.getByRole('button', { name: /Vietnam travel/i }).click()
    const after = await answers.count()
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
  })

  test('an answer opens its own thread page', async ({ page }) => {
    await page.goto('/help')
    await page.locator('[data-slot="accordion-trigger"]').first().click()
    await page.getByRole('link', { name: /Ask a follow-up|Discussion/i }).first().click()

    await expect(page).toHaveURL(/\/help\/[^/]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The thread must offer the way back into the Help Center it came from.
    await expect(page.getByRole('link', { name: /help center/i }).first()).toBeVisible()
  })

  test('help center has no serious a11y violations', async ({ page }) => {
    await page.goto('/help')
    await expectNoA11yViolations(page, '/help')
  })
})
