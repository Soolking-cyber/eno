import { expectNoA11yViolations, test, expect } from './helpers'
import { canDeleteForumPost } from '../src/lib/forum-api'
import { INITIAL_FORUM_POSTS } from '../src/components/forum/forum-data'

test.describe('eno.forum standalone', () => {
  test('offers deletion only for the signed-in owner of a live post', () => {
    const livePost = { ...INITIAL_FORUM_POSTS[0], id: 'live-owned-post', live: true, authorId: 'owner-id' }
    expect(canDeleteForumPost(livePost, 'owner-id')).toBe(true)
    expect(canDeleteForumPost(livePost, 'another-member')).toBe(false)
    expect(canDeleteForumPost({ ...livePost, live: false }, 'owner-id')).toBe(false)
    expect(canDeleteForumPost(livePost, null)).toBe(false)
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const state = window as typeof window & { __enoForumFeedFetches: number }
      const originalFetch = window.fetch
      state.__enoForumFeedFetches = 0
      window.fetch = (...args) => {
        const input = args[0]
        const url = input instanceof Request ? input.url : String(input)
        if (url.includes('/api/backend/api/forum/posts')) state.__enoForumFeedFetches += 1
        return originalFetch(...args)
      }
    })
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
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as typeof window & { __enoForumFeedFetches: number }).__enoForumFeedFetches)).toBe(0)
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

  test('shares the 11-language preference across forum, itinerary, and visa pages', async ({ page }) => {
    const french: Record<string, string> = {
      'Vietnam feels easier together.': 'Le Vietnam devient plus simple ensemble.',
      'A Vietnam itinerary that survives reality.': 'Un itinéraire au Vietnam adapté à la réalité.',
      'One guided application. Every answer stays yours.': 'Une demande guidée. Chaque réponse reste la vôtre.',
    }
    await page.route('**/api/translate', async (route) => {
      const body = route.request().postDataJSON() as { texts: string[]; target: string }
      expect(body.target).toBe('fr')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translations: body.texts.map((text) => french[text] || text) }),
      })
    })

    await page.getByRole('button', { name: /Choose language/i }).click()
    await page.getByRole('menuitem', { name: /Français/i }).click()
    await expect(page.getByRole('heading', { name: french['Vietnam feels easier together.'] })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

    await page.goto('/itinerary')
    await expect(page.getByRole('heading', { name: french['A Vietnam itinerary that survives reality.'] })).toBeVisible()
    await page.goto('/visa')
    await expect(page.getByRole('heading', { name: french['One guided application. Every answer stays yours.'] })).toBeVisible()
  })
})
