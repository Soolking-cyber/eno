import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

/**
 * Stop editing on a saved trip — REACHABILITY FIRST.
 *
 * ⚠️ WHY THIS FILE EXISTS. T316 shipped reorder/swap/delete for stops with compare-and-set,
 * ownership checks and 13 passing unit tests — and nothing in the UI ever called it. The owner
 * found it by looking at the page and asking "how do we edit here activities we want to swap"
 * (2026-07-26). Every one of those unit tests still passed while the feature was unusable, so the
 * assertion that matters is not "the endpoint edits a stop" but "a traveller can get from
 * /dashboard/trips to a changed itinerary by clicking", which is what this proves.
 *
 * ⚠️ THE ROW NOW OFFERS TWO CONTROLS, NOT FIVE (owner, 2026-07-27). Reorder and swap were built,
 * shipped, covered here — and then cut, because five controls on one row was the wrong answer to
 * "let me edit this". The endpoint still accepts those actions; nothing in this file may imply a
 * traveller can reach them, and the two-control count is asserted rather than assumed.
 *
 * Depends on the fixture created by the seed step: an itinerary titled "E2E Editable Plan" owned by
 * the buyer, one day, three stops named FIRST/SECOND/THIRD STOP in that order.
 */

const PLAN = 'E2E Editable Plan'

// ⚠️ SERIAL, because these tests share ONE fixture day. The config runs fullyParallel, and when
// reorder, swap and replace all lived here they mutated the same three stops on separate workers:
// each read its own "before" state, another's write landed in between, and the suite went flaky
// against itself rather than against any real defect. Only one test still writes, so this is now
// insurance rather than a live fix — kept because the next test added here will need it, and
// because rediscovering that race is expensive.
test.describe.configure({ mode: 'serial' })

/** The stop names in the order the page currently shows them. */
async function order(page: import('@playwright/test').Page): Promise<string[]> {
  const rows = page.locator('[data-stop-id]')
  await expect(rows.first()).toBeVisible()
  const names = await rows.locator('p.font-semibold').allInnerTexts()
  return names.map((n) => n.trim()).filter(Boolean)
}

