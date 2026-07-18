import type { Metadata } from 'next'
import { EnoDashboard } from '@/components/dashboard/eno-dashboard'
import { ForumFooter } from '@/components/forum/forum-footer'
import { ForumHeader } from '@/components/forum/forum-header'

export const metadata: Metadata = {
  title: 'Your eno dashboard',
  description: 'Access your saved Vietnam itineraries, visa applications, forum, and marketplace account.',
  robots: { index: false, follow: false },
}

export default function DashboardPage() {
  return (
    <div className="dashboard-canvas flex min-h-screen flex-col">
      <ForumHeader />
      <EnoDashboard />
      <ForumFooter />
    </div>
  )
}
