'use client'

import { useSearchParams } from 'next/navigation'
import { DashboardTabs, DashboardTabPanelSkeleton, type DashboardTab } from '@/components/marketplace/dashboard-tabs'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { ListingsClient } from './listings-client'
import { BulkClient } from '../bulk/bulk-client'

/**
 * LISTINGS — folds the former /dashboard/bulk into /dashboard/listings as a tab (owner, 2026-09-01).
 * Both are "manage what I'm selling". Each mounted client renders content-only (`embedded`) so the
 * shell owns the one header.
 *
 * ⚠️ AVAILABILITY IS NOT A TAB. The daily availability review already lives inside the All-listings
 * view as a status pill (owner 2026-07-18: "out of the rail, into the tab"), and the review flow is
 * its own page at /dashboard/availability that the pill links to. Adding a second Availability tab
 * here duplicated the same queue across two surfaces, so it was removed and /dashboard/availability
 * stays a standalone page.
 */
export function ListingsTabs() {
  const { tr } = useLanguage()
  const { dash, loading } = useDashboard()
  const requested = useSearchParams().get('tab')

  // ⚠️ BULK UPLOAD IS BUSINESS-TIER ONLY — the rail's `role: 'business'` gate. BulkClient bounces a
  // non-business viewer to /dashboard/listings on mount, so an individual tapping the tab would be
  // ejected mid-section. Shown only once the payload confirms business; a non-business deep link to
  // `?tab=bulk` falls back to All, not a bounce. An individual therefore sees a single-tab section
  // (just All), which the shell renders cleanly.
  const tabs: DashboardTab[] = [
    { value: 'all', label: tr('All listings', 'Tất cả'), content: <ListingsClient embedded /> },
  ]
  // `confirmedIndividual` is the ONLY state that hides a requested Bulk tab: the payload came back
  // and the viewer is not business. Loading and a FAILED payload both leave it un-confirmed.
  const confirmedIndividual = !loading && !!dash && dash.tier !== 'business'
  if (dash?.tier === 'business') {
    tabs.push({ value: 'bulk', label: tr('Bulk upload', 'Tải hàng loạt'), content: <BulkClient embedded /> })
  } else if (requested === 'bulk' && !confirmedIndividual) {
    // Deep-link / redirect to ?tab=bulk before the tier is confirmed. While LOADING, show a skeleton
    // (mounts no client → no All-fallback flash, no eject if the viewer is individual). If the
    // dashboard payload FAILED, mount the real BulkClient so the feature stays REACHABLE and shows
    // its own state rather than the tab vanishing during a dashboard outage.
    tabs.push({ value: 'bulk', label: tr('Bulk upload', 'Tải hàng loạt'), content: loading ? <DashboardTabPanelSkeleton /> : <BulkClient embedded /> })
  }

  return (
    <DashboardTabs title={tr('My listings', 'Tin của tôi')} fallbackHref="/dashboard" tabs={tabs} />
  )
}
