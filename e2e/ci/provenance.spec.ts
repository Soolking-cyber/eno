// `test` from helpers seeds the privacy-preserving cookie-consent choice before navigation, so the
// first-visit consent dialog covers nothing.
import { test, expect } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// THE PROVENANCE LINE ON AN IMPORTED LISTING (SEO wave B, P1 / P2; copy sheet CS-2).
//
// An imported rental is a reference to someone else's ad. The listing page says so in one line under
// the CTA: the source's name, the date that is true for that source, and a link to the original ad.
// The unit tests cover the wording and which rows qualify; this reads the built page, so the wiring
// is held too:
//  1. `ci-l-import` (a Chợ Tốt Nhà rental) shows the line once, naming the storefront, with a <time>;
//  2. the line vouches for nothing: no verified / checked / protected / trusted / partner wording, in
//     either language;
//  3. its link goes to the same host as the CTA — which stays the page's only [data-affiliate-cta] —
//     with the CTA's rel, in a new tab;
//  4. an own listing (`ci-l-1`) has no line.
//
// ⛔ Fixture-backed like the rest of e2e/ci (scripts/ci-fixtures.ts). Never point E2E_CI_BASE at
// production — this spec never needs to: the fixture row is the case.
// ─────────────────────────────────────────────────────────────────────────────

const IMPORTED = '/listings/ci-l-import'
const OWN = '/listings/ci-l-1'
const LINE = '[data-import-provenance]'
/** Words that would vouch for a source eno never vetted. The unit test holds the same list on the copy. */
const VOUCHING = /verif|check|protect|trust|partner|official|guarantee|xác minh|kiểm tra|bảo vệ|uy tín|tin cậy|đối tác|chính thức|đảm bảo|bảo đảm/i

for (const [locale, source, link] of [
  ['en-US', 'Source: Nhatot.com · posted there on ', 'original ad'],
  ['vi-VN', 'Nguồn: Nhatot.com · đăng ngày ', 'tin gốc'],
] as const) {
  test.describe(`provenance line (${locale})`, () => {
    test.use({ locale })

    test('an imported rental names its source and the source\'s date, and vouches for nothing', async ({ page }) => {
      await page.goto(IMPORTED)
      const line = page.locator(LINE)
      await expect(line).toHaveCount(1)
      await expect(line).toBeVisible()
      const text = (await line.innerText()).trim()
      expect(text.startsWith(source), text).toBe(true)
      expect(text).not.toMatch(VOUCHING)
      const time = line.locator('time')
      await expect(time).toHaveCount(1)
      await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/)
      expect((await time.innerText()).trim()).not.toBe('')
      await expect(line.getByRole('link', { name: new RegExp(`^${link}`) })).toBeVisible()
    })

    test('its link is the CTA\'s: the original ad on the same host, a new tab, the same rel — and the CTA stays unique', async ({ page }) => {
      await page.goto(IMPORTED)
      const cta = page.locator('[data-affiliate-cta]')
      await expect(cta).toHaveCount(1)
      const a = page.locator(`${LINE} a`)
      await expect(a).toHaveCount(1)
      const [ctaHref, href] = [await cta.getAttribute('href'), await a.getAttribute('href')]
      // The host (the plan's check) and, stronger, the very URL: the fixture's own ad, not the site's home.
      expect(new URL(href!).host).toBe(new URL(ctaHref!).host)
      expect(href).toBe(ctaHref)
      expect(href).toBe('https://www.nhatot.com/ci-fixture-imported-flat.htm')
      await expect(a).toHaveAttribute('target', '_blank')
      // The paid-link disclosure itself, not only "whatever the CTA has".
      await expect(a).toHaveAttribute('rel', 'sponsored nofollow noopener noreferrer')
      await expect(cta).toHaveAttribute('rel', 'sponsored nofollow noopener noreferrer')
    })

    test('an own listing has no provenance line', async ({ page }) => {
      await page.goto(OWN)
      // Anchor on the page having rendered its own content first, so the zero below is not vacuous.
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator(LINE)).toHaveCount(0)
    })
  })
}
