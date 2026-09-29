import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'

/**
 * Thuê xe tự lái TP.HCM (Vietnamese half) — see src/components/marketplace/vehicle-hub.tsx for what this page is and why.
 * ⚠️ AN ORDINARY `page.tsx`, so it builds on both editions like every marketplace guide; the forum
 * build self-canonicalises and no forum surface links to it (footer + /c/rentals gate on IS_SERVICES).
 */
const SLUG = VEHICLE_HUB_SLUGS.car.vi

// Live counts and prices: an hour, like the other inventory-backed landing pages.
export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadVehicleHub('car')
  return {
    title: `Thuê Xe Tự Lái TP.HCM: Giá Thuê Theo Ngày, Xe 4–7 Chỗ | ${SITE_NAME}`,
    description: 'Xe ô tô tự lái cho thuê tại TP.HCM từ Mioto và BonbonCar trên một trang — giá thuê theo ngày cho xe 4–5 chỗ, 7 chỗ và xe điện VinFast, xe ở quận nào và cách đặt xe.',
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('car')} lang="vi" published="2026-09-29" />
}
