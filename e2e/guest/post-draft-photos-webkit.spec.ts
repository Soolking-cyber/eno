import type { Page } from '@playwright/test'
import { test, expect } from '../helpers'

/**
 * Photos survive a reload of /post in an EPHEMERAL WebKit session — the stand-in for Safari Private
 * Browsing and the in-app browsers that run on a non-persistent store.
 *
 * ⚠️ WHY WEBKIT, AND WHY IT IS ITS OWN, OPT-IN PROJECT (playwright.config.ts `guest-webkit-private`,
 * registered only with E2E_WEBKIT=1 — run it with `E2E_BASE=… npm run e2e:webkit`): a Playwright
 * WebKit context is ephemeral by default, and ephemeral WebKit IndexedDB refuses to store a Blob. The
 * draft used to keep each photo as a Blob, so every private-tab guest who chose Google at Publish (a
 * full-page redirect) came back to "re-add your photos". src/lib/post-draft-photos.ts now stores bytes;
 * Chromium never showed the bug, so the Chromium guest projects skip this file.
 *
 * ⛔ NOTHING HERE WRITES. Every non-GET request is aborted; the guest never presses Publish.
 */

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'webkit', 'the Blob refusal is WebKit-only; Chromium passes either way')
})

async function getOnly(page: Page) {
  await page.route('**/*', (route) => (route.request().method() === 'GET' ? route.fallback() : route.abort()))
}

/** A real, decodable PNG drawn in the page — the wizard re-encodes every photo through a canvas. */
async function pngBytes(page: Page, hue: number): Promise<Buffer> {
  const b64 = await page.evaluate((h) => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 240
    const g = c.getContext('2d')!
    g.fillStyle = `hsl(${h} 70% 50%)`
    g.fillRect(0, 0, 320, 240)
    return c.toDataURL('image/png').split(',')[1]
  }, hue)
  return Buffer.from(b64, 'base64')
}

/**
 * How many photos the draft holds in IndexedDB right now — the same database, store and key
 * src/lib/post-draft-photos.ts writes (`eno-post-draft` / `kv` / `photos`). -1 when it cannot be read.
 * Polled instead of a fixed sleep: the photo save is debounced (400ms) and then async (bytes read,
 * then a transaction), and how long that takes depends on the machine, not on a constant.
 */
function savedPhotoCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    try {
      const req = indexedDB.open('eno-post-draft', 1)
      // Same upgrade the app runs, so polling before the app's first open cannot break its schema.
      req.onupgradeneeded = () => { try { req.result.createObjectStore('kv') } catch { /* already there */ } }
      req.onerror = () => resolve(-1)
      req.onsuccess = () => {
        const db = req.result
        try {
          const get = db.transaction('kv', 'readonly').objectStore('kv').get('photos')
          get.onsuccess = () => { db.close(); resolve((get.result as { photos?: unknown[] } | undefined)?.photos?.length ?? 0) }
          get.onerror = () => { db.close(); resolve(-1) }
        } catch { db.close(); resolve(-1) }
      }
    } catch { resolve(-1) }
  }))
}

/** The title the text half of the draft (localStorage `eno-listing-draft`) holds, or null. */
function savedDraftTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('eno-listing-draft') || 'null') as { title?: string } | null)?.title ?? null } catch { return null }
  })
}

const removeButtons = (page: Page) => page.getByRole('button', { name: /^(Remove photo|Xóa ảnh)$/ })

test('two photos and a title survive a reload of /post', async ({ page }) => {
  await getOnly(page)
  await page.goto('/post')
  const input = page.locator('input[type="file"][accept^="image/"]').first()
  await input.setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await pngBytes(page, 20) },
    { name: 'b.png', mimeType: 'image/png', buffer: await pngBytes(page, 200) },
  ])
  await expect(removeButtons(page)).toHaveCount(2)
  // A draft is only kept once real typing happened (post-wizard.tsx autosave).
  await page.locator('#pw-title').fill('Bàn gỗ còn mới')
  // Both halves of the draft actually landed before the reload — the text in localStorage, the photos
  // in IndexedDB. On the old Blob storage the photo count never leaves 0 here, which is the bug.
  await expect.poll(() => savedDraftTitle(page), { timeout: 10_000 }).toBe('Bàn gỗ còn mới')
  await expect.poll(() => savedPhotoCount(page), { timeout: 15_000 }).toBe(2)
  await page.reload()
  await expect(page.locator('#pw-title')).toHaveValue('Bàn gỗ còn mới')
  await expect(removeButtons(page)).toHaveCount(2)
})
