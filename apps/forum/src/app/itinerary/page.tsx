import type { Metadata } from 'next'
import { ForumHeader } from '@/components/forum/forum-header'
import { ItineraryBuilder } from '@/components/itinerary/itinerary-builder'
import { ForumFooter } from '@/components/forum/forum-footer'

const title = 'Vietnam itinerary builder — Plan your trip with AI'
const description = 'Choose your Vietnam destination, trip length, budget, and interests to build a personalized day-by-day itinerary with suggested stays and places to visit.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/itinerary' },
  openGraph: {
    title,
    description,
    siteName: 'eno.forum',
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
    <div className="flex min-h-screen flex-col bg-background">
      <ForumHeader />
      <ItineraryBuilder />
      <ForumFooter />
    </div>
  )
}
