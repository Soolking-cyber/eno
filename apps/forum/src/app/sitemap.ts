import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'
  return [
    { url: forumUrl, changeFrequency: 'daily', priority: 1 },
    { url: `${forumUrl}/itinerary`, changeFrequency: 'weekly', priority: 0.8 },
  ]
}
