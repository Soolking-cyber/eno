import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { withinResult } from '@/lib/site-identity'
import { guideDates, marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'

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
  return {
    ...withinResult(
      `Thuê Xe Máy Sài Gòn: Xe Ga, Xe Số, Theo Ngày Hoặc Tháng | ${SITE_NAME}`,
      // 802 px of 1,000 (Seobility crawl 4: the old one was 1,050).
      'Xe máy cho thuê tại TP.HCM (Sài Gòn) từ các cửa hàng: xe ga và xe số, giá thuê theo ngày và theo tháng tính từ các tin đang có.',
    ),
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('motorbike')} lang="vi" {...guideDates('thue-xe-may-tphcm')} />
}
