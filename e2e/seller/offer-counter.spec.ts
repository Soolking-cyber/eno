import { test, expect } from '@playwright/test'

// Authed regression for the chat "Counter" bug (money-adjacent). Seeded fixture (scripts/e2e-seed.mjs):
// a negotiable, priced listing + a conversation with ONE pending offer of 4,500,000 from the buyer.
// The seller opens it and taps Counter. Before the fix, a priced listing showed the −% slider (not
// the seeded number) and Send fired "% off asking", discarding the counter amount.
const CONV_ID = 'e2e-conv-1' // fixed id from scripts/e2e-seed.mjs
const OFFER = '4,500,000'

test.describe('seller · chat Counter offer', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires standalone server + seeded offer fixture (E2E_AUTHED_BASE)')

  test('Counter opens the exact-amount field seeded with the offer, not the % slider', async ({ page }) => {
    await page.goto(`/messages/${CONV_ID}`)
    await expect(page).not.toHaveURL(/\/signin/)

    // The buyer's pending offer shows Accept / Decline / Counter to the seller.
    const counter = page.getByRole('button', { name: /^(Counter|Trả giá)$/ })
    await expect(counter).toBeVisible({ timeout: 10000 })
    await counter.click()

    // counterMode forces the EXACT-amount text field, seeded with the offer being countered.
    const input = page.getByRole('textbox', { name: /Offer amount|Số tiền đề nghị/i })
    await expect(input).toBeVisible()
    await expect(input).toHaveValue(OFFER)
  })
})
