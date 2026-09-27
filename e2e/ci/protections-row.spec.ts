import type { Page } from '@playwright/test'
// `test` from helpers seeds the privacy-preserving cookie-consent choice before navigation, so the
// first-visit consent dialog neither covers the row nor answers to getByRole('dialog').
import { test, expect } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// THE LISTING PAGE'S REPORTS-AND-DISPUTES ROW (SEO wave B, P0 / copy sheet CS-0).
//
// The row used to read "ENO protects you — disputes handled in 72h · listings screened", and the
// dialog behind it promised screening before publication. None of it was true: 72 hours is only the
// evidence window, nothing bounds the decision, and listings publish the moment the automatic
// checks pass. This spec holds the replacement to two things a copy edit could quietly undo:
//  1. the row is still there on an ordinary eno listing — exactly once, found by its attribute, so
//     the partner-listing check in e2e/guest/listing.spec.ts (count 0) is not vacuous;
//  2. neither the row nor the dialog it opens makes a protection, guarantee or screening claim, or
//     names a deadline, in either language.
//
// ⛔ Fixture-backed like the rest of e2e/ci: `ci-l-1` is a plain electronics listing with no
// `affiliateUrl` (scripts/ci-fixtures.ts). Never point E2E_CI_BASE at production.
// ─────────────────────────────────────────────────────────────────────────────

/** Claims the row may not make. The same list src/components/marketplace/protections-row.test.ts
 *  applies to the component's source strings; this one applies it to what actually rendered. */
const FORBIDDEN = /protect|guarantee|screened|reviewed before|bảo vệ|đảm bảo|kiểm duyệt/i
/** No deadline until the owner reconciles the Regulations with the code (plan decision P0-a). The same
 *  pattern as protections-row.test.ts: a bare `\b72\b` misses "72h", the very string this replaced. */
const DEADLINE = /\b72\s*h?\b|working days?|ngày làm việc/i

async function openRow(page: Page) {
  await page.goto('/listings/ci-l-1')
  // The row is server-rendered, so it can be counted as soon as the page is there.
  await expect(page.getByRole('button', { name: /^(Report|Báo cáo)$/ })).toBeVisible({ timeout: 15_000 })
  const row = page.locator('[data-protections-row]')
  await expect(row).toHaveCount(1)
  return row
}

for (const [locale, label, title] of [
  ['en-US', 'Reports & disputes', 'How reports and disputes work'],
  ['vi-VN', 'Báo cáo & khiếu nại', 'Cách xử lý báo cáo và khiếu nại'],
] as const) {
  test.describe(`reports-and-disputes row (${locale})`, () => {
    test.use({ locale })

    test('renders once on an ordinary listing and makes no protection claim', async ({ page }) => {
      const row = await openRow(page)
      const text = (await row.innerText()).trim()
      expect(text).toContain(label)
      expect(text).not.toMatch(FORBIDDEN)
      expect(text).not.toMatch(DEADLINE)
    })

    test('its dialog makes no protection claim and names no deadline', async ({ page }) => {
      const row = await openRow(page)
      // ⚠️ SERVER-RENDERED IS NOT HYDRATED: the row is visible before React attaches its handler,
      // and a click in that window is swallowed (measured on a production build at 4× CPU). So
      // click until the dialog opens rather than clicking once. Found by its NAME, because the
      // page can hold other dialogs.
      const dialog = page.getByRole('dialog', { name: title })
      // Each click is bounded and skipped once the dialog is up: a click on the row while the dialog's
      // backdrop covers it would otherwise wait out the whole test timeout.
      await expect(async () => {
        if (!(await dialog.isVisible())) await row.click({ timeout: 2_000 })
        await expect(dialog).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      const text = await dialog.innerText()
      expect(text).not.toMatch(FORBIDDEN)
      expect(text).not.toMatch(DEADLINE)
      // Both of its links go somewhere real: the safety guide and the Regulations' complaints article.
      await expect(dialog.locator('a[href="/safety"]')).toHaveCount(1)
      await expect(dialog.locator('a[href="/regulations#complaints"]')).toHaveCount(1)
    })
  })
}
