import { existsSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../helpers'

/**
 * The rental availability check, end to end at phone width (390×844): collect rentals from the
 * category grid, see the pill, open the list, and press "Check these for me".
 *
 * ⚠️ IT LIVES UNDER e2e/guest/ ON PURPOSE. playwright.config.ts only runs `guest/**` (plus named
 * authed specs), so a spec at the root of e2e/ would be matched by no project and silently never run
 * — the fails-open class this suite has been bitten by before.
 *
 * ⛔ NOTHING HERE WRITES. The guest path stops at the sign-in dialog, and the signed-in path answers
 * POST /api/rental-check from a route stub, so a run against a preview wired to the production
 * database cannot create a conversation. The thread page itself (the request card) belongs to the
 * server half and is not asserted here beyond the redirect.
 */

test.use({ viewport: { width: 390, height: 844 } })
test.beforeEach(({}, testInfo) => {
  // A phone-width flow; running it again under the desktop project adds nothing.
  test.skip(testInfo.project.name !== 'guest-mobile', 'phone-width flow runs in guest-mobile only')
})

const chips = (page: Page) => page.locator('[data-rental-check-toggle]')

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function boxOf(l: Locator) {
  return (await l.count()) ? l.first().boundingBox() : null
}

async function collectTwo(page: Page) {
  await page.goto('/c/rentals')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // ⚠️ SKIP ONLY ON AN EMPTY CATALOGUE, NEVER ON A MISSING CHIP. Every card on /c/rentals is a
  // rental, so cards without chips is the regression this spec exists to catch — it must be red, not
  // skipped (a reviewer's catch: the first version skipped on the chip count and failed open).
  const cards = await page.locator('a[data-card-link]').count()
  if (cards < 2) test.skip(true, 'fewer than two live rentals on this build')
  expect(await chips(page).count(), 'rental cards render without the availability-check chip').toBeGreaterThanOrEqual(2)
  for (const i of [0, 1]) {
    const chip = chips(page).nth(i)
    // Centred, not merely "in view": near the bottom edge the fixed nav covers the photo's lower
    // corner, which is exactly where this chip sits (category.spec.ts hit the same thing).
    await chip.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
  }
  // The tap on the chip must not have opened the listing.
  await expect(page).toHaveURL(/\/c\/rentals/)
}

test('guest: collect two, the pill clears the chrome, the list shows both, sending asks to sign in', async ({ page }) => {
  const posts: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/rental-check')) posts.push(r.method()) })

  await collectTwo(page)
  // The first add explains that the check is free.
  await expect(page.getByText('Free — the eno team checks for you at no charge, and adds no fee or markup to the rent.').first()).toBeVisible()

  const pill = page.locator('[data-rental-check-pill]')
  await expect(pill).toBeVisible()
  await expect(pill).toContainText('Check 2 rentals')
  await expect(pill).toContainText('Free check · no fees')

  // Geometry: the pill must not sit on the bottom nav, the support mark or the chevron.
  const pillBox = (await pill.boundingBox())!
  const nav = page.locator('nav').filter({ has: page.locator('a[aria-label="Explore"]') })
  for (const [name, l] of [['bottom nav', nav], ['support', page.locator('.support-mark')], ['chevron', page.locator('.back-to-top-chevron')]] as const) {
    const b = await boxOf(l)
    if (b && b.width > 0 && b.height > 0) expect(overlaps(pillBox, b), `pill overlaps the ${name}`).toBe(false)
  }
  // …and it is really tappable (the cluster is pointer-events:none; the pill must opt back in).
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-rental-check-pill]') != null, {
    x: pillBox.x + pillBox.width / 2,
    y: pillBox.y + pillBox.height / 2,
  })
  expect(hit).toBe(true)

  await pill.click()
  await expect(page).toHaveURL(/\/rentals\/check$/)
  await expect(page.locator('[data-rental-row]')).toHaveCount(2)
  await expect(page.locator('[data-rental-check-pill]')).toHaveCount(0)
  await expect(page.getByText('Free check · no fees · no markup on the rent')).toBeVisible()

  await page.getByRole('radio', { name: 'WhatsApp' }).click()
  await page.locator('#rc-contact').fill('+44 7700 900123')
  await page.getByRole('button', { name: 'Check these for me' }).click()
  const note = page.locator('[data-sign-in-note]')
  await expect(note).toBeVisible()
  await expect(note).toContainText('no markup on the rent')
  expect(posts, 'a guest press must not reach the API').toEqual([])
})

const BUYER = 'e2e/.auth/buyer.json'
const sameHost = (process.env.E2E_AUTHED_BASE || '').replace(/\/$/, '') === (process.env.E2E_BASE || '').replace(/\/$/, '')

test.describe('signed in', () => {
  test.skip(!existsSync(BUYER) || !sameHost, 'needs e2e/.auth/buyer.json for the same host as E2E_BASE')
  test.use({ storageState: BUYER })

  test('sending goes to the thread (API stubbed — nothing is written)', async ({ page }) => {
    const bodies: unknown[] = []
    await page.route('**/api/rental-check', async (route) => {
      bodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { conversationId: 'e2e-rental-thread', messageId: 'm', threadCreated: true, listingIds: [] } })
    })
    await collectTwo(page)
    await page.locator('[data-rental-check-pill]').click()
    await page.getByRole('radio', { name: 'WhatsApp' }).click()
    await page.locator('#rc-contact').fill('+44 7700 900123')
    await page.getByRole('button', { name: 'Check these for me' }).click()
    await expect(page).toHaveURL(/\/messages\/e2e-rental-thread$/)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ contact: { channel: 'whatsapp', value: '+44 7700 900123' } })
    expect((bodies[0] as { listingIds: string[] }).listingIds).toHaveLength(2)
  })
})
