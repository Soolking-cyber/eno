import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A11-SEO-CTA on the VIETNAMESE furniture hub (commit-gate review 2026-10-04): the page is Vietnamese-pinned,
 * so its CTA AND its rail's "Xem tất cả" browse link must both land on the `/vi` feed. The rail derives its
 * URL from the target by default (seoBrowseHref → the English-pinned plain `/`), so the hub hands it the CTA's
 * own localized URL through `browseLink.href`. The page does not export its content object, so the contract is
 * pinned on the source: one shared constant, used by both. (That localizedHref(…, 'vi') yields the `/vi` twin on
 * the marketplace build is lang-pinned's own contract — vitest runs as the services edition, where the pilot is off.)
 */
const SRC = readFileSync(join(process.cwd(), 'src/app/[lang]/thanh-ly-do-gia-dung-cu-tphcm/page.tsx'), 'utf8')
const RAIL = readFileSync(join(process.cwd(), 'src/components/marketplace/seo-listing-rail.tsx'), 'utf8')

describe('Vietnamese furniture hub — CTA and rail browse link agree', () => {
  it('defines one localized feed URL and uses it for the CTA and the rail browse link', () => {
    expect(SRC).toContain("const USED_FURNITURE_VI = localizedHref('/?category=furniture-appliances&condition=used', 'vi')")
    expect(SRC).toMatch(/cta:\s*\{\s*href:\s*USED_FURNITURE_VI\b/)
    expect(SRC).toMatch(/browseLink:\s*\{\s*href:\s*USED_FURNITURE_VI\b/)
  })

  it('the rail lets an explicit browseLink.href win over the target-derived URL', () => {
    expect(RAIL).toContain('href={browseLink?.href ?? seoBrowseHref(target)}')
  })
})
