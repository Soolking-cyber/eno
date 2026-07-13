import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardRedirect } from './redirect-client'

export const metadata: Metadata = { title: 'Dashboard — eno.vn', robots: { index: false } }

/** The page dashboard is retired (user decision 2026-07-14): the right-side
 *  account panel IS the dashboard, on every screen size. This route survives
 *  only so every existing link (?tab= deep links, mobile nav, notifications)
 *  lands in the panel instead — it maps the tab to a panel section, opens it,
 *  and returns the visitor to wherever they can keep browsing. */
export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardRedirect />
    </Suspense>
  )
}
