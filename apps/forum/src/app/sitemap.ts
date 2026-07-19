import type { MetadataRoute } from 'next'

const MARKETPLACE_API_URL = (
  process.env.MARKETPLACE_API_URL
  || process.env.NEXT_PUBLIC_MARKETPLACE_URL
  || 'https://eno.vn'
).replace(/\/$/, '')

const POST_CAP = 5_000
const PAGE_SIZE = 50 // the posts API's hard per-request limit

type SitemapPostRow = { id: string; updatedAt: string }

async function livePosts(): Promise<SitemapPostRow[]> {
  if (process.env.FORUM_E2E_PREVIEW === '1') return []
  const rows: SitemapPostRow[] = []
  let cursor: string | null = null
  try {
    // Keyset-paginate newest-first until the cap; fail-open to the static
    // entries alone if the marketplace API is unavailable mid-walk.
    for (let page = 0; page < POST_CAP / PAGE_SIZE && rows.length < POST_CAP; page++) {
      const cursorParam: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const response = await fetch(
        `${MARKETPLACE_API_URL}/api/forum/posts?limit=${PAGE_SIZE}&sort=latest${cursorParam}`,
        { next: { revalidate: 3_600 }, signal: AbortSignal.timeout(4_000) },
      )
      if (!response.ok) break
      const body = await response.json() as { posts?: SitemapPostRow[]; nextCursor?: string | null }
      for (const post of body.posts || []) {
        if (post.id && rows.length < POST_CAP) rows.push({ id: post.id, updatedAt: post.updatedAt })
      }
      cursor = body.nextCursor || null
      if (!cursor) break
    }
  } catch {
    // Transient upstream failure: whatever was collected so far still ships.
  }
  return rows
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'
  const staticEntries: MetadataRoute.Sitemap = [
    { url: forumUrl, changeFrequency: 'daily', priority: 1 },
    { url: `${forumUrl}/itinerary`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${forumUrl}/visa`, changeFrequency: 'weekly', priority: 0.8 },
  ]
  const posts = await livePosts()
  return [
    ...staticEntries,
    ...posts.map((post): MetadataRoute.Sitemap[number] => ({
      url: `${forumUrl}/post/${encodeURIComponent(post.id)}`,
      lastModified: post.updatedAt ? new Date(post.updatedAt) : undefined,
      changeFrequency: 'weekly',
      priority: 0.6,
    })),
  ]
}
