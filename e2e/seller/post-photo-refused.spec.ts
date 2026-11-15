import { test, expect, type Page } from '@playwright/test'

// The listing photo check in the post wizard (owner, 2026-11-15: no flyers or contact details in photos), on the seeded
// listing's edit screen with /api/upload mocked: a refused photo's tile shows its line and the banner, Save is blocked
// (no save request), and once that tile is removed the save goes through. The save itself is mocked too, so the seeded
// fixture is never changed. Runs only against the seeded standalone server (seller storageState).

const LISTING = 'e2e-listing-1'
const LINE = /Use a real photo — no flyers or phone numbers|Dùng ảnh chụp thật — không dùng tờ rơi hay số điện thoại/
const BANNER = /Some photos are not allowed — remove the marked ones and post again\.|Một số ảnh không được phép — hãy bỏ các ảnh được đánh dấu rồi đăng lại\./
const SAVE = /^(Save changes|Lưu thay đổi)$/

/** The photo tiles, in order (the seeded listing's own photo first). */
const tiles = (page: Page) => page.locator('#pw-photo [role="group"] > div.group')

test.describe('seller · post wizard — a photo the check refused', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires standalone server + seeded seller (E2E_AUTHED_BASE)')

  test('the refused tile is marked, Save is blocked, and removing it lets the save through', async ({ page }) => {
    const uploads: string[] = []
    // Per file in the order sent: the second new photo is a flyer.
    await page.route('**/api/upload', (r) => {
      const body = r.request().postDataBuffer()?.toString('latin1') ?? ''
      uploads.push(body)
      expect(body).toContain('name="check"')
      const n = body.split('filename=').length - 1
      const results = Array.from({ length: n }, (_, i) => (i === 1 ? { reason: 'photo_flyer' } : { url: `https://eno.vn/e2e-${uploads.length}-${i}.webp` }))
      return r.fulfill({ json: { urls: results.flatMap((x) => ('url' in x ? [x.url] : [])), failed: 1, reasons: ['photo_flyer'], results } })
    })
    const saves: unknown[] = []
    await page.route(`**/api/listings/${LISTING}`, (r) => {
      if (r.request().method() !== 'PATCH') return r.fallback()
      saves.push(r.request().postDataJSON())
      return r.fulfill({ json: { ok: true } })
    })

    await page.goto(`/listings/${LISTING}/edit`)
    await expect(page).not.toHaveURL(/\/signin/)
    await page.locator('#pw-photo input[type="file"][accept^="image/"]').setInputFiles(['e2e/fixtures/item-1.jpg', 'e2e/fixtures/item-2.jpg', 'e2e/fixtures/item-3.jpg'])
    await expect(tiles(page)).toHaveCount(4, { timeout: 15000 })

    const save = page.getByRole('button', { name: SAVE }).first()
    await save.click()
    await expect(page.getByText(BANNER)).toBeVisible({ timeout: 15000 })
    await expect(tiles(page).nth(2)).toContainText(LINE)
    await expect(tiles(page).nth(1)).not.toContainText(LINE)
    expect(saves).toHaveLength(0)

    // Again with it still there: refused before any upload.
    await save.click()
    await expect(page.getByText(BANNER)).toBeVisible()
    expect(uploads).toHaveLength(1)
    expect(saves).toHaveLength(0)

    await tiles(page).nth(2).getByRole('button', { name: /Remove photo|Xóa ảnh/ }).click()
    await expect(tiles(page)).toHaveCount(3)
    await save.click()
    await expect.poll(() => saves.length, { timeout: 15000 }).toBe(1)
    expect(uploads).toHaveLength(1) // the accepted photos went up once
  })
})
