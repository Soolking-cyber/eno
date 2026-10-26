import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Suspense } from 'react'
import { SettingsTabs } from './settings-tabs'

const METADATA: Metadata = {
  title: `Settings | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Cài đặt | ${SITE_NAME}` })
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
