'use client'

import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { DisputesPanel } from '@/components/marketplace/disputes-panel'

// My dispute cases — both roles: cases I filed and cases about me/my storefront.
// A case room lives at /disputes/[id]; this list is reachable from the account menu,
// the dashboard "Disputes" tab, and every dispute notification. The list body is the
// shared <DisputesPanel/> so the standalone page and the dashboard tab never drift.

export default function DisputesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {/* Same max-w-7xl content width as the dashboard/header so the standalone page
          matches the dashboard Disputes tab (the list is already 2-col on desktop). */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-10 sm:px-6 lg:px-8">
        <DisputesPanel />
      </main>
      <Footer />
    </div>
  )
}
