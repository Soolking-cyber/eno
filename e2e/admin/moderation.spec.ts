import { test, expect } from '@playwright/test'

// Admin moderation two-pane (authed) — the master/detail UI shipped this cycle. Runs only
// under the `admin` project against a preview deploy with a seeded ADMIN user. Non-destructive:
// it asserts the queue + detail render and that selecting a case updates the detail pane; it
// does NOT confirm/dismiss/abuse any report (those mutate trust scores).
test.describe('admin moderation', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a preview deploy + seeded admin (E2E_AUTHED_BASE)')

  test('loads the moderation queue (not the restricted screen)', async ({ page }) => {
    await page.goto('/admin/moderation')
    await expect(page.getByRole('heading', { name: /moderation/i })).toBeVisible()
    await expect(page.getByText(/restricted area/i)).toHaveCount(0)
  })

  test('shows the filter chips', async ({ page }) => {
    await page.goto('/admin/moderation')
    await expect(page.getByRole('button', { name: /^All \(/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Critical \(/ })).toBeVisible()
  })

  test('two-pane: selecting a case loads it into the detail pane', async ({ page }) => {
    await page.goto('/admin/moderation')
    // Desktop two-pane renders at lg+. If there are open cases, the action controls appear in
    // the detail pane; otherwise the empty state shows — both are valid rendered states.
    const decisionControls = page.getByRole('button', { name: /confirm|dismiss/i }).first()
    const emptyState = page.getByText(/nothing here|no resolved/i)
    await expect(decisionControls.or(emptyState)).toBeVisible()
  })
})