// ⚠️ THE REORDER AND SWAP TESTS WERE DELETED HERE ON 2026-07-27, WITH THE UI THEY COVERED.
// The owner cut the move-earlier / move-later / swap controls ("only 2 buttons suggest new activity
// and delete — buttons up down swap we dont need"), so a test driving them would be asserting a
// surface that no longer exists. They are in git history if the controls ever come back; the server
// still accepts `reorder` and `swap`, which is exactly why NO test here pretends a traveller can
// reach them. The door those tests also proved — /dashboard/trips → "Open & edit" → a real write —
// is still proved below, by the replace flow.
test('a rejected activity can be REPLACED, and the map follows', async ({ page }) => {
  // ⚠️ THE REACHABILITY GATE FOR T323, and the same lesson the deleted tests taught: the owner's
  // complaint was not that removal was broken but that it left a hole — "when I edit itinerary it
  // deletes but doesn't suggest something else instead". A route with 32 unit tests that no button
  // reaches would satisfy every one of those tests and none of the complaint.
  //
  // ⚠️ THE MODEL CALL IS STUBBED; THE WRITE IS NOT. /stops/suggest is intercepted so the test is
  // deterministic and costs nothing — what it proves is the path either side of the model: the
  // dialog opens from the row, a suggestion becomes a real POST to the real stops endpoint, the
  // real database row changes, and the map re-derives from it. The route's own behaviour (guards,
  // lifetime cap, stripping, dedup) is unit-tested; none of that is what this file is for.
  // ⚠️ UNIQUE PER RUN, AND THAT IS NOT TIDINESS — it is what makes this suite runnable twice.
  // A fixed name looked fine and passed, because it was always read straight after a reseed. But
  // this test WRITES A NAME, and a name persists in a way a
  // reordering never did. Run the suite a second time without reseeding and the day holds two stops
  // called "REPLACEMENT STOP", so `not.toContain(doomed)` fails against the copy it just created.
  // Found at the ship gate on 2026-07-27 by running the suite twice back to back, which is now how
  // it is verified.
  const RUN_ID = `${Date.now().toString(36).slice(-5)}`
  const NEW_NAME = `REPLACEMENT STOP ${RUN_ID}`
  const NEW_PLACE = 'Hanoi Opera House'
  await page.route('**/stops/suggest', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        remaining: 11,
        suggestions: [{
          name: NEW_NAME,
          place: NEW_PLACE,
          time: '15:00',
          details: 'A short guided visit.',
          travelMinutes: 12,
          estimatedCostVnd: 120_000,
          bookingAdvice: 'Book the day before.',
          // A real Hanoi coordinate, materially away from the fixture's three, so "the map
          // followed" is a claim about this stop and not about a redraw that happened anyway.
          lat: 21.0245,
          lng: 105.8572,
          mapped: true,
        }],
      }),
    }))

  await page.goto('/dashboard/trips')
  const row = page.getByRole('button', { name: new RegExp(PLAN, 'i') })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  await page.getByRole('link', { name: /open & edit|mở & chỉnh sửa/i }).click()
  await expect(page).toHaveURL(/\/dashboard\/trips\/[^/]+$/)

  const before = await order(page)
  expect(before.length, 'fixture should render three stops').toBeGreaterThanOrEqual(3)
  const doomed = before[before.length - 1] // the last row, so the earlier tests' fixtures are untouched

  // 1 ── THE DOOR: the suggest control, which opens the flow rather than touching the itinerary.
  const doomedRow = page.locator('[data-stop-id]').last()
  await doomedRow.getByRole('button', { name: /suggest a new activity|gợi ý hoạt động mới/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // 2 ── REMOVING OUTRIGHT MUST STILL BE ONE TAP FROM HERE. Asserted, not assumed: this flow adds a
  // path and must never become the only one.
  await expect(dialog.getByRole('button', { name: /just remove it|chỉ cần xóa/i })).toBeVisible()

  // 3 ── THE ASK: a reason chip, a preference, and the suggestion request.
  await dialog.getByRole('button', { name: /too expensive|quá đắt/i }).click()
  await dialog.getByRole('textbox').fill('somewhere quieter')
  await dialog.getByRole('button', { name: /suggest replacements|gợi ý thay thế/i }).click()

  // 4 ── THE CHOICE, and only then a write.
  await expect(dialog.getByText(NEW_NAME)).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: /use this one|chọn cái này/i }).click()

  // 5 ── THE PROOF, part one: the row really changed, via a refetch of the real database.
  //
  // ⚠️ MEMBERSHIP, NOT SUBSTRING. Joining the names and asking `toContain` reads the same and is
  // not: one stop's name being a PREFIX of another's makes the join say yes to a row that is gone.
  // That is not hypothetical — it is what failed here on 2026-07-27, when a fixture left over from
  // the fixed-name version of this test made `doomed` ("REPLACEMENT STOP") a substring of the
  // suffixed name that replaced it, and the test failed against the row it had just written.
  await expect.poll(async () => await order(page), { timeout: 20_000 }).toContain(NEW_NAME)
  expect(await order(page), 'the rejected activity is gone, not merely pushed down')
    .not.toContain(doomed)

  // 6 ── THE PROOF, part two: THE MAP FOLLOWED. Selecting the row opens that stop's popup on the
  // map, so a popup naming the replacement is the map asserting it re-derived from the new row —
  // not the list re-rendering on its own.
  await page.locator(`[data-stop-id]`).filter({ hasText: NEW_NAME }).first().click()
  await expect(page.locator('.leaflet-popup')).toContainText(NEW_PLACE, { timeout: 20_000 })
})

test('a stop row offers EXACTLY two controls — suggest and delete', async ({ page }) => {
  // ⚠️ THIS IS THE OWNER'S REQUIREMENT AS AN ASSERTION, not a style note: "make sure there are only
  // 2 buttons suggest new activity and delete — buttons up down swap we dont need" (2026-07-27).
  //
  // It is pinned by COUNT as well as by name, because the failure mode being guarded against is
  // ADDITION. The server still accepts `reorder` and `swap`, so the tempting mistake is to notice an
  // unused action and helpfully wire a button back up; naming the three that are gone would not
  // catch a fourth control arriving. Counting does.
  await page.goto('/dashboard/trips')
  const row = page.getByRole('button', { name: new RegExp(PLAN, 'i') })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  await page.getByRole('link', { name: /open & edit|mở & chỉnh sửa/i }).click()
  await expect(page).toHaveURL(/\/dashboard\/trips\/[^/]+$/)

  const stopRow = page.locator('[data-stop-id]').first()
  await expect(stopRow).toBeVisible()
  // The row itself is a button when the map sits beside the list, so scope to the control cluster.
  const controls = stopRow.locator('div').filter({ has: page.getByRole('button', { name: /suggest a new activity|gợi ý hoạt động mới/i }) }).last()
  await expect(controls.getByRole('button')).toHaveCount(2)
  await expect(controls.getByRole('button', { name: /suggest a new activity|gợi ý hoạt động mới/i })).toHaveCount(1)
  await expect(controls.getByRole('button', { name: /delete this activity|xóa hoạt động này/i })).toHaveCount(1)
  // The three that were deliberately removed, by the labels they used to carry.
  await expect(stopRow.getByRole('button', { name: /move earlier in the day|chuyển lên sớm hơn/i })).toHaveCount(0)
  await expect(stopRow.getByRole('button', { name: /move later in the day|chuyển xuống muộn hơn/i })).toHaveCount(0)
  await expect(stopRow.getByRole('combobox', { name: /swap this activity|đổi chỗ hoạt động/i })).toHaveCount(0)
})

