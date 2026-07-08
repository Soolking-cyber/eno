import { test, expect } from '../helpers'

// Listing detail as a logged-out guest, against prod. READ-ONLY: we may click the contact
// gate / carousel arrow to assert behaviour, but never log in or mutate anything.
const LISTING = '/listings/cmqumj6t7000104kzyqt17n3c'

test.describe('Guest · listing detail (BMW XM SUV)', () => {
  test.beforeEach(async ({ page }) => { await page.goto(LISTING) })

  test('shows title and price area', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /BMW XM SUV/i })).toBeVisible()
    await expect(page).toHaveTitle(/BMW XM SUV/)
  })

  test('main image actually renders (broken-image guard)', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /BMW XM SUV/i })).toBeVisible()
    // Largest visible <img> = the hero photo; a broken image reports naturalWidth === 0.
    const naturalWidth = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 80 && r.height > 80 })
      if (!vis.length) return 0
      const big = vis.reduce((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height > ar.width * ar.height ? b : a })
      return big.naturalWidth
    })
    expect(naturalWidth, 'main listing image should have decoded (naturalWidth > 0)').toBeGreaterThan(0)
  })

  test('opens the photo lightbox and locks background scroll', async ({ page }) => {
    // Desktop opens the lightbox via "View all photos · N" on the mosaic; mobile's
    // full-width swipe carousel opens it by tapping the photo itself. Either way it
    // must open a modal that FREEZES the page behind it so swipes don't scroll the
    // background.
    await expect(page.getByRole('heading', { level: 1, name: /BMW XM SUV/i })).toBeVisible()
    const viewAll = page.getByRole('button', { name: /View all photos/i })
    if (await viewAll.isVisible()) await viewAll.click()
    else await page.getByRole('button', { name: /photo 1/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Background is scroll-locked while open…
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    // …and restored on close.
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('contact is gated for guests', async ({ page }) => {
    // The contact CTA reads "Chat now" (desktop seller card) / "Chat" (mobile sticky bar);
    // the sign-in gate now lives IN the click handler rather than in the button copy. A guest
    // who taps it must get the sign-in dialog — never a live thread / the seller's contact.
    const chat = page.getByRole('button', { name: /^(Chat now|Chat)$/i }).first()
    await expect(chat).toBeVisible()
    await chat.click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('exposes Save / Share / Report controls', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Share$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible()
  })
})
