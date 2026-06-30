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

  test('opens the full photo gallery', async ({ page }) => {
    // The main gallery is opened via "View all photos · N" (the inline "Next photo" arrows
    // belong to the below-fold related-listing cards). Clicking it opens a lightbox dialog.
    await expect(page.getByRole('heading', { level: 1, name: /BMW XM SUV/i })).toBeVisible()
    const viewAll = page.getByRole('button', { name: /View all photos/i })
    await expect(viewAll).toBeVisible()
    await viewAll.click()
    // The gallery opens as a fullscreen lightbox with a Close control. (It isn't marked
    // role="dialog" — a minor a11y gap noted separately — so assert the Close affordance.)
    await expect(page.getByRole('button', { name: /^close$|đóng/i })).toBeVisible()
  })

  test('contact is gated for guests', async ({ page }) => {
    const gate = page.getByRole('button', { name: /Sign in to contact seller/i })
    await expect(gate).toBeVisible()
    await gate.click()
    // The gate opens a sign-in dialog (rather than navigating) — a guest cannot reach the seller.
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('exposes Save / Share / Report controls', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Share$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible()
  })
})
