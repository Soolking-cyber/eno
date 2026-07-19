import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { HelpCenter } from '@/components/marketplace/help-center'

export const metadata: Metadata = {
  title: 'Help center | eno.vn',
  description: 'Answers about buying, selling, trust, messaging, offers and safe trading on eno.vn — the trusted marketplace for Vietnam.',
  alternates: { canonical: '/help' },
}

export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <HelpCenter />
      </main>
      <Footer />
    </div>
  )
}
