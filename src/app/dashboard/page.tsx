import type { Metadata } from 'next'
import { DashboardClient } from './dashboard-client'

export const metadata: Metadata = {
  title: 'Dashboard | eno.vn',
  robots: { index: false, follow: false },
}

export default function DashboardPage() {
  return <DashboardClient />
}
