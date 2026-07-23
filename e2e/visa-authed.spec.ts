import { test, expect, type APIResponse } from '@playwright/test'
import { existsSync } from 'node:fs'

// ── The e-Visa APPLICANT story — the in-chat flow eno.vn owns end to end ────────────
//
// The visa-ownership follow-up ("port apps/forum/e2e/visa.spec.ts — eno.vn has NO visa
// e2e") cannot be a literal port: the forum spec exercised the retired WIZARD, and half
// its cases were unit tests in playwright clothing (image normalization, MRZ check
// digits, schema validation) that live in vitest here. What eno.vn actually lacked is
// coverage of ITS OWN applicant surface — the Phase-2 chat flow and the Phase-3
// management tab — as a real signed-in applicant. This is that, run SERIALLY as one
// story with the BUYER role (the applicant), against the standalone server + the real
// visa desk catalogue in the database.
//
//   Phase 0  Clean slate: any case a previous run left is deleted through the same
//            owner-scoped DELETE the dashboard uses.
//   Phase 1  /dashboard/visa shows the management empty state (no product rows — the
//            picker was removed from this page on owner instruction, Phase 3), and its
//            one CTA starts a GENERIC case straight into the thread.
//   Phase 2  The thread greets the applicant with the STEP-0 PICKER card (no products
//            in the message — the card fetches the live catalogue); choosing a service
//            posts the canonical selection and the step-1 card replaces the picker.
//   Phase 3  /dashboard/visa now MANAGES the case: a row with its reference/status and
//            the way back into the thread.
//   Phase 4  Entitlements from the applicant's own seat: admin surfaces refuse, a
//            foreign case id does not exist.
//   Cleanup  The case is deleted through the applicant's own erasure control — a re-run
//            starts clean even if scripts/e2e-cleanup.mjs never runs.
//
// ⚠️ NO uploads on purpose: a passport/portrait POST would spend real AI extraction
// budget and write real storage objects on every run. The story stops at the step-1
// card being LIVE — everything past it (extraction, checkout, capture) is pinned by the
// vitest suites (dm-flow/dm-steps/checkout/payments, 743 tests).
//
// ⚠️ RATE BUDGETS this story spends per run, on the e2e buyer only: visa-create (5/24h)
// ×1, visa-dm-start (30/1h) ×1, visa-delete (10/24h) ≤2, visa-select-product (30/1h)
// ×1. More than ~5 full runs in a day trips visa-create by design — the suite is a
// nightly/per-ship gate, not a watch loop.

const AUTH_DIR = 'e2e/.auth'
const HAVE_SESSION = existsSync(`${AUTH_DIR}/buyer.json`)

/** The applicant's own case list, via the same cookie session the pages use. */
async function listCases(request: { get: (url: string) => Promise<APIResponse> }): Promise<string[]> {
  const res = await request.get('/api/visa/applications')
  if (!res.ok()) return []
  const body = (await res.json()) as { applications?: Array<{ id?: string }> }
  return (body.applications ?? []).map((a) => a.id).filter((id): id is string => !!id)
}

