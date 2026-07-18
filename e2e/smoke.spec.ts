import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'

// ── Golden-path smoke test — the ONE end-to-end journey that proves the marketplace's core value ──
//
// A real two-actor lifecycle, run SERIALLY as one story (not isolated asserts):
//   Phase 1  Seller posts a brand-new listing through the /post wizard (creates its OWN state —
//            no reliance on a pre-seeded "E2E Test Item").
//   Phase 2  Buyer (a SEPARATE browser context) discovers it by searching the exact title.
//   Phase 3  Buyer opens a chat with the seller from the PDP.
//   Phase 4  Seller sees the buyer's message in the inbox and marks the item Sold.
//   Cleanup  The seller soft-removes the listing so re-runs don't accumulate clutter.
//
// Runs ONLY in authed mode (E2E_AUTHED_BASE + the seeded seller/buyer sessions from auth.setup.ts).
// It never touches prod: absent that env the whole file self-skips. Two contexts = two logged-in
// users, from the storageStates the `setup` project captured (seller.json / buyer.json).
//
// Conventions honoured: user-centric locators (getByRole/getByPlaceholder/getByLabel), `waitForResponse`
// around the optimistic writes, and a unique per-run title so search resolves to exactly this item.

const AUTH_DIR = 'e2e/.auth'
const HAVE_SESSIONS = existsSync(`${AUTH_DIR}/seller.json`) && existsSync(`${AUTH_DIR}/buyer.json`)

