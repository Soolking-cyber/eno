import { expectNoA11yViolations, test, expect } from './helpers'

test.describe('eno.forum standalone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-forum-page]')).toHaveAttribute('data-hydrated', 'true')
  })

  test('renders the forum shell and a useful discussion feed', async ({ page }) => {
    await expect(page).toHaveTitle(/eno\.forum/i)
    await expect(page.getByRole('heading', { level: 1, name: /Vietnam feels easier together/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /New to Vietnam\? Start with these 8 things/i }).first()).toBeVisible()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expectNoA11yViolations(page, 'standalone forum feed')
  })

  test('searches, opens a discussion, and adds a preview reply', async ({ page }) => {
    const search = page.locator('input[aria-label="Search the forum"]:visible')
    await search.fill('deposit')

    const post = page.getByRole('button', { name: /Landlord wants a 3-month deposit/i })
    await expect(post).toBeVisible()
    await post.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Landlord wants a 3-month deposit/i })).toBeVisible()
    await dialog.getByLabel('Join the conversation').fill('This is a useful answer from my own recent experience.')
    await dialog.getByRole('button', { name: 'Reply', exact: true }).first().click()
    await expect(dialog.getByText('This is a useful answer from my own recent experience.')).toBeVisible()
    await expect(page).toHaveURL(/\?post=thao-dien-deposit/)
  })

  test('creates a local preview post', async ({ page }) => {
    await page.locator('[data-testid="forum-create"]:visible').first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Community').click()
    await page.getByRole('option', { name: 'Housing' }).click()
    await dialog.getByLabel('Title').fill('What should I check before signing a lease?')
    await dialog.getByLabel('Details').fill('I am comparing two apartments and would appreciate a practical checklist from recent renters.')
    await dialog.getByRole('button', { name: 'Publish post' }).click()

    await expect(page.getByRole('button', { name: 'What should I check before signing a lease?' }).first()).toBeVisible()
  })
})
