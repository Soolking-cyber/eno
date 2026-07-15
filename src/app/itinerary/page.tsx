import type { Metadata } from 'next'
import { Footer } from '@/components/marketplace/footer'
import { Header } from '@/components/marketplace/header'
import { ItineraryBuilder } from '@/components/itinerary/itinerary-builder'

const title = 'Vietnam itinerary builder — Plan your trip with AI | eno.vn'
const description = 'Choose your Vietnam destination, trip length, budget, and interests to build a personalized day-by-day itinerary with suggested stays and places to visit.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/itinerary' },
  openGraph: {
    title,
    description,
    siteName: 'eno.vn',
    type: 'website',
    url: '/itinerary',
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
}

export default function ItineraryPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <ItineraryBuilder />
      <Footer />
    </div>
  )
}
