import { expectNoA11yViolations, test, expect } from './helpers'
import { canDeleteForumPost } from '../src/lib/forum-api'
import { INITIAL_FORUM_POSTS } from '../src/components/forum/forum-data'

function mockEnoSessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id: 'e2e-support-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'support@eno.vn',
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

test.describe('eno.forum deployable workspace', () => {
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
    // dataset's timing instead of this forum UI.
    await page.route('**/api/backend/api/forum/**', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'e2e_preview' }) })
    })
    await page.goto('/')
    await expect(page.locator('[data-forum-page]')).toHaveAttribute('data-hydrated', 'true')
  })

  test('renders the forum shell and a useful discussion feed', async ({ page }) => {
    await expect(page).toHaveTitle(/eno\.forum/i)
    await expect(page.getByRole('heading', { level: 1, name: /Vietnam feels easier together/i })).toBeVisible()
    // A feed card's title is a real ANCHOR, not a button — 5550b99b made threads indexable by
    // giving every card a permalink (<Button asChild><a href>), which is correct for SEO and
    // for middle/modified clicks. Scoped to <main>, because the right rail lists the same
    // titles as buttons: querying role=button unscoped matched the RAIL on desktop and passed
    // while asserting nothing about the feed, and failed on mobile only because the rail is
    // hidden there. Same bug, two different-looking symptoms.
    await expect(page.locator('main').getByRole('link', { name: /New to Vietnam\? Start with these 8 things/i }).first()).toBeVisible()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(page.locator('nav[aria-label="Forum tools"]')).toHaveCount(0)
    await expect(page.locator('nav[aria-label="Account"]')).toHaveCount(0)
    // ⚠️ THIS is the live guard against a duplicate account rail returning, and it is the
    // only one — it keys on HREFS that really exist in the product (ENO_DASHBOARD_URL is
    // rendered as <a href> in mobile-forum-nav.tsx), not on copy. Verified by injecting a
    // dashboard link into ForumRightRail's <aside>: this test went red. Do not "tidy" it
    // away, and do not weaken it to a text match.
    await expect(page.locator('aside a[href="/itinerary"], aside a[href="/visa"], aside a[href="https://eno.vn/dashboard"]')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as typeof window & { __enoForumFeedFetches: number }).__enoForumFeedFetches)).toBe(0)
    await expectNoA11yViolations(page, 'forum feed')
  })

  test('uses comfortably spaced selects and action menus', async ({ page }) => {
    // This test MEASURES pixels, so it must not read a box mid font-swap. The helper waits for
    // 'load', but a swapped webfont re-lays-out text after that: on a cold CI run the option
    // measured 41.79998779296875px against a >= 42 floor, then passed on retry once the font was
    // cached — a 0.2px fallback-metrics artifact, not a spacing regression. Settling the fonts
    // first keeps the 42px tap-target floor meaningful instead of relaxing it to hide the race.
    await page.evaluate(() => document.fonts.ready)
    const location = page.getByRole('combobox', { name: /Filter by location/i })
    const triggerBox = await location.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.height).toBeGreaterThanOrEqual(36)

    await location.click()
    const option = page.getByRole('option', { name: /Ho Chi Minh City/i })
    await expect(option).toBeVisible()
    // ⚠️ POLL, do not take a one-shot measurement. Two earlier attempts to fix this by awaiting
    // document.fonts.ready both failed, because the diagnosis was wrong: CI reported
    // 41.79998779296875 — BIT-IDENTICAL across runs, to eleven decimals. Jitter varies; a
    // repeatable value does not. The option really does lay out at 41.8px with the FALLBACK face,
    // and fonts.ready cannot prevent that here — it resolves immediately when no font request is
    // in flight, and the listbox text that triggers the request does not exist until the click
    // above. So there was nothing pending to wait for at the moment we waited.
    // expect.poll re-measures until the webfont has actually applied, which keeps the 42px
    // tap-target floor enforced (a real regression still fails, after the timeout) instead of
    // being relaxed to 41.5 to make the red go away.
    await expect
      .poll(async () => (await option.boundingBox())?.height ?? 0, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(42)
    const optionBox = await option.boundingBox()
    const listboxBox = await page.getByRole('listbox').boundingBox()
    expect(optionBox).not.toBeNull()
    expect(listboxBox).not.toBeNull()
    const listboxEndsAbove = listboxBox!.y + listboxBox!.height <= triggerBox!.y - 4
    const listboxStartsBelow = listboxBox!.y >= triggerBox!.y + triggerBox!.height + 4
    expect(listboxEndsAbove || listboxStartsBelow).toBe(true)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: /More post actions/i }).first().click()
    const action = page.getByRole('menuitem', { name: /Block this member/i })
    await expect(action).toBeVisible()
    // Same class of measurement as the option above — the menu is portalled in on click, so its
    // text can request the webfont just as late. Poll for the same reason.
    await expect
      .poll(async () => (await action.boundingBox())?.height ?? 0, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(42)
  })

  test('searches, opens a discussion, and adds a preview reply', async ({ page }) => {
    const search = page.locator('input[aria-label="Search the forum"]:visible')
    await search.fill('deposit')

    const post = page.locator('main').getByRole('link', { name: /Landlord wants a 3-month deposit/i })
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

  test('keeps the former forum dashboard route as a legacy canonical redirect only', async ({ request }) => {
    const response = await request.get('/dashboard', { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers().location).toBe('https://eno.vn/dashboard')
  })

  test('uses the one canonical dashboard instead of mounting a duplicate forum rail', async ({ page }) => {
    test.skip(Boolean(process.env.E2E_BASE), 'The signed-in shell fixture is local-only.')
    await page.context().addCookies([{
      name: 'sb-127-auth-token',
      value: mockEnoSessionCookie(),
      url: 'http://127.0.0.1:3101',
    }])
    await page.reload()

    const header = page.locator('#app-header')
    // ⚠️ These used to assert the ABSENCE of 'eno-account-panel', 'Choose language' and
    // 'Open eno dashboard'. Every one of those strings has ZERO occurrences in
    // apps/forum/src — they were pinned to an implementation deleted long ago, so they
    // could never fail no matter what the product did. Replaced with STRUCTURAL guards on
    // things that actually exist: no account rail anywhere in the signed-in shell, and no
    // second navigation landmark competing with the header.
    await expect(page.locator('aside a[href="https://eno.vn/dashboard"], aside a[href="/account"]')).toHaveCount(0)
    await expect(header.getByTestId('forum-create')).toHaveCount(1)

    // /itinerary is no longer a forum surface (owner, 2026-07-25) — it 308s to eno.vn, so it
    // cannot be asserted as part of the signed-in shell. /visa below carries the same guard.

    // The local signed-in cookie is synthetic, so keep the visa load focused on
    // the canonical account entry rather than validating it against Supabase.
    await page.route('**/api/visa/applications', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applications: [] }) })
    })
    await page.goto('/visa')
    await expect(page.getByRole('heading', { level: 1, name: /One guided application/i })).toBeVisible()
    await expect(page.locator('#app-header').getByRole('button')).toHaveCount(0)
    await expect(page.locator('#app-header').getByRole('link', { name: /Open eno dashboard/i })).toHaveCount(0)
  })

  test('shares the 11-language preference across forum and visa pages', async ({ page }) => {
    // The itinerary leg was dropped 2026-07-25: that surface moved to eno.vn and this host
    // now 308s it away, so there is no forum-rendered heading left to translate.
    const french: Record<string, string> = {
      'Vietnam feels easier together.': 'Le Vietnam devient plus simple ensemble.',
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

    // Language selection now lives in the one canonical eno dashboard. Simulate
    // that persisted preference here and verify every forum-owned surface honors it.
    await page.evaluate(() => {
      localStorage.setItem('eno-forum-language', 'fr')
      localStorage.setItem('lang', 'fr')
    })
    await page.reload()
    await expect(page.getByRole('heading', { name: french['Vietnam feels easier together.'] })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

    await page.goto('/visa')
    await expect(page.getByRole('heading', { name: french['One guided application. Every answer stays yours.'] })).toBeVisible()
  })

  test('hands /itinerary to eno.vn instead of serving or 404ing it', async ({ page }) => {
    // The trip service moved to eno.vn (owner, 2026-07-25) and this app's copy was deleted.
    // The redirect is the whole reason that deletion is safe — every existing link, bookmark
    // and search result depends on it — so it is asserted here rather than left to a comment.
    // Checked WITHOUT following, because what matters is the 308 and its target: a 200 would
    // mean the page came back, and a 404 would mean we broke every inbound link.
    for (const path of ['/itinerary', '/itinerary/anything']) {
      const res = await page.request.get(path, { maxRedirects: 0 })
      expect(res.status(), `${path} must redirect, not serve or 404`).toBe(308)
      expect(res.headers()['location']).toBe('https://eno.vn/itinerary')
    }
    // And the builder's API is genuinely gone, not merely unlinked.
    const api = await page.request.post('/api/itineraries/generate', { data: {}, maxRedirects: 0 })
    expect(api.status()).toBe(404)
  })
})