test.describe.serial('e-Visa applicant · generic start → picker in chat → managed on the dashboard', () => {
  test.skip(!process.env.E2E_AUTHED_BASE || !HAVE_SESSION, 'requires the standalone server + seeded buyer session (E2E_AUTHED_BASE, E2E_BUYER_EMAIL)')
  // Stateful create flow: a retry would re-enter mid-story (the draft already exists,
  // the picker already answered) and fail on a different assert than the original.
  test.describe.configure({ retries: 0 })

  test('phase 0-1 · the management tab is picker-free and its CTA opens the thread', async ({ page }) => {
    // Clean slate — a crashed earlier run may have left a case behind.
    for (const id of await listCases(page.request)) {
      await page.request.delete(`/api/visa/applications/${id}`)
    }

    await page.goto('/dashboard/visa')
    // The Phase-3 contract: NO product rows on this page (no VND prices, no speed-tier
    // buttons) — the empty state's ONE affordance is the chat start.
    const start = page.getByRole('button', { name: /Start an e-Visa in chat|Bắt đầu e-Visa qua chat/ })
    await expect(start).toBeVisible()
    await expect(page.getByText(/Single entry|Multiple entry|Nhập cảnh một lần/)).toHaveCount(0)

    // One tap → a generic (product-less) case, bound thread, straight into the chat.
    await start.click()
    await page.waitForURL(/\/messages\//, { timeout: 20_000 })
  })

  test('phase 2 · the step-0 picker asks in the thread; choosing flips it to step 1', async ({ page }) => {
    const ids = await listCases(page.request)
    expect(ids, 'phase 1 created exactly one case').toHaveLength(1)

    // Back into the bound thread through the dashboard's own row. The affordance is a
    // LINK when the server-side thread map resolved, and the generic-start BUTTON when
    // that SSR read saw a stale session (a supabase token-refresh race under rapid
    // navigation — observed in this suite's own runs). BOTH are the product's designed
    // behavior and BOTH land in the same thread (the button resumes the newest editable
    // draft), so the story accepts either.
    await page.goto('/dashboard/visa')
    await page
      .getByRole('link', { name: /Continue in chat|Tiếp tục trong chat/ })
      .or(page.getByRole('button', { name: /Continue in chat|Tiếp tục trong chat/ }))
      .first()
      .click()
    await page.waitForURL(/\/messages\//, { timeout: 20_000 })

    // The picker card is the LIVE prompt: its heading plus the fetched catalogue rows
    // (entry-type badges prove live products, not metaJson snapshots).
    await expect(page.getByText(/Choose your e-Visa service|Chọn dịch vụ e-Visa/).first()).toBeVisible({ timeout: 15_000 })
    const productRow = page.getByRole('button').filter({ hasText: /Single entry|Multiple entry|Nhập cảnh/ }).first()
    await expect(productRow).toBeVisible({ timeout: 15_000 })

    // Choose → the canonical selection lands server-side and the next card posts in the
    // same round-trip (select-product chains the advance).
    const selected = page.waitForResponse((r) => r.url().includes('/select-product') && r.ok())
    await productRow.click()
    await selected

    // The step-1 card is now the live prompt (CardShell's step badge is the stable hook).
    await expect(page.getByText(/Step 1 of 5|Bước 1\/5/).first()).toBeVisible({ timeout: 15_000 })
  })

  test('phase 3 · the dashboard manages the case: reference, status, way back in', async ({ page }) => {
    await page.goto('/dashboard/visa')
    // The row: a draft chip + the thread link. (The EV-#### reference is minted later in
    // the case's life, so the row may carry the id stub — assert the chip instead.)
    await expect(page.getByText(/Draft|Bản nháp/).first()).toBeVisible()
    await expect(
      page
        .getByRole('link', { name: /Continue in chat|Tiếp tục trong chat/ })
        .or(page.getByRole('button', { name: /Continue in chat|Tiếp tục trong chat/ }))
        .first(),
    ).toBeVisible()
    // Still no product rows: management stayed management after the case exists.
    await expect(page.getByText(/Single entry|Multiple entry|Nhập cảnh một lần/)).toHaveCount(0)
  })

  test('phase 4 · applicant entitlements: admin surfaces refuse, foreign cases do not exist', async ({ page }) => {
    const bundle = await page.request.get('/api/visa/admin/applications/00000000-0000-0000-0000-000000000000/bundle')
    expect([401, 403]).toContain(bundle.status())
    const foreign = await page.request.post('/api/visa/applications/00000000-0000-0000-0000-000000000000/advance')
    expect(foreign.status()).toBe(404)
  })

  test('cleanup · the applicant erases their own case; the tab returns to the empty state', async ({ page }) => {
    const ids = await listCases(page.request)
    for (const id of ids) {
      const res = await page.request.delete(`/api/visa/applications/${id}`)
      expect(res.ok(), `delete ${id}`).toBe(true)
    }
    await page.goto('/dashboard/visa')
    await expect(page.getByRole('button', { name: /Start an e-Visa in chat|Bắt đầu e-Visa qua chat/ })).toBeVisible()
  })
})
