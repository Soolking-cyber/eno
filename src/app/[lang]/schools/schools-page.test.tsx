import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * /schools — the Teachers' Choice link in the intro row goes STRAIGHT to the open year's page (plan P1 item 17,
 * 2026-10-20). It pointed at the bare /schools/awards, which answers a 307 to /schools/awards/<year> (measured live
 * that day on eno.vn and www.eno.forum): a redirect hop for every visitor and every crawl. The label's year and the
 * link's year are one value, so they turn over together at midnight on 1 January in Saigon.
 *
 * The page's data and its chrome are stand-ins: only the intro row is under test here.
 */
vi.mock('@/lib/schools/queries', () => ({ listAllSchools: async () => [] }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/marketplace/bilingual', () => ({
  Bilingual: ({ en, values }: { en: string; values?: Record<string, string> }) => Object.entries(values ?? {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), en),
}))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/schools/schools-board', () => ({ SchoolsBoard: () => null }))
vi.mock('@/components/schools/schools-methodology', () => ({ SchoolsMethodology: () => null }))
vi.mock('@/components/schools/schools-sidebar', () => ({ SchoolsSidebar: () => null }))
vi.mock('@/components/teachers/cover-promo-card', () => ({ CoverPromoCard: () => null }))
vi.mock('@/app/[lang]/c/[category]/teaching-links', () => ({ PostJobLink: () => null }))

const { default: SchoolsPage } = await import('./page')

/** Every link on the rendered page whose text names Teachers' Choice, as [href, text]. */
async function awardLinks(now: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  const html = renderToStaticMarkup(await SchoolsPage({ params: Promise.resolve({ lang: 'en' }) }))
  return [...html.matchAll(/<a href="([^"]*)">([^<]*Teachers(?:'|&#x27;) Choice[^<]*)<\/a>/g)].map((m) => [m[1], m[2].replace('&#x27;', "'")])
}
afterEach(() => { vi.useRealTimers() })

describe("/schools — the Teachers' Choice link", () => {
  it("goes straight to the open year's page, never the bare /schools/awards (a 307)", async () => {
    expect(await awardLinks('2026-10-20T05:00:00Z')).toEqual([['/schools/awards/2026', "Teachers' Choice 2026"]])
  })

  it('moves to the new year with its label, at midnight on 1 January in Saigon', async () => {
    // 23:59 on 31 December in Saigon, then 00:00 on 1 January (UTC+7).
    expect(await awardLinks('2026-12-31T16:59:00Z')).toEqual([['/schools/awards/2026', "Teachers' Choice 2026"]])
    expect(await awardLinks('2026-12-31T17:00:00Z')).toEqual([['/schools/awards/2027', "Teachers' Choice 2027"]])
  })
})