// Geolocation mock — lets "Use my current location" fill province/ward deterministically, exactly as
// the standalone post-location spec does (no dependence on the live geo dataset).
const PROVINCES = { provinces: [{ code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, { code: '01', name: 'Thành phố Hà Nội', nameEn: 'Hanoi' }] }
const WARDS_01 = { wards: [{ code: 'W_HK', name: 'Phường Hoàn Kiếm', nameEn: 'Hoan Kiem Ward' }] }
const GEOCODE = { address: '1 Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội', province: 'Thành phố Hà Nội', ward: '', wardCandidates: ['Hoàn Kiếm'], district: null }

async function mockGeo(page: Page) {
  await page.route('**/api/geo?type=provinces', (r) => r.fulfill({ json: PROVINCES }))
  await page.route('**/api/geo?type=wards*', (r) => {
    const prov = new URL(r.request().url()).searchParams.get('province')
    return r.fulfill({ json: prov === '01' ? WARDS_01 : { wards: [] } })
  })
  await page.route('**/api/reverse-geocode*', (r) => r.fulfill({ json: GEOCODE }))
}

test.describe.serial('Golden path · seller posts → buyer finds & chats → seller manages', () => {
  test.skip(!process.env.E2E_AUTHED_BASE || !HAVE_SESSIONS, 'requires the standalone server + seeded seller & buyer sessions (E2E_AUTHED_BASE, E2E_BUYER_EMAIL)')
  // This is a STATEFUL create flow — a retry would re-post the same title and trip the duplicate
  // guard (409) instead of reproducing the original failure. Never retry it.
  test.describe.configure({ retries: 0 })

  let sellerCtx: BrowserContext
  let buyerCtx: BrowserContext
  let seller: Page
  let buyer: Page

  // Unique title → the buyer's search resolves to exactly this listing, and the seller's dashboard
  // row is unambiguous even beside the seeded fixture.
  const stamp = Date.now().toString(36)
  const TITLE = `Smoketest Item ${stamp}`
  const DESCRIPTION = 'Gently used and in great condition, from a smoke-free home. Selling because I am moving away soon.'
  const PRICE = '250000'
  const OPENER = /still available|còn không|còn hàng/i

  let listingPath = '' // "/listings/<id>"
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    // Seller context is geolocation-capable so "Use my current location" works (mocked per-page).
    sellerCtx = await browser.newContext({ storageState: `${AUTH_DIR}/seller.json`, locale: 'en-US', geolocation: { latitude: 21.0285, longitude: 105.8542 }, permissions: ['geolocation'] })
    buyerCtx = await browser.newContext({ storageState: `${AUTH_DIR}/buyer.json`, locale: 'en-US' })
    seller = await sellerCtx.newPage()
    buyer = await buyerCtx.newPage()
  })

  test.afterAll(async () => {
    // Cleanup — soft-remove the listing so repeat runs don't pile up. Best-effort, via the seller's
    // authenticated request context (their cookies), so a UI hiccup never leaves the item live.
    if (listingId) await sellerCtx?.request.delete(`/api/listings/${listingId}`).catch(() => {})
    await sellerCtx?.close()
    await buyerCtx?.close()
  })

  test('Phase 1 · seller posts a new listing and lands on the success screen', async () => {
    test.setTimeout(90_000) // 3 photo uploads + create is heavier than a normal step
    await mockGeo(seller)

    await seller.goto('/post')
    await expect(seller, 'seller session must not bounce to sign-in').not.toHaveURL(/\/signin/)

    // Photos — 3 visually-distinct fixtures (the wizard + server require ≥3 different-angle shots).
    await seller.locator('input[type="file"][accept*="image"]').setInputFiles([
      'e2e/fixtures/item-1.jpg',
      'e2e/fixtures/item-2.jpg',
      'e2e/fixtures/item-3.jpg',
    ])
    // Wait until all three previews mount (each carries a "Remove photo" control).
    await expect(seller.getByRole('button', { name: /Remove photo|Xóa ảnh/i })).toHaveCount(3, { timeout: 20_000 })

    // Category — pick one with no extra required facets so the flow stays deterministic.
    await seller.getByRole('group', { name: /^Category|Danh mục/i }).getByRole('button', { name: /^(Community|Cộng đồng)/i }).click()

    // Title / description / price.
    await seller.locator('#pw-title').fill(TITLE)
    await seller.getByPlaceholder(/Describe it in detail|Mô tả chi tiết/i).fill(DESCRIPTION)
    await seller.locator('#pw-price-input').fill(PRICE)

    // Location — mocked geolocation fills province/ward in one tap.
    await seller.getByRole('button', { name: /Use my current location|Dùng vị trí hiện tại/i }).click()
    await expect(seller.getByRole('button', { name: /Hoàn Kiếm|Hoan Kiem|Hà Nội|Hanoi/i })).toBeVisible({ timeout: 10_000 })

    // Publish — the create POST fires after the photo uploads; wait for the listing to be created.
    const createRes = seller.waitForResponse((r) => r.url().endsWith('/api/listings') && r.request().method() === 'POST', { timeout: 60_000 })
    await seller.getByRole('button', { name: /Publish listing|Đăng tin/i }).click()
    const res = await createRes
    const status = res.status()
    expect(status, `create should return 201`).toBe(201)

    // The new id comes straight from the create response (the canonical source), then we assert the
    // celebratory success screen actually rendered.
    const created = (await res.json().catch(() => ({}))) as { id?: string; verified?: boolean }
    listingId = created.id || ''
    expect(listingId, 'create response must carry the new listing id').toBeTruthy()
    listingPath = `/listings/${listingId}`
    await expect(seller.getByRole('heading', { name: /listing is live|đã được đăng/i })).toBeVisible({ timeout: 15_000 })

    // Confirm it's genuinely live (published instantly for a standard account).
    await seller.goto(listingPath)
    await expect(seller.getByRole('heading', { name: TITLE })).toBeVisible()
  })

  test('Phase 2 · buyer discovers it by searching the exact title', async () => {
    await buyer.goto('/')
    const box = buyer.getByPlaceholder(/Search motorbikes/i)
    await box.fill(TITLE)
    await box.press('Enter')

    // The freshly-published item resolves in the results view. The card exposes its title as an
    // <h3> heading (the card root is a role=button, and the facet chip echoes the query — the
    // heading is the one unambiguous handle). Clicking it opens the PDP.
    const titleRe = new RegExp(TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const card = buyer.getByRole('heading', { name: titleRe })
    await expect(card.first()).toBeVisible({ timeout: 15_000 })
    await card.first().click()

    await expect(buyer).toHaveURL(new RegExp(`/listings/${listingId}`))
    await expect(buyer.getByRole('heading', { name: TITLE })).toBeVisible()
    // Price matches what was posted (250,000 — locale-formatted with a dot or comma grouping).
    await expect(buyer.getByText(/250[.,]000/).first()).toBeVisible()
    // The posted photo actually rendered (broken-image guard). Ignore the tiny 64px blur-fill
    // backdrop (aria-hidden) — assert a REAL cover (naturalWidth > 200) finished decoding.
    await expect
      .poll(() => buyer.locator('main img').evaluateAll((imgs) => imgs.some((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 200)), { timeout: 10_000 })
      .toBe(true)
  })

  test('Phase 3 · buyer opens a chat with the seller from the PDP', async () => {
    // "Chat now" sends the canned opener and drops the buyer straight into the thread.
    const msgPost = buyer.waitForResponse((r) => /\/api\/(conversations|messages)/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 })
    await buyer.getByRole('button', { name: /^(Chat now|Chat ngay)$/ }).first().click()
    const res = await msgPost
    expect(res.ok(), `message send failed: ${res.status()}`).toBeTruthy()

    await expect(buyer).toHaveURL(/\/messages\//, { timeout: 15_000 })
    await expect(buyer.getByText(OPENER).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Phase 4 · seller sees the message and marks the item Sold', async () => {
    // Inbox — the buyer's thread (its opener, referencing THIS listing) is visible.
    await seller.goto('/messages')
    await expect(seller.getByText(OPENER).or(seller.getByText(TITLE)).first()).toBeVisible({ timeout: 15_000 })

    // Dashboard listings — scope to THIS listing's row (unique title) and mark it Sold. The UI flips
    // optimistically, so wait for the status POST to actually land.
    await seller.goto('/dashboard/listings')
    const row = seller.locator('div', { has: seller.getByText(TITLE) }).filter({ has: seller.getByRole('button', { name: /Mark sold|Đã bán/i }) }).last()
    await expect(row).toBeVisible({ timeout: 10_000 })

    const statusPost = seller.waitForResponse((r) => /\/api\/listings\/[^/]+\/status/.test(r.url()) && r.request().method() === 'POST')
    await row.getByRole('button', { name: /^(Mark sold|Đã bán)$/ }).click()
    await statusPost

    // Sold → the row now offers Relist instead of Mark sold.
    await expect(row.getByRole('button', { name: /^(Relist|Đăng lại)$/ })).toBeVisible({ timeout: 10_000 })
  })
})
