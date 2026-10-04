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
  // Let async-loaded content settle first — maps and image skeletons render as low-contrast
  // `animate-pulse` placeholders that briefly fail contrast, so scanning too early flakes. We
  // wait for full load + the loading skeletons to clear (bounded), so axe snapshots REAL
  // content, not transient placeholders.
  await page.waitForLoadState('load').catch(() => {})
  await page.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(A11Y_BASELINE_RULES)
    .analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  if (blocking.length) {
    console.log(`a11y violations on ${context}:\n` + blocking.map((v) => `  • [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`).join('\n'))
  }
  expect(blocking, `serious/critical a11y violations on ${context}`).toEqual([])
}

// Belt-and-suspenders: if any overlay/consent banner still slips through, dismiss it so it
// can't intercept clicks. Best-effort, never fails the test.
export async function dismissOverlays(page: Page) {
  // "No thanks" is the consent bar's refusal since 2026-10-01c (named "No thanks — decline all").
  for (const name of [/^(decline|reject|no thanks|necessary only|essential only|got it)/i]) {
    const btn = page.getByRole('button', { name }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}) }
  }
}

/**
 * Which edition the target is EXPECTED to be — `marketplace` (eno.vn) or `services` (eno.forum).
 * ⛔ ON AN EDITION'S OWN DOMAIN THE ANSWER IS THE DOMAIN, NEVER THE BUNDLE (commit-gate review): a services
 * bundle misrouted onto eno.vn would answer /itinerary 200 and be re-labelled "services", and every spec
 * built on this would then hold eno.vn to eno.forum's expectations and pass. The configured base is the
 * one fact the deployment cannot author (home.spec.ts makes the same argument for its edition check).
 * A preview or staging host has no identity of its own, so there the BUNDLE is asked: `/itinerary` exists
 * only in the services bundle — home.spec.ts's discriminator (a reserved handle, so the status alone is
 * the signal). Anything but 200/404 there is a broken target, not an edition, and fails loudly.
 */
export async function expectedEdition(page: Page, baseURL: string | undefined): Promise<'marketplace' | 'services'> {
  if (!baseURL) throw new Error('no baseURL — the edition expectation cannot be trusted without one')
  const host = new URL(baseURL).hostname.replace(/^www\./, '')
  if (host === 'eno.vn') return 'marketplace'
  if (host === 'eno.forum') return 'services'
  // ⚠️ NO REDIRECTS HERE (unlike home.spec's probe on a real domain): a preview has no www→apex hop to
  // allow, and a marketplace preview whose /itinerary 308'd to eno.forum would otherwise land on a 200
  // and be re-labelled "services" (commit-gate review). A 3xx is reported as the broken target it is.
  const r = await page.request.get(`/itinerary?e2e=${Date.now()}`, { failOnStatusCode: false, maxRedirects: 0 })
  if (r.status() === 200) return 'services'
  if (r.status() === 404) return 'marketplace'
  throw new Error(`/itinerary answered ${r.status()} — cannot tell which edition this target serves`)
}

/**
 * ⛔ THE `/vi` PILOT (src/lib/lang-pinned.ts, switched on 2026-10-02, commit 1a6ac8926): on the
 * MARKETPLACE the plain `/` is English for everyone, whatever the `lang` cookie or Accept-Language says,
 * and `/vi` is its Vietnamese twin. eno.forum never pilots: its `/` negotiates and its `/vi` 404s.
 * ⚠️ THE EXPECTATION COMES FROM THE EDITION, NEVER FROM PROBING `/vi` — a marketplace whose `/vi` broke
 * would otherwise read as "pilot off" and pass. Withdrawing the pilot (VI_PREFIX_PATHS emptied, rollback
 * V-R) must update this line, and these specs will say so by failing.
 */
export const viPilotOn = (edition: 'marketplace' | 'services') => edition === 'marketplace'

/**
 * A page that NEGOTIATES its language on both editions (cookie, then Accept-Language — src/proxy.ts):
 * not piloted, not a pinned guide. The commit that switched the pilot on moved the deploy probe's
 * negotiation checks here for the same reason.
 */
export const ADAPTIVE_PAGE = '/privacy'

/** The `lang` of the SERVER's HTML — what the first response rendered, before any client swap or reload. */
export const serverHtmlLang = (html: string) => html.match(/<html[^>]*\slang="([^"]*)"/)?.[1] ?? null
