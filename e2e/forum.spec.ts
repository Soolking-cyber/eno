import { expectNoA11yViolations, test, expect } from './helpers'

test.describe('eno.forum standalone', () => {
  test.beforeEach(async ({ page }) => {
    // Keep the guest-flow suite deterministic. Production forum data can replace the
    // seeded preview between a locator resolving and its click, which tests the remote
    // dataset's timing instead of this standalone UI.
    await page.route('**/api/backend/api/forum/**', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'e2e_preview' }) })
    })
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

  test('uses comfortably spaced selects and action menus', async ({ page }) => {
    const location = page.getByRole('combobox', { name: /Filter by location/i })
    const triggerBox = await location.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.height).toBeGreaterThanOrEqual(36)

    await location.click()
    const option = page.getByRole('option', { name: /Ho Chi Minh City/i })
    await expect(option).toBeVisible()
    const optionBox = await option.boundingBox()
    const listboxBox = await page.getByRole('listbox').boundingBox()
    expect(optionBox).not.toBeNull()
    expect(listboxBox).not.toBeNull()
    expect(optionBox!.height).toBeGreaterThanOrEqual(42)
    const listboxEndsAbove = listboxBox!.y + listboxBox!.height <= triggerBox!.y - 4
    const listboxStartsBelow = listboxBox!.y >= triggerBox!.y + triggerBox!.height + 4
    expect(listboxEndsAbove || listboxStartsBelow).toBe(true)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: /More post actions/i }).first().click()
    const action = page.getByRole('menuitem', { name: /Block this member/i })
    await expect(action).toBeVisible()
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(42)
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

  test('gates publishing behind the unified eno account', async ({ page }) => {
    await page.locator('[data-testid="forum-create"]:visible').first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'One eno account, everywhere.' })).toBeVisible()
    await expect(dialog.getByLabel('Email address')).toBeVisible()
  })
})
