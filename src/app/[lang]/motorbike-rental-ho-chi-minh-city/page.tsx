import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { guideDates, marketplaceGuideAlternates } from '@/lib/expat-guides'
import { VehicleHub, VEHICLE_HUB_SLUGS } from '@/components/marketplace/vehicle-hub'
import { loadVehicleHub } from '@/lib/vehicle-hubs'
import { bikeHubDescription } from '@/lib/vehicle-hub-meta'
import { titleWithSite } from '@/lib/meta-description'

/**
 * Motorbike hire in Ho Chi Minh City — see src/components/marketplace/vehicle-hub.tsx for what this page is and why.
 * ⚠️ AN ORDINARY `page.tsx`, so it builds on both editions like every marketplace guide; the forum
 * build self-canonicalises and no forum surface links to it (footer + /c/rentals gate on IS_SERVICES).
 */
const SLUG = VEHICLE_HUB_SLUGS.motorbike.en

// Live counts and prices: an hour, like the other inventory-backed landing pages.
export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadVehicleHub('motorbike')
  return {
    title: titleWithSite(`Motorbike Rental in Ho Chi Minh City: Scooters by Day or Month`, SITE_NAME),
    // Within a result: 899 px of 1,000 (Seobility crawl 4, 2026-11-25: the old one was 1,230).
    // With a price first when the page prints day figures (vehicle-hub-meta.ts bikeHubDescription, OpenSEO audit 2026-11-26).
    description: bikeHubDescription(data, 'en', 'Motorbikes and scooters for rent in Ho Chi Minh City (Saigon) from local shops: automatic or manual, with day and month prices from live listings.'),
    alternates: marketplaceGuideAlternates(SLUG),
    // ⛔ NOTHING LIVE = NOTHING TO INDEX. Computed, so it lifts itself when stock returns.
    ...(data.total === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function Page() {
  return <VehicleHub data={await loadVehicleHub('motorbike')} lang="en" {...guideDates('motorbike-rental-ho-chi-minh-city')} />
}
