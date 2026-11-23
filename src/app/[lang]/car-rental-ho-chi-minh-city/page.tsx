import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { titleWithSite } from '@/lib/meta-description'
import { guideDates, marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'
import { carHubDescription } from '@/lib/vehicle-hub-meta'

/**
 * Self-drive car hire in Ho Chi Minh City — see src/components/marketplace/vehicle-hub.tsx for what this page is and why.
 * ⚠️ AN ORDINARY `page.tsx`, so it builds on both editions like every marketplace guide; the forum
 * build self-canonicalises and no forum surface links to it (footer + /c/rentals gate on IS_SERVICES).
 */
const SLUG = VEHICLE_HUB_SLUGS.car.en

// Live counts and prices: an hour, like the other inventory-backed landing pages.
export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadVehicleHub('car')
  return {
    // 57 characters without the site's name, 66 with it (Seobility, 2026-11-23: over the ~580 px a result shows): titleWithSite drops it.
    title: titleWithSite('Self-Drive Car Rental in Ho Chi Minh City: Prices per Day', SITE_NAME, 60),
    // Answer first: the day prices the page prints (src/lib/vehicle-hub-meta.ts), else the old wording.
    description: carHubDescription(data, 'en', 'Self-drive cars for hire in Ho Chi Minh City (Saigon) from local rental shops on one page — day prices by car size and for 7-seaters, where the cars are and how booking works.'),
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('car')} lang="en" {...guideDates('car-rental-ho-chi-minh-city')} />
}
