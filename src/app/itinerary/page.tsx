import { permanentRedirect } from 'next/navigation'

export default function LegacyItineraryRedirect() {
  const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'
  permanentRedirect(`${forumUrl}/itinerary`)
}
