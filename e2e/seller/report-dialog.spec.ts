import { test, expect } from '@playwright/test'

// Authed report flow, from the seeded conversation (no public listing needed). NON-DESTRUCTIVE: it
// opens the dialog and proves the reason gate wires the submit button, but never files a report
// (same convention as the admin/developers specs — they never mint/confirm either).
const CONV_ID = 'e2e-conv-1'

test.describe('seller · report a conversation', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires standalone server + seeded conversation (E2E_AUTHED_BASE)')

  test('report dialog gates Submit until a reason is chosen', async ({ page }) => {
    await page.goto(`/messages/${CONV_ID}`)
    await expect(page).not.toHaveURL(/\/signin/)

    await page.getByRole('button', { name: /^(Report|Báo cáo)$/ }).first().click()
    const dialog = page.getByRole('dialog', { name: /Report this conversation|Báo cáo cuộc trò chuyện/i })
    await expect(dialog).toBeVisible()

    const submit = dialog.getByRole('button', { name: /Submit report|Gửi báo cáo/i })
    await expect(submit).toBeDisabled()

    await dialog.getByRole('radio', { name: /Scam|Lừa đảo/i }).check()
    await expect(submit).toBeEnabled()

    // Non-destructive — dismiss without filing.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
