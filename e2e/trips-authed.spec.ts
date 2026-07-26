import { test, expect } from '@playwright/test'

/**
 * Stop editing on a saved trip — REACHABILITY FIRST.
 *
 * ⚠️ WHY THIS FILE EXISTS. T316 shipped reorder/swap/delete for stops with compare-and-set,
 * ownership checks and 13 passing unit tests — and nothing in the UI ever called it. The owner
 * found it by looking at the page and asking "how do we edit here activities we want to swap"
 * (2026-07-26). Every one of those unit tests still passed while the feature was unusable, so the
 * assertion that matters is not "the endpoint reorders" but "a traveller can get from
 * /dashboard/trips to a changed order by clicking", which is what this proves.
 *
 * Depends on the fixture created by the seed step: an itinerary titled "E2E Editable Plan" owned by
 * the buyer, one day, three stops named FIRST/SECOND/THIRD STOP in that order.
 */

const PLAN = 'E2E Editable Plan'

// ⚠️ SERIAL, because these tests share ONE fixture day. The config runs fullyParallel, so the
// reorder test and the swap test were mutating the same three stops at the same time on two workers:
// each read its own "before" order, the other's write landed in between, and the swap case went
// flaky (failed, passed on retry). Nothing was wrong with the app — the suite was racing itself.
// Serial is the honest fix; giving each test its own itinerary fixture would be the other one.
test.describe.configure({ mode: 'serial' })

/** The stop names in the order the page currently shows them. */
async function order(page: import('@playwright/test').Page): Promise<string[]> {
  const rows = page.locator('[data-stop-id]')
  await expect(rows.first()).toBeVisible()
  const names = await rows.locator('p.font-semibold').allInnerTexts()
  return names.map((n) => n.trim()).filter(Boolean)
}

test('a saved plan is reachable from the list, and its stops can be reordered', async ({ page }) => {
  // 1 ── THE DOOR. Start where the traveller starts, not at a deep link: the defect was that the
  // list page never linked to the per-trip page at all.
  await page.goto('/dashboard/trips')
  const row = page.getByRole('button', { name: new RegExp(PLAN, 'i') })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()

  const open = page.getByRole('link', { name: /open & edit|mở & chỉnh sửa/i })
  await expect(open, 'the saved-trip row must offer a way into the per-trip page').toBeVisible()
  await open.click()
  await expect(page).toHaveURL(/\/dashboard\/trips\/[^/]+$/)

  // 2 ── THE STARTING ORDER, read from the page rather than assumed.
  const before = await order(page)
  expect(before.length, 'fixture should render three stops').toBeGreaterThanOrEqual(3)
  const first = before[0]
  const second = before[1]

  // 3 ── THE EDIT. Move the first stop later; the server owns the permutation.
  const firstRow = page.locator('[data-stop-id]').first()
  await firstRow.getByRole('button', { name: /move later in the day|chuyển xuống muộn hơn/i }).click()

  // 4 ── THE PROOF: the page re-read and the order actually changed. Polled, because the write is
  // followed by a refetch rather than an optimistic swap (deliberately — see trip-detail-client).
  await expect
    .poll(async () => (await order(page)).slice(0, 2).join(' | '), { timeout: 20_000 })
    .toBe(`${second} | ${first}`)
})

test('two NON-adjacent stops can be swapped, which move-up/down cannot express', async ({ page }) => {
  // ⚠️ SWAP WAS THE LAST OF THE THREE SERVER ACTIONS WITH NO CALLER, and it is the one the owner
  // asked for by name ("activities we want to swap"). It is not reducible to a reorder: moving the
  // first stop to the last index shifts the middle one up, whereas swapping first and last leaves
  // it exactly where it was. This test asserts precisely that difference, so a future "simplify" that
  // re-expresses swap as a move fails here.
  await page.goto('/dashboard/trips')
  const row = page.getByRole('button', { name: new RegExp(PLAN, 'i') })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  await page.getByRole('link', { name: /open & edit|mở & chỉnh sửa/i }).click()
  await expect(page).toHaveURL(/\/dashboard\/trips\/[^/]+$/)

  const before = await order(page)
  expect(before.length, 'fixture should render three stops').toBeGreaterThanOrEqual(3)
  const [first, middle, last] = before

  // Swap the FIRST stop with the LAST one, two rows apart.
  const firstRow = page.locator('[data-stop-id]').first()
  await firstRow.getByRole('combobox', { name: /swap this activity|đổi chỗ hoạt động/i }).click()
  await page.getByRole('option', { name: last }).click()

  // The middle stop must not have moved — that is what makes this a swap and not a reorder.
  await expect
    .poll(async () => (await order(page)).slice(0, 3).join(' | '), { timeout: 20_000 })
    .toBe(`${last} | ${middle} | ${first}`)
})

test('the edit controls are absent for a stop nobody owns', async ({ page }) => {
  // The counterpart to the reachability test: reachable must not mean open. A trip id that is not
  // this traveller's must not render an editable plan — the API answers 404/403 either way, but the
  // page must not present controls that imply otherwise.
  await page.goto('/dashboard/trips/00000000-0000-0000-0000-000000000000')
  await expect(page.getByRole('button', { name: /move later in the day|chuyển xuống muộn hơn/i }))
    .toHaveCount(0)
})
