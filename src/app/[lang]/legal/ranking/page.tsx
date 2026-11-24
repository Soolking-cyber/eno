/**
 * ⚠️ KEEP `revalidate` — this is a LEGAL page whose content is DERIVED FROM CODE.
 *
 * The percentages are computed from `RANK` at render time, so a tuning change in
 * ranking-formula.ts must reach this page. With no revalidate, Next bakes today's numbers into
 * on-disk HTML that outlives the deploy that changed them — and a stale ranking disclosure is a
 * false statement to a regulator, not cosmetic staleness. This is the same class of bug that once
 * shipped "PayPal" and "e-Visa" welded into prerendered /regulations HTML no runtime gate could
 * reach.
 */
export const revalidate = 3600

import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { withShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { FEED_DIVERSITY_WINDOW } from '@/lib/feed-diversity'
import { RankingContent } from './ranking-content'

// Search & ranking transparency (Luật Thương mại điện tử 122/2025/QH15).
// Architecture: docs/compliance-2026.md §4.1. Rendered by BOTH editions — eno.vn and eno.forum
// both carry third-party listings, so both owe the disclosure; it is not visa/itinerary-gated.
//
// The copy lives in ./ranking-content (a client component) so every sentence can carry CURATED
// Vietnamese via tr(en, vi) rather than machine translation. This file stays a server component
// to own `metadata` and `revalidate`, which client components cannot export — and to read
// FEED_DIVERSITY_WINDOW here, so the client bundle does not pull in feed-diversity's imports.

const METADATA: Metadata = withShare({
  // The domain once, at the end (Seobility crawl 3: "How eno.vn ranks results" is "domain in title"); the h1's own words.
  title: `How we rank search results | ${SITE_NAME}`,
  description: `The parameters that determine listing order on ${SITE_NAME}, and their relative importance.`,
  alternates: { canonical: '/legal/ranking' },
})
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Cách chúng tôi sắp xếp kết quả | ${SITE_NAME}` })
}

export default function RankingPage() {
  return <RankingContent diversityWindow={FEED_DIVERSITY_WINDOW} />
}
