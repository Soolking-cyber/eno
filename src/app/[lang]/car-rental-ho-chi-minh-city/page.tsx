import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { guideDates, marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'

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
    title: `Car Rental in Ho Chi Minh City: Self-Drive Cars by the Day | ${SITE_NAME}`,
    description: 'Self-drive cars for hire in Ho Chi Minh City (Saigon) from Mioto and BonbonCar on one page — day prices by car size, 7-seaters and VinFast electric, where the cars are and how booking works.',
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('car')} lang="en" {...guideDates('car-rental-ho-chi-minh-city')} />
}
