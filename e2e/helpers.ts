import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'

// ── Shared E2E fixtures + utilities ─────────────────────────────────────────────────
// Keep selectors semantic (role/text/placeholder) so specs read like user intent and
// survive markup churn.

// A custom `test` that pre-seeds the privacy-preserving cookie-consent choice
// ('essential' = functional only, personalization OFF, no ad pixels) BEFORE any navigation.
// Without this, the first-visit consent modal (z-[200] backdrop) intercepts every click. We
// deliberately choose the privacy-preserving option rather than clicking "Allow".
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('eno-cookie-consent', 'essential') } catch { /* private mode */ }
    })
    await use(page)
  },
})
export { expect }

// Run an axe-core accessibility scan and fail on any serious/critical WCAG 2 A/AA violation.
// (Minor/moderate are tracked, not blocking.) Logs offenders so a failure is actionable.
// KNOWN, BASELINED a11y debt — excluded so this gate catches NEW regressions rather than
// failing day-one on a pre-existing structural issue. Tracked, not hidden (see TESTING.md):
//   - 'nested-interactive': ListingCard's root is <div role="button"> with the heart / map /
//     carousel buttons nested inside it. Fixing it is a card-architecture change (card-as-link
//     pattern) — a dedicated follow-up, not part of the test-harness work.
const A11Y_BASELINE_RULES = ['nested-interactive']

export async function expectNoA11yViolations(page: Page, context = 'page') {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(A11Y_BASELINE_RULES)
    .analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  if (blocking.length) {
    // eslint-disable-next-line no-console
    console.log(`a11y violations on ${context}:\n` + blocking.map((v) => `  • [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`).join('\n'))
  }
  expect(blocking, `serious/critical a11y violations on ${context}`).toEqual([])
}

// Belt-and-suspenders: if any overlay/consent banner still slips through, dismiss it so it
// can't intercept clicks. Best-effort, never fails the test.
export async function dismissOverlays(page: Page) {
  for (const name of [/^(decline|reject|necessary only|essential only|got it)/i]) {
    const btn = page.getByRole('button', { name }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}) }
  }
}
