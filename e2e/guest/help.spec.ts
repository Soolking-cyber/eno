import type { Page } from '@playwright/test'
import { test, expect, expectNoA11yViolations } from '../helpers'

// The Help Center is fully server-rendered, so its search box and topic chips are VISIBLE
// before React attaches. A fill/click before then is swallowed outright — the event is
// gone, and assertion auto-retry can't bring it back. Against prod (real latency) that made
// this suite flaky in a way it never was locally. Wait for the component's own hydration
// marker instead of sleeping.
async function openHelp(page: Page, path = '/help') {
  await page.goto(path)
  await page.locator('[data-help-center][data-hydrated="true"]').waitFor({ state: 'attached' })
}

// Guest coverage for the Help Center. Before this, NO spec touched /help in either app —
// so the FAQ could silently stop rendering (an empty answers query, a broken seed, a
// serializer change) and every gate would still be green.
//
// These assertions are deliberately about the CONTRACT, not about specific copy: the
// answers are DB rows and are meant to be edited, so a spec that pins exact wording would
// fail every time the owner improves an answer.

test.describe('Guest · help center', () => {
  test('renders the help center with seeded answers', async ({ page }) => {
    await openHelp(page)
    await expect(page.getByRole('heading', { name: /How can we help/i, level: 1 })).toBeVisible()

    // The seeded answers must actually arrive from the database. An empty Help Center
    // still renders its chrome, so assert on the answer list, not the page shell.
    const answers = page.locator('[data-slot="accordion-trigger"]')
    expect(await answers.count()).toBeGreaterThan(5)
  })

  test('an answer expands to reveal its body', async ({ page }) => {
    await openHelp(page)
    const first = page.locator('[data-slot="accordion-trigger"]').first()
    const question = (await first.textContent())?.trim() ?? ''
    expect(question.length).toBeGreaterThan(0)

    await first.click()
    // Base UI marks the open trigger; the panel is the sibling that carries the answer.
    await expect(first).toHaveAttribute('data-panel-open', '')
    await expect(page.locator('[data-slot="accordion-panel"]').first()).toBeVisible()
  })

  test('search narrows the answer list', async ({ page }) => {
    await openHelp(page)
    const answers = page.locator('[data-slot="accordion-trigger"]')
    const before = await answers.count()

    await page.getByRole('searchbox', { name: /search the help center/i }).fill('zzzznomatch')
    // A query with no hits must reach the recovery state, not an empty page.
    await expect(page.getByRole('button', { name: /reset search/i })).toBeVisible()
    // Poll: filtering is a re-render, so a bare count() here races the paint.
    await expect.poll(() => answers.count()).toBeLessThan(before)
  })

  test('a topic chip filters to that topic', async ({ page }) => {
    await openHelp(page)
    const answers = page.locator('[data-slot="accordion-trigger"]')
    const before = await answers.count()

    // "Shorter but non-empty" is true of ANY filter, including a wrong one. The real
    // invariant: filtering to a topic must leave EXACTLY the answers that topic's group
    // held in the unfiltered view. Count that group first (the unfiltered page groups by
    // topic under an h3), then compare after the chip is applied — the filtered view is a
    // flat list, so the h3 is gone and only the count can be compared.
    // `section:has(> h3)` targets the TOPIC section specifically — the outer "Answers"
    // section also contains that h3 as a descendant, so an unanchored :has matched both and
    // counted all 40 answers instead of the topic's 10.
    const group = page.locator('main section:has(> h3)').filter({ has: page.getByRole('heading', { level: 3, name: /Vietnam travel|Du lịch Việt Nam/i }) })
    const expected = await group.locator('[data-slot="accordion-trigger"]').count()
    expect(expected).toBeGreaterThan(0)

    const chip = page.getByRole('button', { name: /Vietnam travel/i })
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => answers.count()).toBe(expected)
    expect(expected).toBeLessThan(before)
  })

  test('an answer opens its own thread page', async ({ page }) => {
    await openHelp(page)
    const trigger = page.locator('[data-slot="accordion-trigger"]').first()
    // Capture the question we clicked, so we can prove the thread that opens is THAT one.
    const question = ((await trigger.textContent()) ?? '').trim()
    expect(question.length).toBeGreaterThan(0)
    await trigger.click()
    await page.getByRole('link', { name: /Ask a follow-up|Discussion/i }).first().click()

    await expect(page).toHaveURL(/\/help\/[^/]+$/)
    // ⚠️ Every assertion here used to be satisfied by the global 404 PAGE — it has an <h1>,
    // and footer.tsx:18 renders a site-wide "Help center" link. Proven by breaking the thread
    // route and watching this test stay green. Assert the ANSWER, not the page furniture:
    // the h1 must be the question we clicked, and the reply composer must exist.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(question)
    await expect(page.getByRole('textbox', { name: /write a reply/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /help center/i }).first()).toBeVisible()
  })

  test('help center has no serious a11y violations', async ({ page }) => {
    await openHelp(page)
    await expectNoA11yViolations(page, '/help')
  })
})
