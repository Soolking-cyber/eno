import { test, expect } from '../helpers'

/**
 * ⛔ THE CONTENT PAGES HYDRATE CLEANLY — NO React #418 (C-HYDRATION, 2026-09-29).
 *
 * /partners and /developers threw "Minified React error #418" on 2 of 2 cold loads in production, and
 * the client re-render that follows a failed hydration emitted the layout's Organization + WebSite
 * JSON-LD a second time. The cause was block content inside a <p> (see
 * src/app/[lang]/html-nesting-contract.test.ts, which pins the source shapes); this pins the outcome on
 * the pages that share ContentPage or its neighbours.
 *
 * ⚠️ RUN IT AGAINST A PRODUCTION BUILD: #418 is minified and only surfaces as a pageerror there (dev
 * reports a different message but also fails this). And set E2E_BASE — without it the suite fails open.
 */
const PAGES = ['/partners', '/developers', '/about', '/trust', '/terms', '/safety', '/regulations', '/help']

test.describe('Guest · content pages hydrate without errors', () => {
  for (const path of PAGES) {
    test(`${path} has no page error`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(path, { waitUntil: 'load' })
      await page.waitForTimeout(2000)
      expect(errors).toEqual([])
    })
  }

  for (const path of ['/partners', '/developers']) {
    test(`${path} carries the layout's JSON-LD once`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' })
      await page.waitForTimeout(2000)
      // Three since 5e920f05f (2026-11-17): OnlineBusiness (#organization), its plain "Organization" alias for answer engines,
      // and WebSite ([lang]/layout.tsx). "Once" is the point: no block is duplicated by hydration, so every one is distinct.
      const blocks = page.locator('script[type="application/ld+json"]')
      await expect(blocks.first()).toBeAttached()
      // EXACTLY the layout's three blocks, each once, by @type: these pages add none of their own, so any other block or a
      // hydration duplicate (whose text may differ) fails. JSON.stringify keeps an array @type or a missing one visible.
      const types = (await blocks.allTextContents()).map((t) => JSON.stringify((JSON.parse(t) as { '@type'?: unknown })['@type'] ?? null))
      expect(types.sort()).toEqual(['"OnlineBusiness"', '"Organization"', '"WebSite"'])
    })
  }
})
