import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { RentalCheckView } from './rental-check-view'

/**
 * /rentals/check — the availability-check "basket" (owner, 2026-09-25): the rentals a visitor
 * collected, what they want asked, how to reach them, and "Check these for me". Both editions.
 *
 * ⚠️ A SERVER SHELL AROUND A CLIENT VIEW, AND NOINDEX. Everything on the page lives on the visitor's
 * device (the basket is localStorage), so there is nothing for a crawler to read and nothing worth
 * a search result — an empty list page per language would be pure index bloat.
 */
export const metadata: Metadata = {
  title: `Check availability | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default function RentalCheckPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-6 sm:px-6">
        <RentalCheckView />
      </main>
      <Footer />
    </div>
  )
}
