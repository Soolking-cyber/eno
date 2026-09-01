import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SettingsTabs } from './settings-tabs'

export const metadata: Metadata = {
  title: `Settings | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

// SETTINGS is now the tabbed section that absorbs the former /dashboard/dev and the display prefs
// (owner, 2026-09-01). Reached from the identity card on the rail and the mobile account hub — it
// needs no nav row. Suspense: SettingsTabs → DashboardTabs reads useSearchParams for the active tab.
export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsTabs />
    </Suspense>
  )
}