test('the edit controls are absent for a stop nobody owns', async ({ page }) => {
  // The counterpart to the reachability test: reachable must not mean open. A trip id that is not
  // this traveller's must not render an editable plan — the API answers 404/403 either way, but the
  // page must not present controls that imply otherwise.
  await page.goto('/dashboard/trips/00000000-0000-0000-0000-000000000000')
  await expect(page.getByRole('button', { name: /move later in the day|chuyển xuống muộn hơn/i }))
    .toHaveCount(0)
})

test('an itinerary thread offers its OWN chips, and an ordinary listing thread does not', async ({ page, request }) => {
  // ⚠️ THE THREAD IS CREATED THROUGH THE REAL PATH, not seeded. These chips are gated server-side by
  // `tripWizardEligibility` → `threadHostsWizard` → `threadKind(convo) === 'itinerary'`, and that
  // predicate keys on the thread's ANCHOR LISTING. A hand-inserted fixture row could satisfy this
  // assertion while the real create path anchored the thread somewhere else, which is exactly the
  // class of bug the gate exists for: the trip wizard once leaked into e-Visa threads because the
  // discriminator was the SELLER, and visa and trips share one storefront.
  //
  // ⚠️ NO test.skip ANYWHERE IN HERE. The anchor is read from the app's own /dashboard/trips payload
  // (the same value the "Plan a trip in chat" button uses), and if it is missing this test FAILS.
  // A skip would be the fail-open pattern: a desk with no anchor means the in-chat planner is
  // unreachable in that environment, which is a result worth going red over, not stepping around.
  const trips = await (await request.get('/dashboard/trips')).text()
  const anchor = trips.match(/planListingId\\?":\\?"([0-9a-f-]{36})/)?.[1]
  expect(anchor, 'the trip desk must expose an anchor listing on /dashboard/trips').toBeTruthy()

  const created = await request.post('/api/conversations', { data: { listingId: anchor } })
  expect(created.ok(), `opening the trip desk thread must not error (got ${created.status()})`).toBeTruthy()
  const { id: threadId } = (await created.json()) as { id: string }

  // ── the ITINERARY thread shows its own pair
  await page.goto(`/messages/${threadId}`)
  const savedTrips = page.getByRole('button', { name: /saved trips|chuyến đã lưu/i })
  await expect(savedTrips, 'an itinerary thread must offer the drafts picker').toBeVisible({ timeout: 20_000 })

  // ⚠️ AND NOT THE OTHER DESK'S — the assertion that would have caught the wizard leak.
  await expect(page.getByRole('button', { name: /send the form again|gửi lại biểu mẫu/i })).toHaveCount(0)

  // ── the picker lists the traveller's saved trips and opens one where it lives
  await savedTrips.click()
  const item = page.getByRole('menuitem', { name: new RegExp(PLAN, 'i') })
  await expect(item, 'the seeded plan must appear in the picker').toBeVisible({ timeout: 15_000 })
  await item.click()
  await expect(page).toHaveURL(/\/dashboard\/trips\/[^/]+$/)
  await expect(page.locator('[data-stop-id]').first()).toBeVisible({ timeout: 20_000 })

  // ── an ORDINARY listing thread gets neither
  const fixtures = JSON.parse(readFileSync('e2e/.auth/seed-fixtures.json', 'utf8')) as { conversationId: string }
  await page.goto(`/messages/${fixtures.conversationId}`)
  await expect(page.locator('.chat-composer')).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('button', { name: /saved trips|chuyến đã lưu/i }),
    'a plain listing thread must not show the trip desk chips',
  ).toHaveCount(0)
})
