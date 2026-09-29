import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuideAlternates } from '@/lib/expat-guides'
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
  return {
    title: `Thuê Xe Máy Sài Gòn: Xe Ga, Xe Số, Theo Ngày Hoặc Tháng | ${SITE_NAME}`,
    description: 'Xe máy cho thuê tại TP.HCM (Sài Gòn) từ các cửa hàng cho thuê — xe ga và xe số, giá thuê theo ngày và theo tháng tính từ các tin đang có, và cách đặt xe với cửa hàng.',
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('motorbike')} lang="vi" published="2026-09-29" />
}
