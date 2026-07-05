import { test, expect } from '@playwright/test'

// Business "Developers" panel (authed) — the API-key / webhook / MCP UI shipped this cycle.
// Runs only under the `seller` project against a preview deploy with a seeded BUSINESS user.
// Non-destructive: it opens forms and asserts sections render; it does NOT mint a real key or
// register a real webhook (those leave artifacts), so it's safe even on the preview branch.
test.describe('developers panel', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a preview deploy + seeded business user (E2E_AUTHED_BASE)')

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard?tab=dev')
    await expect(page).not.toHaveURL(/\/signin/)
  })

  test('renders API keys, Webhooks and MCP sections', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /api keys|khóa api/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /webhooks?/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /mcp server|máy chủ mcp/i })).toBeVisible()
  })

  test('opens the New API key form with scope toggles (without minting)', async ({ page }) => {
    await page.getByRole('button', { name: /new api key|khóa api mới/i }).click()
    await expect(page.getByText('listings:read')).toBeVisible()
    await expect(page.getByRole('button', { name: /create key|tạo khóa/i })).toBeVisible()
    // Back out — do not create.
    await page.getByRole('button', { name: /cancel|hủy/i }).click()
  })

  test('opens the Add webhook form (without registering)', async ({ page }) => {
    await page.getByRole('button', { name: /add webhook|thêm webhook/i }).first().click()
    await expect(page.getByText('listing.created')).toBeVisible()
    await page.getByRole('button', { name: /cancel|hủy/i }).click()
  })

  test('exposes the copyable MCP endpoint', async ({ page }) => {
    await expect(page.getByText('https://eno.vn/api/mcp').first()).toBeVisible()
  })
})
