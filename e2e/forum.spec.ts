import { expectNoA11yViolations, test, expect } from './helpers'
import { canDeleteForumPost } from '../src/lib/forum-api'
import { INITIAL_FORUM_POSTS } from '../src/components/forum/forum-data'

function mockEnoSessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id: 'e2e-support-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'support@eno.forum',
    email_confirmed_at: new Date().toISOString(),
    phone: '',
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Test Support' },
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', sub: user.id, email: user.email, exp: now + 86_400 })}.e2e-signature`
  return `base64-${encode({ access_token: accessToken, refresh_token: 'e2e-refresh-token', expires_in: 86_400, expires_at: now + 86_400, token_type: 'bearer', user })}`
}

test.describe('eno.forum standalone', () => {
  test('offers deletion only for the signed-in owner of a live post', () => {
    const livePost = { ...INITIAL_FORUM_POSTS[0], id: 'live-owned-post', live: true, authorId: 'owner-id' }
    expect(canDeleteForumPost(livePost, 'owner-id')).toBe(true)
    expect(canDeleteForumPost(livePost, 'another-member')).toBe(false)
    expect(canDeleteForumPost({ ...livePost, live: false }, 'owner-id')).toBe(false)
    expect(canDeleteForumPost(livePost, null)).toBe(false)
  })

  test('keeps the forum-owned delete endpoint private', async ({ request }) => {
    const response = await request.delete('/api/forum/posts/not-a-real-post')
    expect(response.status()).toBe(401)
    expect(await response.json()).toEqual({ error: 'auth_required' })
  })

  test('publishes a crawlable fixed-size search favicon', async ({ request, page }) => {
    const favicon = await request.get('/favicon.ico')
    expect(favicon.status()).toBe(200)
    expect(favicon.headers()['content-type']).toContain('image/x-icon')
    await page.goto('/')
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1)
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
    const createPost = page.getByRole('button', { name: /^Start a post$/i })
    await expect(createPost).toHaveCount(1)
    await createPost.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'One eno account, everywhere.' })).toBeVisible()
    await expect(dialog.getByLabel('Email address')).toBeVisible()
  })

  test('provides a private eno service dashboard from the shared header', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1, name: /Your eno dashboard/i })).toBeVisible()
    await expect(page.getByText(/itineraries, visa applications, forum activity, and marketplace tools/i)).toBeVisible()
    await page.locator('main').getByRole('button', { name: /Sign in to eno/i }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: /One eno account, everywhere/i })).toBeVisible()
  })

  test('uses one responsive eno dashboard rail across forum services', async ({ page }) => {
    test.skip(Boolean(process.env.E2E_BASE), 'The signed-in shell fixture is local-only.')
    await page.context().addCookies([{
      name: 'sb-127-auth-token',
      value: mockEnoSessionCookie(),
      url: 'http://127.0.0.1:3101',
    }])
    await page.reload()

    const panel = page.getByTestId('eno-account-panel')
    const mobile = (page.viewportSize()?.width || 0) < 1024
    if (mobile) {
      await expect(panel).not.toBeVisible()
      await page.getByRole('button', { name: /^Account$/i }).click()
      await expect(panel).toBeVisible()
      await expect(panel).toHaveAttribute('role', 'dialog')
    } else {
      await expect(panel).toBeVisible()
      await expect(panel).toHaveAttribute('data-expanded', 'false')
      const collapsedBox = await panel.boundingBox()
      expect(collapsedBox).not.toBeNull()
      expect(collapsedBox!.width).toBeCloseTo(72, 0)
      await expect(panel.locator('img[src="/logo-mark.svg"]')).toBeVisible()
      await page.getByRole('button', { name: /Expand sidebar/i }).click()
      await expect(panel).toHaveAttribute('data-expanded', 'true')
      await expect.poll(async () => (await panel.boundingBox())?.width).toBeCloseTo(280, 0)
      await page.setViewportSize({ width: 1024, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }

    await expect(panel.getByRole('link', { name: /^Dashboard$/i })).toHaveAttribute('href', '/dashboard')
    await expect(panel.getByRole('link', { name: /^Community forum$/i })).toHaveAttribute('href', '/')
    await expect(panel.getByRole('link', { name: /^Itinerary planner$/i })).toHaveAttribute('href', '/itinerary')
    await expect(panel.getByRole('link', { name: /^Vietnam e-Visa$/i })).toHaveAttribute('href', '/visa')
    await expect(panel.getByRole('link', { name: /^eno marketplace$/i })).toHaveAttribute('href', 'https://eno.vn')
    await expect(panel.getByRole('link', { name: /^My listings$/i })).toHaveAttribute('href', 'https://eno.vn/dashboard/listings')
    await expect(panel.getByRole('link', { name: /^Messages$/i })).toHaveAttribute('href', 'https://eno.vn/messages')
    await expect(panel.getByRole('link', { name: /^Saved$/i })).toHaveAttribute('href', 'https://eno.vn/saved')
    await expect(panel.getByText('Test Support')).toBeVisible()
    await expect(panel.getByText('support@eno.forum')).toBeVisible()
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expectNoA11yViolations(page, 'unified eno account rail')

    if (mobile) {
      await panel.getByRole('button', { name: /Close account menu/i }).click()
      await expect(panel).not.toBeVisible()
    } else {
      await page.getByRole('button', { name: /Collapse sidebar/i }).click()
      await expect(panel).toHaveAttribute('data-expanded', 'false')
    }

    await page.goto('/itinerary')
    await expect(page.locator('main[data-hydrated]')).toHaveAttribute('data-hydrated', 'true')
    if (mobile) await page.getByRole('button', { name: /Open eno dashboard/i }).click()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('link', { name: /^Itinerary planner$/i })).toHaveAttribute('aria-current', 'page')
    if (mobile) await panel.getByRole('button', { name: /Close account menu/i }).click()

    await page.goto('/visa')
    await expect(page.getByRole('heading', { level: 1, name: /One guided application/i })).toBeVisible()
    if (mobile) await page.getByRole('button', { name: /Open eno dashboard/i }).click()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('link', { name: /^Vietnam e-Visa$/i })).toHaveAttribute('aria-current', 'page')
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
