import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${forumUrl}/sitemap.xml`,
  }
}
