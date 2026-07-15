import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SettingsClient } from './settings-client'

export const metadata: Metadata = {
  title: 'Settings | eno.vn',
  robots: { index: false, follow: false },
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsClient />
    </Suspense>
  )
}
