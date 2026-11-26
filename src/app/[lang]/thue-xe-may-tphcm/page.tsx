import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { withinResult } from '@/lib/site-identity'
import { guideDates, marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'
import { bikeHubDescription } from '@/lib/vehicle-hub-meta'

/**
 * Thuê xe máy TP.HCM (Vietnamese half) — see src/components/marketplace/vehicle-hub.tsx for what this page is and why.
 * ⚠️ AN ORDINARY `page.tsx`, so it builds on both editions like every marketplace guide; the forum
 * build self-canonicalises and no forum surface links to it (footer + /c/rentals gate on IS_SERVICES).
 */
const SLUG = VEHICLE_HUB_SLUGS.motorbike.vi

// Live counts and prices: an hour, like the other inventory-backed landing pages.
export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadVehicleHub('motorbike')
  // The site's name only where it fits (Seobility crawl 4, 2026-11-25: 635 px of 580 with it).
  // "Xe" once (Seobility crawl 10: three times, a title word repeat): the bike types are the description's and the H1's.
  // ⛔ No gearbox words here: "số sàn" is a car term and was reverted once.
  return {
    ...withinResult(
      `Thuê Xe Máy Sài Gòn: Giá Theo Ngày Hoặc Tháng | ${SITE_NAME}`,
      // It opens with the page's biggest query word for word and carries the second's words, which a result can bold
      // (Search Console, 28 days to 2026-11-26: "thuê xe máy sài gòn" 393 impressions, "thuê xe máy tphcm" 255; the old
      // one opened "Xe máy cho thuê tại…", matching neither phrase). 759 px of 1,000 by serp-width's descriptionPx,
      // 2026-11-26 (Seobility crawl 4: the one before last was 1,050).
      // With a price first when the page prints day figures (vehicle-hub-meta.ts bikeHubDescription, OpenSEO audit 2026-11-26).
      bikeHubDescription(data, 'vi', 'Thuê xe máy Sài Gòn (TP.HCM) từ các cửa hàng: xe ga và xe số, giá thuê theo ngày và theo tháng tính từ các tin đang có.'),
    ),
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('motorbike')} lang="vi" {...guideDates('thue-xe-may-tphcm')} />
}
